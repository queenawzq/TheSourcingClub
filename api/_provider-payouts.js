import { ensureWiseRecipient } from "./_wise-recipient.js";
import { ensureTazapayBeneficiary } from "./_tazapay-beneficiary.js";
import { INVOICE_BUCKET, invoicePath, invoicePdf } from "./_tazapay-invoice.js";
import { PayoutFailure, isFieldKey, withoutSecrets } from "./_payout-provider.js";
import { CANT_PAY_FROM_BALANCE } from "./_wise.js";
import { applyChargeRefund, callerClient, jsonBody, reply, serviceClient, stripeFrom, tokenRefused } from "./_stripe.js";

/** The one source of the payout fee. A .mjs, so loaded with import(): a static one stops the function starting on Vercel. */
const feeFor = async (args) => (await import("../src/shared/withdrawal-fees.mjs")).withdrawalFee(args);

/**
 * Pay with Wise, Pay with PayPal and Pay with Tazapay, one shape behind the three routes.
 *
 *   preview   the fee, what the factory receives (and for Wise what arrives, and the
 *             balance), before anyone commits.
 *
 * The factory pays the provider's fee (src/shared/withdrawal-fees.mjs): TSC's
 * balance goes down by the payment's amount, and the factory receives
 * amount − fee. A payment no bigger than its fee is refused, nothing sent.
 *   pay       claim, call the provider with the attempt's key, read back. Pressing
 *             again resumes the same attempt with the same key.
 *   cancel    take back a transfer nobody funded, or a PayPal payment nobody claimed.
 *   sync      read back everything that can still change. The board does this while
 *             open; with nobody watching, Wise's and PayPal's webhooks
 *             (api/wise-webhook.js, api/paypal-webhook.js) and the daily sweep
 *             (api/payout-sync.js) do the same read. Previews sit behind Vercel's
 *             sign-in, where no webhook can reach: there the sweep and the board do it.
 *   tell      Wise refused the details, at the recipient or later: the factory is told.
 *
 * Whether someone may do this is the database's call, as the caller. Whether the
 * money went is only ever written with the server's key, from what the provider said.
 *
 * Never a raw provider failure in a response: it goes to the log with keys removed.
 */

const STAFF_ONLY = "This is limited to platform staff.";
export const FUND_IN_WISE = "Transfer created. Fund it in Wise.";
export const CHECK_BANK = "Check your bank details";
export const CHECK_PAYPAL = "Check your PayPal address";
const STILL_OPEN = "This payment is still open, so the factory wasn't told. Press again to see where it is.";

/** How long to give Wise's status to catch up with a payment it just took. */
export let FUND_SETTLE_MS = 1500;
export const setFundSettleMs = (ms) => { FUND_SETTLE_MS = ms; };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Which details Wise refused, in our words: the factory reads these, and Wise's
 * own sentence stays on the board. From Wise's field keys when it named them,
 * else its sentence. A refusal naming none asks for the lot.
 */
const DETAIL_WORDS = [
  [/swift|\bbic\b/i, "SWIFT code"],
  [/iban|account ?number/i, "account number"],
  [/holder|account ?name|full ?name|legal ?name/i, "account holder's name"],
  [/address|city|post ?code|postal|state/i, "address"],
  [/bank ?name|branch/i, "bank name"],
];
const wordFor = (text) => DETAIL_WORDS.find(([pattern]) => pattern.test(text ?? ""))?.[1];
export function checkWords(sentence, fields = []) {
  const named = [...new Set((fields ?? []).map(wordFor).filter(Boolean))];
  const details = named.length ? named : [wordFor(sentence)].filter(Boolean);
  if (!details.length) return CHECK_BANK;
  return `Check your ${details.length > 1 ? `${details.slice(0, -1).join(", ")} and ${details.at(-1)}` : details[0]}`;
}

const DB_WORDS = {
  payout_in_progress: "This is already being paid. Wait a moment, then press Refresh.",
  payout_already_released: "This payout was already paid. Reload the board.",
  payout_not_owed: "This payment isn't approved for payout. Reload the board.",
  payout_stripe: "Stripe pays this factory. Use Retry payout.",
  payout_changed: "This factory changed where it is paid. Reload the page and check the details.",
  payout_own_company: "You belong to this company, so someone else on the staff must pay it.",
  reveal_brand_side: "Your company has an order with this factory, so someone else on the staff must pay it.",
  wise_not_set_up: "This factory has no bank account Wise can pay. Mark it paid by bank instead.",
  paypal_not_set_up: "This factory has no PayPal address. Ask it to add one on its Payments page.",
  cny_statement: "Confirm the contract and invoice statement first.",
  payout_not_processing: "Nothing is under way for this payment. Reload the board.",
  tazapay_not_set_up: "Tazapay pays bank accounts in mainland China and Hong Kong only. Use another way to pay this one.",
  tazapay_details_missing: "This bank account is missing details Tazapay needs. Ask the factory to complete it on its Payments page.",
  tazapay_not_the_company: "The registration number on this bank account isn't the company's own, so Tazapay won't pay it. Ask the factory to check it.",
  no_number: "No full account number is on file. Ask the factory to add it on its Payments page.",
};

const refusalFrom = (error) => new PayoutFailure("database", DB_WORDS[error.hint] ?? "That couldn't be done. Reload the page and try again.", { detail: error.hint ?? error.code ?? null });

