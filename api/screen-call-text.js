/**
 * Check the words on a call before they are sent.
 *
 * A call's title and description, and the reason given for declining or
 * cancelling one, reach the other side as they are: on its call card, in the
 * notification and in its email. So they get the same pattern check as a
 * message (api/_message-patterns.js). Words with an email address, a phone
 * number, a WhatsApp id or a link are refused here with a reason the person
 * can act on; words without are recorded as checked for this person
 * (record_call_text_check), and the database refuses call text from a person
 * that was not (migration 20261024000201). So calling propose_call directly
 * with words this never saw does not get round it.
 *
 * Only the patterns, not the model: a refusal here stops the person, with no
 * staff review behind it, so it must be as narrow as the list that holds a
 * message at once. The patterns are pinned, hits and near-misses, by
 * scripts/check-message-patterns.mjs.
 *
 * The browser asks this immediately before each call function
 * (src/lib/domain/calls.js), with exactly the words it is about to send.
 */
import { createClient } from "@supabase/supabase-js";
import { supabaseServerEnv } from "./_supabase-env.js";
import { findContactDetails } from "./_message-patterns.js";

// A title (120), a description (1000), or a reason (500): no more than that.
const MAX_TEXTS = 3;
const MAX_LENGTH = 1000;

function json(response, status, body) {
  response.status(status).json(body);
}

function bodyOf(request) {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) return request.body;
  try {
    return JSON.parse(Buffer.isBuffer(request.body) ? request.body.toString("utf8") : request.body || "{}");
  } catch {
    return {};
  }
}

/**
 * Check `texts` for contact details and, when there are none, record them as
 * checked for `userId`. Resolves { ok: true } or { ok: false, error }.
 * The seed uses it too, so its calls pass the same check.
 */
export async function checkCallText(db, userId, texts) {
  for (const text of texts) {
    const found = findContactDetails(text);
    if (found.hit) {
      return {
        ok: false,
        refused: true,
        error: `this has ${found.reason} in it. Keep contact details out of calls: you join the call from this conversation, so nothing else is needed`,
      };
    }
  }
  const { error } = await db.rpc("record_call_text_check", { target_user: userId, texts });
  if (error) {
    console.error("screen-call-text record", error.message);
    return { ok: false, error: "the call's details could not be checked. Try again in a moment" };
  }
  return { ok: true };
}

export default async function handler(request, response) {
  if (request.method !== "POST") return json(response, 405, { error: "method not allowed" });

  const { supabaseUrl, serviceKey } = supabaseServerEnv();
  // Without the check, the database refuses the call's words: say why.
  if (!supabaseUrl || !serviceKey) return json(response, 503, { error: "calls can't be checked on this site yet" });
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const token = String(request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = token ? await db.auth.getUser(token) : { data: null };
  if (!auth?.user) return json(response, 401, { error: "sign in is required" });

  const { texts } = bodyOf(request);
  const list = Array.isArray(texts) ? texts.filter((text) => typeof text === "string" && text.trim()) : null;
  if (!list || list.length > MAX_TEXTS || list.some((text) => text.length > MAX_LENGTH)) {
    return json(response, 400, { error: "the call's details could not be checked" });
  }
  if (!list.length) return json(response, 200, { ok: true });

  const result = await checkCallText(db, auth.user.id, list);
  if (!result.ok) return json(response, result.refused ? 422 : 500, { error: result.error });
  return json(response, 200, { ok: true });
}
