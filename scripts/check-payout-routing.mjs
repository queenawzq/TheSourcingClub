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
    async rpc(name, args) { calls.push(name); assert.equal(name, 'uses_stripe_payout');
      assert.equal(args.target_org, payment.production_orders.factory_org_id); return routeResult; },
  };
  const stripe = { charges: { async retrieve() { return { amount_refunded: 0 }; } },
    accounts: { async update() { assert.fail('manual route must not configure a Stripe payout'); } },
    transfers: { async create() { assert.fail('manual route must never send a Stripe transfer'); } } };
  return { db, stripe, calls };
}
const manual = fixture({ data: false, error: null });
assert.deepEqual(await releasePayment({ ...manual, paymentId: payment.id }),
  { released: false, reason: 'the factory selected another payout method' });
assert.deepEqual(manual.calls, ['uses_stripe_payout']);
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
      yield { id: 'tr_reversed', metadata: { payment_id: payment.id }, reversed: true };
      yield { id: 'tr_past_the_first_page', metadata: { payment_id: payment.id } };
    }, async create() { assert.fail('a transfer already at Stripe must not be sent again'); } } };
  assert.deepEqual(await releasePayment({ db, stripe, paymentId: payment.id }), { released: true, reason: 'tr_past_the_first_page' });
  assert.deepEqual(rpcs.at(-1), ['record_payment_released', { target_payment: payment.id, transfer: 'tr_past_the_first_page' }]);
}
// The brand paid the step, the service fee and the card processing fee; the
// factory is sent the step amount only (card processing fee, Nov 13).
{
  const charged = { ...payment, amount_cents: 50000, charged_cents: 55129, fee_bps: 700, processing_fee_bps: 290, processing_fee_fixed_cents: 30 };
  const sent = [];
  const db = {
    from(table) { const q = { select() { return q; }, eq() { return q; },
      async maybeSingle() { return { data: table === 'order_payments' ? charged : { stripe_account_id: 'acct_route_fake', transfers_active: true } }; },
      async single() { return { data: { stripe_account_id: 'acct_route_fake', transfers_active: true } }; } }; return q; },
    async rpc(name) { return { data: name === 'uses_stripe_payout' ? true : name === 'claim_payment_release' ? '2026-11-08T00:00:00Z' : null }; },
  };
  const stripe = { charges: { async retrieve() { return { amount_refunded: 0 }; } }, accounts: { async update() {} },
    transfers: { list: async function* () {}, async create(args) { sent.push(args); return { id: 'tr_step_only' }; } } };
  assert.deepEqual(await releasePayment({ db, stripe, paymentId: charged.id }), { released: true, reason: 'tr_step_only' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].amount, 50000, 'the factory is sent the $500.00 step, not the $551.29 the brand was charged');
}
console.log('payout routing: manual defaults never enter Stripe release; unreadable preference fails closed; every transfer is read');