const log = (where, failure, context = {}) => console.error(`${where}:`, withoutSecrets(failure?.message), {
  kind: failure?.kind ?? null, status: failure?.status ?? null, detail: withoutSecrets(failure?.detail ?? ""), ...context,
});

async function must(call) {
  const { data, error } = await call;
  if (error) throw refusalFrom(error);
  return data;
}

async function record(db, payoutId, patch) {
  const { error } = await db.rpc("record_provider_attempt", { target_payout: payoutId, ...patch });
  if (error) log("record_provider_attempt", error, { payoutId });
}

/** The fee the factory pays on this payment, kept with it: the board, its row and its bell read this one figure. */
async function recordFee(db, paymentId, feeCents) {
  const { error } = await db.rpc("record_payout_fee", { target_payment: paymentId, fee: feeCents });
  if (error) {
    log("record_payout_fee", error, { paymentId });
    throw new PayoutFailure("record_failed", "We couldn't record the fee, so nothing was sent. Press again.");
  }
}

/** The factory's country, for PayPal's domestic or international fee cap. */
export async function factoryCountry(db, paymentId) {
  const { data, error } = await db.from("order_payments").select("production_orders (factory_org_id)").eq("id", paymentId).maybeSingle();
  const orgId = data?.production_orders?.factory_org_id;
  if (error || !orgId) return "";
  const profile = await db.from("factory_profiles").select("country_code").eq("org_id", orgId).maybeSingle();
  return profile.data?.country_code ?? "";
}

async function finish(db, payoutId, outcome, patch = {}) {
  const { error } = await db.rpc("finish_provider_payout", { target_payout: payoutId, outcome, ...patch });
  if (error) {
    log("finish_provider_payout", error, { payoutId, outcome });
    throw new PayoutFailure("record_failed", "The provider answered but we couldn't record it. Press Refresh.");
  }
}

/** Apply what a provider says about one attempt. Used by pay, and by sync. */
export async function applyStatus({ db, payoutId, status, wasPaid = false, tellOnFailure = null, received = null, receivedIn = null }) {
  if (status.state === "paid") {
    if (!wasPaid) await finish(db, payoutId, "paid", { raw_status: status.raw, received, received_in: receivedIn });
    return "paid";
  }
  if (status.state === "failed") {
    await finish(db, payoutId, "failed", {
      failure: tellOnFailure ? "details_rejected" : "other", raw_status: status.raw,
      sentence: status.failure ?? "This payment didn't go through. Pay again.", tell_factory: tellOnFailure,
    });
    return "failed";
  }
  if (status.state === "cancelled") {
    await finish(db, payoutId, "cancelled", { raw_status: status.raw, sentence: status.failure ?? "Cancelled in Wise. Nothing was sent." });
    return "cancelled";
  }
  if (wasPaid) return "paid";
  await record(db, payoutId, {
    new_stage: status.state,
    new_status: status.raw,
    new_item: status.itemId ?? null,
    sentence: status.waiting ?? (status.state === "awaiting_funding" ? FUND_IN_WISE : null),
    received,
    received_in: receivedIn,
    tell_factory: status.factoryFixes ? CHECK_PAYPAL : null,
  });
  return status.state;
}

// ---------------------------------------------------------------------------
// Wise
// ---------------------------------------------------------------------------

async function wiseBalance(wise, currency) {
  const balance = await wise.balance(currency);
  return { balanceCents: balance.cents, balanceCurrency: balance.currency, balancesUrl: wise.balancesUrl() };
}

export async function wisePreview({ wise, caller, db, row, cnyConfirmed }) {
  // First: a step the balance can't cover even before the fee needs no recipient
  // made, so the bank number isn't read for a payment that can't go.
  const balance = await wiseBalance(wise, row.currency);
  const stepShort = Number(row.amount_cents) - balance.balanceCents;
  if (stepShort > 0) return { shortByCents: stepShort, feeCents: null, totalCents: null, arrivesCents: null, arrivesCurrency: row.wise_currency, ...balance };
  const recipientId = await ensureWiseRecipient({
    caller, db, wise, accountId: row.payout_account_id, existingId: row.wise_recipient_id, cnyConfirmed,
  });
  const quote = await wise.quote({
    sourceCurrency: row.currency, targetCurrency: row.wise_currency, amountCents: row.amount_cents, recipientId,
  });
  const shortByCents = Math.max(0, quote.totalCents - balance.balanceCents);
  if (quote.balanceRefused && !shortByCents) throw new PayoutFailure("quote_unavailable", CANT_PAY_FROM_BALANCE);
  const fee = await feeFor({ provider: "wise", amountCents: Number(row.amount_cents), currency: row.currency, quotedFeeCents: quote.feeCents });
  return {
    refused: fee.refused ?? null,
    receivesCents: fee.receivesCents ?? null,
    feeCents: quote.feeCents,
    totalCents: quote.totalCents,
    arrivesCents: quote.arrivesCents,
    arrivesCurrency: quote.arrivesCurrency,
    shortByCents,
    ...balance,
  };
}

