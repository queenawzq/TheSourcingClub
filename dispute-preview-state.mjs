// In-memory dispute flow for the local mockup. No database, payment or email
// calls: every function takes the preview's "world" and returns a new one.
//
// The rules it pins (notes/dispute-design-preview.md, "Flow v4", Upwork's
// dispute process):
// - One open case per order. Our team handles it from the moment it is
//   opened: it is in the staff queue at once, assigned to a named person.
// - The sides can still settle on their own while it is open: the other side
//   answers within 2 business days (accept, make an offer, or reply), and each
//   answer gives the other side 2 business days, never past 5 business days
//   from opening. A missed answer changes nothing by itself: it shows overdue.
// - With no agreement by the end of those 5 business days our team decides
//   (Waiting on: Staff). Staff can request a response or decide at any time.
// - An agreement, or our team's decision, sets the outcome. Outcomes are only
//   what the platform can do. Money outcomes wait for staff to carry them out
//   ("Awaiting completion"); the rest apply at once.
// - While a case is open the factory's withdrawals are paused and the
//   disputed step can't be approved or paid out. The brand is not paused.
//   Staff may "Release other payments": the pause lifts for everything but
//   the disputed step.
// - Dispute emails are always sent, whatever the company's email settings.

export const ORDER = {
  number: 'TSC-000524',
  title: 'Organic cotton poplin shirts',
  brand: 'Fernwood Studio',
  brandCity: 'London, UK',
  factory: 'Ningbo Loomworks',
  factoryCity: 'Ningbo, China',
  totalCents: 573500,
  step: 'Bulk production',
  stepCents: 170000,
  stepDue: '2026-12-04',
};
/** The staff member the case is assigned to. */
export const STAFF = 'Priya Shah';
export const PARTY_NAME = { brand: ORDER.brand, factory: ORDER.factory };
export const other = (side) => (side === 'brand' ? 'factory' : 'brand');

export const TURN_DAYS = 2;
export const WINDOW_DAYS = 5;

// Thursday Nov 26 2026, 10:00 New York. The mock's dates are all in
// November and December, so New York is UTC-5 throughout.
export const START = Date.parse('2026-11-26T15:00:00Z');
const NY = 5 * 3600000;
const MINUTE = 60000;

// One set of words on every surface. "Open" covers the whole time the sides
// can still settle; who must act is "Waiting on", not a status.
export const STATUS = {
  open: 'Open',
  completion: 'Awaiting completion',
  resolved: 'Resolved',
  withdrawn: 'Withdrawn',
};
export const isOpen = (c) => Boolean(c) && c.status !== STATUS.resolved && c.status !== STATUS.withdrawn;

/** The same time of day, n business days later (New York days). */
export function addBusinessDays(ms, days) {
  const d = new Date(ms - NY);
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (![0, 6].includes(d.getUTCDay())) left--;
  }
  return d.getTime() + NY;
}
/** 23:59 New York on the day of ms: a deadline is a day, and the whole day counts. */
export function endOfDay(ms) {
  const d = new Date(ms - NY);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59) + NY;
}
/** The deadline n business days from ms. */
export const dueBy = (ms, days) => endOfDay(addBusinessDays(ms, days));
/** 09:00 New York on the next business day: the mock clock's "next day". */
export function nextBusinessMorning(ms) {
  const d = new Date(addBusinessDays(ms, 1) - NY);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 9, 0) + NY;
}

export const money = (cents) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const day = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
export const dayOf = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export const moment = (ms) => new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });

// The five outcomes, in one vocabulary everywhere.
export const OUTCOMES = [
  { key: 'refund', label: 'Refund', money: true },
  { key: 'payout', label: 'Pay out the step', money: true },
  { key: 'rework', label: 'Rework by a new date', money: false },
  { key: 'cancel', label: 'Cancel the order', money: true },
  { key: 'no_change', label: 'No change', money: false },
];
export const outcomeLabel = (key) => OUTCOMES.find((o) => o.key === key)?.label ?? key;
/** What the side may ask for when it opens a case: no "No change". */
export const requestOutcomes = (side) => OUTCOMES.filter((o) => o.key !== 'no_change' && !(side === 'brand' && o.key === 'payout') && !(side === 'factory' && o.key === 'refund'));

