/**
 * Legal documents: the terms each kind of company signs, and the privacy
 * policy.
 *
 * A published version never changes, because terms_acceptances points at the
 * exact row a company signed; new wording is a new version, added by
 * migration. Reading the current versions works signed out —
 * current_legal_documents() is the one function granted to anon — since the
 * signup screen links to terms the visitor has no account to read them with.
 */
import { supabase, unwrap } from "../supabase.js";

/** `?type=` on the public page ↔ document kind. */
export const TERMS_TYPES = { brand: "terms_brand", factory: "terms_factory", trading: "terms_trading" };

/**
 * The terms_version recorded with a signature. Unique per published row, and
 * readable on the admin review screen, which displays it.
 */
export function termsVersionOf(doc) {
  return `${doc.kind} v${doc.version}`;
}

/**
 * Blocks separated by a blank line, the first line of each its heading — the
 * format legal_documents stores. The first block of a full document is its
 * title.
 */
export function parseSections(text) {
  return String(text ?? "")
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const [heading, ...body] = block.split("\n");
      return [heading.trim(), body.join(" ").trim()];
    });
}

/** Chinese when asked for and written; English otherwise. Never translated. */
export function pickText(en, zh, language) {
  return language === "zh" && zh?.trim() ? zh : en;
}

/** The current version of every document, keyed by kind. */
export async function listCurrentLegalDocuments() {
  const rows = unwrap(await supabase.rpc("current_legal_documents"), "load the terms");
  return Object.fromEntries((rows ?? []).map((row) => [row.kind, row]));
}