export async function wisePay({ wise, caller, db, row, paymentId, changedAt, cnyConfirmed }) {
  const claim = await must(caller.rpc("claim_provider_payout", {
    target_payment: paymentId, which: "wise", paid_to_changed_at: changedAt, cny_confirmed: Boolean(cnyConfirmed),
  }));
  const payoutId = claim.payout_id;
  let transferId = claim.provider_ref;

  // An attempt that has been pressed before may already have a transfer we never
  // heard about, so it keeps its key: only a first press can end here.
  async function shortBalance(byCents, words = "") {
    const sentence = `Wise balance is short by ${money(byCents, claim.currency)}${words}. Top up TSC's Wise balance, then pay again.`;
    if (claim.resumed) await record(db, payoutId, { sentence });
    else await finish(db, payoutId, "cancelled", { raw_status: "short_balance", sentence });
    return { done: "short_balance", sentence };
  }

  try {
    if (!transferId) {
      const balance = await wise.balance(claim.currency);
      if (balance.cents < Number(claim.amount_cents)) {
        return await shortBalance(Number(claim.amount_cents) - balance.cents, " before Wise's fee");
      }
      const recipientId = await ensureWiseRecipient({
        caller, db, wise, accountId: claim.account_id, existingId: claim.wise_recipient_id, cnyConfirmed,
      });
      // A fresh quote every time: Wise returns the first transfer for this key,
      // whichever quote comes with it (seen on the sandbox), and an old one expires.
      const quote = await wise.quote({
        sourceCurrency: claim.currency, targetCurrency: row.wise_currency, amountCents: claim.amount_cents, recipientId,
      });
      if (quote.totalCents > balance.cents) return await shortBalance(quote.totalCents - balance.cents);
      if (quote.balanceRefused) throw new PayoutFailure("quote_unavailable", CANT_PAY_FROM_BALANCE);
      const fee = await feeFor({ provider: "wise", amountCents: Number(claim.amount_cents), currency: claim.currency, quotedFeeCents: quote.feeCents });
      if (fee.refused) throw new PayoutFailure("fee_too_large", fee.refused);
      await recordFee(db, paymentId, fee.feeCents);
      await record(db, payoutId, { new_quote: quote.id, new_fee: quote.feeCents, keep_lease: true });
      const transfer = await wise.createTransfer({
        recipientId, quoteId: quote.id, key: claim.key, reference: String(claim.order_number).slice(0, 30),
      });
      transferId = transfer.id;
      await record(db, payoutId, {
        new_ref: transferId, new_stage: "awaiting_funding", new_status: transfer.status,
        received: quote.arrivesCents, received_in: quote.arrivesCurrency, keep_lease: true,
      });
    }

    // Only a transfer still waiting is funded: a press after a timeout may find
    // the first press's funding already went.
    const before = await wise.status(transferId);
    let funded = false;
    if (before.raw === "incoming_payment_waiting") {
      const funding = await wise.fund(transferId);
      if (!funding.funded) {
        const sentence = funding.why === "short_balance"
          ? "Wise balance is too low to fund this. Top up TSC's Wise balance, then press Fund again."
          : funding.why === "funding_refused" ? FUND_IN_WISE : "Wise didn't fund this transfer. Open it in Wise to see why.";
        await record(db, payoutId, { new_stage: "awaiting_funding", new_status: before.raw, sentence });
        return { done: funding.why, sentence, transferUrl: wise.transferUrl(transferId) };
      }
      funded = true;
    }
    let after = await wise.status(transferId);
    // Wise answers the payment before the transfer's status catches up (seen on the
    // sandbox: the balance had dropped, the status still said waiting, and the board
    // asked staff to fund it again). Read once more; if it still lags, Wise accepted
    // the payment, so it is sent, and the next read-back settles the rest.
    if (funded && after.raw === "incoming_payment_waiting") {
      await pause(FUND_SETTLE_MS);
      after = await wise.status(transferId);
      if (after.raw === "incoming_payment_waiting") after = { ...after, state: "sent", waiting: null };
    }
    const state = await applyStatus({ db, payoutId, status: after, tellOnFailure: after.raw === "bounced_back" ? CHECK_BANK : null });
    return { done: state, transferUrl: wise.transferUrl(transferId) };
  } catch (failure) {
    if (failure instanceof PayoutFailure && failure.unsure) {
      await record(db, payoutId, { sentence: failure.message });
      throw failure;
    }
    // A certain "no" before there's a transfer ends the attempt: nothing went,
    // and the next press gets a new key rather than replaying this answer.
    // Only when we know that: Wise gave us a transfer whose id may not have saved.
    const again = await db.from("provider_payouts").select("provider_ref").eq("id", payoutId).maybeSingle();
    if (!transferId && !again.error && !again.data?.provider_ref) {
      await finish(db, payoutId, "cancelled", { raw_status: failure.kind ?? "refused", sentence: failure.message });
    } else {
      // The attempt stays open, so finding out where it is comes first.
      if (failure.kind === "details_rejected") failure.kind = "refused";
      await record(db, payoutId, { sentence: failure.message, new_ref: transferId ?? undefined });
    }
    throw failure;
  }
}

