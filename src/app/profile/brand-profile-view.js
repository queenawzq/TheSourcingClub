/**
 * A brand's records, in the shapes the designed brand pages draw: its own
 * profile (`BrandProfileScreen`), its completion page
 * (`BrandProfileCompletionPage`), and a vendor's view of it
 * (`FactoryBrandPublicProfilePage`).
 *
 * Pure: the seams load the rows, this only arranges them, so nothing here can
 * invent a number. Where the design shows something nothing records (a
 * response time, reviews, a payment status) it is left out, never filled with
 * an example.
 */
import { termLabel } from "../../lib/domain/taxonomy.js";
import { CATEGORY_KIND, priceRangeText } from "../../lib/domain/brand-profile-fields.js";
import { chipLabels, documentStatus, initialsOf } from "./factory-profile-view.js";

const NOT_GIVEN = "—";
const NONE = "None selected";

const monthYear = (iso) => new Date(iso).toLocaleString("en", { month: "short", year: "numeric" });
const dayMonth = (iso) => new Date(iso).toLocaleString("en", { month: "short", day: "numeric" });
const count = (value) => Number(value).toLocaleString("en");
const plural = (n, word) => `${count(n)} ${word}${n === 1 ? "" : "s"}`;
const listWords = (items) =>
  items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : items[0] ?? "";

/** "Premium / contemporary ($100-$500)" → "Premium / contemporary", as the factory profile shows it. */
const withoutBand = (label) => label.replace(/\s*\([^)]*\)\s*$/, "");

/** The brand's chip groups, by the design's names. */
export function brandChips(selected, terms, profile = null) {
  const chips = {
    categories: chipLabels(CATEGORY_KIND, selected, terms),
    products: chipLabels("product_category", selected, terms),
    marketLevel: chipLabels("market_level", selected, terms),
    regions: chipLabels("region", selected, terms),
    certifications: chipLabels("certification", selected, terms),
    services: chipLabels("service", selected, terms),
  };
  // A profile saved before the category became multi-choice has only the
  // column.
  if (!chips.categories.length && profile?.brand_category) {
    const term = (terms?.[CATEGORY_KIND] ?? []).find((item) => item.slug === profile.brand_category);
    if (term) chips.categories = [termLabel(term)];
  }
  return chips;
}

/** The sourcing volume columns as the design's rows, own page wording. */
function volumeRows(source) {
  const price = priceRangeText(source?.target_price_min_cents, source?.target_price_max_cents);
  return [
    ["Annual order volume", source?.pieces_per_year_band || NOT_GIVEN],
    ["Typical order size", source?.order_size_band || NOT_GIVEN],
    ["Collections per year", source?.collections_per_year || NOT_GIVEN],
    ["Typical price range for core styles", price ? `${price} per unit` : NOT_GIVEN],
    ["Reorder cadence", source?.reorder_cadence || NOT_GIVEN],
    ["Current sourcing stage", source?.sourcing_stage || NOT_GIVEN],
  ];
}

/** The registration's state in the design's words. */
function registrationState(profile, doc) {
  if (doc) {
    const status = documentStatus(doc.status, true);
    // TSC's verdict on the company stands for the file it reviewed.
    return profile?.verification_status === "verified" && status === "Uploaded" ? "Verified" : status;
  }
  return profile?.verification_status === "verified" ? "Verified" : "Not uploaded";
}

/** The brand's orders and open requests as the design's history cards. */
function projectCards(orders, rfqs) {
  const order = (row, completed) => ({
    key: row.id,
    title: row.rfqs?.title ?? row.order_number ?? "Production order",
    partner: row.factory?.name ?? "Vendor",
    date: completed
      ? `${monthYear(row.activated_at ?? row.created_at)} - ${monthYear(row.completed_at)}`
      : `Started ${dayMonth(row.activated_at ?? row.created_at)}`,
    result: completed ? "Completed" : row.status === "pending_schedule" ? "Setting steps" : row.current_milestone_title ?? "In production",
    summary: `${count(row.production_quantity ?? 0)} units${row.order_number ? ` · ${row.order_number}` : ""}`,
    tags: [],
  });
  const request = (rfq) => {
    const quotes = rfq.quotes?.[0]?.count ?? 0;
    return {
      key: rfq.id,
      title: rfq.title || "Request",
      partner: quotes ? plural(quotes, "quote") : "No quotes yet",
      date: rfq.published_at ? `Posted ${dayMonth(rfq.published_at)}` : "Open",
      result: "Open request",
      summary: rfq.brief || (rfq.quantity_total ? `${count(rfq.quantity_total)} units` : ""),
      tags: [],
    };
  };
  return {
    completed: orders.filter((row) => row.status === "completed").map((row) => order(row, true)),
    active: [
      ...orders.filter((row) => row.status === "active" || row.status === "pending_schedule").map((row) => order(row, false)),
      ...rfqs.filter((rfq) => rfq.status === "open").map(request),
    ],
  };
}

