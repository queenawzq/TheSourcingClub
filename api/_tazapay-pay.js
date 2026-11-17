import { PayoutFailure } from "./_payout-provider.js";
import { INVOICE_BUCKET } from "./_tazapay-invoice.js";

/**
 * What Pay with Tazapay (one order step, api/_provider-payouts.js) and a
 * Tazapay withdrawal (several steps, api/_withdrawal-adapters.js) share: the
 * account check, the quote with the factory's fee inside the amount, the
 * invoice kept by TSC before Tazapay sees it, and the payout's body.
 */

const loadTazapayRules = () => import("../src/shared/tazapay-payout.mjs");
const loadFees = () => import("../src/shared/withdrawal-fees.mjs");

/** Tazapay remembers a key for 24 hours; past that, pressing again could pay twice. */
export const TAZAPAY_KEY_MEMORY_MS = 23 * 3600 * 1000;

// Columns the checks read. Never the number: that stays in Vault.
export const ACCOUNT_COLUMNS = "id, org_id, method, bank_country, account_name, holder_name_local, registration_number, bank_name, bank_code, swift, address_line1, address_city, address_state, address_postal_code, number_changed_at";

const money = (minor, currency) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(minor) / 100);

export const TOO_LARGE_FOR_TAZAPAY = "This amount is above the most Tazapay can send in one payout. Nothing was sent.";

/**
 * The account's details and what still stops a payout, read with the server's
 * key (never the number), including the company registration it must match.
 */
export async function tazapayAccountProblems(db, accountId, extraColumns = "") {
  const { tazapayDetailsProblems, tazapayProblemsSentence, tazapayRoute } = await loadTazapayRules();
  const read = await db.from("factory_payout_accounts").select(`${ACCOUNT_COLUMNS}${extraColumns}`).eq("id", accountId).maybeSingle();
  if (read.error || !read.data) throw new PayoutFailure("database", "This factory's bank account couldn't be read. Reload the page.");
  const account = read.data;
  const registered = await db.from("company_registrations").select("number, country_code").eq("org_id", account.org_id).maybeSingle();
  const problems = tazapayDetailsProblems(account, {
    companyRegistration: registered.data?.country_code === account.bank_country ? registered.data?.number ?? null : null,
    registrationKnown: !registered.error,
  });
  return { account, problems, sentence: tazapayProblemsSentence(problems), route: tazapayRoute(account) };
}

/**
 * The quote a payout is made on. The factory's fee is the one rule's
 * (src/shared/withdrawal-fees.mjs: a fixed placeholder for Tazapay until it is
 * live), so the payout carries amount − fee to the factory at Tazapay's rate,
 * and Tazapay's own fee comes out of TSC's balance on top of it
 * (quote.totalMinor is what leaves the balance).
 *
 *   { quote, fee }                     go ahead
 *   { refused, kind, fee }             nothing is sent: too_small or too_large
 */
export async function quoteTazapayPayout({ tazapay, amountMinor, currency, route, country = "" }) {
  const { withdrawalFee } = await loadFees();
  const amount = Number(amountMinor);
  const fee = withdrawalFee({ provider: "tazapay", amountCents: amount, currency, country });
  if (fee.refused) return { refused: fee.refused, kind: "too_small", fee };
  const tooSmall = () => ({ refused: `This payment is too small for Tazapay to send once its ${money(fee.feeCents, currency)} fee is taken. Nothing was sent.`, kind: "too_small", fee });
  const ask = (holding) => tazapay.quote({ holdingCurrency: currency, amountMinor: holding, route });

  // The first quote gives Tazapay's own fee; the payout is then quoted at what
  // the factory receives plus that fee, so the fee Tazapay takes inside the
  // holding amount is not the factory's.
  let quote = await ask(amount);
  for (let tries = 0; tries < 3; tries += 1) {
    if (quote.tooLarge) return { refused: TOO_LARGE_FOR_TAZAPAY, kind: "too_large", fee };
    if (quote.tooSmall) return tooSmall();
    const holding = fee.receivesCents + Number(quote.feeMinor ?? 0);
    if (quote.totalMinor === holding) break;
    const next = await ask(holding);
    const same = !next.tooSmall && !next.tooLarge && next.feeMinor === quote.feeMinor;
    quote = next;
    if (same) break;
  }
  if (quote.tooLarge) return { refused: TOO_LARGE_FOR_TAZAPAY, kind: "too_large", fee };
  if (quote.tooSmall) return tooSmall();
  return { quote, fee };
}

/**
 * Keep the invoice in TSC's private bucket first, so for every payout Tazapay
 * has, TSC has the document; then upload it to Tazapay. Returns Tazapay's URL.
 */
export async function keepAndUploadInvoice({ db, tazapay, path, fileName, bytes }) {
  const kept = await db.storage.from(INVOICE_BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (kept.error) throw new PayoutFailure("invoice", "The invoice couldn't be saved, so nothing was sent. Press again.");
  return tazapay.uploadDocument({ fileName, bytes });
}

/** When TSC first kept the invoice at this path (the attempt's first press), or null. */
export async function invoiceKeptAt(db, path) {
  const slash = path.lastIndexOf("/");
  const listed = await db.storage.from(INVOICE_BUCKET).list(path.slice(0, slash), { search: path.slice(slash + 1) });
  if (listed.error) throw new PayoutFailure("database", "The invoice couldn't be read, so nothing was sent. Press again.");
  const file = (listed.data ?? []).find((f) => f.name === path.slice(slash + 1));
  return file?.created_at ? new Date(file.created_at) : null;
}

/** The payout Tazapay is asked to make, PYR031 with the invoice. */
export function payoutBody({ beneficiary, quote, route, currency, referenceId, description, descriptor, documentUrl }) {
  return {
    beneficiary,
    amount: quote.payoutMinor,
    currency: quote.payoutCurrency,
    holding_currency: currency,
    type: route.type,
    local: { fund_transfer_network: route.network },
    purpose: route.purpose,
    reference_id: referenceId,
    transaction_description: description.slice(0, 140),
    statement_descriptor: descriptor.slice(0, 22),
    documents: [{ type: "invoice", url: documentUrl }],
  };
}
