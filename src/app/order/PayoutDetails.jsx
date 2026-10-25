/**
 * The factory Payments page, using the tabbed design from the factory app.
 *
 * Earnings and credits come from the real ledgers. Platform charges do not
 * have a table yet, so that tab has an honest empty state instead of the
 * prototype's invented history. Saved billing cards are read from Stripe.
 *
 * TSC holds what a brand funds and pays the factory when the brand approves
 * the step: through Stripe where Stripe can pay out (StripePayoutCard), or by
 * bank transfer from staff to the bank details on this page where it cannot
 * (mainland China, Hong Kong…). Brands never see these bank details.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  CardCvcElement,
  CardExpiryElement,
  CardNumberElement,
  Elements,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { supabase, unwrap } from "../../lib/supabase.js";
import { formatMoney } from "../../lib/money.js";
import { STRIPE_PUBLISHABLE_KEY, listSavedCards, removeSavedCard, startBillingSetup } from "../../lib/domain/stripe.js";
import StripePayoutCard, { PayoutModal } from "./StripePayoutCard.jsx";
import { CreditPurchaseButton } from "./CreditPurchase.jsx";
import "./order.css";
import "./payout.css";

const FIELDS = [
  // Neutral examples: this form is for the countries Stripe cannot pay out
  // to (mainland China, Hong Kong…), where most banks have no IBAN.
  ["bank_name", "Bank", "Your bank's name"],
  ["account_name", "Account name", "As it appears on the account"],
  ["account_number_last4", "Last 4 digits", "1234"],
  ["swift", "SWIFT / BIC", "8 or 11 characters"],
  ["iban", "IBAN", "Only if your bank uses one"],
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

const cardBrand = (brand) => (brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : "Card");
const cardExpiry = (card) => (card.expMonth && card.expYear ? `Expires ${String(card.expMonth).padStart(2, "0")}/${card.expYear}` : "");

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

const BILLING_CARD_OPTIONS = {
  style: {
    base: {
      color: "#0b1020",
      fontFamily: "Satoshi, Arial, sans-serif",
      fontSize: "14px",
      fontWeight: "500",
      "::placeholder": { color: "#8391a8" },
    },
    invalid: { color: "#c62828" },
  },
};

export default function PayoutDetails({ org, isFactory, isOwner = false }) {
  const [tab, setTab] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    return ["billing", "credits"].includes(requested) ? requested : "earnings";
  });
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
  const [cards, setCards] = useState(null);
  const [cardsError, setCardsError] = useState(null);
  const [removingCard, setRemovingCard] = useState(null);
  const [cardBusy, setCardBusy] = useState(false);

  const loadCredits = useCallback(async () => {
    const rows = unwrap(
      await supabase
        .from("credit_ledger")
        .select("id, delta, reason, note, created_at")
        .eq("org_id", org.id)
        .order("created_at", { ascending: false }),
      "load your credits",
    );
    setCredits(rows);
  }, [org.id]);

  // Saved cards live on Stripe, not in the database, so the server lists
  // them. Any member sees them; only an owner adds or removes one.
  const loadCards = useCallback(async () => {
    if (!STRIPE_PUBLISHABLE_KEY) return;
    setCardsError(null);
    try {
      setCards(await listSavedCards(org.id));
    } catch (failure) {
      setCardsError(failure);
    }
  }, [org.id]);

  const load = useCallback(async () => {
    setError(null);
    const [accountResult, ordersResult] = await Promise.all([
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
      loadCredits(),
    ]);

    const payout = unwrap(accountResult, "load your payout account");
    const orders = unwrap(ordersResult, "load your payment orders");
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
    setEarnings(paymentRows.map((payment) => ({ ...payment, order: orderById.get(payment.order_id) })));
  }, [org.id, loadCredits]);

  useEffect(() => {
    let cancelled = false;
    load().catch((failure) => {
      if (!cancelled) setError(failure);
    });
    return () => { cancelled = true; };
  }, [load]);

  useEffect(() => {
    loadCards();
  }, [loadCards]);

  // After a credit purchase: the balance and ledger, read again.
  // A purchase with a new card also saves that card, so Billing reloads too.
  const reloadCredits = useCallback(() => {
    loadCards();
    return loadCredits().catch(setError);
  }, [loadCards, loadCredits]);

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
  const payoutProcessingCents = sumEarnings(visibleEarnings.filter((row) => row.state === "confirmed" && row.release_requested_at));
  const earningsSummary = [
    ["total earnings", sumEarnings(visibleEarnings)],
    ["completed", sumEarnings(visibleEarnings.filter((row) => row.state === "released"))],
    ["pending approval", sumEarnings(visibleEarnings.filter((row) => row.state === "confirmed" && !row.release_requested_at))],
    ["payout processing", payoutProcessingCents],
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

  // The set-up dialog sends the country it asked for; null for a country it
  // does not list, which the factory names in the instructions instead.
  async function saveAccount(details = {}) {
    if (!form.bank_name.trim() || !form.account_name.trim()) {
      setError(new Error("Add the bank and the account name so TSC can pay you."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = {
        org_id: org.id,
        is_primary: true,
        ...Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim() || null])),
        bank_country: "bank_country" in details ? details.bank_country : account?.bank_country ?? null,
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

  async function removeCard() {
    if (!removingCard) return;
    setCardBusy(true);
    setCardsError(null);
    try {
      await removeSavedCard(org.id, removingCard.id);
      setRemovingCard(null);
      setBillingSaved(false);
      await loadCards();
    } catch (failure) {
      setCardsError(failure);
      setRemovingCard(null);
    } finally {
      setCardBusy(false);
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
            displayCurrency={summaryCurrency}
            displayPending={payoutProcessingCents}
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
        <>
          <section className="billing-method-empty">
            <div>
              <strong>Billing methods</strong>
              <p>{isOwner ? "Save a card to use when you buy credits." : "Only an owner of your company can add or remove billing methods."}</p>
              {billingSaved ? <span className="live-payment-notice">Payment method added.</span> : null}
            </div>
            {isOwner ? <button className="primary-btn compact-btn" type="button" disabled={billingBusy || !STRIPE_PUBLISHABLE_KEY} onClick={addBillingMethod}>{billingBusy ? "Opening…" : "+ Add payment method"}</button> : null}
          </section>
          {cardsError ? <p className="projects-empty projects-error" role="alert">{cardsError.message}</p>
            : !STRIPE_PUBLISHABLE_KEY ? <p className="projects-empty">Card payments are not set up on this site yet.</p>
            : cards === null ? <p className="projects-empty">Loading saved cards…</p>
            : cards.length ? (
              <div className="billing-history-list billing-saved-card-list">
                {cards.map((card) => (
                  <article className="billing-history-row" key={card.id}>
                    <div><strong>{cardBrand(card.brand)} ending in {card.last4}</strong><span>{cardExpiry(card)}</span></div>
                    <span className="billing-status">Saved</span>
                    {isOwner ? <button className="secondary-btn compact-btn" type="button" disabled={cardBusy} onClick={() => setRemovingCard(card)}>Remove</button> : <span />}
                  </article>
                ))}
              </div>
            ) : <p className="projects-empty">No saved cards yet.</p>}
        </>
      )}

      {tab === "credits" && (
        <>
          <section className="factory-credit-billing-card">
            <div><span>Credit balance</span><strong>{creditBalance.toLocaleString()} credits</strong><p>Credits earned and used by this factory account.</p></div>
            <div className="factory-credit-billing-action">
              <CreditPurchaseButton orgId={org.id} orgName={org.name} isOwner={isOwner} onPurchased={reloadCredits} />
            </div>
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
        <BillingMethodFlow clientSecret={billingSecret} onClose={() => setBillingSecret(null)} onSaved={() => { setBillingSecret(null); setBillingSaved(true); loadCards(); }} />
      ) : null}

      {removingCard ? (
        <PayoutModal
          title="Remove this card?"
          eyebrow="Billing"
          onClose={() => { if (!cardBusy) setRemovingCard(null); }}
          actions={<><button className="secondary-btn" type="button" disabled={cardBusy} onClick={() => setRemovingCard(null)}>Cancel</button><button className="primary-btn payout-remove-confirm" type="button" disabled={cardBusy} onClick={removeCard}>{cardBusy ? "Removing…" : "Remove card"}</button></>}
        >
          <p className="payout-modal-intro">{cardBrand(removingCard.brand)} ending in {removingCard.last4} will no longer be saved for buying credits.</p>
        </PayoutModal>
      ) : null}
    </section>
  );
}

export function BillingMethodFlow({ clientSecret, onClose, onSaved, intro = "Save a card to use when you buy credits." }) {
  return (
    <Elements stripe={billingStripe()}>
      <BillingMethodModal clientSecret={clientSecret} intro={intro} onClose={onClose} onSaved={onSaved} />
    </Elements>
  );
}

function BillingMethodModal({ clientSecret, intro, onClose, onSaved }) {
  const stripe = useStripe();
  const elements = useElements();
  const [complete, setComplete] = useState({ number: false, expiry: false, cvc: false });
  const [postalCode, setPostalCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const cardComplete = Object.values(complete).every(Boolean);

  async function save() {
    if (!stripe || !elements || !cardComplete || busy) return;
    setBusy(true);
    setProblem(null);
    const result = await stripe.confirmCardSetup(clientSecret, {
      payment_method: {
        card: elements.getElement(CardNumberElement),
        billing_details: postalCode.trim() ? { address: { postal_code: postalCode.trim() } } : undefined,
      },
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
      actions={<><button className="secondary-btn" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-btn" type="button" disabled={!stripe || !cardComplete || busy} onClick={save}>{busy ? "Saving…" : "Save payment method"}</button></>}
    >
      <p className="payout-modal-intro">{intro}</p>
      <div className="billing-card-form">
        <label className="billing-card-field billing-card-number">
          <span>Card number</span>
          <div className="billing-stripe-input">
            <CardNumberElement
              options={{ ...BILLING_CARD_OPTIONS, showIcon: true }}
              onChange={(event) => setComplete((current) => ({ ...current, number: event.complete }))}
            />
          </div>
        </label>
        <label className="billing-card-field">
          <span>Expiration date</span>
          <div className="billing-stripe-input">
            <CardExpiryElement
              options={BILLING_CARD_OPTIONS}
              onChange={(event) => setComplete((current) => ({ ...current, expiry: event.complete }))}
            />
          </div>
        </label>
        <label className="billing-card-field">
          <span>Security code</span>
          <div className="billing-stripe-input">
            <CardCvcElement
              options={BILLING_CARD_OPTIONS}
              onChange={(event) => setComplete((current) => ({ ...current, cvc: event.complete }))}
            />
          </div>
        </label>
        <label className="billing-card-field billing-card-postal">
          <span>ZIP / postal code</span>
          <input
            type="text"
            autoComplete="postal-code"
            value={postalCode}
            placeholder="ZIP / postal code"
            onChange={(event) => setPostalCode(event.target.value)}
          />
        </label>
      </div>
      {problem ? <p className="live-stripe-error" role="alert">{problem}</p> : null}
    </PayoutModal>
  );
}
