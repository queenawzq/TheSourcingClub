/**
 * Browse vendors: each published vendor as the designed marketplace card
 * (`MarketplaceFactoryCard`) and directory card (`DirectoryFactoryCard`),
 * the filter panel's options, and the filtering and ranking behind them.
 *
 * Pure. Cards are built on the brand's view of a vendor's profile
 * (brand-factory-view.js), so a card and the profile it opens say the same
 * thing. Filter options come from the taxonomy and the vendors' own fields,
 * never the design's example lists. What nothing records (a match score, a
 * rating, another brand's order count) is left out rather than invented.
 */
import { availableRange, capacityWindow, minutesPerPieceFor, monthKey, monthlyUnits } from "../../lib/domain/capacity.js";
import { termLabel } from "../../lib/domain/taxonomy.js";
import { brandFactoryView } from "../profile/brand-factory-view.js";
import { chipLabels } from "../profile/factory-profile-view.js";

const NOT_GIVEN = "—";
const count = (value) => Number(value).toLocaleString("en");
const given = (value) => value && value !== NOT_GIVEN;
const shortMonth = (date) => date.toLocaleString("en", { month: "short", timeZone: "UTC" });

/**
 * Best fit, the order the brand dashboard's "Recommended factories" uses:
 * verified first, then the most tags shared with the brand's own profile,
 * then the newest.
 *
 * rows: factory_profiles rows (org_id, verification_status, published_at);
 * links: taxonomy_links rows (subject_id, term_id) of those profiles;
 * brandTerms: getSelectedTerms("brand_profile", …).
 */
export function rankVendors(rows, links, brandTerms) {
  const wanted = new Set(Object.values(brandTerms ?? {}).flat());
  const overlap = new Map();
  for (const link of links) {
    if (wanted.has(link.term_id)) overlap.set(link.subject_id, (overlap.get(link.subject_id) ?? 0) + 1);
  }
  const verified = (row) => Number(row.verification_status === "verified");
  return [...rows].sort((a, b) =>
    verified(b) - verified(a)
    || (overlap.get(b.org_id) ?? 0) - (overlap.get(a.org_id) ?? 0)
    || String(b.published_at).localeCompare(String(a.published_at)));
}

/** A price band's label as a chip: "Mid range ($50-$100)" → "Mid range $50-$100". */
export const priceChip = (label) => String(label ?? "").replace(/\s*\(([^)]*)\)\s*$/, " $1").trim();

/** The design's lead-time ranges, read against the vendor's typical bulk lead. */
export const LEAD_TIMES = [
  { key: "under-30", label: "Under 30 days", test: (days) => days < 30 },
  { key: "30-45", label: "30-45 days", test: (days) => days >= 30 && days <= 45 },
  { key: "over-45", label: "45+ days", test: (days) => days > 45 },
];

/** The design's quantity choices, read against what the vendor can still take on. */
export const QUANTITIES = [
  { key: "300-500", label: "300-500 units", min: 300 },
  { key: "500+", label: "500+ units", min: 500 },
];

/** Months a vendor can start in: the next six, as the booking calendar. */
export function startWindows(now = new Date()) {
  return capacityWindow(6, now).map((month, index) => ({
    key: monthKey(month),
    label: index === 0 ? "Next 30 days" : month.toLocaleString("en", { month: "long", timeZone: "UTC" }),
  }));
}

/** The filter groups for each tab, in the design's order. `kind` = a taxonomy kind. */
const GROUPS = {
  factories: [
    { key: "production_type", title: "Production type", kind: "production_type", style: "check" },
    { key: "product_category", title: "Product categories", kind: "product_category", style: "check" },
    { key: "specialty", title: "Specializes in", kind: "specialty", style: "check" },
  ],
  trading: [
    { key: "sourcing_region", title: "Sourcing regions", kind: "sourcing_region", style: "check" },
    { key: "product_category", title: "Product categories", kind: "product_category", style: "check" },
    { key: "core_service", title: "Services", kind: "core_service", style: "check" },
  ],
};

/**
 * One vendor as both designed cards. parts: one entry of
 * loadVendorDirectory().vendors.
 */
