const CATEGORIES = [
  { kind: "woven", label: "Woven", pattern: /\b(woven|wovens|weaving|poplin|linen|button.down|blouses?)\b/i },
  { kind: "jersey", label: "Jersey", pattern: /\b(jersey|jerseys|cut.*sew|t.shirts?|sweatshirts?|hoodies?)\b/i },
  { kind: "knit", label: "Knit", pattern: /\b(knit|knits|knitwear|knitting|sweaters?|cardigans?)\b/i },
];

function matches(category, text) {
  const normalized = typeof text === "string" ? text : "";
  // "Cut & sew knits" describes jersey, not sweater knitting.
  const value = category.kind === "knit" ? normalized.replace(/cut.{0,12}sew\s+knits?/gi, "") : normalized;
  return category.pattern.test(value);
}

/** Rank explicit profile selections first, then supporting name/product clues.
 * Scores are only a sorting rule, never a claimed probability or verification.
 */
export function productionCategories({ productionTypes = [], name = "", intro = "", makes = [] }) {
  return CATEGORIES.map((category) => {
    const selected = (productionTypes ?? []).some((type) => matches(category, type));
    const nameMatch = matches(category, name);
    const introMatch = matches(category, intro);
    const productMatches = (makes ?? []).filter((product) => matches(category, product)).length;
    return {
      kind: category.kind,
      label: category.label,
      inferred: !selected,
      score: (selected ? 1000 : 0) + (nameMatch ? 100 : 0) + productMatches * 10 + (introMatch ? 5 : 0),
      source: selected ? "Selected during onboarding" : "Inferred from the name, description or products; not confirmed",
    };
  }).filter((category) => category.score > 0)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
}
