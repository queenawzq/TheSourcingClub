/**
 * A trading company's own records, in the shape its designed profile page
 * draws (`TradingCompanyProfilePage` in src/factory-prototype/main.jsx).
 *
 * Pure, like factory-profile-view.js, whose helpers it shares: the seam loads
 * the rows, this only arranges them. A trading company answers its own
 * onboarding questions (programs, sourcing regions, services, commercial
 * terms), saved under their own taxonomy kinds and columns; those are what
 * this page shows. What nothing records (a rating, verified partner counts)
 * is left out.
 */
import { termLabel } from "../../lib/domain/taxonomy.js";
import {
  chipLabels,
  documentStatus,
  equipmentList,
  factoryProfileChecks,
  initialsOf,
  profileStatus,
} from "./factory-profile-view.js";

/** Designed chip group → the taxonomy kind the trading onboarding saves it under. */
export const TRADING_CHIP_KINDS = {
  productionPrograms: "production_program",
  productionTypes: "production_type",
  categories: "product_category",
  makes: "make",
  sourcingRegions: "sourcing_region",
  marketLevel: "market_level",
  coreServices: "core_service",
  productDevelopment: "product_development",
  qualityCompliance: "quality_compliance",
  destinationMarkets: "region",
  tools: "digital_tool",
};

/** The text dialogs, by the chip groups and fields each one saves. */
export const TRADING_SECTIONS = {
  network: ["productionPrograms", "productionTypes", "categories", "makes", "sourcingRegions", "marketLevel"],
  services: ["coreServices", "productDevelopment", "qualityCompliance", "destinationMarkets", "tools"],
};

const NOT_GIVEN = "—";
const NONE = "None selected";
const count = (value) => Number(value).toLocaleString("en");
const orNone = (items) => (items.length ? items : [NONE]);

function chipsFor(selected, terms) {
  return Object.fromEntries(
    Object.entries(TRADING_CHIP_KINDS).map(([key, kind]) => [key, chipLabels(kind, selected, terms)]),
  );
}

const listWords = (items) =>
  items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : items[0] ?? "";

/**
 * The completion checks, in the shape factoryProfileChecks() gives (the
 * completion page draws either). The two document checks are the factory's
 * own: a trading company files the same registration and certificates.
 */
