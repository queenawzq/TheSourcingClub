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
 * On load: if this is an emailed link landing (`?code=`), put back the
 * remembered parameters it does not carry itself. Returns the new search
 * string, or null when nothing changed. Always forgets what was remembered
 * once a link lands, so it is used once.
 */
/**
 * An emailed sign-in link landing: `?code=` when it worked, or Supabase's
 * `?error_code=` (and the same in the fragment) when the link was already
 * used, expired or unknown.
 */
export function isSignInLinkLanding(win) {
  const query = new URLSearchParams(win.location.search);
  if (query.has("reset")) return false;
  const hash = new URLSearchParams(String(win.location.hash ?? "").replace(/^#/, ""));
  return query.has("code") || query.has("error_code") || hash.has("error_code");
}

/** Supabase's error words in the address, removed once read. Returns the cleaned search, or null. */
export function withoutLinkError(win) {
  const query = new URLSearchParams(win.location.search);
  const hash = new URLSearchParams(String(win.location.hash ?? "").replace(/^#/, ""));
  if (!query.has("error_code") && !hash.has("error_code")) return null;
  for (const key of ["error", "error_code", "error_description"]) query.delete(key);
  const rest = query.toString();
  return rest ? `?${rest}` : "";
}

export function restoreReturn(win, now = Date.now()) {
  const current = new URLSearchParams(win.location.search);
  if (!isSignInLinkLanding(win)) return null;
  const saved = safe(() => JSON.parse(win.localStorage.getItem(KEY) ?? "null"));
  safe(() => win.localStorage.removeItem(KEY));
  if (!saved?.params || !(now - Number(saved.at) < FRESH_MS)) return null;
  // Before the client saves the session: this tab keeps it to itself.
  if (saved.keep === false) safe(() => win.sessionStorage.setItem(KEEP_KEY, "0"));
  // The link may carry some of them itself (the vendor portal): those win,
  // and only the missing ones come back.
  let changed = false;
  for (const key of KEPT) {
    const value = saved.params[key];
    if (typeof value === "string" && value && !current.has(key)) {
      current.set(key, value);
      changed = true;
    }
  }
  return changed ? `?${current.toString()}` : null;
}

/** Signed in another way (the code typed in, a password): the link is no longer needed. */
export function forgetReturn(win) {
  safe(() => win.localStorage.removeItem(KEY));
}

/**
 * A sign-in link's `?code=` that this browser cannot finish: the code is only
 * exchanged with the code verifier saved when the code was asked for, so a
 * link opened in another browser (or after the verifier was used) has none.
 * Supabase then ignores the code without an error, so this is checked here.
 */
export function linkCannotFinishHere(win) {
  const query = new URLSearchParams(win.location.search);
  if (!query.get("code")) return false;
  const has = (key) => Boolean(safe(() => win.localStorage.getItem(key)));
  const keys = safe(() => Object.keys(win.localStorage), []);
  // supabase-js's own test (_isPKCECallback): the verifier saved for this
  // link's flow id, or the single verifier of older versions.
  const flowId = query.get("sb_flow_id");
  if (flowId && /^[a-zA-Z0-9_-]{8,64}$/.test(flowId)
    && keys.some((key) => key.endsWith(`-flow-${flowId}-code-verifier`) && has(key))) return false;
  return !keys.some((key) => /^sb-.+-auth-token-code-verifier$/.test(key) && has(key));
}
