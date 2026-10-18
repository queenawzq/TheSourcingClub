/**
 * Translate a message between English and Chinese. Shared by /api/translate
 * and the screen (api/screen-message.js), which translates while it checks so
 * a message costs one round trip, not two in a row.
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
    source_language: { type: "string", enum: ["en", "zh"] },
    target_language: { type: "string", enum: ["en", "zh"] },
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
`Translate this message between a clothing brand and a garment factory. If it is in English, translate to Simplified Chinese. If it is in Chinese, translate to English.

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

    // A "translation" identical to the input, or into the language it came
    // from, is not a translation. Better to show the original alone than to
    // present the same sentence twice as though something had happened.
    if (
      !fields.translation ||
      !fields.source_language ||
      fields.source_language === fields.target_language ||
      fields.translation.trim() === text
    ) {
      return softTranslation("nothing to translate into");
    }

    return {
      source_language: fields.source_language,
      target_language: fields.target_language,
      translation: fields.translation,
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
