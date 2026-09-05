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

const MODEL = process.env.OPENROUTER_MODEL ?? "anthropic/claude-opus-5";
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 20000;

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

function soft(reason) {
  return { source_language: null, target_language: null, translation: null, error: reason };
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json(soft("method not allowed"));
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    response.status(200).json(soft("no model key configured on the server"));
    return;
  }

  const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body ?? {};
  const text = String(body.text ?? "").trim();

  if (!text) {
    response.status(200).json(soft("nothing to translate"));
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

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
      response.status(200).json(soft(`the model service returned ${upstream.status}`));
      return;
    }

    const payload = await upstream.json();
    const raw = payload?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!raw) {
      response.status(200).json(soft("the model returned nothing usable"));
      return;
    }

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
      response.status(200).json(soft("nothing to translate into"));
      return;
    }

    response.status(200).json({
      source_language: fields.source_language,
      target_language: fields.target_language,
      translation: fields.translation,
      model: payload.model ?? MODEL,
      error: null,
    });
  } catch (error) {
    const reason = error.name === "AbortError" ? "the model took too long" : error.message;
    console.error("translate failed", reason);
    response.status(200).json(soft(reason));
  } finally {
    clearTimeout(timeout);
  }
}
