/**
 * What Wise and PayPal share: reading a setting, refusing a live account away
 * from production, one timed call, and failures that say what happened.
 * The leading underscore keeps Vercel from serving this file.
 *
 * A failure is either certain (the provider answered "no", so nothing was sent)
 * or not (`unsure`: a timeout, a dropped connection, a 5xx). Only an unsure one
 * keeps the attempt's key alive for another press.
 */
export const PROVIDER_CALL_MS = 8000;

export class PayoutFailure extends Error {
  constructor(kind, sentence, { unsure = false, status = null, detail = null } = {}) {
    super(sentence);
    this.name = "PayoutFailure";
    this.kind = kind;
    this.unsure = unsure;
    this.status = status;
    this.detail = detail;
  }
}

/** No token, id or secret, even in a log. */
export function withoutSecrets(text, env = process.env) {
  let said = String(text ?? "");
  for (const name of ["WISE_API_TOKEN", "PAYPAL_CLIENT_SECRET", "PAYPAL_CLIENT_ID"]) {
    if (env[name]) said = said.split(env[name]).join("[key]");
  }
  return said.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [key]");
}

/** A live account pays real money, so only production may hold one. */
export function apiBase(env, name, label) {
  const base = String(env[name] ?? "").replace(/\/+$/, "");
  if (!base) return null;
  if (!/sandbox/i.test(base) && env.VERCEL_ENV !== "production") {
    throw new PayoutFailure("live_elsewhere", `A live ${label} account is only allowed on the production site.`);
  }
  return base;
}

/**
 * One call, with a time limit. Never retried here: whether a second try is safe
 * is the caller's decision, made with the attempt's key.
 */
export async function timedCall({ fetchImpl = fetch, url, label, ...options }) {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), PROVIDER_CALL_MS);
  try {
    const answer = await fetchImpl(url, { ...options, signal: stop.signal });
    const text = await answer.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    return { status: answer.status, headers: answer.headers, body };
  } catch (failure) {
    const timedOut = failure?.name === "AbortError";
    throw new PayoutFailure(timedOut ? "timeout" : "unreachable",
      `${label} didn't answer, so we don't know yet if this went. Press again: it can't pay twice.`,
      { unsure: true });
  } finally {
    clearTimeout(timer);
  }
}

/** Cents as the decimal string both providers read. */
export const decimal = (cents) => (Number(cents) / 100).toFixed(2);
/** A provider's decimal as cents. Rounded, because it arrives as a float. */
export const cents = (value) => Math.round(Number(value) * 100);
