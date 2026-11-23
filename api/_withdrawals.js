import { PayoutFailure, withoutSecrets } from "./_payout-provider.js";
import { ADAPTERS } from "./_withdrawal-adapters.js";
import { checkCharge, stripeFrom } from "./_stripe.js";

/**
 * The withdrawal core: staff approve a factory's request, and its adapter pays
 * it (api/_withdrawal-adapters.js). The database owns who may do what and the
 * balance (claim_withdrawal re-checks both); only this server, with the
 * service key, records what a provider said (record_withdrawal).
 *
 *   approve   claim (re-checks the balance and the account) -> TSC's provider
 *             balance >= amount -> quote with the fee inside the amount -> pay
 *             with the withdrawal's key -> read back. Nothing sent, for a
 *             certain reason (short balance, refused): back to waiting, with
 *             the sentence. Unsure (timeout): stays "paying"; pressing again
 *             resumes the same key, so it cannot pay twice.
 *   preview   the same checks and quote, sending nothing: what staff confirm.
 *   sync      read back every withdrawal being paid, and those paid in the
 *             last RETURN_WINDOW_DAYS (a provider may return one later): the
 *             ones read longest ago first, at most PAID_READS_PER_SYNC a
 *             sync, none read in the last READ_AGAIN_HOURS.
 *
 * Declining is a plain RPC (decline_withdrawal): no provider is involved.
 */

const DB_WORDS = {
  payout_in_progress: "This is already being paid. Wait a moment, then press Refresh.",
  withdrawal_not_waiting: "This withdrawal isn't waiting any more. Reload the board.",
  withdrawal_over_balance: "The factory's balance no longer covers this. Decline it with a reason.",
  payout_changed: "This factory changed where it is paid since it asked. Decline it, so it can ask again.",
  payout_own_company: "You belong to this company, so someone else on the staff must pay it.",
  reveal_brand_side: "Your company has an order with this factory, so someone else on the staff must pay it.",
  // Money refunded after the factory withdrew it, more than its other earnings
  // cover (20261121210000); the amount comes in the error's detail.
  withdrawal_owes_tsc: (error) => owesTscSentence(error.details ?? error.detail),
};
/** Staff's words when a withdrawal waits on money the factory owes TSC (also the board's row). */
export const owesTscSentence = (amount) => `The factory owes TSC ${amount || "money"} (To recover, in Needs checking). This withdrawal waits until the factory's earnings cover it. You can still decline it.`;
const refusalFrom = (error) => {
  const words = DB_WORDS[error.hint];
  return new PayoutFailure("database", (typeof words === "function" ? words(error) : words) ?? "That couldn't be done. Reload the page and try again.", { detail: error.hint ?? error.code ?? null });
};

const log = (where, failure, context = {}) => console.error(`${where}:`, withoutSecrets(failure?.message), {
  kind: failure?.kind ?? null, status: failure?.status ?? null, detail: withoutSecrets(failure?.detail ?? ""), ...context,
});

const money = (minor, currency) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(minor) / 100);

async function record(db, id, outcome, patch = {}) {
  const { data, error } = await db.rpc("record_withdrawal", { target_withdrawal: id, outcome, ...patch });
  if (error) {
    log("record_withdrawal", error, { id, outcome });
    throw new PayoutFailure("record_failed", "The provider answered but we couldn't record it. Press Refresh.");
  }
  return data;
}

/** The one fee rule. import(): Vercel compiles api/ to CommonJS, which can't require() a .mjs. */
let withdrawalFee = null;
async function loadFeeRule() {
  if (!withdrawalFee) ({ withdrawalFee } = await import("../src/shared/withdrawal-fees.mjs"));
  return withdrawalFee;
}

/**
 * What the factory's bank statement and the provider's records show. Wise caps a
 * transfer's reference per currency and route (sandbox transfer-requirements:
 * GBP 18, CNY 35, HKD 50, EUR 140; letters, digits and hyphens are the only
 * characters every route takes), so it is held to 10 of those, the length of
 * an order number (TSC-000123), which the per-step payouts send. Traceable: the
 * hex is the start of the withdrawal's id.
 */
