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
/**
 * Stripe's answer to a key reused with other values: it says nothing about
 * whether the first request made anything (the step's charge changed since,
 * say), so it is never read as a refusal.
 */
const idempotencyClash = (failure) => failure?.type === "StripeIdempotencyError" || failure?.rawType === "idempotency_error"
  || failure?.raw?.type === "idempotency_error";
const refusedByStripe = (failure) => failure instanceof PayoutMethodRefusal
  || (!idempotencyClash(failure) && [400, 402, 403, 404].includes(failure?.statusCode));

/** The key a request is known by: the same as the payout key before fees, so a resent request finds its row. */
export const withdrawalKey = (accountId, { requestId, amount, destination = null }) =>
  `withdraw-${accountId}-${requestId}-${amount}-${destination ?? "default"}`;

/**
 * Give up this call's lease on a withdrawal, only if it is still this call's:
 * a call that outlived its 2 minutes must not clear the lease another call
 * has taken since. Never throws; a lease left behind lapses on its own.
 */
async function releaseLease(db, row) {
  if (!row?.id || !row.lease_until) return;
  await db.from("stripe_withdrawals").update({ lease_until: null })
    .eq("id", row.id).eq("lease_until", row.lease_until).then(() => null, () => null);
}

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
export async function withdrawWithFee({ stripe, db, orgId, accountId, country = "", amount, currency, requestId, destination = null, userId = null,
  oneBalance = false, payoutCurrency = null, transfersActive = false }) {
  // The one balance: `amount` is US cents, paid out in the balance's own
  // currency. Otherwise `amount` is in `currency`, from the Stripe money only.
  const paidIn = oneBalance ? String(payoutCurrency ?? "usd").toLowerCase() : currency;
  if (oneBalance && currency !== "usd") throw new PayoutMethodRefusal("Choose a valid available balance to withdraw.");
  await checkWithdrawalRequest(stripe, accountId, { amount, currency: paidIn, requestId, destination });
  const key = withdrawalKey(accountId, { requestId, amount, destination }) + (oneBalance && paidIn !== "usd" ? "-usd" : "");
  // Older withdrawals left half-way first: what they took must be settled
  // before this one reads the balance.
  await settleAbandoned({ stripe, db, accountId, except: key });
  // And a fee kept on a payout that failed since: back in the balance first.
  await returnFeesOnFailedPayouts({ stripe, db, accountId });

  // A non-US$ balance's gross is known once the owed money has landed; until
  // then the row carries an estimate (Stripe's latest rate for this account).
  const firstAmount = oneBalance && paidIn !== "usd"
    ? Math.max(1, Math.round(amount * ((await localPerUsd(stripe, accountId, paidIn)) ?? 1))) : amount;
  const claim = () => db.rpc("claim_stripe_withdrawal", {
    target_org: orgId, account: accountId, key, request: requestId, amount: firstAmount, in_currency: paidIn,
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
  // Who asked, on every row, refused ones included.
  if (!row.requested_by && userId && data.claimed) {
    await update(db, row, { requested_by: userId }).catch(() => null);
  }
  if (!data.claimed) {
    if (row.state === "paid_out") return { id: row.payout_id, amount: Number(row.payout_minor), currency: row.currency.toLowerCase(), status: "pending" };
    if (row.state === "refused" || row.state === "fee_returned") {
      if (row.reason) throw new PayoutMethodRefusal(row.reason);
      throw new Error("this withdrawal was refused by Stripe");
    }
    throw new PayoutMethodRefusal(IN_PROGRESS);
  }
  if (oneBalance && row.usd_cents == null && row.state === "claimed" && row.fee_cents == null) {
    await update(db, row, { usd_cents: amount });
  }
  try {
    return await carryOut({ stripe, db, row, country, requestId, destination, transfersActive });
  } finally {
    await releaseLease(db, row);
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
async function refuse(db, row, reason, { stripe = null, cause = null } = {}) {
  if (stripe && row.usd_cents != null) await settleAttempted(stripe, db, row);
  // Owed money already transferred for this withdrawal goes back to TSC and
  // to the balance: refused means nothing left the balance.
  if (stripe && row.usd_cents != null) {
    const back = await reverseSentTakes(stripe, db, row);
    if (back.failed) cause = "reversal_failed";
  }
  await returnHeldTakes(db, row);
  await update(db, row, { state: "refused", reason, ...(cause ? { refusal_cause: cause } : {}) });
  throw new PayoutMethodRefusal(reason);
}

/** Owed money this withdrawal claimed and did not send goes back to the balance. */
async function returnHeldTakes(db, row) {
  if (row.usd_cents == null) return;
  const { error } = await db.rpc("return_stripe_takes", { target_withdrawal: row.id });
  if (error) throw new Error(error.message);
}

/** The balance's available amount now, in its own currency. */
async function availableNow(stripe, accountId, currency) {
  const balance = await stripe.balance.retrieve({}, { stripeAccount: accountId });
  return balance.available.find((b) => b.currency === currency)?.amount ?? 0;
}

/**
 * What this withdrawal may take: the balance's available amount less what
 * other withdrawals on the account, still being made by a live call, have yet
 * to take from it (another tab's payout that has not gone). Read between
 * another tab's fee and its payout, the balance alone overstates it.
 */
async function withdrawableNow(stripe, db, row, currency) {
  const available = await availableNow(stripe, row.stripe_account_id, currency);
  const { data, error } = await db.from("stripe_withdrawals")
    .select("id, currency, amount_minor, fee_local_minor, reversals, state, lease_until, usd_cents, d1_minor, transfers_done_at")
    .eq("stripe_account_id", row.stripe_account_id).in("state", ["claimed", "fee_taken"]);
  if (error) throw new Error(error.message);
  const now = Date.now();
  let claimed = 0;
  for (const other of data ?? []) {
    if (other.id === row.id || other.currency?.toLowerCase() !== currency) continue;
    if (!other.lease_until || Date.parse(other.lease_until) <= now) continue;
    // A one-balance withdrawal still claiming or transferring owed money
    // takes from this balance only its own Stripe money and what it has
    // landed so far; its gross (an estimate until then) is not yet here.
    if (other.usd_cents != null && !other.transfers_done_at) {
      const { data: parts } = await db.from("payment_takes").select("amount_cents")
        .eq("stripe_withdrawal_id", other.id).eq("status", "sent");
      const sentUsd = (parts ?? []).reduce((sum, part) => sum + Number(part.amount_cents), 0);
      const rate = currency === "usd" ? 1 : Number(other.amount_minor) / Number(other.usd_cents) || 1;
      claimed += Number(other.d1_minor ?? 0) + Math.round(sentUsd * rate);
      continue;
    }
    const taken = other.state === "fee_taken" ? Number(other.fee_local_minor ?? 0)
      : (other.reversals ?? []).reduce((sum, item) => sum + Number(item.local ?? 0), 0);
    claimed += Math.max(0, Number(other.amount_minor) - taken);
  }
  return Math.max(0, available - claimed);
}

/**
 * What open withdrawals on this Stripe account (claimed or fee taken, still
 * to be paid out) hold of its balance, per currency (lower case), in that
 * currency's minor units: the same claim withdrawableNow() subtracts, for
 * every open row, live lease or not, except `except`. A one-balance row still
 * claiming or transferring holds its own Stripe part and what it has landed
 * so far; any other holds its amount less the fee already taken back.
 */
export async function heldByOpenWithdrawals(db, accountId, except = null, { stripe = null } = {}) {
  const { data, error } = await db.from("stripe_withdrawals")
    .select("id, currency, amount_minor, fee_local_minor, reversals, state, usd_cents, d1_minor, transfers_done_at")
    .eq("stripe_account_id", accountId).in("state", ["claimed", "fee_taken"]);
  if (error) throw new Error(error.message);
  const held = {};
  for (const other of data ?? []) {
    if (other.id === except) continue;
    const currency = String(other.currency ?? "").toLowerCase();
    let claim;
    if (other.usd_cents != null && !other.transfers_done_at) {
      const { data: parts } = await db.from("payment_takes").select("amount_cents")
        .eq("stripe_withdrawal_id", other.id).eq("status", "sent");
      const sentUsd = (parts ?? []).reduce((sum, part) => sum + Number(part.amount_cents), 0);
      const rate = currency === "usd" ? 1 : Number(other.amount_minor) / Number(other.usd_cents) || 1;
      claim = Number(other.d1_minor ?? 0) + Math.round(sentUsd * rate);
    } else {
      const taken = other.state === "fee_taken" ? Number(other.fee_local_minor ?? 0)
        : (other.reversals ?? []).reduce((sum, item) => sum + Number(item.local ?? 0), 0);
      claim = Math.max(0, Number(other.amount_minor) - taken);
    }
    // With Stripe at hand, only the part of the claim in Stripe's AVAILABLE
    // balance: owed money it transferred that is still clearing sits in
    // Stripe's pending, already counted there.
    if (stripe && other.usd_cents != null) {
      claim = Math.max(0, claim - await stillClearing(stripe, db, accountId, other.id, currency));
    }
    held[currency] = (held[currency] ?? 0) + claim;
  }
  return held;
}

/** What a withdrawal's transferred parts landed as that Stripe still has as pending, in the balance's currency. Never throws. */
async function stillClearing(stripe, db, accountId, withdrawalId, currency) {
  try {
    const { data: parts } = await db.from("payment_takes").select("stripe_transfer_id")
      .eq("stripe_withdrawal_id", withdrawalId).eq("status", "sent").not("stripe_transfer_id", "is", null);
    let pending = 0;
    for (const part of parts ?? []) {
      const transfer = await stripe.transfers.retrieve(part.stripe_transfer_id);
      const id = typeof transfer.destination_payment === "string" ? transfer.destination_payment : transfer.destination_payment?.id;
      if (!id) continue;
      const payment = await stripe.charges.retrieve(id, { expand: ["balance_transaction"] }, { stripeAccount: accountId });
      const tx = payment.balance_transaction;
      if (tx && typeof tx === "object" && tx.status === "pending" && tx.currency === currency) pending += Number(tx.amount);
    }
    return pending;
  } catch {
    return 0;
  }
}

/** The currency and rate a transfer landed at in the factory's balance. */
async function landed(stripe, accountId, transfer) {
  const id = typeof transfer.destination_payment === "string" ? transfer.destination_payment : transfer.destination_payment?.id;
  if (!id) return null;
  const payment = await stripe.charges.retrieve(id, { expand: ["balance_transaction"] }, { stripeAccount: accountId });
  const tx = payment.balance_transaction;
  if (!tx || typeof tx !== "object") return null;
  return { currency: tx.currency, rate: Number(tx.exchange_rate) || 1, amount: Number(tx.amount) };
}

/** Units of the balance's currency per US$, as Stripe last converted a transfer to this account; null if none. */
async function localPerUsd(stripe, accountId, currency) {
  if (currency === "usd") return 1;
  let seen = 0;
  for await (const transfer of stripe.transfers.list({ destination: accountId, limit: 20 })) {
    if (++seen > 20) break;
    if (transfer.currency !== "usd") continue;
    const where = await landed(stripe, accountId, transfer).catch(() => null);
    if (where?.currency === currency) return where.rate;
  }
  return null;
}

async function carryOut({ stripe, db, row, country, requestId, destination, transfersActive = false }) {
  const accountId = row.stripe_account_id;
  const currency = row.currency.toLowerCase();
  await holdPayouts(stripe, accountId);
  // The one balance: owed money is claimed and transferred to this account
  // first, so the payout below pays out exactly what was asked.
  if (row.usd_cents != null && row.state === "claimed" && row.fee_cents == null && !row.transfers_done_at) {
    await gatherOwed({ stripe, db, row, country, transfersActive });
  }
  const amount = Number(row.amount_minor);

  if (row.state === "claimed" && row.fee_cents == null) {
    // More than is available is refused before any fee is taken (the dialog
    // caps the amount; this is a teammate's withdrawal in between).
    const available = await withdrawableNow(stripe, db, row, currency);
    if (amount > available) await refuse(db, row, row.usd_cents != null ? CANNOT_PROCESS : upToSentence(available, currency), { stripe });
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
      if (refusal) await refuse(db, row, refusal, { stripe });
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
        if (refusal) await refuse(db, row, refusal, { stripe });
        needed = fee.feeCents;
      }
      const take = Math.min(left, needed);
      plan.push({ transfer: transfer.id, amount: take, reversal: null, local: null });
      needed -= take;
      if (needed <= 0) break;
    }
    if (needed == null || needed > 0) await refuse(db, row, CANNOT_PROCESS, { stripe });
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
      await giveBack(stripe, db, row, plan.filter((item) => item.reversal).reduce((sum, item) => sum + item.amount, 0), CANNOT_PROCESS, { takeBack: true });
      // The one balance: its owed money is back in the balance, so the
      // Stripe account's "up to" would mislead.
      const reason = row.usd_cents != null ? CANNOT_PROCESS : await balanceShortSentence(stripe, db, row, currency, amount) ?? CANNOT_PROCESS;
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
      await giveBack(stripe, db, row, Number(row.fee_cents), reason, { takeBack: true });
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
        await giveBack(stripe, db, row, Number(row.fee_cents), failure instanceof PayoutMethodRefusal ? failure.message : null, { takeBack: true });
        // The balance went in the meantime (another tab's withdrawal): said in the dialog's words.
        const short = row.usd_cents != null ? CANNOT_PROCESS : await balanceShortSentence(stripe, db, row, currency, amount);
        if (short) {
          await update(db, row, { reason: short });
          throw new PayoutMethodRefusal(short);
        }
        throw failure;
      }
    }
    await update(db, row, { state: "paid_out", payout_id: payout.id, payout_minor: payout.amount });
    await recordPayoutMade(db, row, payout);
    await tellWithdrawalAsked(stripe, db, row, payout);
    return payoutReply(payout);
  }
  if (row.state === "paid_out") return { id: row.payout_id, amount: Number(row.payout_minor), currency, status: "pending" };
  throw new Error(`withdrawal in state ${row.state}`);
}

