/**
 * Browse RFQs, live: the filter panel's options, and the filtering and sorting
 * behind them. Pure.
 *
 * Options come from the taxonomy. A group or option the request data cannot
 * answer is left out rather than drawn dead:
 *  - Production type: requests carry no such link (migration
 *    20260902001000); the composer never asks. Search still finds the word.
 *  - "$5k+ spent" and up: nothing tells a vendor what a brand has spent.
 *  - "Sample in 30 days": a request says whether it needs a sample, not when.
 */
import { dateFrom } from "../../lib/dates.js";
import { termLabel } from "../../lib/domain/taxonomy.js";

export const SORTS = [
  { key: "fit", label: "Best fit", words: "best fit" },
  { key: "newest", label: "Newest", words: "newest" },
  { key: "deadline", label: "Quote due soonest", words: "soonest quote date" },
  { key: "quantity", label: "Largest quantity", words: "largest quantity" },
  { key: "price", label: "Highest target price", words: "highest target price" },
];

const FILTER_KEYS = ["categories", "prices", "quantities", "regions", "trust", "timelines", "certifications"];

export const emptyFilters = () => Object.fromEntries(FILTER_KEYS.map((key) => [key, []]));

/** The price bands' bounds in cents, by slug. Labels are for reading only. */
const PRICE_BANDS = {
  mass: [800, 1800],
  middle: [1800, 4000],
  premium: [4000, 9000],
  luxury: [9000, Infinity],
};

const QUANTITY_BANDS = {
  "under-300": (units) => units < 300,
  "300-500": (units) => units >= 300 && units <= 500,
  "500-plus": (units) => units >= 500,
};

/** A band contains a request's price range when they overlap by more than an end point. */
export function priceInBand(rfq, slug) {
  const low = rfq.target_unit_price_min_cents ?? rfq.target_unit_price_max_cents;
  const high = rfq.target_unit_price_max_cents ?? rfq.target_unit_price_min_cents;
  const band = PRICE_BANDS[slug];
  if (low === null || low === undefined || !band) return false;
  return low < band[1] && (high > band[0] || (low === high && low >= band[0]));
}

/** Delivery wanted within 60 days: its month has not ended and starts by then. */
export function bulkWithin60Days(rfq, now = new Date()) {
  const month = dateFrom(rfq.target_delivery_month);
  if (!month) return false;
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  return end > now && start.getTime() <= now.getTime() + 60 * 864e5;
}

/** Which of the regions requests name a vendor counts as its own, by country. */
const EUROPE = new Set(["AT", "BE", "BG", "CH", "CZ", "DE", "DK", "ES", "FI", "FR", "GB", "GR", "HR", "HU", "IE", "IT", "NL", "NO", "PL", "PT", "RO", "SE", "SK", "SI"]);
const COUNTRY_REGIONS = { CN: "china", PT: "portugal", KR: "korea", IN: "india", TR: "turkey", US: "united-states" };

export function regionsOfCountry(code) {
  const upper = String(code ?? "").toUpperCase();
  return [COUNTRY_REGIONS[upper], EUROPE.has(upper) ? "europe" : null].filter(Boolean);
}

/**
 * The panel's groups, in the design's order. A row is
 * { rfq, termIds: Set, paymentVerified, text, match }.
 *
 * terms: listTermsByKind(...); myRegions: region slugs that are the vendor's own.
 */
