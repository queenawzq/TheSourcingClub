/**
 * The brand dashboard, on Queena's designed screen.
 *
 * `HomeScreen` is imported from src/prototype/main.jsx and mounted here with
 * live data. This file is the seam, not a screen.
 *
 * The design's "needs your attention" rail is a fixed list of four examples.
 * Live, it is whatever `dashboard_snapshot` says is actually outstanding —
 * which means a card only appears when there is something behind it, and the
 * rail is empty when nothing is waiting. That is the one behaviour the
 * prototype cannot have and the product cannot do without.
 */
import React, { useEffect, useState } from "react";
import { HomeScreen } from "../../prototype/main.jsx";
import { dashboardSnapshot } from "../../lib/domain/dashboard.js";
import { formatMoney } from "../../lib/money.js";

/**
 * The snapshot, as the designed attention cards.
 *
 * Order is urgency: money the brand owes first, then work waiting on them,
 * then someone waiting on a reply. Nothing is invented — a count of zero
 * produces no card at all.
 */
function attentionFrom(snapshot, isFactory, goTo) {
  if (!snapshot) return null;
  const items = [];
  const n = (value) => Number(value) || 0;

  if (!isFactory && n(snapshot.payments_due_cents) > 0) {
    items.push({
      type: "Payment",
      tone: "danger",
      title: `${formatMoney(snapshot.payments_due_cents)} due`,
      meta: "A production step is waiting on this payment before it can start.",
      facts: [],
      action: "View orders",
      onClick: () => goTo("projects"),
    });
  }

  if (n(snapshot.orders_awaiting_schedule) > 0) {
    items.push({
      type: "Schedule",
      tone: "warning",
      title: `${snapshot.orders_awaiting_schedule} order${snapshot.orders_awaiting_schedule === 1 ? "" : "s"} awaiting a schedule`,
      meta: "Both sides have to agree the steps before production can begin.",
      facts: [],
      action: "Agree the schedule",
      onClick: () => goTo("projects"),
    });
  }

  if (n(snapshot.steps_awaiting_you) > 0) {
    items.push({
      type: "Step",
      tone: "warning",
      title: `${snapshot.steps_awaiting_you} step${snapshot.steps_awaiting_you === 1 ? "" : "s"} need you`,
      meta: "Approve or comment so the other side can carry on.",
      facts: [],
      action: "Review steps",
      onClick: () => goTo("projects"),
    });
  }

  if (!isFactory && n(snapshot.quotes_to_compare) > 0) {
    items.push({
      type: "Quote",
      tone: "info",
      title: `${snapshot.quotes_to_compare} quote${snapshot.quotes_to_compare === 1 ? "" : "s"} to compare`,
      meta: "Vendors have replied to your request.",
      facts: [],
      action: "Compare quotes",
      onClick: () => goTo("rfqs"),
    });
  }

  if (n(snapshot.unread_messages) > 0) {
    items.push({
      type: "Message",
      tone: "info",
      title: `${snapshot.unread_messages} unread message${snapshot.unread_messages === 1 ? "" : "s"}`,
      meta: "Someone is waiting on a reply.",
      facts: [],
      action: "Open conversations",
      onClick: () => goTo("messages"),
    });
  }

  return items;
}

export default function LiveHome({ org, isFactory, goTo, onOpenActivity }) {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    dashboardSnapshot(org.id)
      .then((row) => !cancelled && setSnapshot(row))
      .catch((failure) => !cancelled && setError(failure));
    return () => { cancelled = true; };
  }, [org.id]);

  const attention = attentionFrom(snapshot, isFactory, goTo) ?? [];

  return (
    <>
      {error && <p className="home-load-error" role="alert">{error.message}</p>}
      <HomeScreen
        // A brand with nothing outstanding gets the design's newcomer layout,
        // which is the one that shows recommended vendors and "ready to start
        // sourcing?" — exactly right for an account that has just onboarded.
        dashboardState={attention.length ? "active" : "newcomer"}
        goTo={goTo}
        onOpenActivity={onOpenActivity}
        orgName={org.name}
        attention={attention}
        unreadCount={Number(snapshot?.unread_messages) || 0}
      />
    </>
  );
}
