/**
 * A factory's own records, in the shape the designed profile page draws
 * (`factoryProfileData` in src/factory-prototype/main.jsx).
 *
 * Pure: the seam (LiveFactoryProfile.jsx) loads the rows, this only arranges
 * them, so nothing here can invent a number. Where the design shows something
 * nothing records (a rating, reviews, a response time) it is left out or said
 * plainly, never filled with an example.
 */
import { termLabel } from "../../lib/domain/taxonomy.js";
import {
  CAPACITY_LEVELS,
  availableRange,
  capacityWindow,
  estimatedHours,
  minutesPerPieceFor,
  monthKey,
} from "../../lib/domain/capacity.js";

/** Designed chip group → the taxonomy kind onboarding saves it under. */
export const CHIP_KINDS = {
  manufacturingModels: "manufacturing_model",
  productionTypes: "production_type",
  categories: "product_category",
  makes: "make",
  marketLevel: "market_level",
  specialties: "specialty",
  services: "design_service",
  exportMarkets: "region",
  tools: "digital_tool",
};

const NOT_GIVEN = "—";

const shortMonth = (date) => date.toLocaleString("en", { month: "short", timeZone: "UTC" });
const monthYear = (iso) => new Date(iso).toLocaleString("en", { month: "short", year: "numeric" });
const dayMonth = (iso) => new Date(iso).toLocaleString("en", { month: "short", day: "numeric" });
const count = (value) => Number(value).toLocaleString("en");