/** The outcome as one short line: "Refund $850.00 to Fernwood Studio". */
export function outcomeLine(o, world) {
  if (!o) return '';
  const held = world?.step.heldCents ?? ORDER.stepCents;
  if (o.type === 'refund') return `Refund ${money(o.amountCents)} to ${ORDER.brand}`;
  if (o.type === 'payout') return `Pay ${money(o.amountCents ?? held)} to ${ORDER.factory}`;
  if (o.type === 'rework') return `Rework by ${dayOf(o.date)}`;
  if (o.type === 'cancel') return (o.amountCents ?? held) > 0 ? `Cancel the order · Refund ${money(o.amountCents ?? held)} to ${ORDER.brand}` : 'Cancel the order';
  return 'No change';
}
/** The single staff action that carries a money outcome out. */
export function completionAction(o, world) {
  const held = world.step.heldCents;
  if (o.type === 'refund') return `Refund ${money(o.amountCents)} to ${ORDER.brand}`;
  if (o.type === 'payout') return `Pay ${money(held)} to ${ORDER.factory}`;
  if (o.type === 'cancel') return held > 0 ? `Refund ${money(held)} and cancel` : 'Cancel the order';
  return null;
}
export const needsStaff = (o) => ['refund', 'payout', 'cancel'].includes(o?.type);

export function initialWorld() {
  return {
    now: START,
    nextId: 29,
    case: null,
    // state: held | rework | approved | paid_out | refunded | cancelled
    step: { heldCents: ORDER.stepCents, refundedCents: 0, due: ORDER.stepDue, state: 'held' },
    order: 'active',
    balanceCents: 296100,
    bankDispute: false,
    notifications: { brand: [], factory: [] },
    emails: [],
  };
}

/** Each action lets a little mock time pass, so a timeline reads like a real one. */
export const tick = (w) => ({ ...w, now: w.now + 47 * MINUTE });

const event = (w, who, title, detail = '', files = [], staffOnly = false) => ({ at: w.now, who, title, detail, files, ...(staffOnly ? { staffOnly } : {}) });
function notify(w, to, title, meta, kind = 'Dispute') {
  return { ...w.notifications, [to]: [{ id: `${to}-${w.now}-${w.notifications[to].length}`, type: kind, title, meta, at: w.now, unread: true }, ...w.notifications[to]] };
}
// Dispute emails ignore the company's email settings: a party must not miss a
// deadline because it turned "Payment and approval requests" off.
function email(w, to, kind, title, body) {
  return [...w.emails, { to, kind, title, body, at: w.now }];
}
function withCase(w, c, extra = {}) {
  return { ...w, case: c, ...extra };
}

/** Pure validation of an outcome; returns an error string or ''. */
export function outcomeError(o, world) {
  if (!o?.type) return 'Choose an outcome.';
  if (o.type === 'refund') {
    if (!Number.isInteger(o.amountCents) || o.amountCents <= 0) return 'Enter an amount.';
    if (o.amountCents > world.step.heldCents) return `Up to ${money(world.step.heldCents)}, the amount funded on this step.`;
  }
  if (o.type === 'payout' && world.step.heldCents <= 0) return 'Nothing is funded on this step to pay out.';
  if (o.type === 'rework' && !/^\d{4}-\d{2}-\d{2}$/.test(o.date ?? '')) return 'Choose a date.';
  return '';
}

/** The next turn's deadline: 2 business days, never past the window. */
const turnDue = (w, c) => Math.min(dueBy(w.now, TURN_DAYS), c.windowEndsAt);

