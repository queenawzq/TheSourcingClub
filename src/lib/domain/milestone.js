/**
 * Milestones, the updates posted against them, and the one place a button
 * label is chosen.
 */
import { supabase, unwrap } from "../supabase.js";
import { uploadDocument } from "./documents.js";

const MILESTONE_COLUMNS = `
  id, order_id, sort, kind, title, description, amount_cents, currency,
  due_on, state, submitted_at, approved_at, approval_note, completed_at
`;

export async function listMilestones(orderId) {
  return unwrap(
    await supabase
      .from("order_milestones")
      .select(`${MILESTONE_COLUMNS}, order_payments (id, state, amount_cents, currency, fee_bps, due_at, sent_at, confirmed_at, released_at)`)
      .eq("order_id", orderId)
      .order("sort"),
    "load the schedule",
  );
}

export async function getMilestone(orderId, milestoneId) {
  return unwrap(
    await supabase
      .from("order_milestones")
      .select(`${MILESTONE_COLUMNS}, order_payments (id, state, amount_cents, currency, fee_bps)`)
      // Scoped to the order as well as the id. matchPath validates nothing, so
      // a milestone id from another order would otherwise render one order's
      // money under another order's header.
      .eq("order_id", orderId)
      .eq("id", milestoneId)
      .maybeSingle(),
    "load that step",
  );
}

/**
 * The whole schedule at once, never single rows.
 *
 * Deliberately not the client-side delete-then-insert that setSampleLines
 * uses: a half-written sample plan is an annoyance, a half-written order
 * schedule is money-shaped damage. The RPC also resets both agreements and
 * notifies the other side in the same transaction.
 */
export async function saveSchedule(orderId, lines) {
  return unwrap(
    await supabase.rpc("set_order_schedule", {
      target_order: orderId,
      lines: lines.map((line, index) => ({
        kind: line.kind,
        title: line.title,
        description: line.description || null,
        amount_cents: line.amount_cents ?? null,
        due_on: line.due_on || null,
        sort: (index + 1) * 10,
      })),
    }),
    "save the schedule",
  );
}

export async function listUpdates(milestoneId) {
  return unwrap(
    await supabase
      .from("milestone_updates")
      .select("id, milestone_id, body, created_at, author_org_id, orgs:author_org_id (name), documents (id, bucket, storage_path, file_name, mime_type, size_bytes)")
      // Filtered in SQL by the milestone that owns them. The prototype renders
      // every update under milestone one regardless of which opened it.
      .eq("milestone_id", milestoneId)
      .order("created_at", { ascending: false }),
    "load the updates on this step",
  );
}

/**
 * Post an update with photos.
 *
 * The update row has to exist first, because each upload is scoped by the
 * order id in its storage path — that third path segment is what makes the
 * counterparty storage policy expressible at all. If any upload fails the
 * update is removed, so a note never survives without the photos it describes.
 */
export async function postUpdate({ orderId, milestoneId, orgId, body, files = [] }) {
  const documentIds = [];

  for (const file of files) {
    const doc = await uploadDocument({
      orgId,
      kind: "milestone_update",
      file,
      scopeId: orderId,
    });
    documentIds.push(doc.id);
  }

  try {
    return unwrap(
      await supabase.rpc("post_milestone_update", {
        target_milestone: milestoneId,
        body,
        document_ids: documentIds,
      }),
      "post your update",
    );
  } catch (error) {
    // The photos are uploaded but unattached, and an unattached document is
    // readable by nobody but its owner. Leave them rather than deleting a
    // file the factory may have taken some trouble over.
    throw error;
  }
}

export async function submitMilestone(milestoneId) {
  return unwrap(
    await supabase.rpc("submit_milestone", { target_milestone: milestoneId }),
    "send this step for approval",
  );
}

export async function approveMilestone(milestoneId, note) {
  return unwrap(
    await supabase.rpc("approve_milestone", {
      target_milestone: milestoneId,
      note: note || null,
    }),
    "approve this step",
  );
}

/* ------------------------------------------------------------------------ */

export const KIND_LABEL = {
  approval_and_payment: "Approval and payment",
  approval_only: "Approval only",
  payment_only: "Payment only",
  progress_only: "Progress update",
};

/**
 * The ONE place a verb is chosen for a milestone row.
 *
 * Returns `{ label, kind, disabled, reason }`. A disabled action still
 * renders, with its reason visible — the factory being told WHY it cannot
 * start is the difference between a gate and a screen that appears broken.
 */
export function milestoneAction(milestone, { isFactory, isOwner, order }) {
  const payment = milestone.order_payments?.[0] ?? null;
  const running = order?.status === "active";

  if (!running) {
    return { label: null, reason: "Nothing can move until both sides agree the schedule." };
  }

  if (isFactory) {
    if (milestone.kind === "payment_only") {
      if (payment?.state === "due" || payment?.state === "sent") {
        return {
          label: null,
          reason: payment.state === "sent"
            ? "The brand says this is paid. You can start once we confirm it arrived."
            : "Waiting for the brand to pay this step.",
        };
      }
      return { label: null, reason: null };
    }
    if (milestone.state === "active") {
      return { label: "Post an update", kind: "update" };
    }
    if (milestone.state === "submitted") {
      return { label: "Post an update", kind: "update", note: "Already with the brand." };
    }
    if (milestone.state === "pending") {
      return { label: null, reason: "An earlier step has to finish first." };
    }
    return { label: null, reason: null };
  }

  // Brand.
  if (milestone.state === "submitted") {
    const needsOwner = milestone.kind === "approval_and_payment" && !isOwner;
    return {
      label: milestone.kind === "approval_and_payment" ? "Approve and pay" : "Approve",
      kind: "approve",
      disabled: needsOwner,
      reason: needsOwner ? "Approving a step that releases a payment is limited to an owner." : null,
    };
  }
  if (payment?.state === "due") {
    return { label: "Pay this step", kind: "pay", disabled: !isOwner,
             reason: isOwner ? null : "Recording a payment is limited to an owner." };
  }
  return { label: null, reason: null };
}
