import { MANAGED_CONTROLLER, managedByTsc } from './_stripe-payouts.js';

const check = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
export async function connectUpgrade(db, orgId) {
  return check(await db.from('stripe_connect_upgrades').select('*').eq('org_id', orgId).maybeSingle());
}

export async function beginConnectUpgrade({ stripe, db, org, current, email }) {
  if (managedByTsc(current)) return null;
  check(await db.rpc('begin_connect_upgrade', { target_org: org.id, expected_account: current.id }));
  let upgrade = await connectUpgrade(db, org.id);
  if (upgrade.completed_at) throw new Error('This company has already upgraded. Reload the page.');
  if (!upgrade.new_account_id) {
    // Stable key prevents duplicate replacement accounts on concurrent clicks or
    // a timeout after Stripe creates it but before the database records the ID.
    // Failed creation resumes releases; retry retains this key for safety.
    let replacement;
    try {
      replacement = await stripe.accounts.create({
        country: current.country, controller: MANAGED_CONTROLLER,
        email: email || current.email || undefined,
        capabilities: { transfers: { requested: true }, card_payments: { requested: true } },
        business_profile: { name: org.name },
        metadata: { org_id: org.id, migrated_from_account_id: current.id },
        settings: { payouts: { schedule: { interval: 'manual' } } },
      }, { idempotencyKey: `connect-upgrade-${org.id}-${upgrade.started_at}` });
    } catch (failure) {
      check(await db.rpc('record_connect_upgrade_creation', { target_org: org.id, attempt: upgrade.started_at, replacement: null }));
      throw failure;
    }
    check(await db.rpc('record_connect_upgrade_creation', { target_org: org.id, attempt: upgrade.started_at, replacement: replacement.id }));
    upgrade = await connectUpgrade(db, org.id);
  }
  return upgrade;
}

export async function upgradeReadiness(stripe, upgrade) {
  if (!upgrade || upgrade.completed_at) return null;
  const replacement = upgrade.new_account_id ? await stripe.accounts.retrieve(upgrade.new_account_id) : null;
  const balance = await stripe.balance.retrieve({}, { stripeAccount: upgrade.old_account_id });
  const unsettled = [...(balance.available || []), ...(balance.pending || []), ...(balance.connect_reserved || []),
    ...(balance.instant_available || [])].some(row => row.amount !== 0);
  let inFlight = false;
  for await (const payout of stripe.payouts.list({ limit: 100 }, { stripeAccount: upgrade.old_account_id })) {
    if (['pending', 'in_transit'].includes(payout.status)) { inFlight = true; break; }
  }
  const verified = Boolean(replacement && managedByTsc(replacement) && replacement.details_submitted
    && replacement.payouts_enabled && replacement.capabilities?.transfers === 'active');
  return { replacement, verified, unsettled: unsettled || inFlight };
}

export async function finishConnectUpgrade({ stripe, db, orgId, upgrade }) {
  const ready = await upgradeReadiness(stripe, upgrade);
  if (!ready?.verified || ready.unsettled) return false;
  const a = ready.replacement;
  check(await db.rpc('finish_connect_upgrade', { target_org: orgId, replacement: a.id,
    account_country: a.country, submitted: a.details_submitted, can_pay: a.payouts_enabled,
    can_transfer: a.capabilities?.transfers === 'active', due: a.requirements?.currently_due || [] }));
  return true;
}
