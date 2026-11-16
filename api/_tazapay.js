import { PayoutFailure, withoutSecrets } from "./_payout-provider.js";

/**
 * Tazapay, for staff's Pay with Tazapay: factories in mainland China (CNY over
 * CNAPS) and Hong Kong (HKD over CHATS), which Stripe Connect cannot reach.
 * Server only: the key never reaches the browser.
 *
 * Settings: TAZAPAY_BASE_URL, TAZAPAY_API_KEY, TAZAPAY_API_SECRET; optional
 * TAZAPAY_APP_URL (the dashboard staff open). The key and secret are never
 * logged, returned or put in an error.
 *
 * Only the sandbox host is allowed off production, the same rule as a live
 * Stripe key: a laptop or a preview can never move real money.
 *
 * Idempotency: Tazapay stores only 2xx answers under an Idempotency-Key, for 24
 * hours, and an error is not stored, so retrying with the same key runs again.
 * An old failure is never replayed. A payout is keyed by its attempt (a payment
 * paid again after a failed payout is a new attempt and a new key): keyed by the
 * payment, Tazapay would answer the second attempt with the first, failed payout.
 *
 * Every figure below was read from the sandbox (notes: Tazapay step 1).
 */

export const TAZAPAY_SANDBOX_HOST = "service-sandbox.tazapay.com";
export const TAZAPAY_CALL_MS = 15000;
const LABEL = "Tazapay";

