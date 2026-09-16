/**
 * A production order, on Queena's designed screen.
 *
 * `ProjectDetailScreen` comes from src/prototype/main.jsx — the header strip,
 * the tabs, the milestone timeline. This file is the seam.
 *
 * Every figure comes from `production_order_summary`. JavaScript never sums
 * money and never decides whose turn it is: the order total is the sum of the
 * milestones, not of the quote, and the two diverge the moment either side
 * edits the schedule.
 */
import React, { useCallback, useEffect, useState } from "react";
import { ProjectDetailScreen } from "../../prototype/main.jsx";
import { getOrder } from "../../lib/domain/order.js";
import { approveMilestone, listMilestones, submitMilestone } from "../../lib/domain/milestone.js";
import { formatMoney } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";
import ScheduleEditor from "./ScheduleEditor.jsx";

const DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
const day = (value) => (value ? DAY.format(new Date(value)) : "");

/**
 * What this step is waiting for, and from whom.
 *
 * The design draws a fixed action per row. Live it depends on the state the
 * row is in and which side is looking: a factory cannot approve its own work,
 * and a brand cannot submit it. A row with nothing to do carries no button
 * rather than a disabled one.
 */
function actionFor(milestone, isFactory) {
  const payment = milestone.payment;

  if (!isFactory && payment?.state === "due") {
    return { action: "Fund milestone", tone: "primary", kind: "fund" };
  }
  if (isFactory && milestone.state === "active") {
    return { action: "Submit for approval", tone: "primary", kind: "submit" };
  }
  if (!isFactory && milestone.state === "submitted") {
    return { action: "Approve", tone: "primary", kind: "approve" };
  }
  if (milestone.state === "complete") return { action: "", tone: "", kind: "comment" };
  return { action: "Open", tone: "", kind: "comment" };
}

/** The sentence under a step's title, from its own state and its payment's. */
function statusLine(milestone, isFactory) {
  const payment = milestone.payment;

  if (milestone.state === "complete") return "Done";
  if (milestone.state === "submitted") return isFactory ? "Awaiting the brand's approval" : "Awaiting approval";
  if (milestone.state === "active") return isFactory ? "You can start this step" : "In progress";

  if (payment?.state === "sent") {
    return isFactory
      ? "Payment claimed, awaiting our confirmation"
      : "You have marked this sent — awaiting our confirmation";
  }
  if (payment?.state === "due") return isFactory ? "Awaiting payment from the brand" : "Payment due";
  return "";
}

export default function LiveOrderDetail({ org, orderId, isFactory }) {
  const { navigate } = useRouter();
  const [order, setOrder] = useState(null);
  const [milestones, setMilestones] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [row, steps] = await Promise.all([getOrder(orderId), listMilestones(orderId)]);
      setOrder(row);
      setMilestones(steps ?? []);
    } catch (failure) {
      setError(failure);
    }
  }, [orderId]);

  useEffect(() => { load(); }, [load]);

  async function act(milestone) {
    if (busy) return;

    if (milestone.kind === "fund" && milestone.paymentId) {
      navigate(`/orders/${orderId}/payments/${milestone.paymentId}`);
      return;
    }
    if (milestone.kind === "comment") {
      navigate(`/orders/${orderId}/steps/${milestone.id}`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (milestone.kind === "submit") await submitMilestone(milestone.id);
      if (milestone.kind === "approve") await approveMilestone(milestone.id, null);
      await load();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  if (!order) return null;

  /**
   * Before both sides agree the schedule there is no order interior to show —
   * no steps, no payments, nothing to fund. The designs have no screen for
   * that agreement, so rather than invent one, an order that has not been
   * agreed opens on the agreement itself. It is also the truthful order of
   * events: agree_schedule is what activates the order.
   */
  if (order.status === "pending_schedule") {
    return <ScheduleEditor org={org} orderId={orderId} isFactory={isFactory} onAgreed={load} />;
  }

  const money = (cents) => (cents == null ? "—" : formatMoney(cents, order.currency));
  const other = isFactory ? order.brand?.name : order.factory?.name;

  const shaped = milestones.map((milestone) => {
    const next = actionFor(milestone, isFactory);
    return {
      id: milestone.id,
      paymentId: milestone.payment?.id ?? null,
      title: milestone.title,
      meta: [
        milestone.payment?.state === "confirmed" ? "Funded" : null,
        milestone.due_on ? `due ${day(milestone.due_on)}` : null,
      ].filter(Boolean).join(" · "),
      // What this row is waiting for, said plainly. A factory must never be
      // left guessing whether it may start: the chain advances on a payment
      // being CONFIRMED, not on the brand saying it sent one, and the gap
      // between those two is exactly where someone starts work unpaid.
      dueStatus: statusLine(milestone, isFactory),
      dueTone: milestone.state === "submitted" ? "warning" : "",
      amount: milestone.amount_cents ? money(milestone.amount_cents) : "",
      description: milestone.description ?? "",
      ...next,
      update: milestone.state === "submitted",
    };
  });

  return (
    <>
      {error && <p className="composer-error" role="alert">{error.message}</p>}
      <ProjectDetailScreen
        goTo={() => navigate("/orders")}
        goToFundingMilestone={act}
        order={{
          title: order.rfqs?.title || order.order_number,
          subtitle: [other, order.order_number, order.activated_at ? `started ${day(order.activated_at)}` : null]
            .filter(Boolean)
            .join(" · "),
          total: money(order.total_cents),
          paid: money(order.paid_cents),
          remaining: money(order.outstanding_cents),
          nextPayment: money(order.next_payment_cents),
        }}
        milestones={shaped}
        busy={busy}
        onAction={(_kind, milestone) => act(milestone)}
      />
    </>
  );
}