export function initialsOf(name) {
  return String(name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("") || "TS";
}

/** "Flatlock, linking\nWashing" → ["Flatlock", "linking", "Washing"]. */
export function equipmentList(notes) {
  return String(notes ?? "")
    .split(/[,\n;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** A file name as a title: "Organic poplin shirt.jpg" → "Organic poplin shirt". */
export function titleFromFileName(name) {
  const base = String(name ?? "").replace(/\.[a-z0-9]+$/i, "").replace(/_+/g, " ").trim();
  return base ? base[0].toUpperCase() + base.slice(1) : "Sample";
}

/** The design's status words for a verification document. */
export function documentStatus(status, hasFile) {
  if (status === "verified") return "Verified";
  if (status === "rejected") return "Rejected";
  return hasFile ? "Uploaded" : "Not uploaded";
}

/**
 * Labels per chip group, in the taxonomy's order.
 * `selected` is getSelectedTerms() ({ kind: [termId] }), `terms` listTermsByKind().
 */
function chipLabels(kind, selected, terms) {
  const ids = new Set(selected?.[kind] ?? []);
  return (terms?.[kind] ?? []).filter((term) => ids.has(term.id)).map((term) => termLabel(term));
}

function capacityRowsFor(profile, capacityState, terms, now) {
  const { capacity, months = {} } = capacityState ?? {};
  const category = (terms?.capacity_category ?? []).find((term) => term.id === capacity?.category_term_id);
  const minutes = minutesPerPieceFor(category);
  const window = capacityWindow(6, now);
  const current = window[0];
  const currentLevel = months[monthKey(current)];
  const range = capacity && currentLevel ? availableRange(capacity, currentLevel, minutes) : null;
  const hours = capacity ? estimatedHours(capacity, minutes) : null;
  const booked = window
    .filter((month) => months[monthKey(month)])
    .slice(0, 2)
    .map((month) => `${shortMonth(month)} ${CAPACITY_LEVELS[months[monthKey(month)]].labelEn.toLowerCase()}`);

  return [
    ["MOQ", profile?.moq != null ? `${count(profile.moq)} units / style` : NOT_GIVEN],
    ["Typical lead time", profile?.typical_lead_days != null ? `${profile.typical_lead_days} days` : NOT_GIVEN],
    ["Typical sample lead time", profile?.sample_lead_days != null ? `${profile.sample_lead_days} days` : NOT_GIVEN],
    ["Capacity category", category ? termLabel(category) : NOT_GIVEN],
    ["Line-hours", hours ? `${capacity.input_mode === "hours" ? "" : "~"}${count(hours)} hours / month` : NOT_GIVEN],
    [
      "Estimated capacity",
      range
        ? `${shortMonth(current)} roughly ${range.min === range.max ? count(range.max) : `${count(range.min)}-${count(range.max)}`} pieces`
        : NOT_GIVEN,
    ],
    ["Booking level", booked.length ? booked.join("; ") : NOT_GIVEN],
    [
      "Reference style",
      category?.extra?.reference_style_en ? `${category.extra.reference_style_en} · ~${minutes} min/pc` : NOT_GIVEN,
    ],
  ];
}

/** The factory's own orders as the design's project cards. */
function projectCards(orders) {
  const card = (order, completed) => ({
    key: order.id,
    title: order.rfqs?.title ?? order.order_number ?? "Production order",
    brand: order.brand?.name ?? "Brand",
    date: completed
      ? `${monthYear(order.activated_at ?? order.created_at)} - ${monthYear(order.completed_at)}`
      : `Started ${dayMonth(order.activated_at ?? order.created_at)}`,
    result: completed ? "Completed" : order.current_milestone_title ?? "In production",
    summary: `${count(order.production_quantity ?? 0)} units${order.order_number ? ` · ${order.order_number}` : ""}`,
    rating: "",
    review: "",
    tags: [],
  });
  return {
    completed: orders.filter((order) => order.status === "completed").map((order) => card(order, true)),
    inProduction: orders.filter((order) => order.status === "active").map((order) => card(order, false)),
  };
}

/**
 * How complete the profile is, as the design's completion checks. Computed
 * from the data, never stored, so it can't disagree with what's filled in.
 * `todo` is the phrase used in "Add … to strengthen this profile."
 */
export function factoryProfileChecks(parts, now = new Date()) {
  const { profile, selected, capacity, references, samples, registration, walkthrough, certifications } = parts;
  const has = (kind) => (selected?.[kind]?.length ?? 0) > 0;
  const currentMonth = monthKey(capacityWindow(1, now)[0]);
  return [
    {
      key: "identity",
      title: "Factory identity",
      done: Boolean(profile?.location && profile?.nearest_port && profile?.founded_year && profile?.employee_count != null),
      todo: "your factory details",
    },
    {
      key: "production",
      title: "Production fit",
      done: has("manufacturing_model") && has("production_type") && has("product_category"),
      todo: "your production fit",
    },
    {
      key: "capacity",
      title: "Capacity and terms",
      done: Boolean(profile?.moq != null && profile?.typical_lead_days != null && capacity?.capacity),
      todo: "capacity and terms",
    },
    {
      key: "proof",
      title: "Client proof",
      done: references.length > 0 && samples.length > 0,
      todo: "client references and sample images",
    },
    {
      key: "registration",
      title: "Verification documents",
      done: registration === "Verified",
      todo: "your business registration",
    },
    {
      key: "walkthrough",
      title: "Factory walkthrough",
      done: Boolean(walkthrough),
      todo: "a walkthrough video",
    },
    {
      key: "certificates",
      title: "Certificate files",
      done: certifications.every((cert) => cert.status !== "Not uploaded"),
      todo: "the missing certificate files",
    },
    {
      key: "freshness",
      title: "Monthly capacity freshness",
      done: Boolean(capacity?.months?.[currentMonth]),
      todo: "this month's capacity",
    },
  ];
}

export function profileStatus(checks) {
  const done = checks.filter((check) => check.done).length;
  const percent = Math.round((done / checks.length) * 100);
  const missing = checks.filter((check) => !check.done).map((check) => check.todo);
  const list = missing.length > 2
    ? `${missing.slice(0, 2).join(", ")} and more`
    : missing.join(" and ");
  return {
    percent,
    note: missing.length
      ? `Add ${list} to strengthen this profile.`
      : "Everything brands look for is filled in. Keep monthly capacity current.",
  };
}

/**
 * Everything the designed page needs, as its `live` prop.
 *
 * parts: { orgName, profile, terms, selected, capacity, references,
 *          certifications: [{ name, status, hasFile }], registrationDoc,
 *          logoUrl, samples: [{ title, src }], walkthrough: { url, status, created_at } | null,
 *          orders }
 */
export function factoryProfileView(parts, now = new Date()) {
  const { orgName, profile, terms, selected, capacity, orders = [] } = parts;
  const name = profile?.legal_name || orgName;
  const chips = Object.fromEntries(
    Object.entries(CHIP_KINDS).map(([key, kind]) => [key, chipLabels(kind, selected, terms)]),
  );
  const registration = parts.registrationDoc
    ? documentStatus(parts.registrationDoc.status, true)
    : profile?.verification_status === "verified" ? "Verified" : "Not uploaded";
  const certifications = [
    { name: "Business registration", status: registration },
    ...parts.certifications.map((cert) => ({ name: cert.name, status: documentStatus(cert.status, cert.hasFile) })),
  ];
  const references = parts.references.map((reference) => reference.title);
  const samples = parts.samples.map((sample) => ({ title: sample.title, meta: "", src: sample.src }));
  const live = orders.filter((order) => order.status !== "cancelled");
  const perBrand = live.reduce((tally, order) => tally.set(order.brand_org_id, (tally.get(order.brand_org_id) ?? 0) + 1), new Map());
  const projects = projectCards(orders);
  const verified = profile?.verification_status === "verified";
  const leadTime = profile?.typical_lead_days != null ? `${profile.typical_lead_days} days` : NOT_GIVEN;

  const data = {
    name,
    location: profile?.location || NOT_GIVEN,
    nearestPort: profile?.nearest_port || NOT_GIVEN,
    founded: profile?.founded_year ? String(profile.founded_year) : NOT_GIVEN,
    website: profile?.website_url || NOT_GIVEN,
    employees: profile?.employee_count != null ? count(profile.employee_count) : NOT_GIVEN,
    profileVerified: verified ? "Business registration verified" : "Verification pending",
    intro: profile?.intro || "",
    ...chips,
    // The taxonomy label carries a price band for choosing in onboarding
    // ("Premium / contemporary ($100-$500)"); the profile's tag is the design's
    // shorter wording, which also keeps it on one line at phone width.
    marketLevel: (chips.marketLevel[0] ?? "").replace(/\s*\([^)]*\)\s*$/, ""),
    equipment: equipmentList(profile?.equipment_notes),
    leadTime,
    clubOrders: String(live.length),
    repeatBrands: String([...perBrand.values()].filter((orderCount) => orderCount > 1).length),
    certifications,
    walkthrough: [],
    references,
    products: samples,
    pastProjects: projects.completed,
    inProductionProjects: projects.inProduction,
  };

  const checks = factoryProfileChecks(
    { profile, selected, capacity, references, samples, registration, walkthrough: parts.walkthrough, certifications },
    now,
  );

  return {
    data,
    capacityRows: capacityRowsFor(profile, capacity, terms, now),
    heroLine: [
      profile?.location,
      profile?.nearest_port,
      profile?.employee_count != null ? `${count(profile.employee_count)} employees` : null,
    ].filter(Boolean).join(" · ") || "Location not given",
    initials: initialsOf(name),
    logoUrl: parts.logoUrl ?? null,
    // The design pairs "Business registration verified" with this badge.
    verifiedIcon: verified ? "basic" : null,
    performance: { primary: "New", primaryLabel: "No brand reviews yet" },
    status: profileStatus(checks),
    walkthrough: parts.walkthrough
      ? {
        url: parts.walkthrough.url,
        title: parts.walkthrough.status === "verified" ? "Verified production-floor walkthrough" : "Production-floor walkthrough",
        note: `Uploaded ${dayMonth(parts.walkthrough.created_at)}.`,
      }
      : null,
    checks,
  };
}
