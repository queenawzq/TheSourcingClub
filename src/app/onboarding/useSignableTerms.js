/**
 * The published terms an onboarding flow shows, and signs against.
 *
 * There is deliberately no fallback to the designed copy: a signature
 * recorded against text that is not stored proves nothing. Until the terms
 * load, the step shows no sections and signing refuses with the reason;
 * `ensure()` retries, so pressing Sign again is the retry.
 */
import { useCallback, useEffect, useState } from "react";
import { legalHref, listCurrentLegalDocuments, parseSections, pickText } from "../../lib/domain/legal.js";

export function useSignableTerms(kind, language = "en") {
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const found = (await listCurrentLegalDocuments())[kind];
      if (!found) throw new Error("The terms have not been published yet. Please try again later.");
      setDoc(found);
      setError(null);
      return found;
    } catch (loadError) {
      setError(loadError);
      throw loadError;
    }
  }, [kind]);

  useEffect(() => {
    setDoc(null);
    load().catch(() => {});
  }, [load]);

  return {
    doc,
    error,
    sections: doc ? parseSections(pickText(doc.onboarding_en, doc.onboarding_zh, language)) : [],
    href: legalHref(kind, language),
    /** The document to sign — the one on screen, or a fresh attempt. */
    ensure: useCallback(() => (doc?.kind === kind ? doc : load()), [doc, kind, load]),
  };
}
