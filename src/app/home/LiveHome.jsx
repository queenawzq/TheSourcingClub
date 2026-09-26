/**
 * The brand dashboard, on Queena's designed screen.
 *
 * `HomeScreen` is imported from src/prototype/main.jsx and mounted here with
 * live data. This file is the seam, not a screen.
 *
 * Everything the design draws has to be passed in, because the component
 * falls back to the prototype's constants otherwise — which is how a real
 * brand came to see "Atelier Minho", a silk slip dress it never posted and
 * two calls nobody arranged. Requests, orders and savings are this org's own;
 * scheduled calls have nothing behind them at all, so the card is hidden.
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
import { listRfqs } from "../../lib/domain/rfq.js";
import { listOrders } from "../../lib/domain/order.js";
import { listThreads } from "../../lib/domain/message.js";
import { inviteBrand, savingsFor } from "../../lib/domain/credits.js";
import { toProjectCard, toRfqCard } from "../live-adapter.js";
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

export default function LiveHome({ org, isFactory, goTo, onOpenActivity, onViewRfq, onViewProject }) {
  const [state, setState] = useState({ snapshot: null, rfqs: [], projects: [], savings: null });
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      dashboardSnapshot(org.id),
      listRfqs(org.id),
      listOrders(org.id),
      listThreads(org.id),
      savingsFor(org.id),
    ])
      .then(([snapshot, rfqs, orders, threads, savings]) => {
        if (cancelled) return;
        const messagesByRfq = new Map();
        for (const thread of threads ?? []) {
          if (!thread.rfq_id) continue;
          messagesByRfq.set(
            thread.rfq_id,
            (messagesByRfq.get(thread.rfq_id) ?? 0) + (Number(thread.message_count) || 0),
          );
        }
        setState({
          snapshot,
          // Open requests first: the design's "Active quotes" panel is about
          // what is still being quoted, not the archive.
          rfqs: (rfqs ?? [])
            .filter((rfq) => rfq.status === "open")
            .map((rfq) => toRfqCard(rfq, messagesByRfq.get(rfq.id) ?? 0)),
          projects: (orders ?? []).map((order) => toProjectCard(order, false)),
          savings,
        });
      })
      .catch((failure) => !cancelled && setError(failure));
    return () => { cancelled = true; };
  }, [org.id]);

  const { snapshot, rfqs, projects, savings } = state;
  const attention = attentionFrom(snapshot, isFactory, goTo) ?? [];

  return (
    <>
      {error && <p className="home-load-error" role="alert">{error.message}</p>}
      <HomeScreen
        // The newcomer layout — recommended vendors, "ready to start
        // sourcing?" — is for an account that genuinely has nothing yet, not
        // for one that simply has nothing outstanding today.
        dashboardState={rfqs.length || projects.length ? "active" : "newcomer"}
        goTo={goTo}
        onOpenActivity={onOpenActivity}
        orgName={org.name}
        attention={attention}
        rfqs={rfqs}
        projects={projects}
        savings={savings ? { ...savings, onInvite: (email) => inviteBrand(org.id, email) } : null}
        showCalls={false}
        onViewRfq={onViewRfq}
        onViewProject={onViewProject}
        unreadCount={Number(snapshot?.unread_messages) || 0}
      />
    </>
  );
}
