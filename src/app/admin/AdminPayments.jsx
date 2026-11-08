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
 *                    bank by hand and marking it stays as the fallback, and
 *                    Payoneer rows saved before keep their manual path.
 *   Refunded after payout
 *                    the brand's money was refunded in Stripe after the
 *                    factory was paid: TSC paid out money it no longer holds,
 *                    and only a person can recover it.
 *   Wire claims      a bank transfer a brand said it sent on the old site.
 *   Failed           a payment that did not go through: the brand pays again.
 *   Clearing         a payment Stripe is still confirming.
 *   Held             funded, the step not approved yet.
 *   Cancelled        money still held on a cancelled order: refund in Stripe.
 *                    The refund is recorded from Stripe and the row leaves.
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
  confirmPaymentReceived, factoryStripeSetup, paymentBoard, payoutNumberRevealLog, rejectPaymentSent, releasePayment, releasePaymentByPayoneer, revealPayoutNumber,
} from "../../lib/domain/payment.js";
import { cancelProviderPayout, payByProvider, previewWise, providerAttempts, syncProvider, tellFactoryToFixDetails } from "../../lib/domain/provider-payouts.js";
import { requestRelease, stripeDashboardUrl } from "../../lib/domain/stripe.js";
import { formatMoney } from "../../lib/money.js";
import { dateFrom } from "../../lib/dates.js";
import "./admin.css";
import AdminWorkspaceShell from "./AdminWorkspaceShell.jsx";

const WHEN = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
const when = (value) => (value ? WHEN.format(new Date(value)) : "—");

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
  refunded: (row) => row.release_requested_at,
  wire: (row) => row.sent_at,
  failed: (row) => row.failed_at,
  clearing: (row) => row.processing_at,
  held: (row) => row.confirmed_at,
  cancelled: (row) => row.confirmed_at ?? row.processing_at,
};

