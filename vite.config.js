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

export default defineConfig({
  plugins: [react(), appDeepLinks(), apiRoutes()],
  define: {
    __DEPLOY_TARGET__: JSON.stringify(deployTarget)
  },
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        app: "app.html",
        caseStudy: "case-study.html",
        factories: "factories.html",
        factorySearch: "factory-search.html",
        prototype: "prototype.html",
        factoryPrototype: "factory-prototype.html",
        factorySurvey: "factory-survey.html",
        factorySurveyThankYou: "factory-survey-thank-you.html"
      }
    }
  }
});
