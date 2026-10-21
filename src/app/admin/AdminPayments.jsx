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
 *   Payout owed      approved and not paid out. "Retry payout" when the
 *                    factory has a Stripe account that can take transfers and
 *                    the money came through Stripe; otherwise staff pay by
 *                    bank (mainland China, Hong Kong… where Stripe cannot pay
 *                    out) and mark it paid out.
 *   Wire claims      a bank transfer a brand said it sent on the old site.
 *   Failed           a payment that did not go through: the brand pays again.
 *   Clearing         a payment Stripe is still confirming.
 *   Held             funded, the step not approved yet.
 *   Cancelled        money still held on a cancelled order: refund in Stripe.
 *
 * Modelled on AdminVerifications, including living outside the org shell and
 * carrying its own way out. Every action checks is_platform_admin() in the
 * database (or reads the payment as the caller, for the Stripe routes) before
 * it touches a row, so this page cannot grant itself anything.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../lib/auth.jsx";
import {
  confirmPaymentReceived, paymentBoard, rejectPaymentSent, releasePayment,
} from "../../lib/domain/payment.js";
import { requestRelease, stripeDashboardUrl } from "../../lib/domain/stripe.js";
import { formatMoney } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";
import "./admin.css";

const when = (value) => (value ? new Date(value).toLocaleString() : "—");

/** The row's own date for the section it is in. */
const ROW_TIME = {
  payout: (row) => row.release_requested_at,
  wire: (row) => row.sent_at,
  failed: (row) => row.failed_at,
  clearing: (row) => row.processing_at,
  held: (row) => row.confirmed_at,
  cancelled: (row) => row.confirmed_at ?? row.processing_at,
};

function Actions({ row, section, note, onDecide, busy }) {
  if (section === "wire") {
    return (
      <>
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
    return row.factory_stripe_ready && row.stripe_payment_intent_id ? (
      <button type="button" className="admin-approve" disabled={busy}
              data-testid="retry-payout"
              onClick={() => onDecide(row, "retry", note)}>
        Retry payout
      </button>
    ) : (
      <button type="button" className="admin-approve" disabled={busy}
              data-testid="release-payment"
              title="Pay the factory by bank transfer first, then mark it here"
              onClick={() => onDecide(row, "release", note)}>
        Mark paid out by bank
      </button>
    );
  }
  return null;
}

function Row({ row, section, onDecide, busy }) {
  const [note, setNote] = useState("");
  const acts = section === "wire" || section === "payout";

  return (
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
        {section === "failed" && row.failure_reason ? <span className="admin-sub">{row.failure_reason}</span> : null}
        {section === "payout" ? (
          <span className="admin-sub">
            {row.factory_stripe_ready && row.stripe_payment_intent_id
              ? "pay out through Stripe"
              : `pay by bank: ${row.payout_summary}`}
          </span>
        ) : null}
      </td>
      <td>
        {when(ROW_TIME[section](row))}
        {row.stripe_payment_intent_id ? (
          <a className="admin-sub" href={stripeDashboardUrl("payments", row.stripe_payment_intent_id)}
             target="_blank" rel="noreferrer">Open in Stripe</a>
        ) : null}
      </td>
      <td>
        {acts ? (
          <input type="text" placeholder={section === "wire" ? "Note, required to reject" : "Optional note"}
                 value={note} onChange={(event) => setNote(event.target.value)} />
        ) : null}
      </td>
      <td className="admin-actions">
        <Actions row={row} section={section} note={note} onDecide={onDecide} busy={busy} />
      </td>
    </tr>
  );
}

function Section({ id, title, rows, empty, caption, onDecide, busyId }) {
  return (
    <section data-section={id}>
      <h2>{title} ({rows.length})</h2>
      {rows.length === 0 ? (
        <p className="admin-sub">{empty}</p>
      ) : (
        <div className="admin-scroll">
          <table>
            <caption className="admin-sub">{caption}</caption>
            <thead>
              <tr>
                <th>Order</th>
                <th>Between</th>
                <th>Amount</th>
                <th>{id === "wire" ? "Reference" : "Paid with"}</th>
                <th>When</th>
                <th>{id === "wire" || id === "payout" ? "Note" : ""}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Row key={row.payment_id} row={row} section={id} onDecide={onDecide} busy={busyId === row.payment_id} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Splits the board's rows into its sections. */
export function boardSections(rows) {
  const cancelled = (row) => row.order_status === "cancelled";
  return {
    payout: rows.filter((row) => row.state === "confirmed" && row.release_requested_at),
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

  const load = useCallback(async () => {
    try {
      setRows(await paymentBoard());
      setError(null);
    } catch (failure) {
      setError(failure);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function decide(row, decision, note) {
    setBusyId(row.payment_id);
    setError(null);
    setNotice(null);
    try {
      if (decision === "confirm") await confirmPaymentReceived(row.payment_id, { note });
      else if (decision === "reject") await rejectPaymentSent(row.payment_id, note);
      else if (decision === "retry") {
        const result = await requestRelease(row.payment_id);
        setNotice(result.released
          ? `${row.order_number}: paid out to ${row.factory_name}.`
          : `${row.order_number}: not paid out. ${result.reason ?? ""}`);
      } else await releasePayment(row.payment_id, note);
      await load();
    } catch (failure) {
      setError(failure);
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
  const shared = { onDecide: decide, busyId };

  return (
    <div className="admin">
      {header}

      <h1>Payments</h1>
      <p className="admin-intro">
        Brands pay TSC through Stripe, by card, and TSC holds the money until
        the brand approves the step. Approving pays a factory with a Stripe account on its own.
        Stripe can't pay out to some countries (mainland China, Hong Kong…): those factories are
        paid by bank transfer from here.
      </p>

      {error ? <p className="admin-error">{error.message}</p> : null}
      {notice ? <p className="admin-sub" role="status">{notice}</p> : null}

      <Section id="payout" title="Payout owed" rows={sections.payout} {...shared}
               empty="Every approved payment has been paid out."
               caption="The brand approved these steps. Retry a Stripe payout, or pay by bank and mark it paid out." />
      <Section id="wire" title="Bank-wire claims" rows={sections.wire} {...shared}
               empty="No bank-wire claims."
               caption="Made on the old site before payments moved to Stripe. Check the account, then confirm." />
      <Section id="failed" title="Failed" rows={sections.failed} {...shared}
               empty="No failed payments."
               caption="These did not go through. The brand pays again from the order; nothing to do here." />
      <Section id="clearing" title="Payments processing" rows={sections.clearing} {...shared}
               empty="No payments processing."
               caption="Stripe is still confirming these. The factory starts when they go through." />
      <Section id="held" title="Held" rows={sections.held} {...shared}
               empty="Nothing held."
               caption="Funded, waiting for the brand to approve the step." />
      <Section id="cancelled" title="Held on cancelled orders" rows={sections.cancelled} {...shared}
               empty="No money held on cancelled orders."
               caption="The order was cancelled with this money held. Refund it in Stripe." />
    </div>
  );
}