/**
 * How complete the brand's profile is, as the design's completion checks:
 * its four (business registration, business email, decision makers, brand
 * assets), then the three sections the profile itself shows (overview,
 * sourcing fit, sourcing volume). Computed from the data, never stored.
 *
 * Each check: `done`, `tone` (complete, progress: waiting on TSC, missing),
 * the design's `status` word, a `description` written from the data, and for
 * a missing item an `action` (`{ label, editor }`) and a `suggestion`.
 */
export function brandProfileChecks(parts) {
  const { profile, selected, assets = [], members = [], invitations = [] } = parts;
  const has = (kind) => (selected?.[kind]?.length ?? 0) > 0;
  const complete = (description, status = "Complete") => ({ tone: "complete", status, description });
  const inReview = (description) => ({ tone: "progress", status: "In review", description });
  const missing = (description, action, suggestion, status = "Needs attention") => ({ tone: "missing", status, description, action, suggestion });
  const registration = registrationState(profile, parts.registrationDoc);
  const people = members.length + invitations.length;

  const overviewGaps = [
    ["intro", profile?.intro],
    ["HQ location", profile?.hq_location],
    ["brand category", has(CATEGORY_KIND) || profile?.brand_category],
  ].filter(([, value]) => !value).map(([label]) => label);
  const fitGaps = [
    ["what the brand makes", has("product_category")],
    ["market level", has("market_level")],
    ["preferred regions", has("region")],
  ].filter(([, given]) => !given).map(([label]) => label);
  const volumeGaps = [
    ["order size", profile?.order_size_band],
    ["annual volume", profile?.pieces_per_year_band],
    ["price range", profile?.target_price_min_cents != null || profile?.target_price_max_cents != null],
  ].filter(([, given]) => !given).map(([label]) => label);

  const checks = [
    {
      key: "registration",
      title: "Business registration",
      ...(registration === "Verified"
        ? complete("Your business registration is verified, so vendors can trust they are quoting for a real company.", "Verified")
        : registration === "Uploaded"
          ? inReview("The registration document is on file and TSC is reviewing it.")
          : registration === "Rejected"
            ? missing("Your business registration wasn't accepted. Upload a new one for review.", { label: "Upload registration", editor: "verification" }, "Upload a new business registration")
            : missing("Upload your business registration so TSC can verify the brand.", { label: "Upload registration", editor: "verification" }, "Upload your business registration", "Not uploaded")),
    },
    {
      key: "email",
      title: "Business email",
      ...(profile?.business_email
        ? complete("A business email is on the profile, so TSC can reach the brand about its account.", "Added")
        : missing("Add the brand's business email.", { label: "Add business email", editor: "verification" }, "Add a business email", "Not added")),
    },
    {
      key: "people",
      title: "Decision makers",
      ...(people > 1
        ? complete(`${count(people)} people are listed${invitations.length ? `, ${plural(invitations.length, "invitation")} still to accept` : ""}, so vendors know who they will work with.`, "Added")
        : missing("Invite the people vendors will work with, such as a production lead.", { label: "Add decision makers", editor: "stakeholders" }, "Invite a decision maker")),
    },
    {
      key: "assets",
      title: "Brand assets",
      ...(assets.length
        ? complete(`${plural(assets.length, "image")} help${assets.length === 1 ? "s" : ""} vendors understand the brand's direction.`, "Added")
        : missing("Add product photos or references so vendors understand the brand's direction.", { label: "Add brand assets", editor: "assets" }, "Add brand assets", "Not added")),
    },
    {
      key: "overview",
      title: "Overview",
      ...(overviewGaps.length
        ? missing(`Vendors can't see the brand's ${listWords(overviewGaps)} yet.`, { label: "Update overview", editor: "overview" }, `Add your ${listWords(overviewGaps)}`)
        : complete("The intro, HQ location and brand category are on the profile.")),
    },
    {
      key: "fit",
      title: "Sourcing fit",
      ...(fitGaps.length
        ? missing(`Add ${listWords(fitGaps)} so vendors can tell whether they fit.`, { label: "Update sourcing fit", editor: "sourcing" }, `Add ${listWords(fitGaps)}`)
        : complete("What the brand makes, its market level and preferred regions are on the profile.")),
    },
    {
      key: "volume",
      title: "Sourcing volume",
      ...(volumeGaps.length
        ? missing(`Add the ${listWords(volumeGaps)} so vendors can quote confidently.`, { label: "Update sourcing volume", editor: "sourcingVolume" }, `Add the ${listWords(volumeGaps)}`)
        : complete("Order size, annual volume and price range are on the profile.")),
    },
  ];
  return checks.map((check) => ({ ...check, done: check.tone !== "missing" }));
}

