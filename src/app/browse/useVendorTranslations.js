import { useEffect, useState } from "react";
import { requestCardTranslations } from "../profile/profile-translation-client.js";
import { nameWaiting } from "../vendor-names.jsx";

// The route takes at most 50 vendors at a time.
const BATCH = 50;

// How long a screen may wait for the English before drawing the cards anyway
// (the dashboard's cap): after it, the English fills in when it comes.
const HOLD_MS = 3000;

/**
 * The cards with each vendor's words in English where a translation exists.
 * `translating` is true on a card until its first answer and its company
 * name's English are in (or failed, or HOLD_MS passed): a screen keeps its loading line until none is, so nobody
 * sees the Chinese for a moment before the English (Nov 19, C2).
 * One request for all the cards (Nov 13, B7: it was one per card), and one
 * more for the vendors whose answers were not back in that request's time.
 * Search also reads the English (B6), and a card some of whose words are still
 * in the original says so (`translationPartial`, B3).
 */
export function useVendorTranslations(cards, orgId) {
  const [results, setResults] = useState({});
  const [answered, setAnswered] = useState(() => new Set());
  const [held, setHeld] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setResults({});
    setAnswered(new Set());
    setHeld(true);
    const cap = window.setTimeout(() => setHeld(false), HOLD_MS);
    const ids = cards.filter((card) => !card.unlisted).map((card) => card.id);
    const ask = async (batch) => {
      const done = () => { if (!controller.signal.aborted) setAnswered((current) => new Set([...current, ...batch])); };
      try {
        const byOrg = await requestCardTranslations(batch, controller.signal);
        if (!controller.signal.aborted) setResults((current) => ({ ...current, ...byOrg }));
        done();
        return Object.entries(byOrg).filter(([, answer]) => answer.incomplete).map(([id]) => id);
      } catch { done(); return []; /* Keep the source until a translation is available. */ }
    };
    (async () => {
      for (let i = 0; i < ids.length && !controller.signal.aborted; i += BATCH) {
        const unfinished = await ask(ids.slice(i, i + BATCH));
        if (unfinished.length && !controller.signal.aborted) await ask(unfinished);
      }
    })();
    return () => { controller.abort(); window.clearTimeout(cap); };
  }, [cards, orgId]);
  return cards.map((card) => {
    const answer = results[card.id];
    const translations = answer?.translations ?? {};
    const english = Object.values(translations);
    return {
      ...card,
      translations,
      // Its words, and its company name (vendor-names.jsx), in English yet?
      translating: held && !card.unlisted && (!answered.has(card.id) || nameWaiting(card.id, card.name)),
      translationPartial: Boolean(answer?.incomplete) && english.length > 0,
      ...(english.length && typeof card.searchText === "string" ? { searchText: `${card.searchText} ${english.join(" ").toLowerCase()}` } : {}),
    };
  });
}
