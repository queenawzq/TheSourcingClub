import { PayoutMethodRefusal, checkWithdrawalRequest, holdPayouts, withdrawBalance } from "./_stripe-payouts.js";

/**
 * A factory's withdrawal from its Stripe balance, with Stripe's payout fee
 * paid by the factory exactly once (src/shared/withdrawal-fees.mjs).
 *
 * Stripe bills TSC nothing per transfer and its payout fee per payout, so an
 * approved step reaches the factory's Stripe balance in full. When the
 * factory withdraws X:
 *   1. the fee on X is computed (in US$, the transfers' currency);
 *   2. TSC takes it back by partial reversals of the factory's transfers,
 *      newest first, spread over several if one has too little left;
 *   3. the rest, X less what the reversals took from the balance (in the
 *      balance's own currency: Stripe converts a US$ reversal at its rate),
 *      is paid out to the bank.
 * If the payout is refused, or fails or is cancelled later (payout.failed,
 * payout.canceled), the fee goes back to the factory's balance by a transfer,
 * so a fee is never paid for nothing. What is left after the fee must be at
 * least Stripe's minimum payout, checked before anything moves.
 *
 * Crash safety: one stripe_withdrawals row per request, claimed (a 2-minute
 * lease) before Stripe is asked anything. The reversal plan is saved before
 * the first reversal; every Stripe call has a key derived from the row, and a
 * retry looks for what an earlier call made (the row id is in each object's
 * metadata) before making anything. A row left half-way by a call that died
 * is settled by the next withdrawal or balance read on that account: a payout
 * that went is recorded, else the fee is given back.
 *
 * The leading underscore keeps Vercel from serving this file.
 */

/** A .mjs, so loaded with import(): a static one stops the function starting on Vercel. */
const feeModule = () => import("../src/shared/withdrawal-fees.mjs");

/** Said when Stripe will not take the fee back (no transfer left to reverse, or a reversal refused). */
export const CANNOT_PROCESS = "This withdrawal can't be processed right now. Nothing was sent. Contact operations@contact.sourcing-club.com for help.";
/** Said to a second request with the same key while the first is still working. */
export const IN_PROGRESS = "This withdrawal is already being processed.";
/** The Withdraw dialog's own words for an amount over the balance (WithdrawFromBalance.jsx), in the balance's currency. */
export const upToSentence = (available, currency) =>
  `You can withdraw up to ${new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(available / 100)}.`;

/** Stripe answered and refused. A timeout, a 5xx, a 409 or a 429 says nothing about what exists. */
const refusedByStripe = (failure) => failure instanceof PayoutMethodRefusal || [400, 402, 403, 404].includes(failure?.statusCode);

/** The key a request is known by: the same as the payout key before fees, so a resent request finds its row. */
export const withdrawalKey = (accountId, { requestId, amount, destination = null }) =>
  `withdraw-${accountId}-${requestId}-${amount}-${destination ?? "default"}`;

async function update(db, row, fields) {
  const { error } = await db.from("stripe_withdrawals").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", row.id);
  if (error) throw new Error(error.message);
  Object.assign(row, fields);
}

/** What the browser is told about a payout: the same shape as before. */
const payoutReply = (payout) => ({ id: payout.id, amount: payout.amount, currency: payout.currency, status: payout.status });

/**
 * withdrawWithFee({ stripe, db, orgId, accountId, country, amount, currency, requestId, destination, userId })
 *   → the payout ({ id, amount, currency, status }): amount is X less the fee.
 * Throws PayoutMethodRefusal with the sentence to show when it refuses.
 */
export async function withdrawWithFee({ stripe, db, orgId, accountId, country = "", amount, currency, requestId, destination = null, userId = null }) {
  await checkWithdrawalRequest(stripe, accountId, { amount, currency, requestId, destination });
  const key = withdrawalKey(accountId, { requestId, amount, destination });
  // Older withdrawals left half-way first: what they took must be settled
  // before this one reads the balance.
  await settleAbandoned({ stripe, db, accountId, except: key });

  const claim = () => db.rpc("claim_stripe_withdrawal", {
    target_org: orgId, account: accountId, key, request: requestId, amount, in_currency: currency,
    to_destination: destination, by_user: userId,
  });
  let { data, error } = await claim();
  if (error) throw new Error(error.message);
  if (!data?.claimed && endedWithNothingSent(data?.row)) {
    // Pressed again after a refusal: a fresh attempt, answered for the balance
    // as it is now. The old row keeps its record under another key, and the
    // new row's own id gives every Stripe call a new idempotency key, so no
    // earlier refusal is replayed.
    const { error: moveError } = await db.from("stripe_withdrawals")
      .update({ request_key: `${key}~${Date.now()}`, updated_at: new Date().toISOString() }).eq("id", data.row.id);
    if (moveError) throw new Error(moveError.message);
    ({ data, error } = await claim());
    if (error) throw new Error(error.message);
  }
  const row = data?.row;
  if (!row) throw new Error("the withdrawal could not be claimed");
  if (!data.claimed) {
    if (row.state === "paid_out") return { id: row.payout_id, amount: Number(row.payout_minor), currency: row.currency.toLowerCase(), status: "pending" };
    if (row.state === "refused" || row.state === "fee_returned") {
      if (row.reason) throw new PayoutMethodRefusal(row.reason);
      throw new Error("this withdrawal was refused by Stripe");
    }
    throw new PayoutMethodRefusal(IN_PROGRESS);
  }
  try {
    return await carryOut({ stripe, db, row, country, requestId, destination });
  } finally {
    await db.from("stripe_withdrawals").update({ lease_until: null }).eq("id", row.id).then(() => null, () => null);
  }
}

