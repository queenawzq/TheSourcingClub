/**
 * A production order, on Queena's designed screen.
 *
 * `ProjectDetailScreen` comes from src/prototype/main.jsx — the header strip,
 * the tabs, the milestone timeline, the side panel and the dialogs. This file
 * is the seam: every panel the design draws with an example gets the real
 * thing here, or nothing.
 *
 * Every figure comes from `production_order_summary`. JavaScript never sums
 * money and never decides whose turn it is: the order total is the sum of the
 * milestones, not of the quote, and the two diverge the moment either side
 * edits the schedule.
 */
import React, { useCallback, useEffect, useState } from "react";
import { ProjectDetailScreen } from "../../prototype/main.jsx";
import { getOrder, orderActivity } from "../../lib/domain/order.js";
import {
  approveMilestone,
  listMilestones,
  listOrderUpdates,
  postUpdate,
  remindMilestone,
  submitMilestone,
} from "../../lib/domain/milestone.js";
import { brandSummary } from "../../lib/domain/rfq.js";
import { listRfqDocuments, urlFor } from "../../lib/domain/documents.js";
import { listTerms, termLabel } from "../../lib/domain/taxonomy.js";
import { formatMoney } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";
import ScheduleEditor from "./ScheduleEditor.jsx";
import {
  activityLines,
  day,
  describeOrderContract,
  initials,
  latestUpdateFor,
  locationLine,
  orderFiles,
} from "./order-view.js";

/**
 * What this step is waiting for, and from whom.
 *
 * The design draws a fixed action per row. Live it depends on the state the
 * row is in and which side is looking: a factory cannot approve its own work,
 * and a brand cannot submit it. A row with nothing to do carries no button
 * rather than a disabled one.
 */
function actionFor(milestone, { isFactory, isOwner }) {
  const payment = milestone.payment;

  if (!isFactory && payment?.state === "due") {
    return { action: "Fund milestone", tone: "primary", kind: "fund" };
  }
  if (isFactory && milestone.state === "active") {
    return { action: "Submit for approval", tone: "primary", kind: "submit" };
  }
  if (!isFactory && milestone.state === "submitted") {
    // approve_milestone refuses a member on a paying step; say so on the row
    // instead of offering a dialog that can only fail.
    if (milestone.kind === "approval_and_payment" && !isOwner) {
      return { action: "", tone: "", kind: "open" };
    }
    return { action: "Approve", tone: "primary", kind: "approve" };
  }
  if (milestone.state === "complete") return { action: "", tone: "", kind: "open" };
  return { action: "Open", tone: "", kind: "open" };
}

/** The sentence under a step's title, from its own state and its payment's. */
function statusLine(milestone, { isFactory, isOwner }) {
  const payment = milestone.payment;

  if (milestone.state === "complete") return "Done";
  if (milestone.state === "submitted") {
    if (isFactory) return "Awaiting the brand's approval";
    if (milestone.kind === "approval_and_payment" && !isOwner) return "Awaiting an owner's approval";
    return "Awaiting approval";
  }
  if (milestone.state === "active") return isFactory ? "You can start this step" : "In progress";

  if (payment?.state === "sent") {
    return isFactory
      ? "Payment claimed, awaiting our confirmation"
      : "You have marked this sent — awaiting our confirmation";
  }
  if (payment?.state === "due") return isFactory ? "Awaiting payment from the brand" : "Payment due";
  return "";
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
  const due = new Date(`${milestone.due_on}T00:00:00`);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((due - start) / 86400000);
  if (days < 0) return { dueStatus: "Overdue", dueTone: "danger" };
  if (days === 0) return { dueStatus: "Due today", dueTone: "danger" };
  if (days <= 7) return { dueStatus: "Due soon", dueTone: "warning" };
  return { dueStatus: "", dueTone: "" };
}

/** Whether a step is waiting on someone, which is when a reminder means anything. */
const waiting = (milestone) =>
  milestone.state === "active" || milestone.state === "submitted" || milestone.payment?.state === "due";

const TABS = new Set(["overview", "files", "contract"]);

