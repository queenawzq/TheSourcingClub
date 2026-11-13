/**
 * The payments board.
 *
 * Brands pay TSC through Stripe, by card; TSC holds the
 * money until the brand approves the step, then pays the factory. Most of it
 * runs on its own: the webhook records what Stripe says, and approving a step
 * transfers the money to a factory's Stripe account. This page is for what
 * does not, and it is a required step in the workflow, not a convenience:
 * notifications.org_id is `not null references orgs` and platform staff have
 * no org, so an admin cannot be notified of anything.
 *
 *   Payout owed      approved and not paid out, on an active order or one
 *                    cancelled after the approval. "Retry payout" when the
 *                    factory has a Stripe account that can take transfers and
 *                    the money came through Stripe. "Pay with Wise" or "Pay with
 *                    PayPal" when the factory's method is one of those: the
 *                    server pays and the board reads back where it is. Paying by
 *                    bank by hand and marking it stays as the fallback.
 *                    A payout underway with Wise or PayPal moves to Processing.
 *   Failed           a payment that did not go through: the brand pays again.
 *   Processing       money moving, each row naming its provider: a brand's
 *                    payment Stripe is still confirming, or a payout on its
 *                    way through Wise or PayPal, with its Refresh and Cancel.
 *   Held             funded, the step not approved yet.
 *
 * Money held on a cancelled order is refunded to the brand automatically
 * (20261108300000), so the board has no tab for it (John, Nov 7).
 *
 * Phone width: the table scrolls sideways, so a row's note and buttons are
 * drawn on a line of their own under it, where they can be reached without
 * scrolling.
 *
 * Drawn to Queena's design (#79): the admin workspace's own sidebar
 * (AdminWorkspaceShell) and one tab per queue. Payout owed is always there;
 * every other queue has a tab only while something is in it. Every action checks is_platform_admin() in the
 * database (or reads the payment as the caller, for the Stripe routes) before
 * it touches a row, so this page cannot grant itself anything.
 */
import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../lib/auth.jsx";
import {
  factoryStripeSetup, paymentBoard, releasePayment, revealPayoutNumber,
} from "../../lib/domain/payment.js";
import { cancelProviderPayout, payByProvider, previewWise, providerAttempts, syncProvider, tellFactoryToFixDetails } from "../../lib/domain/provider-payouts.js";
import { requestRelease, stripeDashboardUrl } from "../../lib/domain/stripe.js";
import { supabase } from "../../lib/supabase.js";
import { formatMoney } from "../../lib/money.js";
import { dateFrom } from "../../lib/dates.js";
import "./admin.css";
import AdminWorkspaceShell from "./AdminWorkspaceShell.jsx";

