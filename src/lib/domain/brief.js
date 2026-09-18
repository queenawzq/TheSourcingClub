/**
 * Asking the model to structure a brief.
 *
 * The key lives on the server; this only knows whether the feature is turned
 * on, which is a separate client-safe flag. Two variables, deliberately: one
 * is a secret and one is a UI decision, and conflating them would put the
 * secret in the bundle.
 */

export const briefGenerationEnabled = import.meta.env.VITE_AI_BRIEF_ENABLED === "true";

/**
 * Never throws. A failure returns { fields: null, error } so the caller's
 * "the user skipped this" path and "the model failed" path are the same.
 */
export async function generateBrief({ freeText, terms }) {
  const slugs = (kind) => (terms?.[kind] ?? []).map((term) => term.slug);

  try {
    const response = await fetch("/api/generate-brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        freeText,
        categories: slugs("product_category"),
        certifications: slugs("certification"),
        regions: slugs("region"),
        sourcing: slugs("sourcing_responsibility"),
      }),
    });
    return await response.json();
  } catch (error) {
    return { fields: null, error: error.message };
  }
}

/** Map returned slugs back onto real term ids the pickers can preselect. */
export function idsForSlugs(terms, kind, wanted) {
  if (!wanted?.length) return [];
  const byslug = new Map((terms?.[kind] ?? []).map((term) => [term.slug, term.id]));
  return wanted.map((slug) => byslug.get(slug)).filter(Boolean);
}
