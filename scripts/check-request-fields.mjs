/**
 * The request composer's fields: what the brief fills in, and what a saved
 * draft reads back.
 *
 * A draft that was saved, left and reopened came back with "$18-$22 per unit
 * FOB" as "$18–$22", "China, Vietnam" as "China" and "OEKO-TEX" as nothing,
 * and saving it again made the loss permanent. A brief that wrote its colours
 * as "sage 150 and ecru 250" lost the split, and sourcing Details copied the
 * whole sentence. Each case below is one of those, run through the same
 * helpers the composer uses (brief-fields.js, resume-fields.js).
 *
 * Runs in the build. `npm run check:request-fields` runs it alone.
 */
import assert from "node:assert/strict";
import { fieldsFromBrief } from "../src/app/rfq/brief-fields.js";
import { priceRange, resumedPrice, termIdsNamed, typedOr } from "../src/app/rfq/resume-fields.js";

let failures = 0;
function check(name, run) {
  try {
    run();
  } catch (error) {
    failures += 1;
    console.error(`✗ ${name}\n  ${error.message.split("\n").join("\n  ")}`);
  }
}

const certifications = [
  { id: "gots", label_en: "GOTS", aliases: [] },
  { id: "oeko", label_en: "OEKO-TEX Standard 100", aliases: ["OEKO-TEX"] },
  { id: "grs", label_en: "GRS", aliases: [] },
];
const regions = [
  { id: "china", label_en: "China", aliases: [] },
  { id: "us", label_en: "United States", aliases: ["USA"] },
];

/** What the composer does on save (links) and on resume (the card's line). */
function roundTrip(typed, terms) {
  const linked = termIdsNamed(typed, terms);
  const same = (a, b) => a.length === b.length && a.every((id) => b.includes(id));
  const labels = terms.filter((term) => linked.includes(term.id)).map((term) => term.label_en).join(", ");
  return { linked, shown: typedOr(typed, (line) => same(termIdsNamed(line, terms), linked), labels) };
}

// --- Saved drafts read back as typed ----------------------------------------
check("OEKO-TEX, as the placeholder writes it, links OEKO-TEX Standard 100", () => {
  assert.deepEqual(termIdsNamed("OEKO-TEX", certifications), ["oeko"]);
  assert.deepEqual(termIdsNamed("GOTS, OEKO-TEX", certifications), ["gots", "oeko"]);
  assert.deepEqual(termIdsNamed("OEKO-TEX Standard 100", certifications), ["oeko"]);
  assert.deepEqual(roundTrip("OEKO-TEX", certifications).shown, "OEKO-TEX");
});
check("a region with no term keeps the brand's line", () => {
  const { linked, shown } = roundTrip("China, Vietnam", regions);
  assert.deepEqual(linked, ["china"]);
  assert.equal(shown, "China, Vietnam");
  assert.deepEqual(termIdsNamed("USA or China", regions).sort(), ["china", "us"]);
});
check("a typed line that no longer says what is linked gives way to the record", () => {
  assert.equal(typedOr("GOTS", () => false, "OEKO-TEX Standard 100"), "OEKO-TEX Standard 100");
  assert.equal(typedOr("", () => true, "China"), "China");
});
check("the price keeps its basis while the numbers still match", () => {
  const typed = "$18-$22 per unit FOB";
  const row = { price_text: typed, ...priceRange(typed) };
  assert.equal(row.target_unit_price_min_cents, 1800);
  assert.equal(row.target_unit_price_max_cents, 2200);
  assert.equal(resumedPrice(row), typed);
  // Changed elsewhere: the stored figures win.
  assert.equal(resumedPrice({ ...row, target_unit_price_max_cents: 2400 }), "$18–$24");
  // A draft saved before the typed line was kept.
  assert.equal(resumedPrice({ target_unit_price_min_cents: 1250, target_unit_price_max_cents: 1250 }), "$12.50");
  assert.equal(resumedPrice({}), "");
});

// --- The brief ----------------------------------------------------------------
const brief = (text) => fieldsFromBrief(text, [], {});
check("a colour split joined by 'and' is read when it adds up to the total", () => {
  const fields = brief("400 linen shirts, sage 150 and ecru 250, fit sample then PP sample before bulk, factory sources fabric; we provide labels. Delivery by March.");
  assert.equal(fields.quantity, "400 units · Sage 150, Ecru 250");
  assert.equal(fields.sourcing, "partial");
  assert.equal(fields.sourcingDetails, "Factory sources fabric; we provide labels.");
});
check("a split that does not add up, or a size split, is not read as colours", () => {
  assert.equal(brief("400 linen shirts, sage 150 and ecru 200.").quantity, "400 units");
  assert.equal(brief("300 tees, sizes S 100 and M 200, navy.").quantity, "300 units");
});
check("the colours list after 'colours' still reads", () => {
  assert.equal(brief("500 shirts in two colours (sage 200, ecru 300).").quantity, "500 units · Sage 200, Ecru 300");
});
check("sourcing Details is the sourcing part of the sentence only", () => {
  assert.equal(brief("The factory sources fabric; we provide labels.").sourcingDetails, "The factory sources fabric; we provide labels.");
  assert.equal(brief("We provide 2.5 cm woven labels.").sourcingDetails, "We provide 2.5 cm woven labels.");
  assert.equal(brief("We provide a tech pack and reference photos.").sourcingDetails, "");
  assert.equal(brief("Navy shirts, the factory sources fabric, trims, zips; we provide labels.").sourcingDetails, "The factory sources fabric, trims, zips; we provide labels.");
});

if (failures) {
  console.error(`check:request-fields: ${failures} failed`);
  process.exit(1);
}
console.log("check:request-fields: the brief and a resumed draft keep what the brand wrote");
