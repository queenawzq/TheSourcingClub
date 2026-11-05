/**
 * A manually paid factory's payout methods (factory_payout_accounts): where
 * Stripe cannot pay out (mainland China, Hong Kong…), staff pay each released
 * earning by hand to the one marked is_primary, "the one TSC pays": a bank
 * account, or a Payoneer account given by its email. Nothing calls Payoneer.
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

const COLUMNS = "id, is_primary, method, payoneer_email, bank_name, account_name, account_number_last4, swift, iban, bank_country, instructions, created_at";

export const blankPayout = (row) => ({
  bank_name: row?.bank_name ?? "",
  account_name: row?.account_name ?? "",
  account_number_last4: row?.account_number_last4 ?? "",
  swift: row?.swift ?? "",
  iban: row?.iban ?? "",
  instructions: row?.instructions ?? "",
  method: row?.method ?? "bank",
  payoneer_email: row?.payoneer_email ?? "",
  // Typed twice, never stored: a mistyped address pays a stranger. An email
  // being edited starts confirmed, so only a change has to be typed again.
  payoneer_email_confirm: row?.payoneer_email ?? "",
});

/** The form of 20261104300100's check: what the database will accept. */
export const payoneerEmail = (value) => (value ?? "").trim().toLowerCase();
export const validPayoneerEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payoneerEmail(value)) && payoneerEmail(value).length <= 254;

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

  /** Bank or Payoneer, in the setup dialog. An error from the other one goes with it. */
  const setMethod = (method) => {
    setSaved(false);
    setForm((current) => ({ ...current, method }));
  };

  // The card passes the payout country it was set up for, which the form
  // itself has no field for. Throws, for the card to say in its dialog.
  async function save(details = {}) {
    const editing = (accounts ?? []).find((account) => account.id === editingId) ?? null;
    const { method, payoneer_email, payoneer_email_confirm, ...bank } = form;
    const payoneer = method === "payoneer";
    if (payoneer) {
      if (!validPayoneerEmail(payoneer_email)) throw new Error("Enter a valid email address for your Payoneer account.");
      if (payoneerEmail(payoneer_email) !== payoneerEmail(payoneer_email_confirm)) throw new Error("The two email addresses don't match.");
    } else if (!form.bank_name.trim() || !form.account_name.trim()) {
      throw new Error("Add the bank and the account name so TSC can pay you.");
    }
    setBusy(true);
    try {
      const payload = {
        // A Payoneer row holds only its email; the database refuses bank details on one.
        ...Object.fromEntries(Object.entries(bank).map(([key, value]) => [key, payoneer ? null : value.trim() || null])),
        payoneer_email: payoneer ? payoneerEmail(payoneer_email) : null,
        ...(editing ? {} : { method }),
        bank_country: "bank_country" in details ? details.bank_country : editing?.bank_country ?? null,
      };
      unwrap(editing
        ? await supabase.from("factory_payout_accounts").update(payload).eq("id", editing.id).select().single()
        // A new account: the one TSC pays only if there is none yet.
        : await supabase.from("factory_payout_accounts")
          .insert({ ...payload, org_id: orgId, is_primary: !(accounts ?? []).some((account) => account.is_primary) })
          .select().single(),
      "save your payout account");
      await load();
      setSaved(true);
    } catch (failure) {
      if (payoneer && failure?.cause?.code === "23505") throw new Error("This Payoneer account is already on file.");
      if (failure?.cause?.code === "42501") throw new Error("Only a company owner can change payout methods.");
      throw failure;
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
      unwrap(await supabase.rpc("set_primary_payout_account", { target: account.id }), "choose the account TSC pays");
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
    setMethod,
    save,
    remove,
    makePrimary,
    clearSaved: () => setSaved(false),
  };
}
