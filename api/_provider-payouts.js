import { ensureWiseRecipient } from "./_wise-recipient.js";
import { PayoutFailure, isFieldKey, withoutSecrets } from "./_payout-provider.js";
import { callerClient, jsonBody, reply, serviceClient, tokenRefused } from "./_stripe.js";

/**
 * Pay with Wise and Pay with PayPal, one shape behind both routes.
 *
 *   preview   Wise only: the fee, what arrives, and the balance, before anyone commits.
 *   pay       claim, call the provider with the attempt's key, read back. Pressing
 *             again resumes the same attempt with the same key.
 *   cancel    take back a transfer nobody funded, or a PayPal payment nobody claimed.
 *   sync      read back everything that can still change. The board does this while
 *             open; with nobody watching, Wise's and PayPal's webhooks
 *             (api/wise-webhook.js, api/paypal-webhook.js) and the daily sweep
 *             (api/payout-sync.js) do the same read. Previews sit behind Vercel's
 *             sign-in, where no webhook can reach: there the sweep and the board do it.
 *   tell      Wise refused the details: the attempt fails and the factory is told.
 *
 * Whether someone may do this is the database's call, as the caller. Whether the
 * money went is only ever written with the server's key, from what the provider said.
 *
 * Never a raw provider failure in a response: it goes to the log with keys removed.
 */

const STAFF_ONLY = "This is limited to platform staff.";
export const FUND_IN_WISE = "Transfer created. Fund it in Wise.";
export const CHECK_BANK = "Check your bank details";
export const CHECK_PAYPAL = "Check your PayPal address";

/**
 * Which details Wise refused, in our words: the factory reads these, and Wise's
 * own sentence stays on the board. From Wise's field keys when it named them,
 * else its sentence. A refusal naming none asks for the lot.
 */
const DETAIL_WORDS = [
  [/swift|\bbic\b/i, "SWIFT code"],
  [/iban|account ?number/i, "account number"],
  [/holder|account ?name|full ?name|legal ?name/i, "account holder's name"],
  [/address|city|post ?code|postal|state/i, "address"],
  [/bank ?name|branch/i, "bank name"],
];
const wordFor = (text) => DETAIL_WORDS.find(([pattern]) => pattern.test(text ?? ""))?.[1];
export function checkWords(sentence, fields = []) {
  const named = [...new Set((fields ?? []).map(wordFor).filter(Boolean))];
  const details = named.length ? named : [wordFor(sentence)].filter(Boolean);
  if (!details.length) return CHECK_BANK;
  return `Check your ${details.length > 1 ? `${details.slice(0, -1).join(", ")} and ${details.at(-1)}` : details[0]}`;
}

const DB_WORDS = {
  payout_in_progress: "This is already being paid. Wait a moment, then press Refresh.",
  payout_already_released: "This payout was already paid. Reload the board.",
  payout_not_owed: "This payment isn't approved for payout. Reload the board.",
  payout_stripe: "Stripe pays this factory. Use Retry payout.",
  payout_changed: "This factory changed where it is paid. Reload the page and check the details.",
  payout_own_company: "You belong to this company, so someone else on the staff must pay it.",
  reveal_brand_side: "Your company has an order with this factory, so someone else on the staff must pay it.",
  wise_not_set_up: "This factory has no bank account Wise can pay. Mark it paid by bank instead.",
  paypal_not_set_up: "This factory has no PayPal address. Ask it to add one on its Payments page.",
  cny_statement: "Confirm the contract and invoice statement first.",
  payout_not_processing: "Nothing is under way for this payment. Reload the board.",
};

const refusalFrom = (error) => new PayoutFailure("database", DB_WORDS[error.hint] ?? "That couldn't be done. Reload the page and try again.", { detail: error.hint ?? error.code ?? null });

const log = (where, failure, context = {}) => console.error(`${where}:`, withoutSecrets(failure?.message), {
  kind: failure?.kind ?? null, status: failure?.status ?? null, detail: withoutSecrets(failure?.detail ?? ""), ...context,
});

async function must(call) {
  const { data, error } = await call;
  if (error) throw refusalFrom(error);
  return data;
}

async function record(db, payoutId, patch) {
  const { error } = await db.rpc("record_provider_attempt", { target_payout: payoutId, ...patch });
  if (error) log("record_provider_attempt", error, { payoutId });
}

