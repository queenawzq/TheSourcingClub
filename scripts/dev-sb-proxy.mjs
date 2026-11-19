/**
 * The dev server's /sb, as vercel.json gives it on Vercel.
 *
 * The app tries /sb/<project> when the database's own host is slow or shut
 * (src/lib/supabase-route.mjs). On Vercel there is one rewrite per database.
 * The dev server only had /sb/local, so a dev server on a hosted database
 * (qa) answered /sb/<project>/... with the app's own page and a 200, which
 * the route took for a working way to the database: a slow read moved every
 * write there for ten minutes, and each failed on HTML.
 *
 * So: /sb/local and /sb/<this server's project> reach the database, and any
 * other /sb path answers 404, which the route reads as "never reached the
 * database". Previews and production never load this file.
 */
import { proxyPathFor } from "../src/lib/supabase-route.mjs";

/** Vite's `server.proxy` entries for /sb. */
export function sbProxyEntries(supabaseUrl, localTarget) {
  const entries = {
    "/sb/local": {
      target: localTarget || supabaseUrl || "http://127.0.0.1:54321",
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/sb\/local/, ""),
    },
  };
  const own = proxyPathFor(supabaseUrl);
  if (own !== "/sb/local") {
    entries[own] = {
      target: String(supabaseUrl).replace(/\/$/, ""),
      changeOrigin: true,
      rewrite: (path) => path.slice(own.length),
    };
  }
  return entries;
}

/** Connect middleware: 404 for an /sb path no entry reaches. */
export function sbUnknownIs404(entries) {
  const known = Object.keys(entries);
  return (req, res, next) => {
    const path = String(req.url ?? "").split("?")[0];
    if (!path.startsWith("/sb/") || known.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) {
      next();
      return;
    }
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end("Not found");
  };
}