export async function tellFactoryDetails({ caller, db, paymentId, changedAt, which, cnyConfirmed, sentence, fields = [] }) {
  const named = (Array.isArray(fields) ? fields : []).filter(isFieldKey).slice(0, 10);
  // Tazapay's own claim refuses the incomplete account this tell is about.
  const claim = await must(which === "tazapay"
    ? caller.rpc("claim_provider_payout_to_tell", { target_payment: paymentId, paid_to_changed_at: changedAt })
    : caller.rpc("claim_provider_payout", {
      target_payment: paymentId, which, paid_to_changed_at: changedAt, cny_confirmed: Boolean(cnyConfirmed),
    }));
  // A live attempt may have gone. Failing it here would let the next press pay again.
  if (claim.resumed) {
    await record(db, claim.payout_id, { sentence: STILL_OPEN });
    throw new PayoutFailure("database", STILL_OPEN);
  }
  await finish(db, claim.payout_id, "failed", {
    failure: "details_rejected", raw_status: "details_rejected", sentence,
    tell_factory: which === "paypal" ? CHECK_PAYPAL : checkWords(sentence, named),
  });
  // Which fields it can name to the factory. The factory has already been told, so this can't undo that.
  if (named.length) {
    const { error } = await db.from("provider_payouts").update({ details_fields: named }).eq("id", claim.payout_id);
    if (error) log("details_fields", error, { paymentId });
  }
  return { done: "failed" };
}

// ---------------------------------------------------------------------------
// PayPal
// ---------------------------------------------------------------------------

/** What staff confirm: the fee the factory pays and what it receives. Nothing is asked of PayPal. */
export async function paypalPreview({ db, row }) {
  const fee = await feeFor({ provider: "paypal", amountCents: Number(row.amount_cents), currency: row.currency, country: await factoryCountry(db, row.payment_id) });
  return { refused: fee.refused ?? null, feeCents: fee.feeCents ?? null, receivesCents: fee.receivesCents ?? null, totalCents: Number(row.amount_cents) };
}

const LOST_PAYPAL_ANSWER = "PayPal's first answer was lost and this retry was refused, so we don't know if it went. Check PayPal, then press again: it can't pay twice.";

export async function paypalPay({ paypal, caller, db, paymentId, changedAt }) {
  const claim = await must(caller.rpc("claim_provider_payout", {
    target_payment: paymentId, which: "paypal", paid_to_changed_at: changedAt, cny_confirmed: false,
  }));
  const payoutId = claim.payout_id;
  let batchId = claim.provider_ref ?? null;
  try {
    // PayPal has this one: read it, never send it again. Its key doesn't last for ever.
    if (!batchId) {
      // PayPal charges TSC its fee on top of what is sent: send what, with that
      // fee, comes to the amount. The factory pays the difference.
      const fee = await feeFor({ provider: "paypal", amountCents: Number(claim.amount_cents), currency: claim.currency, country: await factoryCountry(db, paymentId) });
      if (fee.refused) throw new PayoutFailure("fee_too_large", fee.refused);
      await recordFee(db, paymentId, fee.feeCents);
      await record(db, payoutId, { new_fee: fee.feeCents, received: fee.receivesCents, received_in: claim.currency, keep_lease: true });
      const paid = await paypal.pay({
        key: claim.key, email: claim.paypal_email, amountCents: fee.receivesCents,
        currency: claim.currency, reference: `TSC ${claim.order_number}`,
      });
      batchId = paid.batchId;
      await record(db, payoutId, { new_ref: paid.batchId, new_stage: "sent", keep_lease: true });
    }
    const status = await paypal.status(batchId);
    const state = await applyStatus({ db, payoutId, status, tellOnFailure: status.raw === "RETURNED" ? CHECK_PAYPAL : null });
    return { done: state, sentence: status.waiting ?? null };
  } catch (failure) {
    if (failure instanceof PayoutFailure && failure.unsure) {
      await record(db, payoutId, { sentence: failure.message });
      throw failure;
    }
    // PayPal took the batch once we hold its id, saved or not: never cancelled, never paid again.
    const again = await db.from("provider_payouts").select("provider_ref").eq("id", payoutId).maybeSingle();
    // A press after a lost answer may be refused for any reason while the first
    // batch stands, and an answer we couldn't read is no answer: neither ends this,
    // or staff approve again under a new key and PayPal pays twice.
    if (!batchId && claim.resumed) {
      await record(db, payoutId, { sentence: LOST_PAYPAL_ANSWER });
      throw new PayoutFailure(failure.kind ?? "unknown", LOST_PAYPAL_ANSWER, { unsure: true, status: failure.status });
    }
    if (failure instanceof PayoutFailure && !batchId && !again.error && !again.data?.provider_ref) {
      const invalid = /address isn't valid/.test(failure.message);
      if (invalid) {
        await finish(db, payoutId, "failed", {
          failure: "details_rejected", raw_status: failure.kind ?? "refused", sentence: failure.message, tell_factory: CHECK_PAYPAL,
        });
      } else {
        await finish(db, payoutId, "cancelled", { raw_status: failure.kind ?? "refused", sentence: failure.message });
      }
    } else {
      await record(db, payoutId, { sentence: failure.message, new_ref: batchId ?? undefined });
    }
    throw failure;
  }
}

// ---------------------------------------------------------------------------
// Tazapay
// ---------------------------------------------------------------------------

const loadTazapayRules = () => import("../src/shared/tazapay-payout.mjs");
const loadFees = () => import("../src/shared/withdrawal-fees.mjs");

/**
 * The factory pays Tazapay's fee (src/shared/withdrawal-fees.mjs, the one
 * figure the board, the row and the notice show). Refused in words when
 * nothing would arrive; nothing is sent then.
 */
