/** Original text first; only a detected non-English source can offer English. */
export function englishTranslation(message, { own = false } = {}) {
  const canTranslate = !own && message.body_lang && message.body_lang !== "en"
    && message.body_translated_lang === "en" && message.body_translated
    && message.body_translated.trim() !== (message.body ?? "").trim();
  return {
    body: message.body,
    ...(canTranslate ? {
      translation: message.body_translated,
      language: "en",
      showAltLabel: "Translate to English",
      hideAltLabel: "Show Original",
    } : {}),
  };
}

