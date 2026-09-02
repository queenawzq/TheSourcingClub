/**
 * Verification review.
 *
 * Deliberately plain. Nothing in either prototype designs this screen, but
 * without it no factory can ever become verified, and an unverified factory
 * cannot quote — so the entire marketplace is untestable until it exists.
 * Functional now; Queena can design it when there is something to design for.
 *
 * Every decision goes through review_document(), which is gated on
 * is_platform_admin() in the database. This page cannot grant itself access.
 */
import React, { useCallback, useEffect, useState } from "react";
import { pendingReviews, recentlyReviewed, reviewDocument } from "../../lib/domain/admin.js";
import { urlFor } from "../../lib/domain/documents.js";
import "./admin.css";

const KIND_LABEL = {
  business_registration: "Business registration",
  certificate: "Certificate",
};

function Row({ doc, onDecide, busy }) {
  const [note, setNote] = useState("");
  const [linkError, setLinkError] = useState(null);

  async function open() {
    try {
      // Private documents get a short-lived signed URL, minted per view and
      // never stored. A registration must not end up in browser history as a
      // permanent link.
      const url = await urlFor(doc, 120);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setLinkError(error);
    }
  }

  return (
    <tr>
      <td>
        <strong>{doc.orgs?.name ?? "Unknown org"}</strong>
        <span className="admin-sub">{doc.orgs?.type}</span>
      </td>
      <td>{KIND_LABEL[doc.kind] ?? doc.kind}</td>
      <td>
        <button type="button" className="admin-link" onClick={open}>
          {doc.file_name}
        </button>
        <span className="admin-sub">{Math.round((doc.size_bytes ?? 0) / 1024)} KB</span>
        {linkError ? <span className="admin-error">{linkError.message}</span> : null}
      </td>
      <td>{new Date(doc.created_at).toLocaleDateString()}</td>
      <td>
        <input
          type="text"
          placeholder="Note, shown if rejected"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </td>
      <td className="admin-actions">
        <button
          type="button"
          className="admin-approve"
          disabled={busy}
          onClick={() => onDecide(doc, "verified", note || null)}
        >
          Approve
        </button>
        <button
          type="button"
          className="admin-reject"
          disabled={busy || !note.trim()}
          title={note.trim() ? undefined : "A rejection needs a reason"}
          onClick={() => onDecide(doc, "rejected", note)}
        >
          Reject
        </button>
      </td>
    </tr>
  );
}

export default function AdminVerifications() {
  const [queue, setQueue] = useState(null);
  const [history, setHistory] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [pending, recent] = await Promise.all([pendingReviews(), recentlyReviewed()]);
      setQueue(pending);
      setHistory(recent);
      setError(null);
    } catch (loadError) {
      setError(loadError);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(doc, decision, note) {
    setBusyId(doc.id);
    setError(null);
    try {
      await reviewDocument(doc.id, decision, note);
      await load();
    } catch (decideError) {
      setError(decideError);
    } finally {
      setBusyId(null);
    }
  }

  if (error && !queue) {
    return (
      <div className="admin">
        <h1>Verification review</h1>
        <p className="admin-error">{error.message}</p>
      </div>
    );
  }

  if (!queue) {
    return (
      <div className="admin">
        <h1>Verification review</h1>
        <p className="admin-sub">Loading…</p>
      </div>
    );
  }

  return (
    <div className="admin">
      <h1>Verification review</h1>
      <p className="admin-intro">
        Approving a business registration verifies that organisation. For a factory that is
        what unlocks quoting — an unverified factory can be found and read, but cannot bid.
      </p>

      {error ? <p className="admin-error">{error.message}</p> : null}

      <h2>Waiting ({queue.length})</h2>
      {queue.length === 0 ? (
        <p className="admin-sub">Nothing to review.</p>
      ) : (
        <div className="admin-scroll">
          <table>
            <thead>
              <tr>
                <th>Organisation</th>
                <th>Document</th>
                <th>File</th>
                <th>Uploaded</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {queue.map((doc) => (
                <Row key={doc.id} doc={doc} onDecide={decide} busy={busyId === doc.id} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Recent decisions</h2>
      {history.length === 0 ? (
        <p className="admin-sub">None yet.</p>
      ) : (
        <div className="admin-scroll">
          <table>
            <thead>
              <tr>
                <th>Organisation</th>
                <th>Document</th>
                <th>Decision</th>
                <th>When</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {history.map((doc) => (
                <tr key={doc.id}>
                  <td>{doc.orgs?.name}</td>
                  <td>{doc.file_name}</td>
                  <td>
                    <span className={`admin-pill admin-pill--${doc.status}`}>{doc.status}</span>
                  </td>
                  <td>{doc.reviewed_at ? new Date(doc.reviewed_at).toLocaleString() : "—"}</td>
                  <td>{doc.review_note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
