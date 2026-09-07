# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run dev     # Vite dev server on http://127.0.0.1:5173
npm run build   # vite build, then copies script.js and assets/* into dist/
```

There is no test suite, linter, or formatter configured.

Deploys via Netlify (`netlify.toml`: `npm run build` → publish `dist`).

## Architecture

Two distinct things live side by side in one repo, sharing only fonts and brand feel:

### 1. Marketing site — plain static HTML/CSS/JS at the repo root

`index.html` (brands), `factories.html` (factories, EN/中文), `factory-search.html`, `case-study.html`, plus the survey pages. All of them link `./styles.css` and `./script.js` directly — no bundler involvement, no framework. `styles.css` (~80k) is the single stylesheet for every root page; `survey.css` layers on top for the survey pages only.

`script.js` is one non-modular file wiring every root page at load: waitlist modal, FAQ accordion, IntersectionObserver reveal animations, the `factory-search.html` filter/chip logic, the EN↔中文 toggle, and signup form submission.

- **i18n** is a hand-rolled dictionary (`factoryTranslations` in `script.js`) applied via `data-i18n="key"` (sets `innerHTML`) and `data-i18n-attr="attr:key,attr:key"`. Only pages with a `[data-lang-toggle]` button run it. Adding translated copy means adding both the markup attribute and the key in *both* `en` and `zh` maps. Language choice persists in `localStorage` under `factoryLang`.
- **Signup forms** use `[data-signup-form]` + `data-source="..."`; `script.js` POSTs a `FormData` (`mode: 'no-cors'`) to the Google Apps Script webhook URL hardcoded at the top of `script.js`. `google-sheets-apps-script.js` is that endpoint's server side — its `HEADERS` array defines the sheet columns, so a new form field only gets recorded if it is added there too.
- **The survey** (`factory-survey.html`) is dual-host, handled by `survey.js`, not `script.js`. On Netlify it is left alone and posts natively to Netlify Forms (`data-netlify`, `form-name` hidden input, honeypot `bot-field`). On any other host `survey.js` intercepts the submit and POSTs to the same Google Sheets webhook. See **Deploy targets** below.
- Stylesheet links carry cache-busting query strings (`styles.css?v=20260708-mobile`) that vary per page; bump them when shipping CSS changes.
- `polish-overrides.css` and `final-annotations.css` are near-duplicate leftovers not referenced by any page.

### 2. Product prototypes — React 19 + Vite

`prototype.html` (brand-side RFQ→contract→funding flow) and `factory-prototype.html` (factory-side) are thin shells mounting `src/prototype/main.jsx` and `src/factory-prototype/main.jsx`. Each is a single ~6k-line file: all screens, mock data, and components in one module, with a `screen` state string switched through a big render function — no router, no state library, no API. `src/factory-prototype/main.jsx` imports `../prototype/styles.css` before its own, so the brand prototype's CSS is the base layer for both.

Deep-linking is by query param, since there is no router:
- brand: `?screen=<name>` (any key of `screenMeta`), or `?view=marketplace` / `?view=brand-onboarding`
- factory: `?screen=<name>`, `?onboarding=1`, `?view=public`; last screen persists in `localStorage` under `tscFactoryPrototypeScreen`

Every page must be registered in `vite.config.js` `rollupOptions.input` or it will not be built.

## Design system

`TSC_DESIGN_SYSTEM.md` is the enforceable spec for **product screens** (the React prototypes): tokens, a role-based type scale, and fixed component dimensions (42px buttons, 28px pills, 8px cards, 76px bottom bar). Read it before changing prototype UI, and follow its rule that conflicts are fixed by updating the screen rather than adding a local exception.

It does **not** govern the marketing site, which has its own separate palette in `:root` of `styles.css` (`--blue: #2458ff`, `--paper`, `--ink`, …) and uses the display face `TAY Bang!` alongside Satoshi. Don't mix the two token sets.

Satoshi (`assets/fonts/*.otf`) is the product font everywhere; it is self-hosted via `@font-face`, declared separately in `styles.css` and `src/prototype/styles.css`.

## Deploy targets (Netlify and Vercel)

The site is deployable to both, and the survey form is the only thing that differs — Netlify Forms is a Netlify-only feature with no equivalent elsewhere.

`vite.config.js` bakes a `__DEPLOY_TARGET__` constant into the bundle from whichever CI is building: Netlify sets `NETLIFY=true`, Vercel sets `VERCEL=1`, anything else becomes `"local"`. `survey.js` reads it and branches:

- `netlify` → attaches no handler at all; the native POST is captured by Netlify Forms exactly as before.
- anything else → intercepts submit, POSTs `FormData` to the Google Apps Script webhook, then redirects to `factory-survey-thank-you.html`.

A `"local"` build falls back to sniffing `*.netlify.app` / `*.vercel.app` from the hostname, which covers builds made outside either CI. The Netlify-specific markup stays in the HTML on every host — it is inert off-Netlify — so nothing needs stripping per target.

`google-sheets-apps-script.js` routes on the `source` field: `factory-prototype-survey` writes to a `FactorySurvey` sheet, everything else falls back to the `Signups` sheet, so the existing `data-source="designer"` / `data-source="factory"` signup forms are unchanged. It reads `event.parameters` (plural) so the survey's `trust_factors` checkbox group keeps all its values.

