/**
 * A production order, on Queena's designed screens: each side its own.
 *
 * The brand gets `ProjectDetailScreen` from src/prototype/main.jsx, the
 * factory `FactoryProjectProgressDetail` from src/factory-prototype/main.jsx —
 * the header strip, the tabs, the milestone timeline, the side panel and the
 * dialogs. This file is the seam: one load, shaped once, and every panel the
 * designs draw with an example gets the real thing here, or nothing.
 *
 * Every figure comes from `production_order_summary`. JavaScript never sums
 * money and never decides whose turn it is: the order total is the sum of the
 * milestones, not of the quote, and the two diverge the moment either side
 * edits the schedule.
 *
 * The brand pays each step with the service fee on top, and its Payments
 * page and Fund screen say so, so its order page shows what it pays too: the
 * header and each step's amount come from `production_order_charges` and
 * `order_step_charges`, the same figures summed in SQL with the fee
 * (migration 20261023000300). The factory is paid the step amount and keeps
 * reading the summary.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProjectDetailScreen } from "../../prototype/main.jsx";
import { FactoryProjectProgressDetail } from "../../factory-prototype/main.jsx";
import { StepUpdatesModal } from "../../shared/StepUpdatesModal.jsx";
import { getOrder, orderActivity } from "../../lib/domain/order.js";
import { can, needsPermission } from "../../lib/domain/org.js";
import {
  approveMilestone,
  listMilestones,
  listOrderUpdates,
  initiateDispute,
  postUpdate,
  remindMilestone,
} from "../../lib/domain/milestone.js";
import { brandSummary } from "../../lib/domain/rfq.js";
import { requestRelease } from "../../lib/domain/stripe.js";
import { downloadDocument, urlFor } from "../../lib/domain/documents.js";
import { getContractAttachments } from "../../lib/domain/contract-attachments.js";
import { listTerms, termLabel } from "../../lib/domain/taxonomy.js";
import { formatMoney } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";
import { supabase } from "../../lib/supabase.js";
import { BrandSchedule } from "./ScheduleBuilder.jsx";
import CancelNotice from "./CancelNotice.jsx";
import useOrderCancel from "./useOrderCancel.jsx";
import {
  activityLines,
  day,
  describeOrderContract,
  initials,
  latestUpdateFor,
  locationLine,
  orderFiles,
  updateTime,
} from "./order-view.js";
import { dateFrom } from "../../lib/dates.js";
import "../profile/profile.css";

/**
 * Whether the brand can approve this step now. The factory's update is what
 * the brand approves from: there is no separate "send for approval" on the
 * designed screens, so an open step is approvable once the factory has posted
 * on it (approve_milestone checks the same). A step sent for approval the old
 * way still is.
 */
const approvable = (milestone, posted) =>
  milestone.kind !== "payment_only"
  && (milestone.state === "submitted" || (milestone.state === "active" && posted));

/** An open step the factory has not posted on yet: nothing to approve. */
const awaitingFirstUpdate = (milestone, posted) =>
  milestone.kind !== "payment_only" && milestone.state === "active" && !posted;

/**
 * What this step is waiting for, and from whom.
 *
 * The design draws a fixed action per row: "Approve", or "Fund milestone".
 * Live it depends on the state the row is in and which side is looking: a
 * factory never approves its own work, it posts updates from the row's menu.
 * A row with nothing to do carries no button rather than a disabled one.
 */
