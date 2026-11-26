// In-memory dispute flow for the local mockup. No database, payment or email
// calls: every function takes the preview's "world" and returns a new one.
//
// The rules it pins (notes/dispute-design-preview.md, "Flow v2"):
// - One open case per order.
// - The other side answers within 2 business days: accept, make an offer, or
//   reply. Each answer gives the other side 2 business days. A missed
//   deadline, or either side asking, sends the case to TSC review.
// - An agreement, or TSC's decision, sets the outcome. Outcomes are only what
//   the platform can do. Money outcomes wait for staff to carry them out
//   ("Awaiting completion"); the rest apply at once.
// - While a case is open the factory's withdrawals are paused and the
//   disputed step can't be approved or paid out. The brand is not paused.

export const ORDER = {
  number: 'TSC-000524',
  title: 'Organic cotton poplin shirts',
  brand: 'Demo Brand',
  factory: 'Ningbo Loomworks',
  totalCents: 573500,
  step: 'Bulk production',
  stepCents: 170000,
  stepDue: '2026-12-04',
};
export const PARTY_NAME = { brand: ORDER.brand, factory: ORDER.factory, tsc: 'TSC', system: 'TSC' };
export const other = (side) => (side === 'brand' ? 'factory' : 'brand');

// Thursday Nov 26 2026, 10:00 New York.
export const START = Date.parse('2026-11-26T15:00:00Z');
const HOUR = 3600000;

export const STATUS = {
  response: 'Awaiting response',
  review: 'TSC review',
  completion: 'Awaiting completion',
  resolved: 'Resolved',
  withdrawn: 'Withdrawn',
};
export const isOpen = (c) => Boolean(c) && c.status !== STATUS.resolved && c.status !== STATUS.withdrawn;

export function addBusinessDays(ms, days) {
  const d = new Date(ms);
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (![0, 6].includes(d.getUTCDay())) left--;
  }
  return d.getTime();
}

export const money = (cents) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const day = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
export const dayOf = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export const moment = (ms) => new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });

// The five outcomes, in one vocabulary everywhere.
export const OUTCOMES = [
  { key: 'refund', label: 'Refund', money: true },
  { key: 'payout', label: 'Pay out the step', money: true },
  { key: 'new_date', label: 'New due date', money: false },
  { key: 'cancel', label: 'Cancel the order', money: true },
  { key: 'no_change', label: 'No change', money: false },
];
export const outcomeLabel = (key) => OUTCOMES.find((o) => o.key === key)?.label ?? key;
/** What the side may ask for when it opens a case: no "No change". */
export const requestOutcomes = (side) => OUTCOMES.filter((o) => o.key !== 'no_change' && !(side === 'brand' && o.key === 'payout') && !(side === 'factory' && o.key === 'refund'));

/** The outcome as one short line: "Refund $850.00 to Demo Brand". */
export function outcomeLine(o, world) {
  if (!o) return '';
  const held = world?.step.heldCents ?? ORDER.stepCents;
  if (o.type === 'refund') return `Refund ${money(o.amountCents)} to ${ORDER.brand}`;
  if (o.type === 'payout') return `Pay ${money(o.amountCents ?? held)} to ${ORDER.factory}`;
  if (o.type === 'new_date') return `New due date: ${dayOf(o.date)}`;
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
    closed: [],
    step: { heldCents: ORDER.stepCents, refundedCents: 0, due: ORDER.stepDue, state: 'held' },
    order: 'active',
    balanceCents: 296100,
    bankDispute: false,
    notifications: { brand: [], factory: [] },
    emails: [],
  };
}

const event = (w, who, title, detail = '', files = []) => ({ at: w.now, who, title, detail, files });
function notify(w, to, title, meta, kind = 'Dispute') {
  return { ...w.notifications, [to]: [{ id: `${to}-${w.now}-${w.notifications[to].length}`, type: kind, title, meta, at: w.now, unread: true }, ...w.notifications[to]] };
}
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
    if (o.amountCents > world.step.heldCents) return `Up to ${money(world.step.heldCents)}, the amount TSC holds on this order.`;
  }
  if (o.type === 'payout' && world.step.heldCents <= 0) return 'TSC holds nothing on this order to pay out.';
  if (o.type === 'new_date' && !/^\d{4}-\d{2}-\d{2}$/.test(o.date ?? '')) return 'Choose a date.';
  return '';
}

