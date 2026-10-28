import { supabase, unwrap } from "../supabase.js";
export const MATCH_KINDS = [
  "product_category",
  "fabric",
  "technique",
  "development_service",
  "certification",
];
export const FACTOR_LABELS = {
  product: "Product capability",
  order_size: "Order-size fit",
  development: "Development support",
  timeline: "Timeline fit (estimated)",
  region: "Region preference",
  certifications: "Certifications",
};
export async function matchingEnabled() {
  const { data, error } = await supabase
    .from("matching_settings")
    .select("enabled")
    .eq("id", true)
    .maybeSingle();
  // A deployment before the migration is safe and retains the legacy interface.
  return !error && data?.enabled === true;
}
export async function assessFactories(subjectType, subjectId, ids) {
  const entries = [];
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 100) {
    const data = unwrap(
      await supabase.rpc("factory_matches_v2", {
        subject_type: subjectType,
        subject_id: subjectId,
        factory_orgs: unique.slice(i, i + 100),
      }),
      "assess factory matches",
    );
    entries.push(
      ...(data ?? []).map((row) => [row.factory_org_id, row.assessment]),
    );
  }
  return new Map(entries);
}
export function compareMatches(a, b) {
  const rank = { qualified: 0, needs_confirmation: 1, excluded: 2 };
  return (
    (rank[a?.status] ?? 3) - (rank[b?.status] ?? 3) ||
    (b?.score ?? -1) - (a?.score ?? -1) ||
    (b?.coverage ?? -1) - (a?.coverage ?? -1)
  );
}
export function matchLabel(m) {
  return m?.status === "qualified"
    ? "Qualified"
    : m?.status === "excluded"
      ? "Not eligible"
      : "Needs confirmation";
}
// The database's check constraints, in the words the form uses. Postgres
// names the constraint, never the field, so its own message means nothing
// to the person who typed the number.
const CONSTRAINT_MESSAGES = {
  factory_matching_facts_check:
    "The usual order minimum can't be more than the usual order maximum.",
  factory_matching_facts_usual_order_min_check:
    "The usual order minimum must be more than zero.",
  factory_matching_facts_usual_order_max_check:
    "The usual order maximum must be more than zero.",
  factory_matching_facts_moq_per_colour_check:
    "MOQ per colour can't be negative.",
  matching_requirements_quantity_check:
    "Expected units per style must be more than zero.",
  matching_requirements_shipping_days_check:
    "The shipping allowance can't be negative.",
  matching_requirements_check: "Choose what the bulk deadline means.",
};
export async function saveMatchingProfile(
  subjectType,
  subjectId,
  selections,
  details,
) {
  const result = await supabase.rpc("save_matching_profile", {
    subject_type: subjectType,
    subject_id: subjectId,
    selections,
    details,
  });
  const constraint = result.error?.message?.match(/check constraint "([^"]+)"/)?.[1];
  if (CONSTRAINT_MESSAGES[constraint]) throw new Error(CONSTRAINT_MESSAGES[constraint]);
  return unwrap(result, "save matching information");
}
export async function inviteMatchedFactories(rfqId, ids, acknowledged) {
  // Normal invitation insertion retains existing RLS, credit and notification rules.
  return unwrap(
    await supabase.from("rfq_invitations").upsert(
      ids.map((id) => ({
        rfq_id: rfqId,
        factory_org_id: id,
        matching_acknowledged: acknowledged,
      })),
      { onConflict: "rfq_id,factory_org_id", ignoreDuplicates: true },
    ),
    "invite matched factories",
  );
}