/** Said when owed money is needed but the account cannot take transfers yet (the existing sentence of /api/stripe-connect). */
export const NOT_VERIFIED = "Finish payout verification before withdrawing.";

/** The held takes of a withdrawal with the charge each is paid from. */
async function readTakes(db, row) {
  const { data, error } = await db.from("payment_takes")
    .select("id, payment_id, amount_cents, status, stripe_transfer_id, attempted_at, order_payments (stripe_charge_id, order_id, state, disputed_at, production_orders (order_number))")
    .eq("stripe_withdrawal_id", row.id).order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map((take) => ({
    ...take,
    charge_id: take.order_payments?.stripe_charge_id ?? null,
    order_id: take.order_payments?.order_id ?? null,
    order_number: take.order_payments?.production_orders?.order_number ?? "",
  }));
}

/** Whether a disputed charge's dispute is still open or was lost (Stripe keeps `disputed` true after a win). */
async function openDispute(stripe, charge) {
  const id = typeof charge.dispute === "string" ? charge.dispute : charge.dispute?.id;
  if (!id) return true;
  const dispute = await stripe.disputes.retrieve(id);
  return !["won", "warning_closed"].includes(dispute.status);
}

/** A transfer an earlier call made for this take (it reached Stripe, not our database), else null. */
async function findTakeTransfer(stripe, take, row) {
  if (!take.order_id) return null;
  for await (const transfer of stripe.transfers.list({ transfer_group: take.order_id, limit: 100 })) {
    if (transfer.metadata?.take_id === take.id && transfer.metadata?.take_withdrawal_id === row.id) return transfer;
  }
  return null;
}