export function openCase(w, by, { reason, stage, details, request, files = [] }) {
  if (isOpen(w.case)) throw new Error('A dispute is already open on this order.');
  const err = outcomeError(request, w);
  if (err) throw new Error(err);
  const id = `DSP-${String(w.nextId).padStart(5, '0')}`;
  const to = other(by);
  const dueAt = addBusinessDays(w.now, 2);
  const c = {
    id, openedBy: by, reason, stage, details, files, openedAt: w.now,
    request: { ...request },
    offer: { by, ...request, note: '', at: w.now, isRequest: true },
    status: STATUS.response, turn: to, dueAt, escalated: false,
    tscRequest: null, tscDueAt: null, resolution: null, completedAt: null,
    events: [event(w, by, 'Dispute opened', `${reason} · ${stage} · Requested: ${outcomeLine(request, w)}`, files)],
    staffNotes: [],
  };
  const title = `${PARTY_NAME[by]} opened a dispute on ${ORDER.number}`;
  return withCase(w, c, {
    nextId: w.nextId + 1,
    notifications: notify(w, to, title, `${reason} · Respond by ${day(dueAt)}`),
    emails: email(w, to, 'opened', title, `${reason} on "${ORDER.title}". Respond by ${day(dueAt)}.`),
  });
}

/** accept | offer | reply, by the side whose turn it is (or either side in TSC review). */
export function respond(w, by, { action, offer, note = '', files = [] }) {
  const c = w.case;
  if (!isOpen(c) || c.status === STATUS.completion) throw new Error('This case is not waiting on an answer.');
  if (c.status === STATUS.response && c.turn !== by) throw new Error('It is not your turn to answer.');
  const to = other(by);
  if (action === 'accept') {
    if (!c.offer || c.offer.by === by) throw new Error('There is no offer from the other side to accept.');
    const agreed = { type: c.offer.type, amountCents: c.offer.amountCents, date: c.offer.date };
    let next = withCase(w, { ...c, events: [...c.events, event(w, by, c.offer.isRequest ? 'Request accepted' : 'Offer accepted', outcomeLine(agreed, w) + (note ? ` · ${note}` : ''), files)], files: [...c.files, ...files] });
    return settle(next, agreed, 'agreement', note);
  }
  if (action === 'offer') {
    const err = outcomeError(offer, w);
    if (err) throw new Error(err);
    const madeOffer = { by, type: offer.type, amountCents: offer.amountCents, date: offer.date, note, at: w.now, isRequest: false };
    const dueAt = addBusinessDays(w.now, 2);
    const inReview = c.status === STATUS.review;
    const title = `${PARTY_NAME[by]} made an offer on ${ORDER.number}`;
    return withCase(w, {
      ...c, offer: madeOffer, files: [...c.files, ...files],
      ...(inReview ? satisfied(c, by) : { turn: to, dueAt }),
      events: [...c.events, event(w, by, c.offer && c.offer.by !== by && !c.offer.isRequest ? 'Counter-offer made' : 'Offer made', outcomeLine(madeOffer, w) + (note ? ` · ${note}` : ''), files)],
    }, {
      notifications: notify(w, to, title, `${outcomeLine(madeOffer, w)}${inReview ? '' : ` · Respond by ${day(dueAt)}`}`),
      emails: email(w, to, 'offer', title, `${outcomeLine(madeOffer, w)}.${inReview ? '' : ` Respond by ${day(dueAt)}.`}`),
    });
  }
  if (action === 'reply') {
    if (!note.trim()) throw new Error('Write a reply.');
    const inReview = c.status === STATUS.review;
    const dueAt = addBusinessDays(w.now, 2);
    return withCase(w, {
      ...c, files: [...c.files, ...files],
      ...(inReview ? satisfied(c, by) : { turn: to, dueAt }),
      events: [...c.events, event(w, by, 'Reply', note, files)],
    }, { notifications: notify(w, to, `${PARTY_NAME[by]} replied on ${ORDER.number}`, inReview ? 'TSC review' : `Respond by ${day(dueAt)}`) });
  }
  throw new Error(`Unknown action ${action}`);
}

