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
 * Taxonomy labels the text names, for regions and certifications: "Portugal
 * or Turkey" → "Portugal, Turkey"; "OEKO-TEX" names OEKO-TEX Standard 100.
 */
function labelsIn(text, terms) {
  const found = [];
  for (const term of terms ?? []) {
    const words = [term.label_en, term.label_en?.split(/\s+standard\b/i)[0], ...(term.aliases ?? [])].filter(Boolean);
    const at = Math.min(...words.map((word) => firstIndex(text, word)).filter((index) => index >= 0));
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
export function quantityLine(total, colours) {
  if (!total) return "";
  const number = (value) => value.toLocaleString("en-US");
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

  return {
    category: productTypeFrom(text, categoryTerms),
    certifications: labelsIn(text, otherTerms.certification),
    regions: labelsIn(text, otherTerms.region),
    quantity: quantityLine(quantityFrom(text), colourCountFrom(text)),
    material: materialFrom(text),
    samples: capitalise(samples),
    timeline: timelineFrom(text),
    price: priceFrom(text),
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