export function brandProfilePercent(checks) {
  return Math.round((checks.filter((check) => check.done).length / checks.length) * 100);
}

/**
 * The brand's own page, as `BrandProfileScreen`'s `live` prop (minus the
 * dialogs, which the seam adds).
 *
 * parts: what load-profile.js's loadOwnBrandProfile() returns.
 */
export function brandProfileView(parts) {
  const { orgName, profile, terms, selected, members = [], invitations = [], orders = [], rfqs = [] } = parts;
  const name = profile?.legal_name || orgName;
  const chips = brandChips(selected, terms, profile);
  const marketLevel = chips.marketLevel.map(withoutBand);
  const live = orders.filter((order) => order.status !== "cancelled");
  const perFactory = live.reduce((map, order) => map.set(order.factory_org_id, (map.get(order.factory_org_id) ?? 0) + 1), new Map());
  const repeat = [...perFactory.values()].filter((n) => n >= 2).length;
  const openRequests = rfqs.filter((rfq) => rfq.status === "open").length;
  const registration = registrationState(profile, parts.registrationDoc);
  const checks = brandProfileChecks(parts);

  return {
    name,
    initials: initialsOf(name),
    logoUrl: parts.logoUrl,
    location: profile?.hq_location || "",
    categoryLine: chips.categories.join(" · "),
    revenue: profile?.annual_revenue_band || "",
    tags: [...chips.products, ...marketLevel],
    performance: {
      primary: count(live.length),
      primaryLabel: "Club orders",
      metrics: [
        { label: "Active quotes", value: count(openRequests) },
        { label: "Repeat vendors", value: count(repeat) },
      ],
    },
    intro: profile?.intro || "",
    introEmpty: "Add a short intro so vendors understand what the brand makes and how it works.",
    overviewRows: [
      ["Brand name", name],
      ["Brand category", chips.categories.join(" · ") || NOT_GIVEN],
      ["Business email", profile?.business_email || NOT_GIVEN],
      ["Year founded", profile?.founded_year ? String(profile.founded_year) : NOT_GIVEN],
      ["Website URL", profile?.website_url || NOT_GIVEN],
      ["HQ location", profile?.hq_location || NOT_GIVEN],
    ],
    privateRows: [["Annual revenue", profile?.annual_revenue_band || NOT_GIVEN]],
    fitSections: [
      ["What the brand makes", chips.products],
      ["Market level", marketLevel],
      ["Preferred regions", chips.regions],
      ["Certifications requested", chips.certifications],
      ["Services needed", chips.services],
    ].map(([label, items]) => [label, items.length ? items : [NONE]]),
    volumeRows: volumeRows(profile),
    assets: (parts.assets ?? []).map((asset) => ({ key: asset.doc.id, title: asset.title, meta: asset.caption, src: asset.src })),
    assetsEmpty: "No brand assets yet. Add product photos and references vendors can look at.",
    status: { percent: brandProfilePercent(checks) },
    verification: [
      { name: "Business registration", status: registration === "Uploaded" ? "In review" : registration, verified: registration === "Verified" },
      { name: "Business email", status: profile?.business_email ? "Added" : "Not added", verified: Boolean(profile?.business_email) },
    ],
    stakeholders: [
      ...members.map((member) => {
        const person = member.user_profiles?.full_name || member.user_profiles?.email || "Member";
        return { key: member.user_profiles?.id ?? person, initials: initialsOf(person), label: `${person} · ${member.role === "owner" ? "Owner" : "Member"}` };
      }),
      ...invitations.map((invitation) => ({ key: invitation.id, initials: invitation.email.slice(0, 2).toUpperCase(), label: `${invitation.email} · Invited` })),
    ],
    projects: projectCards(orders, rfqs),
    projectsEmpty: {
      completed: "No completed orders yet.",
      active: "No open requests or orders in production right now.",
    },
  };
}

/** The completion page's `live` prop, minus the buttons' handlers. */
export function brandCompletionView(parts) {
  const checks = brandProfileChecks(parts);
  return {
    percent: brandProfilePercent(checks),
    intro: "You can browse vendors and send requests now. Complete the items below to improve trust signals and make the brand easier for vendors to evaluate.",
    checks,
    suggestions: checks.filter((check) => check.suggestion).map((check) => check.suggestion),
  };
}

/** The dialogs' option lists, from the taxonomy, by the design's keys. */
export function brandProfileEditOptions(terms) {
  const labels = (kind) => (terms?.[kind] ?? []).map((term) => termLabel(term));
  return {
    brandCategories: labels(CATEGORY_KIND),
    products: labels("product_category"),
    marketLevel: labels("market_level"),
    preferredRegions: labels("region"),
    certifications: labels("certification"),
    services: labels("service"),
  };
}

