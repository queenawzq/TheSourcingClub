/**
 * One conversation.
 *
 * Used both as a page and as the Messages tab inside a production order, which
 * is the tab TSC_DESIGN_SYSTEM.md asks for and neither prototype has.
 *
 * Every message shows who sent it, from `orgs.name` — the prototypes hardcode
 * the label, so in the brand app every counterparty is called "Factory" and in
 * the factory app every own message is signed "Atelier Minho" no matter which
 * conversation it is in.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../lib/auth.jsx";
import { urlFor } from "../../lib/domain/documents.js";
import {
  LANGUAGE_NAME, listMessages, markRead, readable, sendMessage,
} from "../../lib/domain/message.js";
import "./message.css";

function Attachment({ document }) {
  const [error, setError] = useState(null);

  async function open() {
    try {
      window.open(await urlFor(document, 300), "_blank", "noopener,noreferrer");
    } catch (failure) {
      setError(failure);
    }
  }

  return (
    <span className="msg-attachment">
      <button type="button" onClick={open} data-testid="message-attachment">
        {document.file_name}
      </button>
      <small>{Math.round((document.size_bytes ?? 0) / 1024)} KB</small>
      {error ? <small className="ob-error">{error.message}</small> : null}
    </span>
  );
}

function Bubble({ message, mine, preferred }) {
  const [showOriginal, setShowOriginal] = useState(false);
  const view = readable(message, { preferred });

  return (
    <li className={`msg${mine ? " is-mine" : ""}`} data-testid="message">
      <header>
        <strong>{message.orgs?.name ?? "Unknown"}</strong>
        <span>{new Date(message.created_at).toLocaleString()}</span>
      </header>

      <p className="msg-body">{showOriginal ? view.original : view.text}</p>

      {view.original ? (
        <button type="button" className="msg-translate" onClick={() => setShowOriginal((v) => !v)}>
          {showOriginal
            ? `Show ${LANGUAGE_NAME[preferred] ?? preferred}`
            : view.isTranslation
              ? `Show what they wrote${view.originalLang ? ` (${LANGUAGE_NAME[view.originalLang]})` : ""}`
              : `Show ${LANGUAGE_NAME[view.originalLang] ?? "translation"}`}
        </button>
      ) : null}

      {view.isTranslation && !showOriginal ? (
        <span className="msg-machine">Translated automatically</span>
      ) : null}

      {message.documents?.length ? (
        <div className="msg-attachments">
          {message.documents.map((doc) => <Attachment key={doc.id} document={doc} />)}
        </div>
      ) : null}
    </li>
  );
}

export default function Thread({ org, threadId, preferred = "en", compact = false }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState(null);
  const [error, setError] = useState(null);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState(null);
  const endRef = useRef(null);

  const load = useCallback(async () => {
    const rows = await listMessages(threadId);
    setMessages(rows);
    // Reading it is what marks it read. The prototype's unread badge is never
    // decremented anywhere, so it sits there forever once it appears.
    await markRead(threadId).catch(() => {});
  }, [threadId]);

  useEffect(() => { load().catch(setError); }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages?.length]);

  async function send() {
    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      const { failed } = await sendMessage({
        threadId, orgId: org.id, userId: user.id, body, files,
      });
      setBody("");
      setFiles([]);
      if (failed.length) setWarning(`Sent, but these did not attach — ${failed.join("; ")}`);
      await load();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  if (error && !messages) return <p className="ob-error">{error.message}</p>;
  if (!messages) return <div className="spinner" aria-hidden="true" />;

  return (
    <div className={`thread${compact ? " is-compact" : ""}`}>
      {messages.length === 0 ? (
        <p className="ob-hint">
          Nothing yet. Anything you write here is kept with this piece of work, so it is still
          here when someone asks what was agreed.
        </p>
      ) : (
        <ul className="msg-list">
          {messages.map((message) => (
            <Bubble
              key={message.id}
              message={message}
              mine={message.sender_org_id === org.id}
              preferred={preferred}
            />
          ))}
        </ul>
      )}
      <div ref={endRef} />

      {error ? <p className="ob-error">{error.message}</p> : null}
      {warning ? <p className="ob-hint msg-warning">{warning}</p> : null}

      <div className="msg-composer">
        <textarea
          data-field="message_body"
          rows={compact ? 2 : 3}
          value={body}
          placeholder="Write in whichever language you prefer — we translate it for them."
          onChange={(event) => setBody(event.target.value)}
        />
        <div className="msg-composer-row">
          <input
            data-field="message_files"
            type="file"
            multiple
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
          />
          <button type="button" className="primary-btn" data-testid="send-message"
                  disabled={busy || !body.trim()} onClick={send}>
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
        {files.length ? <span className="ob-hint">{files.length} file(s) attached</span> : null}
      </div>
    </div>
  );
}
