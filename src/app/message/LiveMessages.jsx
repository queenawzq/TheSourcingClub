/**
 * Conversations, on Queena's designed screen.
 *
 * `MessagesScreen` is imported from src/prototype/main.jsx and mounted here
 * with live threads behind it. This file is the seam.
 *
 * Calls are live: "Schedule call" opens the designed dialog, and the
 * conversation's calls are the designed cards in the "Scheduled call" panel
 * (see live-calls.js). Two things the design draws still have nothing behind
 * them, presence and "usually replies in 2h", and an instant "Live video
 * chat" needs presence, so all three stay absent here; the prototype keeps
 * them.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { MessagesScreen } from "../../prototype/main.jsx";
import "./messages.css";
import { supabase } from "../../lib/supabase.js";
import { urlFor } from "../../lib/domain/documents.js";
import { fileOnlyBody, LANGUAGE_NAME, listMessages, listThreads, markRead, openOrderThread, readable, rescreenStale, sendMessage, sentAt, threadProjectNames } from "../../lib/domain/message.js";
import { acceptCall, browserTimeZone, cancelCall, counterCall, counterpartyTimeZone, declineCall, joinCall, listCalls, loadZoomEmbedded, proposeCall, zoneOptions } from "../../lib/domain/calls.js";
import { callsForPanel, panelCard } from "./live-calls.js";

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
 * What the sender is told about a message that has not reached the other side.
 * Nothing while it is being checked: that takes seconds, and saying so on
 * every message would make every message look suspect.
 */