function actionFor(milestone, { isFactory, canFund, canApprove, posted, factoryName }) {
  const payment = milestone.payment;
  const none = { action: "", tone: "", kind: "" };

  if (isFactory) return none;
  // A paid step is funded before the work; a payment that came back is paid
  // again the same way. Release funds pays (begin_payment_checkout).
  if (payment?.state === "due" || payment?.state === "failed") {
    return canFund ? { action: "Fund milestone", tone: "primary", kind: "fund" } : none;
  }
  // approve_milestone refuses a paid step until its money is held.
  if (payment && milestone.kind === "approval_and_payment" && payment.state !== "confirmed") return none;
  if (approvable(milestone, posted)) {
    // approve_milestone asks for Approve samples, and Release funds too on a
    // paying step; say so on the row instead of a dialog that can only fail.
    if (!canApprove || (milestone.kind === "approval_and_payment" && !canFund)) return none;
    return {
      action: milestone.kind === "approval_and_payment" ? "Approve fund" : "Approve",
      tone: "primary",
      kind: "approve",
    };
  }
  // Open, but the factory has posted nothing: approve_milestone refuses it,
  // so the button stays in place, disabled, and the status line says why.
  if (awaitingFirstUpdate(milestone, posted)) {
    if (!canApprove || (milestone.kind === "approval_and_payment" && !canFund)) return none;
    return {
      action: milestone.kind === "approval_and_payment" ? "Approve fund" : "Approve",
      tone: "primary",
      kind: "approve",
      actionDisabled: true,
      actionDisabledReason: `Available once ${factoryName || "the factory"} posts an update`,
    };
  }
  // Keep the next action visible on every upcoming step. The database still
  // owns sequencing, so a future CTA is disabled until that step opens rather
  // than disappearing and leaving the schedule without a clear action. Only
  // to someone who will be able to press it once it opens.
  if (milestone.state === "pending") {
    if (milestone.kind === "payment_only" && payment?.state === "not_due") {
      return canFund ? { action: "Fund milestone", tone: "primary", kind: "fund", actionDisabled: true } : none;
    }
    if (milestone.kind === "approval_and_payment") {
      return canApprove && canFund ? { action: "Approve fund", tone: "primary", kind: "approve", actionDisabled: true } : none;
    }
    if (milestone.kind === "approval_only") {
      return canApprove ? { action: "Approve", tone: "primary", kind: "approve", actionDisabled: true } : none;
    }
  }
  return none;
}

/**
 * Where the step's money is, in words. TSC holds a funded payment until the
 * brand approves the step, then pays the factory; a payment-only step (a
 * deposit or balance) has nothing to approve and is paid out once funded.
 */
function paymentLine(payment, isFactory, kind) {
  switch (payment?.state) {
    case "due":
      return isFactory ? "Awaiting funding from the brand" : "Awaiting funding";
    case "processing":
      return "Payment processing";
    case "failed":
      return `Payment failed: ${payment.failure_reason || "the payment did not go through"}`;
    case "sent":
      // A bank-wire claim from before payments moved to Stripe.
      return isFactory
        ? "Payment claimed, awaiting our confirmation"
        : "You have marked this sent — awaiting our confirmation";
    case "confirmed":
      if (!payment.release_requested_at) return "Funded: held by TSC";
      return kind === "payment_only" ? "Funded: payout on its way" : "Approved: payout on its way";
    case "released":
      return "Paid out";
    default:
      return "";
  }
}

/** The sentence under a step's title, from its own state and its payment's. */
function statusLine(milestone, { isFactory, canFund, canApprove, org, factoryName, posted }) {
  const payment = milestone.payment;
  const money = paymentLine(payment, isFactory, milestone.kind);

  if (milestone.state === "complete") {
    return payment?.state === "confirmed" || payment?.state === "released" ? `Done · ${money}` : "Done";
  }
  // Funding comes before the work, so an unfunded step says so first.
  if (["due", "processing", "failed", "sent"].includes(payment?.state) && milestone.state !== "pending") {
    // Without Release funds there is no "Fund milestone" (actionFor): say why.
    if (!isFactory && !canFund && (payment.state === "due" || payment.state === "failed")) {
      return `${money}. Only someone with Release funds at ${org?.name || "your company"} can pay for it`;
    }
    return money;
  }
  if (approvable(milestone, posted)) {
    const held = payment?.state === "confirmed" ? ` · ${money}` : "";
    if (isFactory) return `Posted, awaiting the brand's approval${held}`;
    if (milestone.kind === "approval_and_payment" && !(canApprove && canFund)) {
      return `Ready for approval by someone with Approve samples and Release funds${held}`;
    }
    if (!canApprove) return `Ready for approval by someone with Approve samples${held}`;
    return `Ready for your approval${held}`;
  }
  if (milestone.state === "active") {
    // The brand approves from the factory's update, so before there is one
    // it is told what it is waiting for rather than offered an approval.
    const work = isFactory
      ? "You can start this step"
      : milestone.kind === "payment_only"
        ? "In progress"
        : `Waiting for ${factoryName || "the factory"}'s first update. You can approve once it posts`;
    return payment?.state === "confirmed" ? `${work} · ${money}` : work;
  }
  return money;
}

