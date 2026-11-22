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
  // Where a withdrawal's payout is, for the company's list (its members read
  // stripe_withdrawals). Best effort: the bell below matters more.
  try {
    const { payoutFields } = await import("./_stripe-withdrawals.js");
    const marked = await db.from("stripe_withdrawals").update(payoutFields(payout)).eq("payout_id", payout.id);
    if (marked?.error) console.error("payout status not recorded", payout.id, marked.error.message);
    // Stripe can say so before the withdrawal has saved its payout id (in
    // test mode a payout is paid at once): the payout carries the row's id.
    // Only a row of this account with no payout yet; the call that made the
    // payout then saves its id and keeps this status (recordPayoutMade).
    const rowId = payout.metadata?.stripe_withdrawal_id;
    if (/^[0-9a-f-]{36}$/i.test(rowId ?? "")) {
      const early = await db.from("stripe_withdrawals").update(payoutFields(payout))
        .eq("id", rowId).eq("stripe_account_id", event.account).is("payout_id", null);
      if (early?.error) console.error("payout status not recorded", payout.id, early.error.message);
    }
  } catch (failure) {
    console.error("payout status not recorded", payout.id, failure?.message);
  }
  const known = await db.from("stripe_connect_accounts").select("org_id")
    .eq("stripe_account_id", event.account).maybeSingle();
  if (known.error) throw new Error(known.error.message);
  if (!known.data) return false;
  // import(), not import: Vercel loads api/ as CommonJS (check:api-load).
  const { payoutAmountWords, payoutFailureSentence } = await import("../src/shared/payout-failure-words.mjs");
  const amount = payoutAmountWords(payout.amount, payout.currency);
  // What the bell already said about this payout (each notice carries its
  // id): a failure after "paid out" says it did not reach the bank after
  // all, and a "paid out" that arrives after its failure is not said.
  const said = payout.id ? await saidAboutPayout(db, known.data.org_id, payout.id) : new Set();
  if (event.type === "payout.paid" && said.has("failed")) return false;
  const notice = event.type === "payout.paid"
    ? { kind: "funds_released", title: `${amount} paid out to your bank`, body: "Withdrawn from your balance." }
    : {
      kind: "payout_method_changed",
      title: "A withdrawal did not go through",
      body: `Your withdrawal of ${amount} ${said.has("paid") ? "did not reach your bank after all" : "did not go through"}. ${payoutFailureSentence("stripe", payout.failure_code)} The money is back in your balance.`,
    };
  const outcome = event.type === "payout.paid" ? "paid" : "failed";
  // Once per payout and outcome (its key, 20261121390000).
  const { error } = await db.from("notifications").upsert({
    org_id: known.data.org_id, ...notice,
    ...(payout.id ? { data: { payout_id: payout.id, payout: outcome }, dedupe_key: `payout:${payout.id}:${outcome}` } : {}),
  }, { onConflict: "org_id,dedupe_key", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  return true;
}

/** "paid" and/or "failed": the notices this company was already sent about this payout, by their keys. Never throws. */
async function saidAboutPayout(db, orgId, payoutId) {
  try {
    const { data, error } = await db.from("notifications").select("dedupe_key")
      .eq("org_id", orgId).in("dedupe_key", [`payout:${payoutId}:paid`, `payout:${payoutId}:failed`]);
    if (error) return new Set();
    return new Set((data ?? []).map((row) => String(row.dedupe_key).split(":").pop()));
  } catch {
    return new Set();
  }
}
