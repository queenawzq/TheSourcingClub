import { callerClient, serviceClient, stripeFrom, jsonBody, reply } from './_stripe.js';
import { paypalFrom } from './_paypal.js';
import { wiseFrom } from './_wise.js';
import { processWithdrawal } from './_factory-withdrawals.js';

/** Owner-only, explicit selection. Never changes the default or funding flow. */
export default async function handler(request, response) {
  if (request.method !== 'POST') return reply(response, 405, { error: 'method not allowed' });
  const caller = callerClient(request);
  if (!caller) return reply(response, 401, { error: 'Sign in to withdraw.' });
  const { orgId, action, requestId, provider, accountId, methodId, cnyConfirmed, amount } = jsonBody(request);
  const owner = await caller.rpc('is_org_owner', { target_org: orgId });
  if (owner.error || owner.data !== true) return reply(response, 403, { error: 'Only a company owner can withdraw.' });
  const db = serviceClient();
  if (!db) return reply(response, 503, { error: 'Withdrawals are unavailable right now.' });
  try {
    if (action === 'summary') {
      const owed = await db.from('order_payments').select('id,amount_cents,currency,production_orders!inner(factory_org_id)')
        .eq('production_orders.factory_org_id', orgId).eq('state', 'confirmed').not('release_requested_at', 'is', null)
        .eq('stripe_release_started', false).is('release_claimed_at', null);
      const requests = await db.from('factory_withdrawals').select('id,provider,account_id,stripe_method_id,amount_cents,currency,status,created_at')
        .eq('org_id', orgId).neq('status', 'paid').order('created_at');
      if (owed.error || requests.error) throw new Error('Could not load available earnings.');
      const ids = (owed.data ?? []).map(p => p.id);
      const reserved = ids.length ? await db.from('factory_withdrawal_items').select('payment_id').in('payment_id', ids) : { data: [] };
      const moving = ids.length ? await db.from('provider_payouts').select('payment_id').in('payment_id', ids).in('status', ['processing', 'paid']) : { data: [] };
      if (reserved.error || moving.error) throw new Error('Could not load available earnings.');
      const taken = new Set([...reserved.data, ...moving.data].map(i => i.payment_id));
      const amount = (owed.data ?? []).filter(p => !taken.has(p.id) && p.currency === 'USD').reduce((sum,p) => sum + Number(p.amount_cents), 0);
      return reply(response, 200, { amount, currency: 'USD', requests: requests.data });
    }
    if (action !== 'withdraw' && action !== 'resume') return reply(response, 400, { error: 'Unknown withdrawal action.' });
    const stripe = stripeFrom();
    let paypal, wise;
    try { paypal = paypalFrom(); } catch { /* Report unavailability only if selected. */ }
    try { wise = wiseFrom(); } catch { /* Report unavailability only if selected. */ }
    if (action === 'withdraw') {
      if (provider === 'paypal' && !paypal || provider === 'wise' && !wise) return reply(response, 503, { error: 'The selected provider is unavailable. Nothing was sent through another method.' });
      if (provider === 'stripe') {
        const a = await db.from('stripe_connect_accounts').select('stripe_account_id').eq('org_id',orgId).single();
        if (a.error) throw new Error('Finish bank-account verification first.');
        const method = await stripe.accounts.retrieveExternalAccount(a.data.stripe_account_id, methodId);
        if (method.object !== 'bank_account' || method.currency !== 'usd' || ['errored','verification_failed'].includes(method.status)
          || !(method.available_payout_methods ?? ['standard']).includes('standard')) throw new Error('Choose a linked USD bank account.');
      }
      const saved = await caller.rpc('request_factory_withdrawal', { target_org: orgId, request_id: requestId,
        which: provider, target_account: accountId ?? null, stripe_method: methodId ?? null, confirm_cny: Boolean(cnyConfirmed), expected_amount: amount });
      if (saved.error) return reply(response, 422, { error: saved.error.message });
    }
    // Even a guessed request UUID may only resume this owner's company.
    const w = await db.from('factory_withdrawals').select('id').eq('id', requestId).eq('org_id', orgId).maybeSingle();
    if (w.error || !w.data) return reply(response, 404, { error: 'Withdrawal not found.' });
    return reply(response, 200, await processWithdrawal({ db, stripe, paypal, wise, withdrawalId: requestId }));
  } catch (failure) {
    // Provider internals can contain recipient details: don't expose or log them.
    const known = failure.kind || failure.type ? 'The selected provider could not complete the withdrawal. Refresh its status or contact TSC operations. Nothing was sent through another method.' : failure.message;
    return reply(response, 502, { error: known });
  }
}
