import { PayoutFailure, withoutSecrets } from "./_payout-provider.js";
import { ADAPTERS } from "./_withdrawal-adapters.js";

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

function contextFrom(claim, { caller, db, cnyConfirmed, country = "" }) {
  return {
    amountCents: Number(claim.amount_cents),
    currency: claim.currency,
    key: claim.key,
    reference: `TSC withdrawal ${String(claim.withdrawal_id).slice(0, 8)}`,
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

/** Staff's preview: the same claim checks as approve, through a read of the board row, and the quote. Sends nothing. */
export async function previewWithdrawal({ adapter, client, caller, db, row, cnyConfirmed }) {
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

export async function approveWithdrawal({ adapter, client, caller, db, id, cnyConfirmed }) {
  await loadFeeRule();
  const claimed = await caller.rpc("claim_withdrawal", { target_withdrawal: id });
  if (claimed.error) throw refusalFrom(claimed.error);
  const claim = claimed.data;
  if (claim.provider !== adapter.provider) throw new PayoutFailure("database", "This withdrawal is paid another way. Reload the board.");
  const ctx = contextFrom(claim, { caller, db, cnyConfirmed, country: await factoryCountry(db, claim.org_id) });
  let ref = claim.provider_ref ?? null;

  try {
    if (!ref) {
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

/** Ask the provider, and record only its own answer. */
export async function readBack({ adapter, client, db, id, ref }) {
  const status = await adapter.status(client, ref);
  if (status.state === "paid") {
    await record(db, id, "paid", { receives: status.arrivesMinor ?? null });
    return "paid";
  }
  if (status.state === "failed" || status.state === "cancelled") {
    await record(db, id, "failed", { sentence: status.failure ?? `${adapter.label} did not deliver this.` });
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
