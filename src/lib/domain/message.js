/**
 * Messages.
 *
 * A conversation belongs to the thing it is about — a request or an order —
 * so who may read it is already answered by can_see_rfq() and the order's own
 * party test. The prototypes link a thread to its subject with a title string
 * and no id, which is why clicking any factory's "Message" button there lands
 * on whichever conversation happens to be first in the list.
 *
 * Translation happens on send and is stored beside the original. It must never
 * be able to stop a message going out: if the model is slow, misconfigured or
 * wrong, the message is sent exactly as typed and the reader sees that.
 */
import { kickNotificationEmails, supabase, unwrap } from "../supabase.js";
import { uploadDocument } from "./documents.js";

const THREAD_COLUMNS = `
  id, rfq_id, order_id, brand_org_id, factory_org_id, last_message_at, created_at,
  brand_name, factory_name, subject_title, subject_kind,
  last_body, last_sender_org_id, unread_count, message_count
`;

export async function listThreads(orgId) {
  return unwrap(
    await supabase
      .from("message_thread_summary")
      .select(THREAD_COLUMNS)
      .or(`brand_org_id.eq.${orgId},factory_org_id.eq.${orgId}`)
      .order("last_message_at", { ascending: false, nullsFirst: false }),
    "load your conversations",
  );
}

/**
 * What each conversation is about, by name. The summary view names an order's
 * conversation by its order number alone ("TSC-000090"); here it gets the
 * project name in front ("Linen overshirt, SS27 · TSC-000090"), read in one
 * query for all order threads. The number stays so the order's conversation
 * and its request's conversation still tell apart. Returns a Map of thread id
 * → project line.
 */
export async function threadProjectNames(threads) {
  const names = new Map();
  const orderIds = [...new Set((threads ?? []).map((thread) => thread.order_id).filter(Boolean))];
  if (orderIds.length) {
    const orders = unwrap(
      await supabase.from("production_orders").select("id, rfqs (title)").in("id", orderIds),
      "load your conversations",
    );
    const titleByOrder = new Map((orders ?? []).map((order) => [order.id, order.rfqs?.title]));
    for (const thread of threads) {
      const title = thread.order_id && titleByOrder.get(thread.order_id);
      if (title) names.set(thread.id, [title, thread.subject_title].filter(Boolean).join(" · "));
    }
  }
  for (const thread of threads ?? []) {
    if (!names.has(thread.id)) names.set(thread.id, thread.subject_title ?? "");
  }
  return names;
}

export async function getThread(threadId) {
  return unwrap(
    await supabase
      .from("message_thread_summary")
      .select(THREAD_COLUMNS)
      .eq("id", threadId)
      .maybeSingle(),
    "load the conversation",
  );
}

export async function openOrderThread(orderId) {
  return unwrap(
    await supabase.rpc("open_order_thread", { target_order: orderId }),
    "open the conversation",
  );
}

export async function openRfqThread(rfqId, factoryOrgId) {
  return unwrap(
    await supabase.rpc("open_rfq_thread", { target_rfq: rfqId, factory_org: factoryOrgId }),
    "open the conversation",
  );
}

export async function listMessages(threadId) {
  const rows = unwrap(
    await supabase
      .from("messages")
      .select(`
        id, thread_id, sender_org_id, sender_user_id, body, body_lang,
        body_translated, body_translated_lang, translated_by, created_at,
        delivery, delivered_at, review_note,
        orgs:sender_org_id (name),
        documents (id, bucket, storage_path, file_name, mime_type, size_bytes)
      `)
      .eq("thread_id", threadId)
      .order("created_at"),
    "load the messages",
  );
  // A released message arrives when staff release it, not when it was typed,
  // so the thread reads in delivery order. The sender's own held or rejected
  // messages were never delivered and keep the time they were written.
  return [...(rows ?? [])].sort((a, b) => Date.parse(sentAt(a)) - Date.parse(sentAt(b)));
}

/** The words of a message that is only files. */
export function fileOnlyBody(files) {
  const names = (files ?? []).map((file) => file.name).filter(Boolean);
  if (!names.length) return "";
  return names.length === 1 ? `Sent a file: ${names[0]}` : `Sent ${names.length} files: ${names.join(", ")}`;
}

/** When a message reached the thread: its delivery, or its writing if it has not. */
export const sentAt = (message) => message.delivered_at ?? message.created_at;

export async function markRead(threadId) {
  return unwrap(
    await supabase.rpc("mark_thread_read", { target_thread: threadId }),
    "mark this conversation read",
  );
}