/** Refused before anything moved, or the fee given back before any payout: nothing was sent. */
const endedWithNothingSent = (row) => Boolean(row) && !row.payout_id
  && (row.state === "refused" || row.state === "fee_returned");

/** The factory's transfers that still have something to reverse, newest first (Stripe lists newest first). */
async function* reversibleTransfers(stripe, accountId) {
  for await (const transfer of stripe.transfers.list({ destination: accountId, limit: 100 })) {
    const left = Number(transfer.amount) - Number(transfer.amount_reversed ?? 0);
    if (transfer.reversed || left <= 0 || transfer.currency !== "usd") continue;
    yield { transfer, left };
  }
}

/** Refused: the row says why, so the same request is answered the same way until it is pressed again. */
async function refuse(db, row, reason) {
  await update(db, row, { state: "refused", reason });
  throw new PayoutMethodRefusal(reason);
}

/** The balance's available amount now, in its own currency. */
async function availableNow(stripe, accountId, currency) {
  const balance = await stripe.balance.retrieve({}, { stripeAccount: accountId });
  return balance.available.find((b) => b.currency === currency)?.amount ?? 0;
}

/** The currency and rate a transfer landed at in the factory's balance. */
async function landed(stripe, accountId, transfer) {
  const id = typeof transfer.destination_payment === "string" ? transfer.destination_payment : transfer.destination_payment?.id;
  if (!id) return null;
  const payment = await stripe.charges.retrieve(id, { expand: ["balance_transaction"] }, { stripeAccount: accountId });
  const tx = payment.balance_transaction;
  if (!tx || typeof tx !== "object") return null;
  return { currency: tx.currency, rate: Number(tx.exchange_rate) || 1 };
}

