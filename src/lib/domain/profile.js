/**
 * Brand and factory profiles.
 *
 * Scalar fields live on the profile row; anything drawn from a controlled
 * vocabulary lives in taxonomy_links and is written through taxonomy.js. That
 * split is what stops the two sides of the marketplace inventing different
 * spellings of the same category, which is exactly what the prototypes do
 * today.
 */
import { supabase, unwrap } from "../supabase.js";

const BRAND_COLUMNS = `
  org_id, legal_name, business_email, website_url, hq_location, founded_year,
  brand_category, intro, annual_revenue_band, pieces_per_year_band, order_size_band,
  collections_per_year, reorder_cadence, sourcing_stage,
  target_price_min_cents, target_price_max_cents,
  verification_status, onboarding_completed_at, created_at, updated_at
`;

const FACTORY_COLUMNS = `
  org_id, legal_name, website_url, location, country_code, nearest_port,
  founded_year, registration_date, employee_count, registered_capital, intro,
  moq, typical_lead_days, verification_status, published_at,
  onboarding_completed_at, created_at, updated_at
`;

export async function getBrandProfile(orgId) {
  return unwrap(
    await supabase.from("brand_profiles").select(BRAND_COLUMNS).eq("org_id", orgId).maybeSingle(),
    "load your brand profile",
  );
}

export async function getFactoryProfile(orgId) {
  return unwrap(
    await supabase
      .from("factory_profiles")
      .select(FACTORY_COLUMNS)
      .eq("org_id", orgId)
      .maybeSingle(),
    "load your factory profile",
  );
}

/**
 * Save part of a profile.
 *
 * Onboarding saves after every step rather than at the end, so closing the tab
 * halfway through loses nothing. That means this is called with a handful of
 * columns at a time, not a whole object.
 */
export async function saveBrandProfile(orgId, patch) {
  return unwrap(
    await supabase
      .from("brand_profiles")
      .upsert({ org_id: orgId, ...patch }, { onConflict: "org_id" })
      .select(BRAND_COLUMNS)
      .single(),
    "save your brand profile",
  );
}

export async function saveFactoryProfile(orgId, patch) {
  return unwrap(
    await supabase
      .from("factory_profiles")
      .upsert({ org_id: orgId, ...patch }, { onConflict: "org_id" })
      .select(FACTORY_COLUMNS)
      .single(),
    "save your factory profile",
  );
}

/**
 * Mark onboarding finished.
 *
 * A factory is published at the same moment, which makes it visible in brand
 * browse. Being visible and being verified are deliberately separate: an
 * unverified factory can be found and read, but cannot quote until an admin
 * has checked its registration. Gating visibility instead would show a new
 * factory an empty marketplace on its first day.
 */
export async function completeOnboarding(orgId, orgType) {
  const now = new Date().toISOString();

  if (orgType === "factory") {
    return saveFactoryProfile(orgId, { onboarding_completed_at: now, published_at: now });
  }
  return saveBrandProfile(orgId, { onboarding_completed_at: now });
}

/** Term ids currently linked to a subject, grouped by kind. */
export async function getSelectedTerms(subjectType, subjectId) {
  const rows = unwrap(
    await supabase
      .from("taxonomy_links")
      .select("term_id, taxonomy_terms!inner (kind)")
      .eq("subject_type", subjectType)
      .eq("subject_id", subjectId),
    "load your selections",
  );

  return rows.reduce((grouped, row) => {
    (grouped[row.taxonomy_terms.kind] ||= []).push(row.term_id);
    return grouped;
  }, {});
}

/**
 * Which onboarding steps still have gaps.
 *
 * Drives the completion checklist, and is computed from the data rather than
 * stored, so it can never disagree with what is actually filled in.
 */
export function brandProfileGaps(profile, selected, documents) {
  const has = (kind) => (selected?.[kind]?.length ?? 0) > 0;
  const hasDoc = (kind) => documents?.some((doc) => doc.kind === kind);

  return [
    { key: "basics", label: "Brand basics", done: Boolean(profile?.legal_name && profile?.hq_location) },
    { key: "about", label: "About your brand", done: Boolean(profile?.intro) },
    { key: "logo", label: "Logo", done: hasDoc("logo") },
    { key: "production", label: "What you make", done: has("production_type") && has("product_category") },
    { key: "sourcing", label: "Sourcing plan", done: Boolean(profile?.order_size_band) },
    { key: "preferences", label: "Factory preferences", done: has("region") || has("service") },
    { key: "registration", label: "Business registration", done: hasDoc("business_registration") },
  ];
}
