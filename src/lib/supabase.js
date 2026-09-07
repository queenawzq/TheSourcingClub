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

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * True when the app has been given somewhere to connect to. The shells check
 * this so a preview deploy without env vars shows a clear setup message
 * instead of a stack trace from deep inside a query.
 */
export const isConfigured = Boolean(url && publishableKey);

export const supabase = isConfigured
  ? createClient(url, publishableKey, {
      auth: {
        // Google redirects back with the session in the URL; pick it up and
        // then clean the address bar.
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
        flowType: "pkce",
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
