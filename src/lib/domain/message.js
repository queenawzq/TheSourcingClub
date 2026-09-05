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
import { supabase, unwrap } from "../supabase.js";
import { uploadDocument } from "./documents.js";

const THREAD_COLUMNS = `
  id, rfq_id, order_id, brand_org_id, factory_org_id, last_message_at, created_at,
  brand_name, factory_name, subject_title, subject_kind,
  last_body, last_sender_org_id, unread_count
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
  return unwrap(
    await supabase
      .from("messages")
      .select(`
        id, thread_id, sender_org_id, sender_user_id, body, body_lang,
        body_translated, body_translated_lang, translated_by, created_at,
        orgs:sender_org_id (name),
        documents (id, bucket, storage_path, file_name, mime_type, size_bytes)
      `)
      .eq("thread_id", threadId)
      .order("created_at"),
    "load the messages",
  );
}

export async function markRead(threadId) {
  return unwrap(
    await supabase.rpc("mark_thread_read", { target_thread: threadId }),
    "mark this conversation read",
  );
}

/**
 * Ask the server to translate. Never throws, and a failure is indistinguishable
 * from "there was nothing to translate" — both mean the message goes as typed.
 */
async function translate(text) {
  try {
    const response = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const result = await response.json();
    if (!result?.translation) return null;
    return result;
  } catch {
    return null;
  }
}

/**
 * Send.
 *
 * Order matters. The message row is written first, because an attachment needs
 * a message to belong to; if an upload then fails, the message stands with a
 * note about what did not arrive rather than vanishing along with it. Somebody
 * who has typed a paragraph should not lose it because a photo was too large.
 */
export async function sendMessage({ threadId, orgId, userId, body, files = [] }) {
  const text = body.trim();
  if (!text) throw new Error("there is nothing to send");

  const translation = await translate(text);

  const message = unwrap(
    await supabase
      .from("messages")
      .insert({
        thread_id: threadId,
        sender_org_id: orgId,
        sender_user_id: userId,
        body: text,
        body_lang: translation?.source_language ?? null,
        body_translated: translation?.translation ?? null,
        body_translated_lang: translation?.target_language ?? null,
        translated_by: translation?.model ?? null,
      })
      .select()
      .single(),
    "send your message",
  );

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

  return { message, failed };
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