/** A PayoutFailure, so the shared payout code reads `unsure` the same way for every provider. */
export class TazapayFailure extends PayoutFailure {
  constructor(kind, message, extra = {}) {
    super(kind, message, { unsure: Boolean(extra.unsure), status: extra.status ?? null, detail: extra.detail ?? null, fields: extra.fields ?? null });
    this.name = "TazapayFailure";
    this.body = extra.body ?? null;
    this.path = extra.path ?? null;
    this.codes = extra.codes ?? [];
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

/** Tazapay's validation errors name the field in errors[].remarks. */
function describeRefusal(body) {
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  const said = errors.map((e) => [e?.code, e?.message, e?.remarks].filter(Boolean).join(": ")).filter(Boolean);
  return (said.length ? said.join("; ") : (body?.message || "no reason given")).replace(/[.\s]+$/, "");
}

// ---------------------------------------------------------------------------
// What a payout's status means for TSC (sandbox, Nov 15). Tazapay's own word
// stays as `raw`; `state` is the attempt's: sent, paid, failed or cancelled.
// ---------------------------------------------------------------------------
export const TAZAPAY_STATES = {
  requires_funding: "sent",
  requires_confirmation: "sent",
  requires_action: "sent",
  requires_approval: "sent",
  approval_hold: "sent",
  initiator_bank_hold: "sent",
  compliance_hold: "sent",
  processing: "sent",
  succeeded: "paid",
  failed: "failed",
  cancelled: "cancelled",
  // After it was paid: the money came back, so the payment is owed again.
  reversed: "failed",
};

const WAITING = {
  compliance_hold: "Tazapay is checking this payout (compliance hold). It goes on by itself; nothing to do unless Tazapay asks.",
  initiator_bank_hold: "The sending bank is holding this payout for review. It goes on by itself once cleared.",
  requires_action: "Tazapay needs something before this payout can go on. Open it in Tazapay.",
  requires_approval: "This payout waits for someone with approval rights in Tazapay. Approve it there.",
  approval_hold: "This payout waits for an approval in Tazapay. Open it there.",
  requires_funding: "This payout waits for money in TSC's Tazapay balance. Top up the balance in Tazapay.",
  requires_confirmation: "This payout waits for confirmation in Tazapay. Open it there.",
};

/** A bank's refusal is the factory's to fix; everything else stays with staff. */
const BANK_REFUSED = /^PF03/;

const usd = (minor, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(minor) / 100);

export function tazapayFrom(env = process.env, fetchImpl = fetch) {
  const base = tazapayBase(env);
  // A value pasted into a dashboard often carries a newline, a space or quotes;
  // any of those makes Tazapay answer "access key is missing".
  const clean = (value) => String(value ?? "").trim().replace(/^(["'])(.*)\1$/, "$2").trim();
  const key = clean(env.TAZAPAY_API_KEY);
  const secret = clean(env.TAZAPAY_API_SECRET);
  if (!base || !key || !secret) return null;
  const authorization = `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;
  const sandbox = new URL(base).host === TAZAPAY_SANDBOX_HOST;
  const appUrl = String(env.TAZAPAY_APP_URL ?? "").replace(/\/+$/, "")
    || (sandbox ? "https://dashboard-sandbox.tazapay.com" : "https://dashboard.tazapay.com");

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
        throw new TazapayFailure("timeout", `${LABEL} didn't answer in time, so we don't know yet if this went. Press again: it can't pay twice.`, { unsure: true, path });
      }
      throw new TazapayFailure("unreachable", `${LABEL} couldn't be reached, so we don't know yet if this went. Press again: it can't pay twice.`,
        { unsure: true, path, detail: withoutSecrets(failure?.cause?.code ?? failure?.message ?? "network error", env) });
    } finally {
      clearTimeout(timer);
    }
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    const status = answer.status;
    if (status >= 200 && status < 300) return parsed?.data ?? parsed;

    const reason = describeRefusal(parsed);
    const errors = Array.isArray(parsed?.errors) ? parsed.errors : [];
    const extra = {
      status, body: parsed, path, detail: reason,
      codes: errors.map((e) => e?.code).filter((c) => c != null),
      fields: errors.map((e) => e?.remarks).filter((r) => typeof r === "string" && /^[A-Za-z][A-Za-z0-9._[\]]{0,59}$/.test(r)),
    };
    // The gateway answers 403 {"message":"Forbidden"} (no "status") for a path
    // that is not an API route, whatever the key: that is not a key problem.
    if (status === 403 && parsed && !parsed.status) throw new TazapayFailure("not_found", `${LABEL} has no such route (${method} ${path}).`, extra);
    if (status === 401 || status === 403) throw new TazapayFailure("key_refused", `${LABEL} refused TSC's API key. Check TAZAPAY_API_KEY and TAZAPAY_API_SECRET.`, extra);
    if (status === 404) throw new TazapayFailure("not_found", `${LABEL} has no record of this (${reason}).`, extra);
    if (status === 400 || status === 409 || status === 422) {
      if (extra.codes.includes(20199)) {
        throw new TazapayFailure("short_balance", "TSC's Tazapay balance is too low for this payout. Top up the balance in Tazapay, then pay again.", extra);
      }
      throw new TazapayFailure("refused", `${LABEL} refused this: ${reason}.`, extra);
    }
    // A 500 on a payout was seen when Tazapay could not fetch the invoice: no
    // payout was made, but that can't be known from here, so it is unsure.
    if (status === 429 || status >= 500) {
      throw new TazapayFailure("provider_down", `${LABEL} is having trouble, so we don't know yet if this went. Press again in a minute: it can't pay twice.`, { ...extra, unsure: true });
    }
    throw new TazapayFailure("refused", `${LABEL} answered ${status}: ${reason}.`, extra);
  }

  /**
   * What came back after a failed or reversed payout, and what TSC lost, from
   * Tazapay's two balance transactions: the debit when it was made and the
   * credit when it came back. In the holding currency (USD).
   */
  async function moneyBack(payout) {
    if (!payout?.reversal_balance_transaction || !payout?.balance_transaction) return null;
    const [debit, credit] = await Promise.all([
      call("GET", `/v3/balance_transaction/${encodeURIComponent(payout.balance_transaction)}`),
      call("GET", `/v3/balance_transaction/${encodeURIComponent(payout.reversal_balance_transaction)}`),
    ]);
    const out = Math.abs(Number(debit?.net?.amount));
    const back = Math.abs(Number(credit?.net?.amount));
    const currency = credit?.net?.currency ?? debit?.net?.currency;
    if (!Number.isFinite(out) || !Number.isFinite(back) || !currency || debit?.net?.currency !== credit?.net?.currency) return null;
    return { debitedMinor: out, returnedMinor: back, lostMinor: Math.max(0, out - back), currency };
  }

  return {
    provider: "tazapay",
    base,
    appUrl,
    call,
    balance: () => call("GET", "/v3/balance"),
    bankMetadata: (query) => call("GET", "/v3/metadata/payout/bank", { query }),
    createBeneficiary: (body, idempotencyKey) => call("POST", "/v3/beneficiary", { body, idempotencyKey }),
    getBeneficiary: (id) => call("GET", `/v3/beneficiary/${encodeURIComponent(id)}`),
    createPayout: (body, idempotencyKey) => call("POST", "/v3/payout", { body, idempotencyKey }),
    getPayout: (id) => call("GET", `/v3/payout/${encodeURIComponent(id)}`),
    payoutQuote: (body, idempotencyKey) => call("POST", "/v3/payout/quote", { body, idempotencyKey }),
    sandboxTopup: (body, idempotencyKey) => call("POST", "/v3/sandbox/balance/topup", { body, idempotencyKey }),
    moneyBack,

    /** How much of `currency` TSC's Tazapay balance holds, in minor units. */
    async available(currency) {
      const balance = await call("GET", "/v3/balance");
      const row = (balance?.available ?? []).find((b) => b.currency === currency);
      return Number(row?.amount ?? 0);
    },

    /**
     * The factory pays Tazapay's fee: the step is what leaves TSC's balance,
     * fee included (src/shared/withdrawal-fees.mjs). A quote with the holding
     * amount set puts the fee inside it; the payout amount it gives is then
     * quoted back, and lowered a minor unit at a time if Tazapay's rounding
     * would take more than the step, so TSC never pays more than the step.
     * totalMinor is what leaves the balance; feeMinor is Tazapay's fee in it.
     */
    async quote({ holdingCurrency, amountMinor, route }) {
      const ask = (info) => call("POST", "/v3/payout/quote", {
        body: {
          payout_type: route.type, local: { fund_transfer_network: route.network },
          holding_info: { currency: holdingCurrency, ...(info.holding ? { amount: info.holding } : {}) },
          payout_info: { currency: route.currency, ...(info.payout ? { amount: info.payout } : {}) },
          destination_info: { currency: route.currency, country: route.country },
        },
      });
      const step = Number(amountMinor);
      const feeOf = (quote) => Number(quote?.fee_info?.fixed?.in_holding_currency ?? 0) + Number(quote?.fee_info?.variable?.in_holding_currency ?? 0);
      // Too small to send: the fee, read from a quote of a larger amount, so the
      // refusal can name it (withdrawalFee() words it). Nothing is sent.
      const tooSmall = async () => {
        const probe = await ask({ holding: step + 10000 });
        return { tooSmall: true, rate: Number(probe?.exchange_rates?.holding_to_payout) || null, payoutMinor: 0, payoutCurrency: route.currency, totalMinor: step, feeMinor: feeOf(probe) };
      };
      let first;
      try {
        first = await ask({ holding: step });
      } catch (failure) {
        // Tazapay refuses a holding amount its fee would swallow (20003, "valid amount").
        if (failure instanceof TazapayFailure && /20003/.test(failure.message)) return await tooSmall();
        throw failure;
      }
      const rate = Number(first?.exchange_rates?.holding_to_payout);
      if (!(rate > 0)) throw new TazapayFailure("quote_unavailable", `${LABEL} gave no rate for ${route.currency}. Try again in a minute.`);
      let payoutMinor = Number(first?.payout_info?.amount);
      if (!(payoutMinor > 0)) return await tooSmall();
      for (let tries = 0; tries < 4; tries += 1) {
        const back = await ask({ payout: payoutMinor });
        const total = Number(back?.holding_info?.amount);
        if (Number.isFinite(total) && total <= step) {
          return { rate, payoutMinor, payoutCurrency: route.currency, totalMinor: total, feeMinor: feeOf(back) };
        }
        payoutMinor -= Math.max(1, Math.ceil((total - step) * rate));
        if (payoutMinor <= 0) break;
      }
      throw new TazapayFailure("quote_unavailable", `${LABEL}'s quote didn't fit in the payment. Try again in a minute.`);
    },

    /**
     * An invoice for Tazapay to keep with the payout. Tazapay's own upload: a
     * pre-signed PUT, then the object's address without the signature, which
     * Tazapay reads with its own access (seen on the sandbox). Nothing of TSC's
     * has to be reachable from the internet, so it works the same from a laptop.
     */
    async uploadDocument({ fileName, bytes, contentType = "application/pdf" }) {
      const slot = await call("POST", "/v3/metadata/doc/upload", { body: { file_name: fileName } });
      if (!slot?.url) throw new TazapayFailure("refused", `${LABEL} gave no place to upload the invoice. Try again.`);
      let put;
      try {
        put = await fetchImpl(slot.url, { method: "PUT", headers: { "Content-Type": contentType }, body: bytes });
      } catch {
        throw new TazapayFailure("unreachable", `The invoice couldn't be uploaded to ${LABEL}. Press again.`, { unsure: true });
      }
      if (!put.ok) throw new TazapayFailure("refused", `${LABEL} didn't accept the invoice upload (${put.status}). Press again.`, { unsure: true, status: put.status });
      const url = new URL(slot.url);
      return `${url.origin}${url.pathname}`;
    },

    /**
     * Where a payout is, for the shared code (api/_provider-payouts.js): state,
     * Tazapay's word, the sentence staff read, what arrived, and whether the
     * factory is told to check its details.
     */
    async status(id) {
      const payout = await call("GET", `/v3/payout/${encodeURIComponent(id)}`);
      const raw = String(payout?.status ?? "");
      const known = Object.hasOwn(TAZAPAY_STATES, raw);
      const state = known ? TAZAPAY_STATES[raw] : "sent";
      const arrivesCents = Number.isFinite(Number(payout?.amount)) ? Number(payout.amount) : null;
      const result = {
        state, raw, arrivesCents, arrivesCurrency: payout?.currency ?? null, failure: null, tellFactory: false,
        // A status Tazapay adds later stays open, and staff are told to look, never guessed at.
        waiting: WAITING[raw] ?? (known ? null : `Tazapay reports this payout as "${raw.slice(0, 40) || "no status"}", which TSC doesn't know yet. Check it in Tazapay.`),
      };
      if (state !== "failed" && state !== "cancelled") return result;
      // Tazapay marks a payout failed or reversed a little before the money is
      // back in the balance (seen on the sandbox). It stays open until it is, so
      // staff are told what came back, and the payment isn't owed twice meanwhile.
      if (payout?.balance_transaction && !payout?.reversal_balance_transaction) {
        const what = { reversed: "was reversed", cancelled: "was cancelled" }[raw] ?? "failed";
        return { ...result, state: "sent", waiting: `Tazapay says this payout ${what}, and the money isn't back in TSC's Tazapay balance yet. It closes when it is.` };
      }

      const code = payout?.failure?.code ?? null;
      const said = [payout?.failure?.description, payout?.status_description].filter(Boolean).join(" · ");
      const back = await moneyBack(payout).catch(() => null);
      const money = back
        ? ` ${usd(back.returnedMinor, back.currency)} came back to TSC's Tazapay balance${back.lostMinor ? `; ${usd(back.lostMinor, back.currency)} was lost (fee, exchange rate and bank charges)` : ", fee included"}.`
        : " Check TSC's Tazapay balance for what came back.";
      if (raw === "cancelled") {
        result.failure = `Tazapay cancelled this payout before it was paid${said ? ` (${said})` : ""}. Nothing reached the factory.${back ? money : ""} The payment is still owed: pay again when ready.`;
      } else if (raw === "reversed") {
        result.failure = `Tazapay paid this, then the payout was reversed${said ? ` (${said})` : ""}.${money} The payment is owed again: check with the factory before paying again.`;
      } else if (code && BANK_REFUSED.test(code)) {
        result.failure = `The factory's bank refused this payout (${code}${said ? `: ${said}` : ""}).${money} The factory was asked to check its bank details.`;
        result.tellFactory = true;
      } else {
        result.failure = `Tazapay didn't pay this${code ? ` (${code}${said ? `: ${said}` : ""})` : ""}.${money} Ask Tazapay why before paying again; the factory wasn't told.`;
      }
      result.moneyBack = back;
      return result;
    },

    /** Tazapay has no way to take a payout back once it is made. */
    async cancel() {
      throw new TazapayFailure("refused", "A Tazapay payout can't be cancelled once it is made. Wait for it to finish, or ask Tazapay to recall it.");
    },
  };
}

