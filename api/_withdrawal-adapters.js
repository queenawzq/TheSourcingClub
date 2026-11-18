import { ensureWiseRecipient } from "./_wise-recipient.js";
import { PayoutFailure } from "./_payout-provider.js";
import { CANT_PAY_FROM_BALANCE, wiseFrom } from "./_wise.js";
import { paypalFrom } from "./_paypal.js";

/**
 * One adapter per way a withdrawal leaves TSC. The core (api/_withdrawals.js)
 * owns the state machine, the database and the fee rule; an adapter only talks
 * to its provider. Adding a provider (Tazapay) is one more entry here, with no
 * change to the core:
 *
 *   provider        the factory_withdrawals.provider value it pays
 *   label           the name staff read ("Wise")
 *   settings        the env names, said when it is not set up
 *   build(env)      the provider's client, or null when not set up. Throws
 *                   PayoutFailure("live_elsewhere") for a live key off production.
 *   balance(client, currency)          TSC's balance there, in minor units
 *   quote(client, ctx)                 { feeCents, leavesCents, receivesMinor, receivesCurrency, quote }
 *                                      fee INSIDE the amount: leavesCents <= ctx.amountCents,
 *                                      and feeCents = amountCents - what is sent in the
 *                                      withdrawal's currency (TSC pays nothing).
 *   pay(client, ctx, quote)            { ref } once the provider has it. Same ctx.key, same
 *                                      payment: a press after a timeout finds the first one.
 *   status(client, ref)                { state: "sent" | "paid" | "failed" | "cancelled",
 *                                        raw, arrivesMinor, failure }
 *   factoryQuote(client, ctx)          optional: the same shape as quote(), or null when it can't
 *                                      give the exact figure, for the factory's own preview. Read-only: it may not create
 *                                      anything at the provider (no recipient, no transfer).
 *                                      Without it, the factory sees the fee line instead.
 *
 * ctx = { amountCents, currency, key, reference, account: { id, paypalEmail,
 *         wiseRecipientId, wiseCurrency }, caller, db, cnyConfirmed, feeFor }
 * `feeFor({ provider, quotedFeeCents })` is the one fee rule
 * (src/shared/withdrawal-fees.mjs); an adapter with no quote asks it.
 *
 * Failures are PayoutFailure: `unsure` when the provider may have it (timeout),
 * certain otherwise. Never a raw provider sentence in the message.
 */

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const wiseAdapter = {
  provider: "wise",
  label: "Wise",
  settings: "WISE_API_BASE, WISE_API_TOKEN, WISE_PROFILE_ID and WISE_PAYOUT_CURRENCY",
  build: (env = process.env) => wiseFrom(env),
  async balance(wise, currency) {
    return (await wise.balance(currency)).cents;
  },
  /**
   * Wise prices from what arrives, with its fee on top. To keep the fee inside
   * the amount, quote what TSC can send for the amount and step down by the fee
   * until what leaves the balance fits (two quotes at most in practice: the fee
   * of a slightly smaller transfer is the same or smaller).
   */
  async quote(wise, ctx) {
    const recipientId = await ensureWiseRecipient({
      caller: ctx.caller, db: ctx.db, wise, accountId: ctx.account.id,
      existingId: ctx.account.wiseRecipientId, cnyConfirmed: ctx.cnyConfirmed,
    });
    let send = Number(ctx.amountCents);
    let quote = null;
    for (let tries = 0; tries < 4; tries += 1) {
      quote = await wise.quote({
        sourceCurrency: ctx.currency, targetCurrency: ctx.account.wiseCurrency ?? wise.payoutCurrency, amountCents: send, recipientId,
      });
      if (quote.totalCents <= ctx.amountCents) break;
      send -= quote.totalCents - ctx.amountCents;
      if (send <= 0) throw new PayoutFailure("too_small", "This amount is smaller than Wise's fee.");
    }
    if (quote.totalCents > ctx.amountCents) throw new PayoutFailure("quote_unavailable", CANT_PAY_FROM_BALANCE);
    if (quote.balanceRefused) throw new PayoutFailure("short_balance", "Wise says TSC's balance is too low for this.");
    // What is sent to the factory, in the withdrawal's currency, is what leaves less Wise's fee.
    const sentCents = quote.totalCents - quote.feeCents;
    return {
      feeCents: Number(ctx.amountCents) - sentCents,
      leavesCents: quote.totalCents,
      receivesMinor: quote.arrivesCents,
      receivesCurrency: quote.arrivesCurrency,
      quote: { id: quote.id, recipientId },
    };
  },
  /**
   * Exact for an account Wise already knows (a recipient made on an earlier
   * payout); otherwise an estimate, said as one. Wise prices without one too, but its fee depends on the recipient
   * (sandbox: US$3.63 without, US$9.54 with, for the same CNY account), so a
   * quote without one would show the factory the wrong fee. Creates nothing.
   */
  async factoryQuote(wise, ctx) {
    const quote = await wise.quote({
      sourceCurrency: ctx.currency, targetCurrency: ctx.account.wiseCurrency ?? wise.payoutCurrency,
      amountCents: ctx.amountCents, recipientId: ctx.account.wiseRecipientId ?? undefined,
    });
    // Without a recipient it is an estimate: the factory reads "about".
    return { feeCents: quote.feeCents, leavesCents: quote.totalCents, receivesMinor: quote.arrivesCents, receivesCurrency: quote.arrivesCurrency, quote: null, estimate: !ctx.account.wiseRecipientId };
  },
  async pay(wise, ctx, quote) {
    const transfer = await wise.createTransfer({
      recipientId: quote.quote.recipientId, quoteId: quote.quote.id, key: ctx.key, reference: ctx.reference,
    });
    const before = await wise.status(transfer.id);
    if (before.raw === "incoming_payment_waiting") {
      const funding = await wise.fund(transfer.id);
      if (!funding.funded) {
        // The transfer exists and nothing left TSC: cancel it, so the press is a clean "not sent".
        await wise.cancel(transfer.id).catch(() => null);
        throw new PayoutFailure(funding.why === "short_balance" ? "short_balance" : "refused",
          funding.why === "short_balance" ? "Wise says TSC's balance is too low for this." : "Wise didn't take the money for this transfer. Nothing was sent.",
          { detail: funding.code ?? funding.why });
      }
      await settle(1500);
    }
    return { ref: String(transfer.id) };
  },
  async status(wise, ref) {
    const status = await wise.status(ref);
    return { state: status.state === "awaiting_funding" ? "sent" : status.state ?? "sent", raw: status.raw, arrivesMinor: status.arrivesCents, failure: status.failure };
  },
};

