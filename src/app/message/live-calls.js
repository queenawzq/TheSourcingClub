/**
 * Live calls as the designed cards expect them.
 *
 * `UpcomingCallCard` (conversation panel) takes { title, brandTime,
 * factoryTime, agenda }: the strong line is the reader's own time and the
 * small one the other side's, whichever side the reader is on (in the zone
 * they proposed the call in, when they did: `theirZoneFor`). The dashboard
 * cards take { title, time, counterpartTime, description, action }.
 */
import {
  callState,
  downloadIcs,
  googleCalendarUrl,
  otherSide,
  startOf,
  theirTime,
  theirZoneFor,
  whenIn,
  canJoinCall,
} from "../../lib/domain/calls.js";

const OPEN = new Set(["invite", "waiting", "upcoming", "live"]);

/** Calls worth a card: open ones first by time, then the last few closed. */
export function callsForPanel(calls, orgId, now = Date.now()) {
  const open = calls.filter((call) => OPEN.has(callState(call, orgId, now)));
  const closed = calls
    .filter((call) => !OPEN.has(callState(call, orgId, now)))
    .sort((a, b) => new Date(b.responded_at ?? b.starts_at) - new Date(a.responded_at ?? a.starts_at))
    .slice(0, 3);
  return [...open, ...closed];
}

const CLOSED_STATUS = {
  declined: (call, other, orgId) =>
    call.proposer_org_id === orgId ? `Declined by ${other.name}` : "You declined",
  countered: (call, other, orgId) =>
    call.proposer_org_id === orgId ? `${other.name} proposed another time` : "You proposed another time",
  // An invite nobody answered was withdrawn by its proposer, not cancelled:
  // only accepting (or answering) sets responded_at.
  cancelled: (call, other, orgId) => {
    const word = call.responded_at ? "Cancelled" : "Withdrawn";
    return call.cancelled_by_org_id === orgId ? word : `${word} by ${other.name}`;
  },
  expired: () => "No answer before the time",
  past: () => "Ended",
};

/**
 * One call as the conversation panel's card. `handlers` are the screen's:
 * accept, decline, counter, cancel, join. `busyId` greys the buttons of the
 * call being changed; `notes` holds a line to show under one card.
 */
export function panelCard(call, { orgId, ownZone, otherZone, handlers, busyId, notes = {}, now = Date.now() }) {
  const other = otherSide(call, orgId);
  const state = callState(call, orgId, now);
  const start = startOf(call);
  const busy = busyId === call.id;
  const calendar = [
    { label: "Add to calendar", onClick: () => downloadIcs(call, other.name), disabled: busy },
    { label: "Google Calendar", onClick: () => window.open(googleCalendarUrl(call, other.name), "_blank", "noopener"), disabled: busy },
  ];

  let status;
  let tone = "";
  let actions = [];
  if (state === "invite") {
    status = `${other.name} invited you`;
    tone = "attention";
    actions = [
      { label: "Accept", primary: true, onClick: () => handlers.accept(call), disabled: busy },
      { label: "Propose another time", onClick: () => handlers.counter(call), disabled: busy },
      { label: "Decline", onClick: () => handlers.decline(call), disabled: busy },
    ];
  } else if (state === "waiting") {
    status = `Waiting for ${other.name} to answer`;
    actions = [{ label: "Withdraw invite", onClick: () => handlers.cancel(call), disabled: busy }];
  } else if (state === "upcoming") {
    status = "Confirmed";
    tone = "confirmed";
    actions = [
      { label: "Join call", primary: true, onClick: () => handlers.join(call), disabled: busy },
      ...calendar,
      { label: "Cancel call", onClick: () => handlers.cancel(call), disabled: busy },
    ];
  } else if (state === "live") {
    status = start.getTime() > now ? "Starting soon" : "On now";
    tone = "confirmed";
    actions = [
      { label: "Join call", primary: true, onClick: () => handlers.join(call), disabled: busy },
      ...calendar,
      // cancel_call allows it until the start, so someone who can't make it
      // in the last ten minutes says so here, not in a message.
      ...(start.getTime() > now ? [{ label: "Cancel call", onClick: () => handlers.cancel(call), disabled: busy }] : []),
    ];
  } else {
    status = CLOSED_STATUS[state]?.(call, other, orgId) ?? state;
    tone = "closed";
  }

  return {
    id: call.id,
    title: call.title,
    brandTime: whenIn(start, ownZone),
    factoryTime: theirTime(start, other.name, theirZoneFor(call, orgId, otherZone)),
    agenda: call.response_note && (state === "declined" || state === "cancelled")
      ? `“${call.response_note}”`
      : call.agenda ?? "",
    live: {
      status,
      tone,
      actions,
      note: notes[call.id]?.text ?? null,
      noteIsError: Boolean(notes[call.id]?.error),
    },
  };
}

/**
 * The dashboard's "Scheduled calls": invites waiting on this company and
 * confirmed calls not yet over. Each opens its conversation; "Join call"
 * opens it and joins (`open(call, { join: true })`), so it does what it says.
 */
export function dashboardCalls(calls, { orgId, ownZone, zones = {}, open, now = Date.now() }) {
  return calls
    .filter((call) => ["invite", "upcoming", "live"].includes(callState(call, orgId, now)))
    .slice(0, 4)
    .map((call) => {
      const other = otherSide(call, orgId);
      const state = callState(call, orgId, now);
      const start = startOf(call);
      return {
        id: call.id,
        title: state === "invite" ? `${call.title} (invite)` : call.title,
        time: whenIn(start, ownZone),
        counterpartTime: theirTime(start, other.name, theirZoneFor(call, orgId, zones[call.thread_id])) || other.name,
        description: call.agenda ?? "",
        action: state === "invite" ? "Review invite" : "Join call",
        onAction: () => open(call, { join: canJoinCall(call, now) }),
      };
    });
}

/** "Call invite" cards for "Needs your attention": one per invite waiting on this company. */
export function inviteAttention(calls, { orgId, ownZone, open, now = Date.now() }) {
  return calls
    .filter((call) => callState(call, orgId, now) === "invite")
    .map((call) => {
      const other = otherSide(call, orgId);
      return {
        // Two invites from one company share a title: the call is the key.
        id: call.id,
        type: "Call invite",
        tone: "warning",
        title: `${other.name} invited you to a call`,
        meta: `${call.title} · ${whenIn(startOf(call), ownZone)}`,
        facts: [],
        action: "Review",
        // The brand's card reads onClick, the factory's onAction.
        onClick: () => open(call),
        onAction: () => open(call),
      };
    });
}