export function vendorCard(parts, now = new Date()) {
  const view = brandFactoryView(parts, now);
  const { profile, selected, terms, capacity: capacityState } = parts;
  const isTrading = profile?.vendor_kind === "trading_company";
  const labels = (kind) => chipLabels(kind, selected, terms);
  const section = (name) => view.fitSections.find(([label]) => label === name)?.[1] ?? [];
  const row = (name) => view.capacityRows.find(([label]) => label === name)?.[1] ?? NOT_GIVEN;
  const priceLevel = row("Price point");

  const category = (terms?.capacity_category ?? []).find((term) => term.id === capacityState?.capacity?.category_term_id);
  const minutes = minutesPerPieceFor(category);
  const units = monthlyUnits(capacityState?.capacity, minutes);
  // Months with room left (mostly open or partly booked), and how many pieces
  // each could still take: the "Open capacity" filter reads these.
  const openMonths = Object.entries(capacityState?.months ?? {})
    .filter(([, level]) => level === "open" || level === "partial")
    .map(([month, level]) => ({ month, units: availableRange(capacityState.capacity, level, minutes)?.max ?? null }));
  const nextOpen = capacityWindow(6, now).find((month) => openMonths.some((open) => open.month === monthKey(month)));

  const moq = profile?.moq != null ? Number(profile.moq) : null;
  const lead = profile?.typical_lead_days != null ? Number(profile.typical_lead_days) : null;
  const regions = labels("sourcing_region");
  const certifications = parts.certifications.map((cert) => cert.name);
  const makes = isTrading ? labels("product_category") : section("Makes");
  const capabilities = isTrading ? labels("core_service") : section("Capabilities");

  const stats = isTrading
    ? [
      ["Network MOQ", moq != null ? `${count(moq)}/style` : NOT_GIVEN],
      ["Regions", regions.slice(0, 2).join(" + ") || NOT_GIVEN],
      ["Lead time", lead != null ? `${lead} days` : NOT_GIVEN],
      ["Partners", profile?.partner_factory_count != null ? `${count(profile.partner_factory_count)} factories` : NOT_GIVEN],
    ]
    : [
      ["MOQ", row("MOQ")],
      ["Price point", priceLevel],
      ["Bulk lead", row("Bulk lead")],
      ["Capacity", view.performance.metrics.find((metric) => metric.label === "Capacity")?.value ?? NOT_GIVEN],
    ];

  const searchText = [
    view.name, view.location, profile?.intro, ...makes, ...capabilities, ...regions, ...certifications,
    ...labels("production_type"), ...labels("specialty"), given(priceLevel) ? priceLevel : "",
  ].filter(Boolean).join(" ").toLowerCase();

  return {
    id: parts.orgId,
    name: view.name,
    initials: view.initials,
    logoUrl: view.logoUrl,
    // The badge the brand's other screens give a verified vendor.
    trust: view.verifiedIcon,
    vendorType: isTrading ? "trading" : "factory",
    location: view.location,
    specialty: isTrading ? "Trading company" : (labels("production_type").slice(0, 2).join(", ") || ""),
    stats,
    notes: profile?.intro ? [profile.intro] : [],
    products: parts.samples.map((sample) => ({ name: sample.title, image: sample.src })),
    categories: makes,
    capabilities,
    // The directory card's tag rows, written the way the design writes them.
    tags: [
      ...labels("production_type").slice(0, 1),
      given(priceLevel) ? priceLevel : null,
      moq != null ? `MOQ ${count(moq)}` : null,
      lead != null ? `${lead} day lead` : null,
      ...certifications.slice(0, 2),
    ].filter(Boolean),
    capacityTags: [
      nextOpen ? `Open ${shortMonth(nextOpen)}` : null,
      units ? `Capacity ${count(units)} units` : null,
    ].filter(Boolean),
    insight: profile?.intro ? [profile.intro] : [],
    facts: {
      termIds: new Set(Object.values(selected ?? {}).flat()),
      certificationIds: new Set(parts.certifications.map((cert) => cert.termId)),
      countryCode: profile?.country_code ?? null,
      moq,
      lead,
      openMonths,
    },
    searchText,
  };
}

/** No filter chosen. */
export function emptyFilters() {
  return {
    terms: {},
    moq: null,
    countries: [],
    certifications: [],
    leadTimes: [],
    startWindow: "",
    quantity: "",
  };
}

const toggle = (list, value) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

