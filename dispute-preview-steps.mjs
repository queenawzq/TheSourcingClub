// The guided walkthrough of the dispute mock: every step in order, and the
// in-memory world at each one. worldAt(i) replays the actions before step i
// from a fresh world, so a step always looks the same however it was reached.
import {
  ORDER, initialWorld, tick, openCase, respond, advance, requestResponse, recordResolution,
  completeResolution, withdraw, releaseOtherPayments, money,
} from './dispute-preview-state.mjs';

/** Dialog fields as typed ({ type, amount, date }) → the state's outcome. */
export const toOutcome = (v) => ({
  type: v.type,
  amountCents: v.type === 'refund' && v.amount !== '' && v.amount != null ? Math.round(Number(v.amount) * 100) : undefined,
  date: v.type === 'rework' ? v.date : undefined,
});
/** The Open a dispute dialog's fields → openCase's form. */
export const toCaseForm = (f) => ({ reason: f.reason, stage: f.stage, details: f.details, request: toOutcome(f.outcome), files: f.files ?? [] });

const KB = 1024;
const file = (name, size) => ({ name, size });

export const FORMS = {
  quality: {
    reason: 'Quality or workmanship', stage: ORDER.step,
    details: 'The production photos from Nov 24 show uneven collar stitching and a matte button finish instead of the approved pearl buttons. About 120 of the 300 shirts are affected.',
    outcome: { type: 'refund', amount: '1700' },
    files: [file('Collar comparison.jpg', 412 * KB), file('Approved PP sample.pdf', 1.3 * 1024 * KB)],
  },
  delay: {
    reason: 'Delivery delay', stage: ORDER.step,
    details: 'Bulk production is two weeks behind the agreed plan and we have no firm ship date. Our store launch is on Dec 15.',
    outcome: { type: 'cancel' }, files: [],
  },
  payout: {
    reason: 'Payment or release issue', stage: ORDER.step,
    details: 'We posted the finished bulk production photos on Nov 20 and the brand has not approved the step or replied since.',
    outcome: { type: 'payout' }, files: [file('Bulk production photos.pdf', 2.4 * 1024 * KB)],
  },
  fromStep: { reason: '', stage: ORDER.step, details: '', outcome: { type: '' }, files: [] },
};
export const RESPONSES = {
  halfRefund: { action: 'offer', outcome: { type: 'refund', amount: '850' }, note: 'We will re-sew the affected collars at our cost and ship them with the rest. We offer half of this step back for the delay.' },
  accept: { action: 'accept', note: '' },
  reworkDec18: { action: 'offer', outcome: { type: 'rework', date: '2026-12-18' }, note: 'The fabric mill delivered late. We can finish all 300 shirts by Dec 18.' },
  reworkDec11: { action: 'offer', outcome: { type: 'rework', date: '2026-12-11' }, note: 'Our launch is Dec 15. We need the shirts in London by then.' },
  factoryReply: { action: 'reply', note: 'Dec 11 is not possible: the re-dyed fabric arrives on Dec 7. Dec 16 is the earliest we can ship.' },
  brandReply: { action: 'reply', note: 'Dec 16 misses our launch. We would rather cancel than wait.' },
  plan: { action: 'reply', note: 'Revised plan attached. Cutting restarts Dec 8; all 300 shirts ship Dec 18.', files: [file('Revised production plan.pdf', 860 * KB)] },
};
const asRespond = (r) => ({ action: r.action, offer: r.outcome ? toOutcome(r.outcome) : undefined, note: r.note ?? '', files: r.files ?? [] });

// Actions as the preview performs them: each one lets mock time pass.
const act = (fn) => (w) => tick(fn(w));
const open = (side, form) => act((w) => openCase(w, side, toCaseForm(form)));
const answer = (side, r) => act((w) => respond(w, side, asRespond(r)));
const nextDay = (n = 1) => (w) => advance(w, n);
const REQUEST = 'Please send the revised production plan and the earliest date you can ship all 300 shirts.';
const DECISION = 'The delay came from a late fabric delivery, and the factory has given a firm plan. The order continues: Bulk production is reworked and due Dec 18.';
const RELEASE_NOTE = 'Other orders are not affected. Releasing so the factory can pay its mill.';

const P1 = 'Path 1 · Offer accepted, then refunded';
const P2 = 'Path 2 · No agreement, review, rework by a new date';
const P3 = 'Path 3 · Withdrawn';
const P4 = 'Release other payments';
const P5 = 'Dispute from a step';

