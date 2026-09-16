/**
 * Taxonomy — the platform's controlled vocabularies.
 *
 * One table replaces the ~15 hardcoded option lists that the two prototypes
 * currently disagree about. Terms carry both an English and a Chinese label,
 * so picking a language never goes near the machine-translation path — that is
 * reserved for user-authored prose.
 */
import { supabase, unwrap } from "../supabase.js";

/** Kinds whose onboarding UI offers an "add your own" option. */
export const CUSTOM_KINDS = new Set([
  "production_type",
  "product_category",
  "specialty",
  "service",
  "design_service",
  "make",
  "certification",
]);

/**
 * Terms of one kind: the canonical platform list plus anything this org has
 * added for itself. RLS already hides other orgs' custom terms.
 */
export async function listTerms(kind) {
  return unwrap(
    await supabase
      .from("taxonomy_terms")
      .select("id, kind, slug, label_en, label_zh, sort, aliases, extra, org_id")
      .eq("kind", kind)
      .order("sort", { ascending: true }),
    `load ${kind} options`,
  );
}

/** Several kinds in one round trip, keyed by kind. */
export async function listTermsByKind(kinds) {
  const rows = unwrap(
    await supabase
      .from("taxonomy_terms")
      .select("id, kind, slug, label_en, label_zh, sort, aliases, extra, org_id")
      .in("kind", kinds)
      .order("sort", { ascending: true }),
    "load options",
  );

  return rows.reduce((grouped, term) => {
    (grouped[term.kind] ||= []).push(term);
    return grouped;
  }, {});
}

/** The label for a term in the viewer's language, falling back to English. */
export function termLabel(term, locale = "en") {
  if (!term) return "";
  if (locale === "zh") return term.label_zh || term.label_en;
  return term.label_en;
}

/**
 * Add a term this org invented. Only permitted for kinds flagged
 * allows_custom; the database rejects anything else.
 */
export async function addCustomTerm(orgId, kind, label) {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return unwrap(
    await supabase
      .from("taxonomy_terms")
      .insert({ kind, slug, label_en: label.trim(), org_id: orgId })
      .select()
      .single(),
    "add your own option",
  );
}

/**
 * Replace an entity's selected terms of one kind.
 *
 * Deliberately scoped to a single kind: a profile edit screen saves one chip
 * group at a time, and a blanket delete would wipe the groups it never showed.
 */
export async function setLinks({ subjectType, subjectId, orgId, kind, termIds }) {
  const existing = unwrap(
    await supabase
      .from("taxonomy_links")
      .select("term_id, taxonomy_terms!inner (kind)")
      .eq("subject_type", subjectType)
      .eq("subject_id", subjectId)
      .eq("taxonomy_terms.kind", kind),
    "load current selections",
  );

  const currentIds = existing.map((row) => row.term_id);
  const toAdd = termIds.filter((id) => !currentIds.includes(id));
  const toRemove = currentIds.filter((id) => !termIds.includes(id));

  if (toRemove.length) {
    unwrap(
      await supabase
        .from("taxonomy_links")
        .delete()
        .eq("subject_type", subjectType)
        .eq("subject_id", subjectId)
        .in("term_id", toRemove),
      "remove deselected options",
    );
  }

  if (toAdd.length) {
    unwrap(
      await supabase.from("taxonomy_links").insert(
        toAdd.map((termId) => ({
          subject_type: subjectType,
          subject_id: subjectId,
          term_id: termId,
          org_id: orgId,
        })),
      ),
      "save your selections",
    );
  }
}