/** The transfer for a part, the same every time it is asked for (Stripe refuses a key reused with other values). */
const takeTransfer = (take, row) => [{
  amount: Number(take.amount_cents),
  currency: "usd",
  destination: row.stripe_account_id,
  source_transaction: take.charge_id,
  transfer_group: take.order_id,
  description: `${take.order_number}: payout`,
  metadata: { payment_id: take.payment_id, order_id: take.order_id, take_id: take.id, take_withdrawal_id: row.id },
}, { idempotencyKey: `release-${take.payment_id}-${row.id}` }];

/** Stripe keeps an idempotency key's answer 24 hours: after 23, asking again could make a second transfer. */
const KEY_WINDOW_MS = 23 * 3600 * 1000;

/**
 * Parts this withdrawal asked Stripe to transfer and has not recorded:
 * settled before anything goes back to the balance. Found by listing, or
 * asked again with the same key, which answers with the first transfer (or
 * makes it, which is the factory's money arriving, never a second one). A
 * refusal under that key means none exists: the part goes back. Unsure, a
 * key past Stripe's window, a key reused with other values, or a step now
 * disputed: the part stays held, and the staff board lists it.
 *
 * `staff` (staff pressed "Check again"): a part not found by listing once the
 * key window has passed has no transfer, and goes back; so does a part whose
 * step was refunded when Stripe refuses the same transfer again. A part on a
 * disputed step still in the window stays held: asking again could move
 * disputed money.
 *
 * Returns { sent, returned, unsure } in US cents.
 */