async function tazapayFee({ quote, amountMinor, currency, country }) {
  const { withdrawalFee } = await loadFees();
  const fee = withdrawalFee({ provider: "tazapay", amountCents: Number(amountMinor), currency, country, quotedFeeCents: quote.feeMinor });
  if (fee.refused) return fee;
  // Tazapay found it too small even though the module did not: still nothing is sent.
  if (quote.tooSmall) return { ...fee, refused: `This payment is too small for Tazapay to send once its ${money(quote.feeMinor, currency)} fee is taken. Nothing was sent.` };
  return fee;
}
/** Tazapay remembers a key for 24 hours; past that, pressing again could pay twice. */
export const TAZAPAY_KEY_MEMORY_MS = 23 * 3600 * 1000;
const LOST_TAZAPAY_ANSWER = "Tazapay's answer to the first press was lost more than a day ago, so pressing again could pay twice. Check Tazapay for a payout with this payment's reference before doing anything else.";
// Columns the checks read. Never the number: that stays in Vault.
const ACCOUNT_COLUMNS = "id, org_id, method, bank_country, account_name, holder_name_local, registration_number, bank_name, bank_code, swift, address_line1, address_city, address_state, address_postal_code, number_changed_at";

/** The account's details and what still stops a payout, read with the server's key (never the number). */
async function tazapayAccountProblems(db, accountId) {
  const { tazapayDetailsProblems, tazapayProblemsSentence, tazapayRoute } = await loadTazapayRules();
  const read = await db.from("factory_payout_accounts").select(ACCOUNT_COLUMNS).eq("id", accountId).maybeSingle();
  if (read.error || !read.data) throw new PayoutFailure("database", "This factory's bank account couldn't be read. Reload the page.");
  const account = read.data;
  const registered = await db.from("company_registrations").select("number, country_code").eq("org_id", account.org_id).maybeSingle();
  const problems = tazapayDetailsProblems(account, {
    companyRegistration: registered.data?.country_code === account.bank_country ? registered.data?.number ?? null : null,
  });
  return { account, problems, sentence: tazapayProblemsSentence(problems), route: tazapayRoute(account) };
}

/**
 * What a press would send, before anyone commits: the fee, the total, what
 * arrives and the balance, as Wise's preview. Nothing is claimed or made.
 */
export async function tazapayPreview({ tazapay, db, row }) {
  if (!row.payout_account_id) throw new PayoutFailure("details_missing", "This factory has no bank account on file.");
  const { problems, sentence, route } = await tazapayAccountProblems(db, row.payout_account_id);
  if (problems.length) throw new PayoutFailure("details_rejected", sentence, { fields: problems.map((p) => p.field) });
  if (row.currency !== "USD") throw new PayoutFailure("refused", `Tazapay pays from TSC's USD balance, and this payment is in ${row.currency}.`);
  const [quote, available] = await Promise.all([
    tazapay.quote({ holdingCurrency: row.currency, amountMinor: row.amount_cents, route }),
    tazapay.available(row.currency),
  ]);
  const fee = await tazapayFee({ quote, amountMinor: row.amount_cents, currency: row.currency, country: route.country });
  return {
    refused: fee.refused ?? null,
    feeCents: fee.feeCents ?? quote.feeMinor,
    receivesCents: fee.receivesCents,
    feePaidBy: "factory",
    totalCents: quote.totalMinor,
    arrivesCents: quote.payoutMinor,
    arrivesCurrency: quote.payoutCurrency,
    shortByCents: Math.max(0, quote.totalMinor - available),
    balanceCents: available,
    balanceCurrency: row.currency,
    balancesUrl: tazapay.appUrl,
    country: route.country,
  };
}

/**
 * Pay with Tazapay. Claim first (the attempt's key is made before any call),
 * check the account, make the payee once, quote, check the balance, keep the
 * invoice, upload it to Tazapay, make the payout under the attempt's key, read
 * it back. Pressing again resumes the same attempt: with a payout, it only reads
 * it back; without one, the same key finds the first press's payout if it went.
 */
