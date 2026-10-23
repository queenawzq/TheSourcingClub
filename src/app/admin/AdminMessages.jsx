/**
 * Messages held for review.
 *
 * A message that looks like it shares contact details (an email, a phone
 * number, a WeChat ID, "let's talk outside") is held instead of delivered:
 * the sender sees it marked "Held for review", the other side sees nothing.
 * Someone has to decide each one, and platform staff have no org and cannot
 * be notified, so this list is the only prompt there is.
 *
 * Hand-built like AdminPayments, for the same reason: no design has a
 * moderation queue. Every button calls a function that checks
 * is_platform_admin() in the database first, so this page cannot grant
 * itself anything.
 */
import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../lib/auth.jsx";
import { heldMessageQueue, rejectHeldMessage, releaseHeldMessage } from "../../lib/domain/message.js";
import { useRouter } from "../../lib/router.jsx";
import "./admin.css";

const METHOD = {
  pattern: "Pattern check",
  ai: "AI check",
  pattern_only: "Pattern check only (AI unavailable)",
};

function when(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

function Row({ row, onDecide, busy }) {
  const [note, setNote] = useState("");
  const stuck = row.delivery === "checking";

  return (
    <tr data-testid="held-message">
      <td>
        <strong>{row.subject_title || "—"}</strong>
        <span className="admin-sub">{row.subject_kind === "order" ? "Production order" : "Request for quote"}</span>
      </td>
      <td>
        {row.sender_name}
        <span className="admin-sub">
          {row.sender_side === "brand" ? "brand" : "factory"} → {row.sender_side === "brand" ? row.factory_name : row.brand_name}
        </span>
      </td>
      <td className="admin-message-body">
        <p>{row.body}</p>
        {row.body_translated && <span className="admin-sub">Translation: {row.body_translated}</span>}
        {row.file_names?.length > 0 && <span className="admin-sub">Files: {row.file_names.join(", ")}</span>}
      </td>
      <td>
        {stuck ? "Not checked" : row.reason || "—"}
        <span className="admin-sub">{stuck ? "the check never answered" : METHOD[row.method] ?? row.method ?? ""}</span>
      </td>
      <td>{when(row.sent_at)}</td>
      <td>
        {/* One box for both buttons: a reject shows the sender this note,
            a release keeps it for staff and shows it to nobody else. */}
        <input type="text" placeholder="Required to reject; the sender sees it"
               aria-label="Note: the sender is shown it if you reject; if you release, only staff see it"
               value={note} onChange={(event) => setNote(event.target.value)} />
      </td>
      <td className="admin-actions">
        <button type="button" className="admin-approve" disabled={busy}
                data-testid="release-message"
                onClick={() => onDecide(row, "release", note)}>
          Release
        </button>
        <button type="button" className="admin-reject" disabled={busy || !note.trim()}
                data-testid="reject-message"
                title={note.trim() ? undefined : "Say why; the sender sees this"}
                onClick={() => onDecide(row, "reject", note)}>
          Reject
        </button>
      </td>
    </tr>
  );
}

export default function AdminMessages() {
  const { user, signOut } = useAuth();
  const { navigate } = useRouter();
  const [rows, setRows] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setRows(await heldMessageQueue());
      setError(null);
    } catch (failure) {
      setError(failure);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function decide(row, decision, note) {
    setBusyId(row.message_id);
    setError(null);
    try {
      if (decision === "reject") await rejectHeldMessage(row.message_id, note);
      else await releaseHeldMessage(row.message_id, note);
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
    return (
      <div className="admin">
        {header}
        <h1>Messages held for review</h1>
        {error ? <p className="admin-error">{error.message}</p> : <p className="admin-sub">Loading…</p>}
      </div>
    );
  }

  return (
    <div className="admin">
      {header}

      <h1>Messages held for review</h1>
      <p className="admin-intro">
        These looked like they share contact details, so the other side has not seen them.
        Release one and it arrives as a new message. Reject one and the sender is told it
        was not delivered, with your reason.
      </p>

      {error ? <p className="admin-error">{error.message}</p> : null}

      <h2>Waiting on a decision ({rows.length})</h2>
      {rows.length > 0 && <p className="admin-sub admin-table-hint">Oldest first. Read the message, then release or reject it.</p>}
      {rows.length === 0 ? (
        <p className="admin-sub" data-testid="held-messages-empty">Nothing is waiting on us.</p>
      ) : (
        <div className="admin-scroll">
          <table>
            <thead>
              <tr>
                <th>About</th>
                <th>From</th>
                <th>Message</th>
                <th>Why held</th>
                <th>Sent</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Row key={row.message_id} row={row} onDecide={decide} busy={busyId === row.message_id} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
