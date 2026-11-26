// node scripts/check-dispute-preview.mjs: the dispute mock's transitions and its walkthrough.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  initialWorld, openCase, respond, withdraw, advance, requestResponse, recordResolution, completeResolution,
  releaseOtherPayments, approveStep, STATUS, STAFF, isOpen, canAnswer, withdrawalsPaused, stepOnHold, waitingOn, waitingLine, windowLine,
  handlingLine, progress, queueRow, addBusinessDays, day, START,
} from '../dispute-preview-state.mjs';
import { STEPS, worldAt } from '../dispute-preview-steps.mjs';

const request = { type: 'refund', amountCents: 170000 };
const opened = (w = initialWorld()) => openCase(w, 'brand', { reason: 'Quality or workmanship', stage: 'Bulk production', details: 'Collars', request });

// Deadlines skip weekends: Thursday + 2 business days is Monday.
assert.equal(new Date(addBusinessDays(START, 2)).getUTCDay(), 1);

// Opening: our team has the case at once (staff queue, assigned); the factory
// answers by Nov 30; our team decides if it is not settled by Dec 3 (5 business days).
let w = opened();
assert.equal(w.case.status, STATUS.open);
assert.deepEqual(Object.values(STATUS), ['Open', 'Awaiting completion', 'Resolved', 'Withdrawn'], 'one set of status words');
assert.equal(w.case.assignee, STAFF);
assert.equal(handlingLine(w.case), 'Our team is handling this case');
const row = queueRow(w.case);
assert.equal(row.status, STATUS.open, 'in the staff queue from opening');
assert.equal(row.assignee, 'Priya Shah');
assert.equal(row.waiting, 'factory');
assert.equal(day(row.dueAt), 'Nov 30');
assert.ok(w.case.events.some((e) => e.who === 'staff' && e.title === 'Our team is handling this case'));
assert.equal(w.case.turn, 'factory');
assert.ok(withdrawalsPaused(w) && stepOnHold(w));
assert.equal(waitingLine(w.case, 'factory'), 'Your response is due Nov 30');
assert.equal(waitingLine(w.case, 'brand'), 'Waiting for Ningbo Loomworks · due Nov 30');
assert.equal(windowLine(w.case), 'Our team decides if not settled by Dec 3');
assert.equal(w.notifications.factory.length, 1);
assert.equal(w.emails.at(-1).to, 'factory');
assert.match(w.emails.at(-1).body, /Our team is handling this case\. Respond by Nov 30\. If it is not settled by Dec 3, our team decides\./);
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
assert.deepEqual(progress(w.case).steps, ['Opened', 'Answer or settle', 'Resolved'], 'agreed: no Decision step');
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
assert.ok(!w.case.deciding);
w = advance(w, 1);                                                               // Fri Dec 4
assert.equal(w.case.status, STATUS.open, 'no stage change: still Open');
assert.ok(w.case.deciding, 'the window ended without agreement: our team decides');
assert.equal(waitingOn(w.case).side, 'staff');
assert.equal(waitingLine(w.case, 'brand'), `Our team is deciding · due ${day(w.case.staffDueAt)}`);
assert.equal(windowLine(w.case), '');
assert.equal(w.case.events.at(-1).title, 'Our team is deciding');
assert.equal(w.case.events.at(-1).detail, 'No agreement by Dec 3');
assert.equal(w.emails.filter((e) => e.kind === 'deciding').length, 2);
assert.deepEqual(progress(w.case), { steps: ['Opened', 'Answer or settle', 'Decision', 'Resolved'], at: 2 });
// The sides can still settle while our team decides: either may answer, offers still accept.
assert.ok(canAnswer(w.case, 'brand') && canAnswer(w.case, 'factory'));
const settled = respond(respond(w, 'brand', { action: 'offer', offer: { type: 'rework', date: '2026-12-16' } }), 'factory', { action: 'accept' });
assert.equal(settled.case.status, STATUS.resolved);
assert.equal(settled.case.resolution.by, 'agreement');

// A missed answer changes nothing by itself: it is overdue, and our team still decides only after the window.
w = advance(opened(), 1);
assert.equal(waitingOn(w.case).side, 'factory', 'Nov 30 is still answerable on Nov 27');
w = advance(w, 2);                                                               // Tue Dec 1
assert.equal(w.case.status, STATUS.open);
assert.ok(!w.case.deciding, 'a missed turn does not hand the case over');
assert.equal(waitingLine(w.case, 'factory', w.now), 'Your response was due Nov 30');
assert.equal(waitingLine(w.case, 'brand', w.now), 'Waiting for Ningbo Loomworks · overdue since Nov 30');
assert.ok(canAnswer(w.case, 'factory') && !canAnswer(w.case, 'brand'));
w = advance(w, 3);                                                               // Fri Dec 4
assert.ok(w.case.deciding);

