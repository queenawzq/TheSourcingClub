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
import React, { useCallback, useEffect, useRef, useState } from "react";
import { MessagesScreen } from "../../prototype/main.jsx";
import "./messages.css";
import { supabase } from "../../lib/supabase.js";
import { ATTACHMENT_ACCEPT, attachmentRefusal, urlFor } from "../../lib/domain/documents.js";
import { awaitingScreen, fileOnlyBody, LANGUAGE_NAME, listMessages, listThreads, markRead, openOrderThread, readable, RESCREEN_AFTER_MS, rescreenStale, sendMessage, sentAt, threadProjectNames } from "../../lib/domain/message.js";

const TIME = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

const initialsOf = (name) =>
  (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("") || "??";

/**
 * Why a held message was held, as its sender is told it: the kind the screen
 * recorded (messages.held_for), never the screen's own words, which are for
 * staff. A message held for proposing a call elsewhere used to be told it
 * "shares contact details".
 */
const HELD_FOR = {
  contact_details: "It looks like it shares contact details. ",
  outside_platform: "It looks like it suggests continuing outside the platform. ",
};

/** After this long still being checked, a message says so even before the screen has been asked again. */
const SAY_CHECKING_AFTER_MS = 15 * 1000;

/**
 * What the sender is told about a message that has not reached the other side.
 * Nothing in the first seconds of being checked: that is how long a check
 * takes, and saying so on every message would make every message look
 * suspect. Once the screen has answered without a verdict, or it has been a
 * while, it says so: a message that looks sent and never arrives is the worst
 * of both.
 */
function deliveryStatus(message, { unscreened = false } = {}) {
  if (message.failed) {
    return {
      kind: "rejected",
      label: "Not sent",
      note: `${message.failed} ${message.typed ? "Copy it and send it again." : "Attach the files and send them again."}`,
    };
  }
  if (message.delivery === "held") {
    return {
      kind: "held",
      label: "Held for review: not delivered yet",
      note: `${HELD_FOR[message.held_for] ?? ""}Our team will check it before it is sent.`,
    };
  }
  if (message.delivery === "checking" && !String(message.id).startsWith("outgoing-")
      && (unscreened || Date.now() - Date.parse(message.created_at) > SAY_CHECKING_AFTER_MS)) {
    return {
      kind: "checking",
      label: "Checking before it is sent",
      note: "It has not reached them yet. This page keeps trying; if it is still here in a few minutes, our team will deliver it.",
    };
  }
  if (message.delivery === "rejected") {
    return { kind: "rejected", label: "Not delivered", note: message.review_note || null };
  }
  return null;
}

/**
 * Open a message's file in a new tab. The tab opens on the click itself (a
 * tab opened after an await is a pop-up browsers block), then goes to the
 * signed link.
 */
async function openAttachment(doc, onError) {
  const tab = window.open("", "_blank");
  try {
    const url = await urlFor(doc, 300);
    if (tab) tab.location.href = url;
    else window.location.assign(url);
  } catch (failure) {
    tab?.close();
    onError(failure);
  }
}

/** "Today" for anything from today, a date otherwise. */
function dayLabel(value) {
  if (!value) return "";
  const when = new Date(value);
  const today = new Date();
  return when.toDateString() === today.toDateString() ? "Today" : DAY.format(when);
}

export default function LiveMessages({ org, isFactory, user, threadId, orderId }) {
  const [threads, setThreads] = useState(null);
  const [projectNames, setProjectNames] = useState(new Map());
  const [messagesByThread, setMessagesByThread] = useState({});
  // Messages on their way: drawn the moment Send is pressed, before the
  // database has answered. { [threadId]: [{ tempId, body, files, at, failed }] }
  const [outgoing, setOutgoing] = useState({});
  // Files of a message still uploading, by message id, so a read of the
  // thread that lands before they are linked does not drop them from view.
  const [uploading, setUploading] = useState({});
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const activeThreadRef = useRef(threadId ?? null);

  // An order's conversation is reached by the order, not by its thread id.
  // open_order_thread is idempotent — one thread per order — so this both
  // finds an existing conversation and starts the first one.
  const [resolvedThreadId, setResolvedThreadId] = useState(threadId);

  useEffect(() => {
    if (threadId || !orderId) return undefined;
    let cancelled = false;
    openOrderThread(orderId)
      .then((thread) => {
        if (cancelled) return;
        // The function returns the thread's row, not its id. Stored whole, it
        // reached listMessages as "[object Object]" and the screen fell back
        // to the newest conversation: another order's.
        setResolvedThreadId(thread?.id ?? null);
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
      setProjectNames(await threadProjectNames(rows ?? []));
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
    activeThreadRef.current = threadId;
    try {
      const rows = await listMessages(threadId);
      setMessagesByThread((current) => ({ ...current, [threadId]: rows ?? [] }));
      setError(null);
      await markRead(threadId);
      reload();
    } catch (failure) {
      setError(failure);
    }
  }, [reload]);

  /**
   * Your own messages the screen has not decided: ask it again, on a back-off,
   * for as long as the page is open. Only asking once, on the send, left a
   * message whose screen failed in `checking` for good while its sender
   * looked at it as sent. `unscreened` is the ones the screen was asked about
   * and did not decide, which then say so.
   */
  const [unscreened, setUnscreened] = useState(() => new Set());
  const attempts = useRef({});
  const [screenRound, setScreenRound] = useState(0);
  useEffect(() => {
    const waiting = Object.values(messagesByThread)
      .flatMap((rows) => awaitingScreen(rows, user.id))
      .filter((message) => (attempts.current[message.id] ?? 0) < RESCREEN_AFTER_MS.length);
    if (!waiting.length) return undefined;
    const dueAt = (message) => Date.parse(message.created_at) + RESCREEN_AFTER_MS[attempts.current[message.id] ?? 0];
    const timer = setTimeout(async () => {
      const due = waiting.filter((message) => dueAt(message) <= Date.now());
      for (const message of due) attempts.current[message.id] = (attempts.current[message.id] ?? 0) + 1;
      setUnscreened((current) => new Set([...current, ...due.map((message) => message.id)]));
      if (await rescreenStale(due, user.id, { olderThanMs: 0 })) {
        for (const threadId of new Set(due.map((message) => message.thread_id))) {
          const rows = await listMessages(threadId).catch(() => null);
          if (rows) setMessagesByThread((current) => ({ ...current, [threadId]: rows }));
        }
        reloadRef.current();
      }
      setScreenRound((round) => round + 1);
    }, Math.max(0, Math.min(...waiting.map(dueAt)) - Date.now()));
    return () => clearTimeout(timer);
  }, [messagesByThread, screenRound, user.id]);

  // Open the conversation that was asked for — an order's own thread, say —
  // or the newest one, the way the design does. Once: a conversation that
  // appears later (someone writes) must not pull the reader away from the one
  // they are reading.
  const opened = useRef(null);
  useEffect(() => {
    if (!threads?.length) return;
    const target = resolvedThreadId ?? threads[0].id;
    if (opened.current === target) return;
    opened.current = target;
    loadThread(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads?.length, resolvedThreadId]);

  /**
   * Live: a message delivered to this company (or one of its own changing
   * state: delivered, held, released) arrives without a refresh. Realtime
   * applies the read policy per subscriber, so the other side hears of a
   * message only once it is delivered, never while it is checked or held.
   * The event only says which conversation moved; the rows are read again
   * through the normal query, with their sender and files.
   */
  const loadThreadRef = useRef(loadThread);
  loadThreadRef.current = loadThread;
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    let listTimer = null;
    const channel = supabase
      .channel(`messages:${org.id}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (payload) => {
        const moved = payload.new?.thread_id ?? payload.old?.thread_id;
        if (moved && moved === activeThreadRef.current) loadThreadRef.current(moved);
        else {
          clearTimeout(listTimer);
          listTimer = setTimeout(() => reloadRef.current(), 300);
        }
      })
      .subscribe();
    return () => {
      clearTimeout(listTimer);
      supabase.removeChannel(channel);
    };
  }, [org.id]);

  /**
   * Send. Nothing here waits before drawing: the message is in the timeline
   * the moment the button is pressed, the box is already empty, and the
   * button is free for the next one. The saved row replaces the drawn one,
   * and the screen's verdict arrives through the live channel.
   */
  function send(threadId, body, files = []) {
    const draft = { tempId: `outgoing-${Date.now()}-${Math.random()}`, body: body || fileOnlyBody(files), typed: body, files, at: new Date().toISOString() };
    const dropDraft = () => setOutgoing((current) => ({
      ...current,
      [threadId]: (current[threadId] ?? []).filter((item) => item.tempId !== draft.tempId),
    }));
    setOutgoing((current) => ({ ...current, [threadId]: [...(current[threadId] ?? []), draft] }));
    setNotice(null);

    sendMessage({
      threadId,
      orgId: org.id,
      userId: user.id,
      body,
      files,
      onSaved: (row) => {
        if (files.length) setUploading((current) => ({ ...current, [row.id]: files.map((file) => file.name) }));
        setMessagesByThread((current) => ({
          ...current,
          [threadId]: [...(current[threadId] ?? []).filter((message) => message.id !== row.id), { ...row, documents: [] }],
        }));
        dropDraft();
      },
    })
      .then(({ message, failed, delivery }) => {
        if (delivery === "checking") setUnscreened((current) => new Set([...current, message.id]));
        setUploading((current) => {
          const next = { ...current };
          delete next[message.id];
          return next;
        });
        if (failed.length) setNotice(`Sent, but without the files: ${failed.join(" ")}`);
        return loadThread(threadId);
      })
      .catch((failure) => {
        // Never saved: the bubble says so, and the words are not lost.
        setOutgoing((current) => ({
          ...current,
          [threadId]: (current[threadId] ?? []).map((item) => (item.tempId === draft.tempId ? { ...item, failed: failure.message } : item)),
        }));
      });
  }

  // Still loading, or an order's conversation still being opened (the empty
  // state there would claim there is nothing to talk about on a thread one
  // round trip away). A failure says so: the error line further down is
  // never reached from here, and the page stayed blank.
  if (!threads || (orderId && !resolvedThreadId)) {
    return error ? (
      <div className="messages-empty" data-testid="threads-error">
        <h1>Your conversations could not be loaded</h1>
        <p role="alert">{error.message}</p>
      </div>
    ) : (
      <div className="messages-empty" role="status">
        <p>Loading your conversations…</p>
      </div>
    );
  }

  // A conversation exists once either side presses Message, not before:
  // quoting or starting an order does not open one.
  if (!threads.length) {
    return (
      <div className="messages-empty" data-testid="threads-empty">
        <h1>No conversations yet</h1>
        <p>
          {isFactory
            ? "Press Message on a request you have quoted, or on an order, to write to the brand. When a brand writes to you, the conversation shows here."
            : "Press Message on a quote or an order to write to the factory. When a factory writes to you, the conversation shows here."}
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
    const outgoingRows = (outgoing[thread.id] ?? []).map((item) => ({
      id: item.tempId,
      sender_org_id: org.id,
      body: item.body,
      created_at: item.at,
      delivery: "checking",
      failed: item.failed,
      typed: item.typed,
      documents: item.files.map((file) => ({ file_name: file.name })),
    }));
    const rows = [...(messagesByThread[thread.id] ?? []), ...outgoingRows];

    return {
      id: thread.id,
      name: counterparty ?? "—",
      initials: initialsOf(counterparty),
      // The project's name, so two conversations with one company differ.
      project: projectNames.get(thread.id) ?? thread.subject_title ?? "",
      kind: thread.subject_kind === "order" ? "Production order" : "Request for quote",
      lastDate: dayLabel(thread.last_message_at),
      // The other side's last words in the reader's language, as in the
      // conversation itself; the reader's own as typed.
      lastPreview: (thread.last_sender_org_id !== org.id && thread.last_body_translated_lang === "en"
        ? thread.last_body_translated
        : thread.last_body) ?? "No messages yet.",
      unread: Number(thread.unread_count) || 0,
      files: [],
      messages: rows.map((message) => {
        const mine = message.sender_org_id === org.id;
        // The reader's own words as they typed them, the translation one
        // click away. The other side's: the reader's language first.
        const view = mine
          ? { text: message.body, isTranslation: Boolean(message.body_translated), original: message.body_translated, originalLang: message.body_translated_lang }
          : readable(message);
        const linked = (message.documents ?? []).filter((doc) => doc.file_name);
        const files = linked.length
          ? linked.map((doc) => ({ name: doc.file_name, uploading: !doc.storage_path, onOpen: doc.storage_path ? () => openAttachment(doc, setError) : undefined }))
          : (uploading[message.id] ?? []).map((name) => ({ name, uploading: true }));
        return {
          id: message.id,
          from: mine ? (isFactory ? "factory" : "brand") : (isFactory ? "brand" : "factory"),
          // The bubble's side and label: the reader's own messages on the
          // right with their own name, whichever side the reader is on.
          own: mine,
          time: sentAt(message) ? TIME.format(new Date(sentAt(message))) : "",
          // Only the sender's company ever reads a message that is not
          // delivered (the read policy), so this is always the reader's own.
          status: deliveryStatus(message, { unscreened: unscreened.has(message.id) }),
          // The reader's own language first, with the original one click
          // away — the rule in CLAUDE.md. The designed bubble shows `body`
          // by default and `translation` when toggled, so the readable text
          // is the body and the toggle reveals what was actually typed.
          // Whenever there is text in the other language, it is one click
          // away, whichever way it goes: a factory reading a brand's English
          // has the Chinese translation behind the toggle, as a brand reading
          // a factory's Chinese has the original.
          ...(view.original
            ? {
              body: view.text,
              translation: view.original,
              language: view.originalLang,
              ...(!mine && view.isTranslation
                ? {
                  showAltLabel: `Show original${LANGUAGE_NAME[view.originalLang] ? ` (${LANGUAGE_NAME[view.originalLang]})` : ""}`,
                  hideAltLabel: "Show translation",
                }
                : {
                  showAltLabel: `Show translation${LANGUAGE_NAME[view.originalLang] ? ` (${LANGUAGE_NAME[view.originalLang]})` : ""}`,
                  hideAltLabel: mine ? "Show what you wrote" : "Show original",
                }),
            }
            : { body: view.text }),
          attachments: files.length ? files : undefined,
        };
      }),
    };
  });

  return (
    <>
      <MessagesScreen
        threads={shaped}
        initialThreadId={resolvedThreadId}
        onSelectThread={loadThread}
        onSend={send}
        canAttach
        attachAccept={ATTACHMENT_ACCEPT}
        acceptFiles={(picked) => {
          const refused = picked.map(attachmentRefusal).filter(Boolean);
          setNotice(refused.length ? refused.join(" ") : null);
          return picked.filter((file) => !attachmentRefusal(file));
        }}
        composerNotice={error ? { text: error.message, alert: true } : notice ? { text: notice } : null}
        ownName={org.name}
      />
    </>
  );
}
