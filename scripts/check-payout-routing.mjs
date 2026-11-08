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
console.log('payout routing: manual defaults never enter Stripe release; unreadable preference fails closed');
