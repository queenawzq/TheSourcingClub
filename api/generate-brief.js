/**
 * Turn a brand's free-text description into structured RFQ fields.
 *
 * The first serverless function in this project. It exists here rather than in
 * the browser for one reason: the API key must never reach a client bundle.
 *
 * Routed through OpenRouter to Claude, at the product owner's request. The key
 * is OPENROUTER_API_KEY, server-side only, and is never exposed to the page —
 * whether the button appears at all is decided by a separate client-safe flag,
 * VITE_AI_BRIEF_ENABLED, which must be set alongside it.
 *
 * Two rules this deliberately follows:
 *
 *   1. It prefills a form; it never submits one. Everything it returns is
 *      editable before the brand publishes, so a wrong guess costs a
 *      correction rather than a bad request going out to factories.
 *
 *   2. It fails soft. Any error — no key, bad model, malformed JSON, timeout —
 *      returns 200 with a null result, so the client's "skip" path and the
 *      failure path are the same UI state. A brand who clicked a button that
 *      quietly did nothing can still type.
 */

const MODEL = process.env.OPENROUTER_MODEL ?? "anthropic/claude-opus-5";
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 45000;

/**
 * The model returns taxonomy SLUGS, not free text, so its guesses map onto
 * real term rows the client can preselect. A category it invents is useless —
 * there is nothing to link it to.
 */
function buildPrompt({ freeText, categories, certifications, regions, sourcing }) {
  return `A clothing brand described what they want manufactured. Turn it into the structured fields of a request for quotes.

Their description:
"""
${freeText}
"""

Rules:
- Only state what the description supports. Leave a field null rather than inventing it — a brand can fill a blank, but may not notice a wrong number.
- Quantities and prices are numbers, not text. Price is per unit in whole dollars.
- Category, certification and region must be chosen from the slugs listed below, or omitted. Never invent a slug.
- title is a short human name for the request, as a person would write it.
- brief is a cleaned-up version of their description: same substance, better organised, no invented detail.

product_category slugs: ${categories.join(", ")}
certification slugs: ${certifications.join(", ")}
region slugs: ${regions.join(", ")}
sourcing_responsibility slugs: ${sourcing.join(", ")}`;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "brief"],
  properties: {
    title: { type: "string", description: "Short name for the request" },
    brief: { type: "string", description: "Tidied version of the description" },
    quantity_total: { type: ["integer", "null"] },
    material_notes: { type: ["string", "null"] },
    sample_notes: { type: ["string", "null"] },
    requires_sample: { type: ["boolean", "null"] },
    target_unit_price_min: { type: ["number", "null"] },
    target_unit_price_max: { type: ["number", "null"] },
    product_category_slugs: { type: "array", items: { type: "string" } },
    certification_slugs: { type: "array", items: { type: "string" } },
    region_slugs: { type: "array", items: { type: "string" } },
    sourcing_responsibility_slug: { type: ["string", "null"] },
    colour_splits: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["colour", "quantity"],
        properties: {
          colour: { type: "string" },
          quantity: { type: "integer" },
        },
      },
    },
    questions: {
      type: "array",
      items: { type: "string" },
      description: "Questions worth asking every factory, drawn from what is unclear",
    },
  },
};

/** Pull a JSON object out of prose or a ```json fence, if there is one. */
function extractJson(content) {
  if (!content || typeof content !== "string") return null;
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : content;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

/** Never throw. A failure here is a form the brand fills in by hand. */
function soft(reason) {
  return { fields: null, error: reason };
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json(soft("method not allowed"));
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    // The client should not have shown the button at all, so this is a
    // misconfiguration worth naming rather than a user error.
    response.status(200).json(soft("no model key configured on the server"));
    return;
  }

  const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body ?? {};
  const freeText = String(body.freeText ?? "").trim();

  if (freeText.length < 20) {
    response.status(200).json(soft("too little to work from"));
    return;
  }

  const prompt = buildPrompt({
    freeText: freeText.slice(0, 8000),
    categories: body.categories ?? [],
    certifications: body.certifications ?? [],
    regions: body.regions ?? [],
    sourcing: body.sourcing ?? [],
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  // One retry on a transient upstream failure. Observed in practice: a 402
  // that succeeded on the next identical request seconds later. A single blip
  // should not cost the brand the draft it just asked for.
  const RETRYABLE = new Set([402, 408, 429, 500, 502, 503, 504]);

  async function call() {
    return fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://the-sourcing-club.vercel.app",
        "X-Title": "The Sourcing Club",
      },
      // Forced tool call rather than response_format. Claude honours a
      // required tool reliably; asking for a JSON schema came back once as
      // prose wrapped round a markdown fence, using field names of its own
      // invention. A tool call is the model's own structured channel.
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 2000,
        tools: [
          {
            type: "function",
            function: {
              name: "submit_brief",
              description: "Return the structured request fields.",
              parameters: SCHEMA,
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "submit_brief" } },
      }),
    });
  }

  try {
    let upstream = await call();

    if (!upstream.ok && RETRYABLE.has(upstream.status)) {
      console.warn(`generate-brief retrying after ${upstream.status}`);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      upstream = await call();
    }

    if (!upstream.ok) {
      const detail = await upstream.text();
      console.error("generate-brief upstream", upstream.status, detail.slice(0, 400));
      response.status(200).json(soft(`the model service returned ${upstream.status}`));
      return;
    }

    const payload = await upstream.json();
    const message = payload?.choices?.[0]?.message;
    const toolArguments = message?.tool_calls?.[0]?.function?.arguments;

    // Prefer the tool call. Fall back to the text body, tolerating a markdown
    // fence, so a provider that quietly ignores tool_choice still works.
    const raw = toolArguments ?? extractJson(message?.content);
    if (!raw) {
      console.error("generate-brief no usable output", JSON.stringify(message).slice(0, 400));
      response.status(200).json(soft("the model returned nothing usable"));
      return;
    }

    let fields;
    try {
      fields = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      console.error("generate-brief unparseable", String(raw).slice(0, 400));
      response.status(200).json(soft("the model returned something unreadable"));
      return;
    }

    response.status(200).json({ fields, error: null, model: payload.model ?? MODEL });
  } catch (error) {
    const reason = error.name === "AbortError" ? "the model took too long" : error.message;
    console.error("generate-brief failed", reason);
    response.status(200).json(soft(reason));
  } finally {
    clearTimeout(timeout);
  }
}
