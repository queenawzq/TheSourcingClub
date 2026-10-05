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
import { termLabel } from "../../lib/domain/taxonomy.js";

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

/** The card's sourcing choice for a stored term: the inverse of SOURCING_SLUG. */
export function sourcingChoice(termId, sourcingTerms, slugByChoice) {
  const slug = (sourcingTerms ?? []).find((term) => term.id === termId)?.slug;
  if (!slug) return undefined;
  return Object.keys(slugByChoice).find((choice) => slugByChoice[choice] === slug);
}

/** "2026-11-01" → "November 2026", which deliveryMonthFrom() reads back. */
export function monthLine(date) {
  const [year, month] = String(date ?? "").split("-").map(Number);
  if (!year || !month) return "";
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/**
 * The quantity line. An even split into generic colours is written the way
 * colourSplitsFrom() reads it, so it saves back as it was. Named colours are
 * listed by name, which that parser leaves alone, so saving keeps the names
 * rather than renaming them "Colour 1", "Colour 2".
 */
export function quantityLine(total, splits = []) {
  if (!total && !splits.length) return "";
  const sum = total ?? splits.reduce((acc, split) => acc + split.quantity, 0);
  if (!splits.length) return String(sum);
  const generic = splits.every((split, index) => split.colour === `Colour ${index + 1}`);
  const even = splits.every((split) => split.quantity === splits[0].quantity);
  if (generic && even) {
    return `${sum} units total · ${splits.length} colors, ${splits[0].quantity} each`;
  }
  return `${sum} units total · ${splits.map((split) => `${split.colour} ${split.quantity}`).join(", ")}`;
}
