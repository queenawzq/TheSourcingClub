/**
 * A bank-paid factory's bank accounts (factory_payout_accounts): where Stripe
 * cannot pay out (mainland China, Hong Kong…), staff pay each released
 * earning by bank to the account marked is_primary, "the one TSC pays".
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

const COLUMNS = "id, is_primary, bank_name, account_name, account_number_last4, swift, iban, bank_country, instructions, created_at";

export const blankPayout = (row) => ({
  bank_name: row?.bank_name ?? "",
  account_name: row?.account_name ?? "",
  account_number_last4: row?.account_number_last4 ?? "",
  swift: row?.swift ?? "",
  iban: row?.iban ?? "",
  instructions: row?.instructions ?? "",
});

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

  // The card passes the payout country it was set up for, which the form
  // itself has no field for. Throws, for the card to say in its dialog.
  async function save(details = {}) {
    if (!form.bank_name.trim() || !form.account_name.trim()) {
      throw new Error("Add the bank and the account name so TSC can pay you.");
    }
    const editing = (accounts ?? []).find((account) => account.id === editingId) ?? null;
    setBusy(true);
    try {
      const payload = {
        ...Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim() || null])),
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
    } finally {
      setBusy(false);
    }
  }

  async function remove(account, promote = null) {
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
    save,
    remove,
    makePrimary,
    clearSaved: () => setSaved(false),
  };
}
