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

/**
 * Normalise the payment embed.
 *
 * order_payments.milestone_id is UNIQUE, so PostgREST reads the relationship
 * as to-one and returns an OBJECT, not an array — while an ordinary embed on
 * the same shape returns an array. Reading it as `[0]` therefore yields
 * undefined rather than an error: the timeline silently loses every payment
 * status and the brand's "pay this step" button never appears, with nothing on
 * screen or in the console to say so. Resolve the shape once, here.
 */
function withPayment(row) {
  const embedded = row.order_payments;
  const payment = Array.isArray(embedded) ? embedded[0] ?? null : embedded ?? null;
  return { ...row, payment };
}

export async function listMilestones(orderId) {
  const rows = unwrap(
    await supabase
      .from("order_milestones")
      .select(`${MILESTONE_COLUMNS}, order_payments (id, state, amount_cents, currency, fee_bps, due_at, sent_at, confirmed_at, released_at)`)
      .eq("order_id", orderId)
      .order("sort"),
    "load the schedule",
  );
  return rows.map(withPayment);
}

export async function getMilestone(orderId, milestoneId) {
  const row = unwrap(
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
  return row ? withPayment(row) : null;
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
 * Every update on an order, newest first, in one read.
 *
 * The order screen needs the latest update per step and every file for its
 * Files tab; asking per step would be one round trip per row. Either side's
 * posts come back — a brand's comment is an update with the brand as author.
 */
export async function listOrderUpdates(orderId) {
  return unwrap(
    await supabase
      .from("milestone_updates")
      .select("id, milestone_id, body, created_at, author_org_id, orgs:author_org_id (name), documents (id, bucket, storage_path, file_name, mime_type, size_bytes)")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false }),
    "load the updates on this order",
  );
}

/** Nudge the other side about a step. Once a day per step; the RPC says so. */
export async function remindMilestone(milestoneId) {
  return unwrap(
    await supabase.rpc("remind_milestone", { target_milestone: milestoneId }),
    "send the reminder",
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

