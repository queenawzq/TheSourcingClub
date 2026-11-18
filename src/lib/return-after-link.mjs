/**
 * Where an emailed sign-in link should land.
 *
 * "Email me a sign-in code" sends a code and a link. The link's address is
 * `app.html` alone: Supabase only redirects to addresses on its allowlist, an
 * exact match, so a query string there would send the person to the site's
 * default address instead. That dropped what the page was opened for: a
 * review email's `review=<company>` (and its portal and language), so someone
 * in two companies landed on the wrong one.
 *
 * So the page remembers those few parameters in this browser when the code is
 * asked for, and puts them back when the link lands (`?code=`, the PKCE
 * exchange, which only works in the browser that asked anyway). Only these
 * keys, only for an hour, and used once. Pure (it takes the window), so
 * scripts/check-auth-storage.mjs can run it.
 *
 * The sign-in box's choice travels the same way. The link opens a NEW tab,
 * which has made no choice and so would keep the session for the whole
 * browser, over a sign-in other tabs keep. Asked with the box unticked, the
 * landing tab keeps it to itself, as the code typed in would have.
 */
import { KEEP_KEY } from "./session-storage.mjs";

const KEY = "tscReturnAfterLink";
const KEPT = ["portal", "review", "lang"];
const FRESH_MS = 60 * 60 * 1000;

const safe = (fn, fallback = null) => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

/** Before sending a code: remember this page's portal, review and language, and the box. */
export function rememberReturn(win, { keepSignedIn = true } = {}, now = Date.now()) {
  const current = new URLSearchParams(win.location.search);
  const params = Object.fromEntries(KEPT.filter((key) => current.get(key)).map((key) => [key, current.get(key)]));
  if (!Object.keys(params).length && keepSignedIn) {
    safe(() => win.localStorage.removeItem(KEY));
    return;
  }
  safe(() => win.localStorage.setItem(KEY, JSON.stringify({ params, keep: Boolean(keepSignedIn), at: now })));
}

/**
 * On load: if this is an emailed link landing (`?code=`) with none of the
 * kept parameters, put back the remembered ones. Returns the new search
 * string, or null when nothing changed. Always forgets what was remembered
 * once a link lands, so it is used once.
 */
export function restoreReturn(win, now = Date.now()) {
  const current = new URLSearchParams(win.location.search);
  if (!current.has("code")) return null;
  const saved = safe(() => JSON.parse(win.localStorage.getItem(KEY) ?? "null"));
  safe(() => win.localStorage.removeItem(KEY));
  if (!saved?.params || !(now - Number(saved.at) < FRESH_MS)) return null;
  // Before the client saves the session: this tab keeps it to itself.
  if (saved.keep === false) safe(() => win.sessionStorage.setItem(KEEP_KEY, "0"));
  if (KEPT.some((key) => current.has(key)) || !Object.keys(saved.params).length) return null;
  for (const key of KEPT) {
    const value = saved.params[key];
    if (typeof value === "string" && value) current.set(key, value);
  }
  return `?${current.toString()}`;
}

/** Signed in another way (the code typed in, a password): the link is no longer needed. */
export function forgetReturn(win) {
  safe(() => win.localStorage.removeItem(KEY));
}
