/**
 * A conversation as its own page, with the context it belongs to and a way
 * back into that work. Reached from /messages, from a notification, or from a
 * pasted link — one URL that opens for either party.
 */
import React, { useEffect, useState } from "react";
import { getThread } from "../../lib/domain/message.js";
import { useRouter } from "../../lib/router.jsx";
import Thread from "./Thread.jsx";
import "./message.css";

export default function ThreadPage({ org, threadId, isFactory }) {
  const { navigate } = useRouter();
  const [thread, setThread] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getThread(threadId)
      .then((row) => {
        if (cancelled) return;
        if (!row) throw new Error("this conversation is not available to you");
        setThread(row);
      })
      .catch((failure) => !cancelled && setError(failure));
    return () => { cancelled = true; };
  }, [threadId]);

  if (error) {
    return (
      <div className="rfq-page">
        <button type="button" className="quiet-btn" onClick={() => navigate("/messages")}>← Back</button>
        <h1>Not available</h1>
        <p className="ob-error">{error.message}</p>
      </div>
    );
  }
  if (!thread) return <div className="rfq-page"><div className="spinner" aria-hidden="true" /></div>;

  const subjectPath = thread.order_id
    ? `/orders/${thread.order_id}`
    : isFactory ? `/browse/${thread.rfq_id}` : `/rfqs/${thread.rfq_id}`;

  return (
    <div className="rfq-page rfq-detail">
      <button type="button" className="quiet-btn" onClick={() => navigate("/messages")}>
        ← Back to conversations
      </button>

      <header className="rfq-page-head">
        <div>
          <h1>{isFactory ? thread.brand_name : thread.factory_name}</h1>
          <p>
            About {thread.subject_kind === "order" ? "order" : "request"}{" "}
            <button type="button" className="admin-link" onClick={() => navigate(subjectPath)}>
              {thread.subject_title}
            </button>
          </p>
        </div>
      </header>

      <section className="detail-card">
        <Thread org={org} threadId={threadId} />
      </section>
    </div>
  );
}
