import { callerClient, jsonBody, reply, tokenRefused } from "./_stripe.js";
import { chooseRecipientType, formFromRequirements } from "./_wise-requirements-shape.js";

const TIMEOUT_MS = 6000;
const QUOTE_LIFE_MS = 10 * 60 * 1000;
const QUOTE_AMOUNT = 1000;

// A quote is only what Wise needs in order to answer. Kept while warm, so a
// form opened twice asks once.
let quote = null;

async function wise(path, { method = "GET", body, language } = {}, env = process.env) {
  const answer = await fetch(`${env.WISE_API_BASE}${path}`, {
    method,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${env.WISE_API_TOKEN}`,
      "Accept-Minor-Version": "1",
      ...(language ? { "Accept-Language": language } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!answer.ok) throw new Error(`Wise answered ${answer.status}`);
  return answer.json();
}

async function quoteId(env) {
  const key = `${env.WISE_PROFILE_ID}:${env.WISE_PAYOUT_CURRENCY}`;
  if (quote?.key === key && quote.until > Date.now()) return quote.id;
  const made = await wise(`/v3/profiles/${env.WISE_PROFILE_ID}/quotes`, {
    method: "POST",
    body: { sourceCurrency: "USD", targetCurrency: env.WISE_PAYOUT_CURRENCY, sourceAmount: QUOTE_AMOUNT, payOut: "BANK_TRANSFER" },
  }, env);
  quote = { key, id: made.id, until: Date.now() + QUOTE_LIFE_MS };
  return made.id;
}

/** Nested, the way Wise wants a partly filled form: { address: { country } }. */
function nested(flat) {
  const out = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split(".");
    let at = out;
    for (const part of parts.slice(0, -1)) at = at[part] ??= {};
    at[parts.at(-1)] = value;
  }
  return out;
}

/**
 * The fields a factory's bank form asks for, from Wise, labelled in English and
 * Chinese, both Wise's own words. Any failure answers `unavailable`, never an
 * error to show: the page then draws the snapshot it carries, so the form is
 * never blank.
 */
export default async function handler(request, response) {
  if (request.method !== "POST") return reply(response, 405, { error: "method not allowed" });

  const caller = callerClient(request);
  if (!caller) return reply(response, 401, { error: "sign in is required" });
  const member = await caller.from("org_members").select("org_id").limit(1);
  if (tokenRefused(member)) return reply(response, 401, { error: "sign in is required" });

  const env = process.env;
  if (!env.WISE_API_BASE || !env.WISE_API_TOKEN || !env.WISE_PROFILE_ID || !env.WISE_PAYOUT_CURRENCY) {
    return reply(response, 200, { unavailable: true });
  }

  const { country, details } = jsonBody(request);
  const knownCountry = /^[A-Z]{2}$/.test(country ?? "") ? country : null;
  try {
    const id = await quoteId(env);
    const type = chooseRecipientType(await wise(`/v1/quotes/${id}/account-requirements`, { language: "en" }, env));
    if (!type) return reply(response, 200, { unavailable: true });
    // Wise adds and drops fields once the country is known, so ask again with
    // what is already settled (legal type, country, and any select that said so).
    const seed = formFromRequirements(type, knownCountry);
    const settled = { ...(seed?.fixed ?? {}), ...(details && typeof details === "object" ? details : {}) };
    const refined = (language) => wise(`/v1/quotes/${id}/account-requirements`, {
      method: "POST", language, body: { type: type.type, details: nested(settled) },
    }, env);
    const [english, chinese] = await Promise.all([refined("en"), refined("zh-CN").catch(() => [])]);
    const form = formFromRequirements(english.find?.((item) => item.type === type.type) ?? type, knownCountry);
    if (!form) return reply(response, 200, { unavailable: true });
    const inChinese = formFromRequirements(chinese.find?.((item) => item.type === type.type), knownCountry);
    const labels = Object.fromEntries((inChinese?.fields ?? []).map((field) => [field.key, field.label]));
    return reply(response, 200, {
      ...form,
      fields: form.fields.map((field) => ({ ...field, labelZh: labels[field.key] })),
      currency: env.WISE_PAYOUT_CURRENCY,
      source: "wise",
    });
  } catch (failure) {
    console.error("wise-requirements", failure?.name, failure?.message);
    return reply(response, 200, { unavailable: true });
  }
}
