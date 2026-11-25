/**
 * Brand and factory profiles.
 *
 * Scalar fields live on the profile row; anything drawn from a controlled
 * vocabulary lives in taxonomy_links and is written through taxonomy.js. That
 * split is what stops the two sides of the marketplace inventing different
 * spellings of the same category, which is exactly what the prototypes do
 * today.
 */
import { fetchApi, supabase, unwrap } from "../supabase.js";
import { countryIn, countryName, fallbackLocation } from "../../shared/company-address.mjs";

const BRAND_COLUMNS = `
  org_id, legal_name, business_email, website_url, hq_location, founded_year,
  brand_category, intro, annual_revenue_band, pieces_per_year_band, order_size_band,
  collections_per_year, reorder_cadence, sourcing_stage,
  target_price_min_cents, target_price_max_cents, target_price_basis,
  verification_status, onboarding_completed_at, created_at, updated_at
`;

// Every column onboarding writes has to be listed here, or resuming the flow
// shows an empty field for an answer that was saved — the value is in the
// database and the form looks like it was never filled in. equipment_notes
// and vendor_kind were written and not read back for exactly that reason.
const FACTORY_COLUMNS = `
  org_id, legal_name, website_url, location, country_code, nearest_port,
  founded_year, registration_date, employee_count, registered_capital, intro,
  moq, typical_lead_days, typical_lead_days_max, sample_lead_days, sample_lead_days_max,
  equipment_notes, vendor_kind,
  languages_supported, typical_order_value_band, partner_factory_count,
  supported_incoterms, typical_payment_terms,
  verification_status, trust_tier, published_at,
  onboarding_completed_at, created_at, updated_at
`;

/**
 * A number of days as typed: "45-60 天" is { min: 45, max: 60 }, "40 days" is
 * { min: 40, max: null }. Onboarding and the profile editor both read lead
 * times through this, so a range typed in either is kept whole.
 */
export function dayRange(text) {
  // A range only when two numbers are joined ("45-60", "45 to 60", "45至60"):
  // "35 天，样品 7 天" is 35, not 7-35.
  const joined = String(text ?? "").match(/(\d+)\s*(?:-|–|—|~|～|to|至|到)\s*(\d+)/);
  if (joined) {
    const [a, b] = [Number(joined[1]), Number(joined[2])];
    return a === b ? { min: a, max: null } : { min: Math.min(a, b), max: Math.max(a, b) };
  }
  return { min: firstNumber(text), max: null };
}

/** A saved lead time back in words: "45-60 days", "40 days", or "". */
export function daysText(min, max, unit = "days") {
  if (min == null || min === "") return "";
  return max != null && Number(max) > Number(min) ? `${min}-${max} ${unit}` : `${min} ${unit}`;
}

/**
 * The first number in a free-text answer: "30-45 days" is 30, and
 * "1,200 units" is 1200 (a thousands comma is not the end of the number).
 */
export function firstNumber(text) {
  const match = String(text ?? "").replace(/(\d),(?=\d{3}(?!\d))/g, "$1").match(/\d+/);
  return match ? Number(match[0]) : null;
}

/**
 * The design asks for a free-text place ("Porto, Portugal")
 * and never for a country code. But country_code is what match_score
 * compares, so a profile without one is invisible to half the marketplace.
 *
 * Rather than adding a field the design does not have, the country is read
 * out of what the factory already typed, against the country taxonomy
 * (`countryTerms`). No match gives null, which is honest: better absent than
 * wrong, because a wrong code silently mis-matches rather than failing.
 * No location at all gives undefined: nothing to read.
 */
export function countryCodeFrom(location, countryTerms = []) {
  if (!location) return undefined;
  const text = String(location).toLowerCase();
  const hit = countryTerms.find((term) => {
    const en = String(term.label_en ?? "").toLowerCase();
    const zh = String(term.label_zh ?? "");
    return (en && text.includes(en)) || (zh && String(location).includes(zh));
  });
  return hit?.extra?.code ?? null;
}

