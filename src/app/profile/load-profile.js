/**
 * Loading profile records: a vendor's, for its own page and for the brand's
 * view of it; a brand's, for its own page and for the vendor's view of it.
 *
 * The owner reads everything it has. A brand reads only what the access
 * rules already admit for a published profile: the profile row, its tags,
 * capacity, references, certification claims and the public-bucket images and
 * video. So the brand's load never asks for the business registration, a
 * certificate file or the factory's orders: private documents are refused by
 * the rules anyway, and a factory's orders would carry other brands' names.
 *
 * A vendor reads a brand only through brand_profile_for_factory(), which
 * returns what the brand told vendors and nothing private (no revenue, email,
 * website, documents or orders).
 */
import { getBrandProfile, getFactoryProfile, getSelectedTerms } from "../../lib/domain/profile.js";
import { BRAND_KINDS } from "../../lib/domain/brand-profile-fields.js";
import { listMembers } from "../../lib/domain/org.js";
import { brandProfileForFactory, listRfqs, listSavedBrands } from "../../lib/domain/rfq.js";
import { listThreads } from "../../lib/domain/message.js";
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

/** Every taxonomy kind a brand profile shows, plus the country list for its HQ. */
const BRAND_PROFILE_KINDS = [...BRAND_KINDS, "country"];

/**
 * Everything the brand's own page draws: what onboarding saved (the profile,
 * its tags and files), its team and pending invitations, and its own requests
 * and orders for the activity figures and "Past work with vendors".
 */
export async function loadOwnBrandProfile(org) {
  const [profile, terms, selected, logos, images, registrations, members, invitations, rfqs, orders] = await Promise.all([
    getBrandProfile(org.id),
    listTermsByKind(BRAND_PROFILE_KINDS),
    getSelectedTerms("brand_profile", org.id),
    listDocuments(org.id, "logo"),
    listDocuments(org.id, "product_image"),
    listDocuments(org.id, "business_registration"),
    listMembers(org.id),
    supabase.from("org_invitations").select("id, email, role, created_at").eq("org_id", org.id).eq("status", "pending").order("created_at")
      .then((result) => unwrap(result, "load your invitations")),
    listRfqs(org.id),
    listOrders(org.id),
  ]);
  const [logoUrl, assets] = await Promise.all([
    logos[0] ? urlFor(logos[0], 3600) : null,
    // listDocuments is newest first; the page reads its assets in the order
    // they were added.
    Promise.all([...images].reverse().map(async (doc) => ({
      title: doc.title || titleFromFileName(doc.file_name),
      caption: doc.caption ?? "",
      src: await urlFor(doc, 3600),
      doc,
    }))),
  ]);

  return {
    orgName: org.name,
    isOwner: org.role === "owner",
    profile,
    terms,
    selected,
    logos,
    logoUrl,
    assets,
    registrationDoc: registrations[0] ?? null,
    members,
    invitations,
    rfqs,
    // Only the orders this brand placed: a person in both a brand and a
    // factory org gets the active org's side.
    orders: orders.filter((order) => order.brand_org_id === org.id),
  };
}

/**
 * A brand's profile as a vendor may read it, through
 * brand_profile_for_factory(): nothing private comes back, and it is refused
 * unless the vendor can see one of the brand's requests. Also whether the
 * vendor has saved the brand, its latest conversation with the brand, and the
 * brand's newest open request it can see (the contact card's way in).
 */
export async function loadBrandProfileForFactory(factoryOrg, brandOrgId) {
  const [data, terms, saved, threads, open] = await Promise.all([
    brandProfileForFactory(brandOrgId),
    listTermsByKind(BRAND_PROFILE_KINDS),
    listSavedBrands(factoryOrg.id),
    listThreads(factoryOrg.id),
    // RLS returns only the requests this vendor may see.
    supabase.from("rfqs").select("id, title").eq("brand_org_id", brandOrgId).eq("status", "open")
      .order("published_at", { ascending: false }).limit(1)
      .then((result) => unwrap(result, "load this brand's open requests")),
  ]);
  const files = data?.assets ?? [];
  const url = (file) => publicUrl(file.storage_path);
  const logo = [...files].reverse().find((file) => file.kind === "logo");

  return {
    data,
    terms,
    logoUrl: logo ? url(logo) : null,
    assets: files
      .filter((file) => file.kind === "product_image")
      .map((file) => ({ title: file.title || titleFromFileName(file.file_name), caption: file.caption ?? "", src: url(file), key: file.storage_path })),
    saved: saved.some((row) => row.brand_org_id === brandOrgId),
    // listThreads is newest first.
    thread: threads.find((thread) => thread.brand_org_id === brandOrgId && thread.factory_org_id === factoryOrg.id) ?? null,
    openRequest: open[0] ?? null,
  };
}

/**
 * The vendor's Saved brands tab: each saved brand with what its card shows.
 * A brand the vendor can no longer see (its requests closed to it) keeps its
 * name and nothing else.
 */
export async function loadSavedBrands(factoryOrg) {
  const [rows, terms] = await Promise.all([listSavedBrands(factoryOrg.id), listTermsByKind(BRAND_PROFILE_KINDS)]);
  const brands = await Promise.all(rows.map(async (row) => {
    const data = await brandProfileForFactory(row.brand_org_id).catch(() => null);
    const logo = data ? [...(data.assets ?? [])].reverse().find((file) => file.kind === "logo") : null;
    return {
      orgId: row.brand_org_id,
      name: row.orgs?.name ?? data?.name ?? "Brand",
      data,
      logoUrl: logo ? publicUrl(logo.storage_path) : null,
    };
  }));
  return { brands, terms };
}

/** A public-bucket file's permanent address. */
function publicUrl(path) {
  return supabase.storage.from("org-public").getPublicUrl(path).data.publicUrl;
}
