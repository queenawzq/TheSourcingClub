/**
 * The factory dashboard, on Queena's designed screen.
 *
 * `FactoryDashboardPage` is imported from src/factory-prototype/main.jsx and
 * mounted here with live data. This file is the seam, not a screen. The
 * factory portal used to render the BRAND home here, which is why it looked
 * nothing like the factory design.
 *
 * Nothing on it is invented. Fit badges and scheduled calls have nothing
 * behind them yet, so the live mount goes without; every count is a count of
 * real rows, and a card in "needs your attention" only appears when there is
 * something behind it.
 */
import React, { useEffect, useState } from "react";
import { FactoryCapacityDrawer, FactoryDashboardPage } from "../../factory-prototype/main.jsx";
import { dashboardSnapshot } from "../../lib/domain/dashboard.js";
import { listOpenRfqs } from "../../lib/domain/rfq.js";
import { listOrders } from "../../lib/domain/order.js";
import { getCapacity, saveCapacity } from "../../lib/domain/capacity-store.js";
import { FACTORY_CREDIT_NOTE, FACTORY_INVITE_INTRO, creditBalance, sendInvite } from "../../lib/domain/credits.js";
import { listTermsByKind } from "../../lib/domain/taxonomy.js";
import { CAPACITY_LEVELS, availableRange, capacityWindow, minutesPerPieceFor, monthKey } from "../../lib/domain/capacity.js";
import { formatMoney, formatRange } from "../../lib/money.js";
import { supabase } from "../../lib/supabase.js";
import { connectAccountFor } from "../../lib/domain/stripe.js";
import { useRouter } from "../../lib/router.jsx";
import { toProjectCard } from "../live-adapter.js";
import { browserTimeZone } from "../../lib/domain/calls.js";
import { dashboardCalls, inviteAttention } from "../message/live-calls.js";
import { useDashboardCalls } from "../message/use-calls.js";
import { useMessagesChanged } from "../message/use-unread.js";
import { useActivity } from "./use-activity.jsx";
import HomeHolding, { HomeNotice, useHomeNotice } from "./HomeHolding.jsx";
import { factoryHasHistory, homeLayout } from "./home-layout.mjs";
import { can, permissionHint } from "../../lib/domain/org.js";

const MONTH = new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" });
const DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });

const initialsOf = (name) =>
  (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("") || "??";

/** An open request, in the shape the designed dashboard row reads. */
function toDashboardRfq(rfq) {
  return {
    id: rfq.id,
    initials: initialsOf(rfq.orgs?.name),
    title: rfq.title || "Untitled request",
    brand: rfq.orgs?.name ?? "A brand",
    location: rfq.quote_deadline ? `Quote due ${DAY.format(new Date(rfq.quote_deadline))}` : "",
    trust: rfq.requires_sample ? "Sample before bulk" : "",
    facts: [
      ["Unit target", formatRange(rfq.target_unit_price_min_cents, rfq.target_unit_price_max_cents, rfq.currency)],
      ["Quantity", rfq.quantity_total ? `${rfq.quantity_total.toLocaleString()} units` : "—"],
    ],
    description: rfq.brief ?? rfq.material_notes ?? "",
    images: [],
  };
}

/** Quotes this factory has sent since the first of the month. */
async function quotesSentThisMonth(orgId) {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const { count, error } = await supabase
    .from("quotes")
    .select("id", { count: "exact", head: true })
    .eq("factory_org_id", orgId)
    .neq("status", "draft")
    .gte("submitted_at", start.toISOString());
  return error ? null : count ?? 0;
}

/** Whether this factory has ever sent a quote: which layout it sees depends on it. */
async function hasEverQuoted(orgId) {
  const { count, error } = await supabase
    .from("quotes")
    .select("id", { count: "exact", head: true })
    .eq("factory_org_id", orgId)
    .neq("status", "draft");
  if (error) throw error;
  return (count ?? 0) > 0;
}

/** This month's booking level and the pieces it leaves, for the capacity card. */
async function capacityCard(orgId) {
  const { capacity, months } = await getCapacity(orgId);
  let minutes;
  if (capacity?.category_term_id) {
    const { data } = await supabase.from("taxonomy_terms").select("extra").eq("id", capacity.category_term_id).maybeSingle();
    minutes = minutesPerPieceFor(data);
  }

  const now = new Date();
  const month = MONTH.format(now);
  const level = months[monthKey(now)];
  const range = capacity ? availableRange(capacity, level ?? "open", minutes) : null;

  return {
    set: Boolean(capacity && level),
    title: `${month} capacity`,
    level: level ? CAPACITY_LEVELS[level].labelEn : "Not set yet",
    chip: level ? month : `${month} not set`,
    units: range ? `${range.min.toLocaleString()}-${range.max.toLocaleString()}` : "—",
  };
}

const n = (value) => Number(value) || 0;

const SHORT_MONTH = (date) => date.toLocaleString("en", { month: "short", timeZone: "UTC" });

export default function LiveFactoryHome({ org, profile }) {
  const { navigate } = useRouter();
  const [state, setState] = useState(null);
  // The first read failed: nothing is known, so no layout can be drawn.
  const [failed, setFailed] = useState(false);
  // Something later did not go through, on a dashboard that is still right.
  const [notice, setNotice] = useHomeNotice();
  const [reload, setReload] = useState(0);
  // The designed capacity drawer, opened from "Update capacity".
  const [drawer, setDrawer] = useState(null);
  const { calls, zones, now, loaded: callsLoaded } = useDashboardCalls(org.id);
  const { unreadCount: unreadNotifications, openActivity, activityDrawer } = useActivity(org.id, {
    isFactory: true,
    onError: () => setNotice("That didn't go through. Check your connection and try again."),
  });

  async function openCapacityDrawer() {
    try {
      const [{ capacity, months }, byKind] = await Promise.all([getCapacity(org.id), listTermsByKind(["capacity_category"])]);
      const categories = byKind.capacity_category ?? [];
      const window = capacityWindow(6);
      const named = {};
      for (const date of window) {
        const level = months[monthKey(date)];
        if (level) named[SHORT_MONTH(date)] = level;
      }
      setDrawer({
        categories,
        window,
        initial: {
          inputMode: capacity?.input_mode ?? "units",
          lineHours: capacity?.line_hours ? String(capacity.line_hours) : "",
          units: capacity?.monthly_units ? String(capacity.monthly_units) : "",
          category: categories.find((term) => term.id === capacity?.category_term_id)?.slug,
          months: named,
        },
      });
    } catch (failure) {
      console.warn("capacity", failure?.message);
      setNotice("Your capacity couldn't be opened. Check your connection and try again.");
    }
  }

  async function saveCapacityFromDrawer(_, answer) {
    const term = drawer.categories.find((item) => item.slug === answer.category);
    const byKey = {};
    for (const date of drawer.window) {
      const level = answer.months[SHORT_MONTH(date)];
      if (level) byKey[monthKey(date)] = level;
    }
    try {
      await saveCapacity(
        org.id,
        { category_term_id: term?.id ?? null, input_mode: answer.inputMode, line_hours: answer.lineHours, monthly_units: answer.units },
        byKey,
      );
      setNotice(null);
      setDrawer(null);
      setReload((value) => value + 1);
    } catch (failure) {
      console.warn("capacity", failure?.message);
      setDrawer(null);
      setNotice("Your capacity wasn't saved. Check your connection and try again.");
    }
  }

  const onUpdateCapacity = openCapacityDrawer;

  // Money it can't receive: asked for only once all three reads say so, and only
  // of an owner, who alone can add a method. It holds nothing else on the page up.
  const [noWayToBePaid, setNoWayToBePaid] = useState(false);
  useEffect(() => {
    if (org.role !== "owner") return undefined;
    let cancelled = false;
    Promise.all([
      supabase.from("factory_payout_accounts").select("id", { count: "exact", head: true }).eq("org_id", org.id),
      connectAccountFor(org.id),
      supabase.from("order_payments").select("id, production_orders!inner (factory_org_id, status)", { count: "exact", head: true })
        .eq("state", "confirmed").eq("production_orders.factory_org_id", org.id).neq("production_orders.status", "cancelled"),
    ]).then(([methods, stripeAccount, money]) => {
      if (cancelled || methods.error || money.error) return;
      setNoWayToBePaid(methods.count === 0 && !stripeAccount?.transfers_active && money.count > 0);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [org.id, org.role]);

  useEffect(() => {
    let cancelled = false;
    // Re-reading after a save keeps the dashboard that is already drawn.
    const firstRead = !state;
    Promise.all([
      dashboardSnapshot(org.id),
      listOpenRfqs(),
      listOrders(org.id),
      quotesSentThisMonth(org.id),
      creditBalance(org.id),
      capacityCard(org.id),
      hasEverQuoted(org.id),
    ])
      .then(([snapshot, rfqs, orders, quotesSent, credits, capacity, everQuoted]) => {
        if (!cancelled) setState({ snapshot, rfqs, orders, quotesSent, credits, capacity, everQuoted });
      })
      .catch((failure) => {
        if (cancelled) return;
        console.warn("dashboard", failure?.message);
        if (firstRead) setFailed(true);
        else setNotice("We couldn't refresh your dashboard. Check your connection and try again.");
      });
    return () => { cancelled = true; };
  }, [org.id, reload]);

  // "N unread messages" moves while the dashboard is open, as the bell does.
  useMessagesChanged(org.id, () => {
    dashboardSnapshot(org.id)
      .then((snapshot) => setState((current) => (current ? { ...current, snapshot } : current)))
      .catch(() => {});
  });

  const isTrading = profile?.vendor_kind === "trading_company";
  const layout = homeLayout({
    status: failed ? "failed" : state && callsLoaded ? "ready" : "loading",
    hasHistory: factoryHasHistory(state?.orders, state?.everQuoted),
  });
  if (layout === "loading" || layout === "failed") {
    return (
      <>
        <FactoryDashboardPage
          companyType={isTrading ? "trading" : "factory"}
          dashboardState={layout}
          language="en"
          orgName={org.name}
          unreadCount={n(unreadNotifications)}
          onOpenActivity={openActivity}
          holding={(
            <HomeHolding
              failed={layout === "failed"}
              onRetry={() => {
                setFailed(false);
                setReload((value) => value + 1);
              }}
            />
          )}
        />
        {activityDrawer}
      </>
    );
  }

  const { snapshot, rfqs, orders, quotesSent, credits, capacity } = state;
  // The design opens the profile from here, for either kind of vendor.
  const profilePath = "/profile";
  const activeOrders = orders.filter((order) => order.status === "active");

  const ownZone = browserTimeZone() ?? "UTC";
  // "Join call" opens the conversation and joins there (LiveMessages reads ?join).
  const openCall = (call, { join = false } = {}) => navigate(`/messages/${call.thread_id}${join ? `?join=${call.id}` : ""}`);
  // A call invite waiting on the factory comes first: it has a time on it.
  const attention = inviteAttention(calls, { orgId: org.id, ownZone, open: openCall, now });
  if (profile?.verification_status !== "verified") {
    attention.push({
      type: "Verification",
      tone: "success",
      title: "Verification in review",
      meta: "Brands can see your profile now. Quoting opens once your business registration is approved.",
      action: "View checklist",
      // The checklist is the profile's completion page.
      onAction: () => navigate("/profile/completion"),
    });
  }
  if (noWayToBePaid) {
    attention.push({
      type: "Payment",
      tone: "danger",
      title: "Add a withdrawal method",
      meta: "",
      action: "Add",
      onAction: () => navigate("/payout"),
    });
  }
  if (!isTrading && !capacity.set) {
    attention.push({
      type: "Capacity",
      tone: "danger",
      title: `Confirm ${capacity.title.replace(" capacity", "")} capacity`,
      meta: "",
      action: "Update",
      onAction: onUpdateCapacity,
    });
  }
  if (n(snapshot?.orders_awaiting_schedule) > 0) {
    attention.push({
      type: "Schedule",
      tone: "warning",
      title: `${snapshot.orders_awaiting_schedule} order${snapshot.orders_awaiting_schedule === 1 ? "" : "s"} awaiting a schedule`,
      meta: "",
      action: "Review",
      onAction: () => {
        const waiting = orders.filter((order) => order.status === "pending_schedule");
        navigate(waiting.length === 1 ? `/orders/${waiting[0].id}` : "/orders");
      },
    });
  }
  if (n(snapshot?.steps_awaiting_you) > 0) {
    attention.push({
      type: "Sample",
      tone: "warning",
      title: n(snapshot.steps_awaiting_you) === 1 ? "1 production step needs an update" : `${n(snapshot.steps_awaiting_you)} production steps need an update`,
      meta: "",
      action: "Update",
      onAction: () => {
        const waiting = activeOrders.filter((order) => order.order_milestones?.some((step) => step.state === "active"));
        navigate(waiting.length === 1 ? `/orders/${waiting[0].id}` : "/orders");
      },
    });
  }
  if (n(snapshot?.unread_messages) > 0) {
    attention.push({
      type: "Question",
      tone: "info",
      title: `${snapshot.unread_messages} unread message${snapshot.unread_messages === 1 ? "" : "s"}`,
      meta: "",
      action: "Reply",
      onAction: () => navigate("/messages"),
    });
  }

  // What brands still have to fund on this factory's orders: "due" alone read
  // as if the factory owed it.
  const nextDue = n(snapshot?.payments_due_cents) > 0 ? `${formatMoney(snapshot.payments_due_cents)} awaiting brand funding` : null;

  return (
    <>
    {drawer && (
      <FactoryCapacityDrawer
        language="en"
        initial={drawer.initial}
        months={drawer.window.map(SHORT_MONTH)}
        onClose={() => setDrawer(null)}
        onSaveCapacity={saveCapacityFromDrawer}
      />
    )}
    <FactoryDashboardPage
      companyType={isTrading ? "trading" : "factory"}
      dashboardState={layout}
      notice={<HomeNotice text={notice} />}
      language="en"
      orgName={org.name}
      creditBalance={credits ?? 0}
      unreadCount={n(unreadNotifications)}
      rfqs={rfqs.map(toDashboardRfq)}
      projects={activeOrders.map((order) => {
        const card = toProjectCard(order, true);
        return { ...card, brand: card.factory, initials: initialsOf(card.factory), images: card.image ? [{ src: card.image }] : [] };
      })}
      metrics={[
        { label: "Open RFQs", value: String(rfqs.length), note: "Open to quote now", tone: "blue" },
        { label: "Quotes sent this month", value: String(quotesSent ?? 0), note: n(snapshot?.quotes_awaiting_decision) ? `${snapshot.quotes_awaiting_decision} awaiting brand review` : "Sent since the 1st", tone: "green" },
        { label: "Active production orders", value: String(activeOrders.length), note: nextDue ?? `${n(snapshot?.steps_awaiting_you)} need updates`, tone: "amber" },
      ]}
      capacity={capacity}
      rfqPanelTitle="Open RFQs"
      attention={attention}
      calls={dashboardCalls(calls, { orgId: org.id, ownZone, zones, open: openCall, now })}
      onUpdateCapacity={onUpdateCapacity}
      onPurchaseCredits={() => navigate("/payout?tab=credits")}
      purchaseCreditsLocked={can(org, "settingsAccess") ? "" : permissionHint(org, "settingsAccess")}
      creditNote={FACTORY_CREDIT_NOTE}
      inviteIntro={FACTORY_INVITE_INTRO}
      // The Credits tab says what became of it, under the invite's own row.
      onInviteFactory={async (email, message) => {
        const result = await sendInvite(org.id, email, message);
        navigate(`/payout?tab=credits&invite=${result.emailed ? "sent" : result.reason ?? "saved"}`);
      }}
      onViewRfqs={() => navigate("/browse")}
      onBrowseRfqs={() => navigate("/browse")}
      onViewRfqDetail={(rfq) => navigate(rfq?.id ? `/browse/${rfq.id}?from=dashboard` : "/")}
      onViewProjects={(project) => navigate(project?.id ? `/orders/${project.id}` : "/orders")}
      onViewProfile={() => navigate(profilePath)}
      onOpenActivity={openActivity}
    />
    {activityDrawer}
    </>
  );
}
