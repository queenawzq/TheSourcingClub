/**
 * Sentences of the factory's balance card and its Withdrawal methods dialog
 * (StripePayoutCard.jsx) that depend on figures, kept here so the checks can
 * run them (scripts/check-earnings.mjs).
 */
import { formatMoney } from "../../lib/money.js";
import { clearingAfterDebt } from "./payment-summary.mjs";

export const availableOnWords = (day) => `Available to withdraw on ${day}`;
/**
 * The card's pending line. `debt` is what the factory owes TSC beyond its
 * cleared earnings (uncoveredDebtCents): money clearing pays it first.
 */
export function pendingSentence(cents, debt, day) {
  const left = clearingAfterDebt(cents, debt);
  const pending = `${formatMoney(cents, "USD")} pending.`;
  if (left <= 0) return `${pending} It goes toward what you owe TSC.`;
  if (left < cents) return day ? `${pending} ${formatMoney(left, "USD")} available to withdraw on ${day}.` : `${pending} ${formatMoney(left, "USD")} can be withdrawn once processing finishes.`;
  return `${pending} ${day ? `${availableOnWords(day)}.` : "You can withdraw once processing finishes."}`;
}

const stripeDay = (unix) => new Date(unix * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Why a payout account cannot be removed now, in the factory's words, or null.
 * The provider refuses to remove a currency's default account, so where TSC
 * manages the account another one becomes the default first, and only the last
 * one in its currency stays (the dialog offers Replace). That holds even when
 * another method (PayPal, a bank TSC pays) is the factory's default, so the
 * words then say why rather than call it the only method. `otherMethods`: how
 * many saved methods the company has outside Stripe.
 */
export function stripeRemovalRefusal(method, methods, payoutsOnTheirWay, managed, otherMethods = 0) {
  const sameCurrency = methods.filter((other) => other.id !== method.id && other.currency === method.currency && other.standard !== false);
  if (methods.length <= 1) {
    if (otherMethods > 0) {
      return managed
        ? "Stripe needs one bank account or debit card on file. Replace it instead."
        : "Stripe needs one bank account or debit card on file.";
    }
    return managed ? "This is your only withdrawal method. Replace it instead." : "This is your only withdrawal method. Add another one first.";
  }
  if ((method.default || method.payoutsFor) && (!managed || !sameCurrency.length)) {
    if (!managed) return otherMethods > 0 ? "This is your default Stripe method. Make another one the default first." : "This is your default method. Make another one the default first.";
    return otherMethods > 0
      ? "Stripe needs one bank account or debit card in this currency. Replace it instead."
      : "This is your only method in its currency. Replace it instead.";
  }
  const onItsWay = payoutsOnTheirWay.find((payout) => payout.destination === method.id);
  if (onItsWay) {
    return `${formatMoney(onItsWay.amount, onItsWay.currency.toUpperCase())} is on its way to this account${onItsWay.arrival_date ? ` (${stripeDay(onItsWay.arrival_date)})` : ""}. Remove it after that.`;
  }
  return null;
}
