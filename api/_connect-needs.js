/**
 * When Stripe starts needing something from a factory's payout account, the
 * factory is told by email (Queena, Nov 6: "they should get it through
 * email"). TSC collects requirements on the accounts it manages, so Stripe
 * does not contact those factories itself: nobody would.
 *
 * `before` is our stored row (or null), `account` is Stripe's account from
 * account.updated. Only a change is said: the same state sent again, or an
 * account still in its first setup, says nothing. No word here names Stripe.
 */
export function connectNeedsNotice(before, account) {
  if (!account?.details_submitted) return null;
  const due = account.requirements?.currently_due ?? [];
  const known = new Set(before?.requirements_due ?? []);
  const newlyDue = due.some(item => !known.has(item));
  const transfers = account.capabilities?.transfers === "active";
  const transfersStopped = Boolean(before?.transfers_active) && !transfers;
  const payoutsStopped = Boolean(before?.payouts_enabled) && !account.payouts_enabled;
  if (!newlyDue && !transfersStopped && !payoutsStopped) return null;
  // Earnings still arrive and only withdrawing is stopped: say exactly that.
  const onlyWithdrawals = transfers && !account.payouts_enabled;
  return {
    kind: "payout_method_changed",
    title: onlyWithdrawals ? "Finish setup to withdraw" : "Finish setup to receive earnings",
    body: "We need a few more details for your withdrawal account. Open Payments and choose Finish setup.",
  };
}
