import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Netlify sets NETLIFY=true and Vercel sets VERCEL=1 during their builds, so the
// deploy target is baked in at build time rather than sniffed from the hostname.
// "local" covers dev servers and hand-rolled builds; survey.js falls back to a
// hostname check in that case.
const deployTarget = process.env.NETLIFY
  ? "netlify"
  : process.env.VERCEL
    ? "vercel"
    : "local";

/**
 * A PR preview's own database, when it has one.
 *
 * Supabase branching gives each PR that changes the database a branch of its
 * own, and writes that branch's address and publishable key into Vercel for
 * the PR's preview — as NEXT_PUBLIC_SUPABASE_URL and
 * NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, which Vite would otherwise ignore.
 * They are baked in only on a Vercel preview build, and only as a pair, so
 * production, local dev and a preview with no branch keep using
 * VITE_SUPABASE_* exactly as before. src/lib/supabase.js reads the result.
 */
function previewSupabase(mode) {
  if (process.env.VERCEL_ENV !== "preview") return null;
  const env = loadEnv(mode, process.cwd(), "NEXT_PUBLIC_SUPABASE_");
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}

/**
 * One-click sign-in as the demo accounts (src/shared/DemoSignIn.jsx).
 *
 * Only test builds get it: the dev server, and Vercel preview builds — every
 * PR preview and the qa site, which all talk to the test database. A
 * production build gets `false`, so the buttons, the demo emails and their
 * password are left out of the bundle entirely, not merely hidden.
 */
function demoSignIn(command) {
  return command === "serve" || process.env.VERCEL_ENV === "preview";
}

/**
 * Deep links live under /app.html/... . Production handles this with a rewrite
 * in vercel.json; the dev server needs the same, or a hard refresh on
 * /app.html/rfqs/:id falls through to the marketing page — which is exactly
 * what happened the first time the e2e run reloaded a deep link.
 */
function appDeepLinks() {
  return {
    name: "app-deep-links",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url && /^\/app\.html\/.+/.test(req.url.split("?")[0])) {
          req.url = "/app.html";
        }
        next();
      });
    },
  };
}

/**
 * Vercel runs api/*.js as serverless functions in production. The dev server
 * knows nothing about them, so /api would 404 locally — including in the e2e
 * run. This mounts the same handler files, so local and deployed behaviour
 * come from one implementation rather than two.
 */
function apiRoutes() {
  return {
    name: "api-routes",
    configureServer(server) {
      // Vite only exposes VITE_-prefixed vars, and only to the client bundle.
      // A serverless handler reads process.env, so load the rest in for dev —
      // on Vercel the platform already provides them.
      const env = loadEnv(server.config.mode, process.cwd(), "");
      for (const [key, value] of Object.entries(env)) {
        if (!key.startsWith("VITE_") && !(key in process.env)) process.env[key] = value;
      }

      server.middlewares.use(async (req, res, next) => {
        const path = (req.url ?? "").split("?")[0];
        if (!path.startsWith("/api/")) return next();

        try {
          const module = await server.ssrLoadModule(`.${path}.js`);
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          req.body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};

          // The shape Vercel's runtime gives a handler.
          res.status = (code) => { res.statusCode = code; return res; };
          res.json = (payload) => {
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(payload));
            return res;
          };

          await module.default(req, res);
        } catch (error) {
          server.config.logger.error(`api ${path}: ${error.message}`);
          res.statusCode = 200;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ fields: null, error: error.message }));
        }
      });
    },
  };
}

export default defineConfig(({ command, mode }) => ({
  plugins: [react(), appDeepLinks(), apiRoutes()],
  define: {
    __DEPLOY_TARGET__: JSON.stringify(deployTarget),
    __PREVIEW_SUPABASE__: JSON.stringify(previewSupabase(mode)),
    __DEMO_SIGN_IN__: JSON.stringify(demoSignIn(command))
  },
  build: {
    rollupOptions: {
      // The app is NOT built on Netlify, deliberately.
      //
      // Three things it needs are Vercel-only: the `/app.html/*` rewrite that
      // makes a deep link survive a refresh, the `api/*` functions (which use
      // Vercel's `(request, response)` handler signature, not Netlify's
      // `(event, context)`), and the Supabase auth redirect allowlist. On
      // Netlify a deep link 404s, brief generation and message translation
      // silently do nothing, and a magic link cannot come back.
      //
      // A half-working app is worse than an absent one, so Netlify builds the
      // marketing site and the prototypes — which need none of the above and
      // are how Queena reviews design — and the app lives on Vercel.
      input: {
        main: "index.html",
        // admin.html rides with app.html for the same reason: it is an
        // authenticated page, and a magic link cannot come back on Netlify.
        ...(deployTarget === "netlify" ? {} : { app: "app.html", admin: "admin.html", adminLogin: "admin-login.html" }),
        caseStudy: "case-study.html",
        factories: "factories.html",
        factorySearch: "factory-search.html",
        prototype: "prototype.html",
        factoryPrototype: "factory-prototype.html",
        adminPrototype: "admin-prototype.html",
        factorySurvey: "factory-survey.html",
        factorySurveyThankYou: "factory-survey-thank-you.html"
      }
    }
  }
}));
