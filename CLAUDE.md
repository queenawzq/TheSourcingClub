# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run dev     # Vite dev server on http://127.0.0.1:5173
npm run build   # check:css, vite build, then copies script.js and assets/* into dist/
```

There is no linter, formatter, unit-test runner or CI. There ARE four verification suites — see **Backend (Supabase)** below for `db:test`, `smoke`, `check:css` and `check:prototype`, plus the Stagehand walkthrough in `scripts/e2e.mjs`.

**The app deploys to Vercel; Netlify hosts the marketing site and the prototypes only.** `app.html` is excluded from a Netlify build (see `vite.config.js`) because three things it depends on are Vercel-only: the `/app.html/*` rewrite that makes deep links survive a refresh, the `api/*` functions (Vercel's `(request, response)` signature, not Netlify's `(event, context)`), and the Supabase auth redirect allowlist in `supabase/config.toml`. On Netlify a deep link 404s and the AI features fail soft and silently.

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

## The data seam — how the designed UI meets the backend

The direction as of Phase 5: **the prototype UI becomes the product.** `src/app` was growing hand-built screens beside ~14,000 lines of designed ones, which was waste. The prototypes are being wired to the real backend in place, screen by screen.

Editing Queena's files in place, rather than copying them, is deliberate. Two files at different paths share no ancestry, so `git merge origin/main` cannot help and every change of hers would be re-applied by hand forever. In place, git 3-way merges do the work. Keep edit footprints small — a screen changing from `activeProjects.map(...)` to `useOrders().map(...)` is one line — because small diffs are what keep a frequent merge uneventful.

The prototypes **must keep rendering with no database**. That is Queena's design loop: open `prototype.html`, see populated screens, iterate on visuals. So the same components mount twice against two adapters:

| Entry | Adapter | Data |
|---|---|---|
| `prototype.html` → `src/prototype/entry.jsx` | mock | the constants already in `main.jsx` |
| `app.html` → `src/app/main.jsx` | live | `src/lib/domain/*` via `src/app/live-adapter.js` |
| `admin-prototype.html` → `src/admin-prototype/entry.jsx` | mock | the constants already in `main.jsx` |
| `admin.html` → `src/app/admin/console.jsx` | live | `src/lib/domain/admin.js` via `src/app/admin/live-admin-adapter.js` |

`src/lib/data/DataProvider.jsx` is the seam. Every hook returns `{ data, loading, error, reload }` **even for the mock**, where `loading` is never true — a screen that handles that correctly against mock data handles it correctly against a network. There is not one loading or error state in the prototypes today, and those states are exactly where a port silently regresses.

`npm run check:prototype` asserts the mock loop still works. If it rots, Queena will not find out until she needs it.

### Which screens are the design, and which are not

**Never hand-build a screen.** If a designed component exists, export it and
wire it in place; do not write a parallel one in `src/app`. The hand-built
screens that remain are debt being paid down, not a pattern to extend.

On the design, live: **auth**, **brand and factory onboarding**, **the
dashboard**, **requests**, **orders**, the **request composer and its invite
step**, **comparing quotes**, the **order interior**, the **factory's
marketplace**, **conversations**, **settings**, and the whole **admin console**
(`admin.html`).

**Everything a brand or a vendor touches is on the design**, except the
screens below — each held back for a stated reason, not a backlog entry:

- **`PaymentInstructions` and `PayoutDetails`.** The designed payment flow says
  the brand "pays by card through TSC checkout so funds can be held before
  release". Payments are **track-only** — bank wire off-platform, the product
  records the trail — which is a locked decision taken to avoid
  money-transmitter, KYC and PCI exposure. Wiring that screen would tell a
  brand its money is on a card and held by TSC, and both are false. This is not
  a styling gap; it needs the design and the product to agree on where money
  goes.
- **`ScheduleEditor`.** Agreeing the schedule has no designed screen, and it is
  what activates an order. An unagreed order opens straight onto it.
- **`AdminPayments`.** No designed payments queue, and confirming a payment is a
  required step: staff have no org and cannot be notified, so a payment sits at
  `sent` until a human opens it.
- **`MilestoneDetail`** and the brand's own **`RfqDetail`** — no designed
  counterpart yet.

**The designed quote form writes prose where the schema keeps ids.** "30%
deposit / 70% before shipment" and "EXW quoted" are matched against
`taxonomy_terms` — a payment split by its numbers, an incoterm by its
three-letter code — and the sample plan's rows become `quote_sample_lines`, so
the total stays computed. Nothing is guessed: a value matching no term stores
nothing and `submit_quote()` then refuses and names the field, which the
screen shows. `deposit_pct` is derived from the matched term for the same
reason migration 005 gives — without one the generated schedule totals only
the sample lines and `agree_schedule` refuses it forever.

**`FlowShell` is how a designed flow screen gets mounted.** It was extracted
from the prototype's `App` — journey rail, eyebrow, right rail, bottom bar —
because those screens are drawn to sit inside that frame, and rebuilding it
would mean inventing one that already exists.

`src/app/admin/AdminPayments.jsx` is the one hand-built screen kept on
purpose: the designs have no payments queue, and confirming a payment is a
required step — staff have no org and cannot be notified, so a payment sits at
`sent` until someone opens it.

Things that will bite here:

- **`toProjectCard` in `src/app/live-adapter.js` is where the two vocabularies are reconciled**, not glue. The design's fixed five-step rail ("1st step funded / Fit sample / Fit / lab dip / Production / Shipped") does not map onto a schedule derived from a quote, which can contain any steps at all. The current mapping is right at both ends and approximate in between; it needs Queena's decision, not a cleverer function.
- **Screen keys carry no entity ids.** `goTo("projectDetail")`, not `/orders/:id`. `navigateFromPrototype` in `src/app/main.jsx` translates for now; the screens need real ids as they port.
- **Importing a prototype screen pulls in `src/prototype/styles.css`** — ~16,000 lines with `!important` blocks that restyle every `.primary-btn`, `.tag` and `.project-status` on the page. That is intended (the design is the CSS), but it means the remaining hand-built `src/app` screens are being restyled too.
- **CSS custom properties must be defined, not merely referenced.** `var(--blue, #2458ff)` with no `--blue` does not warn — it silently paints the wrong colour, and the fallback makes it look deliberate. Phases 3 and 4 shipped 48 of these. `npm run check:css` runs in the build to stop it happening again.
- **Design System v2 sizing lives in `src/app/shell.css`'s `:root`**, copied verbatim from the prototype's. Copied rather than imported to avoid the `!important` blocks above. Keep it in step when v2 moves. Buttons are 34px; **inputs stay 42px**.

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
npm run db:test       # pgTAP access-rule suites (207 assertions, six files)
npm run smoke         # 138 checks through supabase-js: embeds, RPC signatures, grants
npm run check:css     # fails on a CSS variable used but never defined (runs in build)
npm run check:prototype  # the prototype must still render with NO database
npm run taxonomy      # regenerate migration 007 from the seed JSON
```

Put the local URL and publishable key in `.env.local` as `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`; `app.html` shows a setup message rather than crashing when they are absent.

### Shape

The browser talks to Postgres directly with the publishable key, and **row level security is the entire authorisation layer** — there is no server tier to enforce anything a second time. A mistake in a policy is a data breach, not a bug, which is why `supabase/tests/access_rules_test.sql` is mostly *negative* assertions: a policy that accidentally grants everything still passes every positive test.

Two roles matter. `authenticated` and `anon` hold the publishable key and are fully governed by RLS; `anon` deliberately has no table grants at all, so a signed-out visitor is refused before RLS is consulted. The one exception is `current_legal_documents()`, granted to `anon` so signup can link to the terms before an account exists (see **Legal documents**). `service_role` carries `BYPASSRLS` and is only ever used by server code holding the secret key — never anything bundled into the browser.

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

All three pgTAP files and the smoke test run against the same local database with no reset between them, so **every assertion is scoped to its own fixtures**. Org slugs are prefixed per phase (`pgtap-`, `pgtap2-`, `pgtap3-`) and every `count(*)` filters on the fixture ids; the smoke test stamps its org names with the run timestamp. A bare `count(*)` passes alone and fails the moment another suite has run first — which is exactly how this broke the first time.

### Production orders (Phase 3)

An awarded quote becomes a `production_orders` row in the same transaction, carrying a **snapshot** of the quote's commercial terms. Copied, not joined: a factory revising its quote afterwards must not rewrite an executed contract. A trigger enforces that, rather than a policy, because `service_role` bypasses RLS and holds a blanket write grant.

Things that will bite here specifically:

- **`grant select` and nothing else, on every Phase 3 table.** Not stylistic. An UPDATE policy's `using` clause can gate the state a row comes *from*, but its `with check` cannot stop the same statement writing a confirmation stamp alongside it. A policy gates the transition; it cannot gate the payload. So the RPCs own every write.
- **A `security definer` function has no policy behind it.** The `or is_platform_admin()` branches on the read policies do not protect `confirm_payment_received`. The admin test is the first statement in each of the three admin RPCs — before any `select`, since checking afterwards leaks existence through `P0002` versus `42501`.
- **`quotes.deposit_pct` is nullable** and `submit_quote()` does not require it. Uncoalesced, the schedule generator emits milestones totalling only the sample lines, `agree_schedule` refuses that forever, and the order is dead with nothing on screen explaining why.
- **Compute one side of a percentage split and subtract for the other.** Rounding both independently loses or invents a cent, permanently, on a figure a brand types into a bank transfer.
- **`agree_schedule` takes a revision.** Without it: brand agrees, factory edits, factory agrees, and a client that cached "I already agreed" re-stamps the brand on terms it never read. The order activates showing two green checkmarks.
- **The chain advances on `confirmed`, never on `released`.** Keying it to release would freeze a production order permanently on one forgotten admin click, with no error and no party able to unstick it.
- **`documents_own` is `for all`** and says nothing about `milestone_update_id`. Without `documents_link_guard`, one UPDATE re-parents a photo onto another order and the counterparty read policy then serves it to strangers.
- **Milestone photos need three things to work**: the kind in `PRIVATE_KINDS`, a `documents` read policy for the counterparty, *and* a matching `storage.objects` policy. With only the first two, `urlFor()` mints a signed URL that 400s — a broken image tile, not an error message.
- **Money is `bigint` throughout.** `unit_price_cents * production_quantity` passes `int4` at 100,000 units of a $250 jacket.
- **Every header figure comes from `production_order_summary`.** JavaScript never sums money and never decides whose turn it is. The order total is the sum of the *milestones*, not the quote — they are equal at award and diverge the moment either side edits.
- **`order_payments.milestone_id` is unique, so its embed is to-ONE.** PostgREST returns an object where an ordinary embed returns an array, and indexing it as `[0]` yields `undefined` rather than an error — the timeline silently loses every payment status. `listMilestones()` resolves the shape once into `milestone.payment`; nothing downstream should touch `order_payments` directly.

Platform staff have no org, and `notifications.org_id` is `not null references orgs`, so **an admin cannot be notified of anything**. `admin_payment_queue()` is therefore a required step in the workflow, not a convenience: without someone watching it, every payment stalls at `sent`. Do not solve this with a synthetic platform org — it would leak into `current_org_ids()` and every `or is_platform_admin()` branch.

### Conversations (Phase 4)

A thread belongs to the **request or order it is about**, never to a pair of companies. That is what makes visibility free: `can_see_rfq()` and `is_order_party()` already answer who may read it, so there is no fourth set of rules to keep in step. One thread per order; one per `(rfq, factory)`, because asking four factories is four conversations.

- **Sending is a plain insert**, unlike almost everything else here. There is no state machine and no privilege to escalate — the payload is the sender's own words — so a `with check` on `is_thread_party` plus `sender_org_id`/`sender_user_id` says everything worth saying. Messages have no update or delete grant at all: changing the record of what you said is the opposite of what a conversation is for once money is involved.
- **Translation is stored, not computed on read.** `body` is what was typed and is never overwritten; `body_translated` is the other language. `/api/translate` **must never block a send** — any failure stores the message untranslated and the reader sees the original. This is the opposite of the taxonomy rule (`label_en`/`label_zh` are hand-written, never machine-translated) and deliberately so: a mistranslated *category* silently corrupts matching, while a mistranslated sentence is visibly a sentence and the person can ask.
- **Unread is derived per user** from `message_reads.last_read_at`, not stored on the thread. The prototype's thread-level integer is never decremented anywhere in either app.
- Attachments are `documents` with `message_id` and kind `message_attachment`, and need the same three parts as milestone photos: the private bucket, a `documents` policy for the counterparty, and a matching `storage.objects` policy keyed on the thread in the path.
- `documents` now has **three** FKs into this graph (`milestone_update_id`, `order_id`, `message_id`). An ambiguous embed is refused rather than guessed; the smoke test pins the exact select strings the domain modules use.

Not built, deliberately: call scheduling (the prototype's slot proposals, timezones and video links), presence, and "usually replies in 2h". Every one of those is a hardcoded literal in the prototypes with nothing behind it.

### Admin operations (Phase 6)

The admin prototype reviews a **company**; `review_document()` reviews a
**file**. Both exist, and both write the same `verification_status` column, so
a company-level verdict and a file-level one cannot contradict each other.

- **`org_reviews` is staff-only.** The internal note and the assigned reviewer
  are notes about a customer. What the company must see travels as a
  notification written in the same transaction, and `needs_information` is
  refused without a note at the database — a factory told only "Needs
  information" has nothing to act on.
- **Confidence scores and the per-check breakdown are deliberately not built.**
  They are the output of an automated registry check that does not exist, and a
  fabricated number on a reviewer's screen would be trusted. The queue reports
  evidence received of expected instead. `risk` is a field an admin sets by
  hand. The screens render conditionally around all three, so the prototype
  keeps showing its mock versions.
- **The overview's fourth card is payments awaiting confirmation**, where the
  design puts "low-confidence checks". Platform staff have no org and cannot be
  notified of anything, so a payment sits at `sent` until a human opens the
  queue; that count is the only prompt there is.
- **Every function on this surface is `security definer` and has no policy
  behind it.** The `is_platform_admin()` test is the first statement in each,
  before any `select` — checking afterwards leaks existence through `P0002`
  versus `42501`. `supabase/tests/admin_access_test.sql` is accordingly almost
  entirely negative.
- **RLS says what may be read; it does not say what a query means.**
  `org_members_read` ends in `or is_platform_admin()`, so an unfiltered read of
  that table returns every membership in the marketplace to staff.
  `listMyOrgs()` relied on the policy to mean "mine" and so dropped an admin
  into a stranger's workspace mid-onboarding, with their org id written to
  `localStorage`. Any query whose name says "my" needs its own `user_id`
  filter, whatever the policy happens to allow.

### Test emails

Admin Settings → Test emails sends any email the marketplace sends, with
sample data, to the signed-in admin's **own** address and nobody else's
(`api/send-test-email.js`). It builds the message with the same code as the
real send — Queena's designed onboarding emails from
`scripts/generate-onboarding-emails.mjs`, and `messageFor()` from
`api/send-review-decision.js` — so a test cannot drift from what a company
receives. A new email type needs adding to `TEMPLATES` there and
`TEST_EMAILS` in `src/admin-prototype/main.jsx`. Password resets are sent by
Supabase itself and cannot be tested this way.

### The operations inbox

`operations@contact.sourcing-club.com` is the support address in every email
and the Reply-To on every send. Resend receives mail for
`contact.sourcing-club.com` (an MX record in the Netlify DNS zone for
`sourcing-club.com`) and calls `api/inbound-email.js`, which verifies the Svix
signature and re-sends the message, attachments included, to
`INBOUND_FORWARD_TO` with Reply-To set to the original sender. Resend has no
forwarding rule of its own. Received mail counts against the Resend quota
(free tier: 100/day, sent plus received), and each forward costs one more.
Needs `RESEND_WEBHOOK_SECRET` from the webhook's page in Resend.

### Legal documents

The terms each kind of company signs (brand, factory, trading company) and the
privacy policy live in `legal_documents`, and are shown in Queena's Terms
dialog (`src/shared/TermsDialog.jsx`) — from the onboarding checkbox, and at
`app.html?legal=terms&type=…` / `app.html?legal=privacy`, where the signup
links point.

- **No version is ever updated, and nothing writes through the API.** There
  is no editor — the admin design dropped it on 2026-09-21 — so new wording is
  a new row with the next version, added by migration.
  `terms_acceptances.legal_document_id` points at the exact row signed, and a
  signature is only evidence if that text cannot change under it.
- **Onboarding shows the published text and signs that version**, with no
  fallback to the designed copy: a signature against text that is not stored
  proves nothing. If the terms fail to load, signing refuses with the reason.
  The prototypes pass no text, so the dialog keeps its designed copy there —
  keep the two in step when either changes.
- **`current_legal_documents()` is the only thing granted to `anon`**, and it
  returns only the current text. The table itself stays unreadable to
  everyone but staff.
- Chinese is a separate hand-written field per document, falling back to
  English when blank — never machine-translated, same rule as the taxonomy.
- **Version 1's onboarding summaries still promise escrow** ("we hold the
  funds"), copied verbatim from the designed cards. That contradicts
  track-only payments; a v2 is how it gets fixed.
- **The privacy policy names every processor** (Supabase, Vercel, Resend,
  OpenRouter, Google Sheets, Netlify Forms). Adding a service that touches
  personal data means publishing a new version of it.

### Wiring a designed screen to live data

The pattern, used by every port so far:

- **Give each control a `name`**, derived from its own visible label, and read
  the card's values on submit. The designs carry no names, values or handlers
  because nothing is ever read back in a prototype.
- **A control that draws buttons publishes through a hidden input.** Chip
  groups and the capacity panel hold their answer in their own state; one
  `<input type="hidden" data-multi>` is how it leaves.
- **Factory keys come from the English copy** whatever language is displayed,
  or a vendor filling the form in Chinese writes to different columns.
- **Option lists come from `taxonomy_terms`, never the hardcoded arrays.**
  Matching is on slugs.
- **Anything the design draws with nothing behind it is rendered
  conditionally**, so the prototype keeps it and the live mount goes without:
  confidence scores in the admin queue, call scheduling and presence in
  conversations, permission toggles in settings.

### Auth

**Email and password**, because `src/shared/AuthScreen.jsx` is the specification
and the backend answers to it rather than the other way round.

- **Signing up is one step.** The design collects a person's name and their
  company's name on the same form, and the portal it is rendered in says what
  kind of company that is — `app.html` for brands, `app.html?portal=factory`
  for vendors. So one submit creates the account, the profile name and the
  organisation. There is no separate "which side are you on?" question; that
  screen survives only as the recovery path for a signup whose org creation
  failed, and for Google.
- **The minimum is eight characters in two places and they must agree.**
  `minimum_password_length` in `supabase/config.toml` and
  `MIN_PASSWORD_LENGTH` in `src/lib/auth.jsx`. A client-side `minLength` the
  server does not share is a promise the product does not keep.
- **"Keep me logged in" is real.** Checked, the session goes to
  `localStorage`; unchecked, to `sessionStorage`, and dies with the tab. The
  storage adapter in `src/lib/supabase.js` reads *both* on the way out, so a
  session written under one setting is not lost when the setting changes.
- **Signing out clears the stored token before awaiting the network call.**
  The login screen renders the instant the status flips — deliberately, since
  clearing orgs while the shell thinks it is signed in crashes it to a blank
  page — and anyone navigating in that gap was previously signed back in by
  the token still on disk. `signOutFully` in `scripts/e2e.mjs` now polls
  storage rather than trusting the login form to have appeared.
- **"Forgot password" says whether the account exists**, as of 2026-09-20.
  It previously always reported success. John changed it knowing the cost: a
  user who mistypes their address otherwise waits for an email that never
  comes, and that was judged to outweigh the leak. The leak is real, though —
  the form is now a way to ask whether a company is a customer, one address at
  a time, with no login. `/api/account-exists` is therefore rate-limited per
  client IP in the database (10 per 10 minutes, `claim_email_probe`), and that
  limiter is part of the feature, not a refinement. `auth.users` stays
  unreachable from the browser: the lookup is a definer function granted to
  `service_role` alone. If the lookup is unconfigured, limited or down, the
  screen falls back to the old hedged wording and the reset still sends —
  the lookup decides what we *say*, never what we *do*.
- **A one-time code is still emailed, but only for recovery.** Nothing signs in
  with a code any more. The reset link lands on `app.html?reset=1`, which is
  allow-listed in `config.toml` as an exact URL.
- **Google is coded and hidden.** The design shows the button unconditionally;
  it appears only once `VITE_GOOGLE_AUTH_ENABLED=true`, because a button that
  opens Google and returns an error is worse than one that is not there. To
  turn it on: set the two secrets in `supabase/.env`, flip `enabled` in
  `[auth.external.google]`, set the env var.

Local emails land in Mailpit at http://127.0.0.1:54324, from
`supabase/templates/magic_link.html`.

**Hosted sends rarely.** Supabase rejects custom email templates on a free-tier
project using the built-in sender, and that sender allows roughly two emails an
hour. That now only affects password resets rather than every sign-in, but
configuring custom SMTP (Resend, Postmark, SES) still fixes both at once.

Push auth settings to the hosted project with `./scripts/push-config.sh --project-ref <ref>`, which strips the template block the free tier rejects. Once SMTP is configured, delete that stripping and use `supabase config push` directly.