export function openCase(w, by, { reason, stage, details, request, files = [] }) {
  if (isOpen(w.case)) throw new Error('A dispute is already open on this order.');
  const err = outcomeError(request, w);
  if (err) throw new Error(err);
  const id = `DSP-${String(w.nextId).padStart(5, '0')}`;
  const to = other(by);
  const windowEndsAt = dueBy(w.now, WINDOW_DAYS);
  const dueAt = Math.min(dueBy(w.now, TURN_DAYS), windowEndsAt);
  const c = {
    id, openedBy: by, reason, stage, details, files, openedAt: w.now, windowEndsAt,
    request: { ...request },
    offer: { by, ...request, note: '', at: w.now, isRequest: true },
    status: STATUS.open, assignee: STAFF, turn: to, dueAt, deciding: false,
    staffRequest: null, staffDueAt: null, resolution: null, completedAt: null, otherReleased: null,
    events: [
      event(w, by, 'Dispute opened', `${reason} · ${stage} · Requested: ${outcomeLine(request, w)}`, files),
      event(w, 'staff', 'Our team is handling this case', `Assigned to ${STAFF}`),
    ],
    staffNotes: [],
  };
  const title = `${PARTY_NAME[by]} opened a dispute on ${ORDER.number}`;
  return withCase(w, c, {
    nextId: w.nextId + 1,
    notifications: notify(w, to, title, `${reason} · Respond by ${day(dueAt)}`),
    emails: email(w, to, 'opened', title, `${reason} on "${ORDER.title}". Our team is handling this case (${STAFF}). Respond by ${day(dueAt)}. If it is not settled by ${day(windowEndsAt)}, our team decides.`),
  });
}

/** May this side answer now? Its turn, our team's request to it, or any time once our team is deciding. */
export const canAnswer = (c, side) => isOpen(c) && c.status !== STATUS.completion
  && (c.deciding || c.turn === side || Boolean(c.staffRequest?.to.includes(side)));

/** accept | offer | reply: by the side whose turn it is, a side our team asked, or either side once our team is deciding. */
export function respond(w, by, { action, offer, note = '', files = [] }) {
  const c = w.case;
  if (!isOpen(c) || c.status === STATUS.completion) throw new Error('This case is not waiting on an answer.');
  if (!canAnswer(c, by)) throw new Error('It is not your turn to answer.');
  const to = other(by);
  // An answer on your turn hands the turn over; otherwise it only answers our team.
  const passes = !c.deciding && c.turn === by;
  const after = (dueAt) => ({ ...satisfied(c, by), ...(passes ? { turn: to, dueAt } : {}) });
  const meta = (dueAt) => (passes ? `Respond by ${day(dueAt)}` : c.deciding ? 'Our team is deciding' : c.id);
  if (action === 'accept') {
    if (!c.offer || c.offer.by === by) throw new Error('There is no offer from the other side to accept.');
    const agreed = { type: c.offer.type, amountCents: c.offer.amountCents, date: c.offer.date };
    const next = withCase(w, { ...c, events: [...c.events, event(w, by, c.offer.isRequest ? 'Request accepted' : 'Offer accepted', outcomeLine(agreed, w) + (note ? ` · ${note}` : ''), files)], files: [...c.files, ...files] });
    return settle(next, agreed, 'agreement', note);
  }
  if (action === 'offer') {
    const err = outcomeError(offer, w);
    if (err) throw new Error(err);
    const madeOffer = { by, type: offer.type, amountCents: offer.amountCents, date: offer.date, note, at: w.now, isRequest: false };
    const dueAt = turnDue(w, c);
    const title = `${PARTY_NAME[by]} made an offer on ${ORDER.number}`;
    return withCase(w, {
      ...c, offer: madeOffer, files: [...c.files, ...files], ...after(dueAt),
      events: [...c.events, event(w, by, c.offer && c.offer.by !== by && !c.offer.isRequest ? 'Counter-offer made' : 'Offer made', outcomeLine(madeOffer, w) + (note ? ` · ${note}` : ''), files)],
    }, {
      notifications: notify(w, to, title, `${outcomeLine(madeOffer, w)} · ${meta(dueAt)}`),
      emails: email(w, to, 'offer', title, `${outcomeLine(madeOffer, w)}.${passes ? ` Respond by ${day(dueAt)}.` : ''}`),
    });
  }
  if (action === 'reply') {
    if (!note.trim()) throw new Error('Write a reply.');
    const dueAt = turnDue(w, c);
    return withCase(w, {
      ...c, files: [...c.files, ...files], ...after(dueAt),
      events: [...c.events, event(w, by, 'Reply', note, files)],
    }, { notifications: notify(w, to, `${PARTY_NAME[by]} replied on ${ORDER.number}`, meta(dueAt)) });
  }
  throw new Error(`Unknown action ${action}`);
}

