import assert from 'node:assert/strict';
import { settleRelease } from '../api/_stripe.js';

// No network or money movement. Nothing transfers a step on approval any more
// (the old releasePayment() is gone, round 36): only a release an earlier
// version started is settled, and it never creates a transfer.
const payment = { id: 'payment-route-test', state: 'confirmed', amount_cents: 100,
  currency: 'USD', order_id: 'order-route-test', stripe_charge_id: 'ch_route_fake', stripe_release_started: true,
  release_requested_at: '2026-11-08T00:00:00Z', production_orders: { factory_org_id: 'factory-route-test' } };
const noCreate = async () => assert.fail('settling a started release never sends a transfer');

// A transfer that reached Stripe but not our database is found however many
// others share its order, so it is recorded rather than sent a second time.
{
  const rpcs = [];
  const db = {
    from() { const q = { select() { return q; }, eq() { return q; }, async maybeSingle() { return { data: payment, error: null }; } }; return q; },
    async rpc(name, args) { rpcs.push([name, args]); return { data: null, error: null }; },
  };
  const stripe = { transfers: { list: async function* () {
      for (let i = 0; i < 100; i += 1) yield { id: `tr_other_${i}`, metadata: { payment_id: 'another-payment' } };
      // Taken back in full by staff in Stripe (no withdrawal metadata): undone.
      yield { id: 'tr_reversed', amount: 100, amount_reversed: 100, metadata: { payment_id: payment.id }, reversed: true };
      yield { id: 'tr_past_the_first_page', amount: 100, metadata: { payment_id: payment.id } };
    }, listReversals: async function* (id) {
      assert.equal(id, 'tr_reversed');
      yield { id: 'trr_staff', amount: 100, metadata: {} };
    }, create: noCreate } };
  assert.deepEqual(await settleRelease({ db, stripe, paymentId: payment.id }), { released: true, reason: 'tr_past_the_first_page' });
  assert.deepEqual(rpcs.at(-1), ['record_payment_released', { target_payment: payment.id, transfer: 'tr_past_the_first_page' }]);
}
// A small step's transfer reversed in full by withdrawal fees still paid the
// step: it is recorded, never unpinned as if nothing was sent.
{
  const small = { ...payment, amount_cents: 20, release_claimed_at: '2026-11-01T00:00:00Z' };
  const feeReversed = { id: 'tr_small', amount: 20, amount_reversed: 20, reversed: true, metadata: { payment_id: small.id } };
  const stripe = { transfers: {
      list: async function* () { yield { id: 'tr_other', metadata: { payment_id: 'another-payment' } }; yield feeReversed; },
      listReversals: async function* (id) {
        assert.equal(id, 'tr_small');
        yield { id: 'trr_fee_1', amount: 12, metadata: { stripe_withdrawal_id: 'withdrawal-1' } };
        yield { id: 'trr_fee_2', amount: 8, metadata: { stripe_withdrawal_id: 'withdrawal-2' } };
      },
      create: noCreate } };
  const rpcs = [];
  const db = {
    from() { const q = { select() { return q; }, eq() { return q; }, async maybeSingle() { return { data: small, error: null }; } }; return q; },
    async rpc(name, args) { rpcs.push([name, args]); return { data: null, error: null }; },
  };
  assert.deepEqual(await settleRelease({ db, stripe, paymentId: small.id }), { released: true, reason: 'tr_small' });
  assert.deepEqual(rpcs.at(-1), ['record_payment_released', { target_payment: small.id, transfer: 'tr_small' }]);
  assert.ok(!rpcs.some(([name]) => name === 'record_stripe_release_not_sent'), 'never unpinned as if nothing was sent');
}
// The dead whole-step transfer is gone, and nothing calls it.
{
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../api/_stripe.js', import.meta.url), 'utf8');
  assert.ok(!/export async function releasePayment\b/.test(source), 'releasePayment() is removed');
  assert.ok(!/claim_payment_release/.test(source), 'nothing in the server claims a whole-step release');
}
console.log('payout routing: a started release is settled without a new transfer; every transfer is read; a transfer reversed by withdrawal fees is never paid again');

// One list of the countries Stripe pays out to: the app's, the server's and the
// database's (20261119300000: PayPal "where Stripe isn't available").
{
  const { readFileSync, readdirSync } = await import('node:fs');
  const { PAYOUT_COUNTRIES } = await import('../src/shared/stripe-payout-countries.mjs');
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const latest = readdirSync(dir).filter((name) => name.endsWith('.sql')).sort().reverse()
    .map((name) => readFileSync(new URL(name, dir), 'utf8')).find((sql) => sql.includes('function public.stripe_pays_out_to'));
  assert.ok(latest, 'stripe_pays_out_to() exists');
  const lists = [...latest.matchAll(/array\[\s*('[A-Z]{2}'(?:,\s*'[A-Z]{2}')*)\s*\]/g)].map((m) => new Set(m[1].match(/[A-Z]{2}/g)));
  assert.ok(lists.length >= 2, 'the function and payout_providers_for() both carry the list');
  for (const list of lists) assert.deepEqual([...list].sort(), [...PAYOUT_COUNTRIES].sort(), 'the database lists the same Stripe payout countries as the app');
}

// The screens follow "Any country Stripe can't pay" (Nov 19 test): the answer of
// payout_providers_for() goes through providersFrom() with every key it sends,
// and the chooser and Withdraw then offer PayPal where the database allows it.
{
  const { providersFrom, providerOnFor, methodProviderOn } = await import('../src/app/order/payout-provider-rules.mjs');
  const { PAYOUT_COUNTRIES } = await import('../src/shared/stripe-payout-countries.mjs');
  const answer = { region: 'elsewhere', paypal: false, wise: false, chinaCountries: ['CN', 'HK'],
    byRegion: { china: { paypal: true, wise: false }, elsewhere: { paypal: false, wise: false } },
    paypalWhereNoStripe: true, stripeCountries: [...PAYOUT_COUNTRIES] };
  const providers = providersFrom(answer);
  assert.equal(providers.paypalWhereNoStripe, true, 'the switch reaches the screens');
  assert.deepEqual(providers.stripeCountries, answer.stripeCountries, 'and the country list');
  assert.equal(providerOnFor(providers, 'paypal', 'VN'), true, 'Vietnam is offered PayPal');
  assert.equal(providerOnFor(providers, 'paypal', 'TR'), true, 'Türkiye too');
  assert.equal(providerOnFor(providers, 'paypal', 'ZZ'), true, 'and a country not listed');
  assert.equal(providerOnFor(providers, 'paypal', 'DE'), false, 'Germany is not: Stripe pays it');
  assert.equal(providerOnFor(providers, 'paypal', 'CN'), true, 'China by its own box');
  assert.equal(providerOnFor(providers, 'wise', 'VN'), false, 'Wise is not turned on by it');
  assert.equal(methodProviderOn(providers, { method: 'paypal', paypal_email: 'x@example.com', payout_country: 'VN' }), true, 'a saved Vietnam PayPal stays in Withdraw');
  assert.equal(providerOnFor(providersFrom({ ...answer, paypalWhereNoStripe: false }), 'paypal', 'VN'), false, 'off: nothing changes');
  // The hook must use providersFrom, not a hand-picked copy of the keys.
  const hook = (await import('node:fs')).readFileSync(new URL('../src/app/order/payout-providers.js', import.meta.url), 'utf8');
  assert.ok(/setProviders\(providersFrom\(data\)\)/.test(hook), 'usePayoutProviders shapes the answer with providersFrom');
}
