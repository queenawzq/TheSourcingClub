/**
 * Where a factory's money goes.
 *
 * This screen exists because the e2e run found the hole it fills: the brand's
 * "I have sent this payment" button is correctly disabled while there is no
 * destination, and nothing anywhere let a factory supply one. A table nothing
 * writes to is the same defect as a screen nothing links to.
 *
 * We deliberately do not store a full account number. The platform is not in
 * the payment path, so it has no use for one, and holding every factory's
 * banking details would create a breach class the rest of this schema does not
 * have. The last four digits identify the account on a statement; anything
 * more that a factory wants a brand to see goes in the free-text instructions,
 * which is its own decision about its own data rather than ours about
 * everyone's.
 */
import React, { useCallback, useEffect, useState } from "react";
import { supabase, unwrap } from "../../lib/supabase.js";
import { useRouter } from "../../lib/router.jsx";
import "./order.css";

const FIELDS = [
  ["bank_name", "Bank", "Banco de Porto"],
  ["account_name", "Account name", "As it appears on the account"],
  ["account_number_last4", "Last 4 digits", "4417"],
  ["swift", "SWIFT / BIC", "BCOMPTPL"],
  ["iban", "IBAN", "PT50 0002 0123 1234 5678 9015 4"],
];

export default function PayoutDetails({ org, isFactory }) {
  const { navigate } = useRouter();
  const [form, setForm] = useState(null);
  const [existingId, setExistingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const row = unwrap(
      await supabase
        .from("factory_payout_accounts")
        .select("id, bank_name, account_name, account_number_last4, swift, iban, bank_country, instructions")
        .eq("org_id", org.id)
        .eq("is_primary", true)
        .maybeSingle(),
      "load your payment details",
    );
    setExistingId(row?.id ?? null);
    setForm({
      bank_name: row?.bank_name ?? "",
      account_name: row?.account_name ?? "",
      account_number_last4: row?.account_number_last4 ?? "",
      swift: row?.swift ?? "",
      iban: row?.iban ?? "",
      instructions: row?.instructions ?? "",
    });
  }, [org.id]);

  useEffect(() => { load().catch(setError); }, [load]);

  if (!isFactory) {
    return (
      <div className="rfq-page">
        <h1>Not for this side</h1>
        <p className="ob-hint">Brands pay; factories are paid. This page is for a factory account.</p>
        <button type="button" className="quiet-btn" onClick={() => navigate("/")}>← Back</button>
      </div>
    );
  }

  if (error && !form) {
    return (
      <div className="rfq-page">
        <h1>Payment details</h1>
        <p className="ob-error">{error.message}</p>
      </div>
    );
  }
  if (!form) return <div className="rfq-page"><div className="spinner" aria-hidden="true" /></div>;

  const set = (key) => (event) => {
    setSaved(false);
    setForm((current) => ({ ...current, [key]: event.target.value }));
  };

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        org_id: org.id,
        is_primary: true,
        ...Object.fromEntries(
          Object.entries(form).map(([key, value]) => [key, value.trim() === "" ? null : value.trim()]),
        ),
      };
      if (existingId) {
        unwrap(
          await supabase.from("factory_payout_accounts").update(payload).eq("id", existingId).select().single(),
          "save your payment details",
        );
      } else {
        const created = unwrap(
          await supabase.from("factory_payout_accounts").insert(payload).select().single(),
          "save your payment details",
        );
        setExistingId(created.id);
      }
      setSaved(true);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rfq-page">
      <button type="button" className="quiet-btn" onClick={() => navigate("/orders")}>
        ← Back to production orders
      </button>

      <header className="rfq-page-head">
        <div>
          <h1>Where you get paid</h1>
          <p>
            Brands see this when a payment on one of your orders falls due, and not before.
            Until it is filled in, nobody can pay you.
          </p>
        </div>
      </header>

      <section className="detail-card">
        {FIELDS.map(([key, label, placeholder]) => (
          <React.Fragment key={key}>
            <label className="ob-label" htmlFor={`payout-${key}`}>{label}</label>
            <input id={`payout-${key}`} data-field={`payout_${key}`} type="text"
                   value={form[key]} placeholder={placeholder} onChange={set(key)} />
          </React.Fragment>
        ))}

        <label className="ob-label" htmlFor="payout-instructions">Anything else a brand needs</label>
        <textarea id="payout-instructions" data-field="payout_instructions" rows={3}
                  value={form.instructions} onChange={set("instructions")}
                  placeholder="Intermediary bank, a reference format you prefer, anything unusual about your account." />

        <p className="ob-hint">
          We do not ask for your full account number and do not store one. Only staff confirming a
          payment, and a brand that currently owes you money, can see any of this.
        </p>

        {error ? <p className="ob-error">{error.message}</p> : null}

        <div className="order-actions">
          <button type="button" className="primary-btn" data-testid="save-payout"
                  disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save payment details"}
          </button>
          {saved ? <span className="ob-hint">Saved. Brands can pay you now.</span> : null}
        </div>
      </section>
    </div>
  );
}
