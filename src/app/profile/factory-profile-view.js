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
export function chipLabels(kind, selected, terms) {
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

const listWords = (items) =>
  items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : items[0] ?? "";

/**
 * How complete the profile is, as the design's completion checks. Computed
 * from the data, never stored, so it can't disagree with what's filled in.
 *
 * Each check: `done` (counts towards the percent), `tone` (complete,
 * progress: waiting on TSC's review, missing), the design's `status` word,
 * a `description` written from the data, `todo` (the phrase used in "Add …
 * to strengthen this profile."), and for a missing item an `action`
 * (`{ label, editor }`, the profile dialog that fixes it) and a
 * `suggestion` for the "Suggested updates" list.
 *
 * "Verified" is only said of what an admin actually checks (the business
 * registration, certificates, a reviewed walkthrough); everything else the
 * factory fills in is "Complete".
 */
export function factoryProfileChecks(parts, now = new Date()) {
  const { profile, selected, capacity, references, samples, registration, walkthrough, certificates = [] } = parts;
  const has = (kind) => (selected?.[kind]?.length ?? 0) > 0;
  const current = capacityWindow(1, now)[0];
  const monthName = current.toLocaleString("en", { month: "long", timeZone: "UTC" });
  const complete = (description, status = "Complete") => ({ tone: "complete", status, description });
  const inReview = (description) => ({ tone: "progress", status: "In review", description });
  const missing = (description, action, suggestion) => ({ tone: "missing", status: "Needs attention", description, action, suggestion });

  const identityGaps = [
    ["location", profile?.location],
    ["nearest port", profile?.nearest_port],
    ["year founded", profile?.founded_year],
    ["employee count", profile?.employee_count],
  ].filter(([, value]) => value == null || value === "").map(([label]) => label);

  const productionGaps = [
    ["manufacturing model", has("manufacturing_model")],
    ["production type", has("production_type")],
    ["product categories", has("product_category")],
  ].filter(([, given]) => !given).map(([label]) => label);

  const capacityGaps = [
    ["MOQ", profile?.moq != null],
    ["lead time", profile?.typical_lead_days != null],
    ["monthly capacity", Boolean(capacity?.capacity)],
  ].filter(([, given]) => !given).map(([label]) => label);

  const noFile = certificates.filter((cert) => cert.status === "Not uploaded" || cert.status === "Rejected").map((cert) => cert.name);
  const waiting = certificates.filter((cert) => cert.status === "Uploaded").map((cert) => cert.name);

  const checks = [
    {
      key: "identity",
      title: "Factory identity",
      todo: "your factory details",
      ...(identityGaps.length
        ? missing(`Brands can't see your ${listWords(identityGaps)} yet.`, { label: "Update overview", editor: "overview" }, `Add your ${listWords(identityGaps)}`)
        : complete("Factory name, location, nearest port, year founded and employee count are complete.")),
    },
    {
      key: "production",
      title: "Production fit",
      todo: "your production fit",
      ...(productionGaps.length
        ? missing(`Add your ${listWords(productionGaps)} so brands can find this factory.`, { label: "Update production fit", editor: "production" }, `Add your ${listWords(productionGaps)}`)
        : complete("Manufacturing model, production type and product categories are filled in, with the makes, specialties, services, markets, tools and equipment you chose.")),
    },
    {
      key: "capacity",
      title: "Capacity and terms",
      todo: "capacity and terms",
      ...(capacityGaps.length
        ? missing(`Add your ${listWords(capacityGaps)} so brands know what you can take on.`, { label: "Update capacity", editor: "capacity" }, `Add your ${listWords(capacityGaps)}`)
        : complete("MOQ, lead times, capacity category and estimated monthly capacity are visible to brands.")),
    },
    {
      key: "proof",
      title: "Client proof",
      todo: "client references and sample images",
      ...(references.length === 0
        ? missing("Add the brands you have worked with, so new brands can see who trusts this factory.", { label: "Add references", editor: "references" }, "Add client references")
        : samples.length === 0
          ? missing("Client references are in. Add images of samples you have developed.", { label: "Add sample images", editor: "samples" }, "Add sample images")
          : complete(`${references.length} client reference${references.length === 1 ? "" : "s"} and ${samples.length} sample image${samples.length === 1 ? "" : "s"} support buyer trust.`)),
    },
    {
      // As in the design, this row is the review state of every document:
      // the registration, plus certificates uploaded and waiting for TSC.
      key: "registration",
      title: "Verification documents",
      todo: "your business registration",
      ...(registration === "Rejected"
        ? missing("Your business registration wasn't accepted. Upload a new one to open quoting.", { label: "Upload registration", editor: "verification" }, "Upload a new business registration")
        : registration !== "Verified" && registration !== "Uploaded"
          ? missing("Upload your business registration. Quoting opens once TSC has verified it.", { label: "Upload registration", editor: "verification" }, "Upload your business registration")
          : registration === "Uploaded"
            ? inReview(`Your business registration is uploaded${waiting.length ? `, and so ${waiting.length === 1 ? "is" : "are"} ${listWords(waiting)}` : ""}. TSC is reviewing ${waiting.length ? "them" : "it"}; quoting opens once the registration is approved.`)
            : waiting.length
              ? inReview(`Your business registration is verified. ${listWords(waiting)} ${waiting.length === 1 ? "is" : "are"} uploaded and waiting for TSC's review.`)
              : complete("Your business registration is verified, so you can quote on matching RFQs.", "Verified")),
    },
    {
      key: "walkthrough",
      title: "Factory walkthrough",
      todo: "a walkthrough video",
      ...(walkthrough
        ? complete("The walkthrough video is on your profile.", walkthrough.status === "verified" ? "Verified" : "Complete")
        : missing("Add a short production-floor walkthrough so brands can see the factory before they contact you.", { label: "Add walkthrough", editor: "walkthrough" }, "Add a walkthrough video")),
    },
    {
      // Named after the certificate when only one needs a file, as the
      // design's "GOTS certificate" row is.
      key: "certificates",
      title: noFile.length === 1 ? `${noFile[0]} certificate` : "Certificate files",
      todo: "the missing certificate files",
      ...(noFile.length
        ? missing(
          `${listWords(noFile)} ${noFile.length === 1 ? "has" : "have"} no accepted certificate file. Upload the certificate, or remove the certification if it is not currently held.`,
          { label: "Upload certificate", editor: "verification" },
          `Upload ${listWords(noFile)} certificate${noFile.length === 1 ? "" : "s"}`,
        )
        : certificates.length
          ? complete(`Every certification you claim has its certificate file: ${listWords(certificates.map((cert) => cert.name))}.`)
          : complete("No certifications claimed. Add any you hold under Verification.")),
    },
    {
      key: "freshness",
      title: "Monthly capacity freshness",
      todo: "this month's capacity",
      ...(capacity?.months?.[monthKey(current)]
        ? complete(`${monthName} capacity is set, so RFQ matches use your current availability.`)
        : missing(`${monthName} has no booking level yet. Add it to improve RFQ matching confidence.`, { label: "Update capacity", editor: "capacity" }, `Add ${monthName} available capacity`)),
    },
  ];
  return checks.map((check) => ({ ...check, done: check.tone !== "missing" }));
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
 *          logoUrl, samples: [{ title, caption, src }],
 *          walkthrough: { url, status, title, caption, created_at } | null,
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
  const samples = parts.samples.map((sample) => ({ title: sample.title, meta: sample.caption ?? "", src: sample.src }));
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
    { profile, selected, capacity, references, samples, registration, walkthrough: parts.walkthrough, certificates: certifications.slice(1) },
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
        title: parts.walkthrough.title
          || (parts.walkthrough.status === "verified" ? "Verified production-floor walkthrough" : "Production-floor walkthrough"),
        note: parts.walkthrough.caption || `Uploaded ${dayMonth(parts.walkthrough.created_at)}.`,
      }
      : null,
    checks,
  };
}

