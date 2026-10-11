/**
 * The factory Payments page, using the tabbed design from the factory app.
 *
 * Earnings and credits come from the real ledgers. Platform charges do not
 * have a table yet, so that tab has an honest empty state instead of the
 * prototype's invented history. The payout account remains editable from the
 * Earnings tab because brands cannot pay an order until it exists.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, unwrap } from "../../lib/supabase.js";
import { formatMoney } from "../../lib/money.js";
import "./order.css";

const FIELDS = [
  ["bank_name", "Bank", "Banco de Porto"],
  ["account_name", "Account name", "As it appears on the account"],
  ["account_number_last4", "Last 4 digits", "4417"],
  ["swift", "SWIFT / BIC", "BCOMPTPL"],
  ["iban", "IBAN", "PT50 0002 0123 1234 5678 9015 4"],
];

const PAYMENT_STATUS = {
  not_due: "Scheduled",
  due: "Due",
  sent: "Transfer sent",
  confirmed: "Confirmed",
  released: "Received",
  cancelled: "Cancelled",
};

const CREDIT_REASON = {
  onboarding_grant: "Verified onboarding bonus",
  referral_grant: "Referral bonus",
  purchase: "Credit purchase",
  admin_adjustment: "Account adjustment",
  quote_submission: "Quote submitted",
  refund: "Credit refund",
};

const dateLabel = (value) => value
  ? new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  : "Date pending";

const blankPayout = (row) => ({
  bank_name: row?.bank_name ?? "",
  account_name: row?.account_name ?? "",
  account_number_last4: row?.account_number_last4 ?? "",
  swift: row?.swift ?? "",
  iban: row?.iban ?? "",
  instructions: row?.instructions ?? "",
});

export default function PayoutDetails({ org, isFactory }) {
  const [tab, setTab] = useState("earnings");
  const [client, setClient] = useState("All clients");
  const [account, setAccount] = useState(null);
  const [form, setForm] = useState(null);
  const [earnings, setEarnings] = useState(null);
  const [credits, setCredits] = useState(null);
  const [editingAccount, setEditingAccount] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    const [accountResult, ordersResult, creditsResult] = await Promise.all([
      supabase
        .from("factory_payout_accounts")
        .select("id, bank_name, account_name, account_number_last4, swift, iban, bank_country, instructions")
        .eq("org_id", org.id)
        .eq("is_primary", true)
        .maybeSingle(),
      supabase
        .from("production_orders")
        .select("id, order_number, brand_org_id, orgs!production_orders_brand_org_id_fkey (name)")
        .eq("factory_org_id", org.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("credit_ledger")
        .select("id, delta, reason, note, created_at")
        .eq("org_id", org.id)
        .order("created_at", { ascending: false }),
    ]);

    const payout = unwrap(accountResult, "load your payout account");
    const orders = unwrap(ordersResult, "load your payment orders");
    const creditRows = unwrap(creditsResult, "load your credits");
    const orderById = new Map(orders.map((order) => [order.id, order]));

    let paymentRows = [];
    if (orders.length) {
      paymentRows = unwrap(
        await supabase
          .from("order_payments")
          .select("id, order_id, amount_cents, amount_received_cents, currency, state, due_at, sent_at, confirmed_at, released_at, created_at, order_milestones (title)")
          .in("order_id", orders.map((order) => order.id))
          .order("created_at", { ascending: false }),
        "load your earnings",
      );
    }

    setAccount(payout);
    setForm(blankPayout(payout));
    setCredits(creditRows);
    setEarnings(paymentRows.map((payment) => ({ ...payment, order: orderById.get(payment.order_id) })));
  }, [org.id]);

  useEffect(() => {
    let cancelled = false;
    load().catch((failure) => {
      if (!cancelled) setError(failure);
    });
    return () => { cancelled = true; };
  }, [load]);

  const clients = useMemo(
    () => ["All clients", ...new Set((earnings ?? []).map((row) => row.order?.orgs?.name).filter(Boolean))],
    [earnings],
  );
  const visibleEarnings = client === "All clients"
    ? (earnings ?? [])
    : (earnings ?? []).filter((row) => row.order?.orgs?.name === client);
  const totalEarned = (earnings ?? [])
    .filter((row) => row.state === "released")
    .reduce((sum, row) => sum + (row.amount_received_cents ?? row.amount_cents), 0);
  const pendingRelease = (earnings ?? [])
    .filter((row) => ["sent", "confirmed"].includes(row.state))
    .reduce((sum, row) => sum + row.amount_cents, 0);
  const nextPayment = (earnings ?? []).find((row) => ["due", "not_due"].includes(row.state));
  const creditBalance = (credits ?? []).reduce((sum, row) => sum + row.delta, 0);

  if (!isFactory) {
    return <section className="billing-history-page"><h1>Payments</h1><p className="projects-empty">Factory payment tools are not available on a brand account.</p></section>;
  }

  if (error && (!earnings || !credits || !form)) {
    return (
      <section className="billing-history-page live-payments-page">
        <header className="billing-history-header"><div><h1>Payments</h1></div></header>
        <p className="projects-empty projects-error" role="alert">{error.message}</p>
      </section>
    );
  }

  if (!earnings || !credits || !form) {
    return (
      <section className="billing-history-page live-payments-page">
        <div className="spinner" aria-hidden="true" />
        <p>Loading payments…</p>
      </section>
    );
  }

  const set = (key) => (event) => {
    setSaved(false);
    setForm((current) => ({ ...current, [key]: event.target.value }));
  };

  async function saveAccount() {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        org_id: org.id,
        is_primary: true,
        ...Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim() || null])),
      };
      const result = account?.id
        ? await supabase.from("factory_payout_accounts").update(payload).eq("id", account.id).select().single()
        : await supabase.from("factory_payout_accounts").insert(payload).select().single();
      const updated = unwrap(result, "save your payout account");
      setAccount(updated);
      setForm(blankPayout(updated));
      setEditingAccount(false);
      setSaved(true);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="billing-history-page live-payments-page">
      <header className="billing-history-header"><div><h1>Payments</h1></div></header>

      <div className="billing-controls">
        <div className="settings-access-tabs billing-tabs" role="tablist" aria-label="Payment activity type">
          {[["earnings", "Earnings"], ["payments", "Payments"], ["credits", "Credits"]].map(([key, label]) => (
            <button className={tab === key ? "active" : ""} type="button" role="tab" aria-selected={tab === key}
                    onClick={() => { setTab(key); setClient("All clients"); }} key={key}>{label}</button>
          ))}
        </div>
        {tab === "earnings" ? (
          <label>
            <span>Filter by client</span>
            <select value={clients.includes(client) ? client : "All clients"} onChange={(event) => setClient(event.target.value)}>
              {clients.map((name) => <option value={name} key={name}>{name}</option>)}
            </select>
          </label>
        ) : <span className="live-payments-control-spacer" />}
      </div>

      {tab === "earnings" && (
        <>
          <div className="factory-project-summary-card factory-billing-summary-strip" aria-label="Earnings summary">
            <div className="metric"><strong>{formatMoney(totalEarned)}</strong><span>Total earned</span></div>
            <div className="metric"><strong>{formatMoney(pendingRelease)}</strong><span>Pending release</span></div>
            <div className="metric highlight"><strong>{nextPayment ? formatMoney(nextPayment.amount_cents, nextPayment.currency) : "—"}</strong><span>Next payment</span></div>
          </div>

          <section className="live-payout-method-card">
            <div>
              <span>Payout account</span>
              <strong>{account ? `${account.bank_name || "Bank account"}${account.account_number_last4 ? ` ending in ${account.account_number_last4}` : ""}` : "No payout account added"}</strong>
              <p>Brands only see these instructions when a payment is due.</p>
            </div>
            <button className="secondary-btn compact-btn" type="button" onClick={() => setEditingAccount((open) => !open)}>
              {editingAccount ? "Cancel" : account ? "Edit details" : "Add details"}
            </button>
          </section>

          {editingAccount && (
            <section className="live-payout-form">
              <div className="live-payout-form-grid">
                {FIELDS.map(([key, label, placeholder]) => (
                  <label key={key}><span>{label}</span><input id={`payout-${key}`} data-field={`payout_${key}`} value={form[key]} placeholder={placeholder} onChange={set(key)} /></label>
                ))}
              </div>
              <label>
                <span>Anything else a brand needs</span>
                <textarea id="payout-instructions" data-field="payout_instructions" rows={3} value={form.instructions}
                          onChange={set("instructions")} placeholder="Intermediary bank or transfer instructions." />
              </label>
              <p>For security, use the last four digits above. Only provide additional account information when your bank requires it.</p>
              <button className="primary-btn" type="button" data-testid="save-payout" disabled={busy} onClick={saveAccount}>{busy ? "Saving…" : "Save payout details"}</button>
            </section>
          )}

          {saved && <p className="live-payment-notice">Payout details saved.</p>}
          {visibleEarnings.length ? (
            <div className="billing-history-list">
              {visibleEarnings.map((row) => (
                <article className="billing-history-row" key={row.id}>
                  <div>
                    <strong>{row.order_milestones?.title || row.order?.order_number || "Order payment"}</strong>
                    <span>{row.order?.orgs?.name || "Brand"} · {row.order?.order_number || "Production order"} · {dateLabel(row.released_at || row.confirmed_at || row.sent_at || row.due_at || row.created_at)}</span>
                  </div>
                  <span className="billing-status">{PAYMENT_STATUS[row.state] || row.state}</span>
                  <strong>{formatMoney(row.amount_received_cents ?? row.amount_cents, row.currency)}</strong>
                </article>
              ))}
            </div>
          ) : <p className="projects-empty">No earnings yet. Payment activity appears here once a production order reaches a payment milestone.</p>}
        </>
      )}

      {tab === "payments" && <p className="projects-empty">No platform payments yet. Fees and service charges will appear here when they are recorded.</p>}

      {tab === "credits" && (
        <>
          <section className="factory-credit-billing-card">
            <div><span>Credit balance</span><strong>{creditBalance.toLocaleString()} credits</strong><p>Credits earned and used by this factory account.</p></div>
          </section>
          {credits.length ? (
            <div className="billing-history-list">
              {credits.map((row) => (
                <article className="billing-history-row" key={row.id}>
                  <div><strong>{CREDIT_REASON[row.reason] || row.reason}</strong><span>{row.note || dateLabel(row.created_at)}</span></div>
                  <span className="billing-status">{row.delta > 0 ? "Earned" : "Used"}</span>
                  <strong>{row.delta > 0 ? "+" : ""}{row.delta.toLocaleString()} credits</strong>
                </article>
              ))}
            </div>
          ) : <p className="projects-empty">No credit activity yet.</p>}
        </>
      )}

      {error && <p className="projects-empty projects-error" role="alert">{error.message}</p>}
    </section>
  );
}