export const REFERENCE_MAX = 10;
export const withdrawalReference = (id) => `TSCW${String(id ?? "").replace(/[^0-9a-f]/gi, "").slice(0, 6).toUpperCase()}`;

function contextFrom(claim, { caller, db, cnyConfirmed, country = "" }) {
  return {
    amountCents: Number(claim.amount_cents),
    currency: claim.currency,
    key: claim.key,
    reference: withdrawalReference(claim.withdrawal_id),
    account: { id: claim.account_id, paypalEmail: claim.paypal_email, wiseRecipientId: claim.wise_recipient_id, wiseCurrency: claim.wise_currency },
    caller, db, cnyConfirmed: Boolean(cnyConfirmed),
    country,
    feeFor: ({ provider, quotedFeeCents }) => withdrawalFee({ provider, amountCents: Number(claim.amount_cents), currency: claim.currency, country, quotedFeeCents }),
  };
}

/** Is the fee inside the amount, and does the factory receive something? The one rule, checked on the server. */
function checkQuote(adapter, ctx, quote) {
  const rule = withdrawalFee({ provider: adapter.provider, amountCents: ctx.amountCents, currency: ctx.currency, country: ctx.country, quotedFeeCents: quote.feeCents });
  if (rule.refused) throw new PayoutFailure("too_small", rule.refused);
  if (quote.leavesCents != null && quote.leavesCents > ctx.amountCents) {
    throw new PayoutFailure("fee_on_top", `${adapter.label} would take more than the amount from TSC's balance. Nothing was sent.`);
  }
  return { ...quote, feeCents: rule.feeCents };
}

/** The factory's country: PayPal's fee is domestic or international by it. Unknown reads as abroad (the larger fee). */
async function factoryCountry(db, orgId) {
  const { data } = await db.from("factory_profiles").select("country_code").eq("org_id", orgId).maybeSingle();
  return data?.country_code ?? "";
}

async function providerShort(adapter, client, ctx) {
  const balance = await adapter.balance(client, ctx.currency);
  if (balance == null) return null;
  return balance < ctx.amountCents ? ctx.amountCents - balance : 0;
}

/**
 * claim_withdrawal's payout_changed check, on the board row: the account it
 * pays is gone, its payee details changed since the factory asked, or it is
 * now paid another way (withdrawal_provider_for). payee_changed_at, not
 * details_changed_at: becoming the default does not change where a withdrawal
 * goes (20261117360000). Timestamps compare as the database wrote them.
 */
export function payoutChangedSinceAsked(row) {
  const account = row.account;
  if (!row.account_id || !account) return true;
  const provider = account.method === "paypal" ? "paypal"
    : account.method === "bank" ? (account.wise_recipient_type ? "wise" : "bank") : null;
  return (account.payee_changed_at ?? null) !== (row.paid_to_changed_at ?? null) || provider !== row.provider;
}

/** Staff's preview: the same claim checks as approve, through a read of the board row, and the quote. Sends nothing. */
export async function previewWithdrawal({ adapter, client, caller, db, row, cnyConfirmed }) {
  if (payoutChangedSinceAsked(row)) throw refusalFrom({ hint: "payout_changed" });
  await loadFeeRule();
  const ctx = contextFrom({
    withdrawal_id: row.id, amount_cents: row.amount_cents, currency: row.currency, key: null,
    account_id: row.account_id, paypal_email: row.paypal_email, wise_recipient_id: row.wise_recipient_id, wise_currency: row.wise_currency,
  }, { caller, db, cnyConfirmed, country: await factoryCountry(db, row.org_id) });
  const balance = await adapter.balance(client, ctx.currency);
  const shortBy = balance == null ? null : Math.max(0, ctx.amountCents - balance);
  if (shortBy) return { shortByCents: shortBy, balanceCents: balance };
  const quote = checkQuote(adapter, ctx, await adapter.quote(client, ctx));
  return { shortByCents: shortBy, balanceCents: balance, feeCents: quote.feeCents, receivesMinor: quote.receivesMinor, receivesCurrency: quote.receivesCurrency, leavesCents: quote.leavesCents };
}

