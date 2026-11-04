import { useEffect, useState } from "react";
import { requestProfileTranslation } from "../profile/profile-translation-client.js";

export function useVendorTranslations(cards, orgId) {
  const [translations, setTranslations] = useState({});
  useEffect(() => {
    let cancelled = false;
    setTranslations({});
    let cursor = 0;
    const worker = async () => {
      while (!cancelled && cursor < cards.length) {
        const card = cards[cursor++];
        if (card.unlisted) continue;
        try {
          const data = await requestProfileTranslation(card.id);
          if (!cancelled) setTranslations((current) => ({ ...current, [card.id]: data.translations ?? {} }));
        } catch { /* Keep the source until a translation is available. */ }
      }
    };
    worker(); worker();
    return () => { cancelled = true; };
  }, [cards, orgId]);
  return cards.map((card) => ({ ...card, translations: translations[card.id] ?? {} }));
}