// A party's answer satisfies our team's request to that party.
function satisfied(c, by) {
  if (!c.staffRequest) return {};
  const waiting = c.staffRequest.to.filter((s) => s !== by);
  return { staffRequest: waiting.length ? { ...c.staffRequest, to: waiting } : null };
}

/** No agreement by the end of the window: our team decides. The status stays Open; Waiting on becomes Staff. */
function startDeciding(w) {
  const c = w.case;
  const detail = `No agreement by ${day(c.windowEndsAt)}`;
  const subject = `${ORDER.number} dispute: our team is deciding`;
  let notifications = notify(w, 'brand', subject, detail);
  notifications = notify({ ...w, notifications }, 'factory', subject, detail);
  const body = (side) => `${detail}. Our team will decide the outcome and may ask you for more. You can still settle with ${PARTY_NAME[other(side)]} until then.`;
  let emails = email(w, 'brand', 'deciding', subject, body('brand'));
  emails = email({ ...w, emails }, 'factory', 'deciding', subject, body('factory'));
  return withCase(w, {
    ...c, deciding: true, decidingAt: w.now, turn: null, dueAt: null,
    staffDueAt: dueBy(w.now, TURN_DAYS),
    events: [...c.events, event(w, 'system', 'Our team is deciding', detail)],
  }, { notifications, emails });
}

export function withdraw(w, by) {
  const c = w.case;
  if (!isOpen(c) || c.status === STATUS.completion) throw new Error('This case can no longer be withdrawn.');
  if (c.openedBy !== by) throw new Error('Only the side that opened the case can withdraw it.');
  const closedCase = { ...c, status: STATUS.withdrawn, turn: null, dueAt: null, staffRequest: null, closedAt: w.now, events: [...c.events, event(w, by, 'Withdrawn')] };
  const title = `${PARTY_NAME[by]} withdrew the dispute on ${ORDER.number}`;
  return { ...w, case: closedCase, notifications: notify(w, other(by), title, STATUS.withdrawn), emails: email(w, other(by), 'withdrawn', title, 'The order continues as before.') };
}

/** Mock clock: 09:00 on the next business day(s). The end of the window hands the decision to our team. */
export function advance(w, businessDays = 1) {
  let next = w;
  for (let i = 0; i < businessDays; i++) {
    next = { ...next, now: nextBusinessMorning(next.now) };
    const c = next.case;
    if (c?.status === STATUS.open && !c.deciding && c.windowEndsAt < next.now) next = startDeciding(next);
  }
  return next;
}

// ----- Staff -----
export function requestResponse(w, to, message) {
  const c = w.case;
  if (!isOpen(c) || c.status === STATUS.completion) throw new Error('Nothing to ask on this case.');
  const sides = to === 'both' ? ['brand', 'factory'] : [to];
  const dueAt = dueBy(w.now, TURN_DAYS);
  let notifications = w.notifications;
  let emails = w.emails;
  const title = `Our team asked for your response on ${ORDER.number}`;
  for (const s of sides) {
    notifications = notify({ ...w, notifications }, s, title, `Respond by ${day(dueAt)}`);
    emails = email({ ...w, emails }, s, 'request', title, `${message} Respond by ${day(dueAt)}.`);
  }
  return withCase(w, {
    ...c, staffRequest: { to: sides, dueAt, message },
    events: [...c.events, event(w, 'staff', 'Our team asked for a response', `${sides.map((s) => PARTY_NAME[s]).join(' and ')} · ${message}`)],
  }, { notifications, emails });
}