function deliveryStatus(message) {
  if (message.failed) {
    return { kind: "rejected", label: "Not sent", note: `It could not be saved (${message.failed}). Copy it and send it again.` };
  }
  if (message.delivery === "held") {
    return {
      kind: "held",
      label: "Held for review: not delivered yet",
      note: "It looks like it shares contact details. Our team will check it before it is sent.",
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
async function openAttachment(doc) {
  const tab = window.open("", "_blank");
  try {
    const url = await urlFor(doc, 300);
    if (tab) tab.location.href = url;
    else window.location.assign(url);
  } catch (failure) {
    tab?.close();
    window.alert(failure.message);
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

  // Calls: every call in the company's conversations, the other side's time
  // zone per conversation, the dialog (open to propose, or to answer one call
  // with another time), and which call is being changed.
  const ownZone = browserTimeZone() ?? "UTC";
  const [calls, setCalls] = useState([]);
  const [theirZones, setTheirZones] = useState({});
  const [activeId, setActiveId] = useState(threadId ?? null);
  const [dialog, setDialog] = useState(null);
  const [callBusy, setCallBusy] = useState(null);
  const [callNotes, setCallNotes] = useState({});
  // The call being joined: { call, join, text } while the designed video
  // panel is open; Zoom draws into zoomRoot.
  const [video, setVideo] = useState(null);
  const zoomRoot = useRef(null);
  const zoomClient = useRef(null);

  const reloadCalls = useCallback(async () => {
    try {
      setCalls(await listCalls(org.id));
    } catch (failure) {
      setError(failure);
    }
  }, [org.id]);

  useEffect(() => { reloadCalls(); }, [reloadCalls]);

  // The clock the cards read: "Join call" opens and "Starting soon" turns
  // into "On now" while the page stays open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!activeId || activeId in theirZones) return;
    counterpartyTimeZone(activeId).then((zone) => setTheirZones((current) => ({ ...current, [activeId]: zone })));
  }, [activeId, theirZones]);

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
    setActiveId(threadId);
    setDialog((current) => (current?.threadId === threadId ? current : null));
    activeThreadRef.current = threadId;
    try {
      let rows = await listMessages(threadId);
      setMessagesByThread((current) => ({ ...current, [threadId]: rows ?? [] }));
      setError(null);
      await markRead(threadId);
      reload();
      // Your own messages still being checked from an earlier visit: ask the
      // screen again, and show what it decided.
      if (await rescreenStale(rows, user.id)) {
        rows = await listMessages(threadId);
        setMessagesByThread((current) => ({ ...current, [threadId]: rows ?? [] }));
        reload();
      }
    } catch (failure) {
      setError(failure);
    }
  }, [reload, user.id]);

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
  const reloadCallsRef = useRef(reloadCalls);
  reloadCallsRef.current = reloadCalls;
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
      // A call proposed, answered or cancelled by the other side shows up
      // in the panel at once (20261014000300).
      .on("postgres_changes", { event: "*", schema: "public", table: "calls" }, () => reloadCallsRef.current())
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
      .then(({ message, failed }) => {
        setUploading((current) => {
          const next = { ...current };
          delete next[message.id];
          return next;
        });
        if (failed.length) setNotice(`Sent, but these did not attach: ${failed.join("; ")}`);
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

  async function changeCall(call, change) {
    setCallBusy(call.id);
    setCallNotes((current) => ({ ...current, [call.id]: null }));
    try {
      await change();
      await reloadCalls();
    } catch (failure) {
      setCallNotes((current) => ({ ...current, [call.id]: { text: failure.message, error: true } }));
    } finally {
      setCallBusy(null);
    }
  }

  const callHandlers = {
    accept: (call) => changeCall(call, () => acceptCall(call.id, ownZone)),
    decline: (call) => changeCall(call, () => declineCall(call.id)),
    cancel: (call) => changeCall(call, () => cancelCall(call.id)),
    counter: (call) => setDialog({ threadId: call.thread_id, counterOf: call, key: call.id, busy: false, error: null }),
    join: async (call) => {
      setCallBusy(call.id);
      setCallNotes((current) => ({ ...current, [call.id]: null }));
      const answer = await joinCall(call.id);
      setCallBusy(null);
      if (!answer.ok) {
        setCallNotes((current) => ({ ...current, [call.id]: { text: answer.message, error: true } }));
        return;
      }
      setVideo({ call, join: answer.join, text: "Connecting to the call…" });
    },
  };

  // Once the panel is drawn, Zoom joins inside it. Leaving (or switching
  // conversation, or leaving the page) ends the meeting for this person only.
  useEffect(() => {
    // Once per join: a failure updates `video` too, which must not retry.
    if (!video?.join || video.attempted || !zoomRoot.current) return undefined;
    // Zoom's meeting view is never narrower than about 360px: on a phone it
    // would be cut off, so the call opens in Zoom's app straight away.
    if (zoomRoot.current.clientWidth < 360) {
      setVideo((current) => current && {
        ...current,
        attempted: true,
        failed: true,
        text: "On a screen this narrow, the call opens in the Zoom app.",
      });
      return undefined;
    }
    setVideo((current) => current && { ...current, attempted: true });
    document.body.classList.remove("tsc-zoom-failed");
    (async () => {
      try {
        const ZoomMtgEmbedded = await loadZoomEmbedded();
        const client = ZoomMtgEmbedded.createClient();
        zoomClient.current = client;
        // Zoom draws its view at a fixed size: the panel's width, 16:9, in
        // speaker view (its default, "ribbon", is a small floating window).
        const width = Math.floor(zoomRoot.current.clientWidth);
        await client.init({
          zoomAppRoot: zoomRoot.current,
          language: "en-US",
          patchJsMedia: true,
          leaveOnPageUnload: true,
          customize: {
            video: { defaultViewType: "speaker", isResizable: false, viewSizes: { default: { width, height: Math.round((width * 9) / 16) } } },
          },
        });
        await client.join({
          sdkKey: video.join.sdkKey,
          signature: video.join.signature,
          meetingNumber: video.join.meetingNumber,
          password: video.join.passcode,
          userName: video.join.userName,
        });
        setVideo((current) => current && { ...current, joined: true, text: "You're in the call. The other side joins from this conversation." });
      } catch (failure) {
        // Zoom's own error box would sit over the page with a Retry that
        // fails the same way: take Zoom's view away and offer its app.
        console.warn("zoom join", failure?.errorCode, failure?.reason ?? failure?.message);
        try {
          window.ZoomMtgEmbedded?.destroyClient();
        } catch {
          // Nothing to tidy.
        }
        // Zoom puts its error dialog on <body>, outside its own view, keeps
        // drawing it after the client is gone, and its Retry fails the same
        // way. Hidden until this panel closes (messages.css).
        document.body.classList.add("tsc-zoom-failed");
        zoomClient.current = null;
        setVideo((current) => current && {
          ...current,
          failed: true,
          text: "The video can't open inside this page right now. Join the same call in the Zoom app.",
        });
      }
    })();
    return undefined;
  }, [video]);

  // Opening another conversation leaves the call: its panel is this one's.
  useEffect(() => {
    if (video && video.call.thread_id !== activeId) leaveVideo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Leaving the page (another screen of the app) leaves the call too:
  // otherwise Zoom stays joined, with sound, behind a panel that is gone.
  useEffect(() => () => {
    const client = zoomClient.current;
    zoomClient.current = null;
    Promise.resolve()
      .then(() => client?.leaveMeeting())
      .catch(() => null)
      .finally(() => {
        try {
          window.ZoomMtgEmbedded?.destroyClient();
        } catch {
          // Nothing to tidy.
        }
      });
    document.body.classList.remove("tsc-zoom-failed");
  }, []);

  async function leaveVideo() {
    try {
      await zoomClient.current?.leaveMeeting();
    } catch {
      // Already out.
    }
    try {
      window.ZoomMtgEmbedded?.destroyClient();
    } catch {
      // Nothing to tidy.
    }
    zoomClient.current = null;
    document.body.classList.remove("tsc-zoom-failed");
    setVideo(null);
  }

  async function submitSchedule({ startsAt, timeZone, title, agenda }) {
    setDialog((current) => ({ ...current, busy: true, error: null }));
    try {
      if (dialog.counterOf) {
        await counterCall({ callId: dialog.counterOf.id, startsAt, title, agenda, timeZone });
      } else {
        await proposeCall({ threadId: dialog.threadId, startsAt, title, agenda, timeZone });
      }
      setDialog(null);
      await reloadCalls();
    } catch (failure) {
      setDialog((current) => current && { ...current, busy: false, error: failure.message });
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
    const outgoingRows = (outgoing[thread.id] ?? []).map((item) => ({
      id: item.tempId,
      sender_org_id: org.id,
      body: item.body,
      created_at: item.at,
      delivery: "checking",
      failed: item.failed,
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
      lastPreview: thread.last_body ?? "No messages yet.",
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
          ? linked.map((doc) => ({ name: doc.file_name, uploading: !doc.storage_path, onOpen: doc.storage_path ? () => openAttachment(doc) : undefined }))
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
          status: deliveryStatus(message),
          // The reader's own language first, with the original one click
          // away — the rule in CLAUDE.md. The designed bubble shows `body`
          // by default and `translation` when toggled, so the readable text
          // is the body and the toggle reveals what was actually typed.
          ...(view.isTranslation
            ? {
              body: view.text,
              translation: view.original,
              language: view.originalLang,
              ...(mine
                ? {
                  showAltLabel: `Show translation${LANGUAGE_NAME[view.originalLang] ? ` (${LANGUAGE_NAME[view.originalLang]})` : ""}`,
                  hideAltLabel: "Show what you wrote",
                }
                : {
                  showAltLabel: `Show original${LANGUAGE_NAME[view.originalLang] ? ` (${LANGUAGE_NAME[view.originalLang]})` : ""}`,
                  hideAltLabel: "Show translation",
                }),
            }
            : { body: view.text }),
          attachments: files.length ? files : undefined,
        };
      }),
    };
  });

  // Each conversation's calls as the designed cards.
  const callCards = {};
  for (const thread of threads) {
    const theirs = calls.filter((call) => call.thread_id === thread.id);
    callCards[thread.id] = callsForPanel(theirs, org.id, now).map((call) => panelCard(call, {
      now,
      orgId: org.id,
      ownZone,
      otherZone: theirZones[thread.id] ?? null,
      handlers: callHandlers,
      busyId: callBusy,
      notes: callNotes,
    }));
  }
  const dialogThread = dialog ? threads.find((thread) => thread.id === dialog.threadId) : null;
  const dialogOther = dialogThread ? (isFactory ? dialogThread.brand_name : dialogThread.factory_name) ?? "" : "";

  return (
    <>
      {error && <p className="messages-load-error" role="alert">{error.message}</p>}
      {notice && <p className="messages-load-error" role="status">{notice}</p>}
      <MessagesScreen
        calls={callCards}
        video={video ? {
          title: video.call.title,
          text: video.text,
          mountRef: zoomRoot,
          failed: Boolean(video.failed),
          joinUrl: video.join.joinUrl,
          onLeave: leaveVideo,
        } : null}
        scheduling={{
          open: Boolean(dialog),
          key: dialog?.key ?? "new",
          onOpen: () => activeId && setDialog({ threadId: activeId, key: `new-${Date.now()}`, busy: false, error: null }),
          onClose: () => setDialog(null),
          ownZone,
          zones: zoneOptions(ownZone),
          otherName: dialogOther,
          otherZone: dialog ? theirZones[dialog.threadId] ?? null : null,
          heading: dialog?.counterOf ? "Propose another time" : undefined,
          submitLabel: dialog?.counterOf ? "Send new time" : undefined,
          initial: dialog?.counterOf ? { title: dialog.counterOf.title, agenda: dialog.counterOf.agenda ?? "" } : undefined,
          busy: dialog?.busy ?? false,
          error: dialog?.error ?? null,
          onSubmit: submitSchedule,
        }}
        threads={shaped}
        initialThreadId={resolvedThreadId}
        onSelectThread={loadThread}
        onSend={send}
        canAttach
        ownName={org.name}
      />
    </>
  );
}
