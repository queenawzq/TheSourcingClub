/**
 * The review card's fields, read out of the brand's own description.
 *
 * The review step shows the brief and, under it, the quote requirements a
 * vendor quotes against. Those started blank whenever the model was off or
 * skipped, so the brand typed again what it had just written. These read the
 * plain facts back out of the text — how many, how many colours, what kind of
 * garment, the target price, when — and leave anything they cannot read
 * blank. A blank is noticed; a wrong guess is not.
 *
 * Each value is written in the shape the save step already parses
 * (colourSplitsFrom, priceRange, deliveryMonthFrom, the category label match
 * in toInvite), so what the brand sees is exactly what gets stored.
 */

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** Who the garment is for → the product_category slug that says so. */
const GENDER_WORDS = {
  womenswear: ["womenswear", "women's", "womens", "women", "ladies", "ladieswear"],
  menswear: ["menswear", "men's", "mens", "men"],
  "childrenswear-baby": ["childrenswear", "kidswear", "children's", "kids"],
};

/** Garment words → the product_category slug they belong to. */
const CATEGORY_WORDS = {
  ...GENDER_WORDS,
  tops: ["top", "shirt", "overshirt", "t-shirt", "tee", "blouse", "polo", "hoodie", "sweatshirt", "sweater", "jumper", "cardigan", "tank", "knitwear"],
  bottoms: ["bottom", "trouser", "pant", "jean", "short", "skirt", "chino", "jogger", "sweatpant"],
  "dresses-jumpsuits": ["dress", "jumpsuit", "romper", "playsuit"],
  outerwear: ["jacket", "coat", "parka", "blazer", "gilet", "puffer", "trench", "outerwear"],
  activewear: ["activewear", "sportswear", "legging", "sports bra", "athleisure"],
  "intimates-underwear": ["underwear", "lingerie", "bra", "boxer"],
  swimwear: ["swimwear", "swimsuit", "bikini", "swim short"],
  "sleepwear-loungewear": ["sleepwear", "loungewear", "pyjama", "pajama", "nightdress", "robe"],
  "childrenswear-baby": ["childrenswear", "kidswear", "babywear", "baby", "toddler"],
  "uniforms-workwear": ["uniform", "workwear", "scrub", "overall"],
  accessories: ["accessory", "accessories", "bag", "tote", "hat", "cap", "beanie", "scarf", "sock", "glove", "belt"],
};

/** Words that say what kind of garment, kept in front of it: "poplin shirts". */
const GARMENT_DESCRIBERS = ["woven", "knit", "knitted", "denim", "poplin", "linen", "jersey", "fleece", "rib", "ribbed", "twill", "corduroy", "silk", "satin", "wool", "cashmere", "leather", "nylon", "canvas", "oxford", "chambray", "flannel", "terry"];

const FABRICS = ["organic cotton", "recycled polyester", "cotton", "linen", "wool", "merino", "cashmere", "silk", "denim", "polyester", "nylon", "viscose", "tencel", "modal", "jersey", "fleece", "corduroy", "twill", "poplin", "satin", "leather"];

const escape = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// "shirt" also reads "shirts"; "dress" also "dresses"; "accessory" is listed both ways.
const wordPattern = (word) => new RegExp(`\\b${escape(word)}(?:e?s)?\\b`, "i");
const firstIndex = (text, word) => {
  const match = text.match(wordPattern(word));
  return match ? match.index : -1;
};
const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const clauses = (text) => text.split(/[.;!?\n,]/).map((part) => part.trim()).filter(Boolean);

/** "250 linen overshirts" → 250. Prices, percentages and spans are skipped. */
function quantityFrom(text) {
  const candidates = text.matchAll(/(^|[^$\d.,\w])(\d{1,3}(?:,\d{3})+|\d+)(?![\d.,]*\s*(?:%|colou?r|day|week|month|year|style|size|business|\$|usd|dollars?))/gi);
  for (const match of candidates) {
    const value = Number(match[2].replace(/,/g, ""));
    if (value >= 10) return value;
  }
  return null;
}