export function tradingProfileChecks(parts, now = new Date()) {
  const { profile, chips, references, samples, registration, certificates } = parts;
  const complete = (description) => ({ tone: "complete", status: "Complete", description });
  const missing = (description, action, suggestion) => ({ tone: "missing", status: "Needs attention", description, action, suggestion });
  const gaps = (pairs) => pairs.filter(([, given]) => !given).map(([label]) => label);

  const identityGaps = gaps([
    ["headquarters", profile?.location],
    ["year founded", profile?.founded_year],
    ["team size", profile?.employee_count != null],
    ["languages", profile?.languages_supported],
  ]);
  const networkGaps = gaps([
    ["production programs", chips.productionPrograms.length],
    ["product categories", chips.categories.length],
    ["sourcing regions", chips.sourcingRegions.length],
  ]);
  const servicesGaps = gaps([
    ["core services", chips.coreServices.length],
    ["quality and compliance checks", chips.qualityCompliance.length],
  ]);
  const commercialGaps = gaps([
    ["typical MOQ", profile?.moq != null],
    ["lead time", profile?.typical_lead_days != null],
    ["number of partner factories", profile?.partner_factory_count != null],
  ]);
  const documents = factoryProfileChecks(
    { profile, selected: {}, capacity: null, references, samples, registration, walkthrough: null, certificates },
    now,
  ).filter((check) => check.key === "registration" || check.key === "certificates");

  const checks = [
    {
      key: "identity",
      title: "Company identity",
      todo: "your company details",
      ...(identityGaps.length
        ? missing(`Brands can't see your ${listWords(identityGaps)} yet.`, { label: "Update overview", editor: "company" }, `Add your ${listWords(identityGaps)}`)
        : complete("Company name, headquarters, year founded, team size and languages are complete.")),
    },
    {
      key: "network",
      title: "Supplier network",
      todo: "your supplier network",
      ...(networkGaps.length
        ? missing(`Add your ${listWords(networkGaps)} so brands can find your network.`, { label: "Update supplier network", editor: "network" }, `Add your ${listWords(networkGaps)}`)
        : complete("Production programs, product categories and sourcing regions are filled in.")),
    },
    {
      key: "services",
      title: "Services and oversight",
      todo: "your services",
      ...(servicesGaps.length
        ? missing(`Add your ${listWords(servicesGaps)} so brands know what your team manages.`, { label: "Update services", editor: "services" }, `Add your ${listWords(servicesGaps)}`)
        : complete("Core services and quality checks are visible to brands.")),
    },
    {
      key: "commercial",
      title: "Commercial terms",
      todo: "commercial terms",
      ...(commercialGaps.length
        ? missing(`Add your ${listWords(commercialGaps)} so brands know what you can take on.`, { label: "Update commercial terms", editor: "commercial" }, `Add your ${listWords(commercialGaps)}`)
        : complete("MOQ, lead time and partner factory coverage are visible to brands.")),
    },
    {
      key: "proof",
      title: "Client proof",
      todo: "client references and sourcing work",
      ...(references.length === 0
        ? missing("Add the brands you have worked with, so new brands can see who trusts your company.", { label: "Add references", editor: "references" }, "Add client references")
        : samples.length === 0
          ? missing("Client references are in. Add images of products you have sourced.", { label: "Add sourcing work", editor: "samples" }, "Add recent sourcing work")
          : complete(`${references.length} client reference${references.length === 1 ? "" : "s"} and ${samples.length} sourcing image${samples.length === 1 ? "" : "s"} support buyer trust.`)),
    },
    ...documents,
  ];
  return checks.map((check) => ({ ...check, done: check.tone !== "missing" }));
}

/**
 * Everything the designed trading page needs, as its `live` prop (the seam
 * adds the dialogs' handlers).
 *
 * parts: what load-profile.js's loadOwnProfile() returns.
 */
