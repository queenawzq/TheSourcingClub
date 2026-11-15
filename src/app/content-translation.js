/**
 * A brand's words in Chinese for a factory person reading in Chinese
 * (api/content-translation.js). One store per page: every screen asks for
 * the requests and brands it shows, the answers are kept by their English
 * text, and `FactoryLanguageLayer` puts them on screen wherever that exact
 * text is drawn. The design's "查看英文原文" shows the English again.
 *
 * Never blocking: the English is on screen until an answer arrives, and stays
 * when one does not (`failed` then says so in the design's translation note).
 */
import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "../lib/supabase.js";
import { getUiLanguage } from "../lib/ui-language.js";

const state = { translations: new Map(), showOriginal: false, failed: false, version: 0 };
const asked = new Set();
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

async function ask(rfqIds, brandOrgIds) {
  const { data: { session } } = await supabase.auth.getSession();
  const response = await fetch("/api/content-translation", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token ?? ""}` },
    body: JSON.stringify({ rfqIds, brandOrgIds }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? "Translation unavailable");
  return data;
}

/** Asks once per id per page. `retry` asks again for ids that came back incomplete. */
export async function requestChineseContent({ rfqIds = [], brandOrgIds = [] }) {
  if (getUiLanguage() !== "zh") return;
  const rfqs = [...new Set(rfqIds.filter(Boolean))].filter((id) => !asked.has(`rfq:${id}`)).slice(0, 50);
  const brands = [...new Set(brandOrgIds.filter(Boolean))].filter((id) => !asked.has(`brand:${id}`)).slice(0, 20);
  if (!rfqs.length && !brands.length) return;
  rfqs.forEach((id) => asked.add(`rfq:${id}`));
  brands.forEach((id) => asked.add(`brand:${id}`));
  try {
    const { translations = {}, incomplete } = await ask(rfqs, brands);
    Object.entries(translations).forEach(([source, chinese]) => state.translations.set(source, chinese));
    if (incomplete) {
      state.failed = true;
      // Asked again on the next screen that shows them.
      rfqs.forEach((id) => asked.delete(`rfq:${id}`));
      brands.forEach((id) => asked.delete(`brand:${id}`));
    }
  } catch {
    state.failed = true;
    rfqs.forEach((id) => asked.delete(`rfq:${id}`));
    brands.forEach((id) => asked.delete(`brand:${id}`));
  }
  changed();
}

/** A screen's requests and brands, asked for while the person reads Chinese. */
export function useChineseContent({ rfqIds = [], brandOrgIds = [] }) {
  const key = `${rfqIds.filter(Boolean).join(",")}|${brandOrgIds.filter(Boolean).join(",")}`;
  useEffect(() => {
    if (key !== "|") requestChineseContent({ rfqIds, brandOrgIds });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