Config lives in `netlify.toml` and `vercel.json`; both just run `npm run build` and publish `dist`.

Note: submissions use `mode: 'no-cors'`, so `fetch` resolves even when the Apps Script rejects the request — only a network-level failure surfaces the error state. That is pre-existing behavior shared with the signup forms.

## Backend (Supabase)

Phase 1 of the backend lives on `feature/supabase-backend`. Schema, access rules and tests are done; the two prototypes are not yet wired to it and still run on mock data at their original URLs.

```bash
supabase start        # local stack in Docker; prints the URL + keys
npm run db:reset      # re-apply every migration from scratch
npm run db:test       # pgTAP access-rule suite (25 assertions)
npm run smoke         # end-to-end check through supabase-js
npm run taxonomy      # regenerate migration 007 from the seed JSON
```

Put the local URL and publishable key in `.env.local` as `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; `app.html` shows a setup message rather than crashing when they are absent.

### Shape

The browser talks to Postgres directly with the publishable key, and **row level security is the entire authorisation layer** — there is no server tier to enforce anything a second time. A mistake in a policy is a data breach, not a bug, which is why `supabase/tests/access_rules_test.sql` is mostly *negative* assertions: a policy that accidentally grants everything still passes every positive test.

Two roles matter. `authenticated` and `anon` hold the publishable key and are fully governed by RLS; `anon` deliberately has no table grants at all, so a signed-out visitor is refused before RLS is consulted. `service_role` carries `BYPASSRLS` and is only ever used by server code holding the secret key — never anything bundled into the browser.

Migrations are numbered and immutable once pushed. `007` is generated from `supabase/seed/taxonomy.json` by `scripts/build-taxonomy.py`; edit the JSON, never the SQL.

### Things that will bite

- **`current_org_ids()` and friends are `SECURITY DEFINER` on purpose.** A policy on `org_members` that reads `org_members` recurses infinitely; running the lookup as the definer bypasses RLS inside the function and breaks the cycle. Do not "fix" them to be invoker.
- **Capacity maths exists in two places by design** — `capacity_monthly_units()` in migration 003 and `src/lib/domain/capacity.js`. They must stay identical, or a factory sees one number while the brand ranking it sees another. The prototypes have four copies, one of which hardcodes 18 min/piece for every category and so overstates a sweater factory by ~2.3x.
- **Taxonomy is the identity, labels are not.** Terms carry `label_en` and `label_zh`, so vocabulary never goes near machine translation. Match on slug, never on displayed text.
- **Every amount is minor units plus a currency code.** Only USD is offered, but RMB is coming and adding currency to a populated payments table later is invasive.
- **Two storage buckets, and the split is effectively irreversible.** Logos and product shots go in `org-public`; business registrations and certificates go in `org-private` and are reachable only by signed URL. A private document that lands in the public bucket may be cached or indexed long after the mistake is noticed.

### Brand onboarding

`src/app/onboarding/` is the first flow wired to the database. Two properties worth keeping:

- **It saves per step, not at the end.** Closing the tab mid-flow loses nothing, and reopening resumes at the first step with a gap. Saves are partial upserts, so a later step cannot clobber an earlier one.
- **`setLinks()` is scoped to a single taxonomy kind.** A profile screen edits one chip group at a time; a blanket delete of an entity's links would wipe the groups that screen never showed.

Option lists come from `taxonomy_terms` — nothing in the flow hardcodes a vocabulary. Kinds flagged `allows_custom` get "add your own"; the database rejects a custom term on any other kind, so the UI check is a convenience, not the guard.

### No key literals, not even local ones

`scripts/smoke-test.mjs` reads the stack's URL and keys from `supabase status -o json`, or from `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_KEY`. The local development keys are identical on every machine and are not real secrets, but a literal beginning `sb_secret_` trips GitHub's push protection and teaches the wrong habit. There is no key literal anywhere in this repository.

### Tests must not depend on each other

Both suites run against the same local database with no reset between them, so **every assertion is scoped to its own fixtures**. pgTAP org slugs are `pgtap-` prefixed and every `count(*)` filters on the fixture ids; the smoke test stamps its org names with the run timestamp. A bare `count(*)` passes alone and fails the moment the other suite has run first — which is exactly how this broke the first time.

### Auth

Passwordless. The primary method is a one-time code emailed to the user; nothing in the app calls `signInWithPassword` and no account ever has a password set. Google is coded and ready but disabled until credentials exist — set the two secrets in `supabase/.env`, flip `enabled` in `[auth.external.google]`, and set `VITE_GOOGLE_AUTH_ENABLED=true` so the button appears.

Local emails land in Mailpit at http://127.0.0.1:54324 and carry both a six-digit code and a link, from `supabase/templates/magic_link.html`.

**Hosted sends a link only, and rarely.** Supabase rejects custom email templates on a free-tier project using the built-in sender, and that sender allows roughly two emails an hour — fine for a solo check, useless for testing with several people. Configuring custom SMTP (Resend, Postmark, SES) fixes both at once: hosted emails get the code back, and the rate limit goes away.

Push auth settings to the hosted project with `./scripts/push-config.sh --project-ref <ref>`, which strips the template block the free tier rejects. Once SMTP is configured, delete that stripping and use `supabase config push` directly.
