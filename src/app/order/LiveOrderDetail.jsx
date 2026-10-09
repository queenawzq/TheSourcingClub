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
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ProjectDetailScreen } from "../../prototype/main.jsx";
import { FactoryProjectProgressDetail } from "../../factory-prototype/main.jsx";
import { StepUpdatesModal } from "../../shared/StepUpdatesModal.jsx";
import { getOrder, orderActivity } from "../../lib/domain/order.js";
import {
  approveMilestone,
  listMilestones,
  listOrderUpdates,
  postUpdate,
  remindMilestone,
} from "../../lib/domain/milestone.js";
import { brandSummary } from "../../lib/domain/rfq.js";
import { listRfqDocuments, urlFor } from "../../lib/domain/documents.js";
import { listTerms, termLabel } from "../../lib/domain/taxonomy.js";
import { formatMoney } from "../../lib/money.js";
import { useRouter } from "../../lib/router.jsx";
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

/**
 * What this step is waiting for, and from whom.
 *
 * The design draws a fixed action per row: "Approve", or "Fund milestone".
 * Live it depends on the state the row is in and which side is looking: a
 * factory never approves its own work, it posts updates from the row's menu.
 * A row with nothing to do carries no button rather than a disabled one.
 */
function actionFor(milestone, { isFactory, isOwner, posted }) {
  const payment = milestone.payment;
  const none = { action: "", tone: "", kind: "" };

  if (isFactory) return none;
  if (payment?.state === "due") {
    return { action: "Fund milestone", tone: "primary", kind: "fund" };
  }
  if (approvable(milestone, posted)) {
    // approve_milestone refuses a member on a paying step; say so on the row
    // instead of offering a dialog that can only fail.
    if (milestone.kind === "approval_and_payment" && !isOwner) return none;
    return { action: "Approve", tone: "primary", kind: "approve" };
  }
  return none;
}

/** The sentence under a step's title, from its own state and its payment's. */
function statusLine(milestone, { isFactory, isOwner, posted }) {
  const payment = milestone.payment;

  if (milestone.state === "complete") return "Done";
  if (approvable(milestone, posted)) {
    if (isFactory) return "Posted, awaiting the brand's approval";
    if (milestone.kind === "approval_and_payment" && !isOwner) return "Ready for an owner's approval";
    return "Ready for your approval";
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

/**
 * Whether a step is waiting on the OTHER side, which is the only time a
 * reminder means anything. An open step waits on the factory's work until it
 * posts; then on the brand's approval, as does a due payment on the brand's
 * transfer. Reminding the other side about your own move is noise.
 */
const waitingOnOther = (milestone, isFactory, posted) => (isFactory
  ? approvable(milestone, posted) || milestone.payment?.state === "due"
  : milestone.state === "active" && !posted);

const TABS = new Set(["overview", "files", "contract"]);

export default function LiveOrderDetail({ org, orderId, isFactory, isOwner = false, tab = "overview", step = null }) {
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
  // The step whose updates are open in the pop-up. Its address is the step's
  // own (/orders/:id/milestones/:mid), so a notification or a reload opens it.
  const [openStepId, setOpenStepId] = useState(step);
  useEffect(() => { setOpenStepId(step); }, [step]);

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
  const viewer = { isFactory, isOwner };

  const shaped = milestones.map((milestone) => {
    const stepUpdates = updates.filter((update) => update.milestone_id === milestone.id);
    const posted = stepUpdates.some((update) => update.author_org_id === order.factory_org_id);
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
      // What this row is waiting for, said plainly. A factory must never be
      // left guessing whether it may start: the chain advances on a payment
      // being CONFIRMED, not on the brand saying it sent one, and the gap
      // between those two is exactly where someone starts work unpaid.
      meta: [
        statusLine(milestone, { ...viewer, posted }),
        milestone.payment?.state === "confirmed" ? "Funded" : null,
        milestone.due_on ? `due ${day(milestone.due_on)}` : null,
      ].filter(Boolean).join(" · "),
      ...dueBadge(milestone),
      amount: milestone.amount_cents ? money(milestone.amount_cents) : "",
      description: milestone.description ?? "",
      reviewItem: stepUpdates.length
        ? `${stepUpdates.length} ${stepUpdates.length === 1 ? "update" : "updates"}, ${fileCount} ${fileCount === 1 ? "file" : "files"} posted on this step`
        : "Nothing posted on this step yet",
      canRemind: running && waitingOnOther(milestone, isFactory, posted),
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
  const openMilestone = milestones.find((milestone) => milestone.id === openStepId) ?? null;
  const factoryLine = [order.factory?.name, isFactory ? "" : location].filter(Boolean).join(" · ");
  const brandLine = [order.brand?.name, location].filter(Boolean).join(" · ");
  const counterparty = { name: other ?? "", initials: initials(other), location };
  const header = {
    title: order.rfqs?.title || order.order_number,
    subtitle: [other, order.order_number, order.activated_at ? `Started ${day(order.activated_at)}` : null]
      .filter(Boolean)
      .join(" · "),
    total: money(order.total_cents),
    paid: money(order.paid_cents),
    remaining: money(order.outstanding_cents),
    nextPayment: money(order.next_payment_cents),
  };
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

  const stepPopup = openMilestone && (
    <StepUpdatesModal
      step={openMilestone}
      updates={openUpdates}
      urlFor={urlFor}
      onOpenFile={(document) => openFile({ document })}
      onClose={() => showStep(null)}
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
        onRemind={remind}
        dialog={{ busy, error: dialogError, onClose: () => setDialogError(null) }}
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
        activity={activityLines(activity, { order, viewerOrgId: org.id })}
        files={orderFiles(requestFiles, updates, milestones)}
        onOpenFile={openFile}
        contract={contract}
        onApprove={(milestone, note) => fromDialog(() => approveMilestone(milestone.id, note))}
        onPostComment={(milestone, { body, files }) => fromDialog(() => postUpdate({
          orderId, milestoneId: milestone.id, orgId: org.id, body, files,
        }))}
        onRemind={remind}
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
