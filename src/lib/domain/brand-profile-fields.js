/**
 * Where each of the brand's designed answers is stored.
 *
 * Brand onboarding and the brand profile's edit dialogs ask the same
 * questions with the same labels, so both read this one mapping: rename a
 * field in the design and exactly one line changes here.
 */
import { toCents } from "../money.js";

/** Designed label → brand_profiles column. */
export const COLUMN_FOR_LABEL = {
  "Brand name": "legal_name",
  "Business email": "business_email",
  "Website URL": "website_url",
  "HQ location": "hq_location",
  "Year founded": "founded_year",
  "About the brand": "intro",
  "Average pieces ordered per year": "pieces_per_year_band",
  "Typical order size per style": "order_size_band",
  "Collections per year": "collections_per_year",
  "Typical reorder cadence": "reorder_cadence",
  "Current sourcing stage": "sourcing_stage",
  "Annual revenue": "annual_revenue_band",
};

export const NUMERIC_COLUMNS = new Set(["founded_year"]);

/** Designed chip-group label → taxonomy kind. */
export const KIND_FOR_LABEL = {
  "What does your brand make?": "product_category",
  "Market level": "market_level",
  "Preferred regions": "region",
  Certifications: "certification",
  "Services needed": "service",
};

/**
 * "Select all that apply", so it is stored as links like the other groups. The
 * `brand_category` column keeps the first choice, because migration 011 made
 * it a single slug and several things still read it that way.
 */
export const CATEGORY_LABEL = "Brand category";
export const CATEGORY_KIND = "brand_category";

/** Every taxonomy kind a brand profile links to. */
export const BRAND_KINDS = [...new Set([...Object.values(KIND_FOR_LABEL), CATEGORY_KIND])];

/**
 * "$18 - $40" typed into one box, stored as two integer columns.
 *
 * The design asks for a range in a single field. Parsing it here rather than
 * splitting the field keeps the screen as drawn, and a value that cannot be
 * read is stored as nothing rather than as a guess.
 */
export function parsePriceRange(text) {
  const numbers = String(text ?? "").match(/\d+(?:\.\d+)?/g);
  if (!numbers?.length) return { target_price_min_cents: null, target_price_max_cents: null };
  const [low, high = low] = numbers;
  return {
    target_price_min_cents: toCents(low),
    target_price_max_cents: toCents(high),
  };
}

/** The two price columns as one line again: "$18 - $40", "$18", or "". */
export function priceRangeText(minCents, maxCents) {
  const dollars = (cents) => `$${(cents / 100).toLocaleString("en", { maximumFractionDigits: 2 })}`;
  if (minCents == null && maxCents == null) return "";
  if (minCents == null || maxCents == null || minCents === maxCents) return dollars(minCents ?? maxCents);
  return `${dollars(minCents)} - ${dollars(maxCents)}`;
}

/**
 * One designed field's typed value as its column's value: trimmed, blank as
 * null, a year as a number.
 */
export function columnValue(column, raw) {
  const trimmed = typeof raw === "string" ? raw.trim() : raw;
  if (trimmed === "" || trimmed == null) return null;
  return NUMERIC_COLUMNS.has(column) ? Number(trimmed) : trimmed;
}
