/**
 * "Automatically translated to English": one label per card, at the top of
 * the card, "See original" beside it, the same space above and below, and
 * none in the rail's vendor card. No Chinese for a moment before the English.
 *
 * The second label had come back once already: the vendor card was fixed to
 * one label, then BrandEnglishLayer added one after every translated text
 * and raced the card's own. Nothing could tell, because each screen still
 * looked right on its own most of the time. This runs the real placement rule
 * (src/app/translation-card.mjs) on the real screens' markup, and reads the
 * real CSS and sources, with no browser; it runs in the build.
 */
import { readFileSync } from "node:fs";
import { CARD, CARD_STOP, HEADER_ROW, NO_LABEL, SELF_TRANSLATING, cardFor, labelAnchors } from "../src/app/translation-card.mjs";

let failures = 0;
let checks = 0;
const check = (ok, note) => {
  checks += 1;
  if (!ok) {
    failures += 1;
    console.log(`  ✗ ${note}`);
  }
};

// ---- A small element tree: enough of the DOM for the placement rule ----
const order = [];
class El {
  constructor(spec, children = []) {
    const [tag, ...classes] = spec.split(".");
    this.tagName = tag.toUpperCase();
    this.classes = new Set(classes);
    this.children = children;
    this.parentElement = null;
    for (const child of children) child.parentElement = this;
  }
  get className() { return [...this.classes].join(" "); }
  matchesOne(simple) {
    const re = /^([a-z]*)((?:\.[\w-]+)*)(?:\[(\w+)([$*]?)=['"]([^'"]*)['"]\])?$/;
    const m = simple.trim().match(re);
    if (!m) throw new Error(`selector not understood here: ${simple}`);
    const [, tag, cls, attr, op, value] = m;
    if (tag && tag.toUpperCase() !== this.tagName) return false;
    for (const c of cls.split(".").filter(Boolean)) if (!this.classes.has(c)) return false;
    if (attr) {
      const actual = attr === "class" ? this.className : (this.attrs?.[attr] ?? null);
      if (actual == null) return false;
      if (op === "$" ? !actual.endsWith(value) : op === "*" ? !actual.includes(value) : actual !== value) return false;
    }
    return true;
  }
  matches(selector) { return selector.split(",").some((one) => this.matchesOne(one)); }
  closest(selector) { for (let at = this; at; at = at.parentElement) if (at.matches(selector)) return at; return null; }
  querySelector(selector) {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
  contains(other) { for (let at = other; at; at = at.parentElement) if (at === this) return true; return false; }
  compareDocumentPosition(other) { return order.indexOf(other) < order.indexOf(this) ? 2 : 4; }
}
const el = (spec, ...children) => new El(spec, children);
const page = (root) => {
  order.length = 0;
  const walk = (node) => { order.push(node); node.children.forEach(walk); };
  walk(root);
  return root;
};

// Each screen's markup, from the live page (Nov 19, quote for 宁波晨织 on qa).
// `t` marks an element whose text the layer translated.
const t = (spec, ...children) => { const e = el(spec, ...children); e.translated = true; return e; };
const translatedIn = (root) => order.filter((node) => node.translated && root.contains(node));

{ // Quote compare: the location in the header, the notes further down.
  const location = t("p");
  const notes = t("span");
  const top = el("div.quote-factory-top", el("a.marketplace-factory-title", el("div", location)));
  const card = el("button.factory-card.quote-card", el("div.quote-factory-content", top,
    el("div.quote-factory-body", el("div.marketplace-spec-panel", el("div.marketplace-note-list", el("div.factory-note-box", notes))))));
  const root = page(el("main", el("section.flow-content", el("div.quote-list", card))));
  const anchors = labelAnchors(translatedIn(root));
  check(anchors.size === 1, `quote compare: one label for the card (got ${anchors.size})`);
  check(anchors.get(card) === top, "quote compare: the label goes under the card's header, not beside the buttons or by the notes");
}

{ // Quote detail: location, a shipping cell and two notes, nested boxes.
  const location = t("p");
  const top = el("div.quote-detail-summary-top", el("div.quote-detail-summary-main", el("div.factory-main", location)));
  const card = el("section.card.quote-detail-card", el("section.quote-detail-summary", top),
    el("section.quote-detail-section", el("div.detail-pairs", el("div.detail-pair", t("p")))),
    el("section.quote-note-panel", t("p"), t("p")));
  const root = page(el("main", el("section.flow-content", el("div.screen-transition", el("div.quote-detail-layout", card)))));
  const anchors = labelAnchors(translatedIn(root));
  check(anchors.size === 1, `quote detail: one label for the whole card, not one per field (got ${anchors.size})`);
  check(anchors.get(card) === top, "quote detail: the label is at the top of the card");
}

{ // Set contract terms, and every step with the rail's vendor card.
  const root = page(el("main", el("aside.right-rail", el("section.accepted-quote-panel", el("div.accepted-factory", el("div", t("span")))))));
  check(labelAnchors(translatedIn(root)).size === 0, "contract rail: no label in the vendor card");
}

{ // The order page: step updates in the timeline, the vendor card in the side rail.
  const firstUpdate = t("p");
  const timeline = el("section.milestone-timeline-card", el("div.milestone-timeline-list",
    el("article.project-milestone-item", el("div.project-update-card", el("div.project-update-history", el("div.project-update-entry", firstUpdate)))),
    el("article.project-milestone-item", el("div.project-update-card", el("div.project-update-history", el("div.project-update-entry", t("p")))))));
  const side = el("aside.project-detail-side", el("section.project-factory-panel", el("div.project-factory-row", el("div", t("span")))));
  const root = page(el("main", el("div.project-detail-shell", el("div.project-detail-layout", el("div.project-detail-main", timeline), side))));
  const anchors = labelAnchors(translatedIn(root));
  const updateCards = [...anchors.keys()];
  check(anchors.size === 2 && updateCards.every((card) => card.matches(".project-update-card")) && [...anchors.values()].includes(firstUpdate), "order page: one label per update card, not one per text nor one for the whole timeline");
  check(![...anchors.values()].some((anchor) => side.contains(anchor)), "order page: no label in the side rail's vendor card");
}

{ // Browse: the card translates itself, with its own label; also while its answer is still on the way.
  const root = page(el("main", el("article.marketplace-factory-card.live-factory-card", el("div.marketplace-factory-top", el("a", el("div", t("p")))))));
  check(labelAnchors(translatedIn(root)).size === 0, "Browse card: left to its own label (no second one)");
}

{ // Two cards on one page: one label each, never shared.
  const first = el("article.request-card", el("div", t("p")), el("aside", t("p")));
  const second = el("article.request-card", el("div", t("p")));
  const root = page(el("main", first, second));
  const anchors = labelAnchors(translatedIn(root));
  check(anchors.size === 2 && anchors.has(first) && anchors.has(second), "two cards: one label each");
}

{ // The invite step: vendor cards in a list that is itself a card. One label each.
  const one = el("article.factory-card.invite-selection-factory-card", el("div.invite-factory-content", el("div.invite-factory-top", el("a", el("div", t("p")))), el("div.invite-factory-body", t("p"))));
  // Its location is English; only the intro, in the body, was translated.
  const twoTop = el("div.invite-factory-top", el("a", el("div", el("p"))));
  const two = el("article.factory-card.invite-selection-factory-card", el("div.invite-factory-content", twoTop, el("div.invite-factory-body", t("p"))));
  const root = page(el("main", el("section.flow-content", el("section.card.invite-results", el("div.factory-list", one, two)))));
  const anchors = labelAnchors(translatedIn(root));
  check(anchors.size === 2 && anchors.has(one) && anchors.has(two), `invite step: one label per vendor card, not one for the list (got ${anchors.size})`);
  check(anchors.get(two) === twoTop, "a vendor card's label is under its header even when only its intro was translated");
}

{ // The first translated text in the card decides the place, whatever order the layer saw them in.
  const later = t("p");
  const earlier = t("p");
  const card = el("article", el("div", earlier), el("div", later));
  page(el("main", card));
  check(labelAnchors([later, earlier]).get(card) === earlier, "the label goes by the card's first translated text");
}

{ // Text in no card at all keeps a label of its own, beside it.
  const lone = t("p");
  page(el("main", el("div", lone)));
  check(cardFor(lone) === lone, "text in no card is its own card");
}

check(CARD && CARD_STOP && HEADER_ROW && NO_LABEL && SELF_TRANSLATING, "the selectors are defined");

// ---- The sources: one placement rule, used ----
const layer = readFileSync(new URL("../src/app/BrandEnglishLayer.jsx", import.meta.url), "utf8");
check(/labelAnchors\(/.test(layer), "BrandEnglishLayer places labels through labelAnchors (one per card)");
check(!/addControl\s*\(\s*element\s*\)/.test(layer), "BrandEnglishLayer adds no label per translated element");
check(/translatesItself\(element\)/.test(layer), "BrandEnglishLayer leaves self-translating cards alone, also before their own label is on screen");
check(/stopPropagation\(\)/.test(layer), "\"See original\" inside a clickable card does not open the card");

const prototype = readFileSync(new URL("../src/prototype/main.jsx", import.meta.url), "utf8");
const component = (name) => {
  const at = prototype.indexOf(`function ${name}(`);
  return at < 0 ? "" : prototype.slice(at, prototype.indexOf("\nfunction ", at + 10));
};
const labelHook = component("useVendorCardText");
check((labelHook.match(/vendor-card-translation/g) ?? []).length === 1 && /See original/.test(labelHook), "one shared label with \"See original\" for every vendor card");
// Every vendor card a brand reads: one label, under its header, before its body.
for (const [name, body, where] of [
  ["MarketplaceFactoryCard", "marketplace-factory-body", "Browse"],
  ["SavedFactoryCard", "saved-factory-card-body", "Saved"],
  ["HomeRecommendedFactoryCard", "invite-factory-body", "the dashboard's recommended vendors"],
  ["DirectoryFactoryCard", "directory-tags", "the directory list"],
]) {
  const code = component(name);
  check(/useVendorCardText\(/.test(code), `${where}: the card swaps its words with the shared label`);
  check((code.match(/\{translationLabel\}/g) ?? []).length === 1, `${where}: the card draws its label once`);
  check(code.indexOf("{translationLabel}") > 0 && code.indexOf("{translationLabel}") < code.indexOf(body), `${where}: the label is under the card's header, above its body`);
  check(!/vendor-card-translation/.test(code), `${where}: no label of its own beside the shared one`);
}
for (const file of ["../src/app/browse/LiveSavedVendors.jsx", "../src/app/browse/LiveBrandBrowse.jsx"]) {
  check(!/inEnglish\(|map\(inEnglish\)/.test(readFileSync(new URL(file, import.meta.url), "utf8")), `${file.split("/").pop()} passes the translations to the card, not words already swapped (or the card has nothing to show as original)`);
}

// ---- The CSS: one line, even space ----
const rule = (css, selector) => {
  const at = css.indexOf(`${selector} {`);
  return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
};
const profileCss = readFileSync(new URL("../src/app/profile/profile.css", import.meta.url), "utf8");
const controls = rule(profileCss, ".profile-translation-controls");
check(/margin:\s*(\d+px)\s+0\s*;/.test(controls), "the layer's label has the same margin above and below");
check(/white-space:\s*nowrap/.test(controls), "the layer's label and \"See original\" keep their words on one line");
const prototypeCss = readFileSync(new URL("../src/prototype/styles.css", import.meta.url), "utf8");
const own = rule(prototypeCss, ".vendor-card-translation");
check(own && !/margin-(top|bottom)/.test(own), "the Browse card's label takes the card's own gap above and below");
check(/white-space:\s*nowrap/.test(own), "the Browse card's label and \"See original\" keep their words on one line");
// ---- One line at 375px: the label, the gap and "See original" fit the narrowest card ----
// Measured in Chrome, Satoshi 12px/600 (Nov 19): the label's words 192.2px,
// "See original" 65.6px; quote compare's row, the narrowest vendor card, is 277px wide at
// 375px (the card's checkbox column takes the rest). The rule's own padding,
// border and gap are read from the CSS, so widening any of them fails here.
{
  const px = (value) => Number.parseFloat(value);
  const phone = profileCss.slice(profileCss.indexOf("@media (max-width: 480px)"));
  const phoneRules = phone.slice(0, phone.indexOf("\n}\n"));
  const gap = px(phoneRules.match(/\.profile-translation-controls\s*\{[^}]*column-gap:\s*([\d.]+)px/)?.[1] ?? controls.match(/gap:\s*[\d.]+px\s+([\d.]+)px/)?.[1]);
  const labelRule = rule(profileCss, ".profile-translation-label");
  const inline = px(phoneRules.match(/\.profile-translation-label\s*\{[^}]*padding-inline:\s*([\d.]+)px/)?.[1] ?? labelRule.match(/padding:\s*[\d.]+px\s+([\d.]+)px/)?.[1]);
  const border = px(labelRule.match(/border:\s*([\d.]+)px/)?.[1] ?? 0);
  const width = 192.2 + 2 * inline + 2 * border + gap + 65.6;
  check(/\.profile-translation-controls \.profile-translation-label\s*\{\s*font-size:\s*12px/.test(profileCss), "the label keeps 12px inside cards that size their own spans (the widths above are for 12px)");
  check(Number.isFinite(width) && width <= 277, `at 375px the label and "See original" fit on one line in quote compare's 277px row (needs ${width.toFixed(1)}px)`);
}
const liveCss = readFileSync(new URL("../src/app/live-quiet.css", import.meta.url), "utf8");
check(/\.accepted-quote-panel \.accepted-factory\s*\{\s*align-items:\s*start/.test(liveCss), "the rail's vendor card keeps its logo beside the top of the name");

// ---- No Chinese for a moment first ----
const hook = readFileSync(new URL("../src/app/browse/useVendorTranslations.js", import.meta.url), "utf8");
check(/translating:/.test(hook) && /HOLD_MS = 3000/.test(hook), "vendor cards say when their English is still on the way, for at most 3 s");
for (const [file, note] of [
  ["../src/app/browse/LiveSavedVendors.jsx", "Saved"],
  ["../src/app/browse/LiveBrandBrowse.jsx", "Browse and the directory list"],
  ["../src/app/home/LiveHome.jsx", "the dashboard's recommended vendors"],
]) {
  check(/\.translating\)/.test(readFileSync(new URL(file, import.meta.url), "utf8")), `${note} keep their loading line until the English is in`);
}
const vendorPage = readFileSync(new URL("../src/app/profile/LiveBrandFactoryProfile.jsx", import.meta.url), "utf8");
check(/held && \(\(translation\.loading/.test(vendorPage), "the vendor page keeps its loading line until the English is in");
check(/vendorNames\.waiting\(\)/.test(vendorPage), "the vendor page also waits for the company name's English");
check(/nameWaiting\(card\.id, card\.name\)/.test(hook), "vendor cards also wait for the company name's English");

// ---- The other direction: a factory reading Chinese sees no English first ----
const contentTranslation = readFileSync(new URL("../src/app/content-translation.js", import.meta.url), "utf8");
check(/HOLD_MS = 3000/.test(contentTranslation) && /return keys\.some\(\(k\) => !answered\.has\(k\)\)/.test(contentTranslation), "useChineseContent says when the Chinese is still on the way, for at most 3 s");
for (const [file, note] of [
  ["../src/app/rfq/LiveBrowse.jsx", "Browse RFQs"],
  ["../src/app/rfq/LiveRequestView.jsx", "the request page"],
  ["../src/app/home/LiveFactoryHome.jsx", "the factory dashboard"],
  ["../src/app/order/LiveFactoryOrders.jsx", "the factory's orders"],
  ["../src/app/order/LiveOrderDetail.jsx", "the factory's order page"],
  ["../src/app/profile/LiveFactoryBrandProfile.jsx", "the factory's view of a brand"],
]) {
  const code = readFileSync(new URL(file, import.meta.url), "utf8");
  check(/const waitingForChinese = useChineseContent\(/.test(code) && (code.match(/waitingForChinese/g) ?? []).length >= 2, `${note} keeps its loading state until the Chinese is in`);
}

// ---- A text that reads the same in English is an answer, cached once ----
// "Porto, Portugal" came back unchanged and counted as a failure, so Browse
// sent the same place names to the model on every load (1.6–2.8 s each).
{
  const { translateSources } = await import("../src/shared/profile-translation.mjs");
  const written = [];
  const result = await translateSources(["Porto, Portugal", "浙江省宁波市鄞州区"], {
    translate: async (text) => (text === "Porto, Portugal"
      ? { source_language: null, target_language: null, translation: null, error: "nothing to translate into", unchanged: true }
      : { source_language: "zh", target_language: "en", translation: "Yinzhou District, Ningbo", error: null }),
    cacheRead: async () => new Map(),
    cacheWrite: async (rows) => { written.push(...rows); },
  });
  check(!result.missing.includes("Porto, Portugal"), "an unchanged place name is not reported missing");
  check(written.some((row) => row.source === "Porto, Portugal" && row.translated === false && row.english === "Porto, Portugal"), "an unchanged place name is cached as written, so it is not asked again");
  const chinese = await translateSources(["宁波"], {
    translate: async () => ({ source_language: null, target_language: null, translation: null, error: "nothing to translate into", unchanged: true }),
    cacheRead: async () => new Map(), cacheWrite: async () => {},
  });
  check(chinese.missing.includes("宁波"), "Chinese that comes back unchanged is still missing, never cached as English");
}
const translator = readFileSync(new URL("../api/_translate.js", import.meta.url), "utf8");
check((translator.match(/reasoning: \{ enabled: false \}/g) ?? []).length === 2, "both translators ask for no thinking before the answer");

console.log(failures ? `\ncheck:translation-label: ${failures} of ${checks} failed` : `check:translation-label: ${checks} checks passed`);
process.exit(failures ? 1 : 0);