/**
 * "two colours (sage 200, ecru 200)" → Sage 200, Ecru 200. Only a list that
 * follows the word "colours" counts, with at least two named quantities.
 */
function namedSplitsFrom(text) {
  const list = text.match(/colou?r(?:way)?s?\s*(?:\(|:)\s*([^)\n.;]+)/i);
  if (!list) return [];
  const splits = [...list[1].matchAll(/([A-Za-z][A-Za-z-]*(?:\s+[A-Za-z][A-Za-z-]*)?)\s+(\d{1,3}(?:,\d{3})+|\d+)/g)]
    .map(([, name, quantity]) => ({ colour: capitalise(name.replace(/^and\s+/i, "").trim().toLowerCase()), quantity: Number(quantity.replace(/,/g, "")) }))
    .filter((split) => split.quantity > 0);
  return splits.length >= 2 && splits.length <= 24 ? splits : [];
}

// Commas that end a clause, not the one in "1,000".
const COMMA = /,(?!\d{3}\b)/;
const NAMED_QUANTITY = /^([A-Za-z][A-Za-z-]*(?:\s+[A-Za-z][A-Za-z-]*)?)\s+(\d{1,3}(?:,\d{3})+|\d+)$/;
// A bare list is read as colours only when every name is one: "men 150 and
// women 150", "cotton 150 and polyester 150" or "US 100 and EU 200" are not.
// An unknown word leaves the line as "N units", never a wrong split.
const COLOUR_WORD = new RegExp(`^(?:(?:light|dark|pale|deep|bright|dusty|washed|heather)\\s+)?(?:${[
  "black", "white", "grey", "gray", "red", "blue", "green", "yellow", "orange", "pink", "purple", "brown", "beige",
  "navy", "sage", "ecru", "oatmeal", "heather", "charcoal", "khaki", "olive", "stone", "sand", "ivory", "cream",
  "rust", "burgundy", "camel", "taupe", "mauve", "teal", "natural", "indigo", "denim", "tan", "chocolate", "coffee",
  "mocha", "maroon", "wine", "plum", "lilac", "lavender", "mint", "forest", "emerald", "mustard", "coral", "peach",
  "blush", "rose", "fuchsia", "magenta", "turquoise", "aqua", "sky", "cobalt", "royal", "silver", "gold", "bone",
  "nude", "off-white", "offwhite", "slate", "graphite", "ash", "smoke", "pebble", "clay", "terracotta", "brick",
  "cinnamon", "caramel", "toffee", "biscuit", "latte", "vanilla", "lemon", "lime", "moss", "pine", "bottle",
  "petrol", "steel", "ink", "jet", "onyx", "ochre",
].join("|")})$`, "i");

/**
 * "sage 150 and ecru 250" → Sage 150, Ecru 250, without the word "colours":
 * a clause that is nothing but two or more name-and-number pairs, read only
 * when they add up to the request's total (quantityLineFrom checks).
 */
function listedSplitsFrom(text, total) {
  const pair = (part) => {
    const match = part.match(NAMED_QUANTITY);
    if (!match || !COLOUR_WORD.test(match[1].trim())) return null;
    return { colour: capitalise(match[1].trim().toLowerCase()), quantity: Number(match[2].replace(/,/g, "")) };
  };
  for (const sentence of text.split(/(?<!\d)[.;!?](?!\d)|\n/)) {
    // Runs of clauses that are nothing but colour pairs: "sage 150 and ecru
    // 250", "black 100, white 200".
    let run = [];
    const runs = [];
    for (const clause of sentence.split(COMMA)) {
      const pairs = clause.trim().replace(/[.!?]+$/, "").split(/\s*(?:\band\b|&)\s*/i).filter(Boolean).map(pair);
      if (pairs.length && pairs.every(Boolean)) run.push(...pairs);
      else { runs.push(run); run = []; }
    }
    runs.push(run);
    const found = runs.find((splits) => splits.length >= 2 && splits.length <= 24
      && splits.every((split) => split.quantity > 0)
      && splits.reduce((acc, split) => acc + split.quantity, 0) === total);
    if (found) return found;
  }
  return [];
}