async function settleAttempted(stripe, db, row, { staff = false } = {}) {
  const held = (await readTakes(db, row)).filter((take) => take.status === "held" && take.attempted_at);
  const result = { sent: 0, returned: 0, unsure: 0 };
  for (const take of held) {
    const amount = Number(take.amount_cents);
    try {
      const found = await findTakeTransfer(stripe, take, row);
      if (found) {
        await call(db, "record_take_sent", { target_take: take.id, transfer: found.id });
        result.sent += amount;
        continue;
      }
      if (Date.parse(take.attempted_at) < Date.now() - KEY_WINDOW_MS) {
        if (staff) {
          await call(db, "return_take_leased", { target_take: take.id, lease: row.lease_until ?? null });
          result.returned += amount;
        } else result.unsure += amount;
        continue;
      }
      const refunded = take.order_payments?.state !== "confirmed";
      if (take.order_payments?.disputed_at || (refunded && !staff)) {
        result.unsure += amount;
        continue;
      }
      let transfer = null;
      try {
        transfer = await stripe.transfers.create(...takeTransfer(take, row));
      } catch (failure) {
        if (refusedByStripe(failure)) {
          await call(db, "return_take_leased", { target_take: take.id, lease: row.lease_until ?? null });
          result.returned += amount;
          continue;
        }
        throw failure;
      }
      await call(db, "record_take_sent", { target_take: take.id, transfer: transfer.id });
      result.sent += amount;
    } catch (failure) {
      result.unsure += amount;
      console.error("stripe-withdrawals settle part", take.id, failure?.message);
    }
  }
  return result;
}

/** What staff read after "Check again" (new sentences, staff only). */
export function checkedSentence({ sent, returned, unsure }) {
  const usd = (cents) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
  const parts = [];
  if (sent) parts.push(`${usd(sent)} was sent to the factory's Stripe account`);
  if (returned) parts.push(`${usd(returned)} is back in the factory's balance`);
  if (unsure) parts.push(`${usd(unsure)} is still not settled. Check it in Stripe, or check again tomorrow`);
  return parts.length ? `${parts.join(". ")}.` : "Nothing is waiting on this withdrawal.";
}

/**
 * Staff's "Check again" on a Stripe withdrawal from the "Needs checking"
 * tab: a withdrawal stopped half-way is carried on or settled
 * (settleAbandoned), then its parts Stripe was asked for are settled as
 * staff may (settleAttempted). Never makes a second transfer.
 */
