/**
 * A payout to a factory whose withdrawals are paused by a payment review is
 * refused before anything else is checked (20261125100000): staff read why,
 * not that a provider isn't set up on this site. The database refuses the
 * same anyway (withdrawal_blocker, guard_paused_payout); this only orders the
 * answer. The leading underscore keeps Vercel from serving this file.
 */
export const PAUSED_FOR_STAFF = "This factory's withdrawals are paused while a payment is reviewed (Payment reviews, in Review needed).";

/** The factory of a payment or a withdrawal; null when there is none. */
async function factoryOf(db, { paymentId = null, withdrawalId = null }) {
  if (withdrawalId) {
    const { data } = await db.from("factory_withdrawals").select("org_id").eq("id", withdrawalId).maybeSingle();
    return data?.org_id ?? null;
  }
  if (paymentId) {
    const { data } = await db.from("order_payments").select("production_orders (factory_org_id)").eq("id", paymentId).maybeSingle();
    const order = Array.isArray(data?.production_orders) ? data.production_orders[0] : data?.production_orders;
    return order?.factory_org_id ?? null;
  }
  return null;
}

/**
 * The staff sentence when this payout's factory is paused, else null. A
 * failed read answers null: the database still refuses a paused payout.
 */
export async function pausedPayoutRefusal(db, ids) {
  if (!db) return null;
  try {
    const orgId = await factoryOf(db, ids);
    if (!orgId) return null;
    const { data, error } = await db.rpc("factory_paused", { target_org: orgId });
    return !error && data === true ? PAUSED_FOR_STAFF : null;
  } catch {
    return null;
  }
}