/**
 * Who sources the materials, in the review card's choice keys: "Factory
 * sources fabric and trims" → full. Anything less plain is left to the brand.
 */
const BRAND_SUPPLIES = /\b(?:we|brand)\s+(?:will\s+)?(?:supply|supplies|provide|provides)\b/i;
const VENDOR_SOURCES = /\b(?:factory|vendor|supplier)\s+(?:to\s+|should\s+|will\s+)?sources?\b/i;
// "We provide labels" is about sourcing; "we provide a tech pack" or "we
// will provide feedback" is not.
const MATERIAL_WORDS = /\b(?:fabrics?|trims?|labels?|materials?|yarns?|buttons?|zips?|zippers?|packaging|hang ?tags?|components?|accessor(?:y|ies)|linings?|threads?|interlinings?|care labels?)\b/i;
const brandSupplies = (part) => BRAND_SUPPLIES.test(part) && MATERIAL_WORDS.test(part);
// Clause and sentence ends, but not the point in "2.5 cm".
const CLAUSE_END = /(?<!\d)[.;!?](?!\d)|\n/;

function sourcingFrom(text) {
  const parts = text.split(CLAUSE_END);
  const brand = parts.some(brandSupplies);
  const clause = parts.find((part) => VENDOR_SOURCES.test(part));
  // "The factory sources fabric; we provide labels." is the mixed case.
  if (brand && clause) return "partial";
  if (brand) return "brand-provided";
  return clause && !/\b(?:some|partly|partially|except|but)\b/i.test(clause) ? "full" : "";
}

/**
 * The brief's own sentences on who sources what, for the sourcing card's
 * Details: "The factory sources fabric; we provide labels."
 */
function sourcingDetailsFrom(text) {
  const sentences = text.match(/(?:[^.!?\n]|(?<=\d)\.(?=\d))+[.!?]?/g) ?? [];
  const aboutSourcing = (part) => VENDOR_SOURCES.test(part) || part.split(/;/).some(brandSupplies);
  return sentences
    .map((sentence) => {
      // Only the part of the sentence that says who sources what: in "400
      // linen shirts, sage 150 and ecru 250, factory sources fabric; we
      // provide labels." that is the last clause, not the shirts. The run
      // from the first such clause to the last keeps "fabric, trims, zips".
      const clauses = sentence.trim().split(COMMA);
      const first = clauses.findIndex(aboutSourcing);
      if (first < 0) return "";
      const last = clauses.length - 1 - [...clauses].reverse().findIndex(aboutSourcing);
      const run = clauses.slice(first, last + 1).join(",").trim().replace(/[.!?]?$/, "");
      const end = sentence.trim().match(/[.!?]$/)?.[0] ?? (last === clauses.length - 1 ? "" : ".");
      return capitalise(run) + end;
    })
    .filter(Boolean)
    .join(" ");
}

/**
 * The quantity line. Named colours are kept only when they agree with the
 * total (or there is no other total, or the first split number was read as
 * the total): "500 shirts (sage 200, ecru 200)" keeps the 500 and no names.
 */
function quantityLineFrom(text) {
  const named = namedSplitsFrom(text);
  const total = quantityFrom(text);
  if (named.length) {
    const sum = named.reduce((acc, split) => acc + split.quantity, 0);
    if (!total || total === sum || named.some((split) => split.quantity === total)) return quantityLine(sum, null, named);
  }
  // A bare list ("sage 150 and ecru 250") only when it is the total, split.
  const listed = total ? listedSplitsFrom(text, total) : [];
  if (listed.length) return quantityLine(total, null, listed);
  return quantityLine(total, colourCountFrom(text));
}