async function carryOut({ stripe, db, row, country, requestId, destination }) {
  const accountId = row.stripe_account_id;
  const currency = row.currency.toLowerCase();
  const amount = Number(row.amount_minor);
  await holdPayouts(stripe, accountId);

  if (row.state === "claimed" && row.fee_cents == null) {
    // More than is available is refused before any fee is taken (the dialog
    // caps the amount; this is a teammate's withdrawal in between).
    const available = await availableNow(stripe, accountId, currency);
    if (amount > available) await refuse(db, row, upToSentence(available, currency));
    const { stripeWithdrawalFee, stripeMinimumPayout, stripeMinimumWithdrawal, minimumWithdrawalSentence } = await feeModule();
    // The fee, and whether what is left is a payout Stripe will make, before
    // anything moves. localPerUsd is the newest transfer's rate (1 for US$).
    let fee = null;
    const decide = (localPerUsd) => {
      fee = stripeWithdrawalFee({ amountMinor: amount, currency, country, localPerUsd });
      if (fee.refused) return fee.refused;
      if (amount - fee.feeLocalEstimate < stripeMinimumPayout(currency)) {
        return minimumWithdrawalSentence(stripeMinimumWithdrawal({ currency, country, localPerUsd }), currency);
      }
      return null;
    };
    if (currency === "usd") {
      const refusal = decide(1);
      if (refusal) await refuse(db, row, refusal);
    }
    // Newest first, and only as far back as the fee needs: one read per
    // transfer used, not per transfer the factory has ever had. Only
    // transfers that landed in this balance's currency can pay its fee.
    const plan = [];
    let needed = fee?.feeCents ?? null;
    for await (const { transfer, left } of reversibleTransfers(stripe, accountId)) {
      const where = await landed(stripe, accountId, transfer);
      if (!where || where.currency !== currency) continue;
      if (needed == null) {
        const refusal = decide(where.rate);
        if (refusal) await refuse(db, row, refusal);
        needed = fee.feeCents;
      }
      const take = Math.min(left, needed);
      plan.push({ transfer: transfer.id, amount: take, reversal: null, local: null });
      needed -= take;
      if (needed <= 0) break;
    }
    if (needed == null || needed > 0) await refuse(db, row, CANNOT_PROCESS);
    await update(db, row, { fee_cents: fee.feeCents, reversals: plan });
  }

  if (row.state === "claimed") {
    const plan = row.reversals.map((item) => ({ ...item }));
    try {
      for (const item of plan) {
        if (item.reversal && item.local != null) continue;
        const reversal = await findOrReverse(stripe, row, item);
        item.reversal = reversal.id;
        item.local = await reversedFromBalance(stripe, accountId, reversal, currency, item.amount);
        await update(db, row, { reversals: plan });
      }
    } catch (failure) {
      if (!refusedByStripe(failure)) throw failure;
      // Stripe would not take (all of) the fee: give back any part it took.
      // Most often the balance went in the meantime (another tab's withdrawal).
      await giveBack(stripe, db, row, plan.filter((item) => item.reversal).reduce((sum, item) => sum + item.amount, 0), CANNOT_PROCESS);
      const reason = await balanceShortSentence(stripe, accountId, currency, amount) ?? CANNOT_PROCESS;
      await update(db, row, { reason });
      throw new PayoutMethodRefusal(reason);
    }
    await update(db, row, { state: "fee_taken", fee_local_minor: plan.reduce((sum, item) => sum + Number(item.local), 0) });
  }

  if (row.state === "fee_taken") {
    const payoutAmount = amount - Number(row.fee_local_minor);
    const { stripeMinimumPayout, stripeMinimumWithdrawal, minimumWithdrawalSentence } = await feeModule();
    if (payoutAmount < stripeMinimumPayout(currency)) {
      // The fee as Stripe converted it left less than its estimate: the same answer as before any reversal.
      const reason = payoutAmount <= 0 ? CANNOT_PROCESS
        : minimumWithdrawalSentence(Math.max(amount + 1, stripeMinimumWithdrawal({ currency, country, localPerUsd: Number(row.fee_local_minor) / Number(row.fee_cents) || 1 })), currency);
      await giveBack(stripe, db, row, Number(row.fee_cents), reason);
      throw new PayoutMethodRefusal(reason);
    }
    let payout = await findPayout(stripe, row);
    if (!payout) {
      try {
        payout = await withdrawBalance(stripe, accountId, {
          amount: payoutAmount, currency, requestId, destination,
          idempotencyKey: `swp-${row.id}`, metadata: { stripe_withdrawal_id: row.id },
        });
      } catch (failure) {
        if (!refusedByStripe(failure)) throw failure;
        // Refused: nothing left the balance, so neither does the fee.
        await giveBack(stripe, db, row, Number(row.fee_cents), failure instanceof PayoutMethodRefusal ? failure.message : null);
        // The balance went in the meantime (another tab's withdrawal): said in the dialog's words.
        const short = await balanceShortSentence(stripe, accountId, currency, amount);
        if (short) {
          await update(db, row, { reason: short });
          throw new PayoutMethodRefusal(short);
        }
        throw failure;
      }
    }
    await update(db, row, { state: "paid_out", payout_id: payout.id, payout_minor: payout.amount });
    return payoutReply(payout);
  }
  if (row.state === "paid_out") return { id: row.payout_id, amount: Number(row.payout_minor), currency, status: "pending" };
  throw new Error(`withdrawal in state ${row.state}`);
}

/** "You can withdraw up to …" when the balance is now under the amount, else null. Never throws: it only chooses words. */
async function balanceShortSentence(stripe, accountId, currency, amount) {
  try {
    const available = await availableNow(stripe, accountId, currency);
    return available < amount ? upToSentence(available, currency) : null;
  } catch {
    return null;
  }
}

/** A reversal this withdrawal made on this transfer, else a new one. */
async function findOrReverse(stripe, row, item) {
  for await (const reversal of stripe.transfers.listReversals(item.transfer, { limit: 100 })) {
    if (reversal.metadata?.stripe_withdrawal_id === row.id) return reversal;
  }
  return stripe.transfers.createReversal(item.transfer, {
    amount: item.amount,
    description: "Withdrawal fee",
    metadata: { stripe_withdrawal_id: row.id },
  }, { idempotencyKey: `swr-${row.id}-${item.transfer}` });
}

/** What a US$ reversal took from the factory's balance, in the balance's currency (Stripe's own figure). */
async function reversedFromBalance(stripe, accountId, reversal, currency, usdAmount) {
  if (currency === "usd") return usdAmount;
  const id = typeof reversal.destination_payment_refund === "string" ? reversal.destination_payment_refund : reversal.destination_payment_refund?.id;
  const refund = await stripe.refunds.retrieve(id, { expand: ["balance_transaction"] }, { stripeAccount: accountId });
  const tx = refund.balance_transaction;
  if (!tx || tx.currency !== currency) throw new Error("the fee was taken in another currency than the balance");
  return Math.abs(Number(tx.amount));
}

