import { PayoutFailure, withoutSecrets } from "./_payout-provider.js";
import { ADAPTERS } from "./_withdrawal-adapters.js";
import { applyChargeRefund, applyDispute, stripeFrom } from "./_stripe.js";

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
 *   sync      read back every withdrawal being paid.
 *
 * Declining and "mark paid by bank" are plain RPCs (decline_withdrawal,
 * mark_withdrawal_paid_by_bank): no provider is involved.
 */

const DB_WORDS = {
  payout_in_progress: "This is already being paid. Wait a moment, then press Refresh.",
  withdrawal_not_waiting: "This withdrawal isn't waiting any more. Reload the board.",
  withdrawal_over_balance: "The factory's balance no longer covers this. Decline it with a reason.",
  payout_changed: "This factory changed where it is paid since it asked. Decline it, so it can ask again.",
  payout_own_company: "You belong to this company, so someone else on the staff must pay it.",
  reveal_brand_side: "Your company has an order with this factory, so someone else on the staff must pay it.",
};
const refusalFrom = (error) => new PayoutFailure("database", DB_WORDS[error.hint] ?? "That couldn't be done. Reload the page and try again.", { detail: error.hint ?? error.code ?? null });

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
const CHARGE_UNCHECKED = "We couldn't check the brand's payment just now, so nothing was sent. Press again in a minute.";
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
    let charge;
    let dispute = null;
    try {
      charge = await stripe.charges.retrieve(chargeId);
      if (charge.disputed) {
        const disputeId = typeof charge.dispute === "string" ? charge.dispute : charge.dispute?.id;
        dispute = disputeId ? await stripe.disputes.retrieve(disputeId) : { status: "needs_response" };
      }
    } catch (failure) {
      log("charge check", failure, { id, paymentId });
      throw new PayoutFailure("charge_unchecked", CHARGE_UNCHECKED);
    }
    // A refund (or a lost dispute) is recorded at its amount; this
    // withdrawal stops only if part of what it holds is no longer the
    // factory's (asked below, once every charge is recorded).
    if (Number(charge.amount_refunded) > 0) {
      await applyChargeRefund({ stripe, db, charge }).catch((failure) => log("charge refund", failure, { id, paymentId }));
      refunded = true;
    }
    if (dispute?.status === "lost") {
      await applyDispute({ db, paymentId, dispute }).catch((failure) => log("record dispute lost", failure, { id, paymentId }));
      refunded = true;
    } else if (dispute && !["won", "warning_closed"].includes(dispute.status)) {
      const recorded = await db.rpc("record_payment_disputed", { target_payment: paymentId, disputed: true });
      if (recorded.error) log("record disputed", recorded.error, { id, paymentId });
      throw new PayoutFailure("charge_disputed", CHARGE_DISPUTED);
    }
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

/** Ask the provider, and record only its own answer. */
export async function readBack({ adapter, client, db, id, ref }) {
  const status = await adapter.status(client, ref);
  if (status.state === "paid") {
    await record(db, id, "paid", { receives: status.arrivesMinor ?? null });
    return "paid";
  }
  if (status.state === "failed" || status.state === "cancelled") {
    await record(db, id, "failed", { sentence: withdrawalFailure(adapter, status.raw) });
    return "failed";
  }
  if (status.waiting) await record(db, id, "sent", { sentence: status.waiting });
  return "sent";
}

export async function syncWithdrawals({ adapter, client, db }) {
  const { data: rows, error } = await db.from("factory_withdrawals").select("id, provider_ref")
    .eq("provider", adapter.provider).eq("status", "paying").not("provider_ref", "is", null).limit(50);
  if (error) throw new PayoutFailure("database", "The board couldn't read its withdrawals. Reload the page.");
  const answers = await Promise.allSettled((rows ?? []).map((row) => readBack({ adapter, client, db, id: row.id, ref: row.provider_ref })));
  for (const a of answers.filter((x) => x.status === "rejected")) log("withdrawal sync", a.reason, { provider: adapter.provider });
  return { read: answers.filter((x) => x.status === "fulfilled").length };
}

export const adapterFor = (provider) => ADAPTERS[provider] ?? null;

/**
 * A provider's webhook about a withdrawal it is paying: read it back, so the
 * factory sees Paid (or the amount back in its balance) without staff opening
 * the board. Null when the reference is not a withdrawal of this database's.
 */
export async function readBackWithdrawalRef({ provider, client, db, ref }) {
  const adapter = adapterFor(provider);
  if (!adapter || !ref) return null;
  const { data: row, error } = await db.from("factory_withdrawals").select("id, status, provider_ref")
    .eq("provider", provider).eq("provider_ref", String(ref)).maybeSingle();
  if (error) throw new PayoutFailure("database", "factory_withdrawals could not be read", { detail: error.code });
  if (!row) return null;
  if (row.status !== "paying") return row.status;
  return readBack({ adapter, client, db, id: row.id, ref: row.provider_ref });
}
