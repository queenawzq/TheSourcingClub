import assert from 'node:assert/strict';
import handler from '../api/notification-emails.js';
import webhook from '../api/stripe-webhook.js';
import Stripe from 'stripe';
import { notificationEmail, notificationPath } from './generate-notification-email.mjs';
import { notificationLink } from '../src/shared/notification-link.mjs';
import { connectNeedsNotice } from '../api/_connect-needs.js';

// Exercise the real scheduler handler with a transport that never sends mail.
const saved = { ...process.env };
const fetchBefore = globalThis.fetch;
Object.assign(process.env, { SUPABASE_URL: 'http://email-tests.invalid', SUPABASE_ANON_KEY: 'test-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service', CRON_SECRET: 'test-cron', RESEND_API_KEY: 'test-resend',
  RESEND_FROM_EMAIL: 'test@example.com', VERCEL_ENV: 'production' });
const calls = [];
let queueError = false;
globalThis.fetch = async (input) => {
  const url = String(input?.url ?? input);
  calls.push(url);
  if (url.endsWith('/rpc/queue_upcoming_call_reminders')) {
    return new Response(JSON.stringify(queueError ? { message: 'test queue failure' } : 2), { status: queueError ? 500 : 200 });
  }
  if (url.endsWith('/rpc/claim_notification_emails')) return new Response('[]', { status: 200 });
  throw new Error(`Unexpected network request: ${url}`);
};
async function request(method, token) {
  let code, body;
  await handler({ method, headers: { authorization: token ? `Bearer ${token}` : '' } },
    { status(value) { code = value; return this; }, json(value) { body = value; } });
  return { code, body };
}
try {
  assert.equal((await request('GET')).code, 401);
  assert.equal((await request('GET', 'wrong')).code, 401);
  assert.equal(calls.length, 0, 'unauthenticated requests never touch the database');
  assert.equal((await request('GET', 'test-cron')).code, 200);
  assert.ok(calls[0].endsWith('/rpc/queue_upcoming_call_reminders'));
  assert.ok(calls[1].endsWith('/rpc/claim_notification_emails'), 'queue before delivery');
  queueError = true;
  assert.equal((await request('GET', 'test-cron')).code, 500, 'scheduler failure is reported');
} finally {
  globalThis.fetch = fetchBefore;
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
}

// Signed connected-account events map to the right factory lookup; unsigned
// events and platform-account payouts must never create factory alerts.
Object.assign(process.env, { SUPABASE_URL: 'http://email-tests.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-service',
  STRIPE_SECRET_KEY: 'sk_test_email', STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_email_test', STRIPE_WEBHOOK_SECRET: '',
  RESEND_API_KEY: '', MAILPIT_URL: '' });
const stripe = new Stripe('sk_test_email');
const webhookCalls = [];
globalThis.fetch = async (input, init) => {
  const url = String(input?.url ?? input);
  const body = JSON.parse(init?.body ?? '{}');
  webhookCalls.push({ url, body });
  if (url.endsWith('/rpc/claim_stripe_event')) return new Response('true', { status: 200 });
  if (url.endsWith('/rpc/notify_stripe_payout_failed') || url.includes('/stripe_events')) return new Response(null, { status: 204 });
  throw new Error(`Unexpected webhook request: ${url}`);
};
async function payoutEvent({ connected = true, valid = true } = {}) {
  const event = { id: 'evt_email', type: 'payout.failed', ...(connected ? { account: 'acct_email' } : {}),
    data: { object: { id: 'po_email', amount: 12345, currency: 'usd' } } };
  const payload = JSON.stringify(event);
  let code;
  await webhook({ method: 'POST', rawBody: Buffer.from(payload), headers: { 'stripe-signature': valid
    ? stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_email_test' }) : 'invalid' } },
    { status(value) { code = value; return this; }, json() {} });
  return code;
}
try {
  assert.equal(await payoutEvent({ valid: false }), 400);
  assert.equal(webhookCalls.length, 0, 'invalid signature cannot query the database');
  assert.equal(await payoutEvent(), 200);
  const notice = webhookCalls.find(c => c.url.endsWith('/rpc/notify_stripe_payout_failed'));
  assert.deepEqual(notice.body, { account_id: 'acct_email', payout_id: 'po_email', amount: 12345, currency_code: 'USD' });
  webhookCalls.length = 0;
  assert.equal(await payoutEvent({ connected: false }), 200);
  assert.ok(!webhookCalls.some(c => c.url.endsWith('/rpc/notify_stripe_payout_failed')), 'platform payout never alerts a factory');
} finally {
  globalThis.fetch = fetchBefore;
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
}

const env = { appUrl: 'https://app.example.com', supportEmail: 'support@example.com', companyAddress: 'New York', logoUrl: '' };
for (const locale of ['en', 'zh']) {
  for (const isFactory of [false, true]) {
    const row = { locale, org_type: isFactory ? 'factory' : 'brand', org_name: 'Example', category: 'calls',
      kind: 'call_reminder', subject_type: 'thread', subject_id: 'thread-id', title: 'Upcoming call: Fit review',
      body: 'Your accepted call starts soon.', time_zone: 'America/New_York', data: { starts_at: '2026-11-09T15:00:00Z' } };
    const email = notificationEmail(row, env);
    assert.ok(email.text.includes('/messages/thread-id'));
    assert.ok(email.text.includes('10:00 AM'), 'call time is in the recipient zone');
    assert.ok(!email.text.includes('“”'), 'new category has a label');
    assert.equal(notificationPath(row, { isFactory }), notificationLink(row, { isFactory }));
  }
  for (const kind of ['payout_failed', 'payout_action_required']) {
    const row = { locale, kind, category: 'account', org_type: 'factory', title: 'Payout needs attention', body: 'Open Payments.' };
    const email = notificationEmail(row, env);
    assert.ok(email.text.includes('/payout'));
    assert.ok(!email.text.includes('Settings'), 'mandatory notices do not offer an off switch');
    assert.equal(notificationPath(row, { isFactory: true }), notificationLink(row, { isFactory: true }));
  }
}
assert.equal(connectNeedsNotice({ requirements_due: [] }, { details_submitted: true, requirements: { currently_due: ['individual.verification.document'] }, capabilities: { transfers: 'active' }, payouts_enabled: true }).kind, 'payout_action_required');
assert.equal(connectNeedsNotice({ requirements_due: ['document'], transfers_active: true, payouts_enabled: true }, { details_submitted: true, requirements: { currently_due: ['document'] }, capabilities: { transfers: 'active' }, payouts_enabled: true }), null);
console.log('Email scheduler authentication, queue errors, links, time zones, mandatory alerts and repeated account events passed.');