/**
 * Send.
 *
 * Order matters. The message row is written first, because an attachment needs
 * a message to belong to; if an upload then fails, the message stands with a
 * note about what did not arrive rather than vanishing along with it. Somebody
 * who has typed a paragraph should not lose it because a photo was too large.
 *
 * The row is saved as `checking` (the database insists), and only the screen
 * delivers it, after the files are linked so their names are checked too. The
 * screen also translates, at the same time as it checks: nothing waits on a
 * model before the row exists. `onSaved` runs as soon as it does.
 *
 * A file can go on its own: the database needs words, so the message says
 * which file was sent.
 */
export async function sendMessage({ threadId, orgId, userId, body, files = [], onSaved }) {
  const typed = (body ?? "").trim();
  const text = typed || fileOnlyBody(files);
  if (!text) throw new Error("there is nothing to send");

  const message = unwrap(
    await supabase
      .from("messages")
      .insert({
        thread_id: threadId,
        sender_org_id: orgId,
        sender_user_id: userId,
        body: text,
      })
      .select()
      .single(),
    "send your message",
  );
  onSaved?.(message);

  const failed = [];
  for (const file of files) {
    try {
      const doc = await uploadDocument({
        orgId,
        kind: "message_attachment",
        file,
        // The thread is the third path segment, which is what makes the
        // counterparty's storage policy expressible at all.
        scopeId: threadId,
      });
      unwrap(
        await supabase.from("documents").update({ message_id: message.id }).eq("id", doc.id).select().single(),
        "attach the file",
      );
    } catch (error) {
      failed.push(`${file.name}: ${error.message}`);
    }
  }

  const screened = await screenMessage(message.id);
  return { message, failed, delivery: screened?.delivery ?? message.delivery };
}

/**
 * Ask the server to screen one of your own messages (api/screen-message.js).
 * Never throws: a screen that does not answer leaves the message `checking`,
 * where the next visit asks again and staff see it after two minutes.
 */
export async function screenMessage(messageId) {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) return null;
    const response = await fetch("/api/screen-message", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messageId }),
    });
    // Delivering the message is what notifies the other side.
    kickNotificationEmails();
    return await response.json();
  } catch {
    return null;
  }
}

/** How long a message may sit in `checking` before its sender's page asks again. */
const STALE_CHECK_MS = 30 * 1000;

/**
 * Re-screen the caller's own messages that have been `checking` for a while:
 * the page closed before the screen answered, or the message was sent from a
 * tab that predates screening. Returns whether any of them moved.
 */
export async function rescreenStale(messages, userId, now = Date.now()) {
  const stale = (messages ?? []).filter((message) =>
    message.delivery === "checking"
    && message.sender_user_id === userId
    && now - Date.parse(message.created_at) > STALE_CHECK_MS);
  let moved = false;
  for (const message of stale) {
    const result = await screenMessage(message.id);
    if (result?.delivery && result.delivery !== "checking") moved = true;
  }
  return moved;
}

/**
 * Which text to show, and what the "show the original" control should say.
 *
 * The reader sees their own language when we have it. The prototype does the
 * opposite — it shows the foreign original by default with a "Translate to
 * English" button, which means the first thing a reader sees is a sentence
 * they cannot read, and it offers to translate *to English* even on the
 * factory's own side.
 */
export function readable(message, { preferred = "en" } = {}) {
  const hasTranslation = Boolean(message.body_translated);

  if (hasTranslation && message.body_translated_lang === preferred) {
    return {
      text: message.body_translated,
      isTranslation: true,
      original: message.body,
      originalLang: message.body_lang,
    };
  }

  return {
    text: message.body,
    isTranslation: false,
    original: hasTranslation ? message.body_translated : null,
    originalLang: message.body_translated_lang,
  };
}

export const LANGUAGE_NAME = { en: "English", zh: "中文" };

/**
 * Staff: the messages waiting on a person. Held ones, and any still being
 * checked after two minutes (the screen never answered). Platform staff have
 * no org and cannot be notified, so this list is the only prompt there is.
 */
export async function heldMessageQueue() {
  return unwrap(await supabase.rpc("admin_message_queue"), "load the messages held for review");
}

/** Staff: deliver a held message. The recipient is notified as if it had just been sent. */
export async function releaseHeldMessage(messageId, note = null) {
  return unwrap(
    await supabase.rpc("release_held_message", { target_message: messageId, note: note?.trim() || null }),
    "release the message",
  );
}

/** Staff: refuse a held message. The reason is required: the sender is shown it. */
export async function rejectHeldMessage(messageId, note) {
  return unwrap(
    await supabase.rpc("reject_held_message", { target_message: messageId, note }),
    "reject the message",
  );
}
