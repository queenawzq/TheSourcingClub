/**
 * A factory's payout methods where Stripe cannot pay out (mainland China, Hong
 * Kong…), in factory_payout_accounts. The one marked is_primary is "the one TSC
 * pays": a bank account (through Wise when it was set up on Wise's form, by
 * staff otherwise) or a PayPal address.
 *
 * A factory may keep more than one (John, 2026-10-29): Add always saves a new
 * row, never overwriting another; the first one saved is the one TSC pays,
 * and the factory switches with set_primary_payout_account(), which moves the
 * mark in one statement so there is never none and never two.
 *
 * Used by Payments (PayoutDetails) and Settings, which both mount the payout
 * card around the same accounts.
 */
import { useCallback, useState } from "react";
import { supabase, unwrap } from "../../lib/supabase.js";
import { payoutRemovalError } from "./StripePayoutCard.jsx";
import { bankFieldsFor, normalBankNumber, validBankNumber, validSwift } from "../../shared/bank-fields.mjs";

const COLUMNS = "id, is_primary, method, paypal_email, wise_recipient_type, wise_details, details_changed_at, bank_name, account_name, account_number_last4, number_changed_at, swift, branch, bank_country, instructions, created_at";

// The database's refusals, in the owner's words. No raise there carries a value.
const SAVE_REFUSALS = {
  payout_owner_only: "Only a company owner can change withdrawal methods.",
  bank_details_missing: "Add the account holder and the bank so TSC can pay you.",
  swift_format: "A SWIFT / BIC is 8 or 11 letters and digits.",
  country_missing: "Name your bank's country in the instructions.",
  number_required: "Add the full account number so TSC can pay you.",
  number_mismatch: "The two account numbers don't match.",
  number_format: "Enter the account number with letters and digits only, 5 to 34 characters.",
  iban_invalid: "This IBAN doesn't look right. Check it against your bank's documents.",
  number_in_field: "Your account number belongs only in the account number field.",
  name_not_latin: "Enter the name on the account in English letters.",
  wise_form_invalid: "Couldn't save your bank details right now. Nothing changed. Try again.",
  payout_not_bank: "That withdrawal method is not a bank account.",
};

export const blankPayout = (row) => ({
  bank_name: row?.bank_name ?? "",
  account_name: row?.account_name ?? "",
  swift: row?.swift ?? "",
  branch: row?.branch ?? "",
  // Never read back: only the last four ever reach this page.
  account_number: "",
  account_number_again: "",
  instructions: row?.instructions ?? "",
  paypal_email: row?.paypal_email ?? "",
  // Typed twice, never stored: a mistyped address pays a stranger. An email
  // being edited starts confirmed, so only a change has to be typed again.
  paypal_email_confirm: row?.paypal_email ?? "",
});

/** The form of 20261107100000's check: what the database will accept. */
export const paypalEmail = (value) => (value ?? "").trim().toLowerCase();
export const validPaypalEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(paypalEmail(value)) && paypalEmail(value).length <= 254;