export async function tazapayPay({ tazapay, caller, db, paymentId, changedAt, now = () => new Date() }) {
  const claim = await must(caller.rpc("claim_provider_payout", {
    target_payment: paymentId, which: "tazapay", paid_to_changed_at: changedAt, cny_confirmed: false,
  }));
  const payoutId = claim.payout_id;
  let payoutRef = claim.provider_ref ?? null;

  async function shortBalance(byMinor, currency) {
    const sentence = `TSC's Tazapay balance is short by ${money(byMinor, currency)}, fee included. Top up the balance in Tazapay, then pay again.`;
    if (claim.resumed) await record(db, payoutId, { sentence });
    else await finish(db, payoutId, "cancelled", { raw_status: "short_balance", sentence });
    return { done: "short_balance", sentence };
  }

  try {
    if (!payoutRef) {
      if (claim.resumed && now() - new Date(claim.attempt_started_at) > TAZAPAY_KEY_MEMORY_MS) {
        throw new PayoutFailure("key_expired", LOST_TAZAPAY_ANSWER, { unsure: true });
      }
      const { tazapayDetailsProblems, tazapayProblemsSentence, tazapayRoute } = await loadTazapayRules();
      const read = await db.from("factory_payout_accounts").select(ACCOUNT_COLUMNS).eq("id", claim.account_id).maybeSingle();
      if (read.error || !read.data) throw new PayoutFailure("database", "This factory's bank account couldn't be read. Reload the page.");
      const account = read.data;
      const registered = await db.from("company_registrations").select("number, country_code").eq("org_id", account.org_id).maybeSingle();
      const problems = tazapayDetailsProblems(account, {
        companyRegistration: registered.data?.country_code === account.bank_country ? registered.data?.number ?? null : null,
      });
      if (problems.length) throw new PayoutFailure("details_missing", tazapayProblemsSentence(problems), { fields: problems.map((p) => p.field) });
      const route = tazapayRoute(account);
      if (claim.currency !== "USD") {
        throw new PayoutFailure("refused", `Tazapay pays from TSC's USD balance, and this payment is in ${claim.currency}.`);
      }

      const beneficiary = await ensureTazapayBeneficiary({
        caller, db, tazapay, accountId: claim.account_id, existingId: claim.tazapay_beneficiary_id,
      });
      const quote = await tazapay.quote({ holdingCurrency: claim.currency, amountMinor: claim.amount_cents, route });
      const fee = await tazapayFee({ quote, amountMinor: claim.amount_cents, currency: claim.currency, country: route.country });
      if (fee.refused) throw new PayoutFailure("fee_too_large", fee.refused);
      const available = await tazapay.available(claim.currency);
      if (available < quote.totalMinor) return await shortBalance(quote.totalMinor - available, claim.currency);
      // The factory's row, its bell and the board read this one figure, recorded before money moves.
      await recordFee(db, paymentId, fee.feeCents);
      await record(db, payoutId, {
        new_fee: quote.feeMinor, received: quote.payoutMinor, received_in: quote.payoutCurrency, keep_lease: true,
      });

      // Kept first, so for every payout Tazapay has, TSC has the document.
      const reference = `TSC-${claim.order_number}-${String(paymentId).slice(0, 8)}`;
      const bytes = invoicePdf({
        reference,
        issuedOn: now().toISOString().slice(0, 10),
        payeeName: account.account_name,
        orderNumber: claim.order_number,
        stepTitle: claim.milestone_title,
        amountMinor: claim.amount_cents,
        currency: claim.currency,
        payoutMinor: quote.payoutMinor,
        payoutCurrency: quote.payoutCurrency,
        rate: quote.rate,
      });
      const kept = await db.storage.from(INVOICE_BUCKET).upload(invoicePath(paymentId, claim.key), bytes, { contentType: "application/pdf", upsert: true });
      if (kept.error) throw new PayoutFailure("invoice", "The invoice couldn't be saved, so nothing was sent. Press again.");
      const documentUrl = await tazapay.uploadDocument({ fileName: `${reference}.pdf`, bytes });

      const payout = await tazapay.createPayout({
        beneficiary,
        amount: quote.payoutMinor,
        currency: quote.payoutCurrency,
        holding_currency: claim.currency,
        type: route.type,
        local: { fund_transfer_network: route.network },
        purpose: route.purpose,
        reference_id: `tsc-${paymentId}`,
        transaction_description: `Advance payment for goods, production order ${claim.order_number}`.slice(0, 140),
        statement_descriptor: `TSC ${claim.order_number}`.slice(0, 22),
        documents: [{ type: "invoice", url: documentUrl }],
      }, `tsc-${claim.key}`);
      if (!payout?.id) throw new PayoutFailure("unknown", "Tazapay answered without a payout. Press again: it can't pay twice.", { unsure: true });
      payoutRef = payout.id;
      await record(db, payoutId, {
        new_ref: payout.id, new_stage: "sent", new_status: payout.status,
        received: payout.amount ?? quote.payoutMinor, received_in: payout.currency ?? quote.payoutCurrency, keep_lease: true,
      });
    }

    const status = await tazapay.status(payoutRef);
    const state = await applyStatus({
      db, payoutId, status, tellOnFailure: status.tellFactory ? CHECK_BANK : null,
      received: status.state === "paid" ? status.arrivesCents : null,
      receivedIn: status.state === "paid" ? status.arrivesCurrency : null,
    });
    return { done: state, sentence: status.waiting ?? status.failure ?? null };
  } catch (failure) {
    if (failure instanceof PayoutFailure && failure.unsure) {
      await record(db, payoutId, { sentence: failure.message });
      throw failure;
    }
    // A certain "no" before Tazapay has a payout ends the attempt: nothing went,
    // and the next press gets a new key rather than replaying this answer.
    const again = await db.from("provider_payouts").select("provider_ref").eq("id", payoutId).maybeSingle();
    if (!payoutRef && !again.error && !again.data?.provider_ref) {
      await finish(db, payoutId, "cancelled", { raw_status: failure.kind ?? "refused", sentence: failure.message });
    } else {
      await record(db, payoutId, { sentence: failure.message, new_ref: payoutRef ?? undefined });
    }
    throw failure;
  }
}

// ---------------------------------------------------------------------------
// Both
// ---------------------------------------------------------------------------

const CHARGE_UNCHECKED = "We couldn't check the brand's payment just now, so nothing was sent. Press again in a minute.";

/**
 * Before Wise or PayPal is asked to pay: is the brand's money still there? A
 * refund or dispute in Stripe reaches us by a webhook that can be late or lost,
 * and these payouts come from TSC's own balance, so nothing else would stop
 * them (Stripe's own transfer has its charge to refuse on; api/_stripe.js checks
 * the same). A press whose PayPal answer was lost goes ahead: only it can find
 * out what PayPal did, and it can't pay twice.
 */