/**
 * The factory's own preview before it asks: the exact fee and what arrives.
 * Read-only: no claim, no lease, nothing created at the provider. Only an
 * owner of the company, for one of its own accounts (checked by the route).
 */
export async function factoryQuote({ adapter, client, db, orgId, account, amountCents }) {
  await loadFeeRule();
  const ctx = contextFrom({
    withdrawal_id: null, amount_cents: amountCents, currency: "USD", key: null,
    account_id: account.id, paypal_email: account.paypal_email, wise_recipient_id: account.wise_recipient_id, wise_currency: account.wise_currency,
  }, { caller: null, db, cnyConfirmed: false, country: await factoryCountry(db, orgId) });
  const asked = await adapter.factoryQuote(client, ctx);
  if (!asked) return { exact: false };
  const quote = checkQuote(adapter, ctx, asked);
  return {
    exact: !asked.estimate,
    estimate: Boolean(asked.estimate), feeCents: quote.feeCents, receivesMinor: quote.receivesMinor, receivesCurrency: quote.receivesCurrency };
}

/** _provider-payouts.js's sentences for the same check on a step paid by itself. */
const CHARGE_UNCHECKED = "We couldn't check the brand's payment just now, so nothing was sent. Try again in a minute.";
const CHARGE_DISPUTED = "The brand disputed this charge, so nothing was sent.";
const CHARGE_REFUNDED = "The brand's payment was refunded, so there is nothing to pay out. Reload the board.";

/**
 * Owed steps this withdrawal took are paid from TSC's own provider balance,
 * so each brand charge behind them is checked in Stripe first: a refund or a
 * dispute reaches us by a webhook that can be late or lost. A refused one is
 * recorded (the database then refuses to approve the withdrawal, and staff
 * decline it, which returns its parts to the balance) and nothing is sent.
 */
export async function refuseIfTakenChargesReturned({ db, id, build = stripeFrom }) {
  let stripe;
  try {
    stripe = build();
  } catch (failure) {
    log("charge check", failure, { id });
    throw new PayoutFailure("charge_unchecked", CHARGE_UNCHECKED);
  }
  // No Stripe on this site: no card charge to check (as the per-step check).
  if (!stripe) return;
  const { data: takes, error } = await db.from("payment_takes")
    .select("payment_id, order_payments (stripe_charge_id)").eq("factory_withdrawal_id", id).eq("status", "held");
  if (error) throw new PayoutFailure("database", CHARGE_UNCHECKED);
  const charges = (takes ?? []).map((take) => ({ paymentId: take.payment_id, chargeId: take.order_payments?.stripe_charge_id }))
    .filter((item) => item.chargeId);
  let refunded = false;
  for (const { paymentId, chargeId } of charges) {
    // A refund (or a lost dispute) is recorded at its amount; this
    // withdrawal stops only if part of what it holds is no longer the
    // factory's (asked below, once every charge is recorded). Not read or not
    // recorded: nothing is sent.
    let checked;
    try {
      checked = await checkCharge({ stripe, db, paymentId, charge: chargeId });
    } catch (failure) {
      log("charge check", failure, { id, paymentId });
      throw new PayoutFailure("charge_unchecked", CHARGE_UNCHECKED);
    }
    if (checked.dispute === "open") throw new PayoutFailure("charge_disputed", CHARGE_DISPUTED);
    if (checked.refunded || checked.dispute === "lost") refunded = true;
  }
  if (refunded) {
    const { data: short, error: shortError } = await db.rpc("withdrawal_refunded_part", { target_withdrawal: id });
    if (shortError || Number(short) > 0) throw new PayoutFailure("charge_refunded", CHARGE_REFUNDED);
  }
}

