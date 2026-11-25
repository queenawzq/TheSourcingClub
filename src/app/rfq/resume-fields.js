/**
 * A saved request, back in the review card's own words.
 *
 * The review card is prose and the composer parses it on save. A draft that
 * is opened again has to come back as prose the same parsers read the same
 * way, or saving it again quietly changes it: links the card showed as blank
 * were deleted, a delivery month stored as a date no longer parsed, and the
 * extra details were saved as nothing. Each helper here is the inverse of one
 * parser in LiveComposer.jsx.
 */
import { toCents } from "../../lib/money.js";

// English, as the card is written (taxonomy.js termLabel); kept here so these
// helpers run without the browser client (npm run check:request-fields).
const termLabel = (term) => term?.label_en ?? "";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Labels of the linked terms of one kind, as the card lists them. */
export function linkedLabels(termIds, termsOfKind) {
  return (termsOfKind ?? [])
    .filter((term) => termIds.includes(term.id))
    .map((term) => termLabel(term))
    .join(", ");
}

/**
 * Whether the typed text names a term, as a whole word: "Womenswear" names
 * Womenswear and not Menswear, which a plain substring test also found.
 */
export function mentionsLabel(typed, label) {
  if (!label) return false;
  const escaped = label.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(String(typed ?? "").toLowerCase());
}

/**
 * The terms a typed line names, by label or by a shorter name the taxonomy
 * knows it by: "OEKO-TEX" (the field's own example, and the term's alias)
 * names OEKO-TEX Standard 100, as the brief parser already read it.
 */
export function termIdsNamed(typed, terms) {
  return (terms ?? [])
    .filter((term) => [termLabel(term), termLabel(term)?.split(/\s+standard\b/i)[0], ...(term.aliases ?? [])]
      .some((name) => mentionsLabel(typed, name)))
    .map((term) => term.id);
}

/** The card's sourcing choice for a stored term: the inverse of SOURCING_SLUG. */
export function sourcingChoice(termId, sourcingTerms, slugByChoice) {
  const slug = (sourcingTerms ?? []).find((term) => term.id === termId)?.slug;
  if (!slug) return undefined;
  return Object.keys(slugByChoice).find((choice) => slugByChoice[choice] === slug);
}

/** The exact option wording the brand saw when choosing sourcing support. */
export function sourcingChoiceLabel(term) {
  return {
    "factory-sources": "Vendor should source all materials and components",
    mixed: "Vendor should source some materials or components",
    "brand-supplies": "Brand will provide all materials and components",
    unsure: "Not sure yet",
  }[term?.slug] ?? "";
}

/** "2026-11-01" → "November 2026", which deliveryMonthFrom() reads back. */
export function monthLine(date) {
  const [year, month] = String(date ?? "").split("-").map(Number);
  if (!year || !month) return "";
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/**
 * The brand's typed line when it still says what is stored, else the stored
 * value in the card's words: "Bulk by April 2027" comes back as typed, and a
 * line that no longer matches (edited elsewhere) gives way to the record.
 */
export function typedOr(typed, stillTrue, stored) {
  const line = String(typed ?? "").trim();
  return line && stillTrue(line) ? line : stored;
}

/** "$18-$24" → 1800 / 2400. Unreadable text stores nothing rather than a guess. */
export function priceRange(text) {
  const numbers = String(text ?? "").match(/\d+(?:\.\d+)?/g);
  if (!numbers?.length) return { target_unit_price_min_cents: null, target_unit_price_max_cents: null };
  const [low, high = low] = numbers;
  return { target_unit_price_min_cents: toCents(low), target_unit_price_max_cents: toCents(high) };
}

/** The price as typed ("$18-$22 per unit FOB") while it still reads as the stored cents. */
export function resumedPrice(row) {
  return typedOr(row?.price_text, (typed) => {
    const read = priceRange(typed);
    return read.target_unit_price_min_cents === (row.target_unit_price_min_cents ?? null)
      && read.target_unit_price_max_cents === (row.target_unit_price_max_cents ?? null);
  }, priceLine(row?.target_unit_price_min_cents, row?.target_unit_price_max_cents));
}

/** Stored cents back in the words priceRange() reads: "$12", "$12.50", "$18–$24". */
export function priceLine(lowCents, highCents) {
  if (!lowCents) return "";
  const words = (cents) => `$${cents % 100 ? (cents / 100).toFixed(2) : cents / 100}`;
  const high = highCents ?? lowCents;
  return high === lowCents ? words(lowCents) : `${words(lowCents)}–${words(high)}`;
}

/**
 * The quantity line. An even split into generic colours is written the way
 * colourSplitsFrom() reads it, so it saves back as it was. Named colours are
 * listed by name, which that parser leaves alone, so saving keeps the names
 * rather than renaming them "Colour 1", "Colour 2".
 */
export function quantityLine(total, splits = [], units = "units total") {
  if (!total && !splits.length) return "";
  const sum = total ?? splits.reduce((acc, split) => acc + split.quantity, 0);
  if (!splits.length) return `${sum} units`;
  const generic = splits.every((split, index) => split.colour === `Colour ${index + 1}`);
  const even = splits.every((split) => split.quantity === splits[0].quantity);
  if (generic && even) {
    return `${sum} ${units} · ${splits.length} colors, ${splits[0].quantity} each`;
  }
  return `${sum} ${units} · ${splits.map((split) => `${split.colour} ${split.quantity}`).join(", ")}`;
}
