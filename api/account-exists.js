import { createClient } from "@supabase/supabase-js";

/**
 * Does this address have an account?
 *
 * Asked by the "Forgot password" form so it can say "no account with that
 * email" instead of the neutral "if an account exists…". That is a product
 * decision taken knowingly: it makes this endpoint an account-enumeration
 * oracle, reachable without signing in.
 *
 * Two things therefore hold it in:
 *
 *   - the lookup is a definer function granted only to the service role, so
 *     auth.users stays unreachable from anything holding the publishable key;
 *   - every call is counted against the client's IP, in the database rather
 *     than in memory, because a serverless function is a new process often
 *     enough that an in-process counter limits nothing.
 *
 * When it is not configured, or the limit is hit, the caller falls back to the
 * neutral message rather than failing the reset — the reset email itself is
 * sent by the browser and does not depend on this answer.
 */

const jsonBody = (request) =>
  typeof request.body === "string" ? JSON.parse(request.body) : request.body ?? {};

// Good enough to reject junk before it reaches the database; the lookup
// itself is an exact-match comparison, not a pattern.
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "method not allowed" });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    response.status(503).json({ error: "account lookup is not configured" });
    return;
  }

  const email = String(jsonBody(request).email ?? "").trim().toLowerCase();
  if (!LOOKS_LIKE_EMAIL.test(email) || email.length > 254) {
    response.status(400).json({ error: "a valid email address is required" });
    return;
  }

  // x-forwarded-for is client-controlled, but on Vercel the platform appends
  // the real peer and the FIRST entry is the one it resolved. Falling back to
  // a single bucket means an unidentifiable caller shares one budget with
  // every other unidentifiable caller, which fails closed rather than open.
  const clientIp = String(request.headers["x-forwarded-for"] ?? "")
    .split(",")[0]
    .trim() || "unknown";

  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: allowed, error: limitError } = await service
    .rpc("claim_email_probe", { probe_ip: clientIp });

  if (limitError) {
    response.status(503).json({ error: "account lookup is unavailable" });
    return;
  }
  if (!allowed) {
    response.status(429).json({ error: "too many lookups, try again later" });
    return;
  }

  const { data: exists, error: lookupError } = await service
    .rpc("email_has_account", { addr: email });

  if (lookupError) {
    response.status(503).json({ error: "account lookup is unavailable" });
    return;
  }

  response.status(200).json({ exists: Boolean(exists) });
}