/**
 * view: brand | factory | admin | emails; page: orders | order | case | payments | queue | adminCase.
 * run: what happens between the previous step and this one. fresh: start from a new world.
 * modal: the dialog open on this step, with what is typed in it.
 */
export const STEPS = [
  { path: P1, fresh: true, view: 'brand', page: 'orders', modal: { kind: 'open', initial: FORMS.quality }, caption: `Brand: opens a dispute from the order's menu and asks for a ${money(170000)} refund` },
  { path: P1, run: [open('brand', FORMS.quality)], view: 'brand', page: 'orders', modal: { kind: 'submitted' }, caption: 'Brand: submitted. The factory has 2 business days to answer; review starts Dec 3 if not settled' },
  { path: P1, view: 'brand', page: 'case', caption: 'Brand: the case page says whose turn it is and when review starts' },
  { path: P1, view: 'factory', page: 'orders', bell: true, caption: 'Factory: the bell and an email say a dispute was opened' },
  { path: P1, view: 'factory', page: 'order', caption: 'Factory: the order banner, and Bulk production on hold' },
  { path: P1, view: 'factory', page: 'payments', caption: 'Factory: withdrawals paused; the disputed step is on hold' },
  { path: P1, view: 'factory', page: 'case', caption: 'Factory: answer within 2 business days: accept, offer, or reply' },
  { path: P1, run: [nextDay()], view: 'factory', page: 'case', modal: { kind: 'respond', arg: 'offer', initial: RESPONSES.halfRefund }, caption: 'Factory (Nov 27): offers to refund $850.00 and re-sew the collars' },
  { path: P1, run: [answer('factory', RESPONSES.halfRefund)], view: 'brand', page: 'case', caption: 'Brand: 2 business days to answer the offer (Dec 1); review still starts Dec 3' },
  { path: P1, view: 'brand', page: 'case', modal: { kind: 'respond', arg: 'accept', initial: RESPONSES.accept }, caption: 'Brand: accepts the offer' },
  { path: P1, run: [answer('brand', RESPONSES.accept)], view: 'brand', page: 'case', caption: 'Brand: agreed. Our team carries out the refund' },
  { path: P1, view: 'admin', page: 'queue', caption: 'Admin: the case waits on staff in the disputes queue' },
  { path: P1, view: 'admin', page: 'adminCase', caption: 'Admin: one button carries out what both sides agreed' },
  { path: P1, view: 'admin', page: 'adminCase', modal: { kind: 'complete' }, caption: 'Admin: one confirm, with the funded amount before and after' },
  { path: P1, run: [act(completeResolution)], view: 'admin', page: 'adminCase', caption: 'Admin: resolved. The pause on withdrawals lifts' },
  { path: P1, view: 'factory', page: 'payments', caption: 'Factory: withdrawals resume; $850.00 is still funded on Bulk production' },
  { path: P1, view: 'brand', page: 'order', caption: 'Brand: Approve is back on Bulk production for the remaining $850.00' },
  { path: P1, view: 'emails', page: 'emails', caption: 'Emails: sent at each step, whatever the company\'s email settings' },

  { path: P2, fresh: true, view: 'brand', page: 'orders', modal: { kind: 'open', initial: FORMS.delay }, caption: 'Brand (Nov 26): opens a dispute over a delay and asks to cancel the order' },
  { path: P2, run: [open('brand', FORMS.delay), nextDay()], view: 'factory', page: 'case', modal: { kind: 'respond', arg: 'offer', initial: RESPONSES.reworkDec18 }, caption: 'Factory (Nov 27): offers rework by a new date, Dec 18' },
  { path: P2, run: [answer('factory', RESPONSES.reworkDec18), nextDay()], view: 'brand', page: 'case', modal: { kind: 'respond', arg: 'offer', initial: RESPONSES.reworkDec11 }, caption: 'Brand (Nov 30): counter-offers Dec 11' },
  { path: P2, run: [answer('brand', RESPONSES.reworkDec11), nextDay()], view: 'factory', page: 'case', modal: { kind: 'respond', arg: 'reply', initial: RESPONSES.factoryReply }, caption: 'Factory (Dec 1): replies; the brand then has until Dec 3' },
  { path: P2, run: [answer('factory', RESPONSES.factoryReply), nextDay()], view: 'brand', page: 'case', modal: { kind: 'respond', arg: 'reply', initial: RESPONSES.brandReply }, caption: 'Brand (Dec 2): replies; 2 business days would run to Dec 4' },
  { path: P2, run: [answer('brand', RESPONSES.brandReply)], view: 'factory', page: 'case', caption: 'Factory: due Dec 3, not Dec 4. The 5-business-day window ends Dec 3' },
  { path: P2, run: [nextDay(2)], view: 'admin', page: 'queue', caption: 'Admin (Dec 4): no agreement by Dec 3, so review started automatically' },
  { path: P2, view: 'admin', page: 'adminCase', adminTab: 'Timeline', caption: 'Admin: the timeline says why review started' },
  { path: P2, view: 'admin', page: 'adminCase', modal: { kind: 'request', initial: { to: 'factory', text: REQUEST } }, caption: 'Admin: asks the factory for a revised plan, due in 2 business days' },
  { path: P2, run: [act((w) => requestResponse(w, 'factory', REQUEST))], view: 'factory', page: 'case', caption: 'Factory: our team needs its answer by Dec 8' },
  { path: P2, view: 'factory', page: 'case', modal: { kind: 'respond', arg: 'reply', initial: RESPONSES.plan }, caption: 'Factory: replies with the revised plan attached' },
  { path: P2, run: [answer('factory', RESPONSES.plan)], view: 'admin', page: 'adminCase', modal: { kind: 'resolve', initial: { outcome: { type: 'rework', date: '2026-12-18' }, note: DECISION } }, caption: 'Admin: decides rework by Dec 18, with a reason both sides read' },
  { path: P2, run: [act((w) => recordResolution(w, { type: 'rework', date: '2026-12-18' }, DECISION))], view: 'admin', page: 'adminCase', caption: 'Admin: no money moves, so the case is resolved at once' },
  { path: P2, view: 'factory', page: 'order', caption: 'Factory: Bulk production reopens, due Dec 18, still unapproved' },
  { path: P2, view: 'brand', page: 'order', caption: 'Brand: when the rework arrives, it approves the step as usual' },

  { path: P3, fresh: true, view: 'factory', page: 'orders', modal: { kind: 'open', initial: FORMS.payout }, caption: 'Factory: opens a dispute and asks for Bulk production to be paid out' },
  { path: P3, run: [open('factory', FORMS.payout)], view: 'brand', page: 'case', caption: 'Brand: now the brand answers, by Nov 30' },
  { path: P3, view: 'factory', page: 'case', modal: { kind: 'withdraw' }, caption: 'Factory: the side that opened the case can withdraw it until an outcome is set' },
  { path: P3, run: [act((w) => withdraw(w, 'factory'))], view: 'factory', page: 'case', caption: 'Factory: withdrawn. Withdrawals resume and the step is no longer on hold' },
  { path: P3, view: 'brand', page: 'orders', caption: 'Brand: the order card says the dispute was withdrawn' },

  { path: P4, fresh: true, run: [open('brand', FORMS.quality)], view: 'factory', page: 'payments', caption: 'Factory: by default the whole balance is paused while a case is open' },
  { path: P4, view: 'admin', page: 'adminCase', caption: 'Admin: Release other payments lifts the pause, except for the disputed step' },
  { path: P4, view: 'admin', page: 'adminCase', modal: { kind: 'release', initial: { note: RELEASE_NOTE } }, caption: 'Admin: one confirm' },
  { path: P4, run: [act((w) => releaseOtherPayments(w, RELEASE_NOTE))], view: 'admin', page: 'adminCase', adminTab: 'Timeline', caption: 'Admin: recorded on the timeline, for staff only' },
  { path: P4, view: 'factory', page: 'payments', caption: 'Factory: can withdraw again; the disputed step stays on hold' },

  { path: P5, fresh: true, view: 'brand', page: 'order', stepMenu: true, caption: 'Brand: a step\'s menu has Initiate dispute' },
  { path: P5, view: 'brand', page: 'order', modal: { kind: 'open', initial: FORMS.fromStep }, caption: 'Brand: the same Open a dispute dialog, with the step filled in' },
];

/** The world at step i (0-based): a fresh world, then every action since the path's start. */
export function worldAt(i) {
  let start = i;
  while (start > 0 && !STEPS[start].fresh) start--;
  let w = initialWorld();
  for (let j = start; j <= i; j++) for (const fn of STEPS[j].run ?? []) w = fn(w);
  return w;
}
