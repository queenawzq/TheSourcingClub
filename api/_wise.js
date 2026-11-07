import { PayoutFailure, apiBase, cents, decimal, timedCall } from "./_payout-provider.js";

/**
 * Wise, for staff's Pay with Wise. Server only: the token is never bundled.
 *
 * One setting per value (WISE_API_BASE, WISE_API_TOKEN, WISE_PROFILE_ID,
 * WISE_PAYOUT_CURRENCY) and no branch on which account this is, so going live
 * is a change of settings. What is seen differently is answered by Wise and
 * handled the same way everywhere: a German sandbox profile refuses funding by
 * token (403, x-2fa-approval-result: REJECTED); a US account should not.
 *
 * customerTransactionId is the idempotency key. Tested on the sandbox: the same
 * key returns the same transfer, also with a different quote.
 *
 * The bank number passes through createRecipient() on its way to Wise and goes
 * nowhere else: it isn't logged, returned or stored (check:bank-number pins it).
 */

const LABEL = "Wise";

/** From Wise's transfer statuses to the attempt's states. An unknown one stays as it is. */
export const WISE_STATES = {
  incoming_payment_waiting: "awaiting_funding",
  incoming_payment_initiated: "sent",
  waiting_recipient_input_to_proceed: "sent",
  processing: "sent",
  funds_converted: "sent",
  outgoing_payment_sent: "paid",
  bounced_back: "failed",
  funds_refunded: "failed",
  charged_back: "failed",
  cancelled: "cancelled",
};

const WISE_FAILURES = {
  bounced_back: "The recipient's bank returned this transfer. Check the bank details with the factory, then pay again.",
  funds_refunded: "Wise refunded this transfer to TSC's balance. Pay again, or check why in Wise.",
  charged_back: "This transfer was charged back. Check why in Wise before paying again.",
};

