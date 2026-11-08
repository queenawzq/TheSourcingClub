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
import { createRoute, proxyPathFor } from "./supabase-route.mjs";
import { AUTH_MESSAGES, isNoAnswer } from "../shared/auth-messages.mjs";
import { fillOlderBrowsers } from "./older-browsers.mjs";

fillOlderBrowsers();

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

/** Before a sign-up: kept, unless the browser already keeps someone else. */
export const keepNewAccount = () => sessionStore.keepNewAccount(supabase.auth.storageKey);

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

const LIVE_FALLBACK_MS = 20000;

/** Tell our own host a page moved to the fallback: how we'd know it ever happens. */
function reportFallback() {
  navigator.sendBeacon?.("/api/auth-failure", new Blob([JSON.stringify({
    stage: "fallback",
    kind: "network",
    portal: new URLSearchParams(window.location.search).get("portal") ? "factory" : "brand",
    language: navigator.language,
  })], { type: "application/json" }));
}

function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// Direct to the database, or through our own host when that way is shut.
const route = isConfigured
  ? createRoute({
      base: String(url).replace(/\/$/, ""),
      proxyBase: `${globalThis.location?.origin ?? ""}${proxyPathFor(url)}`,
      fetch: (...request) => fetch(...request),
      storage: browserStorage(),
      onFallback: reportFallback,
    })
  : null;

/** Was this write sent again after a lost reply? Asked once, then forgotten. */
export const sentTwice = (path) => route?.takeRepeated(path) ?? false;

function fetchThenKick(input, init) {
  return route.fetch(input, init).then((response) => {
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

if (supabase) {
  // supabase-js gives Realtime the token of every sign-in broadcast by another
  // tab, including one AuthProvider ignores. Realtime reads this tab's own
  // session instead, so a this-tab-only tab never listens as someone else.
  const setRealtimeAuth = supabase.realtime.setAuth.bind(supabase.realtime);
  supabase.realtime.setAuth = () => setRealtimeAuth();

  // A file's link goes straight into an <img> or a new tab, never through
  // fetch, so it is built for whichever way is open when it is asked for.
  const openBucket = supabase.storage.from.bind(supabase.storage);
  supabase.storage.from = (bucket) => {
    const files = openBucket(bucket);
    const publicUrl = files.getPublicUrl.bind(files);
    const signedUrl = files.createSignedUrl.bind(files);
    const signedUrls = files.createSignedUrls.bind(files);
    files.getPublicUrl = (...args) => {
      const answer = publicUrl(...args);
      return { ...answer, data: { ...answer.data, publicUrl: route.fileUrl(answer.data.publicUrl) } };
    };
    files.createSignedUrl = async (...args) => {
      const answer = await signedUrl(...args);
      return answer.data ? { ...answer, data: { ...answer.data, signedUrl: route.fileUrl(answer.data.signedUrl) } } : answer;
    };
    files.createSignedUrls = async (...args) => {
      const answer = await signedUrls(...args);
      return answer.data
        ? { ...answer, data: answer.data.map((row) => ({ ...row, signedUrl: row.signedUrl && route.fileUrl(row.signedUrl) })) }
        : answer;
    };
    return files;
  };

  // Live updates stay on the direct socket. While it is down, each listener is
  // run on a timer instead. A timed run has no payload: `{ timed: true }`.
  const listeners = new Map();
  const openChannel = supabase.channel.bind(supabase);
  const closeChannel = supabase.removeChannel.bind(supabase);
  supabase.channel = (...args) => {
    startLiveTimer();
    const channel = openChannel(...args);
    const listen = channel.on.bind(channel);
    listeners.set(channel, new Set());
    channel.on = (type, filter, callback) => {
      if (type === "postgres_changes") listeners.get(channel)?.add(callback);
      return listen(type, filter, callback);
    };
    return channel;
  };
  supabase.removeChannel = (channel) => {
    listeners.delete(channel);
    return closeChannel(channel);
  };
  const runListeners = () => {
    if (document.hidden || supabase.realtime.isConnected()) return;
    for (const callbacks of listeners.values()) {
      for (const callback of callbacks) {
        try {
          callback({ timed: true });
        } catch {
          // Never surfaces: the next run tries again.
        }
      }
    }
  };
  let liveTimer = null;
  const startLiveTimer = () => {
    liveTimer ??= globalThis.setInterval(runListeners, LIVE_FALLBACK_MS);
  };
}

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
    // Neither way reached the database. The browser's words reach nobody.
    const noAnswer = isNoAnswer(error);
    const message = noAnswer
      ? AUTH_MESSAGES.no_connection[globalThis.navigator?.languages?.some((language) => /^zh\b/i.test(language)) ? "zh" : "en"]()
      : context ? `${context}: ${error.message}` : error.message;
    const wrapped = new Error(message);
    wrapped.noAnswer = noAnswer;
    wrapped.cause = error;
    wrapped.code = error.code;
    throw wrapped;
  }
  return data;
}
