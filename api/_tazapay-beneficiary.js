import { PayoutFailure } from "./_payout-provider.js";

/**
 * Tazapay's payee for a factory's bank account. The second place on our server
 * the full bank number passes through, after api/_wise-recipient.js, because
 * Tazapay needs it to make the payee (check:bank-number allows these two
 * files and no other). Read with the staff member's own token, so the same
 * refusals and the same record of who apply; sent to Tazapay; kept nowhere.
 * Nothing here logs or returns it.
 *
 * Made once per set of details: the database clears the payee the moment the
 * details change, and keeps a new one only if they haven't changed since read.
 *
 * Tazapay accepts a payee with details missing and only refuses the payout
 * later (sandbox), so what it needs is checked first, here and in the database
 * (tazapay_account_check).
 */

/** Tazapay's payee email: TSC's, so Tazapay never writes to the factory itself. */
export const PAYEE_EMAIL = "operations@contact.sourcing-club.com";
/** Hong Kong has no postcodes; Tazapay's HK route asks for one and took this (sandbox). */
export const HK_NO_POSTCODE = "000000";

export function beneficiaryBody(row, { email = PAYEE_EMAIL } = {}) {
  const country = row.bank_country;
  const codes = {};
  if (row.swift) codes.swift_code = row.swift.replace(/\s/g, "").toUpperCase();
  if (country === "CN" && row.bank_code) codes.cnaps = row.bank_code;
  if (country === "HK" && row.bank_code) codes.bank_code = row.bank_code;
  const postal = row.address_postal_code || (country === "HK" ? HK_NO_POSTCODE : undefined);
  return {
    name: row.account_name,
    ...(row.holder_name_local ? { name_local: row.holder_name_local } : {}),
    type: "business",
    email,
    ...(row.registration_number ? { national_identification_number: row.registration_number, registration_number: row.registration_number } : {}),
    address: {
      line1: row.address_line1,
      city: row.address_city,
      ...(row.address_state ? { state: row.address_state } : {}),
      country,
      ...(postal ? { postal_code: postal } : {}),
    },
    destination_details: {
      type: "bank",
      bank: {
        account_number: row.account_number,
        account_holder_name: row.account_name,
        ...(row.holder_name_local ? { account_holder_name_local: row.holder_name_local } : {}),
        bank_name: row.bank_name,
        country,
        currency: country === "HK" ? "HKD" : "CNY",
        bank_codes: codes,
      },
    },
  };
}

export async function ensureTazapayBeneficiary({ caller, db, tazapay, accountId, existingId }) {
  if (existingId) return existingId;
  const { data, error } = await caller.rpc("payout_tazapay_beneficiary", { target_account: accountId });
  if (error) {
    throw new PayoutFailure(error.hint === "no_number" || error.hint === "tazapay_details_missing" ? "details_missing" : "refused",
      wordsFor(error), { detail: error.hint ?? null });
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new PayoutFailure("refused", "This factory's bank details could not be read. Reload the page.");
  // Keyed by the details it is made from: the same details make the same payee,
  // and changed ones a new payee. A refusal isn't stored by Tazapay, so it never replays.
  const made = await tazapay.createBeneficiary(beneficiaryBody(row), `tsc-bnf-${accountId}-${new Date(row.changed_at).getTime()}`);
  if (!made?.id) throw new PayoutFailure("refused", "Tazapay didn't make a payee for this account. Press again.", { unsure: true });
  const { data: kept, error: keptError } = await db.rpc("set_tazapay_beneficiary", {
    target_account: accountId, beneficiary_id: made.id, made_from: row.changed_at,
  });
  if (keptError || !kept) {
    throw new PayoutFailure("details_changed", "This factory changed where it is paid. Reload the page and check the details.");
  }
  return made.id;
}

function wordsFor(error) {
  switch (error.hint) {
    case "payout_own_company": return "You belong to this company, so someone else on the staff must pay it.";
    case "reveal_brand_side": return "Your company has an order with this factory, so someone else on the staff must pay it.";
    case "reveal_not_owed": return "TSC doesn't owe this factory a payout right now. Reload the page.";
    case "tazapay_not_set_up": return "Tazapay pays bank accounts in mainland China and Hong Kong only. Use another way to pay this one.";
    case "tazapay_details_missing": return "This bank account is missing details Tazapay needs. Ask the factory to complete it on its Payments page.";
    case "tazapay_not_the_company": return "The registration number on this bank account isn't the company's own, so Tazapay won't pay it. Ask the factory to check it.";
    case "no_number": return "No full account number is on file. Ask the factory to add it on its Payments page.";
    default: return "This factory's bank details could not be read. Reload the page.";
  }
}