// In TSC review a party's answer satisfies TSC's request to that party.
function satisfied(c, by) {
  if (!c.tscRequest) return {};
  const waiting = c.tscRequest.to.filter((s) => s !== by);
  return { tscRequest: waiting.length ? { ...c.tscRequest, to: waiting } : null };
}

export function askTsc(w, by, note = '') {
  const c = w.case;
  if (!isOpen(c) || c.status !== STATUS.response) throw new Error('This case is already with TSC.');
  return escalate(w, by, note);
}

function escalate(w, by, note = '') {
  const c = w.case;
  const title = by === 'system' ? 'Sent to TSC review' : 'Asked TSC to step in';
  const detail = by === 'system' ? `No agreement by ${day(c.dueAt)}` : note;
  const n1 = notify(w, 'brand', `${ORDER.number} dispute is in TSC review`, 'TSC review');
  const w2 = { ...w, notifications: n1 };
  return withCase(w2, {
    ...c, status: STATUS.review, escalated: true, turn: null, dueAt: null, escalatedAt: w.now,
    tscDueAt: addBusinessDays(w.now, 2),
    events: [...c.events, event(w, by, title, detail)],
  }, { notifications: notify(w2, 'factory', `${ORDER.number} dispute is in TSC review`, 'TSC review') });
}

export function withdraw(w, by) {
  const c = w.case;
  if (!isOpen(c) || c.status === STATUS.completion) throw new Error('This case can no longer be withdrawn.');
  if (c.openedBy !== by) throw new Error('Only the side that opened the case can withdraw it.');
  const closedCase = { ...c, status: STATUS.withdrawn, turn: null, dueAt: null, tscRequest: null, closedAt: w.now, events: [...c.events, event(w, by, 'Withdrawn')] };
  const title = `${PARTY_NAME[by]} withdrew the dispute on ${ORDER.number}`;
  return { ...w, case: closedCase, notifications: notify(w, other(by), title, 'Withdrawn') };
}

/** Mock clock. A missed party deadline sends the case to TSC review. */
export function advance(w, businessDays) {
  let next = { ...w, now: addBusinessDays(w.now, businessDays) };
  const c = next.case;
  if (isOpen(c) && c.status === STATUS.response && c.dueAt <= next.now) next = escalate(next, 'system');
  return next;
}

// ----- Staff -----
export function requestResponse(w, to, message) {
  const c = w.case;
  if (!isOpen(c) || c.status === STATUS.completion) throw new Error('Nothing to ask on this case.');
  const sides = to === 'both' ? ['brand', 'factory'] : [to];
  const dueAt = addBusinessDays(w.now, 2);
  let notifications = w.notifications;
  for (const s of sides) notifications = notify({ ...w, notifications }, s, `TSC asked for your response on ${ORDER.number}`, `Respond by ${day(dueAt)}`);
  return withCase(w, {
    ...c, status: STATUS.review, escalated: true, turn: null, dueAt: null,
    tscRequest: { to: sides, dueAt, message },
    tscDueAt: c.tscDueAt ?? addBusinessDays(w.now, 2),
    events: [...c.events, event(w, 'tsc', 'TSC requested a response', `${sides.map((s) => PARTY_NAME[s]).join(' and ')} · ${message}`)],
  }, { notifications });
}

export function recordResolution(w, outcome, note) {
  const c = w.case;
  if (!isOpen(c) || c.status === STATUS.completion) throw new Error('This case already has an outcome.');
  const err = outcomeError(outcome, w);
  if (err) throw new Error(err);
  const next = withCase(w, { ...c, events: [...c.events, event(w, 'tsc', 'TSC decision', `${outcomeLine(outcome, w)}${note ? ` · ${note}` : ''}`)] });
  return settle(next, outcome, 'tsc', note);
}

export function addStaffNote(w, text) {
  return withCase(w, { ...w.case, staffNotes: [...w.case.staffNotes, { at: w.now, text }] });
}

