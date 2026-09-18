/**
 * Platform administration.
 *
 * Deliberately thin. Everything privileged happens in review_document(),
 * which is security definer and already gated on is_platform_admin() — this
 * module only finds the queue and calls it.
 */
import { supabase, unwrap } from "../supabase.js";

/** True when the signed-in user is on the platform_admins table. */
export async function isPlatformAdmin() {
  const { data, error } = await supabase.rpc("is_platform_admin");
  if (error) return false;
  return Boolean(data);
}

/**
 * Documents waiting on a decision.
 *
 * Only registrations and certificates are ever reviewed; everything else in
 * the documents table stays `unverified` and nobody looks at it.
 */
export async function pendingReviews() {
  return unwrap(
    await supabase
      .from("documents")
      .select("id, org_id, kind, bucket, storage_path, file_name, mime_type, size_bytes, status, created_at, orgs (name, type, slug)")
      .in("kind", ["business_registration", "certificate"])
      .in("status", ["pending", "unverified"])
      .order("created_at", { ascending: true }),
    "load the review queue",
  );
}

export async function recentlyReviewed(limit = 20) {
  return unwrap(
    await supabase
      .from("documents")
      .select("id, org_id, kind, file_name, status, reviewed_at, review_note, orgs (name, type)")
      .in("status", ["verified", "rejected"])
      .order("reviewed_at", { ascending: false })
      .limit(limit),
    "load recent decisions",
  );
}

/**
 * Approve or reject. Verifying a business registration verifies the org, which
 * is what lets a factory quote — so this one call is the gate for the entire
 * marketplace.
 */
export async function reviewDocument(documentId, decision, note = null) {
  return unwrap(
    await supabase.rpc("review_document", {
      document_id: documentId,
      decision,
      note,
    }),
    `record the ${decision} decision`,
  );
}

/**
 * ===========================================================================
 * Org-level review — the verification queue the admin design actually works in
 * ===========================================================================
 * review_document() above decides one file. These decide one *company*, which
 * is the unit a reviewer thinks in and the thing a factory is waiting on.
 * Both write the same verification_status column, so they cannot disagree.
 */

/**
 * Every company waiting on, or already carrying, a decision.
 *
 * Shaped for the design's queue rows. Note what is NOT here: a confidence
 * percentage and a per-check score breakdown. Those come from an automated
 * registry check that does not exist, and a fabricated number on a reviewer's
 * screen is worse than a blank one. What a reviewer has is the evidence, and
 * it is counted honestly.
 */
export async function verificationQueue() {
  const rows = await unwrap(
    await supabase.rpc("admin_verification_queue"),
    "load the verification queue",
  );

  return (rows ?? []).map((row) => ({
    orgId: row.org_id,
    name: row.org_name,
    type: row.org_type,
    slug: row.org_slug,
    location: row.location,
    legalName: row.legal_name,
    websiteUrl: row.website_url,
    intro: row.intro,
    submittedAt: row.submitted_at,
    state: row.state,
    risk: row.risk,
    note: row.note,
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name,
    verificationStatus: row.verification_status,
    evidenceReceived: row.evidence_received,
    evidenceExpected: row.evidence_expected,
    decidedAt: row.decided_at,
  }));
}

/** Take a review, or hand it to another admin. */
export async function claimReview(orgId, assignTo = null) {
  return unwrap(
    await supabase.rpc("admin_claim_review", { target_org: orgId, assign_to: assignTo }),
    "claim the review",
  );
}

/**
 * Approve, decline, or send it back.
 *
 * `needs_information` requires a note and the database enforces that — a
 * factory told only "Needs information" has nothing to act on. The note
 * reaches them as a notification written in the same transaction.
 */
export async function decideReview(orgId, decision, note = null, risk = null) {
  return unwrap(
    await supabase.rpc("admin_review_decision", {
      target_org: orgId,
      decision,
      note,
      risk,
    }),
    `record the ${decision.replace(/_/g, " ")} decision`,
  );
}

/**
 * ===========================================================================
 * Marketplace oversight
 * ===========================================================================
 * The rfq and quote policies already let staff read both tables. What they
 * could not do is read them across every org at once with the counts
 * attached, which is what the admin RFQ and quote tables show.
 */

export async function rfqQueue(limit = 200) {
  const rows = await unwrap(
    await supabase.rpc("admin_rfq_queue", { row_limit: limit }),
    "load marketplace requests",
  );

  return (rows ?? []).map((row) => ({
    id: row.rfq_id,
    title: row.title,
    brandOrgId: row.brand_org_id,
    brandName: row.brand_name,
    status: row.status,
    visibility: row.visibility,
    quantityTotal: row.quantity_total,
    currency: row.currency,
    invitedCount: row.invited_count,
    quoteCount: row.quote_count,
    latestQuoteAt: row.latest_quote_at,
    quoteDeadline: row.quote_deadline,
    publishedAt: row.published_at,
    awardedAt: row.awarded_at,
    createdAt: row.created_at,
  }));
}

export async function quoteQueue(limit = 200) {
  const rows = await unwrap(
    await supabase.rpc("admin_quote_queue", { row_limit: limit }),
    "load marketplace quotes",
  );

  return (rows ?? []).map((row) => ({
    id: row.quote_id,
    rfqId: row.rfq_id,
    rfqTitle: row.rfq_title,
    brandOrgId: row.brand_org_id,
    brandName: row.brand_name,
    factoryOrgId: row.factory_org_id,
    factoryName: row.factory_name,
    status: row.status,
    version: row.version,
    // Already production + samples, summed in SQL. JavaScript never adds money.
    totalCents: row.total_cents,
    currency: row.currency,
    submittedAt: row.submitted_at,
    decidedAt: row.decided_at,
  }));
}

/**
 * The four numbers on the overview.
 *
 * `paymentsAwaitingConfirmation` stands where the design puts "low-confidence
 * checks". It is a real figure and a more urgent one: platform staff have no
 * org and so cannot be notified of anything, which means a payment sits at
 * 'sent' until a human opens the queue. This count is the only prompt there is.
 */
export async function overviewMetrics() {
  const rows = await unwrap(
    await supabase.rpc("admin_overview_metrics"),
    "load the marketplace overview",
  );
  const row = rows?.[0] ?? {};

  return {
    profilesAwaitingReview: row.profiles_awaiting_review ?? 0,
    profilesSubmittedToday: row.profiles_submitted_today ?? 0,
    rfqsSubmittedToday: row.rfqs_submitted_today ?? 0,
    quotesSubmittedToday: row.quotes_submitted_today ?? 0,
    paymentsAwaitingConfirmation: row.payments_awaiting_confirmation ?? 0,
  };
}
