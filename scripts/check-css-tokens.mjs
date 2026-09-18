/**
 * Fail the build on a CSS custom property that is referenced but never defined.
 *
 * This exists because that bug is invisible. `var(--blue, #2458ff)` with no
 * `--blue` defined does not warn, does not error, and does not look broken —
 * it silently paints the wrong colour, and the fallback makes it look
 * deliberate. Phases 3 and 4 shipped 48 of them, every one resolving to a
 * near-miss of the real brand colour.
 *
 * Only src/app is checked. The prototypes define their tokens in their own
 * stylesheets, and the factory one scopes them to .factory-flow rather than
 * :root, which this crude scan cannot reason about.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = "src/app";

function cssFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return path.endsWith(".css") ? [path] : [];
  });
}

const files = cssFiles(ROOT);
const defined = new Set();
for (const file of files) {
  for (const match of readFileSync(file, "utf8").matchAll(/^\s*(--[\w-]+)\s*:/gm)) {
    defined.add(match[1]);
  }
}

const problems = [];
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/var\(\s*(--[\w-]+)/g)) {
      if (!defined.has(match[1])) {
        problems.push(`${relative(process.cwd(), file)}:${index + 1}  ${match[1]}`);
      }
    }
  });
}

if (problems.length) {
  console.error(
    `\n${problems.length} CSS custom propert${problems.length === 1 ? "y is" : "ies are"} used but never defined.\n` +
      "A fallback hides this at runtime, so it will not look broken — it will look slightly wrong.\n",
  );
  for (const problem of problems) console.error("  " + problem);
  console.error("");
  process.exit(1);
}

console.log(`css tokens: ${defined.size} defined, every reference resolves`);
