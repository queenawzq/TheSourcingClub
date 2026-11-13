/**
 * What a brand reads of a vendor's profile in English: which strings are sent
 * to the translator, and how they are translated in one request's time.
 *
 * Shared by the server (api/profile-translation.js, through import()) and the
 * browser (the vendor page and the Browse and dashboard cards), so the page
 * asks for exactly the strings the server translates. Pure: no network, no
 * database; the route passes in the translator and the cache.
 *
 * The company name is NOT translated (Nov 13, B5): the brand sees the name the
 * company gave on every screen (Saved, quotes, orders, conversations), so
 * it can recognise the same company everywhere.
 */

/** Text in a script a brand reading English cannot read: Chinese, Japanese, Korean. */
export function needsEnglish(text) {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(String(text ?? ""));
}

/**
 * "Flatlock, linking\nWashing" → ["Flatlock", "linking", "Washing"]. Chinese
 * lists use 、 ，and ； (B12), so they split too.
 */
export function equipmentList(notes) {
  return String(notes ?? "")
    .split(/[,\n;、，；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** A file name as a title: "Organic poplin shirt.jpg" → "Organic poplin shirt". */
export function titleFromFileName(name) {
  const base = String(name ?? "").replace(/\.[a-z0-9]+$/i, "").replace(/_+/g, " ").trim();
  return base ? base[0].toUpperCase() + base.slice(1) : "Sample";
}

/**
 * The strings to translate. `scope` "card" is what a Browse or dashboard card
 * shows (intro, location, sample titles); "page" is the whole vendor page.
 *   profile:    { intro, location, nearest_port, equipment_notes }
 *   samples:    [{ title, caption, file_name }]  (title empty: the file name is shown)
 *   walkthrough:{ title, caption } | null
 *   references: [{ title }]
 */
export function profileSources({ profile, samples = [], walkthrough = null, references = [] }, scope = "page") {
  const card = scope === "card";
  const texts = [
    profile?.intro,
    profile?.location,
    ...samples.map((sample) => sample.title || titleFromFileName(sample.file_name)),
    ...(card ? [] : [
      profile?.nearest_port,
      ...equipmentList(profile?.equipment_notes),
      ...samples.map((sample) => sample.caption),
      walkthrough?.title,
      walkthrough?.caption,
      ...references.map((reference) => reference.title),
    ]),
  ];
  return [...new Set(texts.filter((text) => typeof text === "string" && text.trim()))];
}

/**
 * Translate `sources` with a fixed deadline, all at once (up to `concurrency`
 * model calls in flight), reading and writing the cache in one round each.
 *
 *   translate(text, { timeoutMs }) → { source_language, translation, error }  (api/_translate.js)
 *   cacheRead(sources) → Map(source → { english, translated })
 *   cacheWrite(rows)   → rows: [{ source, english, translated }]
 *
 * Returns { translations: { source: english }, missing: [source] }. A source
 * is missing when it has no answer: the model failed or ran out of time, or
 * called Chinese text English (B2). A "not translated" verdict is
 * never cached, nor trusted from the cache, for text that needs English.
 */
export async function translateSources(sources, { translate, cacheRead, cacheWrite, deadlineMs = 8000, concurrency = 12, now = () => Date.now() }) {
  const started = now();
  const left = () => deadlineMs - (now() - started);
  const translations = {};
  const missing = [];
  const fresh = [];

  const cached = sources.length ? await cacheRead(sources).catch(() => new Map()) : new Map();
  const todo = sources.filter((source) => {
    const row = cached.get(source);
    if (!row || (!row.translated && needsEnglish(source))) return true;
    if (row.translated) translations[source] = row.english;
    return false;
  });

  let cursor = 0;
  const worker = async () => {
    while (cursor < todo.length) {
      const source = todo[cursor++];
      if (left() < 1500) { missing.push(source); continue; }
      // The shared translator accepts at most 4000 characters per request.
      const chunks = source.match(/[\s\S]{1,4000}/g) ?? [];
      const results = await Promise.all(chunks.map(async (chunk) => {
        let result = await translate(chunk, { timeoutMs: Math.min(6000, left()) });
        if ((result.error || !result.source_language) && left() >= 2500) result = await translate(chunk, { timeoutMs: Math.min(2000, left()) });
        return result;
      }));
      const failed = results.some((result) => result.error || !result.source_language);
      const translated = results.some((result) => result.source_language !== "en");
      if (failed || (!translated && needsEnglish(source))) { missing.push(source); continue; }
      const english = results.map((result, index) => result.translation ?? chunks[index]).join("");
      fresh.push({ source, english, translated });
      if (translated) translations[source] = english;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
  if (fresh.length) await cacheWrite(fresh).catch(() => {});
  return { translations, missing };
}

/** The vendor's parts with its own words in English where a translation exists. */
export function englishProfileParts(parts, translations) {
  const text = (value) => translations[value] ?? value;
  const machines = equipmentList(parts.profile?.equipment_notes);
  return {
    ...parts,
    profile: {
      ...parts.profile,
      ...Object.fromEntries(["intro", "location", "nearest_port"].map((field) => [field, text(parts.profile?.[field])])),
      equipment_notes: machines.length ? machines.map(text).join(", ") : parts.profile?.equipment_notes,
    },
    references: parts.references?.map((reference) => ({ ...reference, title: text(reference.title) })),
    samples: parts.samples?.map((sample) => ({ ...sample, title: text(sample.title), caption: text(sample.caption) })),
    walkthrough: parts.walkthrough ? { ...parts.walkthrough, title: text(parts.walkthrough.title), caption: text(parts.walkthrough.caption) } : parts.walkthrough,
  };
}