/** A payout this withdrawal already made, found by its metadata. */
async function findPayout(stripe, row) {
  const recent = await stripe.payouts.list({ limit: 100 }, { stripeAccount: row.stripe_account_id });
  return recent.data.find((payout) => payout.metadata?.stripe_withdrawal_id === row.id) ?? null;
}

/** Give the fee back to the factory's balance: a transfer of what was reversed, once. */
async function giveBack(stripe, db, row, usdAmount, reason) {
  let transferId = null;
  if (usdAmount > 0) {
    let already = null;
    for await (const transfer of stripe.transfers.list({ destination: row.stripe_account_id, limit: 100 })) {
      if (transfer.metadata?.stripe_withdrawal_fee_return === row.id) { already = transfer; break; }
    }
    const transfer = already ?? await stripe.transfers.create({
      amount: usdAmount,
      currency: "usd",
      destination: row.stripe_account_id,
      description: "Withdrawal fee returned",
      metadata: { stripe_withdrawal_fee_return: row.id },
    }, { idempotencyKey: `swg-${row.id}` });
    transferId = transfer.id;
  }
  await update(db, row, { state: usdAmount > 0 ? "fee_returned" : "refused", fee_return_transfer_id: transferId, reason });
}

/**
 * Withdrawals on this account left half-way by a call that died (lease
 * lapsed): a payout that went is recorded; otherwise whatever fee was taken
 * goes back. `except` is the request being made now.
 */
export async function settleAbandoned({ stripe, db, accountId, except = null }) {
  const { data, error } = await db.from("stripe_withdrawals").select("id, request_key, lease_until")
    .eq("stripe_account_id", accountId).in("state", ["claimed", "fee_taken"]);
  if (error) throw new Error(error.message);
  const now = Date.now();
  for (const open of data ?? []) {
    if (open.request_key === except) continue;
    if (open.lease_until && Date.parse(open.lease_until) > now) continue;
    const claim = await db.rpc("claim_abandoned_stripe_withdrawal", { target: open.id });
    if (claim.error) throw new Error(claim.error.message);
    const row = Array.isArray(claim.data) ? claim.data[0] : claim.data;
    if (!row?.id) continue;
    try {
      const payout = await findPayout(stripe, row);
      if (payout && !["failed", "canceled"].includes(payout.status)) {
        const plan = row.reversals ?? [];
        await update(db, row, {
          state: "paid_out", payout_id: payout.id, payout_minor: payout.amount,
          fee_local_minor: row.fee_local_minor ?? Number(row.amount_minor) - Number(payout.amount),
          reversals: plan,
        });
        continue;
      }
      // Reversals Stripe made, recorded or not.
      let taken = 0;
      for (const item of row.reversals ?? []) {
        for await (const reversal of stripe.transfers.listReversals(item.transfer, { limit: 100 })) {
          if (reversal.metadata?.stripe_withdrawal_id === row.id) taken += Number(reversal.amount);
        }
      }
      await giveBack(stripe, db, row, taken, null);
    } finally {
      await db.from("stripe_withdrawals").update({ lease_until: null }).eq("id", row.id).then(() => null, () => null);
    }
  }
}

/**
 * Stripe says a payout failed or was cancelled after it was made: the money
 * is back in the factory's balance, and so is the fee. Returns whether a fee
 * went back.
 */
export async function returnFeeOnFailedPayout({ stripe, db, payout }) {
  if (!payout?.id || !["failed", "canceled"].includes(payout.status)) return false;
  const read = async () => {
    const byPayout = await db.from("stripe_withdrawals").select("*").eq("payout_id", payout.id).maybeSingle();
    if (byPayout.error) throw new Error(byPayout.error.message);
    if (byPayout.data) return byPayout.data;
    // Not recorded yet: the call that made the payout has not saved it (or died
    // first). The payout carries its row's id.
    const id = payout.metadata?.stripe_withdrawal_id;
    if (!/^[0-9a-f-]{36}$/i.test(id ?? "")) return null;
    const byId = await db.from("stripe_withdrawals").select("*").eq("id", id).maybeSingle();
    if (byId.error) throw new Error(byId.error.message);
    return byId.data;
  };
  let row = await read();
  if (!row) return false;
  if (row.state === "claimed" || row.state === "fee_taken") {
    // Half-way: settled now if its call died (a failed payout gives the fee
    // back there), else this event is answered with an error and Stripe sends
    // it again once that call has recorded the payout.
    await settleAbandoned({ stripe, db, accountId: row.stripe_account_id });
    row = await read();
    if (row?.state === "fee_returned") return true;
    if (row?.state !== "paid_out") throw new Error("the withdrawal for this payout is still being processed");
  }
  if (row.state !== "paid_out") return false;
  await giveBack(stripe, db, row, Number(row.fee_cents ?? 0), null);
  return true;
}
