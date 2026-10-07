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

/** Garment words → the product_category slug they belong to. */
const CATEGORY_WORDS = {
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

/** "delivery by March" → "Delivery by March". The month is what gets stored. */
function timelineFrom(text) {
  const month = MONTHS.join("|");
  const match = text.match(new RegExp(`((?:[A-Za-z-]+\\s+){0,3})\\b(${month}|${MONTHS.map((name) => name.slice(0, 3)).join("|")})\\b\\.?(\\s+20\\d{2})?`, "i"));
  if (!match) return "";
  return capitalise(match[0].replace(/\.$/, "").trim());
}

function categoriesFrom(text, terms) {
  const found = [];
  for (const term of terms ?? []) {
    const words = [term.label_en, ...(term.aliases ?? []), ...(CATEGORY_WORDS[term.slug] ?? [])].filter(Boolean);
    const at = Math.min(...words.map((word) => firstIndex(text, word)).filter((index) => index >= 0));
    if (Number.isFinite(at)) found.push({ at, label: term.label_en });
  }
  return found.sort((a, b) => a.at - b.at).map((entry) => entry.label);
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
 * `categoryTerms` is the product_category term list (the labels are what the
 * save step links on).
 */
export function fieldsFromBrief(brief, categoryTerms) {
  const text = String(brief ?? "").trim();
  if (!text) return {};
  const samples = clauses(text).find((clause) => /\bsamples?\b/i.test(clause)) ?? "";

  return {
    category: categoriesFrom(text, categoryTerms).join(", "),
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