const paidByStripe = (row) => row.factory_stripe_ready && row.stripe_payment_intent_id;
const paidByPayoneer = (row) => !paidByStripe(row) && row.payout_method === "payoneer";
const paidByPaypal = (row) => !paidByStripe(row) && row.payout_method === "paypal";
const paidByBank = (row) => !paidByStripe(row) && !paidByPayoneer(row) && !paidByPaypal(row);
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
          <PayoutField label="Account number"><span data-testid="revealed-number">{shown.account_number}</span></PayoutField>
          <span className="payout-number-actions"><button type="button" className="admin-link payout-text-action" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
          <button type="button" className="admin-link payout-text-action" onClick={hide}>Hide</button></span>
        </>
      ) : (
        <>
          <PayoutField label="Account number">{`····${row.payout_last4 ?? ""}`}</PayoutField>
          <button type="button" className="admin-link payout-text-action" disabled={busy} data-testid="reveal-number" title="Your name is recorded each time" onClick={reveal}>
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

function FactoryContact({ row }) {
  const parts = [row.contact_name, row.contact_phone].filter((part) => part && part.trim());
  return row.contact_email || parts.length ? (
    <PayoutField label="Factory contact">
      {parts.length ? `${parts.join(", ")}, ` : null}
      {row.contact_email ? <a href={`mailto:${row.contact_email}`}>{row.contact_email}</a> : null}
    </PayoutField>
  ) : <span className="admin-sub">No contact on file for this company.</span>;
}

/** Everything staff need to send the money, on the row. */
function BankDetails({ row, onViewed, lastView, stripeSetup }) {
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
      <PayoutField label="SWIFT / BIC">{row.payout_swift || "Not provided"}</PayoutField>
      {row.payout_has_number
        ? <AccountNumber row={row} onViewed={onViewed} />
        : <span className="admin-error" data-testid="no-full-number">No full account number on file, so TSC can't pay this yet. Ask the factory to add it on its Payments page.</span>}
      {row.payout_instructions ? <PayoutField label="Instructions"><span className="admin-payout-instructions">{row.payout_instructions}</span></PayoutField> : null}
      <FactoryContact row={row} />
      {row.last_viewed_at ? <span className="admin-sub">{`${lastView?.how === "sent_to_wise" ? "Number last sent to Wise by" : "Number last viewed by"} ${row.last_viewed_by ?? "staff"}, ${when(row.last_viewed_at)}`}</span> : null}
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
          ? <span className="admin-sub" data-testid="provider-quote">{`Quoted: arrives ${moneyIn(attempt.received_minor, attempt.received_currency)}${attempt.fee_minor != null ? ` after ${name}'s fee of ${moneyIn(attempt.fee_minor, row.currency)}` : ""}`}</span>
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
            ? `Send ${moneyIn(row.amount_cents, row.currency)} to ${row.payout_holder || row.factory_name}, ${row.payout_bank} ending ${row.payout_last4 ?? "unknown"}?${preview.feeCents == null ? "" : ` Wise fee ${moneyIn(preview.feeCents, row.currency)}. Arrives ${moneyIn(preview.arrivesCents, preview.arrivesCurrency)}.`}`
            : `Send ${moneyIn(row.amount_cents, row.currency)} to ${row.paypal_email} by PayPal?`}
        </span>
        {short ? (
          <span className="admin-error admin-row-message" data-testid="wise-short">
            {`Wise balance ${moneyIn(preview.balanceCents, row.currency)} is short by ${moneyIn(preview.shortByCents, row.currency)}. Top up TSC's Wise balance, then press Check again. `}
            <a href={preview.balancesUrl} target="_blank" rel="noreferrer">Open Wise</a>
          </span>
        ) : null}
        {preview.nothingLeft ? <span className="admin-error admin-row-message">Wise's fee is more than this payment, so nothing would arrive. Pay it another way.</span> : null}
        {short ? (
          <button type="button" className="quiet-btn" disabled={working} data-testid="provider-check-again" onClick={review}>Check again</button>
        ) : (
          <button type="button" className="admin-approve" disabled={working || preview.nothingLeft} data-testid="provider-confirm"
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
      {problem?.kind === "details_rejected" ? (
        <button type="button" className="quiet-btn" disabled={working} data-testid="provider-tell-factory"
                onClick={() => run(() => tellFactoryToFixDetails(provider, row, problem.message, statement, problem.fields))}>
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
        {`Pay with ${name}`}
      </button>
    </>
  );
}

function Actions({ row, section, note, onNoteChange, payoneerId, onDecide, busy, refusal, attempt, wise, paypal, onChanged }) {
  const said = refusal ? <span className="admin-error admin-row-message" role="alert" data-testid="payment-refusal">{refusal.message}</span> : null;
  // Marking a payout paid by bank cannot be undone from here and tells the
  // factory it was paid, so it asks once, saying the amount and where to.
  const [confirming, setConfirming] = useState(null);
  if (section === "wire") {
    return (
      <>
        {said}
        <button type="button" className="admin-approve" disabled={busy}
                data-testid="confirm-payment"
                onClick={() => onDecide(row, "confirm", note)}>
          Confirm received
        </button>
        <button type="button" className="admin-reject" disabled={busy || !note.trim()}
                title={note.trim() ? undefined : "Say why; the brand sees this"}
                onClick={() => onDecide(row, "reject", note)}>
          Not received
        </button>
      </>
    );
  }
  if (section === "payout") {
    if (paidByPayoneer(row)) {
      const id = payoneerId.trim();
      if (confirming) {
        return (
          <>
            <span className="admin-sub admin-row-message" role="alert">
              {confirming === "payoneer"
                ? `Sent ${formatMoney(row.amount_cents, row.currency)} to ${row.factory_name} by Payoneer (${row.payoneer_email}), payment ID ${id}?`
                : `Sent ${formatMoney(row.amount_cents, row.currency)} to ${row.factory_name} by bank, not to their Payoneer account?`}
            </span>
            {confirming === "bank" && <label className="admin-sub payout-bank-explanation">Reason for bank payment (required). The factory reads it
              <input type="text" aria-label="Note" value={note} onChange={(event) => onNoteChange(event.target.value)} />
            </label>}
            <button type="button" className="admin-approve" disabled={busy || (confirming === "bank" && note.trim().length < REFERENCE_MIN)}
                    data-testid="release-payment-confirm"
                    onClick={() => { const how = confirming; setConfirming(null); onDecide(row, how === "payoneer" ? "payoneer" : "release", note, id); }}>
              Yes, mark paid out
            </button>
            <button type="button" className="admin-reject" disabled={busy}
                    onClick={() => setConfirming(null)}>
              Cancel
            </button>
          </>
        );
      }
      return (
        <>
          {said}
          <button type="button" className="admin-approve" disabled={busy || !id}
                  data-testid="release-payoneer"
                  title={id ? "Pay from TSC's Payoneer business account first, then mark it here" : "Enter the payment ID from Payoneer"}
                  onClick={() => setConfirming("payoneer")}>
            Mark paid out by Payoneer
          </button>
          <button type="button" className="admin-link payout-text-action" disabled={busy}
                  data-testid="release-bank-instead"
                  onClick={() => setConfirming("bank")}>
            Paid by bank instead
          </button>
        </>
      );
    }
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

const ACTS = new Set(["wire", "payout"]);

function Row({ row, section, onDecide, busy, narrow, refusal, onViewed, attempt, wise, paypal, onChanged, views, setups }) {
  const lastView = views?.find((view) => view.account_id === row.payout_account_id && view.revealed_at === row.last_viewed_at);
  const [note, setNote] = useState("");
  const [payoneerId, setPayoneerId] = useState("");
  const acts = ACTS.has(section);
  const providerLive = attempt?.status === "processing" && providerFor(row);

  const noteInput = acts ? (
    <>
      {section === "payout" && paidByPayoneer(row) ? (
        <label className="admin-sub">
          Payoneer payment ID (required)
          <input type="text" data-testid="payoneer-payment-id" value={payoneerId} onChange={(event) => setPayoneerId(event.target.value)} />
        </label>
      ) : null}
      {providerLive || (section === "payout" && !paidByStripe(row) && !paidByPayoneer(row) && !canMarkByBank(row)) ? null : section === "payout" && paidByBank(row) ? (
        <label className="admin-sub">
          {providerFor(row) ? "If you paid by bank instead: the bank's reference. " : "Bank reference (required). "}The factory and the brand can read it
          <input type="text" data-testid="bank-reference" value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
      ) : section === "payout" && paidByPayoneer(row) ? null : (
        <input type="text" aria-label="Note" placeholder={section === "wire" ? "Note, required to reject" : section === "payout" && paidByPayoneer(row) ? "If paid by bank: why. The factory reads it" : "Optional note"}
               value={note} onChange={(event) => setNote(event.target.value)} />
      )}
    </>
  ) : null;
  const buttons = <Actions row={row} section={section} note={note} onNoteChange={setNote} payoneerId={payoneerId} onDecide={onDecide} busy={busy} refusal={refusal} attempt={attempt} wise={wise} paypal={paypal} onChanged={onChanged} />;

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
              ? `charged ${formatMoney(row.charged_cents, row.currency)} incl. fee`
              : `fee ${formatMoney(row.fee_cents, row.currency)}`}
          </span>
        </td>
        <td>
          {section === "wire"
            ? row.brand_reference || <span className="admin-sub">no reference given</span>
            : row.payment_method_label || <span className="admin-sub">—</span>}
          {(section === "failed" || section === "refunded") && row.failure_reason
            ? <span className="admin-sub">{row.failure_reason}</span>
            : null}
          {section === "payout" && paidByBank(row) && !narrow ? <BankDetails row={row} onViewed={onViewed} lastView={lastView} stripeSetup={setups?.get(row.order_id)} /> : null}
          {section === "payout" && !paidByBank(row) ? (
            <span className="admin-payout-details">
              <strong className="payout-method-heading">{paidByStripe(row) ? "Stripe payout" : paidByPaypal(row) ? "PayPal" : "Payoneer"}</strong>
              {paidByPaypal(row) ? <PayoutField label="Payout email">{attempt?.status === "processing" ? attempt.paid_to : row.paypal_email}</PayoutField> : null}
              {paidByPayoneer(row) ? <PayoutField label="Payout email">{row.payoneer_email}</PayoutField> : null}
            </span>
          ) : null}
          {section === "payout" && (paidByPayoneer(row) || paidByPaypal(row)) ? <FactoryContact row={row} /> : null}
          {section === "refunded" && row.payoneer_payment_id
            ? <span className="admin-sub">{`paid by Payoneer, payment ID ${row.payoneer_payment_id}`}</span>
            : null}
        </td>
        <td>
          <PaymentDate value={ROW_TIME[section](row)} />
          {row.stripe_payment_intent_id ? (
            <a className="admin-sub" href={stripeDashboardUrl("payments", row.stripe_payment_intent_id)}
               target="_blank" rel="noreferrer">Open in Stripe</a>
          ) : null}
        </td>
        {narrow || !acts ? null : (
          <>
            <td className="payments-note-cell">{noteInput}</td>
            <td className="admin-actions">{buttons}</td>
          </>
        )}
      </tr>
      {narrow && acts ? (
        <tr data-payment-actions={row.payment_id}>
          <td colSpan={5}>
            {/* Pinned to the left edge and no wider than the screen, so the
                note and buttons stay in view however the table is scrolled. */}
            <div className="payments-mobile-actions">
              {section === "payout" && paidByBank(row) ? <BankDetails row={row} onViewed={onViewed} lastView={lastView} stripeSetup={setups?.get(row.order_id)} /> : null}
              {noteInput}
              <div className="admin-actions" style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>{buttons}</div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function Section({ id, title, rows, empty, caption, onDecide, busyId, narrow, refusal, onViewed, attempts, wise, paypal, onChanged, above, views, setups }) {
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
                <th>{id === "wire" ? "Reference" : "Paid with"}</th>
                <th>When</th>
                {narrow || !ACTS.has(id) ? null : (
                  <>
                    <th>{ACTS.has(id) ? "Note" : ""}</th>
                    <th className="payments-action-heading">{ACTS.has(id) ? "Actions" : ""}</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Row views={views} setups={setups} key={row.payment_id} row={row} section={id} onDecide={onDecide} busy={busyId === row.payment_id}
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

/** Splits the board's rows into its sections. */
export function boardSections(rows) {
  const cancelled = (row) => row.order_status === "cancelled";
  return {
    payout: rows.filter((row) => row.state === "confirmed" && row.release_requested_at),
    // The board lists a paid-out payment only when it was refunded after.
    refunded: rows.filter((row) => row.state === "released"),
    wire: rows.filter((row) => row.state === "sent"),
    failed: rows.filter((row) => row.state === "failed" && !cancelled(row)),
    clearing: rows.filter((row) => row.state === "processing" && !cancelled(row)),
    held: rows.filter((row) => row.state === "confirmed" && !row.release_requested_at && !cancelled(row)),
    cancelled: rows.filter((row) => ["confirmed", "processing"].includes(row.state) && !row.release_requested_at && cancelled(row)),
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
  const [views, setViews] = useState([]);
  const [attempts, setAttempts] = useState(() => new Map());
  // TSC's Wise balance, or why there isn't one to show.
  const [wise, setWise] = useState(null);
  const [paypal, setPaypal] = useState(null);
  const [setups, setSetups] = useState(() => new Map());

  const load = useCallback(async () => {
    try {
      const [board, viewLog, tried] = await Promise.all([paymentBoard(), payoutNumberRevealLog(), providerAttempts()]);
      setRows(board);
      setViews(viewLog);
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

  async function decide(row, decision, note, payoneerId) {
    setBusyId(row.payment_id);
    setRefusal(null);
    setNotice(null);
    try {
      if (decision === "confirm") await confirmPaymentReceived(row.payment_id, { note });
      else if (decision === "reject") await rejectPaymentSent(row.payment_id, note);
      else if (decision === "retry") {
        const result = await requestRelease(row.payment_id);
        setNotice(result.released
          ? `${row.order_number}: paid out to ${row.factory_name}.`
          : `${row.order_number}: not paid out. ${result.reason ?? ""}`);
      } else if (decision === "payoneer") {
        await releasePaymentByPayoneer(row.payment_id, { paidTo: row.payoneer_email, payoneerPaymentId: payoneerId, note });
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
      <AdminWorkspaceShell onSignOut={signOut} extraNav={STAFF_PAGES}>
        <main className="admin admin-payments-page"><h1>Payments</h1>{error ? <p className="admin-error">{error.message}</p> : <p className="admin-sub">Loading…</p>}</main>
      </AdminWorkspaceShell>
    );
  }

  return (
    <AdminWorkspaceShell onSignOut={signOut} extraNav={STAFF_PAGES}>
      <PaymentsBoard rows={rows} error={error} notice={notice} decide={decide} busyId={busyId} narrow={narrow} refusal={refusal}
                     load={load} attempts={attempts} wise={wise} paypal={paypal} onChanged={readBack} views={views} setups={setups} />
    </AdminWorkspaceShell>
  );
}

/** Staff's other board, which the admin console reaches the same way. */
const STAFF_PAGES = [{ label: "Messages", icon: "messages", href: "/app.html/admin/messages" }];

const TABS = [
  ["payout", "Payout owed"], ["held", "Held"], ["clearing", "Processing"], ["wire", "Bank-wire claims"],
  ["failed", "Failed"], ["refunded", "Refunded after payout"], ["cancelled", "Held on cancelled orders"],
];

/**
 * The board itself, also drawn by payments-design-preview.jsx with sample
 * rows. Payout owed always has a tab; another queue only while it has rows.
 */
export function PaymentsBoard({ rows, error = null, notice = null, decide, busyId = null, narrow = false, refusal = null, load,
  attempts = new Map(), wise = null, paypal = null, onChanged = load, views = [], setups = new Map() }) {
  const [chosen, setChosen] = useState("payout");
  const sections = boardSections(rows);
  const shared = { onDecide: decide, busyId, narrow, refusal, onViewed: load, attempts, wise, paypal, onChanged, views, setups };
  const tabs = TABS.filter(([id]) => id === "payout" || sections[id].length);
  // A queue that empties while open falls back to Payout owed.
  const active = tabs.some(([id]) => id === chosen) ? chosen : "payout";
  const owedByWise = sections.payout.filter((row) => paidByWise(row) && attempts.get(row.payment_id)?.status !== "processing")
    .reduce((sum, row) => sum + Number(row.amount_cents), 0);
  const wiseShort = wise?.balanceCents != null ? Math.max(0, owedByWise - wise.balanceCents) : 0;
  const wiseLine = wise ? (
    <p className={wise.problem || wiseShort ? "admin-error" : "admin-sub"} data-testid="wise-balance">
      {wise.problem ?? `Wise balance: ${moneyIn(wise.balanceCents, wise.currency)}.`}
      {wiseShort ? ` Short by ${moneyIn(wiseShort, wise.currency)} for what's owed. Top up TSC's Wise balance. ` : " "}
      {wise.balancesUrl ? <a href={wise.balancesUrl} target="_blank" rel="noreferrer">Open Wise</a> : null}
    </p>
  ) : null;

  return (
    <main className="admin admin-payments-page">
      <header className="rfqs-header admin-list-header"><div><p className="admin-eyebrow">Admin</p><h1>Payments</h1><p>Check payments received, payouts owed to factories, and money held on cancelled orders. Confirm bank-wire claims only after checking the account.</p></div></header>
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
                 empty="Every approved payment has been paid out."
                 caption="The brand approved these steps (including before an order was cancelled), or the step needs no approval. Retry the payout, or pay by bank and mark it paid out after sending the money." />
      ) : null}
      {active === "refunded" ? (
        <Section id="refunded" title="Refunded after payout" rows={sections.refunded} {...shared}
                 caption="The brand's payment was refunded in Stripe after the factory was paid. TSC no longer holds this money: recover it from the factory by hand." />
      ) : null}
      {active === "wire" ? <Section id="wire" title="Bank-wire claims" rows={sections.wire} {...shared} caption="Made on the old site before payments moved to Stripe. Check the account, then confirm." /> : null}
      {active === "failed" ? <Section id="failed" title="Failed" rows={sections.failed} {...shared} caption="These did not go through, or were refunded. The brand pays again from the order; nothing to do here." /> : null}
      {active === "clearing" ? <Section id="clearing" title="Payments processing" rows={sections.clearing} {...shared} caption="Stripe is still confirming these. The factory starts when they go through." /> : null}
      {active === "held" ? <Section id="held" title="Held" rows={sections.held} {...shared} caption="Funded, waiting for the brand to approve the step." /> : null}
      {active === "cancelled" ? (
        <Section id="cancelled" title="Held on cancelled orders" rows={sections.cancelled} {...shared}
                 caption="The order was cancelled with this money held. Refund it in Stripe; the row leaves once Stripe reports the refund." />
      ) : null}

      {views.length === 0 ? null : (
      <details className="admin-views-fold" data-section="views">
        <summary>Number views ({views.length})</summary>
        {(
          <>
          <div className="admin-scroll">
            <table>
              <thead><tr><th>When</th><th>Who</th><th>What</th><th>Company</th><th>Account</th></tr></thead>
              <tbody>
                {views.map((view) => (
                  <tr key={`${view.account_id}-${view.revealed_at}`}>
                    <td>{when(view.revealed_at)}</td>
                    <td>{view.staff_email ?? "—"}</td>
                    <td>{view.how === "sent_to_wise" ? "Sent to Wise" : "Show number"}</td>
                    <td>{view.org_name}</td>
                    <td>{`${view.bank_name ?? "Bank"} ····${view.last4 ?? ""}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </details>
      )}
    </main>
  );
}
