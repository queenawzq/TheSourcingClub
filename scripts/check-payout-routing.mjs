import assert from 'node:assert/strict';
import { releasePayment } from '../api/_stripe.js';

// No network or money movement. Exercise the release entry point rather than
// merely checking that its source mentions the preference RPC.
const payment = { id: 'payment-route-test', state: 'confirmed', amount_cents: 100,
  currency: 'USD', order_id: 'order-route-test', stripe_charge_id: 'ch_route_fake',
  release_requested_at: '2026-11-08T00:00:00Z', production_orders: { factory_org_id: 'factory-route-test' } };
function fixture(routeResult) {
  const calls = [];
  const db = {
    from(table) { return { select() { return this; }, eq() { return this; },
      async maybeSingle() { return { data: table === 'order_payments' ? payment : { stripe_account_id: 'acct_route_fake', transfers_active: true } }; } }; },
    async rpc(name, args) { calls.push(name); assert.ok(['uses_stripe_payout', 'join_owed_to_pool'].includes(name), name);
      assert.equal(args.target_org, payment.production_orders.factory_org_id); return name === 'uses_stripe_payout' ? routeResult : { data: null, error: null }; },
  };
  const stripe = { charges: { async retrieve() { return { amount_refunded: 0 }; } },
    accounts: { async update() { assert.fail('manual route must not configure a Stripe payout'); } },
    transfers: { async create() { assert.fail('manual route must never send a Stripe transfer'); } } };
  return { db, stripe, calls };
}
const manual = fixture({ data: false, error: null });
assert.deepEqual(await releasePayment({ ...manual, paymentId: payment.id }),
  { released: false, reason: 'the factory selected another payout method' });
// The default changed: the payment waits in the factory's balance for its new method.
assert.deepEqual(manual.calls, ['uses_stripe_payout', 'join_owed_to_pool']);
const unknown = fixture({ data: null, error: { message: 'preference lookup unavailable' } });
await assert.rejects(releasePayment({ ...unknown, paymentId: payment.id }), /preference lookup unavailable/);

