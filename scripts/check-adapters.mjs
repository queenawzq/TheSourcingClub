/**
 * Every `actions.X` a designed screen calls must exist in both adapters.
 *
 * The data seam has one failure mode that neither the build nor the type
 * system can see: a screen calls `actions.orgDocuments(...)`, the live
 * adapter supplies it, the mock does not -- or the reverse -- and the mount
 * that is missing it silently takes an empty branch. Nothing throws. The
 * screen renders, just without the thing it was asked to show.
 *
 * That is not hypothetical. `orgDocuments` and `documentUrl` shipped absent
 * from the live adapter because an edit was never written to disk: the import
 * was there, the action was not, and every company's files read "Nothing
 * uploaded" in production while the prototype looked perfect.
 *
 * An action may be absent on purpose -- the mock has no storage behind it, so
 * it supplies no `documentUrl` and the screen falls back to plain text. Those
 * go in ALLOWED_ABSENT with the reason, so a deliberate gap is a line someone
 * wrote rather than a silence.
 */
import { readFileSync } from "node:fs";

const SURFACES = [
  {
    name: "admin",
    screen: "src/admin-prototype/main.jsx",
    live: "src/app/admin/live-admin-adapter.js",
    mock: "src/admin-prototype/entry.jsx",
  },
];

/** `${surface}:${action}:${adapter}` → why it is missing on purpose. */
const ALLOWED_ABSENT = {
  "admin:documentUrl:mock":
    "the mock has no storage; DocumentLink renders plain text without it",
};

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/**
 * The body of the adapter's `actions: { ... }` object, and nothing else.
 *
 * Searching the whole file is what makes this check useless: the name also
 * appears on the import line, so a module that imports `orgSubmission` and
 * forgets to expose it passes. That is the exact shape of the bug this
 * exists to catch, so the search has to be scoped to the object literal.
 */
function actionsBlock(source) {
  const start = source.indexOf("actions: {");
  if (start < 0) return "";
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return source.slice(start);
}

// `name:` in an object literal, or `name,` as a shorthand property.
const declares = (source, name) =>
  new RegExp(`\\b${name}\\s*[:,(]`).test(actionsBlock(source));

let failures = 0;
let allowed = 0;

for (const surface of SURFACES) {
  const screen = read(surface.screen);
  const actions = [...new Set([...screen.matchAll(/actions\.(\w+)/g)].map((m) => m[1]))].sort();

  for (const action of actions) {
    for (const kind of ["live", "mock"]) {
      if (declares(read(surface[kind]), action)) continue;
      const reason = ALLOWED_ABSENT[`${surface.name}:${action}:${kind}`];
      if (reason) {
        console.log(`  · ${action} is absent from the ${kind} adapter — ${reason}`);
        allowed += 1;
        continue;
      }
      console.error(
        `  ✗ ${surface.screen} calls actions.${action}(), but the ${kind} adapter ` +
        `(${surface[kind]}) does not supply it`,
      );
      failures += 1;
    }
  }
  console.log(`  ${surface.name}: ${actions.length} actions checked`);
}

if (failures) {
  console.error(`\n${failures} action(s) missing from an adapter.`);
  process.exit(1);
}
console.log(`\nboth adapters answer every action${allowed ? ` (${allowed} absent on purpose)` : ""}`);
