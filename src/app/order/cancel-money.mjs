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

const released = (p) => (p.state === "confirmed" && Boolean(p.release_requested_at)) || p.state === "released";
const toRefund = (p) => (p.state === "confirmed" && !p.release_requested_at) || p.state === "processing";
const refunded = (p) => p.state === "cancelled" && Boolean(p.refunded_at);

/** What the brand paid for a payment, fees included. */
const brandPaid = (p) => Number(p.charge_cents ?? p.charged_cents ?? p.amount_cents) || 0;
/** The factory's part, less anything already returned to the brand from it. */
const factoryPart = (p) => Math.max(0, (Number(p.amount_cents) || 0) - (Number(p.factory_refund_cents) || 0));

/**
 * `payments`: the order's payment rows (or milestones' `.payment`).
 * `cancelled`: whether the order already is (the banner) or is about to be
 * (the dialogs). `counterparty`: the other company's name.
 * Returns an array of sentences, empty when no money was paid.
 */
export function cancelMoneyLines(payments, { isFactory, counterparty, cancelled = false, currency = "USD" } = {}) {
  const rows = (payments ?? []).filter(Boolean);
  const sum = (list, figure) => list.reduce((total, p) => total + figure(p), 0);
  const money = (cents) => formatMoney(cents, rows[0]?.currency ?? currency);
  const figure = isFactory ? factoryPart : brandPaid;
  const other = counterparty || (isFactory ? "the brand" : "the factory");

  const back = sum(rows.filter(toRefund), figure);
  const done = sum(rows.filter(refunded), (p) => (isFactory ? factoryPart(p) : Number(p.refunded_cents ?? 0) || brandPaid(p)));
  const kept = sum(rows.filter(released), figure);
  const lines = [];

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
