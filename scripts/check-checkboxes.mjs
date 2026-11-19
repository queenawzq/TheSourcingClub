/**
 * Every checkbox in the product is a square with rounded corners.
 *
 * The Fund screen's consent box was drawn as a thin rounded sliver: it sat in
 * a flex row beside a long sentence, and nothing stopped the row shrinking it,
 * so a 16 px square became 5–12 px wide. One rule in the base stylesheet that
 * every product page loads (`src/prototype/styles.css`) keeps every checkbox
 * at its own size. This check keeps that rule, and fails on a rule aimed at a
 * checkbox that would make it round or let it shrink again.
 *
 * Runs in the build, through check-css-tokens.mjs. `npm run check:checkboxes`
 * runs it alone; it first proves it catches the two ways this broke.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE_SHEET = "src/prototype/styles.css";

function files(dir, ext) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return files(path, ext);
    return ext.some((e) => path.endsWith(e)) ? [path] : [];
  });
}

/** Classes on the elements around each `type="checkbox"` input in the JSX. */
export function checkboxHostClasses(sources) {
  const classes = new Set();
  for (const source of sources) {
    const lines = source.split("\n");
    lines.forEach((line, index) => {
      if (!/type=["']checkbox["']/.test(line)) return;
      for (const near of lines.slice(Math.max(0, index - 4), index + 1)) {
        for (const match of near.matchAll(/className=["`]([^"`]+)["`]/g)) {
          for (const name of match[1].split(/\s+/)) if (/^[\w-]+$/.test(name)) classes.add(name);
        }
      }
    });
  }
  return classes;
}

/** Rules (selector + body) in a stylesheet, flattening @media blocks. */
function rules(css) {
  const out = [];
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const pattern = /([^{}@]+)\{([^{}]*)\}/g;
  for (const match of stripped.matchAll(pattern)) out.push({ selector: match[1].trim(), body: match[2] });
  return out;
}

/** Does this selector style a checkbox input itself (not a sibling or a pseudo-element)? */
function targetsCheckbox(selector, hostClasses) {
  return selector.split(",").map((part) => part.trim()).some((part) => {
    const compounds = part.split(/\s*[>+~]\s*|\s+/).filter(Boolean);
    const last = compounds[compounds.length - 1] ?? "";
    if (!/^input\b/.test(last) || /::/.test(last)) return false;
    if (/\[type=["']?(radio|text|file|number|email|password|search|date)/.test(last)) return false;
    if (/\[type=["']?checkbox/.test(last)) return true;
    if (/:not\(\[type=["']?checkbox/.test(last)) return false;
    return compounds.slice(0, -1).some((compound) => [...compound.matchAll(/\.([\w-]+)/g)].some((m) => hostClasses.has(m[1])));
  });
}

const ROUND = /border-radius\s*:\s*(50%|[1-9]\d*%|\d{3,}px|[2-9]\dpx)/;
const SHRINKS = /flex-shrink\s*:\s*[1-9]|flex\s*:\s*(1\b|auto\b|[^;]*\s[1-9]\s)/;

export function findProblems(stylesheets, hostClasses, baseSheet, seen = []) {
  const problems = [];
  const keeps = rules(baseSheet).some(({ selector, body }) => selector === 'input[type="checkbox"]' && /flex-shrink\s*:\s*0/.test(body));
  if (!keeps) problems.push(`${BASE_SHEET}: the rule input[type="checkbox"] { flex-shrink: 0; } is missing`);
  for (const [file, css] of stylesheets) {
    for (const { selector, body } of rules(css)) {
      if (!targetsCheckbox(selector, hostClasses)) continue;
      seen.push(`${file}: ${selector}`);
      if (ROUND.test(body)) problems.push(`${file}: "${selector}" makes a checkbox round (${body.match(ROUND)[0]})`);
      if (SHRINKS.test(body)) problems.push(`${file}: "${selector}" lets a checkbox shrink (${body.match(SHRINKS)[0]})`);
    }
  }
  return problems;
}

function run() {
  const jsx = files("src", [".jsx", ".js"]).map((path) => readFileSync(path, "utf8"));
  const hostClasses = checkboxHostClasses(jsx);
  const stylesheets = files("src", [".css"]).map((path) => [path, readFileSync(path, "utf8")]);
  const base = readFileSync(BASE_SHEET, "utf8");

  // The check must catch both ways a checkbox went wrong.
  const sabotaged = [
    findProblems([["x.css", ".before-funding input { border-radius: 50%; }"]], new Set(["before-funding"]), base),
    findProblems([], hostClasses, base.replace(/input\[type="checkbox"\]\s*\{\s*flex-shrink:\s*0;\s*\}/, "")),
  ];
  if (sabotaged.some((found) => found.length === 0)) {
    console.error("check:checkboxes: the check no longer catches a round or shrinking checkbox");
    process.exit(1);
  }

  const seen = [];
  const problems = findProblems(stylesheets, hostClasses, base, seen);
  if (process.argv.includes("--list")) for (const rule of seen) console.log(`  ${rule}`);
  if (problems.length) {
    console.error("Checkboxes must stay square with rounded corners:\n");
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  console.log(`check:checkboxes: every checkbox rule keeps it square (${seen.length} checkbox rules in ${stylesheets.length} stylesheets)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) run();
export default run;