export async function checkStripeWithdrawal({ stripe, db, withdrawalId }) {
  const { data: row, error } = await db.from("stripe_withdrawals").select("*").eq("id", withdrawalId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return { done: false, sentence: "That withdrawal isn't on the board any more. Reload the page." };
  // The withdrawal's lease first: while another call is carrying it on, its
  // parts are that call's to settle, and nothing here touches them.
  const leased = await db.rpc("lease_stripe_withdrawal", { target: withdrawalId });
  if (leased.error) throw new Error(leased.error.message);
  const mine = Array.isArray(leased.data) ? leased.data[0] : leased.data;
  if (!mine?.id) {
    const unsure = (await readTakes(db, row)).filter((take) => take.status === "held")
      .reduce((sum, take) => sum + Number(take.amount_cents), 0);
    const result = { sent: 0, returned: 0, unsure };
    return { done: false, ...result, sentence: checkedSentence(result) };
  }
  try {
    if (["claimed", "fee_taken"].includes(mine.state)) await settleOne(stripe, db, mine);
    // A reversal Stripe made whose part was not returned (the call stopped,
    // or another held the lease): returned now. No new reversal is made.
    if (mine.refusal_cause === "reversal_failed" && mine.usd_cents != null) {
      const back = await reverseSentTakes(stripe, db, mine, { createNew: false });
      // A part still sent with no reversal is money in the factory's Stripe
      // account (counted there): nothing more for staff to do.
      if (!back.failed) await update(db, mine, { refusal_cause: null }).catch(() => null);
    }
    const result = await settleAttempted(stripe, db, mine, { staff: true });
    return { done: true, ...result, sentence: checkedSentence(result) };
  } finally {
    await releaseLease(db, mine);
  }
}

async function call(db, name, args) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw Object.assign(new Error(`${name}: ${error.message}`), { code: error.code, hint: error.hint });
  return data;
}

/**
 * The one balance, Stripe road: money already in the factory's Stripe
 * account is used first; the rest is claimed from its owed steps (oldest
 * cleared first, in part if needed: claim_owed_steps), each step's charge is
 * checked (refunded or disputed: nothing is sent), TSC's platform balance must
 * cover the transfers, then each part is transferred from its charge. The
 * withdrawal's gross becomes what is now in the balance for it: the Stripe
 * money used plus what the transfers landed as (in the balance's currency).
 * Every step is recorded on the row, so a call that dies is resumed.
 */
async function gatherOwed({ stripe, db, row, country, transfersActive }) {
  const accountId = row.stripe_account_id;
  const currency = row.currency.toLowerCase();
  const usd = Number(row.usd_cents);

  if (row.owed_cents == null) {
    // A US$ withdrawal too small to pay out is refused before anything moves.
    if (currency === "usd") {
      const { stripeWithdrawalFee, stripeMinimumPayout, stripeMinimumWithdrawal, minimumWithdrawalSentence } = await feeModule();
      const fee = stripeWithdrawalFee({ amountMinor: usd, currency, country, localPerUsd: 1 });
      if (fee.refused) await refuse(db, row, fee.refused, { stripe });
      if (usd - fee.feeLocalEstimate < stripeMinimumPayout(currency)) {
        await refuse(db, row, minimumWithdrawalSentence(stripeMinimumWithdrawal({ currency, country, localPerUsd: 1 }), currency), { stripe });
      }
    }
    const inStripe = await withdrawableNow(stripe, db, row, currency);
    let rate = 1;
    if (currency !== "usd" && inStripe > 0) {
      rate = await localPerUsd(stripe, accountId, currency);
      if (!rate) await refuse(db, row, CANNOT_PROCESS, { stripe });
    }
    const inStripeUsd = currency === "usd" ? inStripe : Math.floor(inStripe / rate);
    const owed = Math.max(0, usd - inStripeUsd);
    const fromStripe = owed > 0 ? inStripe : (currency === "usd" ? usd : Math.min(inStripe, Math.round(usd * rate)));
    await update(db, row, { d1_minor: fromStripe });
    if (owed > 0) {
      if (!transfersActive) await refuse(db, row, NOT_VERIFIED, { stripe });
      try {
        const claimed = await call(db, "claim_owed_steps", { target_org: row.org_id, amount: owed, road: "stripe", withdrawal: row.id });
        row.owed_cents = Number(claimed?.claimed_cents ?? owed);
      } catch (failure) {
        if (failure.hint === "withdrawal_over_balance") {
          const reach = await call(db, "owed_reachable", { target_org: row.org_id }).catch(() => null);
          await refuse(db, row, upToSentence(inStripeUsd + Number(reach?.stripe_cents ?? 0), "usd"), { stripe });
        }
        if (failure.hint === "payout_upgrading" || failure.hint === "withdrawal_not_waiting") await refuse(db, row, CANNOT_PROCESS, { stripe });
        throw failure;
      }
    } else {
      await update(db, row, { owed_cents: 0 });
    }
  }

  const takes = await readTakes(db, row);
  let held = takes.filter((take) => take.status === "held");
  if (held.length) {
    // Transferred by a call that died before recording it: recorded now.
    for (const take of held) {
      const found = await findTakeTransfer(stripe, take, row);
      if (!found) continue;
      await call(db, "record_take_sent", { target_take: take.id, transfer: found.id });
      Object.assign(take, { status: "sent", stripe_transfer_id: found.id });
    }
    held = held.filter((take) => take.status === "held");
  }
  if (held.length) {
    // Every charge before any transfer: Stripe does not refuse a transfer
    // from a disputed charge, and a refunded one has nothing to pay from.
    let unsafe = false;
    for (const take of held) {
      const charge = await stripe.charges.retrieve(take.charge_id);
      if (Number(charge.amount_refunded) > 0) {
        const { applyChargeRefund } = await import("./_stripe.js");
        await applyChargeRefund({ stripe, db, charge });
        unsafe = true;
      } else if (charge.disputed && await openDispute(stripe, charge)) {
        await call(db, "record_payment_disputed", { target_payment: take.payment_id, disputed: true });
        unsafe = true;
      }
    }
    if (unsafe) await refuse(db, row, CANNOT_PROCESS, { stripe });
    // A cleared charge's money is in TSC's available balance, or nowhere.
    const platform = await stripe.balance.retrieve();
    const platformUsd = platform.available?.find((entry) => entry.currency === "usd")?.amount ?? 0;
    const needed = held.reduce((sum, take) => sum + Number(take.amount_cents), 0);
    if (platformUsd < needed) await refuse(db, row, CANNOT_PROCESS, { stripe, cause: "platform_short" });
    for (const take of held) {
      let transfer;
      // Marked first: a part Stripe may have is never handed back unchecked.
      await call(db, "mark_take_attempted", { target_take: take.id });
      take.attempted_at = take.attempted_at ?? new Date().toISOString();
      try {
        transfer = await stripe.transfers.create(...takeTransfer(take, row));
      } catch (failure) {
        // Refused: this part and the rest go back to the balance; what went
        // before is in the factory's Stripe account, still its money.
        if (refusedByStripe(failure)) {
          const short = failure?.code === "balance_insufficient";
          await refuse(db, row, CANNOT_PROCESS, { stripe, cause: short ? "platform_short" : null });
        }
        throw failure;
      }
      await call(db, "record_take_sent", { target_take: take.id, transfer: transfer.id });
      Object.assign(take, { status: "sent", stripe_transfer_id: transfer.id });
    }
  }

  // What the owed money landed as, in this balance's currency.
  let landedMinor = 0;
  for (const take of takes.filter((item) => item.status === "sent")) {
    if (currency === "usd") {
      landedMinor += Number(take.amount_cents);
      continue;
    }
    const transfer = await stripe.transfers.retrieve(take.stripe_transfer_id);
    const where = await landed(stripe, accountId, transfer);
    if (!where || where.currency !== currency) throw new Error("a transfer landed in another currency than the balance");
    landedMinor += where.amount;
  }
  const gross = Number(row.d1_minor ?? 0) + landedMinor;
  if (gross <= 0) await refuse(db, row, CANNOT_PROCESS, { stripe });
  await update(db, row, { landed_minor: landedMinor, amount_minor: gross, transfers_done_at: new Date().toISOString() });
}

