import { ensureWiseRecipient } from "./_wise-recipient.js";
import { PayoutFailure } from "./_payout-provider.js";
import { CANT_PAY_FROM_BALANCE, wiseFrom } from "./_wise.js";
import { paypalFrom } from "./_paypal.js";
import { tazapayFrom } from "./_tazapay.js";
import { ensureTazapayBeneficiary } from "./_tazapay-beneficiary.js";
import { withdrawalInvoicePath, withdrawalInvoicePdf } from "./_tazapay-invoice.js";
import {
  TAZAPAY_KEY_MEMORY_MS, invoiceKeptAt, keepAndUploadInvoice, payoutBody, quoteTazapayPayout, tazapayAccountProblems,
} from "./_tazapay-pay.js";

/**
 * One adapter per way a withdrawal leaves TSC. The core (api/_withdrawals.js)
 * owns the state machine, the database and the fee rule; an adapter only talks
 * to its provider. Adding a provider (Tazapay) is one more entry here, with no
 * change to the core:
 *
 *   provider        the factory_withdrawals.provider value it pays
 *   label           the name staff read ("Wise")
 *   settings        the env names, said when it is not set up
 *   manual          true: staff send it themselves and mark it paid (no client)
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
 * ctx = { amountCents, currency, key, reference, withdrawalId, orgId, resumed,
 *         account: { id, paypalEmail, wiseRecipientId, wiseCurrency }, caller, db,
 *         cnyConfirmed, feeFor }
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

/**
 * Tazapay: factories banking in mainland China (CNY over CNAPS) and Hong Kong
 * (HKD over CHATS). One payout per withdrawal, with one invoice listing every
 * order step it pays. Shares the account check, the quote, the invoice and the
 * payout's body with Pay with Tazapay (api/_tazapay-pay.js).
 *
 * The factory's fee is the fixed placeholder (src/shared/withdrawal-fees.mjs):
 * the payout carries amount − US$5.00, and Tazapay's own fee leaves TSC's
 * balance on top. A Tazapay fee above US$5.00 (the sandbox's US$5.44 to China)
 * is TSC's until the fee switches to Tazapay's quote before going live, so this
 * adapter may leave a little more than the amount (`placeholderFee`).
 */
const TAZAPAY_FAILED = {
  details: "Your bank didn't accept this payout. Check your bank details, then withdraw again.",
  retry: "This payout couldn't be completed, and nothing reached your bank. You can withdraw again.",
  staff: "This payout couldn't be completed, and nothing reached your bank. Contact TSC support before withdrawing again.",
  cancelled: "This payout was cancelled before it was sent, and nothing reached your bank.",
  reversed: "This payout was returned after it was sent. Contact TSC support before withdrawing again.",
};
const LOST_TAZAPAY_WITHDRAWAL = "Tazapay's answer to the first approval was lost more than a day ago, so approving again could pay twice. Check Tazapay for a payout with this withdrawal's reference before doing anything else.";
const NOT_USD = (currency) => `Tazapay pays from TSC's USD balance, and this withdrawal is in ${currency}.`;

/**
 * The steps this withdrawal pays, for its invoice: the database's own list
 * (withdrawal_invoice_steps(), the order release_withdrawn_payments() releases
 * them in), so with several withdrawals open the invoice names what is released.
 */
async function tazapayWithdrawalSteps(db, ctx) {
  const unlisted = new PayoutFailure("invoice", "The order steps this withdrawal pays couldn't be listed for its invoice, so nothing was sent. Reload the board and approve again.");
  const listed = await db.rpc("withdrawal_invoice_steps", { target_withdrawal: ctx.withdrawalId });
  if (listed.error) throw unlisted;
  const steps = (listed.data ?? []).map((row) => ({
    id: row.payment_id, orderNumber: row.order_number ?? "", stepTitle: row.step_title ?? "", amountMinor: Number(row.amount_cents),
  }));
  // An invoice that doesn't add up to the withdrawal is never sent.
  if (!steps.length || steps.reduce((sum, step) => sum + step.amountMinor, 0) !== ctx.amountCents) throw unlisted;
  return steps;
}

function tazapayShape(ctx, asked, extra) {
  if (asked.refused) throw new PayoutFailure(asked.kind, asked.refused);
  const { quote, fee } = asked;
  return {
    feeCents: fee.feeCents,
    leavesCents: quote.totalMinor,
    receivesMinor: quote.payoutMinor,
    receivesCurrency: quote.payoutCurrency,
    quote: { ...extra, tazapay: quote },
  };
}

