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
import { listTermsByKind } from "../../lib/domain/taxonomy.js";
import { CAPACITY_LEVELS, availableRange, capacityWindow, minutesPerPieceFor, monthKey } from "../../lib/domain/capacity.js";
import { formatMoney, formatRange } from "../../lib/money.js";
import { supabase } from "../../lib/supabase.js";
import { useRouter } from "../../lib/router.jsx";
import { toProjectCard } from "../live-adapter.js";

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

async function creditBalance(orgId) {
  const { data, error } = await supabase.rpc("credit_balance", { org: orgId });
  return error ? null : Number(data) || 0;
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
    chip: level === "open" ? `Open ${month}` : level === "partial" ? `Partly booked ${month}` : level === "full" ? `Full ${month}` : `${month} not set`,
    units: range ? `${range.min.toLocaleString()}-${range.max.toLocaleString()}` : "—",
  };
}

const SHORT_MONTH = (date) => date.toLocaleString("en", { month: "short", timeZone: "UTC" });

export default function LiveFactoryHome({ org, profile }) {
  const { navigate } = useRouter();
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);
  // The designed capacity drawer, opened from "Update capacity".
  const [drawer, setDrawer] = useState(null);

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
      setError(failure);
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
      setDrawer(null);
      setReload((value) => value + 1);
    } catch (failure) {
      setError(failure);
    }
  }

  const onUpdateCapacity = openCapacityDrawer;

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      dashboardSnapshot(org.id),
      listOpenRfqs(),
      listOrders(org.id),
      quotesSentThisMonth(org.id),
      creditBalance(org.id),
      capacityCard(org.id),
    ])
      .then(([snapshot, rfqs, orders, quotesSent, credits, capacity]) => {
        if (!cancelled) setState({ snapshot, rfqs, orders, quotesSent, credits, capacity });
      })
      .catch((failure) => !cancelled && setError(failure));
    return () => { cancelled = true; };
  }, [org.id, reload]);

  if (error) return <main className="factory-dashboard-page"><p className="home-load-error" role="alert">{error.message}</p></main>;
  if (!state) return null;

  const { snapshot, rfqs, orders, quotesSent, credits, capacity } = state;
  const n = (value) => Number(value) || 0;
  const isTrading = profile?.vendor_kind === "trading_company";
  const activeOrders = orders.filter((order) => order.status === "active");

  const attention = [];
  if (profile?.verification_status !== "verified") {
    attention.push({
      type: "Verification",
      tone: "success",
      title: "Verification in review",
      meta: "Brands can see your profile now. Quoting opens once your business registration is approved.",
      action: "View checklist",
      onAction: () => navigate("/team"),
    });
  }
  if (!isTrading && !capacity.set) {
    attention.push({
      type: "Capacity",
      tone: "danger",
      title: `Confirm ${capacity.title.replace(" capacity", "")} capacity`,
      meta: "Keep your available capacity current so RFQ matches stay accurate.",
      action: "Update",
      onAction: onUpdateCapacity,
    });
  }
  if (n(snapshot?.orders_awaiting_schedule) > 0) {
    attention.push({
      type: "Schedule",
      tone: "warning",
      title: `${snapshot.orders_awaiting_schedule} order${snapshot.orders_awaiting_schedule === 1 ? "" : "s"} awaiting a schedule`,
      meta: "Both sides have to agree the steps before production can begin.",
      action: "Review",
      onAction: () => navigate("/orders"),
    });
  }
  if (n(snapshot?.steps_awaiting_you) > 0) {
    attention.push({
      type: "Sample",
      tone: "warning",
      title: `${snapshot.steps_awaiting_you} production step${snapshot.steps_awaiting_you === 1 ? "" : "s"} need an update`,
      meta: "Post an update so the brand can review and approve.",
      action: "Update",
      onAction: () => navigate("/orders"),
    });
  }
  if (n(snapshot?.unread_messages) > 0) {
    attention.push({
      type: "Question",
      tone: "info",
      title: `${snapshot.unread_messages} unread message${snapshot.unread_messages === 1 ? "" : "s"}`,
      meta: "A brand is waiting on a reply.",
      action: "Reply",
      onAction: () => navigate("/messages"),
    });
  }

  const hasHistory = orders.length > 0 || n(quotesSent) > 0;
  const nextDue = n(snapshot?.payments_due_cents) > 0 ? `${formatMoney(snapshot.payments_due_cents)} due` : null;

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
      dashboardState={hasHistory ? "active" : "newcomer"}
      language="en"
      orgName={org.name}
      creditBalance={credits ?? 0}
      unreadCount={n(snapshot?.unread_messages)}
      rfqs={rfqs.map(toDashboardRfq)}
      projects={activeOrders.map((order) => {
        const card = toProjectCard(order, true);
        return { ...card, brand: card.factory, initials: initialsOf(card.factory), images: card.image ? [{ src: card.image }] : [] };
      })}
      metrics={[
        { label: "Open RFQs", value: String(rfqs.length), note: "Open to quote now", tone: "blue" },
        { label: "Quotes sent this month", value: String(quotesSent ?? 0), note: n(snapshot?.quotes_to_compare) ? `${snapshot.quotes_to_compare} awaiting brand review` : "Sent since the 1st", tone: "green" },
        { label: "Active production orders", value: String(activeOrders.length), note: nextDue ?? `${n(snapshot?.steps_awaiting_you)} need updates`, tone: "amber" },
      ]}
      capacity={capacity}
      attention={attention}
      onUpdateCapacity={onUpdateCapacity}
      onPurchaseCredits={() => navigate("/payout")}
      onViewRfqs={() => navigate("/browse")}
      onBrowseRfqs={() => navigate("/browse")}
      onViewRfqDetail={(rfq) => navigate(rfq?.id ? `/browse/${rfq.id}` : "/browse")}
      onViewProjects={(project) => navigate(project?.id ? `/orders/${project.id}` : "/orders")}
      onViewProfile={() => navigate("/team")}
      onOpenActivity={() => navigate("/notifications")}
    />
    </>
  );
}
