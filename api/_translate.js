/**
 * Detect the source language and translate non-English messages into English, for the screen
 * (api/screen-message.js), which translates while it checks so a message
 * costs one round trip, not two in a row. There is no /api/translate any
 * more: nothing called it once the screen translated, and it answered anyone,
 * signed in or not, with our model key.
 *
 * Never throws. Any failure — no key, bad model, timeout, nonsense back —
 * returns a null translation with the reason, and the message goes as typed.
 *
 * Haiku by default, NOT OPENROUTER_MODEL: this sits on every send, and Opus
 * made a message take seconds to reach the other side (John, 2026-10-18).
 */

const MODEL = process.env.OPENROUTER_TRANSLATE_MODEL || "anthropic/claude-haiku-5.5";
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["source_language", "target_language", "translation"],
  properties: {
    source_language: { type: "string", pattern: "^[a-z]{2,3}$" },
    target_language: { type: "string", enum: ["en"] },
    translation: { type: "string" },
  },
};

export function softTranslation(reason) {
  return { source_language: null, target_language: null, translation: null, error: reason };
}

export async function translateText(input, { timeoutMs = 8000 } = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return softTranslation("no model key configured on the server");

  const text = String(input ?? "").trim();
  if (!text) return softTranslation("nothing to translate");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const upstream = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://the-sourcing-club.vercel.app",
        "X-Title": "The Sourcing Club",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        messages: [
          {
            role: "user",
            content:
`Translate this message between a clothing brand and a garment factory. Detect its source language using its ISO 639 language code. Translate any non-English message into English. For an English message, return source_language "en", target_language "en", and the unchanged message. Do not translate English into another language.

Rules:
- Translate what was written. Do not soften, expand, summarise or add pleasantries.
- Keep every number, measurement, size code, colour name and date exactly as written.
- Industry terms keep their trade meaning: lab dip, strike-off, PP sample, fit sample, tech pack, MOQ, GSM, incoterm, EXW, FOB.
- If the message is already partly in the target language, translate only the parts that are not.

Message:
"""
${text.slice(0, 4000)}
"""`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "submit_translation",
              description: "Return the translated message.",
              parameters: SCHEMA,
            },
          },
        ],
        // Forced tool call, for the reason recorded in generate-brief.js: a
        // JSON-schema request came back once as prose in a markdown fence.
        tool_choice: { type: "function", function: { name: "submit_translation" } },
      }),
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error("translate upstream", upstream.status, detail.slice(0, 300));
      return softTranslation(`the model service returned ${upstream.status}`);
    }

    const payload = await upstream.json();
    const raw = payload?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!raw) return softTranslation("the model returned nothing usable");

    const fields = typeof raw === "string" ? JSON.parse(raw) : raw;

    if (!/^[a-z]{2,3}$/.test(fields.source_language ?? "") || fields.target_language !== "en") {
      return softTranslation("the model returned an invalid language");
    }
    const translated = typeof fields.translation === "string" ? fields.translation.trim() : "";
    if (fields.source_language !== "en" && (!translated || translated === text)) {
      return softTranslation("nothing to translate into");
    }

    return {
      source_language: fields.source_language,
      target_language: fields.target_language,
      translation: fields.source_language === "en" ? null : translated,
      model: payload.model ?? MODEL,
      error: null,
    };
  } catch (error) {
    const reason = error.name === "AbortError" ? "the model took too long" : error.message;
    console.error("translate failed", reason);
    return softTranslation(reason);
  } finally {
    clearTimeout(timeout);
  }
}
