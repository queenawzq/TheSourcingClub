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
  // Stopped with nothing for the factory to give (Stripe is reviewing the
  // account): Finish setup would open a form with nothing to do in it.
  if (!due.length) {
    return {
      kind: "payout_method_changed",
      title: transfers ? "Withdrawals are paused" : "Payments to you are paused",
      // True as written: a newly due item is emailed by this same function.
      body: "Your withdrawal account is being reviewed. Your earnings are safe. We will email you if we need anything.",
    };
  }
  // The same words as the card: while earnings still arrive, what is at
  // stake is withdrawing them.
  return {
    kind: "payout_method_changed",
    title: transfers ? "Finish setup to withdraw" : "Finish setup to receive earnings",
    body: "We need a few more details for your withdrawal account. Open Payments and choose Finish setup.",
  };
}
