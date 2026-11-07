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
 *                    the money came through Stripe; otherwise staff pay by
 *                    bank or from TSC's Payoneer business account, by hand
 *                    (mainland China, Hong Kong… where Stripe cannot pay out;
 *                    nothing here calls Payoneer), and mark it paid out.
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
 * Modelled on AdminVerifications, including living outside the org shell and
 * carrying its own way out. Every action checks is_platform_admin() in the
 * database (or reads the payment as the caller, for the Stripe routes) before
 * it touches a row, so this page cannot grant itself anything.
 */
import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../lib/auth.jsx";
import {
  confirmPaymentReceived, paymentBoard, rejectPaymentSent, releasePayment, releasePaymentByPayoneer, revealPayoutNumber,
} from "../../lib/domain/payment.js";
import { requestRelease, stripeDashboardUrl } from "../../lib/domain/stripe.js";
import { formatMoney } from "../../lib/money.js";
import { dateFrom } from "../../lib/dates.js";
import "./admin.css";
import AdminWorkspaceShell from "./AdminWorkspaceShell.jsx";

const when = (value) => (value ? new Date(value).toLocaleString() : "—");

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
const paidByBank = (row) => !paidByStripe(row) && !paidByPayoneer(row);

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
function BankDetails({ row, onViewed }) {
  if (!row.payout_account_id) {
    return (
      <span className="admin-payout-details">
        <span className="admin-error">No bank details on file. Ask the factory to add them on its Payments page.</span>
        <FactoryContact row={row} />
      </span>
    );
  }
  const country = row.payout_country ? bankCountry.of(row.payout_country.trim()) : null;
  return (
    <span className="admin-payout-details">
      <strong className="payout-method-heading">Bank transfer</strong>
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
      {row.payout_instructions ? <span className="admin-sub admin-payout-instructions">{`Instructions: ${row.payout_instructions}`}</span> : null}
      <FactoryContact row={row} />
      {row.last_viewed_at ? <span className="admin-sub">{`Number last viewed by ${row.last_viewed_by ?? "staff"}, ${when(row.last_viewed_at)}`}</span> : null}
    </span>
  );
}

function Actions({ row, section, note, onNoteChange, payoneerId, onDecide, busy, refusal }) {
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
                : `Sent ${formatMoney(row.amount_cents, row.currency)} to ${row.factory_name} by bank, not to their Payoneer account? They will read: "${note.trim()}"`}
            </span>
            {confirming === "bank" && <label className="admin-sub payout-bank-explanation">Reason for bank payment (required)
              <input type="text" value={note} onChange={event => onNoteChange(event.target.value)} placeholder="Explain the change in payout method" />
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
                  title="Record a bank payment instead of Payoneer"
                  onClick={() => setConfirming("bank")}>
            Paid by bank instead
          </button>
        </>
      );
    }
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
          {row.payout_account_id ? ` To ${row.payout_holder || "no holder given"}, ${row.payout_bank}, ending ${row.payout_last4 ?? "unknown"}.` : " No bank details are on file."}
          {row.payout_account_id && !row.payout_has_number ? " TSC has no full number for this account." : null}
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
      <button type="button" className="admin-approve" disabled={busy || note.trim().length < REFERENCE_MIN}
              data-testid="release-payment"
              title={note.trim().length < REFERENCE_MIN ? "Enter the bank's reference for this transfer" : "Pay the factory by bank transfer first, then mark it here"}
              onClick={() => setConfirming("bank")}>
        Mark paid out by bank
      </button>
      </>
    );
  }
  return null;
}

/** Below this width the action cells move to a line of their own. */
const NARROW = "(max-width: 1100px)";

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

