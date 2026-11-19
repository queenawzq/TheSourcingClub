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
 *
 * Every call spends the model key, so only a member of a brand may ask, with
 * their own token, and each person gets BRIEFS_PER_HOUR. It was open to
 * anyone until Nov 19: a stranger could send it as many calls as they liked,
 * each with a prompt as long as the slug lists they sent. Refusals keep the
 * soft shape ({ fields: null, error }), so the composer still opens the card
 * from the text alone.
 */
import { createClient } from "@supabase/supabase-js";
import { supabaseServerEnv } from "./_supabase-env.js";

const MODEL = process.env.OPENROUTER_MODEL ?? "anthropic/claude-haiku-5.5";
const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
// Under Vercel's Hobby ceiling (10s), deliberately. Above it the platform
// kills the function before this abort fires, so the caller gets a 504 rather
// than the soft null this file is built around — the one failure mode the
// design says must never happen.
const TIMEOUT_MS = 9000;
// Far above a brand writing requests, far below a script. Counted in
// claim_email_probe's fixed window, under a key of its own.
const BRIEFS_PER_HOUR = 20;
// The taxonomy has at most ~20 terms of a kind, plus a brand's own. The lists
// come from the browser, and each one goes into the prompt whole. A custom
// term's slug is its label slugified, with no length cap (addCustomTerm), so
// a slug may be long; the list as a whole is what is capped.
const MAX_SLUGS = 100;
const MAX_LIST_CHARS = 4000;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

/** A slug list from the request, as the prompt may take it: real-looking slugs only, and not too much of them. */
export function slugList(value) {
  if (!Array.isArray(value)) return [];
  const kept = [];
  let chars = 0;
  for (const slug of value) {
    if (typeof slug !== "string" || !SLUG.test(slug)) continue;
    if (kept.length >= MAX_SLUGS || chars + slug.length > MAX_LIST_CHARS) break;
    kept.push(slug);
    chars += slug.length + 2;
  }
  return kept;
}

/** The parsed JSON body, whether the runtime parsed it already or not; {} when it is not JSON. */
function bodyOf(request) {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) return request.body;
  try {
    return JSON.parse(Buffer.isBuffer(request.body) ? request.body.toString("utf8") : request.body || "{}");
  } catch {
    return {};
  }
}

/** The user id a token names, unverified: the database verifies it when it is used. */
function tokenSubject(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof payload?.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

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
- product_type says what is being made as specifically as the description allows: who it is for and the garment, e.g. "Womenswear / woven shirting". It is shown to vendors, so no slugs.
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
    product_type: {
      type: ["string", "null"],
      description: "What is being made, as specific as the description allows, e.g. \"Womenswear / woven shirting\"",
    },
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

/**
 * Who may ask: a member of a brand, read through the database with their own
 * token (see screen-message.js for why not auth.getUser()), who may write a
 * request: the Quote flow permission (has_org_permission), the same rule as
 * the composer itself. Answers { userId, supabaseUrl, serviceKey } when the
 * caller may ask, or { refused: [status, body] }.
 */
async function caller(request) {
  const token = String(request.headers?.authorization ?? "").replace(/^Bearer\s+/i, "");
  const userId = tokenSubject(token);
  if (!userId) return { refused: [401, soft("sign in is required")] };

  const { supabaseUrl, anonKey, serviceKey } = supabaseServerEnv();
  if (!supabaseUrl || !anonKey || !serviceKey) {
    console.error("generate-brief: no database settings, so every brief is refused");
    return { refused: [200, soft("the server is not set up for this")] };
  }

  const asCaller = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: memberships, error } = await asCaller.from("org_members").select("org_id, orgs!inner(type)").eq("user_id", userId);
  if (error) {
    const signIn = /^PGRST30/.test(error.code ?? "") || /jwt|token/i.test(error.message ?? "");
    if (signIn) return { refused: [401, soft("sign in is required")] };
    console.error("generate-brief membership", error.message);
    return { refused: [200, soft("could not check who is asking")] };
  }
  const brands = (memberships ?? []).filter((row) => row.orgs?.type === "brand").map((row) => row.org_id);
  for (const org of brands) {
    const { data: may, error: permissionError } = await asCaller.rpc("has_org_permission", { target_org: org, perm: "rfqFlow" });
    if (permissionError) console.error("generate-brief permission", permissionError.message);
    if (may === true) return { userId, supabaseUrl, serviceKey };
  }
  return { refused: [403, soft("brand access required")] };
}

/**
 * Counts this brief against the person's hour, in one statement, so
 * concurrent calls cannot all read the same count and all go through.
 * Answers null when it may go ahead, or the refusal to send.
 */
async function overLimit({ userId, supabaseUrl, serviceKey }) {
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: allowed, error } = await service.rpc("claim_email_probe", {
    probe_ip: `generate-brief:${userId}`,
    max_attempts: BRIEFS_PER_HOUR,
    window_seconds: 3600,
  });
  if (error) {
    console.error("generate-brief limit", error.message);
    return [200, soft("could not check the limit")];
  }
  return allowed ? null : [429, soft("too many briefs, try again later")];
}

export default async function handler(request, response) {
  response.setHeader?.("Cache-Control", "private, no-store");
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

  const who = await caller(request);
  if (who.refused) {
    response.status(who.refused[0]).json(who.refused[1]);
    return;
  }

  const body = bodyOf(request);
  const freeText = String(body.freeText ?? "").trim();

  if (freeText.length < 20) {
    response.status(200).json(soft("too little to work from"));
    return;
  }

  // Counted only once the model is about to be asked: a description too short
  // to work from costs the person nothing.
  const limited = await overLimit(who);
  if (limited) {
    response.status(limited[0]).json(limited[1]);
    return;
  }

  const prompt = buildPrompt({
    freeText: freeText.slice(0, 8000),
    categories: slugList(body.categories),
    certifications: slugList(body.certifications),
    regions: slugList(body.regions),
    sourcing: slugList(body.sourcing),
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
        // Brief extraction does not need a separate reasoning pass. Prefer
        // the provider with the lowest time to first token, not lowest price.
        reasoning: { enabled: false },
        provider: { sort: "latency" },
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