/**
 * The row's badge, in the design's own vocabulary: how close the step's due
 * date is. The badge column is sized for "Due soon", not for a sentence, so
 * what the step is waiting for goes on the line under its title instead.
 */
function dueBadge(milestone, today = new Date()) {
  if (!milestone.due_on || milestone.state === "complete" || milestone.state === "cancelled") {
    return { dueStatus: "", dueTone: "" };
  }
  const due = dateFrom(milestone.due_on);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((due - start) / 86400000);
  if (days < 0) return { dueStatus: "Overdue", dueTone: "danger" };
  if (days === 0) return { dueStatus: "Due today", dueTone: "danger" };
  if (days <= 7) return { dueStatus: "Due soon", dueTone: "warning" };
  return { dueStatus: "", dueTone: "" };
}

/**
 * Whether a step is waiting on the OTHER side, which is the only time a
 * reminder means anything. An open step waits on the factory's work until it
 * posts; then on the brand's approval, as does a due or failed payment on the
 * brand's funding. Reminding the other side about your own move is noise.
 */
const waitingOnOther = (milestone, isFactory, posted) => (isFactory
  ? approvable(milestone, posted) || ["due", "failed"].includes(milestone.payment?.state)
  : milestone.state === "active" && !posted);

/** Brands nudge factories only when the current work is genuinely close. */
function nearOrPastDue(milestone, today = new Date()) {
  if (!milestone.due_on) return false;
  const due = dateFrom(milestone.due_on);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((due - start) / 86400000) <= 7;
}

function brandReminderState(milestone, { running, posted, current }) {
  if (!current) return { canRemind: false, reminderReason: "" };
  if (!running) return { canRemind: false, reminderReason: "Reminders are unavailable on closed orders" };
  if (milestone.state !== "active" || posted) {
    return { canRemind: false, reminderReason: "This step is waiting for your approval" };
  }
  if (!milestone.due_on) {
    return { canRemind: false, reminderReason: "" };
  }
  if (!nearOrPastDue(milestone)) {
    return { canRemind: false, reminderReason: "Available seven days before the due date" };
  }
  return { canRemind: true, reminderReason: "" };
}

const TABS = new Set(["overview", "files", "contract"]);

/**
 * What the brand pays on this order, the fee included: the header's four
 * figures and each step's charge by milestone id. Null when they cannot be
 * read (a database without migration 20261023000300), and the page then
 * shows the summary's step amounts as it did before.
 */
async function brandCharges(orderId) {
  const [order, steps] = await Promise.all([
    supabase.from("production_order_charges").select("*").eq("order_id", orderId).maybeSingle(),
    supabase.from("order_step_charges").select("milestone_id, charged_cents").eq("order_id", orderId),
  ]);
  if (order.error || steps.error || !order.data) return null;
  return { order: order.data, steps: new Map((steps.data ?? []).map((row) => [row.milestone_id, row.charged_cents])) };
}

