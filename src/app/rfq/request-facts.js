import { quantityLine } from "./resume-fields.js";

/**
 * A request's quantity and samples in the brand's own words, for every
 * screen a vendor reads them on.
 *
 * The brand writes "400 units · Sage 150, Ecru 250" and "Fit sample then PP
 * sample before bulk"; the composer stores the split as rfq_colour_splits and
 * the words as sample_notes. Showing only quantity_total and requires_sample
 * reduced both to "400 units" and "Sample required".
 */

/**
 * "400 units · Sage 150, Ecru 250"; generic colours as "2 colors, 200 each".
 * The composer's and the admin page's quantityLine, so every reader sees the
 * same line; "units" rather than "units total", which live-zh translates.
 */
export function requestQuantity(total, splits = []) {
  const rows = (splits ?? [])
    .filter((split) => split?.colour && Number(split.quantity) > 0)
    .map((split) => ({ colour: split.colour, quantity: Number(split.quantity) }));
  return quantityLine(total ?? null, rows.length >= 2 ? rows : [], "units");
}

/** The sample plan as the brand wrote it, else whether one is required. */
export function requestSamples(rfq) {
  const notes = rfq?.sample_notes?.trim();
  if (notes) return notes;
  return rfq?.requires_sample ? "Sample required" : "No sample";
}

/** Longer words than this would overflow the card's one-line tag. */
const TAG_LENGTH = 32;

/** The short card tag: the brand's sample words when they fit, else the design's tag. */
export function requestSampleTag(rfq) {
  const notes = rfq?.sample_notes?.trim();
  if (notes && notes.length <= TAG_LENGTH) return notes;
  return rfq?.requires_sample ? "Sample before bulk" : "";
}
