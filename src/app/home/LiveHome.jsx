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
import React, { useEffect, useMemo, useState } from "react";
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
import { useVendorTranslations } from "../browse/useVendorTranslations.js";
import { loadRecommendedVendors } from "../profile/load-profile.js";
import { browserTimeZone } from "../../lib/domain/calls.js";
import { dashboardCalls, inviteAttention } from "../message/live-calls.js";
import { useDashboardCalls } from "../message/use-calls.js";
import { useMessagesChanged } from "../message/use-unread.js";
import { useActivity } from "./use-activity.jsx";
import HomeHolding, { HomeNotice, useHomeNotice } from "./HomeHolding.jsx";
import { brandHasHistory, followRead, homeLayout, withinCap } from "./home-layout.mjs";

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
function attentionFrom(snapshot, isFactory, goTo, owed = [], navigate = null) {
  if (!snapshot) return null;
  const items = [];
  const n = (value) => Number(value) || 0;

  // The figure, the words and the button all come from the same payments
  // (due or failed, the fee included, as the Fund screen charges them). With
  // none readable there is nothing to show, never "$0.00 due".
  if (!isFactory && n(snapshot.payments_due_cents) > 0 && owed.length) {
    const one = owed.length === 1 ? owed[0] : null;
    const failed = owed.filter((payment) => payment.state === "failed").length;
    items.push({
      type: "Payment",
      tone: "danger",
      title: `${formatMoney(owed.reduce((total, payment) => total + chargedCents(payment), 0), owed[0].currency)} due`,
      meta: one
        ? failed
          ? "This payment did not go through. Pay again so the production step can start."
          : "A production step is waiting on this payment before it can start."
        : `${owed.length} production steps are waiting on payment${failed ? `, and ${failed === 1 ? "one" : failed} did not go through` : ""}.`,
      facts: [],
      // One payment opens its Fund screen; several open Payments, which lists each.
      action: one ? "Fund milestone" : "View payments",
      onClick: () => navigate(one ? `/orders/${one.order_id}/payments/${one.id}` : "/payments"),
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

/** The brand's payments that are due or failed: what the payment card is about. */
async function owedPayments(orgId, orders, isFactory, snapshot) {
  if (isFactory || !(Number(snapshot?.payments_due_cents) > 0)) return [];
  const own = (orders ?? []).filter((order) => order.brand_org_id === orgId).map((order) => order.id);
  return (await listPaymentsForOrders(own)).filter((payment) => payment.state === "due" || payment.state === "failed");
}

export default function LiveHome({ org, isFactory, goTo, onViewRfq, onViewProject }) {
  const { navigate } = useRouter();
  const [state, setState] = useState({ snapshot: null, owed: [], rfqs: [], projects: [], savings: null, hasHistory: false, loaded: false });
  // The first read failed: nothing is known, so no layout can be drawn.
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Something later did not go through, on a dashboard that is still right.
  const [notice, setNotice] = useHomeNotice();
  // The bell is the Activity drawer's, so it counts unread activity, not
  // unread messages (those have their own card in "Needs your attention").
  const { unreadCount: unreadActivity, openActivity, activityDrawer } = useActivity(org.id, {
    isFactory,
    onError: () => setNotice("That didn't go through. Check your connection and try again."),
  });
  const [vendors, setVendors] = useState({ list: [], answered: false });
  const recommended = vendors.list;
  // What became of the invite just sent, on the Savings card it came from.
  const [inviteSent, setInviteSent] = useState(null);
  const { calls, zones, now, loaded: callsLoaded } = useDashboardCalls(org.id);

  useEffect(() => {
    let cancelled = false;
    // Slower than the cap, the page draws without them and they fill their
    // panel when they come. On a slow line that is the usual case, not a failure.
    const vendorsRead = isFactory ? Promise.resolve([]) : loadRecommendedVendors(org.id).catch((failure) => {
      console.warn("recommended vendors", failure?.message);
      return [];
    });
    const stopFollowing = followRead(vendorsRead, setVendors);
    Promise.all([
      dashboardSnapshot(org.id),
      listRfqs(org.id),
      listOrders(org.id),
      listThreads(org.id),
      savingsFor(org.id),
      listArchivedOrderIds(org.id),
      // Waited for with the rest, so the first full paint is usually the final one.
      withinCap(vendorsRead, null),
    ])
      .then(async ([snapshot, rfqs, orders, threads, savings, archivedIds]) => {
        // The snapshot owes step amounts; the brand pays each with the
        // service fee on top, as its Payments page and the Fund screen say.
        // Same payments as payments_due_cents: due or failed.
        const owed = await owedPayments(org.id, orders, isFactory, snapshot);
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
          owed,
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
          hasHistory: brandHasHistory(rfqs, orders),
          loaded: true,
        });
      })
      .catch((failure) => {
        if (cancelled) return;
        console.warn("dashboard", failure?.message);
        setFailed(true);
      });
    return () => {
      cancelled = true;
      stopFollowing();
    };
  }, [org.id, isFactory, attempt]);

  // "N unread messages" moves while the dashboard is open, as the bell does.
  useMessagesChanged(org.id, () => {
    dashboardSnapshot(org.id)
      .then((snapshot) => setState((current) => ({ ...current, snapshot })))
      .catch(() => {});
  });

  // Paid in another tab (or on the Fund screen and back): the payment card
  // is read again when the dashboard is looked at, so it never asks for money
  // already paid.
  useEffect(() => {
    if (isFactory) return undefined;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      Promise.all([dashboardSnapshot(org.id), listOrders(org.id)])
        .then(async ([snapshot, orders]) => {
          const next = await owedPayments(org.id, orders, isFactory, snapshot);
          setState((current) => ({ ...current, snapshot, owed: next }));
        })
        .catch(() => {});
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [org.id, isFactory]);

  const { snapshot, owed, rfqs, projects, savings } = state;
  const ownZone = browserTimeZone() ?? "UTC";
  // "Join call" opens the conversation and joins there (LiveMessages reads ?join).
  const openCall = (call, { join = false } = {}) => navigate(`/messages/${call.thread_id}${join ? `?join=${call.id}` : ""}`);
  // A call invite waiting on the brand comes first: it has a time on it.
  const attention = [
    ...inviteAttention(calls, { orgId: org.id, ownZone, open: openCall, now }),
    ...(attentionFrom(snapshot, isFactory, goTo, owed, navigate) ?? []),
  ];
  const callCards = dashboardCalls(calls, { orgId: org.id, ownZone, zones, open: openCall, now });
  const layout = homeLayout({
    status: failed ? "failed" : state.loaded && callsLoaded ? "ready" : "loading",
    hasHistory: state.hasHistory,
  });
  const retry = () => {
    setFailed(false);
    setAttempt((value) => value + 1);
  };

  const recommendedCards = useMemo(() => recommended.map((vendor) => toRecommendedCard(vendor, navigate)), [recommended, navigate]);
  const translatedRecommended = useVendorTranslations(recommendedCards, org.id);

  return (
    <>
      <HomeNotice text={notice} />
      <HomeScreen
        // The newcomer layout — recommended vendors, "ready to start
        // sourcing?" — is for an account that genuinely has nothing yet, not
        // for one that simply has nothing outstanding today, and never for one
        // whose answer has not arrived.
        dashboardState={layout}
        holding={layout === "loading" || layout === "failed"
          ? <HomeHolding failed={layout === "failed"} onRetry={retry} />
          : null}
        factories={translatedRecommended}
        vendorsPending={!vendors.answered}
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
