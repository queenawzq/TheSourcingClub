import { useEffect, useState } from "react";
import { requestCardTranslations } from "../profile/profile-translation-client.js";

// The route takes at most 50 vendors at a time.
const BATCH = 50;

/**
 * The cards with each vendor's words in English where a translation exists.
 * One request for all the cards (Nov 13, B7: it was one per card), and one
 * more for the vendors whose answers were not back in that request's time.
 * Search also reads the English (B6), and a card some of whose words are still
 * in the original says so (`translationPartial`, B3).
 */
export function useVendorTranslations(cards, orgId) {
  const [results, setResults] = useState({});
  useEffect(() => {
    const controller = new AbortController();
    setResults({});
    const ids = cards.filter((card) => !card.unlisted).map((card) => card.id);
    const ask = async (batch) => {
      try {
        const byOrg = await requestCardTranslations(batch, controller.signal);
        if (!controller.signal.aborted) setResults((current) => ({ ...current, ...byOrg }));
        return Object.entries(byOrg).filter(([, answer]) => answer.incomplete).map(([id]) => id);
      } catch { return []; /* Keep the source until a translation is available. */ }
    };
    (async () => {
      for (let i = 0; i < ids.length && !controller.signal.aborted; i += BATCH) {
        const unfinished = await ask(ids.slice(i, i + BATCH));
        if (unfinished.length && !controller.signal.aborted) await ask(unfinished);
      }
    })();
    return () => controller.abort();
  }, [cards, orgId]);
  return cards.map((card) => {
    const answer = results[card.id];
    const translations = answer?.translations ?? {};
    const english = Object.values(translations);
    return {
      ...card,
      translations,
      translationPartial: Boolean(answer?.incomplete) && english.length > 0,
      ...(english.length && typeof card.searchText === "string" ? { searchText: `${card.searchText} ${english.join(" ").toLowerCase()}` } : {}),
    };
  });
}
