import { payoutUsdMinor } from "../../lib/payout-display.mjs";
/**
 * The factory Payments page, using the tabbed design from the factory app.
 *
 * Earnings and credits come from the real ledgers. Platform charges do not
 * have a table yet, so that tab has an honest empty state instead of the
 * prototype's invented history. Saved billing cards are read from Stripe.
 *
 * TSC holds what a brand funds and pays the factory when the brand approves
 * the step: through Stripe where Stripe can pay out (StripePayoutCard), and
 * through Wise or PayPal to the details on this page where it cannot (mainland
 * China…), with staff marking it paid by bank as the fallback. Brands never see
 * these details. No screen here names Stripe.
 */
import PaymentHelp from "./PaymentHelp.jsx";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  CardCvcElement,
  CardExpiryElement,
  CardNumberElement,
  Elements,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { supabase } from "../../lib/supabase.js";
import { byCreated, readByIds, readEveryPage } from "../../lib/read-pages.js";
import { can } from "../../lib/domain/org.js";
import { useUiLanguage } from "../../lib/ui-language.js";
import { formatMoney } from "../../lib/money.js";
import { payoutFeeSentence } from "../../shared/withdrawal-fees.mjs";
import { STRIPE_PUBLISHABLE_KEY, listSavedCards, refreshClearingDates, removeSavedCard, startBillingSetup } from "../../lib/domain/stripe.js";
import { FACTORY_INVITE_INTRO, INVITE_NOT_EMAILED, creditHistory, inviteNotice, sendInvite } from "../../lib/domain/credits.js";
import { InviteFactoryModal } from "../../factory-prototype/main.jsx";
import StripePayoutCard, { PayoutCardPlaceholder, PayoutModal } from "./StripePayoutCard.jsx";
import { useManualPayouts } from "./use-manual-payouts.js";
import { CreditPurchaseButton } from "./CreditPurchase.jsx";
import { askedWithdrawalRows, clearingFor, clearingNote, earningPaid, earningStatus, factoryAmount, figuresByPayment, grossAmount, legacyOnItsWayCents, owedClearingNote, payoutFee, heldOnCancelledOrder, stripeRelevant, summaryFrom, withStripePart, withdrawalProblem, withdrawalRows } from "./payment-summary.mjs";
import { useWithdrawalBalance } from "./WithdrawFromBalance.jsx";
import { payoutFailureSentence } from "../../shared/payout-failure-words.mjs";
import "./order.css";
import "./payout.css";

const dateLabel = (value) => value
  ? new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  : "Date pending";

