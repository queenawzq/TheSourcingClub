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
  // The factory asked in US dollars: the bell says the dollars it asked for
  // (less the fee, as its row does), and what its bank receives in the
  // payout's own currency.
  const entered = String(payout.currency ?? "").toLowerCase() === "usd" ? null : await enteredUsd(db, payout);
  const paidWords = entered == null ? amount : payoutAmountWords(entered, "USD");
  // What the bell already said about this payout (each notice carries its
  // id): a "paid out" that arrives after its failure is not said.
  const said = payout.id ? await saidAboutPayout(db, known.data.org_id, payout.id) : new Set();
  if (event.type === "payout.paid" && said.has("failed")) return false;
  const notice = event.type === "payout.paid"
    ? { kind: "funds_released", title: `${paidWords} paid out to your bank`, body: entered == null ? "Withdrawn from your balance." : `Withdrawn from your balance. Your bank receives ${amount}.` }
    : {
      kind: "payout_method_changed",
      title: "A withdrawal did not go through",
      body: `Your withdrawal of ${paidWords} did not go through. ${payoutFailureSentence("stripe", payout.failure_code)} The money is back in your balance.`,
    };
  const outcome = event.type === "payout.paid" ? "paid" : "failed";
  // Once per payout and outcome (its key, 20261121410000).
  const { error } = await db.from("notifications").upsert({
    org_id: known.data.org_id, ...notice,
    ...(payout.id ? { data: { payout_id: payout.id, payout: outcome }, dedupe_key: `payout:${payout.id}:${outcome}` } : {}),
  }, { onConflict: "org_id,dedupe_key", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  return true;
}

/**
 * The US cents a withdrawal took from the balance, less its fee (what its row
 * shows), for the payout it made; null when no withdrawal recorded it. Never throws.
 */
async function enteredUsd(db, payout) {
  try {
    const rowId = payout.metadata?.stripe_withdrawal_id;
    const query = db.from("stripe_withdrawals").select("usd_cents, fee_cents");
    const { data, error } = await (/^[0-9a-f-]{36}$/i.test(rowId ?? "") ? query.eq("id", rowId) : query.eq("payout_id", payout.id)).maybeSingle();
    if (error || data?.usd_cents == null) return null;
    return Number(data.usd_cents) - Number(data.fee_cents ?? 0);
  } catch {
    return null;
  }
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
