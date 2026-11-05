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
import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../lib/auth.jsx";
import {
  confirmPaymentReceived, paymentBoard, rejectPaymentSent, releasePayment, releasePaymentByPayoneer,
} from "../../lib/domain/payment.js";
import { requestRelease, stripeDashboardUrl } from "../../lib/domain/stripe.js";
import { formatMoney } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";
import "./admin.css";

const when = (value) => (value ? new Date(value).toLocaleString() : "—");

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

function Actions({ row, section, note, payoneerId, onDecide, busy, refusal }) {
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
            <button type="button" className="admin-approve" disabled={busy}
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
          <button type="button" className="quiet-btn" disabled={busy || !note.trim()}
                  data-testid="release-bank-instead"
                  title={note.trim() ? undefined : "Add a note saying why it was paid by bank"}
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
          {row.payout_summary === "no bank details on file" ? " No bank details are on file." : null}
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
      <button type="button" className="admin-approve" disabled={busy}
              data-testid="release-payment"
              title="Pay the factory by bank transfer first, then mark it here"
              onClick={() => setConfirming("bank")}>
        Mark paid out by bank
      </button>
      </>
    );
  }
  return null;
}

/** Below this width the action cells move to a line of their own. */
const NARROW = "(max-width: 760px)";

const narrowQuery = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(NARROW) : null);

function useNarrow() {
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

function Row({ row, section, onDecide, busy, narrow, refusal }) {
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
      <input type="text" aria-label="Note" placeholder={section === "wire" ? "Note, required to reject" : section === "payout" && paidByPayoneer(row) ? "Note, required if paid by bank" : "Optional note"}
             value={note} onChange={(event) => setNote(event.target.value)} />
    </>
  ) : null;
  const buttons = <Actions row={row} section={section} note={note} payoneerId={payoneerId} onDecide={onDecide} busy={busy} refusal={refusal} />;

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
          {section === "payout" ? (
            <span className="admin-sub">
              {paidByStripe(row)
                ? "pay out through Stripe"
                : paidByPayoneer(row)
                  ? `pay by Payoneer: ${row.payoneer_email}`
                  : `pay by bank: ${row.payout_summary}`}
            </span>
          ) : null}
          {section === "refunded" && row.payoneer_payment_id
            ? <span className="admin-sub">{`paid by Payoneer, payment ID ${row.payoneer_payment_id}`}</span>
            : null}
        </td>
        <td>
          {when(ROW_TIME[section](row))}
          {row.stripe_payment_intent_id ? (
            <a className="admin-sub" href={stripeDashboardUrl("payments", row.stripe_payment_intent_id)}
               target="_blank" rel="noreferrer">Open in Stripe</a>
          ) : null}
        </td>
        {narrow ? null : (
          <>
            <td>{noteInput}</td>
            <td className="admin-actions">{buttons}</td>
          </>
        )}
      </tr>
      {narrow && acts ? (
        <tr data-payment-actions={row.payment_id}>
          <td colSpan={5}>
            {/* Pinned to the left edge and no wider than the screen, so the
                note and buttons stay in view however the table is scrolled. */}
            <div style={{ position: "sticky", left: 0, maxWidth: "calc(100vw - 80px)" }}>
              {noteInput}
              <div className="admin-actions" style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>{buttons}</div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function Section({ id, title, rows, empty, caption, onDecide, busyId, narrow, refusal }) {
  return (
    <section data-section={id}>
      <h2>{title} ({rows.length})</h2>
      {rows.length === 0 ? (
        <p className="admin-sub">{empty}</p>
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
                    <th />
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Row key={row.payment_id} row={row} section={id} onDecide={onDecide} busy={busyId === row.payment_id}
                     narrow={narrow} refusal={refusal?.paymentId === row.payment_id ? refusal.failure : null} />
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
  const { user, signOut } = useAuth();
  const { navigate } = useRouter();
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
      setRows(await paymentBoard());
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
      } else await releasePayment(row.payment_id, note);
      await load();
    } catch (failure) {
      setRefusal({ paymentId: row.payment_id, failure });
    } finally {
      setBusyId(null);
    }
  }

  const header = (
    <header className="admin-bar">
      <span className="shell-mark">The Sourcing Club</span>
      <span className="admin-sub">{user?.email}</span>
      <button type="button" className="quiet-btn" onClick={() => navigate("/admin")}>All tools</button>
      <button type="button" className="quiet-btn" onClick={signOut}>Sign out</button>
    </header>
  );

  if (!rows) {
    return <div className="admin">{header}<h1>Payments</h1>{error ? <p className="admin-error">{error.message}</p> : <p className="admin-sub">Loading…</p>}</div>;
  }

  const sections = boardSections(rows);
  const shared = { onDecide: decide, busyId, narrow, refusal };

  return (
    <div className="admin">
      {header}

      <h1>Payments</h1>
      <p className="admin-intro">
        Brands pay TSC through Stripe, by card, and TSC holds the money until
        the brand approves the step. Approving pays a factory with a Stripe account on its own.
        Stripe can't pay out to some countries (mainland China, Hong Kong…): those factories are
        paid by hand, by bank transfer or from TSC's Payoneer business account, and marked paid out
        here. Nothing here sends money or calls Payoneer.
      </p>

      {error ? <p className="admin-error">{error.message}</p> : null}
      {notice ? <p className="admin-sub" role="status">{notice}</p> : null}

      <Section id="payout" title="Payout owed" rows={sections.payout} {...shared}
               empty="Every approved payment has been paid out."
               caption="The brand approved these steps (on a cancelled order too, if it approved before the cancellation). Retry a Stripe payout, or pay by bank or Payoneer by hand and mark it paid out." />
      {sections.refunded.length ? (
        <Section id="refunded" title="Refunded after payout" rows={sections.refunded} {...shared}
                 empty=""
                 caption="The brand's payment was refunded in Stripe after the factory was paid. TSC no longer holds this money: recover it from the factory by hand." />
      ) : null}
      <Section id="wire" title="Bank-wire claims" rows={sections.wire} {...shared}
               empty="No bank-wire claims."
               caption="Made on the old site before payments moved to Stripe. Check the account, then confirm." />
      <Section id="failed" title="Failed" rows={sections.failed} {...shared}
               empty="No failed payments."
               caption="These did not go through, or were refunded. The brand pays again from the order; nothing to do here." />
      <Section id="clearing" title="Payments processing" rows={sections.clearing} {...shared}
               empty="No payments processing."
               caption="Stripe is still confirming these. The factory starts when they go through." />
      <Section id="held" title="Held" rows={sections.held} {...shared}
               empty="Nothing held."
               caption="Funded, waiting for the brand to approve the step." />
      <Section id="cancelled" title="Held on cancelled orders" rows={sections.cancelled} {...shared}
               empty="No money held on cancelled orders."
               caption="The order was cancelled with this money held. Refund it in Stripe; the row leaves once Stripe reports the refund." />
    </div>
  );
}