/** An agreed or decided outcome: money waits for staff, the rest applies now. */
function settle(w, outcome, by, note) {
  // A payout or a cancellation moves what is held now; the record keeps the figure.
  const fixed = ['payout', 'cancel'].includes(outcome.type) ? { ...outcome, amountCents: w.step.heldCents } : outcome;
  outcome = fixed;
  const c = { ...w.case, resolution: { ...fixed, by, note, at: w.now }, turn: null, dueAt: null, tscRequest: null };
  if (needsStaff(outcome)) {
    const n = notify(w, 'brand', `${ORDER.number} dispute: ${outcomeLine(outcome, w)}`, STATUS.completion);
    return withCase({ ...w, notifications: n }, { ...c, status: STATUS.completion }, { notifications: notify({ ...w, notifications: n }, 'factory', `${ORDER.number} dispute: ${outcomeLine(outcome, w)}`, STATUS.completion) });
  }
  return finish(withCase(w, c), outcome);
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
  } else if (o.type === 'new_date') {
    step = { ...step, due: o.date };
  }
  const outcome = outcomeLine(o, w);
  const c = { ...w.case, status: STATUS.resolved, closedAt: w.now, events: [...w.case.events, event(w, 'tsc', 'Resolved', outcome)] };
  const title = `${ORDER.number} dispute resolved`;
  let n = notify(w, 'brand', title, outcome);
  n = notify({ ...w, notifications: n }, 'factory', title, outcome);
  let e = email(w, 'brand', 'resolved', title, `${outcome}.`);
  e = email({ ...w, emails: e }, 'factory', 'resolved', title, `${outcome}. Withdrawals are available again.`);
  return { ...w, case: c, step, order, balanceCents, notifications: n, emails: e };
}

// ----- What each surface reads -----
/** The factory's withdrawals: paused for any open case or bank dispute. */
export const withdrawalsPaused = (w) => isOpen(w.case) || w.bankDispute;
/** The disputed step can't be approved or paid out while the case is open. */
export const stepOnHold = (w) => isOpen(w.case);

/** Who the case waits on, and by when: 'brand' | 'factory' | 'tsc' | null. */
export function waitingOn(c) {
  if (!isOpen(c)) return { side: null, dueAt: null };
  if (c.status === STATUS.response) return { side: c.turn, dueAt: c.dueAt };
  if (c.status === STATUS.review && c.tscRequest) return { side: c.tscRequest.to.length > 1 ? 'both' : c.tscRequest.to[0], dueAt: c.tscRequest.dueAt };
  if (c.status === STATUS.review) return { side: 'tsc', dueAt: c.tscDueAt };
  return { side: 'tsc', dueAt: addBusinessDays(c.resolution.at, 1) };
}

/** The per-side line: "Your response is due Nov 30" / "Waiting for Ningbo Loomworks · due Nov 30". */
export function waitingLine(c, viewer, now = null) {
  const { side, dueAt } = waitingOn(c);
  if (!side) return '';
  const late = now != null && dueAt != null && dueAt <= now;
  const due = dueAt ? (late ? ` · overdue since ${day(dueAt)}` : ` · due ${day(dueAt)}`) : '';
  if (side === viewer || (side === 'both' && viewer !== 'tsc')) return late ? `Your response was due ${day(dueAt)}` : `Your response is due ${day(dueAt)}`;
  const who = side === 'both' ? `${ORDER.brand} and ${ORDER.factory}` : PARTY_NAME[side];
  return `Waiting for ${who}${due}`;
}

/** The progress indicator: Opened → Response → TSC review (only if escalated) → Resolution → Resolved. */
export function progress(c) {
  const steps = c.status === STATUS.withdrawn
    ? ['Opened', 'Response', ...(c.escalated ? ['TSC review'] : []), 'Withdrawn']
    : ['Opened', 'Response', ...(c.escalated ? ['TSC review'] : []), 'Resolution', 'Resolved'];
  let at = 1;
  if (c.status === STATUS.review) at = steps.indexOf('TSC review');
  if (c.status === STATUS.completion) at = steps.indexOf('Resolution');
  if (c.status === STATUS.resolved || c.status === STATUS.withdrawn) at = steps.length - 1;
  return { steps, at };
}
