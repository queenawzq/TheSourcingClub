/**
 * The password-reset link lands on our own page, not on the database's host.
 *
 * Supabase's own link opens `<project>.supabase.co/auth/v1/verify` in the
 * browser, which is the one request the reach fallback cannot carry (it is a
 * page load, not a fetch), and that host looks blocked in mainland China. So
 * the recovery email (supabase/templates/recovery.html) links to the page the
 * person asked from, allow-listed as before, with the token in the fragment:
 *
 *   https://…/app.html?reset=1#token_hash=…&type=recovery
 *
 * The page then verifies it with `verifyOtp`, a fetch, which goes direct or
 * through `/sb` like every other call. The fragment is never sent to a server,
 * so the token stays out of Vercel's logs and any Referer, and a mail
 * scanner that fetches the link cannot use it up: only the page's script does.
 *
 * Pure (it takes the window), so scripts/check-auth-storage.mjs can run it.
 */

/**
 * Read a recovery token from the address and take it out of the address in
 * the same step, so a refresh, a bookmark or a shared screenshot never
 * carries it. Returns the token hash ("" for a link cut short, which the
 * server then refuses in words), or null when the address has none.
 */
export function takeRecoveryToken(win) {
  const hash = String(win.location?.hash ?? "").replace(/^#/, "");
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  if (params.get("type") !== "recovery" || !params.has("token_hash")) return null;
  const tokenHash = params.get("token_hash") ?? "";

  params.delete("token_hash");
  params.delete("type");
  const url = new URL(win.location.href);
  const rest = params.toString();
  url.hash = rest ? `#${rest}` : "";
  try {
    win.history.replaceState(win.history.state, "", url.toString());
  } catch {
    // An address that cannot be rewritten still gets verified.
  }
  return tokenHash;
}