async function finish(db, payoutId, outcome, patch = {}) {
  const { error } = await db.rpc("finish_provider_payout", { target_payout: payoutId, outcome, ...patch });
  if (error) {
    log("finish_provider_payout", error, { payoutId, outcome });
    throw new PayoutFailure("record_failed", "The provider answered but we couldn't record it. Press Refresh.");
  }
}

/** Apply what a provider says about one attempt. Used by pay, and by sync. */
export async function applyStatus({ db, payoutId, status, wasPaid = false, tellOnFailure = null, received = null, receivedIn = null }) {
  if (status.state === "paid") {
    if (!wasPaid) await finish(db, payoutId, "paid", { raw_status: status.raw, received, received_in: receivedIn });
    return "paid";
  }
  if (status.state === "failed") {
    await finish(db, payoutId, "failed", {
      failure: tellOnFailure ? "details_rejected" : "other", raw_status: status.raw,
      sentence: status.failure ?? "This payment didn't go through. Pay again.", tell_factory: tellOnFailure,
    });
    return "failed";
  }
  if (status.state === "cancelled") {
    await finish(db, payoutId, "cancelled", { raw_status: status.raw, sentence: "Cancelled in Wise. Nothing was sent." });
    return "cancelled";
  }
  if (wasPaid) return "paid";
  await record(db, payoutId, {
    new_stage: status.state,
    new_status: status.raw,
    new_item: status.itemId ?? null,
    sentence: status.waiting ?? (status.state === "awaiting_funding" ? FUND_IN_WISE : null),
    received,
    received_in: receivedIn,
    tell_factory: status.factoryFixes ? CHECK_PAYPAL : null,
  });
  return status.state;
}

// ---------------------------------------------------------------------------
// Wise
// ---------------------------------------------------------------------------

async function wiseBalance(wise, currency) {
  const balance = await wise.balance(currency);
  return { balanceCents: balance.cents, balanceCurrency: balance.currency, balancesUrl: wise.balancesUrl() };
}

export async function wisePreview({ wise, caller, db, row, cnyConfirmed }) {
  // First: Wise marks the balance route unavailable on a quote larger than the
  // balance (seen on the sandbox), and "short by" is the sentence staff can act on.
  const balance = await wiseBalance(wise, row.currency);
  const shortByCents = Math.max(0, Number(row.amount_cents) - balance.balanceCents);
  if (shortByCents > 0) return { shortByCents, feeCents: null, arrivesCents: null, arrivesCurrency: row.wise_currency, nothingLeft: false, ...balance };
  const recipientId = await ensureWiseRecipient({
    caller, db, wise, accountId: row.payout_account_id, existingId: row.wise_recipient_id, cnyConfirmed,
  });
  const quote = await wise.quote({
    sourceCurrency: row.currency, targetCurrency: row.wise_currency, sourceCents: row.amount_cents, recipientId,
  });
  return {
    feeCents: quote.feeCents,
    arrivesCents: quote.arrivesCents,
    arrivesCurrency: quote.arrivesCurrency,
    nothingLeft: quote.arrivesCents <= 0,
    shortByCents,
    ...balance,
  };
}

