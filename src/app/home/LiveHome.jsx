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
import { chargedCents, listPaymentsForOrders } from "../../lib/domain/payment.js";
import { listArchivedOrderIds } from "../../lib/domain/order-tabs.js";
import { listThreads } from "../../lib/domain/message.js";
import { BRAND_INVITE_INTRO, BRAND_INVITE_MESSAGE, inviteBrand, inviteNotice, savingsFor } from "../../lib/domain/credits.js";
import { toProjectCard, toRfqCard } from "../live-adapter.js";
import { formatMoney } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";
import { initialsOf } from "../profile/factory-profile-view.js";
import { loadRecommendedVendors } from "../profile/load-profile.js";
import { browserTimeZone } from "../../lib/domain/calls.js";
import { dashboardCalls, inviteAttention } from "../message/live-calls.js";
import { useDashboardCalls } from "../message/use-calls.js";
import { useMessagesChanged } from "../message/use-unread.js";
import { useActivity } from "./use-activity.jsx";

/**
 * A recommended vendor as the designed dashboard card. Like the invite
 * step's cards, it leaves out what nothing records: the match (there is no
 * request to score against yet), a rating, and an order count a brand may
 * not read. A new brand has no conversations, so there is no Message.
 */
function toRecommendedCard(vendor, navigate) {
  const name = vendor.orgs?.name ?? "Vendor";
  return {
    // The card's key: two vendors can share a name.
    id: vendor.org_id,
    initials: initialsOf(name),
    name,
    location: vendor.location ?? "Location not given",
    trust: vendor.verification_status === "verified" ? (vendor.trust_tier ?? "basic") : "",
    match: vendor.matching ? `${Math.round(vendor.matching.score)}%${vendor.matching.status === "needs_confirmation" ? " provisional" : ""}` : "",
    matching: vendor.matching,
    rating: "",
    orders: "",
    stats: [
      ["MOQ", vendor.moq ? `${vendor.moq}/style` : "—"],
      ["Lead time", vendor.typical_lead_days ? `${vendor.typical_lead_days} days` : "—"],
      ["Type", vendor.vendor_kind === "trading_company" ? "Trading company" : "Factory"],
      ["Status", vendor.verification_status === "verified" ? "Verified" : "Unverified"],
    ],
    notes: [vendor.intro ?? ""],
    products: vendor.products,
    profileHref: `/app.html/factories/${vendor.org_id}?from=dashboard`,
    onOpenProfile: () => navigate(`/factories/${vendor.org_id}?from=dashboard`),
    onMessage: null,
    onRequestQuote: () => navigate(`/rfqs/new?invite=${vendor.org_id}`),
  };
}

/**
 * The snapshot, as the designed attention cards.
 *
 * Order is urgency: money the brand owes first, then work waiting on them,
 * then someone waiting on a reply. Nothing is invented — a count of zero
 * produces no card at all.
 */
