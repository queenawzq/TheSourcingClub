/**
 * A factory's withdrawal from its Stripe balance to its bank, as the bell says
 * it (connected-account events payout.paid and payout.failed). The money only
 * reaches the bank here: a transfer from TSC is "added to your balance"
 * (record_payment_released), and this is "paid out to your bank". A failure
 * says why in the factory's words (src/shared/payout-failure-words.mjs), never
 * Stripe's; Stripe has already put the money back in the balance.
 *
 * Returns whether a bell was written. An account TSC does not know (another
 * site's, or one replaced since) writes nothing.
 */
export async function tellPayoutEvent(db, event) {
  const payout = event.data?.object;
  if (!event.account || !payout || !["payout.paid", "payout.failed"].includes(event.type)) return false;
  const known = await db.from("stripe_connect_accounts").select("org_id")
    .eq("stripe_account_id", event.account).maybeSingle();
  if (known.error) throw new Error(known.error.message);
  if (!known.data) return false;
  // import(), not import: Vercel loads api/ as CommonJS (check:api-load).
  const { payoutAmountWords, payoutFailureSentence } = await import("../src/shared/payout-failure-words.mjs");
  const amount = payoutAmountWords(payout.amount, payout.currency);
  const notice = event.type === "payout.paid"
    ? { kind: "funds_released", title: `${amount} paid out to your bank`, body: "Withdrawn from your balance." }
    : {
      kind: "payout_method_changed",
      title: "A withdrawal did not go through",
      body: `Your withdrawal of ${amount} did not go through. ${payoutFailureSentence("stripe", payout.failure_code)} The money is back in your balance.`,
    };
  const { error } = await db.from("notifications").insert({ org_id: known.data.org_id, ...notice });
  if (error) throw new Error(error.message);
  return true;
}
