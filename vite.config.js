import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        prototype: "prototype.html",
        factoryPrototype: "factory-prototype.html"
      }
    }
  }
});
