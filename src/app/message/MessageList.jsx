/**
 * Every conversation, both sides.
 *
 * The unread count is computed per person from their own last-read time, so it
 * cannot get stuck — and a message you sent yourself is never unread, which is
 * obvious and is exactly the sort of obvious thing a stored counter gets wrong.
 */
import React, { useEffect, useState } from "react";
import { listThreads } from "../../lib/domain/message.js";
import { useRouter } from "../../lib/router.jsx";
import "./message.css";

export default function MessageList({ org, isFactory }) {
  const { navigate } = useRouter();
  const [threads, setThreads] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    listThreads(org.id)
      .then((rows) => !cancelled && setThreads(rows))
      .catch((failure) => !cancelled && setError(failure));
    return () => { cancelled = true; };
  }, [org.id]);

  if (error) {
    return (
      <div className="rfq-page">
        <h1>Conversations</h1>
        <p className="ob-error">{error.message}</p>
      </div>
    );
  }
  if (!threads) return <div className="rfq-page"><div className="spinner" aria-hidden="true" /></div>;

  return (
    <div className="rfq-page">
      <header className="rfq-page-head">
        <div>
          <h1>Conversations</h1>
          <p>
            Every conversation is attached to the request or order it is about, so it is still
            there when someone asks what was agreed.
          </p>
        </div>
      </header>

      {threads.length === 0 ? (
        <div className="rfq-empty">
          <p>No conversations yet.</p>
          <p style={{ marginTop: 8, fontSize: 13 }}>
            {isFactory
              ? "Open one from a request you are quoting, or from an order you are working on."
              : "Open one from a quote you are comparing, or from a production order."}
          </p>
        </div>
      ) : (
        <div className="rfq-list">
          {threads.map((thread) => (
            <button
              key={thread.id}
              type="button"
              className="rfq-card thread-card"
              data-testid="thread-card"
              onClick={() => navigate(`/messages/${thread.id}`)}
            >
              <div>
                <h2>{isFactory ? thread.brand_name : thread.factory_name}</h2>
                <p className="rfq-card-meta">
                  {thread.subject_kind === "order" ? "Order" : "Request"} · {thread.subject_title}
                </p>
                {thread.last_body ? (
                  <p className="rfq-card-meta thread-preview">
                    {thread.last_sender_org_id === org.id ? "You: " : ""}
                    {thread.last_body.slice(0, 120)}
                  </p>
                ) : null}
              </div>
              <span className="thread-meta">
                {thread.unread_count > 0 ? (
                  <b className="thread-unread" data-testid="unread-count">{thread.unread_count}</b>
                ) : null}
                <small>
                  {thread.last_message_at
                    ? new Date(thread.last_message_at).toLocaleDateString()
                    : "no messages"}
                </small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