export default function LiveOrderDetail({ org, orderId, isFactory, isOwner = false, tab = "overview" }) {
  const { navigate } = useRouter();
  const [order, setOrder] = useState(null);
  const [milestones, setMilestones] = useState([]);
  const [updates, setUpdates] = useState([]);
  const [activity, setActivity] = useState([]);
  const [requestFiles, setRequestFiles] = useState([]);
  const [photoUrls, setPhotoUrls] = useState({});
  const [location, setLocation] = useState("");
  const [terms, setTerms] = useState({ incoterm: "", paymentTerm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [dialogError, setDialogError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [row, steps, posted, events] = await Promise.all([
        getOrder(orderId),
        listMilestones(orderId),
        listOrderUpdates(orderId),
        orderActivity(orderId),
      ]);
      setOrder(row);
      setMilestones(steps ?? []);
      setUpdates(posted ?? []);
      setActivity(events ?? []);
    } catch (failure) {
      setError(failure);
    }
  }, [orderId]);

  useEffect(() => { load(); }, [load]);

  // The parts that do not change as the order moves: the request's files, the
  // other company's location, and the snapshot's term labels. Each one is
  // optional: when it cannot be read the panel leaves it out.
  useEffect(() => {
    if (!order) return;
    let cancelled = false;
    (async () => {
      const files = order.rfq_id ? await listRfqDocuments(order.rfq_id).catch(() => []) : [];
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

  // Signed URLs for the photos the update cards show: the latest update on
  // each step, at most three photos each. Minted per view, never stored.
  useEffect(() => {
    let cancelled = false;
    const latest = new Map();
    for (const update of updates) if (!latest.has(update.milestone_id)) latest.set(update.milestone_id, update);
    const photos = [...latest.values()]
      .flatMap((update) => (update.documents ?? []).filter((doc) => /^image\//.test(doc.mime_type ?? "")).slice(0, 3));
    Promise.all(photos.map(async (doc) => [doc.id, await urlFor(doc).catch(() => null)]))
      .then((pairs) => { if (!cancelled) setPhotoUrls(Object.fromEntries(pairs)); });
    return () => { cancelled = true; };
  }, [updates]);

  const openStep = (milestone) => navigate(`/orders/${orderId}/milestones/${milestone.id}`);

  async function act(milestone) {
    if (busy) return;

    if (milestone.kind === "fund" && milestone.paymentId) {
      navigate(`/orders/${orderId}/payments/${milestone.paymentId}`);
      return;
    }
    if (milestone.kind === "open") {
      openStep(milestone);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (milestone.kind === "submit") await submitMilestone(milestone.id);
      await load();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
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

  /**
   * Before both sides agree the schedule there is no order interior to show —
   * no steps, no payments, nothing to fund. The designs have no screen for
   * that agreement, so rather than invent one, an order that has not been
   * agreed opens on the agreement itself. It is also the truthful order of
   * events: agree_schedule is what activates the order.
   */
  if (order.status === "pending_schedule") {
    return (
      <main className="home-page">
        <ScheduleEditor org={org} orderId={orderId} isFactory={isFactory} onAgreed={load} />
      </main>
    );
  }

  const money = (cents) => (cents == null ? "—" : formatMoney(cents, order.currency));
  const other = isFactory ? order.brand?.name : order.factory?.name;
  const running = order.status === "active";
  const viewer = { isFactory, isOwner };

  const shaped = milestones.map((milestone) => {
    const next = actionFor(milestone, viewer);
    const stepUpdates = updates.filter((update) => update.milestone_id === milestone.id);
    const fileCount = stepUpdates.reduce((sum, update) => sum + (update.documents?.length ?? 0), 0);
    return {
      id: milestone.id,
      paymentId: milestone.payment?.id ?? null,
      stepKind: milestone.kind,
      current: milestone.id === order.current_milestone_id,
      title: milestone.title,
      // What this row is waiting for, said plainly. A factory must never be
      // left guessing whether it may start: the chain advances on a payment
      // being CONFIRMED, not on the brand saying it sent one, and the gap
      // between those two is exactly where someone starts work unpaid.
      meta: [
        statusLine(milestone, viewer),
        milestone.payment?.state === "confirmed" ? "Funded" : null,
        milestone.due_on ? `due ${day(milestone.due_on)}` : null,
      ].filter(Boolean).join(" · "),
      ...dueBadge(milestone),
      amount: milestone.amount_cents ? money(milestone.amount_cents) : "",
      description: milestone.description ?? "",
      reviewItem: stepUpdates.length
        ? `${stepUpdates.length} ${stepUpdates.length === 1 ? "update" : "updates"}, ${fileCount} ${fileCount === 1 ? "file" : "files"} posted on this step`
        : "Nothing posted on this step yet",
      canRemind: running && waiting(milestone),
      // post_milestone_update takes a post only while work is happening.
      canComment: running && (milestone.state === "active" || milestone.state === "submitted"),
      ...next,
      // The latest real update, on the steps where work is happening.
      update: milestone.state === "active" || milestone.state === "submitted"
        ? latestUpdateFor(milestone.id, updates, { urls: photoUrls, onViewAll: () => openStep(milestone) })
        : null,
    };
  });

  const activeTab = TABS.has(tab) ? tab : "overview";
  const factoryLine = [order.factory?.name, isFactory ? "" : location].filter(Boolean).join(" · ");

  return (
    <main className="rfqs-page">
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
        error={dialogError}
        onAction={(_kind, milestone) => act(milestone)}
        tab={activeTab}
        onTabChange={(next) => navigate(next === "overview" ? `/orders/${orderId}` : `/orders/${orderId}/${next}`)}
        counterparty={{ name: other ?? "", initials: initials(other), location }}
        onMessage={() => navigate(`/orders/${orderId}/messages`)}
        activity={activityLines(activity, { order, viewerOrgId: org.id })}
        files={orderFiles(requestFiles, updates, milestones)}
        onOpenFile={openFile}
        contract={describeOrderContract({
          order,
          milestones,
          incoterm: terms.incoterm,
          paymentTerm: terms.paymentTerm,
          factoryLine,
          attachments: requestFiles,
        })}
        onApprove={(milestone, note) => fromDialog(() => approveMilestone(milestone.id, note))}
        onPostComment={(milestone, { body, files }) => fromDialog(() => postUpdate({
          orderId, milestoneId: milestone.id, orgId: org.id, body, files,
        }))}
        onRemind={remind}
        // A refusal belongs to the dialog it happened in, not the next one.
        onDialogClose={() => setDialogError(null)}
      />
    </main>
  );
}