export function filterPanel(terms, myRegions = []) {
  // A company's own custom terms are its words, not a shared vocabulary.
  const shared = (kind) => (terms?.[kind] ?? []).filter((term) => !term.org_id);
  const linked = (kind) => shared(kind).map((term) => ({
    id: term.id,
    label: termLabel(term),
    test: (row) => row.termIds.has(term.id),
  }));
  const regionIds = new Map(shared("region").map((term) => [term.id, term.slug]));
  const namedRegions = (row) => [...row.termIds].filter((id) => regionIds.has(id)).map((id) => regionIds.get(id));

  return [
    { key: "categories", title: "Product categories", style: "check", options: linked("product_category") },
    {
      key: "prices",
      title: "Price point",
      style: "chip",
      options: shared("price_point").map((term) => ({
        id: term.id,
        label: termLabel(term),
        test: (row) => priceInBand(row.rfq, term.slug),
      })),
    },
    {
      key: "quantities",
      title: "Quantity",
      style: "chip",
      suffix: " units",
      options: shared("quantity_band").map((term) => ({
        id: term.id,
        label: termLabel(term),
        test: (row) => Boolean(row.rfq.quantity_total) && Boolean(QUANTITY_BANDS[term.slug]?.(row.rfq.quantity_total)),
      })),
    },
    {
      key: "regions",
      title: "Preferred region",
      style: "chip",
      options: [
        {
          id: "my-region",
          label: "Open to my region",
          test: (row) => {
            const named = namedRegions(row);
            return !named.length || named.some((slug) => myRegions.includes(slug));
          },
        },
        { id: "worldwide", label: "Worldwide", test: (row) => !namedRegions(row).length },
      ],
    },
    {
      key: "trust",
      title: "Client trust",
      style: "chip",
      options: shared("client_trust_band").filter((term) => term.slug === "payment-verified").map((term) => ({
        id: term.id,
        label: termLabel(term),
        test: (row) => row.paymentVerified === true,
      })),
    },
    {
      key: "timelines",
      title: "Timeline",
      style: "chip",
      options: shared("timeline_band").filter((term) => term.slug !== "sample-in-30-days").map((term) => ({
        id: term.id,
        label: termLabel(term),
        test: term.slug === "flexible" ? (row) => !row.rfq.target_delivery_month : (row) => bulkWithin60Days(row.rfq),
      })),
    },
    { key: "certifications", title: "Certifications", style: "chip", options: linked("certification") },
  ];
}

/** Choices restored from an earlier visit, less what the panel no longer offers. */
export function keepKnownFilters(filters, panel) {
  return Object.fromEntries(panel.map((group) => {
    const known = new Set(group.options.map((option) => option.id));
    return [group.key, (filters?.[group.key] ?? []).filter((id) => known.has(id))];
  }));
}

export const activeFilterCount = (filters) => Object.values(filters).flat().length;

export function toggleFilter(filters, key, id) {
  const chosen = filters[key] ?? [];
  return { ...filters, [key]: chosen.includes(id) ? chosen.filter((item) => item !== id) : [...chosen, id] };
}

/** Any option within a group, every group, and every searched word. */
export function filterRows(rows, panel, filters, query = "") {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((row) =>
    panel.every((group) => {
      const chosen = filters[group.key] ?? [];
      return !chosen.length || group.options.some((option) => chosen.includes(option.id) && option.test(row));
    })
    && words.every((word) => row.text.includes(word)));
}

const newest = (row) => String(row.rfq.published_at ?? row.rfq.created_at ?? "");
const byNewest = (a, b) => newest(b).localeCompare(newest(a));
/** Larger first, a request without the figure last. */
const byLarger = (a, b, read) => (read(b) ?? -Infinity) - (read(a) ?? -Infinity);

const COMPARE = {
  fit: (a, b) => byLarger(a, b, (row) => row.match),
  newest: () => 0,
  deadline: (a, b) => {
    const time = (row) => (row.rfq.quote_deadline ? new Date(row.rfq.quote_deadline).getTime() : Infinity);
    return time(a) === time(b) ? 0 : time(a) - time(b);
  },
  quantity: (a, b) => byLarger(a, b, (row) => row.rfq.quantity_total),
  price: (a, b) => byLarger(a, b, (row) => row.rfq.target_unit_price_max_cents ?? row.rfq.target_unit_price_min_cents),
};

/** Ties go to the newest. */
export function sortRows(rows, sort) {
  const compare = COMPARE[sort] ?? COMPARE.fit;
  return [...rows].sort((a, b) => compare(a, b) || byNewest(a, b));
}

/** The chosen filters and order in words, for the line under the count. */
export function matchingLine(panel, filters, query, sort) {
  const words = panel.flatMap((group) =>
    group.options
      .filter((option) => (filters[group.key] ?? []).includes(option.id))
      .map((option) => `${option.label}${group.suffix ?? ""}`));
  if (query.trim()) words.push(`"${query.trim()}"`);
  const order = `${(SORTS.find((option) => option.key === sort) ?? SORTS[0]).words} first`;
  return words.length ? `matching ${words.join(", ")}, ${order}` : "";
}