function PaymentDate({ value }) {
  const date = dateFrom(value);
  if (!date) return <span className="admin-sub">—</span>;
  return <time className="payment-date" dateTime={date.toISOString()} title={date.toLocaleString()}>
    <span>{date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
    <span className="admin-sub">{date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
  </time>;
}

/** The row's own date for the section it is in. */
const ROW_TIME = {
  payout: (row) => row.release_requested_at,
  failed: (row, attempt) => (providerFailed(row, attempt) ? attempt.updated_at : row.refund_failed_at ?? row.failed_at),
  clearing: (row, attempt) => (underway(row, attempt) ? attempt.created_at ?? row.release_requested_at : row.processing_at),
  held: (row) => row.confirmed_at,
};

/** Includes a payout Stripe was asked for and may have made: only Retry finds out, so no other rail is offered. */
const paidByStripe = (row) => (row.factory_stripe_ready || row.stripe_release_started) && row.stripe_payment_intent_id;
const paidByPaypal = (row) => !paidByStripe(row) && row.payout_method === "paypal";
const paidByBank = (row) => !paidByStripe(row) && !paidByPaypal(row);
const paidByWise = (row) => paidByBank(row) && Boolean(row.wise_recipient_type);
/** Stripe's account is ready but this payment has no charge to pay from, and the factory has no details here. */
const stripeCantPay = (row) => paidByBank(row) && row.factory_stripe_ready && !row.payout_account_id;
/**
 * Marking paid by bank is for a bank account TSC can actually send to, or for
 * the row above, which has no other way off the board.
 */
const canMarkByBank = (row) => paidByBank(row) && ((Boolean(row.payout_account_id) && row.payout_has_number) || stripeCantPay(row));
/** Which provider the server pays this row through, if any. */
const providerFor = (row) => (paidByWise(row) ? "wise" : paidByPaypal(row) ? "paypal" : null);
const PROVIDER_NAME = { wise: "Wise", paypal: "PayPal" };
/** A payout Wise or PayPal is paying now: it waits under Processing, not Payout owed. */
const underway = (row, attempt) => Boolean(providerFor(row)) && attempt?.status === "processing";
/**
 * Wise or PayPal's last attempt failed (returned, refused) and the factory has
 * not changed its details since: listed under Failed, with Pay again.
 */
const providerFailed = (row, attempt) => Boolean(providerFor(row)) && attempt?.status === "failed"
  && !(row.payout_changed_at && attempt.updated_at && new Date(row.payout_changed_at) > new Date(attempt.updated_at));

/** Wise's own words. Whether they are true for a USD order is John's question. */
const CNY_STATEMENT = "I confirm the contract and invoice for this payment are denominated in CNY and understand that the payment might be rejected otherwise.";
const moneyIn = (minor, currency) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(minor) / 100);

/** The design preview passes a fake; the board reveals through the database. */
const PayoutNumberContext = createContext(revealPayoutNumber);
export const PayoutNumberProvider = PayoutNumberContext.Provider;

const REVEAL_SHOWN_MS = 60000;
const REFERENCE_MIN = 3;
const bankCountry = new Intl.DisplayNames(["en"], { type: "region" });

/** "today", "1 day ago"… from the time the database gave. Whether it counts as recent is its word too. */
function agoWords(value) {
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
  return days < 1 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
}

/** The number stays here, in this one cell, until it hides. Never on the row, never stored. */
function AccountNumber({ row, onViewed }) {
  const revealNumber = useContext(PayoutNumberContext);
  const [shown, setShown] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  const numberLabel = row.payout_number_kind === "iban" ? "IBAN" : "Account number";
  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setShown(null);
    setCopied(false);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function reveal() {
    setBusy(true);
    setProblem(null);
    try {
      const answer = await revealNumber(row.payout_account_id);
      onViewed?.();
      if (answer.changed_at !== row.payout_changed_at) {
        setProblem("These details changed since this page loaded. Reload the page and check them.");
        return;
      }
      setShown(answer);
      timer.current = setTimeout(hide, REVEAL_SHOWN_MS);
    } catch (failure) {
      setProblem(failure.message);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(shown.account_number);
      setCopied(true);
    } catch {
      setProblem("Your browser refused to copy it. Select it and copy it by hand.");
    }
  }

  return (
    <span className="admin-payout-number">
      {shown ? (
        <>
          <PayoutField label={numberLabel}><span data-testid="revealed-number">{shown.account_number}</span></PayoutField>
          <span className="payout-number-actions"><button type="button" className="admin-link payout-text-action" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
          <button type="button" className="admin-link payout-text-action" onClick={hide}>Hide</button></span>
        </>
      ) : (
        <>
          <PayoutField label={numberLabel}>{`····${row.payout_last4 ?? ""}`}</PayoutField>
          <button type="button" className="admin-link payout-text-action" disabled={busy} data-testid="reveal-number" onClick={reveal}>
            {busy ? "Showing…" : "Show number"}
          </button>
        </>
      )}
      {problem ? <span className="admin-error admin-row-message" role="alert" data-testid="reveal-refusal">{problem}</span> : null}
    </span>
  );
}

function PayoutField({ label, children }) {
  return <span className="payout-detail-field"><span className="payout-detail-label">{label}</span><span className="payout-detail-value">{children}</span></span>;
}

const DETAIL_LABELS = { swiftCode: "SWIFT / BIC", bic: "SWIFT / BIC", abartn: "Routing number", ifscCode: "IFSC code", bsbCode: "BSB code", cpf: "CPF", cnpj: "CNPJ" };
const countryName = (code) => (/^[A-Z]{2}$/.test(code ?? "") ? bankCountry.of(code) : code);

/**
 * What the factory typed for this account, in the order a bank form asks. The
 * name is on its own row and the number is never in here.
 */
function typedBankDetails(row) {
  const details = row.wise_details ?? {};
  const address = ["address.firstLine", "address.city", "address.state", "address.postCode"].map((key) => details[key]);
  const line = [...address, countryName(details["address.country"])].filter(Boolean).join(", ");
  const rest = Object.entries(details)
    .filter(([key, value]) => value && !key.startsWith("address.") && !["accountHolderName", "legalType"].includes(key))
    .filter(([key]) => !(row.payout_swift && DETAIL_LABELS[key] === "SWIFT / BIC"))
    .map(([key, value]) => [DETAIL_LABELS[key] ?? key.replace(/([a-z])([A-Z])/g, (_, a, b) => `${a} ${b.toLowerCase()}`).replace(/^./, (c) => c.toUpperCase()), String(value)]);
  return [...rest, ...(line ? [["Address", line]] : [])];
}

function Contact({ label, parts: given, email }) {
  const parts = given.filter((part) => part && part.trim());
  return email || parts.length ? (
    <PayoutField label={label}>
      {parts.length ? `${parts.join(", ")}${email ? ", " : ""}` : null}
      {email ? <a href={`mailto:${email}`}>{email}</a> : null}
    </PayoutField>
  ) : <span className="admin-sub">No contact on file for this company.</span>;
}

const FactoryContact = ({ row }) => <Contact label="Factory contact" parts={[row.contact_name, row.contact_phone]} email={row.contact_email} />;
const BrandContact = ({ row }) => <Contact label="Brand contact" parts={[row.brand_name, row.brand_contact_name, row.brand_contact_phone]} email={row.brand_contact_email} />;

/** Everything staff need to send the money, on the row. */
function BankDetails({ row, onViewed, stripeSetup }) {
  if (stripeCantPay(row)) {
    return (
      <span className="admin-payout-details" data-testid="stripe-cant-pay">
        <span className="admin-error">Stripe can't pay this: the payment has no card charge. This factory is paid through Stripe, so there are no bank details here.</span>
        <span className="admin-sub">Ask the factory for a bank account, send the money, then mark it with the bank's reference.</span>
        <FactoryContact row={row} />
      </span>
    );
  }
  if (!row.payout_account_id) {
    return (
      <span className="admin-payout-details">
        {stripeSetup && !stripeSetup.transfers_active
          ? <span className="admin-error" data-testid="waits-on-stripe-setup">Waiting on the factory's Stripe setup. No other withdrawal method on file.</span>
          : <span className="admin-error">No withdrawal method on file. Ask the factory to add one on its Payments page.</span>}
        <FactoryContact row={row} />
      </span>
    );
  }
  const country = row.payout_country ? bankCountry.of(row.payout_country.trim()) : null;
  return (
    <span className="admin-payout-details">
      <strong className="payout-method-heading">{row.wise_recipient_type ? "Wise or bank transfer" : "Bank transfer"}</strong>
      {row.factory_stripe_ready ? <span className="admin-sub" data-testid="no-stripe-charge">No card charge on this payment, so Stripe can't pay it. Pay by bank and mark it.</span> : null}
      {row.payout_changed_recently ? (
        <span className="shared-card-status warning payout-change-status" data-testid="payout-changed">{`Bank details updated ${agoWords(row.payout_changed_at)}. Verify before sending.`}</span>
      ) : null}
      <PayoutField label="Account holder">{row.payout_holder || "Not provided"}</PayoutField>
      <PayoutField label="Bank">{`${row.payout_bank || "Not provided"}${country ? `, ${country}` : ""}`}</PayoutField>
      {row.payout_branch ? <PayoutField label="Branch">{row.payout_branch}</PayoutField> : null}
      {row.payout_swift || !row.wise_recipient_type ? <PayoutField label="SWIFT / BIC">{row.payout_swift || "Not provided"}</PayoutField> : null}
      {typedBankDetails(row).map(([label, value]) => <PayoutField key={label} label={label}>{value}</PayoutField>)}
      {row.payout_has_number
        ? <AccountNumber row={row} onViewed={onViewed} />
        : <span className="admin-error" data-testid="no-full-number">No full account number on file, so TSC can't pay this yet. Ask the factory to add it on its Payments page.</span>}
      {row.payout_instructions ? <PayoutField label="Instructions"><span className="admin-payout-instructions">{row.payout_instructions}</span></PayoutField> : null}
      <FactoryContact row={row} />
    </span>
  );
}

/**
 * Pay with Wise, Pay with PayPal, and everything that can happen after. What it
 * shows comes from the attempt the database holds, so a reload shows the same.
 */
function ProviderPay({ row, attempt, wise, paypal, onChanged }) {
  const provider = providerFor(row);
  const name = PROVIDER_NAME[provider];
  const needsStatement = provider === "wise" && row.wise_currency === "CNY";
  const [step, setStep] = useState(null); // null | "statement" | "confirm"
  const [statement, setStatement] = useState(false);
  const [preview, setPreview] = useState(null);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState(null);
  // What the last press found, when the row itself would look unchanged.
  const [heard, setHeard] = useState(null);
  // A double click lands before the button can grey out. The database would
  // refuse the second press anyway, but its refusal would then sit on the row.
  const running = useRef(false);

  async function run(action, sayAfter) {
    if (running.current) return;
    running.current = true;
    setWorking(true);
    setProblem(null);
    setHeard(null);
    try {
      const answer = await action();
      setStep(null);
      setStatement(false);
      setPreview(null);
      await onChanged();
      setHeard(sayAfter?.(answer) ?? null);
    } catch (failure) {
      setProblem(failure);
      await onChanged();
    } finally {
      running.current = false;
      setWorking(false);
    }
  }

  async function review() {
    if (running.current) return;
    running.current = true;
    setWorking(true);
    setProblem(null);
    try {
      setPreview(await previewWise(row.payment_id, statement));
      setStep("confirm");
    } catch (failure) {
      setProblem(failure);
    } finally {
      running.current = false;
      setWorking(false);
    }
  }

  // A refusal is about the details it was given: once they change, it's over.
  useEffect(() => { setProblem(null); setHeard(null); }, [row.payout_changed_at]);

  const clock = () => new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const said = (
    <>
      {problem ? <span className="admin-error admin-row-message" role="alert" data-testid="provider-refusal">{problem.message}</span> : null}
      {heard ? <span className="admin-sub admin-row-message" role="status" data-testid="provider-heard">{heard}</span> : null}
    </>
  );
  const live = attempt?.status === "processing";

  if (live) {
    const transferUrl = provider === "wise" && attempt.provider_ref && wise?.appUrl
      ? `${wise.appUrl}/transactions/activities/by-resource/TRANSFER/${attempt.provider_ref}` : null;
    const pending = attempt.stage === "claimed";
    const waiting = attempt.stage === "awaiting_funding";
    const unclaimed = attempt.provider_status === "UNCLAIMED";
    // The money stays at the address it went to, whatever the factory says now.
    const movedOn = unclaimed && attempt.paid_to !== row.paypal_email;
    return (
      <>
        {said}
        {movedOn ? <span className="admin-error admin-row-message" data-testid="provider-moved-on">{`Sent to ${attempt.paid_to}. The factory now uses ${row.paypal_email ?? "another method"}. Cancel this, then pay again.`}</span> : null}
        <span className="admin-sub admin-row-message" role="status" data-testid="provider-status" data-stage={attempt.stage}>
          {attempt.in_progress && pending ? `Being paid by ${attempt.requested_by_email ?? "staff"}…`
            : attempt.staff_sentence
            || (pending ? "We don't know yet if this went. Press again: it can't pay twice."
              : `With ${name}: ${(attempt.provider_status ?? "processing").replaceAll("_", " ").toLowerCase()}.`)}
        </span>
        {attempt.received_minor != null && attempt.received_currency
          ? <span className="admin-sub" data-testid="provider-quote">{`Quoted: arrives ${moneyIn(attempt.received_minor, attempt.received_currency)}.${attempt.fee_minor != null ? ` ${name} fee ${moneyIn(attempt.fee_minor, row.currency)}.` : ""}`}</span>
          : null}
        {transferUrl ? <a className="admin-sub" href={transferUrl} target="_blank" rel="noreferrer" data-testid="open-in-wise">Open in Wise</a> : null}
        {unclaimed && paypal?.appUrl ? <a className="admin-sub" href={paypal.appUrl} target="_blank" rel="noreferrer" data-testid="open-in-paypal">Open PayPal</a> : null}
        {waiting || (pending && !attempt.in_progress) ? (
          <button type="button" className="admin-approve" disabled={working || attempt.in_progress} data-testid="provider-press-again"
                  onClick={() => run(() => payByProvider(provider, row, needsStatement), (answer) => (
                    answer?.done === "funding_refused" ? `Tried at ${clock()}: Wise still won't fund this from here. Fund it in Wise, then press Refresh.`
                      : answer?.sentence ? `Tried at ${clock()}.` : null))}>
            {working ? "Trying…" : waiting ? "Try funding again" : "Press again"}
          </button>
        ) : null}
        <button type="button" className="quiet-btn" disabled={working} data-testid="provider-refresh" onClick={() => run(() => syncProvider(provider), () => `Checked at ${clock()}.`)}>{working ? "Checking…" : "Refresh"}</button>
        {(waiting || unclaimed || (pending && !attempt.in_progress && provider !== "paypal") || (attempt.stage === "sent" && attempt.staff_sentence)) ? (
          <button type="button" className="admin-reject" disabled={working || attempt.in_progress} data-testid="provider-cancel"
                  onClick={() => run(() => cancelProviderPayout(provider, row.payment_id))}>
            {provider === "wise" ? "Cancel transfer" : "Cancel payment"}
          </button>
        ) : null}
      </>
    );
  }

  const fixedSince = attempt?.updated_at && row.payout_changed_at && new Date(row.payout_changed_at) > new Date(attempt.updated_at);
  const lastFailed = ["failed", "cancelled"].includes(attempt?.status) && attempt.staff_sentence && !fixedSince
    ? <span className="admin-error admin-row-message" data-testid="provider-last-failure">{attempt.staff_sentence}</span> : null;

  // Still offered after a reload: what the press heard is gone, the attempt isn't.
  // Telling sends nothing, so it passes the statement the payment's press asked for.
  const refusedDetails = problem?.kind === "details_rejected"
    || (Boolean(lastFailed) && attempt.status === "cancelled" && attempt.provider_status === "details_rejected");

  if (step === "statement") {
    return (
      <>
        {said}
        <label className="admin-check admin-row-message">
          <input type="checkbox" data-testid="cny-statement" checked={statement} onChange={(event) => setStatement(event.target.checked)} />
          <span>{CNY_STATEMENT}</span>
        </label>
        <button type="button" className="admin-approve" disabled={working || !statement} data-testid="provider-continue" onClick={review}>
          {working ? "Checking…" : "Continue"}
        </button>
        <button type="button" className="admin-reject" disabled={working} onClick={() => { setStep(null); setProblem(null); }}>Cancel</button>
        {problem?.kind === "details_rejected" ? (
          <button type="button" className="quiet-btn" disabled={working} data-testid="provider-tell-factory"
                  onClick={() => run(() => tellFactoryToFixDetails(provider, row, problem.message, statement, problem.fields))}>
            Tell the factory to fix its details
          </button>
        ) : null}
      </>
    );
  }

  if (step === "confirm") {
    const short = preview.shortByCents > 0;
    return (
      <>
        {said}
        <span className="admin-sub admin-row-message" role="alert">
          {provider === "wise"
            ? `Send ${moneyIn(row.amount_cents, row.currency)} to ${row.payout_holder || row.factory_name}, ${row.payout_bank} ending ${row.payout_last4 ?? "unknown"}?${preview.feeCents == null ? "" : ` Wise fee ${moneyIn(preview.feeCents, row.currency)}. TSC pays ${moneyIn(preview.totalCents, row.currency)} in total. Arrives ${moneyIn(preview.arrivesCents, preview.arrivesCurrency)}.`}`
            : `Send ${moneyIn(row.amount_cents, row.currency)} to ${row.paypal_email} by PayPal?`}
        </span>
        {short ? (
          <span className="admin-error admin-row-message" data-testid="wise-short">
            {`Wise balance ${moneyIn(preview.balanceCents, row.currency)} is short by ${moneyIn(preview.shortByCents, row.currency)}${preview.feeCents == null ? " before Wise's fee" : ""}. Top up TSC's Wise balance, then press Check again. `}
            <a href={preview.balancesUrl} target="_blank" rel="noreferrer">Open Wise</a>
          </span>
        ) : null}
        {short ? (
          <button type="button" className="quiet-btn" disabled={working} data-testid="provider-check-again" onClick={review}>Check again</button>
        ) : (
          <button type="button" className="admin-approve" disabled={working} data-testid="provider-confirm"
                  onClick={() => run(() => payByProvider(provider, row, needsStatement))}>
            {working ? "Paying…" : "Yes, pay"}
          </button>
        )}
        <button type="button" className="admin-reject" disabled={working} onClick={() => { setStep(null); setPreview(null); }}>Cancel</button>
      </>
    );
  }

  return (
    <>
      {said}
      {lastFailed}
      {refusedDetails ? (
        <button type="button" className="quiet-btn" disabled={working} data-testid="provider-tell-factory"
                onClick={() => run(() => tellFactoryToFixDetails(provider, row, problem?.message ?? attempt.staff_sentence, needsStatement, problem?.fields))}>
          Tell the factory to fix its details
        </button>
      ) : null}
      <button type="button" className="admin-approve" disabled={working || (provider === "wise" && !row.payout_has_number)} data-testid={`pay-with-${provider}`}
              title={provider === "wise" && !row.payout_has_number ? "No full account number on file" : undefined}
              onClick={() => {
                setProblem(null);
                if (provider === "paypal") { setPreview({}); setStep("confirm"); }
                else if (needsStatement) setStep("statement");
                else review();
              }}>
        {attempt?.status === "failed" ? `Pay again with ${name}` : `Pay with ${name}`}
      </button>
    </>
  );
}

function Actions({ row, section, note, onNoteChange, onDecide, busy, refusal, attempt, wise, paypal, onChanged }) {
  const said = refusal ? <span className="admin-error admin-row-message" role="alert" data-testid="payment-refusal">{refusal.message}</span> : null;
  // Marking a payout paid by bank cannot be undone from here and tells the
  // factory it was paid, so it asks once, saying the amount and where to.
  const [confirming, setConfirming] = useState(null);
  if (section === "failed" && row.refund_failed_at) {
    if (confirming) {
      return (
        <>
          <span className="admin-sub admin-row-message" role="alert">
            {`Refunded ${formatMoney(row.charged_cents ?? row.amount_cents, row.currency)} to ${row.brand_name} outside Stripe, reference ${note.trim()}?`}
          </span>
          <button type="button" className="admin-approve" disabled={busy} data-testid="refund-outside-confirm"
                  onClick={() => { setConfirming(null); onDecide(row, "refund_outside", note); }}>
            Yes, mark refunded
          </button>
          <button type="button" className="admin-reject" disabled={busy} onClick={() => setConfirming(null)}>Cancel</button>
        </>
      );
    }
    return (
      <>
        {said}
        <button type="button" className="admin-approve" disabled={busy || note.trim().length < REFERENCE_MIN}
                data-testid="refund-outside"
                title={note.trim().length < REFERENCE_MIN ? "Enter the reference for this refund" : "Refund the brand first, then mark it here"}
                onClick={() => setConfirming("refund")}>
          Mark refunded outside Stripe
        </button>
      </>
    );
  }
  if (section === "clearing") {
    return underway(row, attempt) ? <ProviderPay row={row} attempt={attempt} wise={wise} paypal={paypal} onChanged={onChanged} /> : null;
  }
  if (section === "payout") {
    const provider = providerFor(row);
    if (provider && attempt?.status === "processing") {
      return <ProviderPay row={row} attempt={attempt} wise={wise} paypal={paypal} onChanged={onChanged} />;
    }
    const pay = provider ? <ProviderPay row={row} attempt={attempt} wise={wise} paypal={paypal} onChanged={onChanged} /> : null;
    return paidByStripe(row) ? (
      <>
      {said}
      <button type="button" className="admin-approve" disabled={busy}
              data-testid="retry-payout"
              onClick={() => onDecide(row, "retry", note)}>
        Retry payout
      </button>
      </>
    ) : confirming ? (
      <>
        <span className="admin-sub admin-row-message" role="alert">
          {`Sent ${formatMoney(row.amount_cents, row.currency)} to ${row.factory_name} by bank?`}
          {row.payout_account_id ? ` To ${row.payout_holder || row.factory_name}, ${row.payout_bank}, ending ${row.payout_last4}.` : null}
          {` They will read: "${note.trim()}"`}
        </span>
        <button type="button" className="admin-approve" disabled={busy}
                data-testid="release-payment-confirm"
                onClick={() => { setConfirming(null); onDecide(row, "release", note); }}>
          Yes, mark paid out
        </button>
        <button type="button" className="admin-reject" disabled={busy}
                onClick={() => setConfirming(null)}>
          Cancel
        </button>
      </>
    ) : (
      <>
      {said}
      {pay}
      {canMarkByBank(row) ? (
      <button type="button" className={pay ? "quiet-btn" : "admin-approve"} disabled={busy || note.trim().length < REFERENCE_MIN}
              data-testid="release-payment"
              title={note.trim().length < REFERENCE_MIN ? "Enter the bank's reference for this transfer" : "Pay the factory by bank transfer first, then mark it here"}
              onClick={() => setConfirming("bank")}>
        Mark paid out by bank
      </button>
      ) : null}
      </>
    );
  }
  return null;
}

/** Below this width the action cells move to a line of their own. */
const NARROW = "(max-width: 1180px)";

const narrowQuery = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(NARROW) : null);

export function useNarrow() {
  const [narrow, setNarrow] = useState(() => Boolean(narrowQuery()?.matches));
  useEffect(() => {
    const query = narrowQuery();
    if (!query) return undefined;
    const update = () => setNarrow(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return narrow;
}

/** Whether a row in this section has a note and buttons. */
const rowActs = (section, row, attempt) => section === "payout"
  || (section === "clearing" && underway(row, attempt)) || (section === "failed" && (providerFailed(row, attempt) || Boolean(row.refund_failed_at)));

function Row({ row, section: listedIn, onDecide, busy, narrow, refusal, onViewed, attempt, wise, paypal, onChanged, setups, columns, notes }) {
  // A failed Wise or PayPal payout is still owed: under Failed it is drawn and paid as in Payout owed.
  const section = listedIn === "failed" && providerFailed(row, attempt) ? "payout" : listedIn;
  const [note, setNote] = useState("");
  const acts = rowActs(section, row, attempt);
  const providerLive = attempt?.status === "processing" && providerFor(row);

  const noteInput = acts ? (
    <>
      {section === "failed" && row.refund_failed_at ? (
        <label className="admin-sub">
          Refund reference (required)
          <input type="text" data-testid="refund-reference" value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
      ) : providerLive || (section === "payout" && !paidByStripe(row) && !canMarkByBank(row)) ? null : section === "payout" && paidByBank(row) ? (
        <label className="admin-sub">
          Bank reference (required)
          <input type="text" data-testid="bank-reference" value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
      ) : (
        <input type="text" aria-label="Note" placeholder="Optional note"
               value={note} onChange={(event) => setNote(event.target.value)} />
      )}
    </>
  ) : null;
  const buttons = <Actions row={row} section={section} note={note} onNoteChange={setNote} onDecide={onDecide} busy={busy} refusal={refusal} attempt={attempt} wise={wise} paypal={paypal} onChanged={onChanged} />;

  return (
    <>
      <tr data-payment={row.payment_id}>
        <td>
          <strong>{row.order_number}</strong>
          <span className="admin-sub">{row.milestone_title}</span>
        </td>
        <td>
          {row.brand_name}
          <span className="admin-sub">→ {row.factory_name}</span>
        </td>
        <td>
          <strong>{formatMoney(row.amount_cents, row.currency)}</strong>
          <span className="admin-sub">
            {row.charged_cents
              ? `charged ${formatMoney(row.charged_cents, row.currency)} incl. fees`
              : `fee ${formatMoney(row.fee_cents, row.currency)}${Number(row.processing_fee_cents) ? ` · card fee ${formatMoney(row.processing_fee_cents, row.currency)}` : ""}`}
          </span>
        </td>
        <td>
          {section === "clearing" ? <ProviderCell row={row} attempt={attempt} />
            : row.payment_method_label || <span className="admin-sub">—</span>}
          {section === "failed" && row.refund_failed_at ? (
            <span className="admin-payout-details" data-testid="refund-failed">
              <strong className="payout-method-heading">Refund to the brand failed</strong>
              {row.refund_failure ? <span className="admin-sub">{row.refund_failure}</span> : null}
              <BrandContact row={row} />
            </span>
          ) : section === "failed" && row.failure_reason
            ? <span className="admin-sub">{row.failure_reason}</span>
            : null}
          {section === "payout" && paidByBank(row) && !narrow ? <BankDetails row={row} onViewed={onViewed} stripeSetup={setups?.get(row.order_id)} /> : null}
          {section === "payout" && !paidByBank(row) ? (
            <span className="admin-payout-details">
              <strong className="payout-method-heading">{paidByStripe(row) ? "Stripe payout" : "PayPal"}</strong>
              {paidByStripe(row) && !row.factory_stripe_ready ? <span className="admin-sub" data-testid="stripe-started">Stripe may have paid this already. Retry checks with Stripe first.</span> : null}
              {paidByPaypal(row) && row.payout_changed_recently ? (
                <span className="shared-card-status warning payout-change-status" data-testid="payout-changed">{`PayPal address updated ${agoWords(row.payout_changed_at)}. Verify before sending.`}</span>
              ) : null}
              {paidByPaypal(row) ? <PayoutField label="Payout email">{attempt?.status === "processing" ? attempt.paid_to : row.paypal_email}</PayoutField> : null}
            </span>
          ) : null}
          {section === "payout" && paidByPaypal(row) ? <FactoryContact row={row} /> : null}
        </td>
        <td>
          <PaymentDate value={ROW_TIME[listedIn](row, attempt)} />
          {row.stripe_payment_intent_id && !(section === "clearing" && underway(row, attempt)) ? (
            <a className="admin-sub" href={stripeDashboardUrl("payments", row.stripe_payment_intent_id)}
               target="_blank" rel="noreferrer">Open in Stripe</a>
          ) : null}
        </td>
        {narrow || !columns ? null : (
          <>
            {notes ? <td className="payments-note-cell">{acts ? noteInput : null}</td> : null}
            <td className="admin-actions">{acts ? buttons : null}</td>
          </>
        )}
      </tr>
      {narrow && acts ? (
        <tr data-payment-actions={row.payment_id}>
          <td colSpan={5}>
            {/* Pinned to the left edge and no wider than the screen, so the
                note and buttons stay in view however the table is scrolled. */}
            <div className="payments-mobile-actions">
              {section === "payout" && paidByBank(row) ? <BankDetails row={row} onViewed={onViewed} stripeSetup={setups?.get(row.order_id)} /> : null}
              {noteInput}
              <div className="admin-actions" style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>{buttons}</div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** Processing names who is moving the money: Stripe for a brand's payment, Wise or PayPal for a payout. */
function ProviderCell({ row, attempt }) {
  if (!underway(row, attempt)) {
    return (
      <span className="admin-payout-details">
        <strong className="payout-method-heading">Stripe</strong>
        {row.payment_method_label ? <span className="admin-sub">{row.payment_method_label}</span> : null}
      </span>
    );
  }
  const provider = providerFor(row);
  return (
    <span className="admin-payout-details">
      <strong className="payout-method-heading">{PROVIDER_NAME[provider]}</strong>
      {provider === "paypal"
        ? <PayoutField label="Payout email">{attempt.paid_to ?? row.paypal_email}</PayoutField>
        : <PayoutField label="Bank">{`${row.payout_bank || "Not provided"} ····${row.payout_last4 ?? ""}`}</PayoutField>}
    </span>
  );
}

/** "Stripe 1 · Wise 2": the providers in Processing, each with its count. */
function providerCounts(rows, attempts) {
  const counts = new Map();
  for (const row of rows) {
    const name = underway(row, attempts?.get(row.payment_id)) ? PROVIDER_NAME[providerFor(row)] : "Stripe";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return ["Stripe", "Wise", "PayPal"].filter((name) => counts.get(name)).map((name) => `${name} ${counts.get(name)}`).join(" · ");
}

function Section({ id, title, rows, empty, caption, onDecide, busyId, narrow, refusal, onViewed, attempts, wise, paypal, onChanged, above, setups }) {
  const columns = rows.some((row) => rowActs(id, row, attempts?.get(row.payment_id)));
  // Only a payout has a note: a bank reference.
  const notes = columns && (id === "payout" || id === "failed");
  return (
    <section className="payments-queue" data-section={id}>
      <h2>{title} ({rows.length})</h2>
      {above}
      {rows.length === 0 ? (
        <div className="payments-empty"><strong>All clear</strong><p className="admin-sub">{empty}</p></div>
      ) : (
        <>
        {/* Above the table, not its <caption>: .admin-sub is display: block,
            which squeezed a caption into the first column. */}
        {caption ? <p className="admin-sub admin-section-caption">{caption}</p> : null}
        <div className="admin-scroll">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Between</th>
                <th>Amount</th>
                <th>{id === "clearing" ? "Provider" : "Paid with"}</th>
                <th>When</th>
                {narrow || !columns ? null : (
                  <>
                    {notes ? <th>Note</th> : null}
                    <th className="payments-action-heading">Actions</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Row setups={setups} columns={columns} notes={notes} key={row.payment_id} row={row} section={id} onDecide={onDecide} busy={busyId === row.payment_id}
                     narrow={narrow} refusal={refusal?.paymentId === row.payment_id ? refusal.failure : null} onViewed={onViewed}
                     attempt={attempts?.get(row.payment_id) ?? null} wise={wise} paypal={paypal} onChanged={onChanged} />
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </section>
  );
}

/**
 * Splits the board's rows into its sections. A payout Wise or PayPal is
 * paying now (its attempt `processing`) is under Processing, not Payout owed.
 * The board no longer shows bank-wire claims (`sent`) or payments refunded
 * after payout (`released`): John, Nov 7.
 */
export function boardSections(rows, attempts = new Map()) {
  const cancelled = (row) => row.order_status === "cancelled";
  const owed = rows.filter((row) => row.state === "confirmed" && row.release_requested_at);
  const moving = (row) => underway(row, attempts.get(row.payment_id));
  const refused = (row) => providerFailed(row, attempts.get(row.payment_id));
  return {
    payout: owed.filter((row) => !moving(row) && !refused(row)),
    // A cancelled order's held money is refunded automatically; only a refund
    // Stripe refused (20261108300000) needs a person.
    failed: rows.filter((row) => (row.state === "failed" && !cancelled(row))
      || (["confirmed", "processing"].includes(row.state) && cancelled(row) && row.refund_failed_at))
      .concat(owed.filter(refused)),
    clearing: [...rows.filter((row) => row.state === "processing" && !cancelled(row)), ...owed.filter(moving)],
    held: rows.filter((row) => row.state === "confirmed" && !row.release_requested_at && !cancelled(row)),
  };
}

export default function AdminPayments() {
  const { signOut } = useAuth();
  const [rows, setRows] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  // A refused action is said in its row, beside the buttons: the top of the
  // page may be a screen away from where staff are looking.
  const [refusal, setRefusal] = useState(null);
  const narrow = useNarrow();
  const [attempts, setAttempts] = useState(() => new Map());
  // TSC's Wise balance, or why there isn't one to show.
  const [wise, setWise] = useState(null);
  const [paypal, setPaypal] = useState(null);
  const [setups, setSetups] = useState(() => new Map());

  const load = useCallback(async () => {
    try {
      const [board, tried] = await Promise.all([paymentBoard(), providerAttempts()]);
      setRows(board);
      setAttempts(new Map(tried.map((attempt) => [attempt.payment_id, attempt])));
      setError(null);
      // Only says why a row waits; the board stands without it.
      const waiting = boardSections(board).payout.filter((row) => paidByBank(row) && !row.payout_account_id && !row.factory_stripe_ready);
      factoryStripeSetup([...new Set(waiting.map((row) => row.order_id))]).then(setSetups, () => setSetups(new Map()));
    } catch (failure) {
      setError(failure);
    }
  }, []);

  /** Read back from Wise and PayPal: a preview can't receive a webhook. Each says its own failure. */
  const readBack = useCallback(async () => {
    const [fromWise, fromPaypal] = await Promise.allSettled([syncProvider("wise"), syncProvider("paypal")]);
    if (fromWise.status === "fulfilled") {
      const answer = fromWise.value;
      setWise({ balanceCents: answer.balanceCents, currency: answer.balanceCurrency, appUrl: answer.appUrl, balancesUrl: answer.balancesUrl });
    } else {
      setWise({ problem: fromWise.reason.message });
    }
    if (fromPaypal.status === "fulfilled") setPaypal({ appUrl: fromPaypal.value.appUrl });
    await load();
  }, [load]);

  useEffect(() => { load().then(readBack); }, [load, readBack]);

  // A factory can fix its details while this page is open.
  useEffect(() => {
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [load]);

  // While money is on its way, keep reading: nobody else can tell staff.
  const anyLive = [...attempts.values()].some((attempt) => attempt.status === "processing");
  useEffect(() => {
    if (!anyLive) return undefined;
    const timer = setInterval(readBack, 30000);
    return () => clearInterval(timer);
  }, [anyLive, readBack]);

  async function decide(row, decision, note) {
    setBusyId(row.payment_id);
    setRefusal(null);
    setNotice(null);
    try {
      if (decision === "retry") {
        const result = await requestRelease(row.payment_id);
        setNotice(result.released
          ? `${row.order_number}: paid out to ${row.factory_name}.`
          : `${row.order_number}: not paid out. ${result.reason ?? ""}`);
      } else if (decision === "refund_outside") {
        const { error: refused } = await supabase.rpc("record_refund_outside_stripe", { target_payment: row.payment_id, reference: note });
        if (refused) throw refused;
      } else await releasePayment(row.payment_id, note, row.payout_changed_at ?? null);
      await load();
    } catch (failure) {
      setRefusal({ paymentId: row.payment_id, failure });
    } finally {
      setBusyId(null);
    }
  }

  if (!rows) {
    return (
      <AdminWorkspaceShell onSignOut={signOut}>
        <main className="admin admin-payments-page"><h1>Payments</h1>{error ? <p className="admin-error">{error.message}</p> : <p className="admin-sub">Loading…</p>}</main>
      </AdminWorkspaceShell>
    );
  }

  return (
    <AdminWorkspaceShell onSignOut={signOut}>
      <PaymentsBoard rows={rows} error={error} notice={notice} decide={decide} busyId={busyId} narrow={narrow} refusal={refusal}
                     load={load} attempts={attempts} wise={wise} paypal={paypal} onChanged={readBack} setups={setups} />
    </AdminWorkspaceShell>
  );
}

const TABS = [
  ["payout", "Payout owed"], ["held", "Held"], ["clearing", "Processing"],
  ["failed", "Failed"],
];

/**
 * The board itself, also drawn by payments-design-preview.jsx with sample
 * rows. All four queues always have a tab.
 */
export function PaymentsBoard({ rows, error = null, notice = null, decide, busyId = null, narrow = false, refusal = null, load,
  attempts = new Map(), wise = null, paypal = null, onChanged = load, setups = new Map() }) {
  const [chosen, setChosen] = useState("payout");
  const sections = boardSections(rows, attempts);
  const shared = { onDecide: decide, busyId, narrow, refusal, onViewed: load, attempts, wise, paypal, onChanged, setups };
  const tabs = TABS;
  const active = tabs.some(([id]) => id === chosen) ? chosen : "payout";
  const owedByWise = [...sections.payout, ...sections.failed].filter((row) => paidByWise(row) && row.state === "confirmed" && row.release_requested_at && attempts.get(row.payment_id)?.status !== "processing")
    .reduce((sum, row) => sum + Number(row.amount_cents), 0);
  const wiseShort = wise?.balanceCents != null ? Math.max(0, owedByWise - wise.balanceCents) : 0;
  const wiseLine = wise ? (
    <p className={wise.problem || wiseShort ? "admin-error" : "admin-sub"} data-testid="wise-balance">
      {wise.problem ?? `Wise balance: ${moneyIn(wise.balanceCents, wise.currency)}.`}
      {wiseShort ? ` Short by ${moneyIn(wiseShort, wise.currency)} for what's owed, before Wise's fees. Top up TSC's Wise balance. ` : " "}
      {wise.balancesUrl ? <a href={wise.balancesUrl} target="_blank" rel="noreferrer">Open Wise</a> : null}
    </p>
  ) : null;

  return (
    <main className="admin admin-payments-page">
      <header className="rfqs-header admin-list-header"><div><p className="admin-eyebrow">Admin</p><h1>Payments</h1></div></header>
      {tabs.length > 1 ? (
        <nav className="rfqs-tabs admin-verification-tabs admin-rfq-tabs payments-queue-tabs" aria-label="Payment queues">
          {tabs.map(([id, label]) => (
            <button type="button" key={id} data-tab={id} className={active === id ? "active" : ""} aria-current={active === id ? "page" : undefined}
                    onClick={() => setChosen(id)}>
              {label} <span>{sections[id].length}</span>
            </button>
          ))}
        </nav>
      ) : null}

      {error ? <p className="admin-error">{error.message}</p> : null}
      {notice ? <p className="admin-sub" role="status">{notice}</p> : null}

      {active === "payout" ? (
        <Section id="payout" title="Payout owed" rows={sections.payout} {...shared} above={wiseLine}
                 empty="Every approved payment has been paid out." />
      ) : null}
      {active === "failed" ? <Section id="failed" title="Failed" rows={sections.failed} {...shared} empty="Nothing has failed." /> : null}
      {active === "clearing" ? (
        <Section id="clearing" title="Processing" rows={sections.clearing} {...shared} empty="Nothing is processing."
                 above={<p className="admin-sub" data-testid="processing-providers">{providerCounts(sections.clearing, attempts)}</p>} />
      ) : null}
      {active === "held" ? <Section id="held" title="Held" rows={sections.held} {...shared} empty="Nothing is held." /> : null}

    </main>
  );
}
