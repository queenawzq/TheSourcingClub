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

export default defineConfig({
  plugins: [react()],
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