function colourCountFrom(text) {
  const match = text.match(/(\d+)\s*colou?r(?:way)?s?\b/i);
  const count = match ? Number(match[1]) : 0;
  return count > 0 && count <= 24 ? count : null;
}

/** "$22-$28", "$22 to $28", "$25" → the review card's "$22–$28". */
function priceFrom(text) {
  const range = text.match(/\$\s*(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*\$?\s*(\d+(?:\.\d+)?)/i);
  if (range) return `$${range[1]}–$${range[2]}`;
  const single = text.match(/\$\s*(\d+(?:\.\d+)?)/);
  return single ? `$${single[1]}` : "";
}

/**
 * "delivery by March" → "Delivery by March". The month is what gets stored.
 * With no month, the sentence that gives a span ("Delivery in 60 days") is
 * still the brand's timeline, and is shown rather than left blank.
 */
function timelineFrom(text) {
  const month = MONTHS.join("|");
  const match = text.match(new RegExp(`((?:[A-Za-z-]+\\s+){0,3})\\b(${month}|${MONTHS.map((name) => name.slice(0, 3)).join("|")})\\b\\.?(\\s+20\\d{2})?`, "i"));
  if (match) return capitalise(match[0].replace(/\.$/, "").trim());
  const span = clauses(text).find((clause) => /\b\d+\s*(?:business\s+|working\s+)?(?:days?|weeks?|months?)\b/i.test(clause) && !/\bquotes?\b/i.test(clause));
  return span ? capitalise(span) : "";
}

/** The category terms the text names, by label, alias or garment word, in reading order. */
function categoryTermsIn(text, terms) {
  const found = [];
  for (const term of terms ?? []) {
    const words = [term.label_en, ...(term.aliases ?? []), ...(CATEGORY_WORDS[term.slug] ?? [])].filter(Boolean);
    const at = Math.min(...words.map((word) => firstIndex(text, word)).filter((index) => index >= 0));
    if (Number.isFinite(at)) found.push({ at, term });
  }
  return found.sort((a, b) => a.at - b.at).map((entry) => entry.term);
}

/**
 * The product categories a category line links to. The line is prose
 * ("Womenswear / poplin shirts"), so a garment word counts as well as a
 * label: "shirts" links Tops, and matching keeps working.
 */
export function categoryTermIds(typed, terms) {
  return categoryTermsIn(String(typed ?? ""), terms).map((term) => term.id);
}

/** "300 women's organic cotton poplin shirts" → "poplin shirts". */
function garmentFrom(text) {
  const garments = Object.entries(CATEGORY_WORDS)
    .filter(([slug]) => !GENDER_WORDS[slug])
    .flatMap(([, words]) => words);
  let best = null;
  for (const word of garments) {
    const match = text.match(new RegExp(`(?:\\b([A-Za-z-]+)\\s+)?\\b${escape(word)}(?:e?s)?\\b`, "i"));
    if (match && (best === null || match.index < best.index)) best = match;
  }
  if (!best) return "";
  const [phrase, before] = best;
  const describer = before && GARMENT_DESCRIBERS.includes(before.toLowerCase());
  return (describer ? phrase : phrase.slice(phrase.length - phrase.trimStart().split(/\s+/).pop().length)).toLowerCase();
}

/**
 * The review card's product category, as specific as the brief is:
 * "Womenswear / poplin shirts" rather than "Tops" (QA, Oct 5). Without a
 * garment word, the category labels the text names.
 */
function productTypeFrom(text, terms) {
  const named = categoryTermsIn(text, terms);
  const gender = named.find((term) => GENDER_WORDS[term.slug]);
  const garment = garmentFrom(text);
  if (garment) return gender ? `${gender.label_en} / ${garment}` : capitalise(garment);
  return named.map((term) => term.label_en).join(", ");
}

/**
 * Where the text names a label. An all-capitals label (WRAP, GOTS, GRS) is
 * also an everyday word, so it counts only when written in capitals or next
 * to "certified"/"certification": "wrap dresses" is a garment, not WRAP.
 */
function acronymIndex(text, word) {
  if (!/^[A-Z]{2,}$/.test(word)) return firstIndex(text, word);
  const exact = text.match(new RegExp(`\\b${escape(word)}\\b`));
  if (exact) return exact.index;
  const named = text.match(new RegExp(`\\b${escape(word)}[\\s-]+certif|\\bcertif\\w*\\s+(?:by\\s+|from\\s+)?${escape(word)}\\b`, "i"));
  if (!named) return -1;
  return firstIndex(text.slice(named.index), word) + named.index;
}

/**
 * Taxonomy labels the text names, for regions and certifications: "Portugal
 * or Turkey" → "Portugal, Turkey"; "OEKO-TEX" names OEKO-TEX Standard 100.
 */
function labelsIn(text, terms) {
  const found = [];
  for (const term of terms ?? []) {
    const words = [term.label_en, term.label_en?.split(/\s+standard\b/i)[0], ...(term.aliases ?? [])].filter(Boolean);
    const at = Math.min(...words.map((word) => acronymIndex(text, word)).filter((index) => index >= 0));
    if (Number.isFinite(at)) found.push({ at, label: term.label_en });
  }
  return found.sort((a, b) => a.at - b.at).map((entry) => entry.label).join(", ");
}

function materialFrom(text) {
  const found = [];
  let rest = text;
  for (const fabric of FABRICS) {
    if (wordPattern(fabric).test(rest)) {
      found.push(fabric);
      // "organic cotton" should not also count as "cotton".
      rest = rest.replace(new RegExp(wordPattern(fabric).source, "gi"), " ");
    }
  }
  return found.length ? capitalise(found.join(", ")) : "";
}

/** The quantity line, in the "N units · C colours, M each" shape the save step splits. */
export function quantityLine(total, colours, named = []) {
  if (!total) return "";
  const number = (value) => value.toLocaleString("en-US");
  if (named.length) return `${number(total)} units · ${named.map((split) => `${split.colour} ${number(split.quantity)}`).join(", ")}`;
  if (!colours) return `${number(total)} units`;
  const each = total % colours === 0 ? `, ${number(total / colours)} each` : "";
  return `${number(total)} units · ${colours} colour${colours === 1 ? "" : "s"}${each}`;
}

/**
 * Every review-card field the brief supports, keyed like the card's values.
 * `categoryTerms` is the product_category term list; `otherTerms` holds the
 * certification and region lists (the labels are what the save step links on).
 */
export function fieldsFromBrief(brief, categoryTerms, otherTerms = {}) {
  const text = String(brief ?? "").trim();
  if (!text) return {};
  const samples = clauses(text).find((clause) => /\bsamples?\b/i.test(clause)) ?? "";

  const category = productTypeFrom(text, categoryTerms);
  return {
    // A request is saved under its product when the brand names it nothing
    // else, so the card shows that name rather than an empty field.
    title: category,
    category,
    certifications: labelsIn(text, otherTerms.certification),
    regions: labelsIn(text, otherTerms.region),
    quantity: quantityLineFrom(text),
    material: materialFrom(text),
    samples: capitalise(samples),
    timeline: timelineFrom(text),
    price: priceFrom(text),
    sourcing: sourcingFrom(text),
    sourcingDetails: sourcingDetailsFrom(text),
  };
}

/** Fill only what is still blank: nothing the brand (or the model) wrote is replaced. */
export function fillBlanks(current, found) {
  const next = { ...current };
  for (const [key, value] of Object.entries(found)) {
    if (value && !String(next[key] ?? "").trim()) next[key] = value;
  }
  return next;
}
