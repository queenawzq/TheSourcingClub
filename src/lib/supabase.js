/**
 * The Supabase browser client.
 *
 * This client runs with the publishable (anon) key and is subject to row level
 * security on every query. That is deliberate: with no server tier, the
 * database is the authorisation layer. Never put the service-role key in
 * anything that ships to a browser — it bypasses RLS entirely. Server-side
 * work that needs it belongs in api/, which is not bundled.
 */
import { createClient } from "@supabase/supabase-js";

// A PR preview with its own Supabase branch connects to that branch; every
// other build (production included) uses VITE_SUPABASE_*. See vite.config.js.
const url = __PREVIEW_SUPABASE__?.url ?? import.meta.env.VITE_SUPABASE_URL;
const publishableKey = __PREVIEW_SUPABASE__?.key ?? import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * True when the app has been given somewhere to connect to. The shells check
 * this so a preview deploy without env vars shows a clear setup message
 * instead of a stack trace from deep inside a query.
 */
export const isConfigured = Boolean(url && publishableKey);

/** The database this build talks to. The demo sign-in hides itself on production's. */
export const supabaseUrl = url ?? "";

/**
 * "Keep me logged in", made real.
 *
 * The designed login screen offers the choice, so it has to mean something.
 * Checked, the session goes to localStorage and survives closing the browser;
 * unchecked, it goes to sessionStorage and dies with the tab — which is what
 * someone ticking nothing on a shared machine is asking for.
 *
 * The preference itself lives in localStorage, because it has to be readable
 * before the session is restored in order to know where to look for it. Reads
 * check both stores regardless: a session written under one setting must not
 * disappear because the preference changed after it was saved.
 *
 * Every accessor is wrapped. Storage throws rather than returning null in a
 * locked-down browser, and an exception here happens before any error
 * boundary exists — it is a white page, not a message.
 */
const KEEP_KEY = "tscKeepSignedIn";

const safe = (fn, fallback = null) => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

export function setKeepSignedIn(keep) {
  safe(() => window.localStorage.setItem(KEEP_KEY, keep ? "1" : "0"));
}

const keepSignedIn = () => safe(() => window.localStorage.getItem(KEEP_KEY), "1") !== "0";

const sessionStorageAdapter = {
  getItem(key) {
    // Both stores, always. Otherwise a session written before the preference
    // changed becomes unreachable and the user is silently signed out.
    return safe(() => window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key));
  },
  setItem(key, value) {
    if (keepSignedIn()) {
      safe(() => window.localStorage.setItem(key, value));
      safe(() => window.sessionStorage.removeItem(key));
    } else {
      safe(() => window.sessionStorage.setItem(key, value));
      safe(() => window.localStorage.removeItem(key));
    }
  },
  removeItem(key) {
    safe(() => window.localStorage.removeItem(key));
    safe(() => window.sessionStorage.removeItem(key));
  },
};

/**
 * Emails go out from a queue the database fills whenever a notification is
 * written (api/notification-emails.js). Nothing calls that sender per action:
 * after any successful write through this client, and after a server route
 * that notifies (screening a message, Stripe), the browser asks it once to
 * send what is due, a moment later, without waiting for the answer. A daily
 * job catches anything this misses.
 */
let emailKick = null;
export function kickNotificationEmails(round = 0) {
  clearTimeout(emailKick);
  emailKick = setTimeout(async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) return;
      const answer = await fetch("/api/notification-emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        keepalive: true,
      });
      const body = await answer.json().catch(() => ({}));
      if (body.more && round < 3) kickNotificationEmails(round + 1);
    } catch {
      // Never surfaces: the queue keeps the email for the next try.
    }
  }, round ? 300 : 1500);
}

function fetchThenKick(input, init) {
  return fetch(input, init).then((response) => {
    const method = String(init?.method ?? "GET").toUpperCase();
    if (response.ok && method !== "GET" && method !== "HEAD" && String(input).includes("/rest/v1/")) {
      kickNotificationEmails();
    }
    return response;
  });
}

export const supabase = isConfigured
  ? createClient(url, publishableKey, {
      global: { fetch: fetchThenKick },
      auth: {
        // Google and the password-reset link both come back with the session
        // in the URL; pick it up and then clean the address bar.
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
        flowType: "pkce",
        storage: sessionStorageAdapter,
      },
    })
  : null;

/**
 * Supabase returns { data, error } rather than throwing. Swallowing `error` is
 * the single easiest way to ship a screen that silently renders empty, so
 * every call in the domain layer goes through here.
 */
export function unwrap({ data, error }, context) {
  if (error) {
    const message = context ? `${context}: ${error.message}` : error.message;
    const wrapped = new Error(message);
    wrapped.cause = error;
    wrapped.code = error.code;
    throw wrapped;
  }
  return data;
}