/** The months the capacity dialog marks up: the next three from today. */
export function bookingMonths(now = new Date()) {
  return capacityWindow(3, now).map(shortMonth);
}

/**
 * Chip-group options for the production-fit dialog: the platform's terms,
 * plus any this factory added itself. Key machines have no taxonomy, so the
 * dialog keeps the design's suggestions for them.
 */
export function factoryProfileEditOptions(terms) {
  return Object.fromEntries(
    Object.entries(CHIP_KINDS).map(([key, kind]) => [key, (terms?.[kind] ?? []).map((term) => termLabel(term))]),
  );
}

/**
 * Where each edit dialog starts: the factory's saved answers, in the form
 * fields the design's dialog uses. Numbers are written the way the profile
 * shows them ("150 units / style"); saving reads the first number back.
 */
export function factoryProfileEditForm(parts, now = new Date()) {
  const { orgName, profile, terms, selected, capacity: capacityState, references = [] } = parts;
  const text = (value) => (value == null ? "" : String(value));
  const withUnit = (value, unit) => (value == null ? "" : `${value} ${unit}`);
  const row = capacityState?.capacity;
  const category = (terms?.capacity_category ?? []).find((term) => term.id === row?.category_term_id);
  const months = {};
  for (const month of capacityWindow(6, now)) {
    const level = capacityState?.months?.[monthKey(month)];
    if (level) months[shortMonth(month)] = level;
  }
  const chips = Object.fromEntries(
    Object.entries(CHIP_KINDS).map(([key, kind]) => [key, chipLabels(kind, selected, terms)]),
  );

  return {
    name: profile?.legal_name || orgName || "",
    location: text(profile?.location),
    nearestPort: text(profile?.nearest_port),
    founded: text(profile?.founded_year),
    website: text(profile?.website_url),
    employees: text(profile?.employee_count),
    intro: text(profile?.intro),
    moq: withUnit(profile?.moq, "units / style"),
    leadTime: withUnit(profile?.typical_lead_days, "days"),
    sampleLeadTime: withUnit(profile?.sample_lead_days, "days"),
    // The dialog shows a category whatever is saved, falling back to wovens
    // as the design does; starting there means what is shown is what saves.
    capacityCategoryKey: category?.slug ?? "wovens",
    capacityInputMode: row?.input_mode ?? "units",
    lineHoursInput: row?.line_hours != null ? String(Math.round(Number(row.line_hours))) : "",
    capacityMonthlyUnits: text(row?.monthly_units),
    capacityMonthSelections: months,
    ...chips,
    marketLevel: chips.marketLevel.slice(0, 1),
    equipment: equipmentList(profile?.equipment_notes),
    referencesText: references.map((reference) => reference.title).join("\n"),
  };
}