export async function approveWithdrawal({ adapter, client, caller, db, id, cnyConfirmed, stripeBuild = stripeFrom }) {
  await loadFeeRule();
  const claimed = await caller.rpc("claim_withdrawal", { target_withdrawal: id });
  if (claimed.error) throw refusalFrom(claimed.error);
  const claim = claimed.data;
  if (claim.provider !== adapter.provider) throw new PayoutFailure("database", "This withdrawal is paid another way. Reload the board.");
  const ctx = contextFrom(claim, { caller, db, cnyConfirmed, country: await factoryCountry(db, claim.org_id) });
  let ref = claim.provider_ref ?? null;

  try {
    if (!ref) {
      await refuseIfTakenChargesReturned({ db, id, build: stripeBuild });
      const short = await providerShort(adapter, client, ctx);
      if (short) {
        const sentence = `${adapter.label} balance is short by ${money(short, ctx.currency)}. Top up TSC's ${adapter.label} balance, then approve again.`;
        await record(db, id, "requeue", { sentence });
        return { done: "short_balance", sentence };
      }
      const quote = checkQuote(adapter, ctx, await adapter.quote(client, ctx));
      // The fee is kept on the withdrawal before any money moves: the board,
      // the factory's page and its bell read this one figure.
      await record(db, id, "sent", { fee: quote.feeCents, receives: quote.receivesMinor, receives_in: quote.receivesCurrency });
      // What leaves TSC's balance for it (Wise: the fee inside the amount): what
      // the provider kept of a returned one is measured against it. Not kept: it
      // is taken as the amount (record_withdrawal_returned).
      if (Number.isFinite(quote.leavesCents) && quote.leavesCents > 0) {
        const kept = await db.from("factory_withdrawals").update({ leaves_cents: Math.round(quote.leavesCents) }).eq("id", id);
        if (kept?.error) log("withdrawal leaves_cents", kept.error, { id });
      }
      const paid = await adapter.pay(client, ctx, quote);
      ref = paid.ref;
      await record(db, id, "sent", { ref, sentence: "Sent. Waiting for the provider to confirm." });
    }
    return { done: await readBack({ adapter, client, db, id, ref }) };
  } catch (failure) {
    const known = failure instanceof PayoutFailure;
    if (known && failure.unsure) {
      // The provider may have it: stays "paying", and the same key finds it.
      await db.rpc("record_withdrawal", { target_withdrawal: id, outcome: "sent", sentence: failure.message });
      throw failure;
    }
    if (!ref) {
      // A certain "no" before the provider had it: nothing was sent.
      const sentence = known ? failure.message : `${adapter.label} refused this. Nothing was sent.`;
      await db.rpc("record_withdrawal", { target_withdrawal: id, outcome: "requeue", sentence });
      throw known ? failure : new PayoutFailure("refused", sentence);
    }
    throw failure;
  }
}

/**
 * Why a withdrawal failed, for staff. Not the per-step payout's sentences: those
 * end "then pay again", and a failed withdrawal has no Pay again. Its amount is
 * back in the factory's balance and the factory asks again (record_withdrawal).
 */
const WITHDRAWAL_FAILED = {
  paypal: {
    FAILED: "PayPal couldn't pay this: check the factory's PayPal address.",
    RETURNED: "PayPal returned this to TSC, so nothing arrived: check the factory's PayPal address.",
    BLOCKED: "PayPal blocked this payment: check why in PayPal.",
    REFUNDED: "This payment was refunded to TSC: check why in PayPal.",
    REVERSED: "This payment was reversed: check why in PayPal.",
  },
  wise: {
    bounced_back: "The factory's bank returned this transfer: check the bank details with the factory.",
    funds_refunded: "Wise refunded this transfer to TSC's balance: check why in Wise.",
    charged_back: "This transfer was charged back: check why in Wise.",
  },
};
export const BACK_IN_BALANCE = "The amount is back in the factory's balance, so it can withdraw again.";
export const withdrawalFailure = (adapter, raw) =>
  `${WITHDRAWAL_FAILED[adapter.provider]?.[raw] ?? `${adapter.label} did not deliver this.`} ${BACK_IN_BALANCE}`;

/**
 * Ask the provider, and record only its own answer. `wasPaid`: recorded paid
 * already (or recorded as come back), so only a return (failed or cancelled
 * since) is recorded. `returnedCents`: what a signed refund event says came
 * back (Wise's transfers#refund), in the withdrawal's currency.
 */