export function tradingProfileView(parts, now = new Date()) {
  const { orgName, profile, terms, selected, orders = [] } = parts;
  const name = profile?.legal_name || orgName;
  const chips = chipsFor(selected, terms);
  const location = profile?.location || NOT_GIVEN;
  const team = profile?.employee_count != null ? count(profile.employee_count) : null;
  const verified = profile?.verification_status === "verified";
  const registration = parts.registrationDoc
    ? documentStatus(parts.registrationDoc.status, true)
    : verified ? "Verified" : "Not uploaded";
  const certificates = parts.certifications.map((cert) => ({ name: cert.name, status: documentStatus(cert.status, cert.hasFile) }));
  const samples = parts.samples.map((sample) => ({ title: sample.title, meta: sample.caption ?? "", src: sample.src }));
  const references = parts.references.map((reference) => reference.title);
  const live = orders.filter((order) => order.status !== "cancelled");
  const perBrand = live.reduce((tally, order) => tally.set(order.brand_org_id, (tally.get(order.brand_org_id) ?? 0) + 1), new Map());

  const checks = tradingProfileChecks(
    { profile, chips, references: parts.references, samples, registration, certificates },
    now,
  );

  return {
    name,
    initials: initialsOf(name),
    logoUrl: parts.logoUrl ?? null,
    verifiedIcon: verified ? "basic" : null,
    verifiedLabel: verified ? "Business verified" : "",
    heroLine: [
      profile?.location,
      "Trading company",
      team ? `${team}-person sourcing team` : null,
    ].filter(Boolean).join(" · "),
    tags: chips.coreServices.slice(0, 3),
    performance: {
      primary: "New",
      primaryLabel: "No brand reviews yet",
      metrics: [
        { label: "Club orders", value: String(live.length) },
        { label: "Repeat brands", value: String([...perBrand.values()].filter((n) => n > 1).length) },
      ],
    },
    intro: profile?.intro || "",
    overviewRows: [
      ["Company name", name],
      ["Year founded", profile?.founded_year ? String(profile.founded_year) : NOT_GIVEN],
      ["Website URL", profile?.website_url || NOT_GIVEN],
      ["Headquarters", location],
      ["Team size", team ? `${team} people` : NOT_GIVEN],
      ["Languages", profile?.languages_supported || NOT_GIVEN],
    ],
    networkSections: [
      ["Production programs", orNone(chips.productionPrograms)],
      ["Production type", orNone(chips.productionTypes)],
      ["Product categories", orNone(chips.categories)],
      ["Products sourced", orNone(chips.makes)],
      ["Sourcing regions", orNone(chips.sourcingRegions)],
      ["Market level", orNone(chips.marketLevel)],
    ],
    servicesSections: [
      ["Core services", orNone(chips.coreServices)],
      ["Product development", orNone(chips.productDevelopment)],
      ["Quality and compliance", orNone(chips.qualityCompliance)],
      ["Primary destination markets", orNone(chips.destinationMarkets)],
      ["Digital tools", orNone(chips.tools)],
    ],
    commercialRows: [
      ["Typical MOQ", profile?.moq != null ? `${count(profile.moq)} units / style` : NOT_GIVEN],
      ["Typical lead time", profile?.typical_lead_days != null ? `${profile.typical_lead_days} days` : NOT_GIVEN],
      ["Typical order value", profile?.typical_order_value_band || NOT_GIVEN],
      ["Partner factories", profile?.partner_factory_count != null ? `${count(profile.partner_factory_count)} active` : NOT_GIVEN],
      ["Incoterms", profile?.supported_incoterms || NOT_GIVEN],
      ["Payment terms", profile?.typical_payment_terms || NOT_GIVEN],
    ],
    samples,
    trust: [
      { name: "Business registration", status: registration },
      ...certificates,
    ].map((item) => ({ ...item, verified: item.status === "Verified" || item.status === "Uploaded" })),
    references,
    snapshotRows: [
      ["Active factories", profile?.partner_factory_count != null ? count(profile.partner_factory_count) : NOT_GIVEN],
      ["Sourcing regions", String(chips.sourcingRegions.length)],
      ["Primary markets", chips.destinationMarkets.length ? chips.destinationMarkets.join(" · ") : NOT_GIVEN],
    ],
    location,
    status: profileStatus(checks),
    checks,
  };
}

/** Option lists for the trading dialogs' chip groups: the platform's terms plus the company's own. */
export function tradingProfileEditOptions(terms) {
  return Object.fromEntries(
    Object.entries(TRADING_CHIP_KINDS).map(([key, kind]) => [key, (terms?.[kind] ?? []).map((term) => termLabel(term))]),
  );
}

/** Where each trading dialog starts: the company's saved answers. */
export function tradingProfileEditForm(parts) {
  const { orgName, profile, terms, selected, references = [] } = parts;
  const text = (value) => (value == null ? "" : String(value));
  const chips = chipsFor(selected, terms);
  return {
    name: profile?.legal_name || orgName || "",
    founded: text(profile?.founded_year),
    website: text(profile?.website_url),
    location: text(profile?.location),
    employees: text(profile?.employee_count),
    languages: text(profile?.languages_supported),
    intro: text(profile?.intro),
    ...chips,
    marketLevel: chips.marketLevel.slice(0, 1),
    otherCapabilities: equipmentList(profile?.equipment_notes),
    moq: profile?.moq != null ? `${profile.moq} units / style` : "",
    leadTime: profile?.typical_lead_days != null ? `${profile.typical_lead_days} days` : "",
    orderValue: text(profile?.typical_order_value_band),
    partnerFactories: text(profile?.partner_factory_count),
    incoterms: text(profile?.supported_incoterms),
    paymentTerms: text(profile?.typical_payment_terms),
    referencesText: references.map((reference) => reference.title).join("\n"),
  };
}
