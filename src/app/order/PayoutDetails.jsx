/**
 * The factory Payments page, using the tabbed design from the factory app.
 *
 * Earnings and credits come from the real ledgers. Platform charges do not
 * have a table yet, so that tab has an honest empty state instead of the
 * prototype's invented history.
 *
 * TSC holds what a brand funds and pays the factory when the brand approves
 * the step: through Stripe where Stripe can pay out (StripePayoutCard), or by
 * bank transfer from staff to the bank details on this page where it cannot
 * (mainland China, Hong Kong…). Brands never see these bank details.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { supabase, unwrap } from "../../lib/supabase.js";
import { formatMoney } from "../../lib/money.js";
import { STRIPE_PUBLISHABLE_KEY, startBillingSetup } from "../../lib/domain/stripe.js";
import StripePayoutCard, { PayoutModal } from "./StripePayoutCard.jsx";
import "./order.css";
import "./payout.css";

const FIELDS = [
  ["bank_name", "Bank", "Banco de Porto"],
  ["account_name", "Account name", "As it appears on the account"],
  ["account_number_last4", "Last 4 digits", "4417"],
  ["swift", "SWIFT / BIC", "BCOMPTPL"],
  ["iban", "IBAN", "PT50 0002 0123 1234 5678 9015 4"],
];

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

const stripeDateLabel = (value) => dateLabel(value ? value * 1000 : null);

const PAYOUT_STATUS = {
  paid: "Completed",
  pending: "Pending",
  in_transit: "Processing",
  canceled: "Canceled",
  failed: "Failed",
};

/**
 * What the factory gets for a payment. A Stripe charge records what the brand
 * paid, fee included, as received; the factory is paid the step's amount.
 * A bank wire from the old site records what actually arrived.
 */
const factoryAmount = (row) => (row.charged_cents ? row.amount_cents : row.amount_received_cents ?? row.amount_cents);

const blankPayout = (row) => ({
  bank_name: row?.bank_name ?? "",
  account_name: row?.account_name ?? "",
  account_number_last4: row?.account_number_last4 ?? "",
  swift: row?.swift ?? "",
  iban: row?.iban ?? "",
  instructions: row?.instructions ?? "",
});

let billingStripePromise = null;
const billingStripe = () => {
  if (!STRIPE_PUBLISHABLE_KEY) return null;
  billingStripePromise ??= loadStripe(STRIPE_PUBLISHABLE_KEY);
  return billingStripePromise;
};

const BILLING_ELEMENT_APPEARANCE = {
  theme: "flat",
  variables: {
    colorPrimary: "#1a4df2",
    colorBackground: "#ffffff",
    colorText: "#0b1020",
    colorTextSecondary: "#5a6b87",
    colorTextPlaceholder: "#8391a8",
    colorDanger: "#c62828",
    fontFamily: '"Satoshi", Arial, sans-serif',
    fontSizeBase: "15px",
    fontWeightNormal: "400",
    fontWeightMedium: "500",
    spacingUnit: "4px",
    borderRadius: "8px",
  },
  rules: {
    ".Label": {
      color: "#4f6078",
      fontSize: "13px",
      fontWeight: "600",
      marginBottom: "8px",
    },
    ".Input": {
      backgroundColor: "#ffffff",
      border: "1px solid #cad5e2",
      boxShadow: "none",
      padding: "14px 15px",
    },
    ".Input:hover": {
      borderColor: "#aebed0",
    },
    ".Input:focus": {
      borderColor: "#1a4df2",
      boxShadow: "0 0 0 1px #1a4df2",
    },
    ".Input--invalid": {
      borderColor: "#c62828",
      boxShadow: "none",
    },
    ".Tab": {
      backgroundColor: "#ffffff",
      border: "1px solid #cad5e2",
      boxShadow: "none",
      padding: "14px 15px",
    },
    ".Tab:hover": {
      borderColor: "#aebed0",
      color: "#0b1020",
    },
    ".Tab--selected": {
      backgroundColor: "#f2f7fd",
      borderColor: "#1a4df2",
      boxShadow: "0 0 0 1px #1a4df2",
      color: "#1a4df2",
    },
    ".TabLabel": {
      fontWeight: "500",
    },
    ".TabIcon": {
      fill: "#5a6b87",
    },
    ".TabIcon--selected": {
      fill: "#1a4df2",
    },
  },
};