export async function readBack({ adapter, client, db, id, ref, wasPaid = false, returnedCents = null }) {
  const status = await adapter.status(client, ref);
  const ended = status.state === "failed" || status.state === "cancelled";
  // A transfer the provider does not say failed is not a return, whatever a
  // refund event says (a partial refund on a delivered transfer): left for staff.
  if (wasPaid && !ended) {
    if (Number.isFinite(returnedCents)) log("withdrawal refund on a transfer not returned", null, { id, state: status.raw });
    return "paid";
  }
  // What came back, when the provider says (in the withdrawal's currency):
  // Wise's transfers#refund (returnedCents), else the adapter's answer.
  const cameBack = Number.isFinite(returnedCents) ? returnedCents : status.returnedCents;
  if (ended) {
    const sentence = withdrawalFailure(adapter, status.raw);
    // Only what came back goes back to the balance, paid or still being sent
    // (PayPal returns an unclaimed payment after 30 days, less its fee). Not
    // said: the whole amount is taken as back. A figure stated after the
    // return was recorded corrects it (record_withdrawal_returned).
    if (Number.isFinite(cameBack)) {
      const { error } = await db.rpc("record_withdrawal_returned", { target_withdrawal: id, came_back: Math.round(cameBack), sentence });
      if (error) {
        log("record_withdrawal_returned", error, { id });
        throw new PayoutFailure("record_failed", "The provider answered but we couldn't record it. Press Refresh.");
      }
    } else {
      await record(db, id, "failed", { sentence });
    }
    return "failed";
  }
  if (status.state === "paid") {
    await record(db, id, "paid", { receives: status.arrivesMinor ?? null });
    return "paid";
  }
  if (status.waiting) await record(db, id, "sent", { sentence: status.waiting });
  return "sent";
}

/**
 * How long after it was paid a withdrawal is still read back: a provider can
 * return one later (PayPal returns an unclaimed payment after 30 days; a bank
 * bounces a Wise transfer days after it was sent).
 */
export const RETURN_WINDOW_DAYS = 35;
/**
 * Paid withdrawals are read back in turns, so every one in the window is read
 * whatever their number, and a sync never makes more than this many provider
 * calls for them: the ones read longest ago (or never) first, and none read in
 * the last READ_AGAIN_HOURS (factory_withdrawals.read_back_at). The provider's
 * webhook reads one back at once as well.
 */
export const PAID_READS_PER_SYNC = 50;
export const READ_AGAIN_HOURS = 6;

export async function syncWithdrawals({ adapter, client, db, now = Date.now() }) {
  const since = new Date(now - RETURN_WINDOW_DAYS * 86_400_000).toISOString();
  const readBefore = new Date(now - READ_AGAIN_HOURS * 3_600_000).toISOString();
  const [paying, paid] = await Promise.all([
    db.from("factory_withdrawals").select("id, provider_ref, status")
      .eq("provider", adapter.provider).eq("status", "paying").not("provider_ref", "is", null).limit(50),
    // Paid, and possibly returned since: the provider's answer is recorded (record_withdrawal).
    db.from("factory_withdrawals").select("id, provider_ref, status")
      .eq("provider", adapter.provider).eq("status", "paid").not("provider_ref", "is", null).gte("paid_at", since)
      .or(`read_back_at.is.null,read_back_at.lt.${readBefore}`)
      .order("read_back_at", { ascending: true, nullsFirst: true }).order("paid_at", { ascending: true })
      .limit(PAID_READS_PER_SYNC),
  ]);
  if (paying.error || paid.error) throw new PayoutFailure("database", "The board couldn't read its withdrawals. Reload the page.");
  const rows = [...(paying.data ?? []), ...(paid.data ?? [])];
  const answers = await Promise.allSettled(rows.map((row) => readBack({ adapter, client, db, id: row.id, ref: row.provider_ref, wasPaid: row.status === "paid" })));
  for (const a of answers.filter((x) => x.status === "rejected")) log("withdrawal sync", a.reason, { provider: adapter.provider });
  // Read: its turn comes again after the others (a failed read stays first).
  const read = rows.filter((row, i) => row.status === "paid" && answers[i].status === "fulfilled").map((row) => row.id);
  if (read.length > 0) {
    const stamped = await db.from("factory_withdrawals").update({ read_back_at: new Date(now).toISOString() }).in("id", read);
    if (stamped?.error) log("withdrawal sync", stamped.error, { provider: adapter.provider, step: "read_back_at" });
  }
  return { read: answers.filter((x) => x.status === "fulfilled").length };
}

