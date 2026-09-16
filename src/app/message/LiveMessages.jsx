/**
 * Conversations, on Queena's designed screen.
 *
 * `MessagesScreen` is imported from src/prototype/main.jsx and mounted here
 * with live threads behind it. This file is the seam.
 *
 * Three things the design draws that have nothing behind them — call
 * scheduling, presence, and "usually replies in 2h" — are absent in the live
 * mount rather than rendered with invented values. The prototype keeps them.
 * Offering a brand a video call that cannot happen is worse than not offering
 * one.
 */
import React, { useCallback, useEffect, useState } from "react";
import { MessagesScreen } from "../../prototype/main.jsx";
import { listMessages, listThreads, markRead, openOrderThread, readable, sendMessage } from "../../lib/domain/message.js";

const TIME = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

const initialsOf = (name) =>
  (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("") || "??";

/** "Today" for anything from today, a date otherwise. */
function dayLabel(value) {
  if (!value) return "";
  const when = new Date(value);
  const today = new Date();
  return when.toDateString() === today.toDateString() ? "Today" : DAY.format(when);
}

export default function LiveMessages({ org, isFactory, user, threadId, orderId }) {
  const [threads, setThreads] = useState(null);
  const [messagesByThread, setMessagesByThread] = useState({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  // An order's conversation is reached by the order, not by its thread id.
  // open_order_thread is idempotent — one thread per order — so this both
  // finds an existing conversation and starts the first one.
  const [resolvedThreadId, setResolvedThreadId] = useState(threadId);

  useEffect(() => {
    if (threadId || !orderId) return undefined;
    let cancelled = false;
    openOrderThread(orderId)
      .then((id) => {
        if (cancelled) return;
        setResolvedThreadId(id);
        // The thread may have just been created, so the list has to be read
        // again or the screen shows "no conversations yet" over a live one.
        reload();
      })
      .catch((failure) => !cancelled && setError(failure));
    return () => { cancelled = true; };
  }, [orderId, threadId]);


  const reload = useCallback(async () => {
    try {
      const rows = await listThreads(org.id);
      setThreads(rows ?? []);
      return rows ?? [];
    } catch (failure) {
      setError(failure);
      return [];
    }
  }, [org.id]);

  useEffect(() => { reload(); }, [reload]);

  /**
   * Load one conversation, and mark it read.
   *
   * Unread is derived per user from message_reads, so opening a thread is the
   * only thing that clears it — there is no counter to decrement.
   */
  const loadThread = useCallback(async (threadId) => {
    if (!threadId) return;
    try {
      const rows = await listMessages(threadId);
      setMessagesByThread((current) => ({ ...current, [threadId]: rows ?? [] }));
      await markRead(threadId);
      reload();
    } catch (failure) {
      setError(failure);
    }
  }, [reload]);

  // Open the conversation that was asked for — an order's own thread, say —
  // or the newest one, the way the design does.
  useEffect(() => {
    if (threads?.length) loadThread(resolvedThreadId ?? threads[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads?.length, resolvedThreadId]);

  async function send(threadId, body) {
    setSending(true);
    try {
      await sendMessage({ threadId, orgId: org.id, userId: user.id, body });
      await loadThread(threadId);
    } catch (failure) {
      setError(failure);
    } finally {
      setSending(false);
    }
  }

  if (!threads) return null;

  // An order's conversation is still being opened; showing the empty state
  // here would claim there is nothing to talk about on a thread that is one
  // round trip away.
  if (orderId && !resolvedThreadId) return null;

  if (!threads.length) {
    return (
      <div className="messages-empty" data-testid="threads-empty">
        <h1>No conversations yet</h1>
        <p>
          A conversation opens against a request or an order, so there is one as soon
          as someone quotes or an order starts.
        </p>
      </div>
    );
  }

  /**
   * A live thread as the designed screen expects one.
   *
   * `localTime`, `status` and `responseLabel` are deliberately absent: the
   * design renders them only when present, so they simply do not appear.
   */
  const shaped = threads.map((thread) => {
    const counterparty = isFactory ? thread.brand_name : thread.factory_name;
    const rows = messagesByThread[thread.id] ?? [];

    return {
      id: thread.id,
      name: counterparty ?? "—",
      initials: initialsOf(counterparty),
      project: thread.subject_title ?? "",
      kind: thread.subject_kind === "order" ? "Production order" : "Request for quote",
      lastDate: dayLabel(thread.last_message_at),
      lastPreview: thread.last_body ?? "No messages yet.",
      unread: Number(thread.unread_count) || 0,
      files: [],
      messages: rows.map((message) => {
        const view = readable(message);
        const mine = message.sender_org_id === org.id;
        return {
          from: mine ? (isFactory ? "factory" : "brand") : (isFactory ? "brand" : "factory"),
          time: message.created_at ? TIME.format(new Date(message.created_at)) : "",
          // The design shows the original behind a toggle when a translation
          // exists, and the plain body when it does not.
          ...(view.isTranslation
            ? { translation: view.text, original: view.original, language: view.originalLang }
            : { body: view.text }),
          attachments: (message.documents ?? []).map((doc) => doc.file_name).filter(Boolean),
        };
      }),
    };
  });

  return (
    <>
      {error && <p className="messages-load-error" role="alert">{error.message}</p>}
      <MessagesScreen
        threads={shaped}
        initialThreadId={resolvedThreadId}
        onSelectThread={loadThread}
        onSend={send}
        sending={sending}
      />
    </>
  );
}