export const tazapayAdapter = {
  provider: "tazapay",
  label: "Tazapay",
  settings: "TAZAPAY_BASE_URL, TAZAPAY_API_KEY and TAZAPAY_API_SECRET",
  placeholderFee: true,
  build: (env = process.env) => tazapayFrom(env),
  async balance(tazapay, currency) {
    return tazapay.available(currency);
  },
  async quote(tazapay, ctx) {
    if (ctx.currency !== "USD") throw new PayoutFailure("refused", NOT_USD(ctx.currency));
    const { account, problems, sentence, route } = await tazapayAccountProblems(ctx.db, ctx.account.id, ", tazapay_beneficiary_id");
    if (problems.length) throw new PayoutFailure("details_missing", sentence, { fields: problems.map((p) => p.field) });
    const beneficiary = await ensureTazapayBeneficiary({
      caller: ctx.caller, db: ctx.db, tazapay, accountId: account.id, existingId: account.tazapay_beneficiary_id,
    });
    const asked = await quoteTazapayPayout({ tazapay, amountMinor: ctx.amountCents, currency: ctx.currency, route, country: route.country });
    return tazapayShape(ctx, asked, { beneficiary, route, payeeName: account.account_name });
  },
  /** Read-only: no payee, no payout. Null (the fee line instead) when the account can't be paid yet. */
  async factoryQuote(tazapay, ctx) {
    if (ctx.currency !== "USD") return null;
    const { problems, route } = await tazapayAccountProblems(ctx.db, ctx.account.id);
    if (problems.length) return null;
    const asked = await quoteTazapayPayout({ tazapay, amountMinor: ctx.amountCents, currency: ctx.currency, route, country: route.country });
    return { ...tazapayShape(ctx, asked, {}), quote: null, estimate: false };
  },
  async pay(tazapay, ctx, quote, { now = () => new Date() } = {}) {
    const { beneficiary, route, payeeName, tazapay: q } = quote.quote;
    const path = withdrawalInvoicePath(ctx.withdrawalId, ctx.key);
    // A press after one whose answer was lost: the same key finds its payout, but
    // only while Tazapay remembers the key. The invoice was kept at the first press.
    if (ctx.resumed) {
      const first = await invoiceKeptAt(ctx.db, path);
      if (first && now() - first > TAZAPAY_KEY_MEMORY_MS) throw new PayoutFailure("key_expired", LOST_TAZAPAY_WITHDRAWAL, { unsure: true });
    }
    const steps = await tazapayWithdrawalSteps(ctx.db, ctx);
    const short = String(ctx.withdrawalId).slice(0, 8);
    const reference = `TSC-W-${short}`;
    const bytes = withdrawalInvoicePdf({
      reference, issuedOn: now().toISOString().slice(0, 10), payeeName, steps,
      amountMinor: ctx.amountCents, currency: ctx.currency, payoutMinor: q.payoutMinor, payoutCurrency: q.payoutCurrency, rate: q.rate,
    });
    const documentUrl = await keepAndUploadInvoice({ db: ctx.db, tazapay, path, fileName: `${reference}.pdf`, bytes });
    const orders = [...new Set(steps.map((s) => s.orderNumber).filter(Boolean))];
    const payout = await tazapay.createPayout(payoutBody({
      beneficiary, quote: q, route, currency: ctx.currency, documentUrl,
      referenceId: `tsc-w-${ctx.withdrawalId}`,
      description: `Advance payment for goods, production order${orders.length > 1 ? "s" : ""} ${orders.join(", ")}`,
      descriptor: `TSC ${reference.slice(4)}`,
    }), `tsc-${ctx.key}`);
    if (!payout?.id) throw new PayoutFailure("unknown", "Tazapay answered without a payout. Press again: it can't pay twice.", { unsure: true });
    return { ref: payout.id };
  },
  /** What the factory reads on a failure is TSC's sentence by who must act, never Tazapay's. */
  async status(tazapay, ref) {
    const s = await tazapay.status(ref);
    if (s.state === "paid") return { state: "paid", raw: s.raw, arrivesMinor: s.arrivesCents, failure: null };
    if (s.state === "failed" || s.state === "cancelled") {
      const which = s.raw === "cancelled" ? "cancelled" : s.raw === "reversed" ? "reversed" : s.route ?? "staff";
      return { state: s.state, raw: s.raw, arrivesMinor: null, failure: TAZAPAY_FAILED[which] ?? TAZAPAY_FAILED.staff, code: s.code ?? null };
    }
    return { state: "sent", raw: s.raw, arrivesMinor: null, failure: null, waiting: s.waiting ?? null };
  },
};

/** Staff send it by bank themselves, then mark it paid with the bank's reference (an RPC). */
export const bankAdapter = {
  provider: "bank",
  label: "Bank transfer",
  manual: true,
  settings: "",
  build: () => null,
};

export const ADAPTERS = { wise: wiseAdapter, paypal: paypalAdapter, tazapay: tazapayAdapter, bank: bankAdapter };
export const registerAdapter = (adapter) => { ADAPTERS[adapter.provider] = adapter; };