/** A copy of `filters` with one option switched on or off. */
export function toggleFilter(filters, group, value) {
  if (group === "countries" || group === "certifications" || group === "leadTimes") {
    return { ...filters, [group]: toggle(filters[group], value) };
  }
  if (group === "startWindow" || group === "quantity") {
    return { ...filters, [group]: filters[group] === value ? "" : value };
  }
  return { ...filters, terms: { ...filters.terms, [group]: toggle(filters.terms[group] ?? [], value) } };
}

/**
 * The cards that pass every chosen filter and the search. Options inside a
 * group widen the match (any of them), groups narrow it (all of them).
 */
export function filterVendors(cards, filters, query = "") {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  return cards.filter((card) => {
    const { facts } = card;
    if (words.some((word) => !card.searchText.includes(word))) return false;
    for (const ids of Object.values(filters.terms)) {
      if (ids.length && !ids.some((id) => facts.termIds.has(id))) return false;
    }
    if (filters.moq) {
      const [min, max] = filters.moq;
      if (facts.moq == null || facts.moq < min || facts.moq > max) return false;
    }
    if (filters.countries.length && !filters.countries.includes(facts.countryCode)) return false;
    if (filters.certifications.length && !filters.certifications.some((id) => facts.certificationIds.has(id))) return false;
    if (filters.leadTimes.length) {
      const ranges = LEAD_TIMES.filter((range) => filters.leadTimes.includes(range.key));
      if (facts.lead == null || !ranges.some((range) => range.test(facts.lead))) return false;
    }
    const quantity = QUANTITIES.find((item) => item.key === filters.quantity);
    if (filters.startWindow || quantity) {
      const months = facts.openMonths.filter((open) => !filters.startWindow || open.month === filters.startWindow);
      if (!months.some((open) => !quantity || (open.units ?? 0) >= quantity.min)) return false;
    }
    return true;
  });
}

/** How many filters are on, for the Reset button and the summary line. */
export function activeFilterCount(filters) {
  return Object.values(filters.terms).reduce((sum, ids) => sum + ids.length, 0)
    + (filters.moq ? 1 : 0)
    + filters.countries.length
    + filters.certifications.length
    + filters.leadTimes.length
    + (filters.startWindow ? 1 : 0)
    + (filters.quantity ? 1 : 0);
}

/**
 * The MOQ range: the span of the vendors' own MOQs and nine bars counting
 * how many vendors fall in each ninth of it, drawn at the design's heights
 * (up to 58 px).
 */
export function moqScale(cards) {
  const values = cards.map((card) => card.facts.moq).filter((value) => value != null);
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const step = (max - min) / 9 || 1;
  const bins = Array.from({ length: 9 }, () => 0);
  for (const value of values) bins[Math.min(8, Math.floor((value - min) / step))] += 1;
  const most = Math.max(...bins);
  return {
    min,
    max,
    step: Math.max(1, Math.round(step / 10) * 10 || 1),
    bars: bins.map((n, index) => ({
      height: n ? Math.round(14 + (44 * n) / most) : 8,
      from: min + index * step,
      to: min + (index + 1) * step,
    })),
  };
}

/**
 * The filter panel for one tab: each group's options from the taxonomy (the
 * platform's own terms, not ones a single company added), the countries and
 * certifications vendors actually have, and the design's ranges.
 */
export function filterPanel(terms, cards, tab = "factories", now = new Date()) {
  const platform = (kind) => (terms?.[kind] ?? []).filter((term) => !term.org_id);
  const countriesInUse = new Set(cards.map((card) => card.facts.countryCode).filter(Boolean));
  return {
    checks: GROUPS[tab].map((group) => ({
      ...group,
      options: platform(group.kind).map((term) => ({ id: term.id, label: termLabel(term) })),
    })),
    priceLevels: platform("market_level").map((term) => ({ id: term.id, label: priceChip(termLabel(term)) })),
    countries: platform("country")
      .filter((term) => countriesInUse.has(term.extra?.code))
      .map((term) => ({ id: term.extra.code, label: termLabel(term) })),
    certifications: platform("certification").map((term) => ({ id: term.id, label: termLabel(term) })),
    leadTimes: LEAD_TIMES.map(({ key, label }) => ({ id: key, label })),
    startWindows: startWindows(now),
    quantities: QUANTITIES.map(({ key, label }) => ({ id: key, label })),
    moq: moqScale(cards),
  };
}
