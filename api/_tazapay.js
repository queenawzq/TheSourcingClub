/**
 * Tazapay, a candidate for paying factories in mainland China and Hong Kong,
 * which Stripe Connect cannot reach. Step 1 only: a client used by
 * scripts/tazapay-sandbox.mjs. Nothing in the app calls it yet, and it is not
 * a provider in api/_payout-provider.js.
 *
 * Settings: TAZAPAY_BASE_URL, TAZAPAY_API_KEY, TAZAPAY_API_SECRET. Server only.
 * The key and secret are never logged, returned or put in an error.
 *
 * Only the sandbox host is allowed off production, the same rule as a live
 * Stripe key: a laptop or a preview can never move real money.
 *
 * Idempotency: Tazapay stores only 2xx answers under an Idempotency-Key, for
 * 24 hours; an error is not stored, so retrying with the same key runs again.
 * That means an old failure is never replayed (unlike Stripe), so a create may
 * be keyed by what it is for (e.g. the payment id).
 */

export const TAZAPAY_SANDBOX_HOST = "service-sandbox.tazapay.com";
export const TAZAPAY_CALL_MS = 15000;

export class TazapayFailure extends Error {
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = "TazapayFailure";
    this.kind = kind;
    Object.assign(this, extra);
  }
}

/** The base URL, or a refusal when it is not the sandbox off production. */
export function tazapayBase(env = process.env) {
  const raw = String(env.TAZAPAY_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (!raw) return null;
  let host;
  try { host = new URL(raw).host; } catch {
    throw new TazapayFailure("bad_setting", "TAZAPAY_BASE_URL is not a URL.");
  }
  if (host !== TAZAPAY_SANDBOX_HOST && env.VERCEL_ENV !== "production") {
    throw new TazapayFailure("live_elsewhere", "A live Tazapay account is only allowed on the production site.");
  }
  return raw;
}

/** Tazapay's validation errors name the field in errors[].remarks or message. */
function describeRefusal(body) {
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  const said = errors.map((e) => [e?.code, e?.message, e?.remarks].filter(Boolean).join(": ")).filter(Boolean);
  return (said.length ? said.join("; ") : (body?.message || "no reason given")).replace(/[.\s]+$/, "");
}

export function tazapayFrom(env = process.env, fetchImpl = fetch) {
  const base = tazapayBase(env);
  const key = env.TAZAPAY_API_KEY;
  const secret = env.TAZAPAY_API_SECRET;
  if (!base || !key || !secret) return null;
  const authorization = `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;

  async function call(method, path, { body, query, idempotencyKey } = {}) {
    const url = new URL(`${base}${path}`);
    for (const [k, v] of Object.entries(query ?? {})) if (v != null) url.searchParams.set(k, v);
    const headers = { Authorization: authorization, Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), TAZAPAY_CALL_MS);
    let answer, text;
    try {
      answer = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: stop.signal });
      text = await answer.text();
    } catch (failure) {
      if (failure?.name === "AbortError") {
        throw new TazapayFailure("timeout", `Tazapay didn't answer ${method} ${path} in ${TAZAPAY_CALL_MS / 1000} s, so we don't know if it went.`, { unsure: true });
      }
      throw new TazapayFailure("unreachable", `Tazapay couldn't be reached for ${method} ${path} (${failure?.cause?.code ?? failure?.message ?? "network error"}).`, { unsure: true });
    } finally {
      clearTimeout(timer);
    }
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    const status = answer.status;
    if (status >= 200 && status < 300) return parsed?.data ?? parsed;

    const reason = describeRefusal(parsed);
    const extra = { status, body: parsed, path };
    // The gateway answers 403 {"message":"Forbidden"} (no "status") for a path
    // that is not an API route, whatever the key: that is not a key problem.
    if (status === 403 && parsed && !parsed.status) throw new TazapayFailure("not_found", `Tazapay's gateway refused ${method} ${path} (403, no such route for API keys).`, extra);
    if (status === 401 || status === 403) throw new TazapayFailure("key_refused", `Tazapay refused TSC's API key (${status}). Check TAZAPAY_API_KEY and TAZAPAY_API_SECRET.`, extra);
    if (status === 404) throw new TazapayFailure("not_found", `Tazapay has no ${path} (404): ${reason}.`, extra);
    if (status === 400 || status === 422) throw new TazapayFailure("invalid", `Tazapay refused ${method} ${path}: ${reason}.`, extra);
    if (status === 429 || status >= 500) throw new TazapayFailure("provider_down", `Tazapay is having trouble (${status}), so we don't know if ${method} ${path} went: ${reason}.`, { ...extra, unsure: true });
    throw new TazapayFailure("refused", `Tazapay answered ${status} to ${method} ${path}: ${reason}.`, extra);
  }

  return {
    base,
    call,
    balance: () => call("GET", "/v3/balance"),
    bankMetadata: (query) => call("GET", "/v3/metadata/payout/bank", { query }),
    createBeneficiary: (body, idempotencyKey) => call("POST", "/v3/beneficiary", { body, idempotencyKey }),
    getBeneficiary: (id) => call("GET", `/v3/beneficiary/${encodeURIComponent(id)}`),
    createPayout: (body, idempotencyKey) => call("POST", "/v3/payout", { body, idempotencyKey }),
    getPayout: (id) => call("GET", `/v3/payout/${encodeURIComponent(id)}`),
    payoutQuote: (body, idempotencyKey) => call("POST", "/v3/payout/quote", { body, idempotencyKey }),
    sandboxTopup: (body, idempotencyKey) => call("POST", "/v3/sandbox/balance/topup", { body, idempotencyKey }),
  };
}
