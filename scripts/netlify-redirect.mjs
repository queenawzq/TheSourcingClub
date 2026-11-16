#!/usr/bin/env node
/**
 * Sends visitors of the old Netlify marketing site to the same page on the
 * live site on Vercel.
 *
 * Runs at the end of `npm run build` on every host, and writes `dist/_redirects`
 * only when ALL of these hold:
 *   - Netlify is building (NETLIFY=true),
 *   - it is a production deploy (CONTEXT=production; deploy previews and
 *     branch deploys are left alone),
 *   - the site is the marketing site (SITE_NAME=thesourcingclub; the
 *     prototype site, tsc-factory-prototype, builds from the same repo and
 *     netlify.toml and must keep serving the prototypes),
 *   - it is switched on (ON below, and TSC_NETLIFY_REDIRECT is not "off").
 * Anywhere else it writes nothing, so a Vercel or local build is unchanged.
 *
 * Turning it off needs no Netlify access: set ON to false and merge, and the
 * next Netlify production deploy serves the old pages again. Whoever has
 * Netlify access can also set TSC_NETLIFY_REDIRECT=off on the site.
 *
 * The redirects to sourcing-club.com are 301 (permanent), so search engines
 * replace the old Netlify address with sourcing-club.com in their results.
 * Browsers cache a 301: turning this off later only reaches people who have
 * not visited since, so treat the move as final.
 *
 * Nothing on Netlify is deleted: the pages stay in the deploy, they are just
 * not shown while the redirect is on.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ON = true;
const MARKETING_SITE = "thesourcingclub";
const TARGET = "https://sourcing-club.com";

// Pages that stay on Netlify: the design prototypes (Queena's loop), and the
// survey's thank-you page, which is where the survey form POSTs, so a survey
// opened before the redirect went live still reaches Netlify Forms.
const KEEP = [
  "prototype",
  "factory-prototype",
  "admin-prototype",
  "payments-design-preview",
  "factory-survey-thank-you",
];

/** The `_redirects` text, or null when this build must not redirect. */
export function redirectsFor(env, pages) {
  if (!ON) return null;
  if (String(env.TSC_NETLIFY_REDIRECT ?? "").toLowerCase() === "off") return null;
  if (env.NETLIFY !== "true") return null;
  if (env.CONTEXT !== "production") return null;
  if (env.SITE_NAME !== MARKETING_SITE) return null;

  const lines = [
    "# Written by scripts/netlify-redirect.mjs (marketing site, production only).",
    "# First match wins. `200!` keeps a path on Netlify; `301!` sends it to Vercel.",
    "# `!` is needed because the files still exist here. Query strings are kept.",
    "",
    "/.netlify/*  /.netlify/:splat  200!",
    "/assets/*  /assets/:splat  200!",
  ];
  for (const name of KEEP) {
    lines.push(`/${name}.html  /${name}.html  200!`);
    lines.push(`/${name}  /${name}.html  200!`);
    lines.push(`/${name}/  /${name}.html  200!`);
  }
  lines.push("");
  // Netlify serves /factories for factories.html; Vercel does not (cleanUrls
  // is off), so the extensionless forms go to the .html page there.
  lines.push(`/index.html  ${TARGET}/  301!`);
  lines.push(`/index  ${TARGET}/  301!`);
  for (const page of pages) {
    const name = page.replace(/\.html$/, "");
    if (name === "index" || KEEP.includes(name)) continue;
    lines.push(`/${name}  ${TARGET}/${name}.html  301!`);
    lines.push(`/${name}/  ${TARGET}/${name}.html  301!`);
  }
  lines.push(`/*  ${TARGET}/:splat  301!`);
  return lines.join("\n") + "\n";
}

function main() {
  const dist = join(process.cwd(), "dist");
  const pages = existsSync(dist)
    ? readdirSync(dist).filter((f) => f.endsWith(".html")).sort()
    : [];
  const text = redirectsFor(process.env, pages);
  if (!text) {
    console.log("netlify-redirect: not the Netlify marketing production build; no _redirects written.");
    return;
  }
  const file = join(dist, "_redirects");
  const before = existsSync(file) ? readFileSync(file, "utf8") : "";
  writeFileSync(file, text + (before ? "\n" + before : ""));
  console.log(`netlify-redirect: wrote dist/_redirects (${TARGET}).`);
}

main();
