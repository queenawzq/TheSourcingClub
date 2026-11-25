/**
 * The other side's words in the reader's language (api/content-translation.js).
 *
 * - A factory person reading Chinese: a brand's requests, profile and
 *   messages in Chinese (`useChineseContent`), put on screen by
 *   `FactoryLanguageLayer`; the design's "查看英文原文" shows the English.
 * - A brand: what a factory typed in Chinese (quote notes, answers, step
 *   updates, its location and intro) in English (`useEnglishContent`), put on
 *   screen by `BrandEnglishLayer`; a click on the text shows it as written.
 *
 * One store per page, kept by the exact source text. Never blocking: the
 * original is on screen until an answer arrives, and stays when none does.
 * Each source's own status is kept: `translations` for what came back,
 * `failed` for what did not, so a note never calls untranslated text
 * translated.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { supabase } from "../lib/supabase.js";
import { getUiLanguage } from "../lib/ui-language.js";
import { needsEnglish } from "../shared/profile-translation.mjs";
import { inReaderLanguage } from "../shared/words-in-reader-language.mjs";

// `names`: sources that are names of things (a step, a sample stage), not a
// block of text: translated in place, with no "Automatically translated" label.
const state = { translations: new Map(), names: new Set(), failed: new Set(), pending: 0, showOriginal: false, version: 0 };
const asked = new Set();
// Ids whose first answer is in (or failed): a screen may stop holding for them.
const answered = new Set();
const listeners = new Set();
const changed = () => { state.version += 1; listeners.forEach((listener) => listener()); };

export function contentTranslations() {
  return state;
}

export function useContentTranslations() {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => state.version,
    () => state.version,
  );
}

export function toggleOriginal() {
  state.showOriginal = !state.showOriginal;
  changed();
}

async function post(body) {
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch("/api/content-translation", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Translation unavailable");
  return data;
}

/** Asks once per id per page; ids whose text did not all come back are asked again by the next screen. */
async function ask(groups, extra = {}) {
  const fresh = {};
  const keys = [];
  for (const [field, prefix, max] of groups) {
    fresh[field] = [...new Set((extra[field] ?? []).filter(Boolean))].filter((id) => !asked.has(`${prefix}:${id}`)).slice(0, max);
    fresh[field].forEach((id) => { asked.add(`${prefix}:${id}`); keys.push(`${prefix}:${id}`); });
  }
  if (!keys.length) return;
  state.pending += 1;
  changed();
  try {
    const { translations = {}, missing = [], incomplete, names = [] } = await post({ ...fresh, ...(extra.to ? { to: extra.to } : {}) });
    Object.entries(translations).forEach(([source, text]) => { state.translations.set(source, text); state.failed.delete(source); });
    names.forEach((source) => state.names.add(source));
    missing.forEach((source) => { if (!state.translations.has(source)) state.failed.add(source); });
    if (incomplete) keys.forEach((key) => asked.delete(key));
  } catch {
    // Nothing is known: the screens keep the original, and the notes say so.
    state.failed.add(Symbol.for("tsc-content-translation-down"));
    keys.forEach((key) => asked.delete(key));
  } finally {
    keys.forEach((key) => answered.add(key));
    state.pending -= 1;
    changed();
  }
}

/** True when the last request failed outright, so no source has a status. */
export function translationDown() {
  return state.failed.has(Symbol.for("tsc-content-translation-down"));
}

export function requestChineseContent({ rfqIds = [], brandOrgIds = [], messageIds = [], orderIds = [] }) {
  if (getUiLanguage() !== "zh") return undefined;
  return ask([["rfqIds", "rfq", 50], ["brandOrgIds", "brand", 20], ["messageIds", "message", 100], ["orderIds", "order-zh", 50]], { rfqIds, brandOrgIds, messageIds, orderIds });
}

export function requestEnglishContent({ quoteIds = [], orderIds = [], factoryOrgIds = [] }) {
  return ask([["quoteIds", "quote", 50], ["orderIds", "order", 50], ["factoryOrgIds", "factory", 50]], { quoteIds, orderIds, factoryOrgIds, to: "en" });
}

const keyOf = (groups) => groups.map((list) => (list ?? []).filter(Boolean).join(",")).join("|");

// How long a screen may hold its loading line for the Chinese (the brand
// side's cap): after it, the screen draws and the Chinese fills in.
const HOLD_MS = 3000;

/**
 * A screen's requests, brands and messages, asked for while the person reads
 * Chinese. Returns true while the first answer for them is not in yet (at
 * most HOLD_MS from the screen's first draw): the screen keeps its loading
 * line meanwhile, so nobody sees the brand's English for a moment first.
 */
export function useChineseContent({ rfqIds = [], brandOrgIds = [], messageIds = [], orderIds = [] }) {
  const key = keyOf([rfqIds, brandOrgIds, messageIds, orderIds]);
  useContentTranslations();
  const [held, setHeld] = useState(true);
  useEffect(() => {
    const cap = window.setTimeout(() => setHeld(false), HOLD_MS);
    return () => window.clearTimeout(cap);
  }, []);
  useEffect(() => {
    if (key.replace(/\|/g, "")) requestChineseContent({ rfqIds, brandOrgIds, messageIds, orderIds });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!held || getUiLanguage() !== "zh") return false;
  const keys = [["rfq", rfqIds], ["brand", brandOrgIds], ["message", messageIds], ["order-zh", orderIds]]
    .flatMap(([prefix, ids]) => (ids ?? []).filter(Boolean).map((id) => `${prefix}:${id}`));
  return keys.some((k) => !answered.has(k));
}

/**
 * What a factory typed (a step name, a sample stage, a note), in English for
 * a brand, as far as this page's translations go; as written until they
 * arrive. The same English BrandEnglishLayer puts on screen, for the values
 * it cannot reach: an input's value, a select's options, a row's key.
 */
export function englishText(text) {
  return inReaderLanguage(text, state.translations, needsEnglish);
}

/**
 * A brand screen's quotes, orders and vendors: what the factory typed, in
 * English. Returns `englishText`, and re-renders the screen as translations
 * arrive, for the values a screen puts in itself.
 */
export function useEnglishContent({ quoteIds = [], orderIds = [], factoryOrgIds = [] }, { enabled = true } = {}) {
  const key = keyOf([quoteIds, orderIds, factoryOrgIds]);
  useContentTranslations();
  useEffect(() => {
    if (enabled && key.replace(/\|/g, "")) requestEnglishContent({ quoteIds, orderIds, factoryOrgIds });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  return enabled ? englishText : (text) => text;
}