export default function LiveOrderDetail({ org, orderId, isFactory, isOwner = false, tab = "overview", step = null }) {
  const { navigate } = useRouter();
  const [order, setOrder] = useState(null);
  const [milestones, setMilestones] = useState([]);
  const [updates, setUpdates] = useState([]);
  const [activity, setActivity] = useState([]);
  const [charges, setCharges] = useState(null);
  const [requestFiles, setRequestFiles] = useState([]);
  const [photoUrls, setPhotoUrls] = useState({});
  const [location, setLocation] = useState("");
  const [terms, setTerms] = useState({ incoterm: "", paymentTerm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [dialogError, setDialogError] = useState(null);
  // The step whose updates are open in the pop-up. Its address is the step's
  // own (/orders/:id/milestones/:mid), so a notification or a reload opens it.
  const [openStepId, setOpenStepId] = useState(step);
  // A step whose "Add update" was asked for from its pop-up (factory only).
  const [addUpdateFor, setAddUpdateFor] = useState(null);
  const loadVersion = useRef(0);
  useEffect(() => { setOpenStepId(step); }, [step]);

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    try {
      const [row, steps, posted, events, charged] = await Promise.all([
        getOrder(orderId),
        listMilestones(orderId),
        listOrderUpdates(orderId),
        orderActivity(orderId),
        isFactory ? null : brandCharges(orderId).catch(() => null),
      ]);
      if (version !== loadVersion.current) return;
      setCharges(charged);
      setOrder(row);
      setMilestones(steps ?? []);
      setUpdates(posted ?? []);
      setActivity(events ?? []);
    } catch (failure) {
      if (version === loadVersion.current) setError(failure);
    }
  }, [orderId, isFactory]);

  useEffect(() => {
    load();
    return () => { loadVersion.current += 1; };
  }, [load]);

  // Both parties see new comments and attached files without leaving the
  // timeline. Refetch the joined data rather than rendering a partial event.
  useEffect(() => {
    let active = true;
    let timer;
    const refresh = () => {
      if (!active) return;
      clearTimeout(timer);
      timer = setTimeout(() => { if (active) load(); }, 200);
    };
    const visibleRefresh = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const channel = supabase
      .channel(`order-comments:${orderId}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "milestone_updates", filter: `order_id=eq.${orderId}`,
      }, refresh)
      // A step approved, a payment funded, the steps confirmed or the order
      // cancelled by the other side (20261029000210). Inserts and updates
      // only: Realtime does not apply the read policy to deletes, and every
      // delete here comes with an update the page hears anyway.
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "order_milestones", filter: `order_id=eq.${orderId}`,
      }, refresh)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "order_milestones", filter: `order_id=eq.${orderId}`,
      }, refresh)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "order_payments", filter: `order_id=eq.${orderId}`,
      }, refresh)
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "production_orders", filter: `id=eq.${orderId}`,
      }, refresh)
      .subscribe((status) => { if (status === "SUBSCRIBED") refresh(); });
    // Covers a dropped socket or missed event without refreshing the page or
    // clearing a comment draft. Hidden tabs do not poll.
    const poll = setInterval(visibleRefresh, 15000);
    window.addEventListener("focus", visibleRefresh);
    window.addEventListener("online", visibleRefresh);
    document.addEventListener("visibilitychange", visibleRefresh);
    return () => {
      active = false;
      clearTimeout(timer);
      clearInterval(poll);
      window.removeEventListener("focus", visibleRefresh);
      window.removeEventListener("online", visibleRefresh);
      document.removeEventListener("visibilitychange", visibleRefresh);
      supabase.removeChannel(channel);
    };
  }, [orderId, load]);

  // Cancelling has no design: the banner, the dialog and the side panel's
  // "Cancel order" are live only (CancelNotice, CancelOrderDialog).
  const cancel = useOrderCancel({ onChanged: load });

  // The parts that do not change as the order moves: the request's files, the
  // other company's location, and the snapshot's term labels. Each one is
  // optional: when it cannot be read the panel leaves it out.
  useEffect(() => {
    if (!order) return;
    let cancelled = false;
    (async () => {
      const files = order.quote_id ? await getContractAttachments(order.quote_id).catch(() => []) : [];
      const place = isFactory
        ? locationLine(await brandSummary(order.brand_org_id).catch(() => null))
        : locationLine(order.factory?.factory_profiles);
      const [incoterms, paymentTerms] = await Promise.all([
        order.incoterm_id ? listTerms("incoterm").catch(() => []) : [],
        order.payment_term_id ? listTerms("payment_term").catch(() => []) : [],
      ]);
      if (cancelled) return;
      setRequestFiles(files ?? []);
      setLocation(place);
      setTerms({
        incoterm: termLabel(incoterms.find((term) => term.id === order.incoterm_id)),
        paymentTerm: termLabel(paymentTerms.find((term) => term.id === order.payment_term_id)),
      });
    })();
    return () => { cancelled = true; };
    // Keyed on the order's identity, not on every reload of its figures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, isFactory]);

  // Include history photos too: expanding comments must retain thumbnails.
  // At most three photos per update. Minted per view, never stored.
  useEffect(() => {
    let cancelled = false;
    const photos = updates
      .flatMap((update) => (update.documents ?? []).filter((doc) => /^image\//.test(doc.mime_type ?? "")).slice(0, 3));
    Promise.all(photos.map(async (doc) => [doc.id, await urlFor(doc).catch(() => null)]))
      .then((pairs) => { if (!cancelled) setPhotoUrls(Object.fromEntries(pairs)); });
    return () => { cancelled = true; };
  }, [updates]);

  // The open step's history, shaped once per load: a fresh array on every
  // render would have the pop-up re-mint its photo URLs each time.
  const openUpdates = useMemo(() => updates
    .filter((update) => update.milestone_id === openStepId)
    .map((update) => ({ ...update, author: update.orgs?.name ?? "", when: updateTime(update.created_at) })),
  [updates, openStepId]);

  // The URL follows the pop-up without a navigation, so the page behind it
  // keeps its scroll position.
  const showStep = (id) => {
    setOpenStepId(id);
    const base = window.location.pathname.startsWith("/app.html") ? "/app.html" : "";
    window.history.replaceState({}, "", `${base}/orders/${orderId}${id ? `/milestones/${id}` : ""}`);
  };
  const openStep = (milestone) => showStep(milestone.id);

  function act(milestone) {
    if (milestone.kind === "fund" && milestone.paymentId) {
      navigate(`/orders/${orderId}/payments/${milestone.paymentId}`);
    }
  }

  /** Runs one dialog's action. Resolves true when the dialog may close. */
  async function fromDialog(work) {
    if (busy) return false;
    setBusy(true);
    setDialogError(null);
    try {
      await work();
      await load();
      return true;
    } catch (failure) {
      setDialogError(failure);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function remind(milestone) {
    setError(null);
    try {
      await remindMilestone(milestone.id);
      return true;
    } catch (failure) {
      // Already reminded today is not a failure worth a banner: the reminder
      // the person wanted to send is sitting in the other side's inbox.
      if (/already sent today/.test(failure.message)) return true;
      setError(failure);
      return false;
    }
  }

  async function openFile(file) {
    try {
      window.open(await urlFor(file.document), "_blank", "noopener");
    } catch (failure) {
      setError(failure);
    }
  }

  if (!order) {
    return error
      ? <main className="rfqs-page"><p className="composer-error" role="alert">{error.message}</p></main>
      : null;
  }

  const money = (cents) => (cents == null ? "—" : formatMoney(cents, order.currency));
  const other = isFactory ? order.brand?.name : order.factory?.name;
  const running = order.status === "active";
  // What this person may do here (has_org_permission); the database refuses
  // the rest, so the rows offer only these.
  const viewer = {
    isFactory,
    org,
    factoryName: order.factory?.name,
    canFund: can(org, "releaseFunds"),
    canApprove: can(org, "approve"),
    canUpdate: can(org, "addUpdate"),
    canSetSteps: can(org, "rfqFlow"),
  };
  // The brand's figures with the fee (brandCharges); the factory's are the
  // summary's step amounts.
  const charged = isFactory ? null : charges;

  const shaped = milestones.map((milestone) => {
    const stepUpdates = updates.filter((update) => update.milestone_id === milestone.id);
    const hasDispute = stepUpdates.some((update) => update.kind === "dispute");
    const posted = stepUpdates.some((update) => update.author_org_id === order.factory_org_id);
    const reminder = isFactory
      ? { canRemind: running && waitingOnOther(milestone, true, posted), reminderReason: "" }
      : brandReminderState(milestone, { running, posted, current: milestone.id === order.current_milestone_id });
    const next = actionFor(milestone, { ...viewer, posted });
    const fileCount = stepUpdates.reduce((sum, update) => sum + (update.documents?.length ?? 0), 0);
    return {
      id: milestone.id,
      paymentId: milestone.payment?.id ?? null,
      stepKind: milestone.kind,
      state: milestone.state,
      needsApproval: milestone.kind === "approval_and_payment" || milestone.kind === "approval_only",
      current: milestone.id === order.current_milestone_id,
      // The factory's design marks the step being worked on as "active".
      active: milestone.id === order.current_milestone_id,
      title: milestone.title,
      // What this row is waiting for, said plainly, money included. A
      // factory must never be left guessing whether it may start: the chain
      // advances on the money being HELD, not on a bank payment that is
      // still clearing, and the gap between those two is exactly where
      // someone starts work unpaid.
      meta: [
        statusLine(milestone, { ...viewer, posted }),
        milestone.due_on ? `due ${day(milestone.due_on)}` : null,
      ].filter(Boolean).join(" · "),
      ...(hasDispute ? { dueStatus: "Dispute opened", dueTone: "danger" } : dueBadge(milestone)),
      amount: milestone.amount_cents ? money(charged?.steps.get(milestone.id) ?? milestone.amount_cents) : "",
      // Approving releases the step amount to the factory; the fee stays with TSC.
      releaseAmount: milestone.amount_cents ? money(milestone.amount_cents) : "",
      description: milestone.description ?? "",
      reviewItem: stepUpdates.length
        ? `${stepUpdates.length} ${stepUpdates.length === 1 ? "update" : "updates"}, ${fileCount} ${fileCount === 1 ? "file" : "files"} posted on this step`
        : "Nothing posted on this step yet",
      ...reminder,
      // Discussion remains open after approval, including completed orders.
      // A factory's post is an update (Add update); a brand's is a comment.
      canComment: (running || order.status === "completed")
        && (!isFactory || viewer.canUpdate)
        && (milestone.state === "complete" || (milestone.kind !== "payment_only"
          && (milestone.state === "active" || milestone.state === "submitted"))),
      // Keep the factory's next action visible on every work/approval step,
      // just as the brand sees its future milestone CTAs. Pending buttons are
      // disabled until sequencing opens the step; payment-only rows need no
      // factory update at all.
      showUpdateAction: running
        && milestone.state !== "complete"
        && milestone.state !== "cancelled"
        && milestone.kind !== "payment_only",
      canDispute: running && !hasDispute && (milestone.state === "active" || milestone.state === "submitted"),
      ...next,
      // Approval ends the work, not its history. Keep existing comments and
      // attachments visible on completed steps for both participants.
      update: latestUpdateFor(milestone.id, updates, {
        urls: photoUrls,
        onViewAll: () => openStep(milestone),
        onOpenFile: (document) => openFile({ document }),
        onDownloadFile: async (document) => {
          try { await downloadDocument(document); }
          catch (failure) { setError(failure); }
        },
      }),
    };
  });

  const activeTab = TABS.has(tab) ? tab : "overview";
  const openMilestone = milestones.find((milestone) => milestone.id === openStepId) ?? null;
  const factoryLine = [order.factory?.name, isFactory ? "" : location].filter(Boolean).join(" · ");
  const brandLine = [order.brand?.name, location].filter(Boolean).join(" · ");
  const counterparty = { name: other ?? "", initials: initials(other), location };
  const header = {
    title: order.rfqs?.title || order.order_number,
    subtitle: [other, order.order_number, order.activated_at ? `Started ${day(order.activated_at)}` : null]
      .filter(Boolean)
      .join(" · "),
    total: money(charged ? charged.order.total_charged_cents : order.total_cents),
    paid: money(charged ? charged.order.paid_charged_cents : order.paid_cents),
    // A cancelled order owes nothing more: its unheld payments were cancelled
    // (close_order), though the summary still counts its steps as outstanding.
    remaining: money(order.status === "cancelled" ? null : charged ? charged.order.outstanding_charged_cents : order.outstanding_cents),
    nextPayment: money(charged ? charged.order.next_payment_charged_cents : order.next_payment_cents),
  };
  // The activity panel's payment lines in the same figures, by step title
  // (the rows carry no step id); a title used twice keeps the step amount.
  const titleCounts = milestones.reduce((counts, milestone) => counts.set(milestone.title, (counts.get(milestone.title) ?? 0) + 1), new Map());
  const chargedByStep = charged
    ? new Map(milestones
      .filter((milestone) => titleCounts.get(milestone.title) === 1 && charged.steps.has(milestone.id))
      .map((milestone) => [milestone.title, charged.steps.get(milestone.id)]))
    : null;
  const onTabChange = (next) => navigate(next === "overview" ? `/orders/${orderId}` : `/orders/${orderId}/${next}`);
  const contract = describeOrderContract({
    order,
    milestones,
    incoterm: terms.incoterm,
    paymentTerm: terms.paymentTerm,
    factoryLine: isFactory ? brandLine : factoryLine,
    counterpartyLabel: isFactory ? "Brand" : "Factory",
    attachments: requestFiles,
  });
  const pending = order.status === "pending_schedule";
  // Either side may propose cancelling an open order, once: while a proposal
  // is open the banner answers it instead.
  const proposeCancel = (pending || running) && !order.cancel_proposed_by_org
    ? () => cancel.propose({ id: order.id, title: header.title, counterparty: other })
    : null;
  const cancelBanner = (
    <CancelNotice order={order} isFactory={isFactory} counterparty={other} title={header.title} store={cancel} />
  );

  const openRow = isFactory && openMilestone ? shaped.find((row) => row.id === openMilestone.id) : null;
  const stepPopup = openMilestone && (
    <StepUpdatesModal
      step={openMilestone}
      updates={openUpdates}
      urlFor={urlFor}
      onOpenFile={(document) => openFile({ document })}
      onClose={() => showStep(null)}
      // The factory posts from here too, on a step its row lets it post on.
      onAddUpdate={openRow?.canComment ? () => { showStep(null); setAddUpdateFor(openRow.id); } : undefined}
    />
  );

  /**
   * Before the brand confirms the production steps nothing is running: no
   * payments, nothing to fund. The brand sets the steps in the "Production
   * steps" stage of its flow, as the design draws it; the factory reads them
   * on its own order page and is told of every change. (Design review: only
   * the brand changes the steps; a factory that disagrees messages the brand.)
   */
  if (isFactory) {
    return (
      <>
      <FactoryProjectProgressDetail
        language="en"
        onBack={() => navigate("/orders")}
        order={header}
        milestones={shaped}
        error={error}
        tab={activeTab}
        onTabChange={onTabChange}
        // The factory opens the brand's profile from its name.
        counterparty={{
          ...counterparty,
          profileHref: `/app.html/brands/${order.brand_org_id}?from=order`,
          onOpenProfile: () => navigate(`/brands/${order.brand_org_id}?from=order`),
        }}
        onMessage={() => navigate(`/orders/${orderId}/messages`)}
        activity={activityLines(activity, { order, viewerOrgId: org.id })}
        files={orderFiles(requestFiles, updates, milestones)}
        onOpenFile={openFile}
        contract={contract}
        // The design's only step action is "Add update". Posting is all the
        // factory does: the brand approves from the update.
        onPostUpdate={(milestone, { body, files }) => fromDialog(() => postUpdate({
          orderId, milestoneId: milestone.id, orgId: org.id, body, files,
        }))}
        dialog={{ busy, error: dialogError, onClose: () => setDialogError(null) }}
        updateStepId={addUpdateFor}
        onUpdateStepOpened={() => setAddUpdateFor(null)}
        notice={pending
          ? `${other ?? "The brand"} is setting the production steps. Nothing starts until they confirm them, and you are told of every change. If something doesn't work for you, message them.`
          : undefined}
        banner={cancelBanner}
        onCancelOrder={proposeCancel}
      />
      {stepPopup}
      {cancel.dialog}
      </>
    );
  }

  if (pending) {
    return (
      <BrandSchedule
        order={order}
        milestones={milestones}
        reload={load}
        onBack={() => navigate("/orders")}
        vendor={{ ...counterparty, onMessage: () => navigate(`/orders/${orderId}/messages`), onCancel: proposeCancel }}
        // Release funds pays (begin_payment_checkout); anyone else stays on the order.
        onFund={viewer.canFund ? (paymentId) => navigate(`/orders/${orderId}/payments/${paymentId}`) : undefined}
        locked={viewer.canSetSteps ? "" : needsPermission(org, "rfqFlow")}
        banner={cancelBanner}
        dialog={cancel.dialog}
      />
    );
  }

  return (
    <main className="rfqs-page">
      {error && <p className="composer-error" role="alert">{error.message}</p>}
      <ProjectDetailScreen
        goTo={() => navigate("/orders")}
        goToFundingMilestone={act}
        order={header}
        milestones={shaped}
        busy={busy}
        error={dialogError}
        onAction={(_kind, milestone) => act(milestone)}
        tab={activeTab}
        onTabChange={onTabChange}
        // The brand opens the factory's profile from its name.
        counterparty={{
          ...counterparty,
          profileHref: `/app.html/factories/${order.factory_org_id}?from=order`,
          onOpenProfile: () => navigate(`/factories/${order.factory_org_id}?from=order`),
        }}
        onMessage={() => navigate(`/orders/${orderId}/messages`)}
        activity={activityLines(activity, { order, viewerOrgId: org.id, chargedByStep })}
        files={orderFiles(requestFiles, updates, milestones)}
        onOpenFile={openFile}
        contract={contract}
        // Approving a funded step asks for its payout straight away. A payout
        // that cannot go now (the factory has no Stripe account yet, or
        // Stripe is down) stays owed and shows on the staff payments page;
        // it never undoes the approval.
        onApprove={(milestone, note) => fromDialog(async () => {
          await approveMilestone(milestone.id, note);
          if (milestone.paymentId) await requestRelease(milestone.paymentId).catch(() => null);
        })}
        onPostComment={(milestone, { body, files }) => fromDialog(() => postUpdate({
          orderId, milestoneId: milestone.id, orgId: org.id, body, files,
        }))}
        onInitiateDispute={(milestone, { body, files }) => fromDialog(() => initiateDispute({
          orderId, milestoneId: milestone.id, orgId: org.id, reason: body, files,
        }))}
        onRemind={remind}
        onManageMilestones={viewer.canSetSteps ? () => navigate(`/orders/${orderId}/schedule`) : undefined}
        // A refusal belongs to the dialog it happened in, not the next one.
        onDialogClose={() => setDialogError(null)}
        banner={cancelBanner}
        onCancelOrder={proposeCancel}
      />
      {stepPopup}
      {cancel.dialog}
    </main>
  );
}
