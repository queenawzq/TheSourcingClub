// node scripts/check-dispute-preview.mjs: the dispute mock's transitions and its walkthrough.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  initialWorld, openCase, respond, askForReview, withdraw, advance, requestResponse, recordResolution, completeResolution,
  releaseOtherPayments, approveStep, STATUS, isOpen, withdrawalsPaused, stepOnHold, waitingOn, waitingLine, windowLine, progress,
  addBusinessDays, day, START,
} from '../dispute-preview-state.mjs';
import { STEPS, worldAt } from '../dispute-preview-steps.mjs';

const request = { type: 'refund', amountCents: 170000 };
const opened = (w = initialWorld()) => openCase(w, 'brand', { reason: 'Quality or workmanship', stage: 'Bulk production', details: 'Collars', request });

// Deadlines skip weekends: Thursday + 2 business days is Monday.
assert.equal(new Date(addBusinessDays(START, 2)).getUTCDay(), 1);

// Opening: the factory answers by Nov 30; review starts Dec 3 (5 business days) if not settled.
let w = opened();
assert.equal(w.case.status, STATUS.response);
assert.equal(w.case.turn, 'factory');
assert.ok(withdrawalsPaused(w) && stepOnHold(w));
assert.equal(waitingLine(w.case, 'factory'), 'Your response is due Nov 30');
assert.equal(waitingLine(w.case, 'brand'), 'Waiting for Ningbo Loomworks · due Nov 30');
assert.equal(windowLine(w.case), 'Review starts Dec 3 if not settled');
assert.equal(w.notifications.factory.length, 1);
assert.equal(w.emails.at(-1).to, 'factory');
assert.throws(() => opened(w), /already open/);
assert.throws(() => respond(w, 'brand', { action: 'reply', note: 'x' }), /not your turn/);
assert.throws(() => openCase(initialWorld(), 'brand', { reason: 'r', stage: 's', details: 'd', request: { type: 'refund', amountCents: 999999 } }), /Up to \$1,700.00/);

// Path 1: offer, accept, staff refund, resolved; withdrawals resume.
w = respond(advance(w, 1), 'factory', { action: 'offer', offer: { type: 'refund', amountCents: 85000 }, note: 'Half' });
assert.equal(w.case.turn, 'brand');
assert.equal(day(w.case.dueAt), 'Dec 1', 'each answer gives the other side 2 business days');
assert.throws(() => respond(w, 'factory', { action: 'accept' }), /not your turn/);
w = respond(w, 'brand', { action: 'accept' });
assert.equal(w.case.status, STATUS.completion);
assert.ok(withdrawalsPaused(w), 'still paused until the refund is carried out');
assert.equal(waitingOn(w.case).side, 'staff');
w = completeResolution(w);
assert.equal(w.case.status, STATUS.resolved);
assert.equal(w.step.heldCents, 85000);
assert.equal(w.step.refundedCents, 85000);
assert.ok(!withdrawalsPaused(w) && !stepOnHold(w));
assert.equal(w.emails.filter((e) => e.kind === 'resolved').length, 2);
assert.deepEqual(progress(w.case).steps, ['Opened', 'Response', 'Resolution', 'Resolved']);
// The remaining funded money is approved as usual.
const beforeApprove = w.balanceCents;
w = approveStep(w);
assert.equal(w.balanceCents - beforeApprove, 85000);
assert.equal(w.step.state, 'approved');

// A bank dispute keeps withdrawals paused after the case closes.
assert.ok(withdrawalsPaused({ ...w, bankDispute: true }));

// The negotiation window: answers keep the turn at 2 business days, capped at 5 from opening.
w = opened();                                                                    // Thu Nov 26
w = respond(advance(w, 1), 'factory', { action: 'reply', note: 'a' });           // Fri Nov 27
assert.equal(day(w.case.dueAt), 'Dec 1');
w = respond(advance(w, 1), 'brand', { action: 'reply', note: 'b' });             // Mon Nov 30
assert.equal(day(w.case.dueAt), 'Dec 2');
w = respond(advance(w, 2), 'factory', { action: 'reply', note: 'c' });           // Wed Dec 2
assert.equal(day(w.case.dueAt), 'Dec 3', 'capped at the window, not Dec 4');
assert.equal(w.case.dueAt, w.case.windowEndsAt);
w = advance(w, 1);                                                               // Thu Dec 3: still open all day
assert.equal(w.case.status, STATUS.response);
w = advance(w, 1);                                                               // Fri Dec 4
assert.equal(w.case.status, STATUS.review, 'the window ended without agreement');
assert.equal(w.case.events.at(-1).detail, 'No agreement by Dec 3');
assert.equal(w.emails.filter((e) => e.kind === 'review').length, 2);

