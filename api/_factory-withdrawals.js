import { releasePayment } from './_stripe.js';
import { withdrawBalance } from './_stripe-payouts.js';
import { paypalPay, wisePay } from './_provider-payouts.js';

async function read(query) {
  const { data, error } = await query;
  if (error) throw new Error('Could not read the withdrawal. Try again.');
  return data;
}

/** Continue the persisted choice only. A provider failure never falls back. */
export async function processWithdrawal({ db, stripe, paypal, wise, withdrawalId }) {
  const w = await read(db.from('factory_withdrawals').select('*').eq('id', withdrawalId).single());
  if (w.status === 'paid') return { status: 'paid', amount: Number(w.amount_cents) };
  if (!w.approved_at && !w.approval_grandfathered) return { status: 'awaiting_approval', message: 'Awaiting admin approval. No money has been sent.' };
  const items = await read(db.from('factory_withdrawal_items').select('payment_id').eq('withdrawal_id', w.id));
  const started = Date.now();
  for (const item of items) {
    if (Date.now() - started > 20_000) return { status: 'processing' };
    const p = await read(db.from('order_payments').select('state, stripe_charge_id, amount_cents').eq('id', item.payment_id).single());
    if (p.state === 'released') continue;
    if (p.state !== 'confirmed') throw new Error('An earning is no longer available. Contact TSC operations.');
    // A manual refund must not finance a second payout from another provider.
    if (p.stripe_charge_id) {
      const charge = await stripe.charges.retrieve(p.stripe_charge_id);
      if (charge.refunded || charge.disputed || Number(charge.amount_refunded) > 0) {
        throw new Error('A payment needs review before it can be withdrawn. Contact TSC operations.');
      }
    }
    if (w.provider === 'stripe') {
      await releasePayment({ db, stripe, paymentId: item.payment_id });
    } else if (w.provider === 'paypal') {
      if (!paypal) throw new Error('PayPal withdrawals are temporarily unavailable. Nothing will be sent through another method.');
      await paypalPay({ paypal, db, caller: db, paymentId: item.payment_id, changedAt: w.details_changed_at });
    } else if (w.provider === 'wise') {
      if (!wise) throw new Error('Wise withdrawals are temporarily unavailable. Nothing will be sent through another method.');
      const a = await read(db.from('factory_payout_accounts').select('wise_currency').eq('id', w.account_id).single());
      const result = await wisePay({ wise, db, caller: db, paymentId: item.payment_id, changedAt: w.details_changed_at,
        cnyConfirmed: w.cny_confirmed, row: { wise_currency: a.wise_currency } });
      if (result.done === 'short_balance' || result.done === 'nothing_left') {
        throw new Error('Wise cannot fund this withdrawal yet. TSC operations needs to check the Wise balance or transfer fee. Nothing was sent through another method.');
      }
    }
  }
  const payments = await read(db.from('order_payments').select('state').in('id', items.map(i => i.payment_id)));
  if (!payments.length || payments.some(p => p.state !== 'released')) return { status: 'processing' };
  if (w.provider === 'stripe') {
    const account = await read(db.from('stripe_connect_accounts').select('stripe_account_id').eq('org_id', w.org_id).single());
    let payout;
    if (w.stripe_payout_id) {
      payout = await stripe.payouts.retrieve(w.stripe_payout_id, { stripeAccount: account.stripe_account_id });
    } else {
      // Stripe keys expire. Reconcile even a lost response before creating
      // another bank payout; metadata persists beyond the idempotency window.
      for await (const prior of stripe.payouts.list({ limit: 100 }, { stripeAccount: account.stripe_account_id })) {
        if (prior.metadata?.factory_withdrawal_id === w.id) { payout = prior; break; }
      }
      if (!payout) {
        const balance = await stripe.balance.retrieve({}, { stripeAccount: account.stripe_account_id });
        const available = balance.available.find(b => b.currency === w.currency.toLowerCase())?.amount ?? 0;
        if (available < Number(w.amount_cents)) return { status: 'processing', message: 'Waiting for Stripe funds to become available. Your chosen bank account is saved.' };
        payout = await withdrawBalance(stripe, account.stripe_account_id, { amount: Number(w.amount_cents), currency: w.currency.toLowerCase(),
          requestId: w.id, methodId: w.stripe_method_id, withdrawalId: w.id });
      }
      const saved = await db.from('factory_withdrawals').update({ stripe_payout_id: payout.id }).eq('id', w.id);
      if (saved.error) throw new Error('The withdrawal was sent but could not be recorded. Check its status before trying again.');
    }
    const destination = typeof payout.destination === 'string' ? payout.destination : payout.destination?.id;
    if (payout.amount !== Number(w.amount_cents) || payout.currency !== w.currency.toLowerCase() || destination !== w.stripe_method_id) {
      throw new Error('The bank payout needs review. Contact TSC operations before trying again.');
    }
    if (payout.status === 'failed' || payout.status === 'canceled') throw new Error('The bank withdrawal failed. Contact TSC operations. We will not send it to another account.');
    if (payout.status !== 'paid') return { status: 'processing', message: 'Your bank withdrawal is processing.' };
  }
  const saved = await db.from('factory_withdrawals').update({ status: 'paid' }).eq('id', w.id);
  if (saved.error) throw new Error('Could not update the withdrawal status. Refresh to check it.');
  return { status: 'paid', amount: Number(w.amount_cents) };
}

/** A bounded daily recovery path; only owner-created requests can be sent. */
export async function resumeWithdrawals({ db, stripe, paypal, wise }) {
  const requests = await read(db.from('factory_withdrawals').select('id').neq('status', 'paid').or('approved_at.not.is.null,approval_grandfathered.eq.true').order('created_at').limit(10));
  const started = Date.now();
  const results = [];
  for (const w of requests) {
    if (Date.now() - started > 20_000) break;
    try { results.push(await processWithdrawal({ db, stripe, paypal, wise, withdrawalId: w.id })); }
    catch { results.push({ status: 'needs_attention' }); }
  }
  return results;
}