export function recordResolution(w, outcome, note) {
  const c = w.case;
  if (!isOpen(c) || c.status === STATUS.completion) throw new Error('This case already has an outcome.');
  const err = outcomeError(outcome, w);
  if (err) throw new Error(err);
  const next = withCase(w, { ...c, events: [...c.events, event(w, 'staff', 'Decision', `${outcomeLine(outcome, w)}${note ? ` · ${note}` : ''}`)] });
  return settle(next, outcome, 'staff', note);
}

export function addStaffNote(w, text) {
  return withCase(w, { ...w.case, staffNotes: [...w.case.staffNotes, { at: w.now, text }] });
}

/**
 * Lifts the factory's withdrawal pause for everything but the money on the
 * disputed step, which stays on hold until the case closes. Staff only;
 * recorded on the timeline as a staff-only entry.
 */
export function releaseOtherPayments(w, note = '') {
  const c = w.case;
  if (!isOpen(c)) throw new Error('There is no open case.');
  if (c.otherReleased) throw new Error('Other payments are already released.');
  const held = w.step.heldCents;
  const detail = `${ORDER.factory} can withdraw its balance. ${money(held)} on ${ORDER.step} stays on hold.${note ? ` · ${note}` : ''}`;
  return withCase(w, {
    ...c, otherReleased: { at: w.now, note },
    events: [...c.events, event(w, 'staff', 'Other payments released', detail, [], true)],
  }, { notifications: notify(w, 'factory', 'You can withdraw your balance again', `${money(held)} on ${ORDER.step} stays on hold`, 'Payments') });
}

/** An agreed or decided outcome: money waits for staff, the rest applies now. */
function settle(w, outcome, by, note) {
  // A payout or a cancellation moves what is held now; the record keeps the figure.
  const fixed = ['payout', 'cancel'].includes(outcome.type) ? { ...outcome, amountCents: w.step.heldCents } : outcome;
  const c = { ...w.case, resolution: { ...fixed, by, note, at: w.now }, turn: null, dueAt: null, staffRequest: null };
  if (needsStaff(fixed)) {
    let n = notify(w, 'brand', `${ORDER.number} dispute: ${outcomeLine(fixed, w)}`, STATUS.completion);
    n = notify({ ...w, notifications: n }, 'factory', `${ORDER.number} dispute: ${outcomeLine(fixed, w)}`, STATUS.completion);
    return withCase({ ...w, notifications: n }, { ...c, status: STATUS.completion });
  }
  return finish(withCase(w, c), fixed);
}

export function completeResolution(w) {
  const c = w.case;
  if (c?.status !== STATUS.completion) throw new Error('Nothing to carry out.');
  return finish(withCase(w, { ...c, completedAt: w.now }), c.resolution);
}

function finish(w, o) {
  let step = { ...w.step };
  let order = w.order;
  let balanceCents = w.balanceCents;
  if (o.type === 'refund') {
    step = { ...step, heldCents: step.heldCents - o.amountCents, refundedCents: step.refundedCents + o.amountCents };
    if (step.heldCents === 0) step.state = 'refunded';
  } else if (o.type === 'payout') {
    balanceCents += step.heldCents;
    step = { ...step, heldCents: 0, state: 'paid_out' };
  } else if (o.type === 'cancel') {
    step = { ...step, refundedCents: step.refundedCents + step.heldCents, heldCents: 0, state: 'cancelled' };
    order = 'cancelled';
  } else if (o.type === 'rework') {
    // The step reopens with the new date and stays unapproved: the brand
    // approves it as usual when the rework arrives.
    step = { ...step, due: o.date, state: 'rework' };
  }
  const outcome = outcomeLine(o, w);
  const c = { ...w.case, status: STATUS.resolved, closedAt: w.now, events: [...w.case.events, event(w, 'staff', 'Resolved', outcome)] };
  const title = `${ORDER.number} dispute resolved`;
  let n = notify(w, 'brand', title, outcome);
  n = notify({ ...w, notifications: n }, 'factory', title, outcome);
  let e = email(w, 'brand', 'resolved', title, `${outcome}.`);
  e = email({ ...w, emails: e }, 'factory', 'resolved', title, `${outcome}. You can withdraw your balance again.`);
  return { ...w, case: c, step, order, balanceCents, notifications: n, emails: e };
}