function Row({ row, section, onDecide, busy, narrow, refusal, onViewed }) {
  const [note, setNote] = useState("");
  const [payoneerId, setPayoneerId] = useState("");
  const acts = ACTS.has(section);

  const noteInput = acts ? (
    <>
      {section === "payout" && paidByPayoneer(row) ? (
        <label className="admin-sub">
          Payoneer payment ID (required)
          <input type="text" data-testid="payoneer-payment-id" value={payoneerId} onChange={(event) => setPayoneerId(event.target.value)} />
        </label>
      ) : null}
      {section === "payout" && paidByBank(row) ? (
        <label className="admin-sub">
          Bank reference (required). The factory and the brand can read it
          <input type="text" data-testid="bank-reference" value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
      ) : paidByPayoneer(row) && section === "payout" ? null : (
        <input type="text" aria-label="Note" placeholder={section === "wire" ? "Note, required to reject" : section === "payout" && paidByPayoneer(row) ? "If paid by bank: why. The factory reads it" : "Optional note"}
               value={note} onChange={(event) => setNote(event.target.value)} />
      )}
    </>
  ) : null;
  const buttons = <Actions row={row} section={section} note={note} onNoteChange={setNote} payoneerId={payoneerId} onDecide={onDecide} busy={busy} refusal={refusal} />;

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
          {section === "payout" && paidByBank(row) && !narrow ? <BankDetails row={row} onViewed={onViewed} /> : null}
          {section === "payout" && !paidByBank(row) ? (
            <span className="admin-payout-details"><strong className="payout-method-heading">{paidByStripe(row) ? "Stripe payout" : "Payoneer"}</strong>{!paidByStripe(row) && <PayoutField label="Payout email">{row.payoneer_email}</PayoutField>}</span>
          ) : null}
          {section === "payout" && paidByPayoneer(row) ? <FactoryContact row={row} /> : null}
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
        {narrow ? null : (
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
              {section === "payout" && paidByBank(row) ? <BankDetails row={row} onViewed={onViewed} /> : null}
              {noteInput}
              <div className="admin-actions" style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>{buttons}</div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function Section({ id, title, rows, empty, caption, onDecide, busyId, narrow, refusal, onViewed }) {
  return (
    <section className="payments-queue" data-section={id}>
      <h2>{title} ({rows.length})</h2>
      {rows.length === 0 ? (
        <div className="payments-empty"><strong>All clear</strong><p className="admin-sub">{empty}</p></div>
      ) : (
        <>
        {/* Above the table, not its <caption>: .admin-sub is display: block,
            which squeezed a caption into the first column. */}
        <p className="admin-sub admin-section-caption">{caption}</p>
        <div className="admin-scroll">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Between</th>
                <th>Amount</th>
                <th>{id === "wire" ? "Reference" : "Paid with"}</th>
                <th>When</th>
                {narrow ? null : (
                  <>
                    <th>{ACTS.has(id) ? "Note" : ""}</th>
                    <th className="payments-action-heading">Actions</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Row key={row.payment_id} row={row} section={id} onDecide={onDecide} busy={busyId === row.payment_id}
                     narrow={narrow} refusal={refusal?.paymentId === row.payment_id ? refusal.failure : null} onViewed={onViewed} />
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

  const load = useCallback(async () => {
    try {
      const board = await paymentBoard();
      setRows(board);
      setError(null);
    } catch (failure) {
      setError(failure);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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
    return <AdminWorkspaceShell onSignOut={signOut}><main className="admin admin-payments-page"><h1>Payments</h1>{error ? <p className="admin-error">{error.message}</p> : <p className="admin-sub">Loading…</p>}</main></AdminWorkspaceShell>;
  }

  return <AdminWorkspaceShell onSignOut={signOut}><PaymentsBoard rows={rows} error={error} notice={notice} decide={decide} busyId={busyId} narrow={narrow} refusal={refusal} load={load} /></AdminWorkspaceShell>;
}

export function PaymentsBoard({ rows, error, notice, decide, busyId, narrow, refusal, load }) {
  const [activeTab, setActiveTab] = useState("payout");
  const sections = boardSections(rows);
  const tabs = [["payout", "Payout owed"], ["held", "Held"], ["clearing", "Processing"], ["wire", "Bank-wire claims"], ["failed", "Failed"], ["refunded", "Refunded after payout"], ["cancelled", "Cancelled orders"]];
  const shared = { onDecide: decide, busyId, narrow, refusal, onViewed: load };

  return (
    <main className="admin admin-payments-page">

      <header className="rfqs-header admin-list-header"><div><p className="admin-eyebrow">Admin</p><h1>Payments</h1><p>Manage held payments, review exceptions, and track factory payouts.</p></div></header>
      <nav className="rfqs-tabs admin-verification-tabs admin-rfq-tabs payments-queue-tabs" aria-label="Payment queues">
        {tabs.map(([id, label]) => <button type="button" key={id} className={activeTab === id ? "active" : ""} aria-current={activeTab === id ? "page" : undefined} onClick={() => setActiveTab(id)}>{label} <span>{sections[id].length}</span></button>)}
      </nav>
      {error ? <p className="admin-error">{error.message}</p> : null}
      {notice ? <p className="admin-sub" role="status">{notice}</p> : null}

      {activeTab === "payout" && (
      <Section id="payout" title="Payout owed" rows={sections.payout} {...shared}
               empty="Every approved payment has been paid out."
               caption="The brand approved these steps (on a cancelled order too, if it approved before the cancellation). Retry a Stripe payout, or pay by bank or Payoneer by hand and mark it paid out." />
      )}
      {activeTab === "refunded" ? (
        <Section id="refunded" title="Refunded after payout" rows={sections.refunded} {...shared}
                 empty="No refunds after payout."
                 caption="The brand's payment was refunded in Stripe after the factory was paid. TSC no longer holds this money: recover it from the factory by hand." />
      ) : null}
      {activeTab === "wire" && (
      <Section id="wire" title="Bank-wire claims" rows={sections.wire} {...shared}
               empty="No bank-wire claims."
               caption="Made on the old site before payments moved to Stripe. Check the account, then confirm." />
      )}
      {activeTab === "failed" && (
      <Section id="failed" title="Failed" rows={sections.failed} {...shared}
               empty="No failed payments."
               caption="These did not go through, or were refunded. The brand pays again from the order; nothing to do here." />
      )}
      {activeTab === "clearing" && (
      <Section id="clearing" title="Payments processing" rows={sections.clearing} {...shared}
               empty="No payments processing."
               caption="Stripe is still confirming these. The factory starts when they go through." />
      )}
      {activeTab === "held" && (
      <Section id="held" title="Held" rows={sections.held} {...shared}
               empty="Nothing held."
               caption="Funded, waiting for the brand to approve the step." />
      )}
      {activeTab === "cancelled" && (
      <Section id="cancelled" title="Held on cancelled orders" rows={sections.cancelled} {...shared}
               empty="No money held on cancelled orders."
               caption="The order was cancelled with this money held. Refund it in Stripe; the row leaves once Stripe reports the refund." />
      )}


    </main>
  );
}
