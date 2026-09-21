import { supabase, unwrap } from "../supabase.js";

const ACCEPTANCE_FIELDS = "id, org_id, terms_version, legal_document_id, signature, accepted_by, accepted_at";

/** Return the immutable acceptance for this exact version, if it exists. */
export async function getTermsAcceptance(orgId, termsVersion) {
  return unwrap(
    await supabase
      .from("terms_acceptances")
      .select(ACCEPTANCE_FIELDS)
      .eq("org_id", orgId)
      .eq("terms_version", termsVersion)
      .maybeSingle(),
    "load your terms acceptance",
  );
}

/**
 * Record an acceptance once. Existing signatures are intentionally never
 * updated: they are legal records, not editable onboarding answers.
 */
export async function acceptTerms({ orgId, termsVersion, legalDocumentId = null, signature, userId }) {
  const existing = await getTermsAcceptance(orgId, termsVersion);
  if (existing) return existing;

  const result = await supabase
    .from("terms_acceptances")
    .insert({
      org_id: orgId,
      terms_version: termsVersion,
      // The exact published text signed; see legal_documents.
      legal_document_id: legalDocumentId,
      signature: String(signature).trim(),
      accepted_by: userId,
    })
    .select(ACCEPTANCE_FIELDS)
    .single();

  // Another tab may have signed between the read and insert. In that case,
  // return the winning immutable record instead of exposing a constraint error.
  if (result.error?.code === "23505") {
    const racedAcceptance = await getTermsAcceptance(orgId, termsVersion);
    if (racedAcceptance) return racedAcceptance;
  }

  return unwrap(result, "record your agreement");
}
