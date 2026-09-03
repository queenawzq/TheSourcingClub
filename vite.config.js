import { defineConfig } from "vite";
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

export default defineConfig({
  plugins: [react(), appDeepLinks()],
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