function attentionFrom(snapshot, isFactory, goTo, dueCents = null) {
  if (!snapshot) return null;
  const items = [];
  const n = (value) => Number(value) || 0;

  if (!isFactory && n(snapshot.payments_due_cents) > 0) {
    items.push({
      type: "Payment",
      tone: "danger",
      title: `${formatMoney(dueCents ?? snapshot.payments_due_cents)} due`,
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
      meta: "Confirm the production steps to start production.",
      facts: [],
      action: "Confirm steps",
      onClick: () => goTo("projects"),
    });
  }

  if (n(snapshot.steps_awaiting_you) > 0) {
    items.push({
      type: "Step",
      tone: "warning",
      title: n(snapshot.steps_awaiting_you) === 1 ? "1 step needs you" : `${n(snapshot.steps_awaiting_you)} steps need you`,
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

export default function LiveHome({ org, isFactory, goTo, onViewRfq, onViewProject }) {
  const { navigate } = useRouter();
  const [state, setState] = useState({ snapshot: null, dueCents: null, rfqs: [], projects: [], savings: null, loaded: false });
  const [error, setError] = useState(null);
  // The bell is the Activity drawer's, so it counts unread activity, not
  // unread messages (those have their own card in "Needs your attention").
  const { unreadCount: unreadActivity, openActivity, activityDrawer } = useActivity(org.id, { isFactory, onError: setError });
  const [recommended, setRecommended] = useState([]);
  // What became of the invite just sent, on the Savings card it came from.
  const [inviteSent, setInviteSent] = useState(null);
  const { calls, zones, now } = useDashboardCalls(org.id);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      dashboardSnapshot(org.id),
      listRfqs(org.id),
      listOrders(org.id),
      listThreads(org.id),
      savingsFor(org.id),
      listArchivedOrderIds(org.id),
    ])
      .then(async ([snapshot, rfqs, orders, threads, savings, archivedIds]) => {
        // The snapshot owes step amounts; the brand pays each with the
        // service fee on top, as its Payments page and the Fund screen say.
        // Same payments as payments_due_cents: due or failed.
        const dueCents = !isFactory && Number(snapshot?.payments_due_cents) > 0
          ? (await listPaymentsForOrders((orders ?? []).filter((order) => order.brand_org_id === org.id).map((order) => order.id)))
            .filter((payment) => payment.state === "due" || payment.state === "failed")
            .reduce((total, payment) => total + chargedCents(payment), 0)
          : null;
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
          dueCents,
          // Open requests first: the design's "Active quotes" panel is about
          // what is still being quoted, not the archive.
          rfqs: (rfqs ?? [])
            .filter((rfq) => rfq.status === "open")
            .map((rfq) => toRfqCard(rfq, messagesByRfq.get(rfq.id) ?? 0)),
          // An order the company archived is out of its way here too.
          projects: (orders ?? [])
            .filter((order) => !archivedIds.includes(order.id))
            .map((order) => toProjectCard(order, false)),
          savings,
          loaded: true,
        });
      })
      .catch((failure) => !cancelled && setError(failure));
    return () => { cancelled = true; };
  }, [org.id, isFactory]);

  // "N unread messages" moves while the dashboard is open, as the bell does.
  useMessagesChanged(org.id, () => {
    dashboardSnapshot(org.id)
      .then((snapshot) => setState((current) => ({ ...current, snapshot })))
      .catch(() => {});
  });

  const { snapshot, dueCents, rfqs, projects, savings } = state;
  const ownZone = browserTimeZone() ?? "UTC";
  // "Join call" opens the conversation and joins there (LiveMessages reads ?join).
  const openCall = (call, { join = false } = {}) => navigate(`/messages/${call.thread_id}${join ? `?join=${call.id}` : ""}`);
  // A call invite waiting on the brand comes first: it has a time on it.
  const attention = [
    ...inviteAttention(calls, { orgId: org.id, ownZone, open: openCall, now }),
    ...(attentionFrom(snapshot, isFactory, goTo, dueCents) ?? []),
  ];
  const callCards = dashboardCalls(calls, { orgId: org.id, ownZone, zones, open: openCall, now });
  const isNewcomer = state.loaded && !rfqs.length && !projects.length;

  // Recommendations use real vendors rather than the prototype's examples.
  // They remain useful on established dashboards, independent of quote state.
  useEffect(() => {
    if (isFactory || !state.loaded) return undefined;
    let cancelled = false;
    loadRecommendedVendors(org.id)
      .then((vendors) => !cancelled && setRecommended(vendors))
      .catch((failure) => !cancelled && setError(failure));
    return () => { cancelled = true; };
  }, [org.id, isFactory, state.loaded]);

  return (
    <>
      {error && <p className="home-load-error" role="alert">{error.message}</p>}
      <HomeScreen
        // The newcomer layout — recommended vendors, "ready to start
        // sourcing?" — is for an account that genuinely has nothing yet, not
        // for one that simply has nothing outstanding today.
        dashboardState={rfqs.length || projects.length ? "active" : "newcomer"}
        factories={recommended.map((vendor) => toRecommendedCard(vendor, navigate))}
        goTo={goTo}
        onOpenActivity={openActivity}
        orgName={org.name}
        attention={attention}
        rfqs={rfqs}
        projects={projects}
        // A brand invite earns nothing yet, so the modal and its message
        // promise no discount.
        savings={savings ? {
          ...savings,
          inviteIntro: BRAND_INVITE_INTRO,
          inviteMessage: BRAND_INVITE_MESSAGE,
          notice: inviteSent,
          onInvite: async (email, message) => {
            setInviteSent(null);
            const result = await inviteBrand(org.id, email, message);
            setInviteSent(inviteNotice(result, { email, kind: "brand" }));
          },
        } : null}
        // No credit and no codes means no Savings panel, rather than the
        // design's $50 shown to a brand that has none.
        showSavings={Boolean(savings)}
        // The designed "Scheduled calls" card, only when there is a call.
        showCalls={callCards.length > 0}
        calls={callCards}
        showSearch={false}
        onViewRfq={onViewRfq}
        onViewProject={onViewProject}
        unreadCount={unreadActivity}
      />
      {activityDrawer}
    </>
  );
}
