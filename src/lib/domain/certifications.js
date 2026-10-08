/**
 * The certifications a factory claims, each optionally backed by a
 * certificate file that TSC reviews.
 *
 * Onboarding's verification step and the profile's "Manage verification
 * documents" dialog both edit them, so the writes live here once.
 */
import { supabase, unwrap } from "../supabase.js";
import { addCustomTerm, termLabel } from "./taxonomy.js";
import { deleteDocument, uploadDocument } from "./documents.js";

/** The certification term a name refers to, in either language. */
export function certificationTerm(name, certificationTerms = [], locale = "en") {
  return certificationTerms.find((term) => termLabel(term, "en") === name || termLabel(term, locale) === name);
}

/** Certifications claimed, each with the file behind it if there is one. */
export async function loadCertifications(orgId, certificationTerms = []) {
  const rows = unwrap(
    await supabase
      .from("factory_certifications")
      .select("id, term_id, status, document:documents (id, kind, bucket, storage_path, file_name, status)")
      .eq("org_id", orgId)
      .order("created_at"),
    "load your certifications",
  );
  return rows
    .map((row) => {
      const term = certificationTerms.find((item) => item.id === row.term_id);
      return term
        ? { id: row.id, termId: row.term_id, name: termLabel(term), status: row.status, fileName: row.document?.file_name ?? "", document: row.document }
        : null;
    })
    .filter(Boolean);
}

/**
 * Claim a certification by name. A name the platform doesn't list becomes
 * this factory's own term. Returns the term, so a caller holding the list
 * can add a new one to it.
 */
export async function addCertification(orgId, name, certificationTerms = [], locale = "en") {
  const term = certificationTerm(name, certificationTerms, locale) ?? await addCustomTerm(orgId, "certification", name);
  unwrap(
    await supabase
      .from("factory_certifications")
      .upsert({ org_id: orgId, term_id: term.id }, { onConflict: "org_id,term_id", ignoreDuplicates: true }),
    "add the certification",
  );
  return term;
}

/**
 * Attach a certificate file. Certificates are reviewed, so a new file goes
 * back into the queue as pending; the file it replaces is removed.
 */
export async function attachCertificate(orgId, termId, file, previousDocument = null) {
  const document = await uploadDocument({ orgId, kind: "certificate", file });
  unwrap(
    await supabase
      .from("factory_certifications")
      .upsert({ org_id: orgId, term_id: termId, document_id: document.id, status: "pending" }, { onConflict: "org_id,term_id" }),
    "attach the certificate",
  );
  if (previousDocument) await deleteDocument(previousDocument).catch(() => {});
  return document;
}

/** Withdraw a certification, and its file with it. */
export async function removeCertification(certification) {
  unwrap(
    await supabase.from("factory_certifications").delete().eq("id", certification.id),
    "remove the certification",
  );
  if (certification.document) await deleteDocument(certification.document);
}