export async function wisePay({ wise, caller, db, row, paymentId, changedAt, cnyConfirmed }) {
  const claim = await must(caller.rpc("claim_provider_payout", {
    target_payment: paymentId, which: "wise", paid_to_changed_at: changedAt, cny_confirmed: Boolean(cnyConfirmed),
  }));
  const payoutId = claim.payout_id;

  try {
    let transferId = claim.provider_ref;
    if (!transferId) {
      const balance = await wise.balance(claim.currency);
      if (balance.cents < Number(claim.amount_cents)) {
        const sentence = `Wise balance is short by ${money(Number(claim.amount_cents) - balance.cents, claim.currency)}. Top up TSC's Wise balance, then pay again.`;
        await finish(db, payoutId, "cancelled", { raw_status: "short_balance", sentence });
        return { done: "short_balance", sentence };
      }
      const recipientId = await ensureWiseRecipient({
        caller, db, wise, accountId: claim.account_id, existingId: claim.wise_recipient_id, cnyConfirmed,
      });
      // A fresh quote every time: Wise returns the first transfer for this key,
      // whichever quote comes with it (seen on the sandbox), and an old one expires.
      const quote = await wise.quote({
        sourceCurrency: claim.currency, targetCurrency: row.wise_currency, sourceCents: claim.amount_cents, recipientId,
      });
      if (quote.arrivesCents <= 0) {
        const sentence = "Wise's fee is more than this payment, so nothing would arrive. Pay it another way.";
        await finish(db, payoutId, "cancelled", { raw_status: "nothing_left", sentence });
        return { done: "nothing_left", sentence };
      }
      await record(db, payoutId, { new_quote: quote.id, new_fee: quote.feeCents, keep_lease: true });
      const transfer = await wise.createTransfer({
        recipientId, quoteId: quote.id, key: claim.key, reference: String(claim.order_number).slice(0, 30),
      });
      transferId = transfer.id;
      await record(db, payoutId, {
        new_ref: transferId, new_stage: "awaiting_funding", new_status: transfer.status,
        received: quote.arrivesCents, received_in: quote.arrivesCurrency, keep_lease: true,
      });
    }

    // Only a transfer still waiting is funded: a press after a timeout may find
    // the first press's funding already went.
    const before = await wise.status(transferId);
    if (before.raw === "incoming_payment_waiting") {
      const funding = await wise.fund(transferId);
      if (!funding.funded) {
        const sentence = funding.why === "short_balance"
          ? "Wise balance is too low to fund this. Top up TSC's Wise balance, then press Fund again."
          : funding.why === "funding_refused" ? FUND_IN_WISE : "Wise didn't fund this transfer. Open it in Wise to see why.";
        await record(db, payoutId, { new_stage: "awaiting_funding", new_status: before.raw, sentence });
        return { done: funding.why, sentence, transferUrl: wise.transferUrl(transferId) };
      }
    }
    const after = await wise.status(transferId);
    const state = await applyStatus({ db, payoutId, status: after, tellOnFailure: after.raw === "bounced_back" ? CHECK_BANK : null });
    return { done: state, transferUrl: wise.transferUrl(transferId) };
  } catch (failure) {
    if (failure instanceof PayoutFailure && failure.unsure) {
      await record(db, payoutId, { sentence: failure.message });
      throw failure;
    }
    // A certain "no" before there's a transfer ends the attempt: nothing went,
    // and the next press gets a new key rather than replaying this answer.
    const again = await db.from("provider_payouts").select("provider_ref").eq("id", payoutId).maybeSingle();
    if (!again.data?.provider_ref) {
      await finish(db, payoutId, "cancelled", { raw_status: failure.kind ?? "refused", sentence: failure.message });
    } else {
      await record(db, payoutId, { sentence: failure.message });
    }
    throw failure;
  }
}

export async function tellFactoryDetails({ caller, db, paymentId, changedAt, which, cnyConfirmed, sentence, fields = [] }) {
  const named = (Array.isArray(fields) ? fields : []).filter(isFieldKey).slice(0, 10);
  const claim = await must(caller.rpc("claim_provider_payout", {
    target_payment: paymentId, which, paid_to_changed_at: changedAt, cny_confirmed: Boolean(cnyConfirmed),
  }));
  await finish(db, claim.payout_id, "failed", {
    failure: "details_rejected", raw_status: "details_rejected", sentence,
    tell_factory: which === "paypal" ? CHECK_PAYPAL : checkWords(sentence, named),
  });
  // Which fields it can name to the factory. The factory has already been told, so this can't undo that.
  if (named.length) {
    const { error } = await db.from("provider_payouts").update({ details_fields: named }).eq("id", claim.payout_id);
    if (error) log("details_fields", error, { paymentId });
  }
  return { done: "failed" };
}

// ---------------------------------------------------------------------------
// PayPal
// ---------------------------------------------------------------------------

export async function paypalPay({ paypal, caller, db, paymentId, changedAt }) {
  const claim = await must(caller.rpc("claim_provider_payout", {
    target_payment: paymentId, which: "paypal", paid_to_changed_at: changedAt, cny_confirmed: false,
  }));
  const payoutId = claim.payout_id;
  try {
    const paid = await paypal.pay({
      key: claim.key, email: claim.paypal_email, amountCents: claim.amount_cents,
      currency: claim.currency, reference: `TSC ${claim.order_number}`,
    });
    await record(db, payoutId, { new_ref: paid.batchId, new_stage: "sent", keep_lease: true });
    const status = await paypal.status(paid.batchId);
    const state = await applyStatus({ db, payoutId, status, tellOnFailure: status.raw === "RETURNED" ? CHECK_PAYPAL : null });
    return { done: state, sentence: status.waiting ?? null };
  } catch (failure) {
    if (failure instanceof PayoutFailure && failure.unsure) {
      await record(db, payoutId, { sentence: failure.message });
      throw failure;
    }
    const again = await db.from("provider_payouts").select("provider_ref").eq("id", payoutId).maybeSingle();
    if (!again.data?.provider_ref) {
      const invalid = /address isn't valid/.test(failure.message);
      if (invalid) {
        await finish(db, payoutId, "failed", {
          failure: "details_rejected", raw_status: failure.kind ?? "refused", sentence: failure.message, tell_factory: CHECK_PAYPAL,
        });
      } else {
        await finish(db, payoutId, "cancelled", { raw_status: failure.kind ?? "refused", sentence: failure.message });
      }
    } else {
      await record(db, payoutId, { sentence: failure.message });
    }
    throw failure;
  }
}