// A transfer that reached Stripe but not our database is found however many
// others share its order, so it is recorded rather than sent a second time.
{
  const rpcs = [];
  const db = {
    from(table) { const q = { select() { return q; }, eq() { return q; },
      async maybeSingle() { return { data: table === 'order_payments' ? payment : { stripe_account_id: 'acct_route_fake', transfers_active: true } }; },
      async single() { return { data: { stripe_account_id: 'acct_route_fake', transfers_active: true } }; } }; return q; },
    async rpc(name, args) { rpcs.push([name, args]); return { data: name === 'uses_stripe_payout' ? true : name === 'claim_payment_release' ? '2026-11-08T00:00:00Z' : null }; },
  };
  const stripe = { charges: { async retrieve() { return { amount_refunded: 0 }; } }, accounts: { async update() {} },
    transfers: { list: async function* () {
      for (let i = 0; i < 100; i += 1) yield { id: `tr_other_${i}`, metadata: { payment_id: 'another-payment' } };
      // Taken back in full by staff in Stripe (no withdrawal metadata): undone.
      yield { id: 'tr_reversed', amount: 100, amount_reversed: 100, metadata: { payment_id: payment.id }, reversed: true };
      yield { id: 'tr_past_the_first_page', metadata: { payment_id: payment.id } };
    }, listReversals: async function* (id) {
      assert.equal(id, 'tr_reversed');
      yield { id: 'trr_staff', amount: 100, metadata: {} };
    }, async create() { assert.fail('a transfer already at Stripe must not be sent again'); } } };
  assert.deepEqual(await releasePayment({ db, stripe, paymentId: payment.id }), { released: true, reason: 'tr_past_the_first_page' });
  assert.deepEqual(rpcs.at(-1), ['record_payment_released', { target_payment: payment.id, transfer: 'tr_past_the_first_page' }]);
}
// The brand paid the step, the service fee and the card processing fee; the
// factory is sent the step amount only (card processing fee, Nov 13).
{
  const charged = { ...payment, amount_cents: 50000, charged_cents: 55129, fee_bps: 700, processing_fee_bps: 290, processing_fee_fixed_cents: 30 };
  const sent = [];
  const fees = [];
  const db = {
    from(table) { const q = { select() { return q; }, eq() { return q; },
      async maybeSingle() { return { data: table === 'order_payments' ? charged : { stripe_account_id: 'acct_route_fake', transfers_active: true, country: 'US' } }; },
      async single() { return { data: { stripe_account_id: 'acct_route_fake', transfers_active: true, country: 'US' } }; } }; return q; },
    async rpc(name, args) { if (name === 'record_payout_fee') fees.push(args.fee); return { data: name === 'uses_stripe_payout' ? true : name === 'claim_payment_release' ? '2026-11-08T00:00:00Z' : null }; },
  };
  const stripe = { charges: { async retrieve() { return { amount_refunded: 0 }; } }, accounts: { async update() {} },
    transfers: { list: async function* () {}, async create(args) { sent.push(args); return { id: 'tr_step_only' }; } } };
  assert.deepEqual(await releasePayment({ db, stripe, paymentId: charged.id }), { released: true, reason: 'tr_step_only' });
  assert.equal(sent.length, 1);
  // The whole step, however small: Stripe bills nothing per transfer, and its
  // payout fee is taken once, when the factory withdraws (api/_stripe-withdrawals.js).
  assert.equal(sent[0].amount, 50000, 'the factory is sent the $500.00 step in full, not the $551.29 the brand was charged');
  assert.deepEqual(fees, [], 'no per-step payout fee is recorded');
  assert.equal(sent[0].metadata.payout_fee_cents, undefined);
}
// A step smaller than Stripe's payout fee is no longer refused: it waits, in
// full, in the factory's Stripe balance until a withdrawal.
{
  const tiny = { ...payment, amount_cents: 20, charged_cents: null };
  const sent = [];
  const db = {
    from(table) { const q = { select() { return q; }, eq() { return q; },
      async maybeSingle() { return { data: table === 'order_payments' ? tiny : { stripe_account_id: 'acct_route_fake', transfers_active: true, country: 'DE' } }; },
      async single() { return { data: { stripe_account_id: 'acct_route_fake', transfers_active: true, country: 'DE' } }; } }; return q; },
    async rpc(name) { assert.notEqual(name, 'record_payout_fee'); return { data: name === 'uses_stripe_payout' ? true : name === 'claim_payment_release' ? '2026-11-17T00:00:00Z' : null }; },
  };
  const stripe = { charges: { async retrieve() { return { amount_refunded: 0 }; } }, accounts: { async update() {} },
    transfers: { list: async function* () {}, async create(args) { sent.push(args); return { id: 'tr_tiny' }; } } };
  assert.deepEqual(await releasePayment({ db, stripe, paymentId: tiny.id }), { released: true, reason: 'tr_tiny' });
  assert.equal(sent[0].amount, 20, 'a 20-cent step is sent in full');
}
// A small step's transfer reversed in full by withdrawal fees still paid the
// step: a release retried after a crash (and the factory withdrew in between)
// records it rather than paying the step again, on both release paths.
{
  const small = { ...payment, amount_cents: 20, stripe_release_started: true, release_claimed_at: '2026-11-01T00:00:00Z' };
  const feeReversed = { id: 'tr_small', amount: 20, amount_reversed: 20, reversed: true, metadata: { payment_id: small.id } };
  const stripe = { charges: { async retrieve() { return { amount_refunded: 0 }; } }, accounts: { async update() {} },
    transfers: {
      list: async function* () { yield { id: 'tr_other', metadata: { payment_id: 'another-payment' } }; yield feeReversed; },
      listReversals: async function* (id) {
        assert.equal(id, 'tr_small');
        yield { id: 'trr_fee_1', amount: 12, metadata: { stripe_withdrawal_id: 'withdrawal-1' } };
        yield { id: 'trr_fee_2', amount: 8, metadata: { stripe_withdrawal_id: 'withdrawal-2' } };
      },
      async create() { assert.fail('a step whose transfer withdrawal fees reversed must not be paid again'); } } };
  for (const usesStripe of [true, false]) {
    const rpcs = [];
    const db = {
      from(table) { const q = { select() { return q; }, eq() { return q; },
        async maybeSingle() { return { data: table === 'order_payments' ? small : { stripe_account_id: 'acct_route_fake', transfers_active: true, country: 'US' } }; },
        async single() { return { data: { stripe_account_id: 'acct_route_fake', transfers_active: true, country: 'US' } }; } }; return q; },
      async rpc(name, args) { rpcs.push([name, args]); return { data: name === 'uses_stripe_payout' ? usesStripe : name === 'claim_payment_release' ? '2026-11-17T00:00:00Z' : null }; },
    };
    assert.deepEqual(await releasePayment({ db, stripe, paymentId: small.id }), { released: true, reason: 'tr_small' });
    assert.deepEqual(rpcs.at(-1), ['record_payment_released', { target_payment: small.id, transfer: 'tr_small' }]);
    assert.ok(!rpcs.some(([name]) => name === 'record_stripe_release_not_sent'), 'never unpinned as if nothing was sent');
  }
}
console.log('payout routing: manual defaults never enter Stripe release; unreadable preference fails closed; every transfer is read; a transfer reversed by withdrawal fees is never paid again');

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
