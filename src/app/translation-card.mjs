/**
 * Where "Automatically translated to English" goes on a brand's screens:
 * one label per card, at the top of the card, and its "See original" shows
 * the whole card as written.
 *
 * A card is the nearest card around the translated text (\`CARD\`), so each
 * vendor card in a list gets its own label even when the list itself sits in
 * a \`.card\` (the invite step). A box inside a card that is not itself a card
 * (a quote's "Notes from vendor") is part of that card and gets no label. Cards that
 * translate themselves (the Browse card, the vendor page) are left to their
 * own label; the vendor card in a side rail (quote to contract, the order page) shows
 * its words in English with no label.
 *
 * Pure, so `npm run check:translation-label` runs it on the real screens'
 * markup without a browser. BrandEnglishLayer.jsx is the only caller.
 */
export const CARD = ".card, .factory-card, article, [class$='-card'], [class*='-card ']";
export const CARD_STOP = "main, body, dialog, [role='dialog'], .flow-content, .screen-transition, .right-rail";
export const NO_LABEL = ".accepted-factory, .project-factory-panel";
// A card's header row (logo, name, location, actions): a label for text in it
// goes under the whole row, on one line, not squeezed beside the buttons.
export const HEADER_ROW = ".quote-factory-top, .marketplace-factory-top, .quote-detail-summary-top, .invite-factory-top";
export const SELF_TRANSLATING = ".marketplace-factory-card, .saved-factory-card, .directory-factory-card, .home-recommended-invite-card, .factory-profile-page, .brand-factory-public-profile";

/** The card a translated text belongs to; the element itself when it sits in no card. */
export function cardFor(element) {
  for (let at = element; at && !at.matches(CARD_STOP); at = at.parentElement) {
    if (at.matches(CARD)) return at;
  }
  return element;
}

/** Translated, but drawn without a label (the rail's vendor card). */
export const unlabelled = (element) => Boolean(element?.closest(NO_LABEL));

/** A card that translates its own words, with its own label. */
export const translatesItself = (element) => Boolean(element?.closest(SELF_TRANSLATING));

// DOCUMENT_POSITION_PRECEDING: the argument comes before the node asked.
const PRECEDING = 2;

/**
 * Each card's label position: card → the first element (document order) whose
 * text was translated in it, or the header row holding it. The label goes
 * right after it.
 */
export function labelAnchors(elements) {
  const anchors = new Map();
  for (const element of elements) {
    if (!element || unlabelled(element) || translatesItself(element)) continue;
    const card = cardFor(element);
    const current = anchors.get(card);
    if (!current || current.compareDocumentPosition(element) & PRECEDING) anchors.set(card, element);
  }
  // A card with a header row (a vendor card) has its label under the header,
  // wherever its first translated text is (an English location, a Chinese intro).
  for (const [card, element] of anchors) {
    const row = element.closest(HEADER_ROW) ?? card.querySelector(HEADER_ROW);
    if (row && row !== card && card.contains(row)) anchors.set(card, row);
  }
  return anchors;
}