/**
 * Before a factory's balance is read, without waiting for webhooks: its Stripe
 * payouts the database still has on their way (no arrival day yet, or that
 * day has come) are read back from Stripe, a few per read. A new status or
 * day is recorded; a payout that failed or was cancelled gives its fee back
 * (returnFeeOnFailedPayout, as the webhook does). Never throws; bounded by
 * `budgetMs`. Returns how many were read in time.
 */
export async function refreshPayoutsFor({ stripe, db, orgId, limit = 5, budgetMs = 3000 }) {
  const work = (async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { data: recent, error } = await db.from("stripe_withdrawals")
      .select("id, stripe_account_id, payout_id, payout_status, payout_arrives_on, created_at")
      .eq("org_id", orgId).eq("state", "paid_out").not("payout_id", "is", null)
      .order("created_at", { ascending: false }).limit(100);
    if (error) return 0;
    const data = (recent ?? [])
      .filter((row) => [null, "pending", "in_transit"].includes(row.payout_status ?? null)
        && (!row.payout_arrives_on || row.payout_arrives_on <= today))
      .reverse().slice(0, limit);
    if (!data.length) return 0;
    const read = await Promise.all(data.map(async (row) => {
      try {
        const payout = await stripe.payouts.retrieve(row.payout_id, {}, { stripeAccount: row.stripe_account_id });
        const fields = payoutFields(payout);
        // Never backwards (an older answer read after payout.paid was recorded):
        // the database refuses it too.
        const rank = { pending: 1, in_transit: 2, paid: 3, failed: 4, canceled: 4 };
        if ((rank[fields.payout_status] ?? 0) < (rank[row.payout_status] ?? 0)) return true;
        if (fields.payout_status !== row.payout_status || fields.payout_arrives_on !== row.payout_arrives_on) {
          const { error: saveError } = await db.from("stripe_withdrawals").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", row.id);
          if (saveError) throw new Error(saveError.message);
        }
        if (["failed", "canceled"].includes(payout.status)) await returnFeeOnFailedPayout({ stripe, db, payout });
        return true;
      } catch (failure) {
        console.error("stripe-withdrawals payout read", row.id, failure?.message);
        return false;
      }
    }));
    return read.filter(Boolean).length;
  })().catch(() => 0);
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(0), budgetMs); });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** What the company's list reads about a payout: where it is, and when it arrives. */
export const payoutFields = (payout) => ({
  payout_status: payout?.status ?? null,
  payout_arrives_at: payout?.arrival_date ? new Date(Number(payout.arrival_date) * 1000).toISOString() : null,
  // Stripe's arrival_date is a day (midnight UTC): kept as one, so no reader
  // west of UTC sees the day before.
  payout_arrives_on: payout?.arrival_date ? new Date(Number(payout.arrival_date) * 1000).toISOString().slice(0, 10) : null,
});