// Path 2: no answer, the deadline sends it to review; staff ask, then decide rework by a new date.
w = advance(opened(), 1);
assert.equal(w.case.status, STATUS.response, 'Nov 30 is still answerable on Nov 27');
w = advance(w, 2);
assert.equal(w.case.status, STATUS.review);
assert.equal(w.case.events.at(-1).detail, 'No answer by Nov 30');
assert.ok(w.case.escalated);
assert.deepEqual(progress(w.case).steps, ['Opened', 'Response', 'Review', 'Resolution', 'Resolved']);
w = requestResponse(w, 'factory', 'Send collar photos');
assert.equal(waitingOn(w.case).side, 'factory');
assert.equal(waitingLine(w.case, 'factory').startsWith('Your response is due'), true);
w = respond(w, 'factory', { action: 'reply', note: 'Photos attached' });
assert.equal(waitingOn(w.case).side, 'staff');
w = recordResolution(w, { type: 'rework', date: '2026-12-18' }, 'Rework collars');
assert.equal(w.case.status, STATUS.resolved, 'rework by a new date applies at once');
assert.equal(w.step.due, '2026-12-18');
assert.equal(w.step.state, 'rework', 'the step reopens, unapproved');
assert.equal(w.step.heldCents, 170000, 'its money stays funded until the brand approves');
assert.ok(!withdrawalsPaused(w) && !stepOnHold(w));
w = approveStep(w);
assert.equal(w.step.state, 'approved');

// Either side may ask for review; a payout adds the held money to the balance.
w = askForReview(opened(), 'brand');
assert.equal(w.case.status, STATUS.review);
const before = w.balanceCents;
w = completeResolution(recordResolution(w, { type: 'payout' }, ''));
assert.equal(w.balanceCents - before, 170000);
assert.equal(w.step.state, 'paid_out');

// Release other payments: the pause lifts, the disputed step stays on hold, staff-only on the timeline.
w = opened();
assert.ok(withdrawalsPaused(w), 'the whole balance is paused by default');
w = releaseOtherPayments(w, 'Factory needs to pay its mill');
assert.ok(!withdrawalsPaused(w));
assert.ok(stepOnHold(w));
assert.throws(() => approveStep(w), /On hold/);
assert.equal(w.case.events.at(-1).staffOnly, true);
assert.equal(w.notifications.factory[0].title, 'You can withdraw your balance again');
assert.throws(() => releaseOtherPayments(w), /already released/);
assert.ok(withdrawalsPaused({ ...w, bankDispute: true }), 'a bank dispute still pauses');

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

// Dispute emails go out whatever the company's email settings: nothing in the state reads them.
const quiet = { ...initialWorld(), emailSettings: { brand: { payments: false }, factory: { payments: false } } };
assert.equal(opened(quiet).emails.length, 1);

// The walkthrough: every step replays to the same world, whatever came before.
const snapshot = (i) => JSON.stringify(worldAt(i));
for (let i = 0; i < STEPS.length; i++) assert.equal(snapshot(i), snapshot(i), `step ${i + 1} replays the same`);
assert.equal(JSON.stringify(worldAt(STEPS.length - 1)), JSON.stringify(worldAt(STEPS.length - 1)));
const order = [...STEPS.keys()].reverse().map(snapshot);
assert.deepEqual(order.reverse(), [...STEPS.keys()].map(snapshot), 'order of visits does not matter');
for (const [i, s] of STEPS.entries()) {
  assert.ok(['brand', 'factory', 'admin', 'emails'].includes(s.view), `step ${i + 1} view`);
  assert.ok(s.caption && !/\bTSC\b/.test(s.caption), `step ${i + 1} caption has no TSC`);
  const pw = worldAt(i);
  if (['case', 'adminCase'].includes(s.page)) assert.ok(pw.case, `step ${i + 1} has a case to show`);
  if (s.modal?.kind === 'respond') assert.ok(isOpen(pw.case), `step ${i + 1} can respond`);
}
// The steps the brief names land where they say.
const at = (text) => STEPS.findIndex((s) => s.caption.includes(text));
assert.equal(day(worldAt(at('due Dec 3, not Dec 4')).case.dueAt), 'Dec 3');
assert.equal(worldAt(at('review started automatically')).case.status, STATUS.review);
assert.equal(worldAt(at('no money moves')).step.state, 'rework');
assert.ok(!withdrawalsPaused(worldAt(at('can withdraw again'))) && stepOnHold(worldAt(at('can withdraw again'))));

// No "TSC" in the mock's own words (order numbers like TSC-000524 are the product's format).
for (const f of ['dispute-design-preview.jsx', 'dispute-native-orders.jsx', 'dispute-preview-state.mjs', 'dispute-preview-steps.mjs']) {
  const text = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
    .replace(/TSC-\d+/g, '').replace(/name:'TSC Operations'/g, '').replace(/initials:'TS'/g, '');
  assert.ok(!/\bTSC\b/.test(text), `${f} says TSC`);
}

console.log('Dispute preview flow checks pass.');