// Path 2: our team decides; it asks for a response, then decides rework by a new date.
assert.deepEqual(progress(w.case).steps, ['Opened', 'Answer or settle', 'Decision', 'Resolved']);
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

// Staff may decide early, before the window ends; a payout adds the held money to the balance.
w = opened();
assert.ok(!w.case.deciding);
const before = w.balanceCents;
w = recordResolution(w, { type: 'payout' }, 'Approved photos match the spec');
assert.equal(w.case.status, STATUS.completion);
assert.deepEqual(progress(w.case), { steps: ['Opened', 'Answer or settle', 'Decision', 'Resolved'], at: 3 });
w = completeResolution(w);
assert.equal(w.balanceCents - before, 170000);
assert.equal(w.step.state, 'paid_out');

// Release other payments: the pause lifts, the disputed step stays on hold, staff-only on the timeline.
w = opened();
assert.ok(withdrawalsPaused(w), 'the whole balance is paused by default');
// Staff may also request a response early: the requested side may answer out of turn.
const asked = requestResponse(w, 'brand', 'Which collars are affected?');
assert.equal(waitingOn(asked.case).side, 'brand');
assert.equal(asked.case.status, STATUS.open);
assert.equal(respond(asked, 'brand', { action: 'reply', note: '120 of 300' }).case.turn, 'factory', 'answering our team keeps the turn');
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
assert.deepEqual(progress(w.case).steps, ['Opened', 'Answer or settle', 'Withdrawn']);

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
assert.ok(worldAt(at('so our team is deciding')).case.deciding);
assert.equal(worldAt(at('in the queue at once')).case.status, STATUS.open);
assert.equal(worldAt(at('no money moves')).step.state, 'rework');
assert.ok(!withdrawalsPaused(worldAt(at('can withdraw again'))) && stepOnHold(worldAt(at('can withdraw again'))));

// Brands and factories never see a staff member's name: not on the case page,
// the order card or banner, the timeline, the bell or an email, in any step.
const partyText = (pw) => {
  const c = pw.case;
  const parts = [...pw.notifications.brand, ...pw.notifications.factory].flatMap((n) => [n.title, n.meta]);
  parts.push(...pw.emails.flatMap((e) => [e.title, e.body]));
  if (c) {
    parts.push(handlingLine(c), windowLine(c), waitingLine(c, 'brand', pw.now), waitingLine(c, 'factory', pw.now));
    parts.push(...c.events.filter((e) => !e.staffOnly).flatMap((e) => [e.title, e.detail]));
    if (c.resolution) parts.push(c.resolution.note);
  }
  return parts.join('\n');
};
for (let i = 0; i < STEPS.length; i++) {
  const pw = worldAt(i);
  assert.ok(!partyText(pw).includes(STAFF), `step ${i + 1}: a brand or factory surface names ${STAFF}`);
  if (pw.case) assert.ok(pw.case.events.some((e) => e.staffOnly && e.title === `Assigned to ${STAFF}`), `step ${i + 1}: staff see the assignee`);
}
// The party-side components and the sample emails never read the name either.
{
  const jsx = fs.readFileSync(new URL('../dispute-design-preview.jsx', import.meta.url), 'utf8');
  const fn = (name) => jsx.slice(jsx.indexOf(`function ${name}(`), jsx.indexOf('\n}\n', jsx.indexOf(`function ${name}(`)));
  for (const name of ['CasePage', 'SubmittedDialog', 'OpenDisputeDialog', 'RespondDialog', 'FactoryPayments', 'EmailsPage', 'emailFor']) assert.ok(!/STAFF|assignee|Priya/.test(fn(name)), `${name} reads the staff name`);
  const samples = jsx.slice(jsx.indexOf('const sampleEmails'), jsx.indexOf('function EmailsPage'));
  assert.ok(!/STAFF|Priya/.test(samples), 'sample emails name staff');
  assert.ok(!/STAFF|assignee|Priya/.test(fs.readFileSync(new URL('../dispute-native-orders.jsx', import.meta.url), 'utf8')), 'order card or banner names staff');
}

// The escalation step is gone everywhere.
for (const f of ['dispute-design-preview.jsx', 'dispute-native-orders.jsx', 'dispute-preview-state.mjs', 'dispute-preview-steps.mjs']) {
  const text = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  assert.ok(!/Ask our team|step in\b(?! order)|askForReview|escalat|In review|Review starts/i.test(text), `${f} still mentions the old escalation`);
}

// No "TSC" in the mock's own words (order numbers like TSC-000524 are the product's format).
for (const f of ['dispute-design-preview.jsx', 'dispute-native-orders.jsx', 'dispute-preview-state.mjs', 'dispute-preview-steps.mjs']) {
  const text = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
    .replace(/TSC-\d+/g, '').replace(/name:'TSC Operations'/g, '').replace(/initials:'TS'/g, '');
  assert.ok(!/\bTSC\b/.test(text), `${f} says TSC`);
}

console.log('Dispute preview flow checks pass.');
