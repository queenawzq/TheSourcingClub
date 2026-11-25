/**
 * The other side's words in the reader's language, inside a longer text: each
 * translated source in `text` is replaced by its translation, longest first,
 * so a sentence is replaced before a shorter text it contains ("先做试身样…"
 * before "试身样").
 *
 * One rule for every place a step name, a request title or a note reaches the
 * other side: BrandEnglishLayer (the brand's screens), the values a screen
 * cannot have swapped on it (an input's value, a select's options) and the
 * notification emails (api/_notification-sender.js). The translations are the
 * same ones in every case: api/content-translation.js and its cache.
 *
 * Pure, with no imports: api/ loads it on its own.
 *
 * @param text          what was written
 * @param translations  Map of source text → its translation
 * @param wanted        which sources apply (the brand: Chinese ones only)
 */
export function inReaderLanguage(text, translations, wanted = () => true) {
  const value = String(text ?? "");
  if (!value || !translations?.size) return value;
  const sources = [...translations.keys()].filter((source) => source && wanted(source) && value.includes(source))
    .sort((a, b) => b.length - a.length);
  let out = value;
  for (const source of sources) if (out.includes(source)) out = out.split(source).join(translations.get(source));
  return out;
}