export function useManualPayouts(orgId) {
  const [accounts, setAccounts] = useState(null);
  // Bank payouts TSC owes this factory: approved, still held. The one TSC
  // pays cannot be removed while there are any (the same rule as the
  // database's guard, 20261029000300), so the dialog refuses before asking.
  const [owed, setOwed] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(blankPayout());
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  // The one TSC pays first, then the rest as they were added.
  const load = useCallback(async () => {
    const [rows, owedRows] = await Promise.all([
      supabase.from("factory_payout_accounts").select(COLUMNS).eq("org_id", orgId)
        .order("is_primary", { ascending: false }).order("created_at"),
      supabase.from("order_payments").select("amount_cents, currency, production_orders!inner (factory_org_id)")
        .eq("state", "confirmed").not("release_requested_at", "is", null)
        .eq("production_orders.factory_org_id", orgId),
    ]);
    const list = unwrap(rows, "load your payout accounts");
    setAccounts(list);
    setOwed(unwrap(owedRows, "load what TSC owes you").map((row) => ({ amount: Number(row.amount_cents), currency: row.currency })));
    return list;
  }, [orgId]);

  /** Open the form on one account to edit it, or blank (null) to add one. */
  const startEdit = useCallback((account) => {
    setEditingId(account?.id ?? null);
    setForm(blankPayout(account));
    setSaved(false);
  }, []);

  const setField = (key) => (event) => {
    setSaved(false);
    setForm((current) => ({ ...current, [key]: event.target.value }));
  };

  /** A failure from the database, in the owner's words. */
  const inWords = (failure, otherwise) => {
    if (SAVE_REFUSALS[failure?.cause?.hint]) return new Error(SAVE_REFUSALS[failure.cause.hint]);
    if (failure?.cause?.code === "42501") return new Error(SAVE_REFUSALS.payout_owner_only);
    return otherwise ?? new Error("Couldn't save your bank details right now. Nothing changed. Try again.");
  };

  // The staff-paid bank form, where Wise's form does not apply. The card passes
  // the payout country it was set up for, which the form has no field for.
  // Throws, for the card to say in its dialog.
  async function save(details = {}) {
    const editing = (accounts ?? []).find((account) => account.id === editingId) ?? null;
    if (!form.bank_name.trim() || !form.account_name.trim()) throw new Error(SAVE_REFUSALS.bank_details_missing);
    if (!validSwift(form.swift)) throw new Error(SAVE_REFUSALS.swift_format);
    const typed = normalBankNumber(form.account_number);
    if (typed !== normalBankNumber(form.account_number_again)) throw new Error(SAVE_REFUSALS.number_mismatch);
    if (typed ? !validBankNumber(typed) : !editing?.number_changed_at) throw new Error(typed ? SAVE_REFUSALS.number_format : SAVE_REFUSALS.number_required);
    setBusy(true);
    try {
      const bank_country = "bank_country" in details ? details.bank_country : editing?.bank_country ?? null;
      // The number goes to the database and nowhere else; the page keeps only what comes back.
      const row = unwrap(await supabase.rpc("save_bank_payout_account", {
        target_org: orgId,
        target_account: editing?.id ?? null,
        bank_name: form.bank_name,
        account_name: form.account_name,
        bank_country,
        swift: form.swift,
        branch: form.branch,
        instructions: form.instructions,
        account_number: form.account_number,
        account_number_again: form.account_number_again,
        number_kind: bankFieldsFor(bank_country).numberKind,
      }), "save your payout account");
      setForm((current) => ({ ...current, account_number: "", account_number_again: "" }));
      await load();
      setSaved(true);
      return row;
    } catch (failure) {
      throw inWords(failure);
    } finally {
      setBusy(false);
    }
  }

  // Wise's form (PayoutSetupSteps): the fields, and the number apart from them.
  async function saveWise({ bankName, type, currency, details, numberKey, number, numberAgain }) {
    setBusy(true);
    try {
      const row = unwrap(await supabase.rpc("save_wise_payout_account", {
        target_org: orgId,
        target_account: editingId,
        bank_name: bankName,
        recipient_type: type,
        currency,
        details,
        number_key: numberKey,
        account_number: number,
        account_number_again: numberAgain,
      }), "save your payout account");
      await load();
      setSaved(true);
      return row;
    } catch (failure) {
      throw inWords(failure);
    } finally {
      setBusy(false);
    }
  }

  async function savePaypal() {
    const editing = (accounts ?? []).find((account) => account.id === editingId) ?? null;
    const email = paypalEmail(form.paypal_email);
    if (!validPaypalEmail(email)) throw new Error("Enter a valid PayPal email address.");
    if (email !== paypalEmail(form.paypal_email_confirm)) throw new Error("The two email addresses don't match.");
    setBusy(true);
    try {
      const row = unwrap(editing
        ? await supabase.from("factory_payout_accounts").update({ paypal_email: email }).eq("id", editing.id).select().single()
        // The one TSC pays only if there is none yet.
        : await supabase.from("factory_payout_accounts")
          .insert({ org_id: orgId, method: "paypal", paypal_email: email, is_primary: !(accounts ?? []).some((account) => account.is_primary) })
          .select().single(),
      "save your payout account");
      await load();
      setSaved(true);
      return row;
    } catch (failure) {
      if (failure?.cause?.code === "23505") throw new Error("This PayPal account is already on file.");
      throw inWords(failure, new Error("Couldn't save your PayPal account right now. Nothing changed. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function remove(account, promote = null) {
    setSaved(false);
    setBusy(true);
    try {
      // Another account becomes the one TSC pays in the same call (20261030000100).
      unwrap(await supabase.rpc("remove_payout_account", { target: account.id, promote: promote?.id ?? null }), "remove your payout account");
      await load();
    } catch (failure) {
      // Refused in the database (20261029000300): said with the reason.
      throw payoutRemovalError(failure);
    } finally {
      setBusy(false);
    }
  }

  async function makePrimary(account) {
    setSaved(false);
    setBusy(true);
    try {
      unwrap(await supabase.rpc("choose_payout_method", { target_org: orgId, target_account: account.id }), "choose the account TSC pays");
      await load();
    } finally {
      setBusy(false);
    }
  }

  return {
    accounts,
    owed,
    primary: (accounts ?? []).find((account) => account.is_primary) ?? null,
    editingId,
    form,
    busy,
    saved,
    load,
    startEdit,
    setField,
    save,
    saveWise,
    savePaypal,
    remove,
    makePrimary,
    clearSaved: () => setSaved(false),
  };
}
