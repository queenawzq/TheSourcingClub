/**
 * Translate a message between English and Chinese.
 *
 * The second serverless function here, and it exists for the same reason as
 * the first: the key must never reach a client bundle.
 *
 * The rule this follows is the one that matters for a marketplace where one
 * side writes English and the other writes Chinese: **it never blocks a
 * message being sent**. Any failure — no key, bad model, timeout, nonsense
 * back — returns a null translation, the message is stored exactly as typed,
 * and the reader sees the original. Someone with something urgent to say is
 * not made to wait on a model, and a conversation never loses a sentence
 * because a translation could not be produced.
 *
 * The original is always stored alongside. A translation is a convenience, not
 * a record: when it is wrong — and on quantities, tolerances and dates it will
 * sometimes be wrong — the person needs to be able to see what was actually
 * written, and to point at it.
 */

import { softTranslation, translateText } from "./_translate.js";

// Under Vercel's Hobby ceiling (10s). See the note in generate-brief.js:
// exceeding it turns a designed soft failure into a platform 504.
const TIMEOUT_MS = 9000;

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json(softTranslation("method not allowed"));
    return;
  }

  const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body ?? {};
  response.status(200).json(await translateText(body.text, { timeoutMs: TIMEOUT_MS }));
}