// Stripe's arrival_date is a day (midnight UTC), not an instant: read in the
// Americas as an instant it is the day before.
const stripeDateLabel = (value) => value
  ? new Date(value * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
  : "Date pending";

/** "Bank account ····6789", from the methods Stripe lists; nothing for one since removed. */
const payoutDestination = (payout, balance) => {
  const method = balance?.methods?.find((item) => item.id === payout.destination);
  return method?.last4 ? `${method.type === "card" ? "Debit card" : "Bank account"} ····${method.last4}` : null;
};

const cardBrand = (brand) => (brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : "Card");
const cardExpiry = (card) => (card.expMonth && card.expYear ? `Expires ${String(card.expMonth).padStart(2, "0")}/${card.expYear}` : "");

/**
 * What a factory paid through Stripe is told while Stripe has not given its
 * withdrawals: slow, or failed. The figures are the payments' own and never wait.
 */
const STRIPE_FIGURES_TEXT = {
  slow: "Still loading.",
  failed: "Couldn't load withdrawals. Try again shortly.",
};

/** A grey bar where a figure will be, sized like it; nothing is guessed. */
const FigurePlaceholder = ({ label, className = "payout-figure-placeholder" }) => (
  <span className={className} role="status" aria-label={`Loading ${label}`} />
);

/** Rows shaped like the list they stand in for, until its sources answer. */
function RowPlaceholders({ className, cells, label }) {
  return (
    <div role="status" aria-label={`Loading ${label}`}>
      {[0, 1, 2].map((row) => (
        <div className={`${className} payout-row-placeholder`} aria-hidden="true" key={row}>
          {Array.from({ length: cells }, (_, cell) => <span key={cell} />)}
        </div>
      ))}
    </div>
  );
}

const PAYOUT_STATUS = {
  // A withdrawal from the factory's Stripe balance that reached its bank.
  paid: "Paid out to your bank",
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

/**
 * The tab in the address (`?tab=credits`), so a reload or a shared link opens
 * the same tab: it stayed /payout, which opens Earnings. Replaced, not pushed:
 * Back leaves the page rather than stepping through its tabs. The one-time
 * notices (`invite`, `billing`) are dropped so they do not show again.
 */
function showTabInAddress(key) {
  const url = new URL(window.location.href);
  if (key === "earnings") url.searchParams.delete("tab");
  else url.searchParams.set("tab", key);
  url.searchParams.delete("invite");
  url.searchParams.delete("billing");
  window.history.replaceState(window.history.state, "", url);
}

export default function PayoutDetails({ org, isFactory, isOwner = false }) {
  // A select's options are not reached by the language layer, so "All clients" is drawn here.
  const uiLanguage = useUiLanguage();
  // Payouts stay with owners; cards and credits are Settings access.
  const canSettings = can(org, "settingsAccess");
  const [tab, setTab] = useState(() => {
    const asked = new URLSearchParams(window.location.search).get("tab");
    return ["billing", "credits"].includes(asked) ? asked : "earnings";
  });
  const [inviteOpen, setInviteOpen] = useState(false);
  // What just happened on the Credits tab: an invite sent (here, or from the
  // dashboard, which links here with ?invite=sent or why it was not emailed)
  // or credits bought.
  const [notice, setNotice] = useState(() => {
    const invite = new URLSearchParams(window.location.search).get("invite");
    if (invite === "sent") return inviteNotice({ emailed: true });
    return ["saved", ...INVITE_NOT_EMAILED].includes(invite) ? inviteNotice({ emailed: false, reason: invite }) : null;
  });
  const [client, setClient] = useState("All clients");
  const [transactionType, setTransactionType] = useState("all");
  // The bank accounts staff pay where Stripe cannot (use-manual-payouts.js).
  const payouts = useManualPayouts(org.id);
  // null until each read answers. Each source has its own error, so one that
  // fails does not hide what the others found.
  const [earnings, setEarnings] = useState(null);
  // The one balance (factory_balance()), all clients, read with the earnings:
  // the four figures, the card's balance and each row's word come from it.
  const [balanceFigures, setBalanceFigures] = useState(null);
  // The same for the client chosen in the filter; null until it answers.
  const [clientFigures, setClientFigures] = useState(null);
  // Withdrawals from the balance (Wise, PayPal, bank): the same source as its figure.
  const fromBalance = useWithdrawalBalance(org.id, isFactory, payouts.primary?.id);
  const [earningsError, setEarningsError] = useState(null);
  const [credits, setCredits] = useState(null);
  const [creditsError, setCreditsError] = useState(null);
  const [accountsError, setAccountsError] = useState(null);
  // For an action on the page (billing, a credit reload).
  const [error, setError] = useState(null);
  // undefined until the payout card has asked Stripe; null when it cannot.
  const [stripeBalance, setStripeBalance] = useState(undefined);
  // What the balance answered when Stripe could not be read: the database's
  // figures, its Stripe part left out (stripe-connect `balance`, 502).
  const [stripeFallback, setStripeFallback] = useState(null);
  const balanceChanged = useCallback((value, fallback = null) => {
    setStripeBalance(value);
    setStripeFallback(fallback);
  }, []);
  const [stripeStatus, setStripeStatus] = useState("loading");
  // Where nobody reads Stripe here (a member, or no Stripe account: the card
  // says "none"), the page asks the server to record its card payments'
  // clearing dates before reading the balance; at most once a minute.
  const clearingPath = useRef(false);
  const clearingAskedAt = useRef(0);
  // Whether the payout card has its final shape (it knows how the factory is
  // paid, from our database). Figures below it wait for that, never for
  // Stripe, so the card settling can only move placeholders.
  const [cardSettled, setCardSettled] = useState(false);
  const settleCard = useCallback(() => {
    setCardSettled(true);
  }, []);
  // The card reads its account and Stripe again when Earnings is opened
  // again, so its figures wait again rather than show the last answer.
  const leaveEarnings = () => {
    setCardSettled(false);
    setStripeBalance(undefined);
    setStripeFallback(null);
    setStripeStatus("loading");
  };
  const [billingSecret, setBillingSecret] = useState(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingSaved, setBillingSaved] = useState(new URLSearchParams(window.location.search).get("billing") === "saved");
  const [cards, setCards] = useState(null);
  const [cardsError, setCardsError] = useState(null);
  const [removingCard, setRemovingCard] = useState(null);
  const [cardBusy, setCardBusy] = useState(false);

  // The ledger and the factory's invites (creditHistory), read again after
  // a purchase as well as on load.
  const loadCredits = useCallback(async () => {
    setCredits(await creditHistory(org.id));
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

  // Earnings, credits and payout accounts are read side by side, and each
  // shows as soon as it answers: one spinner held the whole page, and the
  // Stripe balance, for the slowest of the three.
  const loadEarnings = useCallback(async () => {
    const orders = await readEveryPage(
      () => supabase
        .from("production_orders")
        .select("id, order_number, status, brand_org_id, orgs!production_orders_brand_org_id_fkey (name)")
        .eq("factory_org_id", org.id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false }),
      "load your payment orders",
    );
    const orderById = new Map(orders.map((order) => [order.id, order]));
    if (clearingPath.current && Date.now() - clearingAskedAt.current > 60_000) {
      clearingAskedAt.current = Date.now();
      // Best effort: the figures are read whatever it answers.
      await refreshClearingDates(org.id).catch(() => null);
    }
    const figures = await supabase.rpc("factory_balance", { target_org: org.id });
    if (figures.error) throw new Error("Couldn't load your balance. Try again shortly.");

    // By id batches, a page at a time: past ~195 orders one `in` list was
    // longer than the address allows (read-pages.js).
    const paymentRows = (
      await readByIds(
        orders.map((order) => order.id),
        (batch) => supabase
          .from("order_payments")
          .select("id, order_id, amount_cents, amount_received_cents, charged_cents, payout_fee_cents, stripe_transfer_id, withdrawal_pool, release_requested_at, funds_available_at, released_by, released_note, currency, state, due_at, sent_at, confirmed_at, released_at, created_at, order_milestones (title), payoneer_payouts (paid_to_email, payoneer_payment_id), bank_payouts (paid_to_bank, paid_to_last4), provider_payouts (id, provider, status, paid_to, amount_cents, currency, failure_code, failure_detail, details_asked_at, money_left_at, asked_to_check, created_at, updated_at, paid_at), payment_takes (status)")
          .in("order_id", batch)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false }),
        "load your earnings",
      )
    ).sort((a, b) => byCreated(b, a));

    setEarnings(paymentRows.map((payment) => ({ ...payment, order: orderById.get(payment.order_id) })));
    setBalanceFigures(figures.data);
    setEarningsError(null);
  }, [org.id]);

  // The card has said nobody reads Stripe here: read again, with the dates asked for first.
  useEffect(() => {
    if (stripeStatus !== "none" || clearingPath.current) return;
    clearingPath.current = true;
    loadEarnings().catch(setEarningsError);
  }, [stripeStatus, loadEarnings]);

  // One client's figures: the same function, narrowed to that brand's orders.
  const loadClientFigures = useCallback(async () => {
    if (client === "All clients") return;
    const { data, error: failure } = await supabase.rpc("factory_balance", { target_org: org.id, target_client: client });
    if (failure) throw new Error("Couldn't load your balance. Try again shortly.");
    setClientFigures({ client, figures: data });
  }, [org.id, client]);

  useEffect(() => {
    loadClientFigures().catch(setEarningsError);
  }, [loadClientFigures]);

  useEffect(() => {
    let cancelled = false;
    const failed = (setFailure) => (failure) => {
      if (!cancelled) setFailure(failure);
    };
    payouts.load().catch(failed(setAccountsError));
    loadEarnings().catch(failed(setEarningsError));
    loadCredits().catch(failed(setCreditsError));
    return () => { cancelled = true; };
  }, [payouts.load, loadEarnings, loadCredits]);

  useEffect(() => {
    loadCards();
  }, [loadCards]);

  // The figures are the payments' states, which the brand and staff change:
  // approved, or paid out while this page is open. RLS applies per
  // subscriber. The factory's own Stripe money is kept from the last Stripe
  // read (withStripePart), so this never asks Stripe again.
  useEffect(() => {
    if (!isFactory) return undefined;
    const refresh = () => {
      loadEarnings().catch(setEarningsError);
      loadClientFigures().catch(setEarningsError);
    };
    const channel = supabase
      .channel(`factory-earnings:${org.id}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "order_payments" }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "order_payments" }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "production_orders" }, refresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "provider_payouts" }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "provider_payouts" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "factory_withdrawals", filter: `org_id=eq.${org.id}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "stripe_withdrawals", filter: `org_id=eq.${org.id}` }, refresh)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isFactory, org.id, loadEarnings, loadClientFigures]);

  // After a credit purchase: the balance and ledger, read again.
  // A purchase with a new card also saves that card, so Billing reloads too.
  const reloadCredits = useCallback(() => {
    loadCards();
    return loadCredits().catch(setError);
  }, [loadCards, loadCredits]);

  // A promise to pay is not an earning. The factory's ledger begins only
  // once the brand's money has cleared and TSC is holding or releasing it.
  // Until the earnings answer, these are empty and nothing below draws them.
  const fundedEarnings = (earnings ?? []).filter((row) => ["confirmed", "released"].includes(row.state));
  const clients = useMemo(
    () => [...new Map((earnings ?? []).filter((row) => row.order?.brand_org_id)
      .map((row) => [row.order.brand_org_id, { id: row.order.brand_org_id, name: row.order.orgs?.name || "Brand" }])).values()],
    [earnings],
  );
  const visibleEarnings = client === "All clients"
    ? fundedEarnings
    : fundedEarnings.filter((row) => row.order?.brand_org_id === client);
  const earningsShown = cardSettled || accountsError ? earnings : null;
  // Whether the withdrawals wait for Stripe at all, and if so, what to say
  // while they cannot be shown. Only an owner reads them.
  const needsStripe = stripeRelevant(earningsShown);
  const stripeFigures = !needsStripe || stripeBalance ? null
    : stripeBalance === undefined ? (stripeStatus === "slow" ? "slow" : "loading")
    : !isOwner ? "owner" : "failed";
  const transactionsReady = Boolean(earningsShown) && stripeFigures !== "loading" && stripeFigures !== "slow";
  // Stripe earnings still clearing (owner only): Pending on their rows, as
  // the figures count them.
  const clearing = clearingFor(stripeBalance);
  // The one balance for all clients: the database's, with the factory's own
  // Stripe money added when an owner's card has read it (or, if Stripe could
  // not be read, what the server answered without it). It waits for the card
  // while that is reading Stripe, so the figures never jump.
  const stripeReading = !accountsError && (!cardSettled || stripeStatus === "loading" || stripeStatus === "slow");
  const allFigures = earningsShown && !stripeReading
    ? stripeStatus === "ready" ? withStripePart(balanceFigures, stripeBalance?.figures)
      : stripeStatus === "failed" ? withStripePart(balanceFigures, stripeFallback)
      : balanceFigures
    : null;
  const shownFigures = client === "All clients" ? allFigures
    : allFigures && clientFigures?.client === client ? clientFigures.figures : null;
  // The figures wait with the rows, so they never jump.
  const summary = summaryFrom(transactionsReady ? shownFigures : null);
  // Where each payment's money is, for its row's word: the same read.
  const placed = figuresByPayment(balanceFigures);
  const earningsSummary = [
    ["Total earnings", summary.total, "Your earnings from funded payments for the selected client, or all clients. Includes payments awaiting approval."],
    ["Awaiting approval", summary.approval, "Funds waiting for the brand to approve the milestone. Once approved, they move toward your available balance."],
    ["Pending", summary.pending, "Payments still processing and withdrawals on their way to you."],
    ["Paid out", summary.paid, "Money that has been paid out to you"],
  ];
  // The card's "$X pending" reads the Pending figure for all clients, whatever the filter.
  const pendingTotal = allFigures ? Number(allFigures.pending_cents) || 0 : null;
  // Old step-by-step payouts still being sent (changeover): "$X on its way" on the card.
  const onItsWayCents = allFigures ? legacyOnItsWayCents(earnings, placed) : 0;
  const paymentById = new Map((earnings ?? []).map((row) => [row.id, row]));
  const payoutTransactions = (stripeBalance?.payouts ?? []).flatMap((row) => {
    if (client === "All clients") return [row];
    const amount = row.allocations.filter((part) => paymentById.get(part.paymentId)?.order?.brand_org_id === client)
      .reduce((sum, part) => sum + part.amount, 0);
    return amount > 0 ? [{ ...row, amount }] : [];
  });
  const transactions = [
    ...visibleEarnings.map((row) => ({
      id: `earning-${row.id}`,
      type: "earning",
      date: row.released_at || row.confirmed_at || row.sent_at || row.due_at || row.created_at,
      title: row.order_milestones?.title || row.order?.order_number || "Order payment",
      meta: `${row.order?.orgs?.name || "Brand"} · ${row.order?.order_number || "Production order"}`,
      // A brand pays the step plus TSC's fee; the factory earns the step.
      note: [
        // "Available Nov 19": when Stripe lets it be withdrawn.
        clearingNote(row, clearing) ? `${clearingNote(row, clearing)}.` : null,
        owedClearingNote(row, placed) ? `${owedClearingNote(row, placed)}.` : null,
        // With a payout fee the amount is what the factory received, so the step is said here.
        payoutFee(row) > 0
          ? `Step ${formatMoney(grossAmount(row), row.currency)}. ${payoutFeeSentence(payoutFee(row), factoryAmount(row), row.currency)}`
          : row.charged_cents ? "Your step amount. TSC's service fee is paid by the brand on top, not taken from your earnings." : null,
        heldOnCancelledOrder(row) ? "The order was cancelled, so TSC returns this to the brand. It is not in your figures." : null,
      ].filter(Boolean).join(" "),
      status: earningStatus(row, clearing, placed),
      amount: factoryAmount(row),
      currency: row.currency,
      available: earningPaid(row, clearing, placed),
    })),
    // A withdrawal is across clients, so it is listed under All clients only.
    ...(client === "All clients" ? askedWithdrawalRows(fromBalance.rows) : []).map((row) => ({
      ...row,
      type: "withdrawal",
      available: !row.failed,
    })),
    ...withdrawalRows(visibleEarnings, payouts.primary).map((row) => ({
      ...row,
      type: "withdrawal",
      available: !row.failed,
    })),
    ...payoutTransactions.map((row) => ({
      id: `payout-${row.id}`,
      type: "withdrawal",
      date: row.created ? new Date(row.created * 1000).toISOString() : null,
      title: "Bank transfer",
      meta: [payoutDestination(row, stripeBalance), row.arrival_date ? stripeDateLabel(row.arrival_date) : null].filter(Boolean).join(" · "),
      status: PAYOUT_STATUS[row.status] || row.status,
      // Why the bank did not take it; Stripe puts the money back in the balance.
      note: row.status === "failed" ? payoutFailureSentence("stripe", row.failure_code) : null,
      failed: row.status === "failed",
      amount: -Math.abs(row.amount),
      currency: row.currency,
      available: true,
    })),
  ]
    .filter((row) => transactionType === "all" || row.type === transactionType)
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  if (!isFactory) {
    return <section className="billing-history-page"><h1>Payments</h1><p className="projects-empty">Factory payment tools are not available on a brand account.</p></section>;
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
                    onClick={() => { setTab(key); setClient("All clients"); showTabInAddress(key); if (key !== "earnings") leaveEarnings(); }} key={key}>{label}</button>
          ))}
        </div>

      </div>

      {tab === "earnings" && (
        <>
          {/* Mounted once the bank accounts are known, so it reads Stripe once. */}
          {accountsError ? <p className="projects-empty projects-error" role="alert">{accountsError.message}</p>
            : !payouts.accounts ? <PayoutCardPlaceholder isOwner={isOwner} />
            : <StripePayoutCard
            org={org}
            isOwner={isOwner}
            onBalanceChange={balanceChanged}
            onBalanceStatus={setStripeStatus}
            onAccountKnown={settleCard}
            figures={earningsError ? null : allFigures}
            figuresFailed={Boolean(earningsError)}
            manualAccount={payouts.primary}
            manualAccounts={payouts.accounts ?? []}
            manualEditingId={payouts.editingId}
            onStartManual={payouts.startEdit}
            onMakePrimaryManual={payouts.makePrimary}
            manualForm={payouts.form}
            onManualFieldChange={payouts.setField}
            onSaveWise={payouts.saveWise}
            onSavePaypal={payouts.savePaypal}
            problem={withdrawalProblem(earnings, payouts.primary)}
            onDeleteManual={payouts.remove}
            manualBusy={payouts.busy}
            manualSaved={payouts.saved}
            manualOwed={payouts.owed}
            pendingTotal={pendingTotal}
            onItsWayCents={onItsWayCents}
          />}
          <label className="payments-client-filter">
            <span>Filter by client</span>
            <select aria-label="Filter by client" value={client} disabled={!earningsShown} onChange={(event) => setClient(event.target.value)}>
              <option value="All clients">{uiLanguage === "zh" ? "所有客户" : "All clients"}</option>
              {clients.map(({ id, name }) => <option value={id} key={id}>{name}</option>)}
            </select>
          </label>
          {earningsError ? <p className="projects-empty projects-error" role="alert">{earningsError.message}</p> : <>
          <div className="project-summary-strip billing-payment-strip factory-earnings-summary" aria-label="Earnings summary">
            {earningsSummary.map(([label, amounts, help], index) => (
              <div className={`metric${index === 0 ? " highlight" : ""}`} key={label}>
                <strong>{amounts === undefined ? <FigurePlaceholder label={label} />
                  : <span className="payment-currency-value">{formatMoney(amounts, "USD")}</span>}</strong>
                <span className="payment-metric-label">{label} <PaymentHelp label={label}>{help}</PaymentHelp></span>
              </div>
            ))}
          </div>
          {STRIPE_FIGURES_TEXT[stripeFigures] ? <p className="payment-allocation-note" role="status">{STRIPE_FIGURES_TEXT[stripeFigures]}</p> : null}

          <section className="payout-transactions-section" aria-labelledby="transactions-heading">
            <div className="payout-transactions-header">
              <div><h2 id="transactions-heading">Transactions</h2>
                <p>Earnings added to your balance and withdrawals sent to your payout account.</p></div>
              <div className="payout-transaction-filters" role="group" aria-label="Filter transactions">
                {[["all", "All"], ["earning", "Earnings"], ["withdrawal", "Withdrawals"]].map(([key, label]) => (
                  <button key={key} type="button" className={transactionType === key ? "active" : ""} aria-pressed={transactionType === key} onClick={() => setTransactionType(key)}>{label}</button>
                ))}
              </div>
            </div>
            {!transactionsReady ? (
              <div className="payout-transaction-table">
                <div className="payout-transaction-labels" aria-hidden="true"><span>Date</span><span>Type / details</span><span>Status</span><span>Amount</span></div>
                <RowPlaceholders className="payout-transaction-row" cells={4} label="transactions" />
              </div>
            ) : transactions.length ? (
              <div className="payout-transaction-table">
                <div className="payout-transaction-labels" aria-hidden="true"><span>Date</span><span>Type / details</span><span>Status</span><span>Amount</span></div>
                {transactions.map((row) => (
                  <article className="payout-transaction-row" key={row.id}>
                    <time dateTime={row.date || undefined}>{dateLabel(row.date)}</time>
                    <div className="payout-transaction-details">
                      <span className={`payout-transaction-type ${row.type}`}>{row.type === "earning" ? "Earning" : "Withdrawal"}</span>
                      <div><strong>{row.title}</strong><span>{row.meta}</span>{row.note ? <span>{row.note}</span> : null}</div>
                    </div>
                    <span className={`billing-status payout-status-${row.status.toLowerCase().replaceAll(" ", "-")}`}>{row.status}</span>
                    <strong className={row.failed ? "payout-amount-failed" : row.amount < 0 ? "payout-amount-negative" : row.available ? "payout-amount-positive" : "payout-amount-pending"}>
                      {row.amount < 0 ? "−" : row.available ? "+" : ""}{formatMoney(payoutUsdMinor(Math.abs(row.amount), row.currency, stripeBalance?.displayFx), "USD")}
                    </strong>
                  </article>
                ))}
              </div>
            ) : <p className="projects-empty">{transactionType === "withdrawal"
              ? stripeFigures === "owner" ? "Only a company owner can see these." : stripeFigures ? "Couldn't load withdrawals. Try again shortly." : "No withdrawals yet."
              : "No funded earnings yet. Payments appear here after a brand funds a production step."}</p>}
          </section>
          </>}
        </>
      )}

      {tab === "billing" && (
        <>
          <section className="billing-method-empty">
            <div>
              <strong>Billing methods</strong>
              <p>{canSettings ? "Save a card to use when you buy credits." : "Only someone with Settings access can add or remove billing methods. Ask an owner for this permission."}</p>
              {billingSaved ? <span className="live-payment-notice">Payment method added.</span> : null}
            </div>
            <button className="primary-btn compact-btn" type="button" disabled={!canSettings || billingBusy || !STRIPE_PUBLISHABLE_KEY} title={canSettings ? undefined : "Needs the Settings access permission"} onClick={addBillingMethod}>{billingBusy ? "Opening…" : "+ Add payment method"}</button>
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
                    {canSettings ? <button className="secondary-btn compact-btn" type="button" disabled={cardBusy} onClick={() => setRemovingCard(card)}>Remove</button> : <span />}
                  </article>
                ))}
              </div>
            ) : <p className="projects-empty">No saved cards yet.</p>}
        </>
      )}

      {tab === "credits" && (
        <>
          <section className="factory-credit-billing-card">
            <div>
              <span>Credit balance</span>
              <strong>{credits ? `${credits.balance.toLocaleString()} credits` : creditsError ? "—" : <FigurePlaceholder label="credit balance" className="payout-credit-placeholder" />}</strong>
              <p>500 credits = $50 value. Credits are used when a quote is sent.</p>
            </div>
            <div className="factory-credit-billing-action live-credit-actions">
              <button className="secondary-btn compact-btn" type="button" onClick={() => { setNotice(null); setInviteOpen(true); }}>Invite a factory</button>
              <CreditPurchaseButton orgId={org.id} orgName={org.name} isOwner={canSettings} onPurchased={reloadCredits} onNotice={setNotice} />
            </div>
          </section>
          {notice ? <p className="live-payment-notice" role="status">{notice}</p> : null}
          {creditsError ? <p className="projects-empty projects-error" role="alert">{creditsError.message}</p>
            : !credits ? <div className="billing-history-list"><RowPlaceholders className="billing-history-row" cells={3} label="credit activity" /></div>
            : credits.rows.length ? (
            <div className="billing-history-list">
              {credits.rows.map((row) => (
                <article className="billing-history-row" key={row.id}>
                  <div><strong>{row.title}</strong><span>{row.meta}</span></div>
                  <span className="billing-status">{row.status}</span>
                  <strong>{row.amount}</strong>
                </article>
              ))}
            </div>
          ) : <p className="projects-empty">No credit activity yet.</p>}
        </>
      )}

      {error && <p className="projects-empty projects-error" role="alert">{error.message}</p>}

      {inviteOpen ? (
        <InviteFactoryModal
          intro={FACTORY_INVITE_INTRO}
          onInvite={async (email, message) => {
            const result = await sendInvite(org.id, email, message);
            setNotice(inviteNotice(result, { email }));
            await loadCredits();
          }}
          onClose={() => setInviteOpen(false)}
        />
      ) : null}

      {billingSecret ? (
        <BillingMethodFlow clientSecret={billingSecret} onClose={() => setBillingSecret(null)} onSaved={() => { setBillingSecret(null); setBillingSaved(true); loadCards(); }} />
      ) : null}

      {removingCard ? (
        <PayoutModal
          title="Remove this card?"
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
      onClose={onClose}
      actions={<><button className="secondary-btn" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-btn" type="button" disabled={!stripe || !cardComplete || busy} onClick={save}>{busy ? "Saving…" : "Save payment method"}</button></>}
    >
      {intro ? <p className="payout-modal-intro">{intro}</p> : null}
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