export async function refuseIfChargeReturned({ db, paymentId, build = stripeFrom }) {
  const live = await db.from("provider_payouts").select("provider, provider_ref")
    .eq("payment_id", paymentId).eq("status", "processing").maybeSingle();
  if (live.data?.provider === "paypal" && !live.data.provider_ref) return;
  const { data: payment, error } = await db.from("order_payments").select("stripe_charge_id").eq("id", paymentId).maybeSingle();
  if (error) throw new PayoutFailure("database", CHARGE_UNCHECKED);
  if (!payment?.stripe_charge_id) return;
  let stripe;
  let charge;
  try {
    stripe = build();
    if (!stripe) return;
    charge = await stripe.charges.retrieve(payment.stripe_charge_id);
  } catch (failure) {
    log("charge check", failure, { paymentId });
    throw new PayoutFailure("charge_unchecked", CHARGE_UNCHECKED);
  }
  if (charge.disputed) throw new PayoutFailure("charge_disputed", "The brand disputed this charge, so nothing was sent.");
  if (Number(charge.amount_refunded) > 0) {
    // Recorded as the webhook would have, so the board moves on from it.
    await applyChargeRefund({ stripe, db, charge }).catch((failure) => log("charge refund", failure, { paymentId }));
    throw new PayoutFailure("charge_refunded", "The brand's payment was refunded, so there is nothing to pay out. Reload the board.");
  }
}

export async function cancelAttempt({ client, caller, db, paymentId }) {
  const held = await must(caller.rpc("lease_provider_payout", { target_payment: paymentId }));
  const payoutId = held.payout_id;
  try {
    // A PayPal press whose answer was lost may have paid: PayPal pays the moment it
    // takes the batch. Only the same key can find out, so cancelling blind is refused.
    if (held.provider === "paypal" && !held.provider_ref) {
      throw new PayoutFailure("refused", "We don't know yet if PayPal paid this. Press again first: it finds what PayPal did and can't pay twice.");
    }
    // The same for Tazapay: a press whose answer was lost may have made a payout,
    // and only the same key (pressed again) finds it.
    if (held.provider === "tazapay" && !held.provider_ref) {
      throw new PayoutFailure("refused", "We don't know yet if Tazapay made this payout. Press again first: it finds what Tazapay did and can't pay twice.");
    }
    if (held.provider_ref) {
      if (held.provider === "paypal") {
        const status = await client.status(held.provider_ref);
        if (status.raw !== "UNCLAIMED") {
          await applyStatus({ db, payoutId, status });
          throw new PayoutFailure("refused", "Only an unclaimed PayPal payment can be cancelled. The board now shows where it is.");
        }
        await client.cancel(status.itemId);
      } else {
        await client.cancel(held.provider_ref);
      }
    }
    await finish(db, payoutId, "cancelled", { raw_status: "cancelled", sentence: "Cancelled. Nothing was sent." });
    return { done: "cancelled" };
  } catch (failure) {
    // What the row says stays what it said: the payment is still where it was.
    await record(db, payoutId, { sentence: held.staff_sentence ?? null });
    if (failure instanceof PayoutFailure && failure.unsure) {
      const name = { paypal: "PayPal", tazapay: "Tazapay" }[held.provider] ?? "Wise";
      throw new PayoutFailure("cancel_failed", `${name} didn't cancel this, so it's still where it was. Try again later, or cancel it in ${name}.`, { status: failure.status });
    }
    throw failure;
  }
}

const READ_BACK_COLUMNS = "id, status, provider_ref, received_currency, paid_at";

/**
 * Ask the provider where one attempt is, and record it. Only the provider's own
 * answer is written: a webhook or the sweep only says "look now".
 */
export async function readBack({ client, db, row }) {
  const status = await client.status(row.provider_ref);
  const wasPaid = row.status === "paid";
  // The quote staff confirmed stands until it arrives. Wise's figure before that
  // can be for another pay-in route (seen on the sandbox).
  const arrived = status.state === "paid";
  const tell = status.state === "failed"
    ? (status.raw === "bounced_back" || status.tellFactory ? CHECK_BANK : status.raw === "RETURNED" ? CHECK_PAYPAL : null)
    : null;
  return applyStatus({
    db, payoutId: row.id, status, wasPaid, tellOnFailure: tell,
    received: arrived ? status.arrivesCents ?? null : null, receivedIn: arrived && status.arrivesCents != null ? row.received_currency : null,
  });
}

/**
 * A webhook named a transfer (Wise) or a batch (PayPal). Find our attempt by that
 * ref, or by the key we sent when the press's answer was lost before the ref was
 * kept (PayPal's sender_item_id), then read it back. Null when this database has
 * no such attempt: another site on the same account, or a test event.
 */