// ---------------------------------------------------------------------------
// Both
// ---------------------------------------------------------------------------

export async function cancelAttempt({ client, caller, db, paymentId }) {
  const held = await must(caller.rpc("lease_provider_payout", { target_payment: paymentId }));
  const payoutId = held.payout_id;
  try {
    // A PayPal press whose answer was lost may have paid: PayPal pays the moment it
    // takes the batch. Only the same key can find out, so cancelling blind is refused.
    if (held.provider === "paypal" && !held.provider_ref) {
      throw new PayoutFailure("refused", "We don't know yet if PayPal paid this. Press again first: it finds what PayPal did and can't pay twice.");
    }
    if (held.provider_ref) {
      if (held.provider === "paypal") {
        const status = await client.status(held.provider_ref);
        if (status.raw !== "UNCLAIMED") {
          await applyStatus({ db, payoutId, status });
          throw new PayoutFailure("refused", "Only an unclaimed PayPal payment can be cancelled. The board now shows where it is.");
        }
        await client.cancel(status.itemId);
      } else {
        await client.cancel(held.provider_ref);
      }
    }
    await finish(db, payoutId, "cancelled", { raw_status: "cancelled", sentence: "Cancelled. Nothing was sent." });
    return { done: "cancelled" };
  } catch (failure) {
    // What the row says stays what it said: the payment is still where it was.
    await record(db, payoutId, { sentence: held.staff_sentence ?? null });
    if (failure instanceof PayoutFailure && failure.unsure) {
      const name = held.provider === "paypal" ? "PayPal" : "Wise";
      throw new PayoutFailure("cancel_failed", `${name} didn't cancel this, so it's still where it was. Try again later, or cancel it in ${name}.`, { status: failure.status });
    }
    throw failure;
  }
}

const READ_BACK_COLUMNS = "id, status, provider_ref, received_currency, paid_at";

/**
 * Ask the provider where one attempt is, and record it. Only the provider's own
 * answer is written: a webhook or the sweep only says "look now".
 */
export async function readBack({ client, db, row }) {
  const status = await client.status(row.provider_ref);
  const wasPaid = row.status === "paid";
  // The quote staff confirmed stands until it arrives. Wise's figure before that
  // can be for another pay-in route (seen on the sandbox).
  const arrived = status.state === "paid";
  const tell = status.state === "failed"
    ? (status.raw === "bounced_back" ? CHECK_BANK : status.raw === "RETURNED" ? CHECK_PAYPAL : null)
    : null;
  return applyStatus({
    db, payoutId: row.id, status, wasPaid, tellOnFailure: tell,
    received: arrived ? status.arrivesCents ?? null : null, receivedIn: arrived && status.arrivesCents != null ? row.received_currency : null,
  });
}

/**
 * A webhook named a transfer (Wise) or a batch (PayPal). Find our attempt by that
 * ref, or by the key we sent when the press's answer was lost before the ref was
 * kept (PayPal's sender_item_id), then read it back. Null when this database has
 * no such attempt: another site on the same account, or a test event.
 */
export async function readBackRef({ client, db, ref, key = null }) {
  let row = null;
  if (ref) {
    const found = await db.from("provider_payouts").select(READ_BACK_COLUMNS)
      .eq("provider", client.provider).eq("provider_ref", String(ref)).maybeSingle();
    if (found.error) throw new PayoutFailure("database", "provider_payouts could not be read", { detail: found.error.code });
    row = found.data;
  }
  if (!row && key && /^[0-9a-f-]{36}$/i.test(key)) {
    const attempt = await db.from("provider_payout_attempts").select("payout_id").eq("attempt_key", key).maybeSingle();
    if (attempt.data?.payout_id) {
      const found = await db.from("provider_payouts").select(READ_BACK_COLUMNS)
        .eq("id", attempt.data.payout_id).eq("provider", client.provider).maybeSingle();
      row = found.data;
      if (row && !row.provider_ref && ref) {
        await record(db, row.id, { new_ref: String(ref) });
        row = { ...row, provider_ref: String(ref) };
      }
    }
  }
  if (!row?.provider_ref) return null;
  if (!["processing", "paid"].includes(row.status)) return row.status;
  return readBack({ client, db, row });
}