/** The payout as made: its status only if no webhook has said a newer one meanwhile. */
async function recordPayoutMade(db, row, payout) {
  const { payout_status: status, ...rest } = payoutFields(payout);
  await update(db, row, rest);
  try {
    await db.from("stripe_withdrawals").update({ payout_status: status }).eq("id", row.id).is("payout_status", null);
  } catch {
    // Best effort: the webhook records the status too.
  }
}

/**
 * The whole company hears of a Stripe withdrawal, as of a PayPal or Wise one,
 * in the same words ("Withdrawal of $X requested" / "To …"). Once per
 * withdrawal; never fails the withdrawal.
 */
async function tellWithdrawalAsked(stripe, db, row, payout) {
  try {
    let to = row.destination_label ?? null;
    // Where it went, kept on the row for every member's list (they cannot
    // read the Stripe account's methods), in the list's own words.
    if (!to) {
      const destination = typeof payout?.destination === "string" ? payout.destination : payout?.destination?.id;
      const method = destination
        ? await stripe.accounts.retrieveExternalAccount(row.stripe_account_id, destination).catch(() => null) : null;
      if (method?.last4) {
        to = `${method.object === "card" ? "Debit card" : "Bank account"} ending in ${method.last4}`;
        await update(db, row, { destination_label: to, destination_bank: method.bank_name ?? method.brand ?? null })
          .catch((failure) => console.error("stripe-withdrawals destination", row.id, failure?.message));
      }
    }
    const { data: already } = await db.from("notifications").select("id")
      .eq("kind", "withdrawal").eq("subject_type", "withdrawal").eq("subject_id", row.id).limit(1);
    if (already?.length) return;
    const money = (minor, currency) => new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(Number(minor) / 100);
    const asked = row.usd_cents != null ? money(row.usd_cents, "usd") : money(row.amount_minor, row.currency);
    to = to ?? "your bank account";
    await db.from("notifications").insert({
      org_id: row.org_id, kind: "withdrawal", subject_type: "withdrawal", subject_id: row.id,
      title: `Withdrawal of ${asked} requested`, body: `To ${to}.`,
      data: { amount_cents: row.usd_cents ?? row.amount_minor, currency: row.usd_cents != null ? "USD" : row.currency.toUpperCase(),
        receives_minor: payout?.amount ?? null, receives_currency: payout?.currency?.toUpperCase() ?? null },
    });
  } catch (failure) {
    console.error("stripe-withdrawals notice", row.id, failure?.message);
  }
}

/** "You can withdraw up to …" when the balance is now under the amount, else null. Never throws: it only chooses words. */
async function balanceShortSentence(stripe, db, row, currency, amount) {
  try {
    const available = await withdrawableNow(stripe, db, row, currency);
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
    // Stripe keeps no description on a reversal (it accepts one and drops
    // it): the metadata is what marks this as a withdrawal fee.
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
async function giveBack(stripe, db, row, usdAmount, reason, { takeBack = false } = {}) {
  let transferId = null;
  let cause = null;
  // The one balance, refused before any payout existed, by the call holding
  // the lease (takeBack): the owed parts this withdrawal transferred go back
  // to TSC whole, the fee they paid included (it was reversed from them), so
  // only a fee taken from money already in the account is given back. A
  // payout that failed after it was made (returnFeeOnFailedPayout) gives the
  // fee back only: its money is back in the factory's Stripe account, may
  // already be withdrawn again, and stays Stripe money.
  if (takeBack && row.usd_cents != null) {
    const back = await reverseSentTakes(stripe, db, row);
    usdAmount = Math.max(0, usdAmount - back.feeFromTakes);
    if (back.failed) cause = "reversal_failed";
  }
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
  await returnHeldTakes(db, row);
  await update(db, row, { state: usdAmount > 0 ? "fee_returned" : "refused", fee_return_transfer_id: transferId, reason,
    ...(cause ? { refusal_cause: cause } : {}) });
}

/**
 * Take back what this withdrawal transferred from owed steps (each part's
 * transfer, less what its fee reversal already took back), and return the
 * parts to the balance. A part Stripe will not reverse stays sent and the
 * row is listed for staff. Returns { feeFromTakes, failed } in US cents:
 * the fee that came out of these transfers.
 */
async function reverseSentTakes(stripe, db, row, { createNew = true } = {}) {
  const sent = (await readTakes(db, row)).filter((take) => take.status === "sent" && take.stripe_transfer_id);
  let feeFromTakes = 0;
  let failed = false;
  for (const take of sent) {
    try {
      let feeHere = 0;
      let mine = null;
      for await (const reversal of stripe.transfers.listReversals(take.stripe_transfer_id, { limit: 100 })) {
        if (reversal.metadata?.stripe_withdrawal_id === row.id) feeHere += Number(reversal.amount);
        if (reversal.metadata?.take_reversal === take.id) mine = reversal;
      }
      const want = Number(take.amount_cents) - feeHere;
      // Only finishing what was done (staff's "Check again"): a part with no
      // reversal yet stays sent; its money is in the factory's account.
      // (A part whose whole transfer its fee reversal took has nothing left to
      // reverse: it is returned either way.)
      if (!mine && want > 0 && !createNew) continue;
      if (!mine && want > 0) {
        mine = await stripe.transfers.createReversal(take.stripe_transfer_id, {
          amount: want, metadata: { take_reversal: take.id, take_withdrawal_id: row.id },
        }, { idempotencyKey: `swx-${take.id}` });
      }
      await call(db, "return_sent_take", { target_take: take.id, lease: row.lease_until ?? null, reversal: mine?.id ?? `fee-${row.id}` });
      feeFromTakes += feeHere;
    } catch (failure) {
      failed = true;
      console.error("stripe-withdrawals take back", take.id, failure?.message);
    }
  }
  if (failed) await update(db, row, { refusal_cause: "reversal_failed" }).catch(() => null);
  return { feeFromTakes, failed };
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
      await settleOne(stripe, db, row);
    } finally {
      await releaseLease(db, row);
    }
  }
}