/** What the dialogs open with: the saved answers, in the design's form keys. */
export function brandProfileEditForm(parts) {
  const { orgName, profile, terms, selected } = parts;
  const chips = brandChips(selected, terms, profile);
  return {
    name: profile?.legal_name || orgName || "",
    location: profile?.hq_location ?? "",
    brandCategories: chips.categories,
    founded: profile?.founded_year ? String(profile.founded_year) : "",
    website: profile?.website_url ?? "",
    businessEmail: profile?.business_email ?? "",
    intro: profile?.intro ?? "",
    products: chips.products,
    marketLevel: chips.marketLevel.slice(0, 1),
    preferredRegions: chips.regions,
    certifications: chips.certifications,
    services: chips.services,
    sourcingVolume: {
      annualVolume: profile?.pieces_per_year_band ?? "",
      orderSize: profile?.order_size_band ?? "",
      collectionsPerYear: profile?.collections_per_year ?? "",
      targetPrice: priceRangeText(profile?.target_price_min_cents, profile?.target_price_max_cents),
      reorderCadence: profile?.reorder_cadence ?? "",
      sourcingStage: profile?.sourcing_stage ?? "",
    },
  };
}

/**
 * A brand as a vendor sees it, as `FactoryBrandPublicProfilePage`'s `live`
 * prop (minus the back link and the buttons' handlers).
 *
 * data: what brand_profile_for_factory() returns (no revenue, email, website
 * or documents ever come back from it).
 */
export function factoryBrandView({ data, terms, logoUrl, assets }) {
  const selected = {};
  for (const [kind, list] of Object.entries(terms ?? {})) {
    const ids = list.filter((term) => (data?.term_ids ?? []).includes(term.id)).map((term) => term.id);
    if (ids.length) selected[kind] = ids;
  }
  const chips = brandChips(selected, terms);
  const location = data?.hq_location || "";
  const price = priceRangeText(data?.target_price_min_cents, data?.target_price_max_cents);
  const volume = [
    ["Typical order size", data?.order_size_band],
    ["Annual order volume", data?.pieces_per_year_band],
    ["Target price", price ? `${price} per unit` : ""],
    ["Sourcing stage", data?.sourcing_stage],
  ];

  return {
    name: data?.name ?? "",
    initials: initialsOf(data?.name),
    logoUrl,
    heroLine: [location, chips.categories.join(" · ")].filter(Boolean).join(" · "),
    tags: chips.products,
    performance: {
      primary: count(data?.club_order_count ?? 0),
      primaryLabel: "Club orders",
      metrics: [{ label: "Active RFQs", value: count(data?.open_request_count ?? 0) }],
    },
    intro: data?.intro || "",
    overviewRows: [
      ["Brand name", data?.name ?? NOT_GIVEN],
      ["Brand category", chips.categories.join(" · ") || NOT_GIVEN],
      ["HQ location", location || NOT_GIVEN],
    ],
    fitSections: [
      ["What the brand makes", chips.products],
      ["Preferred regions", chips.regions],
      ["Certifications requested", chips.certifications],
      ["Services needed", chips.services],
    ].map(([label, items]) => [label, items.length ? items : [NONE]]),
    volumeRows: volume.some(([, value]) => value) ? volume.map(([label, value]) => [label, value || NOT_GIVEN]) : [],
    assets: assets.map((asset) => ({ key: asset.key, title: asset.title, meta: asset.caption, src: asset.src })),
    location,
    trust: [
      { name: "Business profile", status: data?.verified ? "Verified" : "In review", verified: Boolean(data?.verified) },
      ...(data?.open_request_count ? [{ name: "Marketplace activity", status: "Active", verified: true }] : []),
    ],
    empty: {
      intro: "This brand hasn't added an intro yet.",
      volume: "This brand hasn't shared its sourcing volume yet.",
      assets: "This brand hasn't added any images yet.",
    },
  };
}

/** One saved brand as the Saved page's card (minus its handlers). */
export function savedBrandCard({ orgId, name, data, logoUrl }, terms) {
  const view = data ? factoryBrandView({ data, terms, logoUrl, assets: [] }) : null;
  const categories = view ? view.overviewRows[1][1] : NOT_GIVEN;
  return {
    key: orgId,
    orgId,
    initials: initialsOf(name),
    logoUrl,
    name,
    location: view?.location ?? "",
    summary: data?.intro ?? "",
    tags: view
      ? [
        ...(categories !== NOT_GIVEN ? [categories.split(" · ")[0]] : []),
        `${plural(data.club_order_count ?? 0, "Club order")}`,
      ]
      : [],
  };
}
