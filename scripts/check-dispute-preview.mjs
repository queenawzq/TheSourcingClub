// node scripts/check-dispute-preview.mjs: the dispute mock's transitions.
import assert from 'node:assert/strict';
import {
  initialWorld, openCase, respond, askTsc, withdraw, advance, requestResponse, recordResolution, completeResolution,
  STATUS, isOpen, withdrawalsPaused, stepOnHold, waitingOn, waitingLine, progress, addBusinessDays, START,
} from '../dispute-preview-state.mjs';

const request = { type: 'refund', amountCents: 170000 };
const opened = (w = initialWorld()) => openCase(w, 'brand', { reason: 'Quality or workmanship', stage: 'Bulk production', details: 'Collars', request });

// Deadlines skip weekends: Thursday + 2 business days is Monday.
assert.equal(new Date(addBusinessDays(START, 2)).getUTCDay(), 1);

// Opening: the factory answers, its withdrawals pause, the step is on hold.
let w = opened();
assert.equal(w.case.status, STATUS.response);
assert.equal(w.case.turn, 'factory');
assert.ok(withdrawalsPaused(w) && stepOnHold(w));
assert.equal(waitingLine(w.case, 'factory'), 'Your response is due Nov 30');
assert.equal(waitingLine(w.case, 'brand'), 'Waiting for Ningbo Loomworks · due Nov 30');
assert.equal(w.notifications.factory.length, 1);
assert.equal(w.emails.at(-1).to, 'factory');
assert.throws(() => opened(w), /already open/);
assert.throws(() => respond(w, 'brand', { action: 'reply', note: 'x' }), /not your turn/);
assert.throws(() => openCase(initialWorld(), 'brand', { reason: 'r', stage: 's', details: 'd', request: { type: 'refund', amountCents: 999999 } }), /Up to \$1,700.00/);

// Path 1: offer, accept, staff refund, resolved; withdrawals resume.
w = respond(w, 'factory', { action: 'offer', offer: { type: 'refund', amountCents: 85000 }, note: 'Half' });
assert.equal(w.case.turn, 'brand');
assert.throws(() => respond(w, 'factory', { action: 'accept' }), /not your turn/);
w = respond(w, 'brand', { action: 'accept' });
assert.equal(w.case.status, STATUS.completion);
assert.ok(withdrawalsPaused(w), 'still paused until the refund is carried out');
assert.equal(waitingOn(w.case).side, 'tsc');
w = completeResolution(w);
assert.equal(w.case.status, STATUS.resolved);
assert.equal(w.step.heldCents, 85000);
assert.equal(w.step.refundedCents, 85000);
assert.ok(!withdrawalsPaused(w) && !stepOnHold(w));
assert.equal(w.emails.filter((e) => e.kind === 'resolved').length, 2);
assert.deepEqual(progress(w.case).steps, ['Opened', 'Response', 'Resolution', 'Resolved']);

// A bank dispute keeps withdrawals paused after the case closes.
assert.ok(withdrawalsPaused({ ...w, bankDispute: true }));

// Path 2: no answer, the deadline sends it to TSC; staff ask, then decide a new date.
w = advance(opened(), 2);
assert.equal(w.case.status, STATUS.review);
assert.ok(w.case.escalated);
assert.deepEqual(progress(w.case).steps, ['Opened', 'Response', 'TSC review', 'Resolution', 'Resolved']);
w = requestResponse(w, 'factory', 'Send collar photos');
assert.equal(waitingOn(w.case).side, 'factory');
assert.equal(waitingLine(w.case, 'factory').startsWith('Your response is due'), true);
w = respond(w, 'factory', { action: 'reply', note: 'Photos attached' });
assert.equal(waitingOn(w.case).side, 'tsc');
w = recordResolution(w, { type: 'new_date', date: '2026-12-18' }, 'Rework collars');
assert.equal(w.case.status, STATUS.resolved, 'a new date applies at once');
assert.equal(w.step.due, '2026-12-18');
assert.ok(!withdrawalsPaused(w));

// Either side may ask TSC; a payout adds the held money to the balance.
w = askTsc(opened(), 'brand');
assert.equal(w.case.status, STATUS.review);
const before = w.balanceCents;
w = completeResolution(recordResolution(w, { type: 'payout' }, ''));
assert.equal(w.balanceCents - before, 170000);
assert.equal(w.step.state, 'paid_out');

// Path 3: the opener withdraws; the other side can't.
w = opened();
assert.throws(() => withdraw(w, 'factory'), /Only the side/);
w = withdraw(w, 'brand');
assert.equal(w.case.status, STATUS.withdrawn);
assert.ok(!isOpen(w.case) && !withdrawalsPaused(w));

// Cancel refunds what is held and cancels the order.
w = completeResolution(recordResolution(opened(), { type: 'cancel' }, ''));
assert.equal(w.order, 'cancelled');
assert.equal(w.step.heldCents, 0);

console.log('Dispute preview flow checks pass.');
