/**
 * The payment queue.
 *
 * This screen is not administrative convenience — it is a required step in the
 * workflow. notifications.org_id is `not null references orgs` and platform
 * staff have no org, so an admin cannot be notified of anything. Without
 * somebody watching this list, every payment stalls at "sent" and no factory
 * is ever told it can start.
 *
 * Modelled on AdminVerifications, including living outside the org shell and
 * carrying its own way out. Every button here calls a function that checks
 * is_platform_admin() in the database before it reads a row, so this page
 * cannot grant itself anything.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../lib/auth.jsx";
import {
  confirmPaymentReceived, paymentQueue, rejectPaymentSent, releasePayment,
} from "../../lib/domain/payment.js";
import { formatMoney } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";
import "./admin.css";

function Row({ row, onDecide, busy }) {
  const [note, setNote] = useState("");
  const awaiting = row.state === "sent";

  return (
    <tr>
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
        <span className="admin-sub">fee {formatMoney(row.fee_cents, row.currency)}</span>
      </td>
      <td>
        {row.brand_reference || <span className="admin-sub">no reference given</span>}
        <span className="admin-sub">{row.payout_summary}</span>
      </td>
      <td>
        {awaiting
          ? row.sent_at ? new Date(row.sent_at).toLocaleString() : "—"
          : row.confirmed_at ? new Date(row.confirmed_at).toLocaleString() : "—"}
      </td>
      <td>
        <input type="text" placeholder={awaiting ? "Note, required to reject" : "Optional note"}
               value={note} onChange={(event) => setNote(event.target.value)} />
      </td>
      <td className="admin-actions">
        {awaiting ? (
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
        ) : (
          <button type="button" className="admin-approve" disabled={busy}
                  data-testid="release-payment"
                  onClick={() => onDecide(row, "release", note)}>
            Release to factory
          </button>
        )}
      </td>
    </tr>
  );
}

function Table({ rows, onDecide, busyId, caption }) {
  return (
    <div className="admin-scroll">
      <table>
        <caption className="admin-sub">{caption}</caption>
        <thead>
          <tr>
            <th>Order</th>
            <th>Between</th>
            <th>Amount</th>
            <th>Reference</th>
            <th>When</th>
            <th>Note</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Row key={row.payment_id} row={row} onDecide={onDecide} busy={busyId === row.payment_id} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminPayments() {
  const { user, signOut } = useAuth();
  const { navigate } = useRouter();
  const [rows, setRows] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setRows(await paymentQueue());
      setError(null);
    } catch (failure) {
      setError(failure);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function decide(row, decision, note) {
    setBusyId(row.payment_id);
    setError(null);
    try {
      if (decision === "confirm") await confirmPaymentReceived(row.payment_id, { note });
      else if (decision === "reject") await rejectPaymentSent(row.payment_id, note);
      else await releasePayment(row.payment_id, note);
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
    return <div className="admin">{header}<h1>Payments</h1><p className="admin-sub">Loading…</p></div>;
  }

  const awaiting = rows.filter((row) => row.state === "sent");
  const confirmed = rows.filter((row) => row.state === "confirmed");

  return (
    <div className="admin">
      {header}

      <h1>Payments</h1>
      <p className="admin-intro">
        Money moves between the two parties by bank transfer; we never hold it. Confirming a
        payment here is what tells a factory it can start work — until then it has only the
        brand's word, which is the thing it has no reason to rely on.
      </p>

      {error ? <p className="admin-error">{error.message}</p> : null}

      <h2>Awaiting confirmation ({awaiting.length})</h2>
      {awaiting.length === 0 ? (
        <p className="admin-sub">Nothing is waiting on us.</p>
      ) : (
        <Table rows={awaiting} onDecide={decide} busyId={busyId}
               caption="A brand says it has wired these. Check the account, then confirm." />
      )}

      <h2>Confirmed, not yet released ({confirmed.length})</h2>
      {confirmed.length === 0 ? (
        <p className="admin-sub">Nothing to release.</p>
      ) : (
        <Table rows={confirmed} onDecide={decide} busyId={busyId}
               caption="The work has already opened on these. Releasing is the payout." />
      )}
    </div>
  );
}
