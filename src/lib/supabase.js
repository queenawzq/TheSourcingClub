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
import { noteServerDate } from "./server-clock.js";
import { createSessionStorage } from "./session-storage.mjs";

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

// "Keep me logged in": where the session is kept, per tab. See session-storage.mjs.
const sessionStore = createSessionStorage(globalThis);

export const setKeepSignedIn = sessionStore.setKeepSignedIn;

/** Whether an auth event's session is this tab's own, not one broadcast from another tab. */
export function isThisTabsSession(session) {
  return sessionStore.isThisTabsSession(supabase.auth.storageKey, session);
}

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
        storage: sessionStore.storage,
      },
    })
  : null;

/**
 * POST to one of our own api/ functions as the signed-in person.
 *
 * A session ended elsewhere (signing out ends every session of the user)
 * leaves this tab a token the database still accepts, so the app keeps
 * working, while a server that asks the auth server is refused: 401. Nothing
 * here would otherwise notice, and the screen was left saying "sign in is
 * required" with no way to. So a 401 is handed to the auth layer:
 * getUser() asks the auth server, and when it says the session is gone it
 * removes it and emits SIGNED_OUT, which is how every lost session reaches
 * the sign-in screen (AuthProvider). Only that answer signs anyone out; a
 * network failure does not.
 *
 * Resolves the Response, or throws on a network failure as fetch does.
 */
export async function fetchApi(path, body) {
  const { data } = await supabase.auth.getSession();
  const sentAt = Date.now();
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data?.session?.access_token ?? ""}` },
    body: JSON.stringify(body),
  });
  noteServerDate(response, sentAt);
  if (response.status === 401) await supabase.auth.getUser().catch(() => {});
  return response;
}

/** What a screen says for an api/ 401, in the moment before sign-in replaces it. */
export const SIGN_IN_ENDED = "Your sign-in has ended. Sign in again.";

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