/** The brand approves the step the usual way: its money joins the factory's balance. */
export function approveStep(w) {
  if (stepOnHold(w)) throw new Error('On hold: dispute open');
  if (!['held', 'rework'].includes(w.step.state) || w.step.heldCents <= 0) throw new Error('Nothing to approve on this step.');
  return {
    ...w,
    balanceCents: w.balanceCents + w.step.heldCents,
    step: { ...w.step, heldCents: 0, state: 'approved' },
    notifications: notify(w, 'factory', `${ORDER.brand} approved ${ORDER.step}`, `${money(w.step.heldCents)} added to your balance`, 'Payments'),
  };
}

// ----- What each surface reads -----
/** The factory's withdrawals: paused for an open case (unless staff released them) or a bank dispute. */
export const withdrawalsPaused = (w) => (isOpen(w.case) && !w.case.otherReleased) || w.bankDispute;
/** The disputed step can't be approved or paid out while the case is open. */
export const stepOnHold = (w) => isOpen(w.case);

/** Who the case waits on, and by when: 'brand' | 'factory' | 'both' | 'staff' | null. */
export function waitingOn(c) {
  if (!isOpen(c)) return { side: null, dueAt: null };
  if (c.status === STATUS.completion) return { side: 'staff', dueAt: dueBy(c.resolution.at, 1) };
  if (c.staffRequest) return { side: c.staffRequest.to.length > 1 ? 'both' : c.staffRequest.to[0], dueAt: c.staffRequest.dueAt };
  if (c.deciding) return { side: 'staff', dueAt: c.staffDueAt };
  return { side: c.turn, dueAt: c.dueAt };
}

/** The per-side line: "Your response is due Nov 30" / "Waiting for Ningbo Loomworks · due Nov 30". */
export function waitingLine(c, viewer, now = null) {
  const { side, dueAt } = waitingOn(c);
  if (!side) return '';
  const late = now != null && dueAt != null && dueAt < now;
  const due = dueAt ? (late ? ` · overdue since ${day(dueAt)}` : ` · due ${day(dueAt)}`) : '';
  if (side === viewer || (side === 'both' && viewer !== 'staff')) return late ? `Your response was due ${day(dueAt)}` : `Your response is due ${day(dueAt)}`;
  if (side === 'staff') return c.status === STATUS.completion ? `Our team is carrying this out${due}` : `Our team is deciding${due}`;
  const who = side === 'both' ? `${ORDER.brand} and ${ORDER.factory}` : PARTY_NAME[side];
  return `Waiting for ${who}${due}`;
}

/** While the sides can still settle before the deadline: when our team decides. */
export const windowLine = (c) => (c?.status === STATUS.open && !c.deciding ? `Our team decides if not settled by ${day(c.windowEndsAt)}` : '');

/** The header line on both sides' case pages, from the moment the case is opened. */
export const handlingLine = (c) => (isOpen(c) ? `Our team is handling this case · ${c.assignee}` : `Handled by our team · ${c.assignee}`);

/** Did our team decide (or is it deciding)? Only then is there a Decision step. */
const decided = (c) => c.deciding || c.resolution?.by === 'staff';

/** Opened → Answer or settle → Decision (only without agreement) → Resolved, or → Withdrawn. */
export function progress(c) {
  const end = c.status === STATUS.withdrawn ? 'Withdrawn' : 'Resolved';
  const steps = ['Opened', 'Answer or settle', ...(decided(c) ? ['Decision'] : []), end];
  let at = 1;
  if (c.deciding && c.status === STATUS.open) at = steps.indexOf('Decision');
  if (c.status === STATUS.completion || !isOpen(c)) at = steps.length - 1;
  return { steps, at };
}

/** The case's row in the staff queue: there from the moment it is opened. */
export function queueRow(c) {
  const { side, dueAt } = waitingOn(c);
  return { id: c.id, order: ORDER.number, title: ORDER.title, parties: `${ORDER.brand} / ${ORDER.factory}`, reason: c.reason, stage: c.stage, status: c.status, waiting: side, dueAt, assignee: c.assignee, openedAt: c.openedAt };
}