export default function PayoutDetails({ org, isFactory, isOwner = false }) {
  const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get("tab") === "billing" ? "billing" : "earnings");
  const [client, setClient] = useState("All clients");
  const [transactionType, setTransactionType] = useState("all");
  const [account, setAccount] = useState(null);
  const [form, setForm] = useState(null);
  const [earnings, setEarnings] = useState(null);
  const [credits, setCredits] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [stripeBalance, setStripeBalance] = useState(null);
  const [billingSecret, setBillingSecret] = useState(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingSaved, setBillingSaved] = useState(new URLSearchParams(window.location.search).get("billing") === "saved");

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
          .select("id, order_id, amount_cents, amount_received_cents, charged_cents, release_requested_at, currency, state, due_at, sent_at, confirmed_at, released_at, created_at, order_milestones (title)")
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

  // A promise to pay is not an earning. The factory's ledger begins only
  // once the brand's money has cleared and TSC is holding or releasing it.
  const fundedEarnings = (earnings ?? []).filter((row) => ["confirmed", "released"].includes(row.state));
  const clients = useMemo(
    () => ["All clients", ...new Set(fundedEarnings.map((row) => row.order?.orgs?.name).filter(Boolean))],
    [fundedEarnings],
  );
  const visibleEarnings = client === "All clients"
    ? fundedEarnings
    : fundedEarnings.filter((row) => row.order?.orgs?.name === client);
  const summaryCurrency = visibleEarnings[0]?.currency || "USD";
  const sumEarnings = (rows) => rows.reduce((sum, row) => sum + Number(factoryAmount(row) || 0), 0);
  const earningsSummary = [
    ["total earnings", sumEarnings(visibleEarnings)],
    ["completed", sumEarnings(visibleEarnings.filter((row) => row.state === "released"))],
    ["pending approval", sumEarnings(visibleEarnings.filter((row) => row.state === "confirmed" && !row.release_requested_at))],
    ["payout processing", sumEarnings(visibleEarnings.filter((row) => row.state === "confirmed" && row.release_requested_at))],
  ];
  const payoutTransactions = client === "All clients" ? (stripeBalance?.payouts ?? []) : [];
  const transactions = [
    ...visibleEarnings.map((row) => ({
      id: `earning-${row.id}`,
      type: "earning",
      date: row.released_at || row.confirmed_at || row.sent_at || row.due_at || row.created_at,
      title: row.order_milestones?.title || row.order?.order_number || "Order payment",
      meta: `${row.order?.orgs?.name || "Brand"} · ${row.order?.order_number || "Production order"}`,
      status: row.state === "released"
        ? "Completed"
        : row.release_requested_at
          ? "Payout processing"
          : "Pending approval",
      amount: factoryAmount(row),
      currency: row.currency,
      available: row.state === "released",
    })),
    ...payoutTransactions.map((row) => ({
      id: `payout-${row.id}`,
      type: "withdrawal",
      date: row.created ? new Date(row.created * 1000).toISOString() : null,
      title: "Bank withdrawal",
      meta: row.arrival_date ? `Expected ${stripeDateLabel(row.arrival_date)}` : "Connected payout account",
      status: PAYOUT_STATUS[row.status] || row.status,
      amount: -Math.abs(row.amount),
      currency: row.currency,
      available: true,
    })),
  ]
    .filter((row) => transactionType === "all" || row.type === transactionType)
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
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
      setSaved(true);
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount() {
    if (!account?.id) return;
    setBusy(true);
    setError(null);
    try {
      unwrap(await supabase.from("factory_payout_accounts").delete().eq("id", account.id), "remove your payout account");
      setAccount(null);
      setForm(blankPayout());
      setSaved(false);
    } catch (failure) {
      setError(failure);
      throw failure;
    } finally {
      setBusy(false);
    }
  }

  async function addBillingMethod() {
    setBillingBusy(true);
    setError(null);
    try {
      const result = await startBillingSetup(org.id);
      setBillingSecret(result.clientSecret);
    } catch (failure) {
      setError(failure);
    } finally {
      setBillingBusy(false);
    }
  }

  return (
    <section className="billing-history-page live-payments-page">
      <header className="billing-history-header"><div><h1>Payments</h1></div></header>

      <div className="billing-controls">
        <div className="settings-access-tabs billing-tabs" role="tablist" aria-label="Payment activity type">
          {[["earnings", "Earnings"], ["billing", "Billing"], ["credits", "Credits"]].map(([key, label]) => (
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
          <div className="project-summary-strip billing-payment-strip factory-earnings-summary" aria-label="Earnings summary">
            {earningsSummary.map(([label, amount], index) => (
              <div className={`metric${index === 0 ? " highlight" : ""}`} key={label}>
                <strong>{formatMoney(amount, summaryCurrency)}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <StripePayoutCard
            org={org}
            isOwner={isOwner}
            onBalanceChange={setStripeBalance}
            manualAccount={account}
            manualForm={form}
            manualFields={FIELDS}
            onManualFieldChange={set}
            onSaveManual={saveAccount}
            onDeleteManual={deleteAccount}
            manualBusy={busy}
            manualSaved={saved}
          />
          <section className="payout-transactions-section" aria-labelledby="transactions-heading">
            <div className="payout-transactions-header">
              <div>
                <h2 id="transactions-heading">Transactions</h2>
                <p>Earnings added to your balance and withdrawals sent to your bank.</p>
              </div>
              <div className="payout-transaction-filters" role="group" aria-label="Filter transactions">
                {[["all", "All"], ["earning", "Earnings"], ["withdrawal", "Withdrawals"]].map(([key, label]) => (
                  <button key={key} type="button" className={transactionType === key ? "active" : ""} aria-pressed={transactionType === key} onClick={() => setTransactionType(key)}>{label}</button>
                ))}
              </div>
            </div>
            {transactions.length ? (
              <div className="payout-transaction-table">
                <div className="payout-transaction-labels" aria-hidden="true"><span>Date</span><span>Type / details</span><span>Status</span><span>Amount</span></div>
                {transactions.map((row) => (
                  <article className="payout-transaction-row" key={row.id}>
                    <time dateTime={row.date || undefined}>{dateLabel(row.date)}</time>
                    <div className="payout-transaction-details">
                      <span className={`payout-transaction-type ${row.type}`}>{row.type === "earning" ? "Earning" : "Withdrawal"}</span>
                      <div><strong>{row.title}</strong><span>{row.meta}</span></div>
                    </div>
                    <span className={`billing-status payout-status-${row.status.toLowerCase().replaceAll(" ", "-")}`}>{row.status}</span>
                    <strong className={row.amount < 0 ? "payout-amount-negative" : row.available ? "payout-amount-positive" : "payout-amount-pending"}>
                      {row.amount < 0 ? "−" : row.available ? "+" : ""}{formatMoney(Math.abs(row.amount), row.currency)}
                    </strong>
                  </article>
                ))}
              </div>
            ) : <p className="projects-empty">{transactionType === "withdrawal" ? "No withdrawals yet." : "No funded earnings yet. Payments appear here after a brand funds a production step."}</p>}
          </section>
        </>
      )}

      {tab === "billing" && (
        <section className="billing-method-empty">
          <div>
            <strong>Billing methods</strong>
            <p>Save a card to use when you purchase credits.</p>
            {billingSaved ? <span className="live-payment-notice">Payment method added.</span> : null}
          </div>
          {isOwner ? <button className="primary-btn compact-btn" type="button" disabled={billingBusy || !STRIPE_PUBLISHABLE_KEY} onClick={addBillingMethod}>{billingBusy ? "Opening…" : "+ Add payment method"}</button> : null}
        </section>
      )}

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

      {billingSecret ? (
        <BillingMethodFlow clientSecret={billingSecret} onClose={() => setBillingSecret(null)} onSaved={() => { setBillingSecret(null); setBillingSaved(true); }} />
      ) : null}
    </section>
  );
}

export function BillingMethodFlow({ clientSecret, onClose, onSaved, intro = "Save a card to use when you choose to purchase credits." }) {
  return (
    <Elements stripe={billingStripe()} options={{ clientSecret, appearance: BILLING_ELEMENT_APPEARANCE }}>
      <BillingMethodModal intro={intro} onClose={onClose} onSaved={onSaved} />
    </Elements>
  );
}

function BillingMethodModal({ intro, onClose, onSaved }) {
  const stripe = useStripe();
  const elements = useElements();
  const [complete, setComplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  async function save() {
    if (!stripe || !elements || !complete || busy) return;
    setBusy(true);
    setProblem(null);
    const result = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
      confirmParams: { return_url: `${window.location.origin}${window.location.pathname}?tab=billing&billing=saved` },
    });
    if (result.error) setProblem(result.error.message || "The payment method could not be saved.");
    else onSaved();
    setBusy(false);
  }

  return (
    <PayoutModal
      title="Add payment method"
      eyebrow="Billing"
      onClose={onClose}
      actions={<><button className="secondary-btn" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-btn" type="button" disabled={!stripe || !complete || busy} onClick={save}>{busy ? "Saving…" : "Save payment method"}</button></>}
    >
      <p className="payout-modal-intro">{intro}</p>
      <PaymentElement options={{ layout: "tabs", terms: { card: "never" } }} onChange={(event) => setComplete(event.complete)} />
      {problem ? <p className="live-stripe-error" role="alert">{problem}</p> : null}
    </PayoutModal>
  );
}
