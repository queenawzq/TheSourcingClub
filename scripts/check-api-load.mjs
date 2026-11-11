/**
 * Loads every api/*.js the way Vercel runs it: compiled to CommonJS, with
 * require() of a .mjs refused. Node 22+ allows that require and treats the
 * source as ESM, so neither a local run nor a build-time import can see it,
 * and the function then dies at load on Vercel, before its handler runs
 * (registry-assist on #100's preview; _stripe.js before it, 7d7be3b).
 * The fix is always import() inside the function that needs it.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { transformWithEsbuild } from "vite";

const require = createRequire(import.meta.url);
const Module = require("node:module");
const api = path.resolve(process.argv[2] ?? "api");

// Vite's esbuild is asynchronous and require() is not, so compile first.
const compiled = new Map();
for (const name of readdirSync(api).filter((file) => file.endsWith(".js"))) {
  const filename = path.join(api, name);
  const { code } = await transformWithEsbuild(readFileSync(filename, "utf8"), filename, {
    format: "cjs", loader: "js", platform: "node", target: "node22", sourcemap: false,
  });
  compiled.set(filename, code);
}

const plainJs = Module._extensions[".js"];
Module._extensions[".js"] = (module, filename) => {
  if (!compiled.has(filename)) return plainJs(module, filename);
  module._compile(compiled.get(filename), filename);
};
Module._extensions[".mjs"] = (_module, filename) => {
  throw Object.assign(new Error(`static import of ${path.relative(process.cwd(), filename)}: use import()`), { code: "ERR_REQUIRE_ESM" });
};

const failures = [];
const routes = [...compiled.keys()].filter((file) => !path.basename(file).startsWith("_"));
for (const file of routes) {
  try {
    if (typeof require(file).default !== "function") failures.push(`${path.basename(file)}: no default handler`);
  } catch (error) {
    failures.push(`${path.basename(file)}: ${error.code ?? error.name} ${error.message.split("\n")[0]}`);
  }
}
if (failures.length) {
  console.error(`api functions that would not start on Vercel:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`check:api-load: all ${routes.length} api functions load as Vercel runs them`);
