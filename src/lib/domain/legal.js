/**
 * Legal documents: the terms each kind of company signs, and the privacy
 * policy.
 *
 * Every save is a new version and a published version never changes, because
 * terms_acceptances points at the exact row a company signed. Reading the
 * current versions works signed out — current_legal_documents() is the one
 * function granted to anon — since the signup screen links to terms the
 * visitor has no account to read them with yet.
 */
import { supabase, unwrap } from "../supabase.js";

/** Database kind → the admin editor's tab name. Order is the tab order. */
export const LEGAL_KINDS = {
  terms_brand: "Brand",
  terms_factory: "Factory",
  terms_trading: "Trading company",
  privacy: "Privacy policy",
};

/**
 * The terms a company signs. Trading companies are factory orgs with a
 * different vendor_kind, and read different terms.
 */
export function termsKindFor(orgType, vendorKind) {
  if (orgType === "brand") return "terms_brand";
  return vendorKind === "trading_company" ? "terms_trading" : "terms_factory";
}

/** `?type=` on the public page ↔ document kind. */
export const TERMS_TYPES = { brand: "terms_brand", factory: "terms_factory", trading: "terms_trading" };

/** The public page for a document, opened from signup and onboarding. */
export function legalHref(kind, language) {
  const params = new URLSearchParams();
  if (kind === "privacy") params.set("legal", "privacy");
  else {
    params.set("legal", "terms");
    params.set("type", Object.keys(TERMS_TYPES).find((type) => TERMS_TYPES[type] === kind) ?? "brand");
  }
  if (language === "zh") params.set("lang", "zh");
  return `/app.html?${params}`;
}

/**
 * Blocks separated by a blank line, the first line of each its heading — the
 * format the admin editor has always parsed.
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

/** Staff only. Returns the new version's row. */
export async function publishLegalDocument(kind, { onboardingEn, onboardingZh, fullEn, fullZh }) {
  return unwrap(
    await supabase.rpc("publish_legal_document", {
      p_kind: kind,
      p_onboarding_en: onboardingEn ?? null,
      p_onboarding_zh: onboardingZh ?? null,
      p_full_en: fullEn,
      p_full_zh: fullZh ?? null,
    }),
    "publish the terms",
  );
}