/**
 * Staff's "Cancel payment" on a withdrawal its provider holds unclaimed
 * (PayPal: no account at the address). The provider decides, never this
 * server: it cancels only an item still unclaimed, and whatever it then says
 * is recorded by readBack, exactly as the 30 s read-back would record it. A
 * cancelled item reads RETURNED, which ends the withdrawal as any returned
 * one ends (record_withdrawal_returned: back in the balance, the factory told).
 * Two presses, or a press racing the read-back, record once: the database
 * does nothing for a withdrawal already ended.
 */
export const CANCEL_REFUSED = "PayPal wouldn't cancel this: it may have been claimed. Press Refresh.";
export async function cancelUnclaimedWithdrawal({ adapter, client, db, row }) {
  if (typeof adapter.cancelUnclaimed !== "function") throw new PayoutFailure("refused", "This withdrawal can't be cancelled here.");
  if (row.status !== "paying" || !row.provider_ref) throw refusalFrom({ hint: "withdrawal_not_waiting" });
  let refused = null;
  try {
    await adapter.cancelUnclaimed(client, row.provider_ref);
  } catch (failure) {
    // Unsure (a timeout): the provider may have cancelled it; the read below,
    // or the next one, says. Refused: nothing changed there.
    if (!(failure instanceof PayoutFailure)) throw failure;
    log("withdrawal cancel", failure, { id: row.id });
    refused = failure.unsure ? failure.message : CANCEL_REFUSED;
  }
  const done = await readBack({ adapter, client, db, id: row.id, ref: row.provider_ref });
  return done === "failed" ? { done } : { done, refused: refused ?? (done === "paid" ? CANCEL_REFUSED : null) };
}

export const adapterFor = (provider) => ADAPTERS[provider] ?? null;

/**
 * A provider's webhook about a withdrawal it is paying, or paid and has
 * returned since: read it back, so the factory sees Paid (or the amount back
 * in its balance) without staff opening the board. Null when the reference is not a withdrawal of this database's.
 */
export async function readBackWithdrawalRef({ provider, client, db, ref, refund = null }) {
  const adapter = adapterFor(provider);
  if (!adapter || !ref) return null;
  const { data: row, error } = await db.from("factory_withdrawals").select("id, status, provider_ref, currency, returned_at, failed_at")
    .eq("provider", provider).eq("provider_ref", String(ref)).maybeSingle();
  if (error) throw new PayoutFailure("database", "factory_withdrawals could not be read", { detail: error.code });
  if (!row) return null;
  // Paid, then returned by the provider (Wise bounced_back, funds_refunded,
  // charged_back; PayPal RETURNED, REFUNDED, REVERSED): read back too, so the
  // return is recorded (record_withdrawal gives the parts back to the balance).
  // A refund event states what came back: recorded for a row paid or being
  // sent, or one already recorded as come back (record_withdrawal_returned),
  // once the provider says the transfer failed (readBack).
  const returnedCents = typeof refund === "function" ? refund(row.currency) : null;
  const cameBack = row.status === "failed" && (row.returned_at || row.failed_at);
  if (Number.isFinite(returnedCents) && cameBack) {
    return readBack({ adapter, client, db, id: row.id, ref: row.provider_ref, wasPaid: true, returnedCents });
  }
  if (row.status !== "paying" && row.status !== "paid") return row.status;
  return readBack({ adapter, client, db, id: row.id, ref: row.provider_ref, wasPaid: row.status === "paid", returnedCents });
}
