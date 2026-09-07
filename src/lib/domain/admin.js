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
