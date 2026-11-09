export function factoryLanguage({ saved, query, legacy } = {}) {
  if (saved === "zh" || saved === "en") return saved;
  if (query === "zh" || query === "en") return query;
  return legacy === "zh" ? "zh" : "en";
}
