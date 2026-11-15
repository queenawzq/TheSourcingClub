/**
 * The language of the factory's screens: one per person, kept in
 * `user_profiles.locale` (the same column the emails are written in).
 *
 * Before sign-in the pages keep the choice in this browser (`?lang=` on the
 * address, or `factoryLang` from the factory site's EN/中文 and the
 * onboarding toggle). After sign-in the person's saved locale decides, except:
 * - `?lang=en|zh` on the address is a choice made now, and is saved;
 * - during onboarding (right after sign-up) the language the person signed up
 *   in, or picks on the onboarding toggle, is saved: that is the default.
 * The saved locale is copied back into `factoryLang`, so the sign-in page in
 * this browser opens in the language of whoever used it last.
 *
 * Never detected from what a company wrote: a factory whose profile is in
 * Chinese is not switched to Chinese (that is the person's choice).
 *
 * The brand side always stays English: only the factory shell reads this.
 */
import { useSyncExternalStore } from "react";
import { supabase } from "./supabase.js";

const STORAGE_KEY = "factoryLang";
const valid = (value) => (value === "zh" || value === "en" ? value : null);

export function urlLanguage() {
  try { return valid(new URLSearchParams(window.location.search).get("lang")); } catch { return null; }
}

export function storedLanguage() {
  try { return valid(window.localStorage.getItem(STORAGE_KEY)); } catch { return null; }
}

// The address this page was opened at: signing in rewrites it, and a
// `?lang=` the person signed in with is still their choice.
const CHOICE_KEY = "tscLanguageChoice";
const openedWith = urlLanguage();
try { if (openedWith) window.sessionStorage.setItem(CHOICE_KEY, openedWith); } catch { /* the address still says it */ }
let current = openedWith ?? storedLanguage() ?? "en";

/** A `?lang=` this tab was opened with, kept until the next sign-in uses it. */
function takeChoice() {
  try {
    const choice = valid(window.sessionStorage.getItem(CHOICE_KEY));
    window.sessionStorage.removeItem(CHOICE_KEY);
    return choice;
  } catch {
    return null;
  }
}
const listeners = new Set();

function apply(language) {
  const next = valid(language) ?? "en";
  try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* private window: this page still follows it */ }
  if (next === current) return;
  current = next;
  listeners.forEach((listener) => listener());
}

export function getUiLanguage() {
  return current;
}

export function useUiLanguage() {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    () => current,
    () => current,
  );
}

async function saveLocale(userId, locale) {
  const { error } = await supabase.from("user_profiles").update({ locale }).eq("id", userId);
  if (error) throw error;
}

/**
 * Settles the language for a signed-in person, once per page load. `fromSignUp`
 * is true while the company is still onboarding. Never throws: an unreadable
 * profile keeps the language this browser already had.
 */
export async function syncUiLanguage(userId, { fromSignUp = false } = {}) {
  if (!userId) return current;
  const chosenNow = takeChoice() ?? urlLanguage() ?? (fromSignUp ? storedLanguage() : null);
  try {
    if (chosenNow) {
      apply(chosenNow);
      await saveLocale(userId, chosenNow);
      return current;
    }
    const { data, error } = await supabase.from("user_profiles").select("locale").eq("id", userId).maybeSingle();
    if (!error && valid(data?.locale)) apply(data.locale);
  } catch {
    /* the screens stay in this browser's language */
  }
  return current;
}

/**
 * The person picked a language (Settings, or the onboarding toggle). Shown at
 * once; saved for every tab and device. Throws when the save fails, so the
 * caller can say so; the screen keeps the new language either way.
 */
export async function chooseUiLanguage(userId, language) {
  const next = valid(language);
  if (!next) return;
  apply(next);
  if (userId) await saveLocale(userId, next);
}

/** The language for a screen both sides share: the factory's choice, English for a brand. */
export function useScreenLanguage(isFactory = true) {
  const language = useUiLanguage();
  return isFactory ? language : "en";
}
