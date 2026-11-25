/**
 * A request's quantity and samples in the brand's own words, for every
 * screen a vendor reads them on.
 *
 * The brand writes "400 units · Sage 150, Ecru 250" and "Fit sample then PP
 * sample before bulk"; the composer stores the split as rfq_colour_splits and
 * the words as sample_notes. Showing only quantity_total and requires_sample
 * reduced both to "400 units" and "Sample required".
 */

/** "400 units · Sage 150, Ecru 250"; generic colours as "2 colours, 200 each". */
export function requestQuantity(total, splits = []) {
  const rows = (splits ?? []).filter((split) => split?.colour && Number(split.quantity) > 0);
  const sum = total ?? (rows.length ? rows.reduce((acc, split) => acc + Number(split.quantity), 0) : null);
  if (!sum) return "";
  const number = (value) => Number(value).toLocaleString("en-US");
  const units = `${number(sum)} units`;
  if (rows.length < 2) return units;
  const generic = rows.every((split, index) => split.colour === `Colour ${index + 1}`);
  if (generic) {
    const even = rows.every((split) => Number(split.quantity) === Number(rows[0].quantity));
    return `${units} · ${rows.length} colours${even ? `, ${number(rows[0].quantity)} each` : ""}`;
  }
  return `${units} · ${rows.map((split) => `${split.colour} ${number(split.quantity)}`).join(", ")}`;
}

/** The sample plan as the brand wrote it, else whether one is required. */
export function requestSamples(rfq) {
  const notes = rfq?.sample_notes?.trim();
  if (notes) return notes;
  return rfq?.requires_sample ? "Sample required" : "No sample";
}

/** The short card tag: the brand's sample words, else the design's tag. */
export function requestSampleTag(rfq) {
  const notes = rfq?.sample_notes?.trim();
  if (notes) return notes;
  return rfq?.requires_sample ? "Sample before bulk" : "";
}