/** Everything of this provider's that can still change. Paid ones for 30 days: a transfer can come back. */
export async function syncAttempts({ client, db }) {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: rows, error } = await db.from("provider_payouts")
    .select(READ_BACK_COLUMNS)
    .eq("provider", client.provider)
    .not("provider_ref", "is", null)
    .or(`status.eq.processing,and(status.eq.paid,paid_at.gte.${since})`)
    .limit(50);
  if (error) throw new PayoutFailure("database", "The board couldn't read its payments. Reload the page.");
  const answers = await Promise.allSettled((rows ?? []).map((row) => readBack({ client, db, row })));
  const unread = answers.filter((a) => a.status === "rejected");
  for (const a of unread) log("provider sync", a.reason, { provider: client.provider });
  return { read: answers.length - unread.length, unread: unread.length };
}

const money = (minor, currency) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);

// ---------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------

/** `build` reads the settings. A live account away from production throws here. */
export function payoutRoute({ provider, build, label, settings }) {
  return async function handler(request, response) {
    if (request.method !== "POST") return reply(response, 405, { error: "method not allowed" });

    let client;
    try {
      client = build();
    } catch (failure) {
      return reply(response, 503, { error: failure.message, kind: failure.kind ?? null });
    }
    const db = serviceClient();
    if (!client || !db) return reply(response, 503, { error: `${label} isn't set up on this site. Set ${settings}.`, kind: "not_set_up" });

    const caller = callerClient(request);
    if (!caller) return reply(response, 401, { error: "Your sign-in expired. Sign in again." });

    const staff = await caller.rpc("is_platform_admin");
    if (tokenRefused(staff)) return reply(response, 401, { error: "Your sign-in expired. Sign in again." });
    if (staff.error || staff.data !== true) return reply(response, 403, { error: STAFF_ONLY });

    const { action, paymentId, paidToChangedAt, cnyConfirmed } = jsonBody(request);
    try {
      if (action === "sync") {
        const synced = await syncAttempts({ client, db });
        const balance = provider === "wise" ? { ...(await wiseBalance(client, "USD")), appUrl: client.appUrl } : { appUrl: client.appUrl };
        return reply(response, 200, { ...synced, ...balance });
      }
      if (action === "cancel") return reply(response, 200, await cancelAttempt({ client, caller, db, paymentId }));

      if (action === "tell") {
        const { sentence, fields } = jsonBody(request);
        return reply(response, 200, await tellFactoryDetails({
          caller, db, paymentId, which: provider, changedAt: paidToChangedAt, cnyConfirmed,
          sentence: String(sentence ?? "The factory was told to check its details.").slice(0, 300), fields,
        }));
      }

      const board = await must(caller.rpc("admin_payment_board"));
      const row = (board ?? []).find((r) => r.payment_id === paymentId);
      if (!row) return reply(response, 404, { error: "That payment isn't on the board any more. Reload the page." });

      if (provider === "wise") {
        if (action === "preview") {
          return reply(response, 200, await wisePreview({ wise: client, caller, db, row, cnyConfirmed }));
        }
        if (action === "pay") {
          return reply(response, 200, await wisePay({ wise: client, caller, db, row, paymentId, changedAt: paidToChangedAt, cnyConfirmed }));
        }
      } else if (action === "pay") {
        return reply(response, 200, await paypalPay({ paypal: client, caller, db, paymentId, changedAt: paidToChangedAt }));
      }
      return reply(response, 400, { error: "unknown action" });
    } catch (failure) {
      log(`${provider}-payout`, failure, { action, paymentId });
      const known = failure instanceof PayoutFailure;
      return reply(response, known && failure.unsure ? 504 : 502, {
        error: known ? failure.message : `${label} didn't answer as expected. Press Refresh to see where this is.`,
        kind: known ? failure.kind : "unknown",
        unsure: known ? failure.unsure : true,
        fields: known ? failure.fields ?? [] : [],
      });
    }
  };
}