/**
 * One withdrawal this call holds the lease on, left half-way: the one
 * balance's claim or transfers are carried on; otherwise a payout that went
 * is recorded, else whatever fee was taken goes back.
 */
async function settleOne(stripe, db, row) {
  // The one balance, stopped while claiming or transferring owed money:
  // carried on, since the owner asked for it (a refusal is recorded on
  // the row and its claims go back to the balance).
  if (row.usd_cents != null && row.state === "claimed" && row.fee_cents == null) {
    const { data: account } = await db.from("stripe_connect_accounts")
      .select("country, transfers_active").eq("org_id", row.org_id).maybeSingle();
    try {
      await carryOut({ stripe, db, row, country: account?.country ?? "", requestId: row.request_id,
        destination: row.destination ?? null, transfersActive: Boolean(account?.transfers_active) });
    } catch (failure) {
      // Stripe or the database did not answer: tried again on the next
      // read or withdrawal once this lease lapses. Never blocks this one.
      if (!(failure instanceof PayoutMethodRefusal)) console.error("stripe-withdrawals resume", row.id, failure?.message);
    }
    return;
  }
  // Reversals Stripe made for the fee, recorded or not.
  const feeTaken = async () => {
    let taken = 0;
    for (const item of row.reversals ?? []) {
      for await (const reversal of stripe.transfers.listReversals(item.transfer, { limit: 100 })) {
        if (reversal.metadata?.stripe_withdrawal_id === row.id) taken += Number(reversal.amount);
      }
    }
    return taken;
  };
  const payout = await findPayout(stripe, row);
  if (payout) {
    // A payout was made: recorded, whatever became of it.
    const plan = row.reversals ?? [];
    await update(db, row, {
      state: "paid_out", payout_id: payout.id, payout_minor: payout.amount,
      fee_local_minor: row.fee_local_minor ?? Number(row.amount_minor) - Number(payout.amount),
      reversals: plan,
    });
    await recordPayoutMade(db, row, payout);
    if (!["failed", "canceled"].includes(payout.status)) {
      await tellWithdrawalAsked(stripe, db, row, payout);
      return;
    }
    // It failed or was cancelled after it was made: its money is back in the
    // factory's Stripe account and stays Stripe money. The fee only goes back.
    await giveBack(stripe, db, row, await feeTaken(), null);
    return;
  }
  // No payout exists at all, and this call holds the lease: refused before
  // any payout, so the owed parts go back too.
  await giveBack(stripe, db, row, await feeTaken(), null, { takeBack: true });
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

/**
 * The same, without the webhook: this account's paid-out withdrawals of the
 * last `days` are looked up by payout id, and a payout that failed or was
 * cancelled gives its fee back (returnFeeOnFailedPayout, so once, whichever
 * arrives first). A missed or unsubscribed payout.failed would otherwise keep
 * the fee for good. Never holds the caller up for more than `budgetMs`, and
 * never throws: a lookup that is slow or fails is tried again on the next
 * balance read or withdrawal. Returns how many fees went back in time.
 */
export async function returnFeesOnFailedPayouts({ stripe, db, accountId, days = 14, limit = 10, budgetMs = 2000 }) {
  const work = (async () => {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const { data, error } = await db.from("stripe_withdrawals").select("payout_id")
      .eq("stripe_account_id", accountId).eq("state", "paid_out").gte("created_at", since)
      .order("created_at", { ascending: false }).limit(limit);
    if (error) return 0;
    const returned = await Promise.all((data ?? []).filter((row) => row.payout_id).map(async ({ payout_id: id }) => {
      try {
        const payout = await stripe.payouts.retrieve(id, {}, { stripeAccount: accountId });
        return await returnFeeOnFailedPayout({ stripe, db, payout });
      } catch {
        return false;
      }
    }));
    return returned.filter(Boolean).length;
  })().catch(() => 0);
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(0), budgetMs); });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}
