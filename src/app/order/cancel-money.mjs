/**
 * What happens to an order's money when it is cancelled, in one line per
 * kind of money, for the cancel dialogs and the cancelled banner.
 *
 * Read from the payments themselves, by the rules close_order and the
 * automatic refund follow (20261108300000):
 * - funded and not yet released to the factory (held, or still processing):
 *   refunded to the brand in full, fees included;
 * - released to the factory (an approved step, or a funded deposit or
 *   balance, which goes to its balance at once): the factory's; nothing of
 *   it is refunded;
 * - nothing funded yet: cancelled, nothing to say.
 *
 * The brand reads what it paid (the charged figure, fees included); the
 * factory reads the step amounts. No line names TSC.
 */
import { formatMoney } from "../../lib/money.js";
import { chargedCents } from "../../lib/domain/payment.js";
import { paymentRefund } from "./payment-summary.mjs";

const released = (p) => (p.state === "confirmed" && Boolean(p.release_requested_at)) || p.state === "released";
const toRefund = (p) => (p.state === "confirmed" && !p.release_requested_at) || p.state === "processing";
const refunded = (p) => p.state === "cancelled" && Boolean(p.refunded_at);

/** What the brand paid for a payment, fees included, less what already went back to it. */
const brandPaid = (p) => Math.max(0, chargedCents(p) - paymentRefund(p).brand);
/** What already went back to the brand from a funded payment (staff refunds, a lost dispute). */
const alreadyBack = (p, isFactory) => (["confirmed", "released"].includes(p.state)
  ? (isFactory ? Number(p.factory_refund_cents) || 0 : paymentRefund(p).brand)
  : 0);
/** The factory's part, less anything already returned to the brand from it. */
const factoryPart = (p) => Math.max(0, (Number(p.amount_cents) || 0) - (Number(p.factory_refund_cents) || 0));

/**
 * `payments`: the order's payment rows (or milestones' `.payment`).
 * `cancelled`: whether the order already is (the banner) or is about to be
 * (the dialogs). `counterparty`: the other company's name.
 * Returns an array of sentences, empty when no money was paid.
 */
export function cancelMoneyLines(payments, { isFactory, counterparty, cancelled = false, currency = "USD", language = "en" } = {}) {
  const rows = (payments ?? []).filter(Boolean);
  const sum = (list, figure) => list.reduce((total, p) => total + figure(p), 0);
  const money = (cents) => formatMoney(cents, rows[0]?.currency ?? currency);
  const figure = isFactory ? factoryPart : brandPaid;
  const zh = language === "zh";
  const other = counterparty || (zh ? (isFactory ? "品牌" : "工厂") : (isFactory ? "the brand" : "the factory"));

  const back = sum(rows.filter(toRefund), figure);
  const done = sum(rows.filter(refunded), (p) => (isFactory ? factoryPart(p) : Number(p.refunded_cents ?? 0) || chargedCents(p)))
    + sum(rows, (p) => alreadyBack(p, isFactory));
  const kept = sum(rows.filter(released), figure);
  const lines = [];

  // A factory reading Chinese: the same figures, in Chinese (the cancel dialog and banner).
  if (zh) {
    const to = counterparty ? ` ${counterparty} ` : other;
    if (done > 0) lines.push(isFactory ? `${money(done)} 已退还给${to}。` : `${money(done)} 已退还给你。`);
    if (back > 0) {
      if (cancelled) lines.push(isFactory ? `${money(back)} 正在退还给${to}。` : `${money(back)} 正在退还给你。`);
      else lines.push(isFactory ? `尚未放款步骤的 ${money(back)} 将退还给${to}。` : `你为尚未放款步骤支付的 ${money(back)} 将退还给你。`);
    }
    if (kept > 0) {
      lines.push(isFactory
        ? `已放款给你的 ${money(kept)} 仍归你所有。`
        : `你为已放款给${to}的步骤支付的 ${money(kept)} 不予退还。`);
    }
    return lines.map((line) => line.replace(/\s+(?=[。，])/g, "").replace(/^\s+/, ""));
  }

  if (done > 0) lines.push(isFactory ? `${money(done)} refunded to ${other}.` : `${money(done)} refunded to you.`);
  if (back > 0) {
    if (cancelled) lines.push(isFactory ? `${money(back)} is being refunded to ${other}.` : `${money(back)} is being refunded to you.`);
    else lines.push(isFactory
      ? `${money(back)} for steps not yet released is refunded to ${other}.`
      : `${money(back)} paid for steps not yet released is refunded to you.`);
  }
  if (kept > 0) {
    lines.push(isFactory
      ? `You keep the ${money(kept)} ${cancelled ? "" : "already "}released to you.`
      : `${money(kept)} paid for steps ${cancelled ? "" : "already "}released to ${other} is not refunded.`);
  }
  return lines;
}