export const paypalAdapter = {
  provider: "paypal",
  label: "PayPal",
  settings: "PAYPAL_API_BASE, PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET",
  build: (env = process.env) => paypalFrom(env),
  /** PayPal's API shows no balance to this app: null means "check in PayPal"; a short balance is PayPal's own refusal. */
  async balance(paypal, currency) {
    return typeof paypal.balance === "function" ? (await paypal.balance(currency)).cents : null;
  },
  /** PayPal charges its Payouts fee to the sender on top, so TSC sends the amount less that fee. */
  async quote(_paypal, ctx) {
    const fee = ctx.feeFor({ provider: "paypal", quotedFeeCents: null });
    if (fee.refused) throw new PayoutFailure("too_small", fee.refused);
    return { feeCents: fee.feeCents, leavesCents: null, receivesMinor: fee.receivesCents, receivesCurrency: ctx.currency, quote: null };
  },
  factoryQuote(paypal, ctx) { return paypalAdapter.quote(paypal, ctx); },
  async pay(paypal, ctx, quote) {
    const paid = await paypal.pay({
      key: ctx.key, email: ctx.account.paypalEmail, amountCents: quote.receivesMinor, currency: ctx.currency, reference: ctx.reference,
    });
    return { ref: paid.batchId };
  },
  async status(paypal, ref) {
    const status = await paypal.status(ref);
    return { state: status.state ?? "sent", raw: status.raw, arrivesMinor: null, failure: status.failure, waiting: status.waiting ?? null };
  },
};

// No "bank" adapter: TSC no longer pays a bank by hand (20261117500000). A bank
// withdrawal asked for before that is marked paid by staff (mark_withdrawal_paid_by_bank).
export const ADAPTERS = { wise: wiseAdapter, paypal: paypalAdapter };
export const registerAdapter = (adapter) => { ADAPTERS[adapter.provider] = adapter; };
