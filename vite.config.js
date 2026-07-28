import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
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
