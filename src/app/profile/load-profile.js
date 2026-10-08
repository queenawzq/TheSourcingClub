/**
 * Loading a vendor's profile records, for its own profile page and for the
 * brand's view of it.
 *
 * The owner reads everything it has. A brand reads only what the access
 * rules already admit for a published profile: the profile row, its tags,
 * capacity, references, certification claims and the public-bucket images and
 * video. So the brand's load never asks for the business registration, a
 * certificate file or the factory's orders: private documents are refused by
 * the rules anyway, and a factory's orders would carry other brands' names.
 */
import { getFactoryProfile, getSelectedTerms } from "../../lib/domain/profile.js";
import { listTermsByKind, termLabel } from "../../lib/domain/taxonomy.js";
import { getCapacity } from "../../lib/domain/capacity-store.js";
import { listDocuments, urlFor } from "../../lib/domain/documents.js";
import { loadCertifications } from "../../lib/domain/certifications.js";
import { listOrders } from "../../lib/domain/order.js";
import { supabase, unwrap } from "../../lib/supabase.js";
import { CHIP_KINDS, titleFromFileName } from "./factory-profile-view.js";
import { TRADING_CHIP_KINDS } from "./trading-profile-view.js";

// `country` lets a saved location carry its country code, as onboarding does.
const KINDS = [
  ...new Set([...Object.values(CHIP_KINDS), ...Object.values(TRADING_CHIP_KINDS)]),
  "capacity_category",
  "certification",
  "country",
];

/** The public files a profile shows: logo, sample images, walkthrough. */
async function publicMedia(orgId) {
  const [logos, samples, walkthroughs] = await Promise.all([
    listDocuments(orgId, "logo"),
    listDocuments(orgId, "product_image"),
    listDocuments(orgId, "walkthrough"),
  ]);
  const [logoUrl, sampleImages, walkthrough] = await Promise.all([
    logos[0] ? urlFor(logos[0], 3600) : null,
    // listDocuments is newest first; the design reads its samples in the
    // order they were added.
    Promise.all([...samples].reverse().map(async (doc) => ({
      title: doc.title || titleFromFileName(doc.file_name),
      caption: doc.caption ?? "",
      src: await urlFor(doc, 3600),
      doc,
    }))),
    // "#t=0.5" makes the browser draw a frame from the video as its preview,
    // rather than a black box until it plays.
    walkthroughs[0] ? urlFor(walkthroughs[0], 3600).then((url) => ({ ...walkthroughs[0], url: `${url}#t=0.5` })) : null,
  ]);
  return { logos, logoUrl, samples: sampleImages, walkthrough, walkthroughs };
}

const references = (orgId, what) =>
  supabase.from("profile_references").select("id, title, counterparty, sort").eq("org_id", orgId).order("sort")
    .then((result) => unwrap(result, what));

/** Everything the vendor's own page draws, loaded side by side. */
export async function loadOwnProfile(org) {
  const [profile, terms, selected, capacity, refs, registrations, media, orders] = await Promise.all([
    getFactoryProfile(org.id),
    listTermsByKind(KINDS),
    getSelectedTerms("factory_profile", org.id),
    getCapacity(org.id),
    references(org.id, "load your client references"),
    listDocuments(org.id, "business_registration"),
    publicMedia(org.id),
    listOrders(org.id),
  ]);
  const certificationRows = await loadCertifications(org.id, terms.certification ?? []);

  return {
    orgName: org.name,
    profile,
    terms,
    selected,
    capacity,
    references: refs,
    certifications: certificationRows.map((row) => ({ ...row, hasFile: Boolean(row.document) })),
    registrationDoc: registrations[0] ?? null,
    ...media,
    // Only the orders this vendor makes: a person in both a brand and a
    // factory org gets the active org's side.
    orders: orders.filter((order) => order.factory_org_id === org.id),
  };
}

/**
 * A published vendor's profile as a brand may read it, or null when there is
 * no such profile (never published, or not a vendor).
 */
export async function loadVendorProfileForBrand(vendorOrgId) {
  const profile = unwrap(
    await supabase
      .from("factory_profiles")
      .select("org_id, legal_name, website_url, location, nearest_port, founded_year, employee_count, intro, moq, typical_lead_days, sample_lead_days, verification_status, published_at, equipment_notes, vendor_kind, languages_supported, typical_order_value_band, partner_factory_count, supported_incoterms, typical_payment_terms, orgs (name)")
      .eq("org_id", vendorOrgId)
      .not("published_at", "is", null)
      .maybeSingle(),
    "load this vendor's profile",
  );
  if (!profile) return null;

  const [terms, selected, capacity, refs, claims, media] = await Promise.all([
    listTermsByKind(KINDS),
    getSelectedTerms("factory_profile", vendorOrgId),
    getCapacity(vendorOrgId),
    references(vendorOrgId, "load this vendor's references"),
    // The claim and its status only: the certificate file is private.
    supabase.from("factory_certifications").select("id, term_id, status").eq("org_id", vendorOrgId).order("created_at")
      .then((result) => unwrap(result, "load this vendor's certifications")),
    publicMedia(vendorOrgId),
  ]);
  const certificationTerms = terms.certification ?? [];

  return {
    orgName: profile.orgs?.name ?? "",
    profile,
    terms,
    selected,
    capacity,
    references: refs,
    certifications: claims
      .map((claim) => {
        const term = certificationTerms.find((item) => item.id === claim.term_id);
        return term ? { name: termLabel(term), status: claim.status, hasFile: false } : null;
      })
      .filter(Boolean),
    registrationDoc: null,
    ...media,
    orders: [],
  };
}

/**
 * The brand dashboard's "Recommended factories": published vendors, verified
 * first, then those sharing the most of the brand's own profile tags (its
 * product focus), then the newest. Each with its sample images, for the
 * card's strip.
 */
export async function loadRecommendedVendors(brandOrgId, limit = 3) {
  const [rows, brandTerms] = await Promise.all([
    supabase
      .from("factory_profiles")
      .select("org_id, location, moq, typical_lead_days, verification_status, intro, vendor_kind, published_at, orgs (name)")
      .not("published_at", "is", null)
      .then((result) => unwrap(result, "load recommended vendors")),
    getSelectedTerms("brand_profile", brandOrgId),
  ]);
  if (!rows.length) return [];

  const wanted = new Set(Object.values(brandTerms).flat());
  const links = unwrap(
    await supabase
      .from("taxonomy_links")
      .select("subject_id, term_id")
      .eq("subject_type", "factory_profile")
      .in("subject_id", rows.map((row) => row.org_id)),
    "load recommended vendors",
  );
  const overlap = new Map();
  for (const link of links) {
    if (wanted.has(link.term_id)) overlap.set(link.subject_id, (overlap.get(link.subject_id) ?? 0) + 1);
  }
  const verified = (row) => Number(row.verification_status === "verified");

  const chosen = [...rows]
    .sort((a, b) =>
      verified(b) - verified(a)
      || (overlap.get(b.org_id) ?? 0) - (overlap.get(a.org_id) ?? 0)
      || String(b.published_at).localeCompare(String(a.published_at)))
    .slice(0, limit);

  return Promise.all(chosen.map(async (row) => {
    const samples = await listDocuments(row.org_id, "product_image");
    const products = await Promise.all([...samples].reverse().map(async (doc) => ({
      name: doc.title || titleFromFileName(doc.file_name),
      image: await urlFor(doc, 3600),
    })));
    return { ...row, products };
  }));
}