/**
 * The columns a save of the vendor's one address writes ("Factory Address",
 * "Company Address"; src/shared/company-address.mjs). The full address goes
 * to the write-only production_address ("" clears it); a brand reads only
 * location, which is set to the country alone here when the address changed,
 * until the server's split (structureAddress) makes it "City, Country".
 * Unchanged, location is left alone: an existing company keeps what it had.
 */
export function addressPatch(typed, previous, previousCountry = null) {
  const said = String(typed ?? "").trim();
  const patch = { production_address: said };
  if (said === String(previous ?? "").trim()) return { patch, changed: false };
  // No country in the words: the one Browse already files the company under,
  // as the server's split keeps it (api/structure-address.js decide()).
  patch.location = fallbackLocation(said) ?? (said ? countryName(previousCountry) : null) ?? null;
  const code = said ? countryIn(said) : null;
  if (code) patch.country_code = code;
  return { patch, changed: Boolean(said) };
}

/**
 * Ask the server to split the address just saved. Never waited on by a save,
 * never throws: without it the address stays as typed (api/structure-address.js).
 */
export function structureAddress(orgId) {
  return fetchApi("/api/structure-address", { orgId })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
}

export async function getBrandProfile(orgId) {
  return unwrap(
    await supabase.from("brand_profiles").select(BRAND_COLUMNS).eq("org_id", orgId).maybeSingle(),
    "load your brand profile",
  );
}

/**
 * The production address is staff-only for everyone outside the company: a
 * trigger moves it from factory_profiles into factory_production_addresses
 * (members and staff read it), so it is read back from there.
 */
async function withProductionAddress(orgId, profile) {
  if (!profile) return profile;
  const { data } = await supabase.from("factory_production_addresses").select("address").eq("org_id", orgId).maybeSingle();
  return { ...profile, production_address: data?.address ?? null };
}

export async function getFactoryProfile(orgId) {
  const profile = unwrap(
    await supabase
      .from("factory_profiles")
      .select(FACTORY_COLUMNS)
      .eq("org_id", orgId)
      .maybeSingle(),
    "load your factory profile",
  );
  return withProductionAddress(orgId, profile);
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
  const saved = unwrap(
    await supabase
      .from("factory_profiles")
      .upsert({ org_id: orgId, ...patch }, { onConflict: "org_id" })
      .select(FACTORY_COLUMNS)
      .single(),
    "save your factory profile",
  );
  return withProductionAddress(orgId, saved);
}

/**
 * Where staff's review of this company stands, as the company may see it:
 * the state, and for "needs information" or "declined" the notification it
 * was sent (title and message). Never the reviewer's own note or name; those
 * stay on the staff-only org_reviews row.
 */
export async function getMyReview(orgId) {
  const rows = unwrap(
    await supabase.rpc("my_review_status", { target_org: orgId }),
    "load your verification status",
  );
  const row = rows?.[0] ?? {};
  return {
    state: row.state ?? "ready_for_review",
    title: row.title ?? null,
    message: row.message ?? null,
    sentAt: row.sent_at ?? null,
  };
}

/**
 * Send a profile staff returned for more information back to their queue.
 * Staff have no bell, so the database queues an email to the operations inbox;
 * this asks the server to send it now (the daily job sends it otherwise).
 */
export async function resubmitForReview(orgId) {
  const state = unwrap(
    await supabase.rpc("resubmit_for_review", { target_org: orgId }),
    "send your profile back for review",
  );
  supabase.auth.getSession()
    .then(({ data: { session } }) => fetch("/api/review-resubmitted", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
      body: JSON.stringify({ orgId }),
    }))
    .catch(() => {});
  return state;
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
  const profile = orgType === "factory"
    ? await saveFactoryProfile(orgId, { onboarding_completed_at: now, published_at: now })
    : await saveBrandProfile(orgId, { onboarding_completed_at: now });

  // Completion itself must not be rolled back because the mail provider is
  // briefly unavailable. The database trigger has already recorded a durable,
  // deduplicated delivery intent; this request asks the server to drain it now.
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch("/api/send-onboarding-complete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token ?? ""}`,
      },
      body: JSON.stringify({ orgId }),
    });
    const result = await response.json();
    return { ...profile, onboardingEmail: result };
  } catch (error) {
    return { ...profile, onboardingEmail: { sent: 0, error: error.message } };
  }
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
