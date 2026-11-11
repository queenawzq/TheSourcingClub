/**
 * The language a person's emails are written in.
 *
 * Every email builder already has its Chinese copy and picks it from
 * `user_profiles.locale` (copied onto each outbox row when it is queued), but
 * nothing ever wrote that column, so a vendor who chose 中文 was emailed in
 * English. The choice is the one the pages already keep: `?lang=zh` on the
 * address, or `factoryLang` in localStorage (the sign-up page and the
 * onboarding toggle). One language at a time: zh or en, never both.
 *
 * Nothing is written when the person never chose (a brand has no toggle), so
 * a choice made on another device is not overwritten by a default.
 */
import { supabase } from "./supabase.js";

export function chosenEmailLanguage() {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("lang");
    if (fromUrl === "zh" || fromUrl === "en") return fromUrl;
    const stored = window.localStorage.getItem("factoryLang");
    return stored === "zh" || stored === "en" ? stored : null;
  } catch {
    return null;
  }
}

const saved = new Map();

/** Saves the chosen language as the person's email language. Never throws. */
export async function saveEmailLanguage(userId) {
  const locale = chosenEmailLanguage();
  if (!userId || !locale || saved.get(userId) === locale) return;
  saved.set(userId, locale);
  try {
    const { error } = await supabase.from("user_profiles").update({ locale }).eq("id", userId);
    if (error) saved.delete(userId);
  } catch {
    saved.delete(userId);
  }
}

/**
 * Saves now, and again when the page is hidden, since the onboarding toggle
 * changes the choice without a reload. Returns the cleanup.
 */
export function keepEmailLanguage(userId) {
  if (!userId) return () => {};
  saveEmailLanguage(userId);
  const onHide = () => { if (document.visibilityState === "hidden") saveEmailLanguage(userId); };
  document.addEventListener("visibilitychange", onHide);
  return () => document.removeEventListener("visibilitychange", onHide);
}