export async function readBackRef({ client, db, ref, key = null }) {
  let row = null;
  if (ref) {
    const found = await db.from("provider_payouts").select(READ_BACK_COLUMNS)
      .eq("provider", client.provider).eq("provider_ref", String(ref)).maybeSingle();
    if (found.error) throw new PayoutFailure("database", "provider_payouts could not be read", { detail: found.error.code });
    row = found.data;
  }
  if (!row && key && /^[0-9a-f-]{36}$/i.test(key)) {
    const attempt = await db.from("provider_payout_attempts").select("payout_id").eq("attempt_key", key).maybeSingle();
    if (attempt.data?.payout_id) {
      const found = await db.from("provider_payouts").select(READ_BACK_COLUMNS)
        .eq("id", attempt.data.payout_id).eq("provider", client.provider).maybeSingle();
      row = found.data;
      if (row && !row.provider_ref && ref) {
        await record(db, row.id, { new_ref: String(ref) });
        row = { ...row, provider_ref: String(ref) };
      }
    }
  }
  if (!row?.provider_ref) return null;
  if (!["processing", "paid"].includes(row.status)) return row.status;
  return readBack({ client, db, row });
}

/** Everything of this provider's that can still change. Paid ones for 30 days: a transfer can come back. */
export async function syncAttempts({ client, db }) {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: rows, error } = await db.from("provider_payouts")
    .select(READ_BACK_COLUMNS)
    .eq("provider", client.provider)
    .not("provider_ref", "is", null)
    .or(`status.eq.processing,and(status.eq.paid,paid_at.gte.${since})`)
    .limit(50);
  if (error) throw new PayoutFailure("database", "The board couldn't read its payments. Reload the page.");
  const answers = await Promise.allSettled((rows ?? []).map((row) => readBack({ client, db, row })));
  const unread = answers.filter((a) => a.status === "rejected");
  for (const a of unread) log("provider sync", a.reason, { provider: client.provider });
  return { read: answers.length - unread.length, unread: unread.length };
}

const money = (minor, currency) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);

// ---------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------

/** `build` reads the settings. A live account away from production throws here. */
export function payoutRoute({ provider, build, label, settings }) {
  return async function handler(request, response) {
    if (request.method !== "POST") return reply(response, 405, { error: "method not allowed" });

    let client;
    try {
      client = build();
    } catch (failure) {
      return reply(response, 503, { error: failure.message, kind: failure.kind ?? null });
    }
    const db = serviceClient();
    if (!client || !db) return reply(response, 503, { error: `${label} isn't set up on this site. Set ${settings}.`, kind: "not_set_up" });

    const caller = callerClient(request);
    if (!caller) return reply(response, 401, { error: "Your sign-in expired. Sign in again." });

    const staff = await caller.rpc("is_platform_admin");
    if (tokenRefused(staff)) return reply(response, 401, { error: "Your sign-in expired. Sign in again." });
    if (staff.error || staff.data !== true) return reply(response, 403, { error: STAFF_ONLY });

    const { action, paymentId, paidToChangedAt, cnyConfirmed } = jsonBody(request);
    try {
      if (action === "sync") {
        const synced = await syncAttempts({ client, db });
        const balance = provider === "wise" ? { ...(await wiseBalance(client, "USD")), appUrl: client.appUrl }
          : provider === "tazapay" ? { balanceCents: await client.available("USD"), balanceCurrency: "USD", balancesUrl: client.appUrl, appUrl: client.appUrl }
          : { appUrl: client.appUrl };
        return reply(response, 200, { ...synced, ...balance });
      }
      if (action === "cancel") return reply(response, 200, await cancelAttempt({ client, caller, db, paymentId }));

      if (action === "tell") {
        const { sentence, fields } = jsonBody(request);
        return reply(response, 200, await tellFactoryDetails({
          caller, db, paymentId, which: provider, changedAt: paidToChangedAt, cnyConfirmed,
          sentence: String(sentence ?? "The factory was told to check its details.").slice(0, 300), fields,
        }));
      }

      const board = await must(caller.rpc("admin_payment_board"));
      const row = (board ?? []).find((r) => r.payment_id === paymentId);
      if (!row) return reply(response, 404, { error: "That payment isn't on the board any more. Reload the page." });
      if (action === "pay") await refuseIfChargeReturned({ db, paymentId });

      if (provider === "wise") {
        if (action === "preview") {
          return reply(response, 200, await wisePreview({ wise: client, caller, db, row, cnyConfirmed }));
        }
        if (action === "pay") {
          return reply(response, 200, await wisePay({ wise: client, caller, db, row, paymentId, changedAt: paidToChangedAt, cnyConfirmed }));
        }
      } else if (provider === "tazapay") {
        if (action === "preview") return reply(response, 200, await tazapayPreview({ tazapay: client, db, row }));
        if (action === "pay") {
          return reply(response, 200, await tazapayPay({ tazapay: client, caller, db, paymentId, changedAt: paidToChangedAt }));
        }
      } else if (action === "preview") {
        return reply(response, 200, await paypalPreview({ db, row }));
      } else if (action === "pay") {
        return reply(response, 200, await paypalPay({ paypal: client, caller, db, paymentId, changedAt: paidToChangedAt }));
      }
      return reply(response, 400, { error: "unknown action" });
    } catch (failure) {
      log(`${provider}-payout`, failure, { action, paymentId });
      const known = failure instanceof PayoutFailure;
      // Someone else's press is running: a conflict, not a provider failure.
      const busy = known && failure.kind === "database" && failure.detail === "payout_in_progress";
      return reply(response, busy ? 409 : known && failure.unsure ? 504 : 502, {
        error: known ? failure.message : `${label} didn't answer as expected. Press Refresh to see where this is.`,
        kind: known ? failure.kind : "unknown",
        unsure: known ? failure.unsure : true,
        fields: known ? failure.fields ?? [] : [],
      });
    }
  };
}