export function wiseFrom(env = process.env, fetchImpl = fetch) {
  const base = apiBase(env, "WISE_API_BASE", LABEL);
  const token = env.WISE_API_TOKEN;
  const profile = env.WISE_PROFILE_ID;
  const payoutCurrency = env.WISE_PAYOUT_CURRENCY;
  if (!base || !token || !profile || !payoutCurrency) return null;

  async function call(method, path, body) {
    const answer = await timedCall({
      fetchImpl, label: LABEL, url: `${base}${path}`, method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (answer.status === 401) {
      throw new PayoutFailure("key_refused", "Wise refused TSC's API key. Check WISE_API_TOKEN.", { status: 401 });
    }
    if (answer.status >= 500 || answer.status === 429) {
      throw new PayoutFailure("provider_down", "Wise is having trouble, so we don't know yet if this went. Press again in a minute: it can't pay twice.", { unsure: true, status: answer.status });
    }
    return answer;
  }

  /** Wise's own words for a field are written for the person filling it in. */
  function refused(answer, doing) {
    const errors = answer.body?.errors ?? [];
    const said = errors.map((e) => e.message).filter(Boolean).join(" ");
    return new PayoutFailure("refused", said ? `Wise refused this: ${said}` : `Wise refused to ${doing}.`, { status: answer.status, detail: errors.map((e) => e.code).join(",") });
  }

  return {
    provider: "wise",
    payoutCurrency,
    /** Where a person opens a transfer: the app's address, from the API's. */
    transferUrl: (id) => `${base.replace("//api.", "//")}/transactions/activities/by-resource/TRANSFER/${id}`,
    balancesUrl: () => `${base.replace("//api.", "//")}/balances`,

    /** { cents, currency } for one currency, or cents 0 when there's no balance in it. */
    async balance(currency) {
      const answer = await call("GET", `/v4/profiles/${profile}/balances?types=STANDARD`);
      if (answer.status >= 300) throw refused(answer, "show its balance");
      const row = (answer.body ?? []).find((b) => b.currency === currency);
      return { cents: row ? cents(row.amount?.value) : 0, currency };
    },

    /** Which recipient type this country and currency takes, and whether the CNY statement is on it. */
    async requirements(quoteId) {
      const answer = await call("GET", `/v1/quotes/${quoteId}/account-requirements`);
      if (answer.status >= 300) throw refused(answer, "say what it needs");
      return answer.body ?? [];
    },

    async createRecipient({ type, accountHolderName, details }) {
      const answer = await call("POST", "/v1/accounts", {
        profile: Number(profile), currency: payoutCurrency, type, accountHolderName, details,
      });
      if (answer.status >= 300) throw refused(answer, "accept these bank details");
      return answer.body.id;
    },

    /** The fee and what arrives depend on the recipient, so one is always named. */
    async quote({ sourceCurrency, sourceCents, recipientId }) {
      const answer = await call("POST", `/v3/profiles/${profile}/quotes`, {
        sourceCurrency, targetCurrency: payoutCurrency, sourceAmount: Number(decimal(sourceCents)),
        targetAccount: recipientId, payOut: "BANK_TRANSFER", preferredPayIn: "BALANCE",
      });
      if (answer.status >= 300) throw refused(answer, "quote this payment");
      const option = (answer.body.paymentOptions ?? []).find((o) => o.payIn === "BALANCE");
      if (!option || option.disabled) {
        throw new PayoutFailure("quote_unavailable", "Wise can't pay this from TSC's balance right now. Check the balance's currency in Wise.");
      }
      return {
        id: answer.body.id,
        feeCents: cents(option.fee?.total),
        arrivesCents: cents(option.targetAmount),
        arrivesCurrency: payoutCurrency,
        rate: answer.body.rate ?? null,
      };
    },

    /** Same key, same transfer. */
    async createTransfer({ recipientId, quoteId, key, reference }) {
      const answer = await call("POST", "/v1/transfers", {
        targetAccount: recipientId, quoteUuid: quoteId, customerTransactionId: key,
        details: { reference, transferPurpose: "GOODS" },
      });
      if (answer.status >= 300) throw refused(answer, "create this transfer");
      return { id: String(answer.body.id), status: answer.body.status };
    },

    /**
     * Pay it from TSC's balance. Wise's refusal to fund by token is an answer,
     * not an error: the transfer exists and a person funds it in Wise.
     */
    async fund(transferId) {
      const answer = await call("POST", `/v3/profiles/${profile}/transfers/${transferId}/payments`, { type: "BALANCE" });
      if (answer.status === 403) return { funded: false, why: "funding_refused" };
      if (answer.status >= 300 || answer.body?.status === "REJECTED") {
        const code = answer.body?.errorCode ?? answer.body?.errors?.[0]?.code ?? null;
        return { funded: false, why: /insufficient|balance/i.test(code ?? "") ? "short_balance" : "fund_rejected", code };
      }
      return { funded: true };
    },

    async status(transferId) {
      const answer = await call("GET", `/v1/transfers/${transferId}`);
      if (answer.status >= 300) throw refused(answer, "read this transfer");
      const raw = answer.body.status;
      return {
        raw,
        state: WISE_STATES[raw] ?? null,
        failure: WISE_FAILURES[raw] ?? null,
        arrivesCents: answer.body.targetValue != null ? cents(answer.body.targetValue) : null,
      };
    },

    async cancel(transferId) {
      const answer = await call("PUT", `/v1/transfers/${transferId}/cancel`);
      if (answer.status >= 300) throw refused(answer, "cancel this transfer");
      return { raw: answer.body.status };
    },
  };
}

/**
 * The recipient Wise wants, from the requirement list and what the factory
 * typed: only the fields Wise asks for today, every required one present or
 * refused by name before Wise is called.
 *
 * `values` is the factory's answers by Wise's own keys ("address.city", ...).
 */
export function recipientFrom(requirement, values) {
  const details = {};
  let holder = null;
  const missing = [];
  for (const field of requirement.fields ?? []) {
    for (const group of field.group ?? []) {
      const value = values[group.key];
      if (value === undefined || value === null || value === "") {
        if (group.required) missing.push(field.name);
        continue;
      }
      if (group.key === "accountHolderName") { holder = value; continue; }
      const path = group.key.split(".");
      let at = details;
      for (const part of path.slice(0, -1)) at = at[part] ??= {};
      at[path.at(-1)] = value;
    }
  }
  if (missing.length) {
    throw new PayoutFailure("details_missing", `The factory's bank details are missing: ${missing.join(", ")}. Ask the factory to add them on its Payments page.`);
  }
  return { type: requirement.type, accountHolderName: holder, details };
}
