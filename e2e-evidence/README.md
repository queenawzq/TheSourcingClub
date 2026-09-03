# End-to-end evidence

Recorded 2026-09-03T10:39:38.742Z against `http://127.0.0.1:5173/app.html`.

**35 steps, 25 assertions, 0 failed.**

A real browser, driven by Stagehand, against a real database. No mock data
anywhere: every value below was typed into the interface and then read back
out of Postgres to confirm the screen and the database agree.

## Walkthrough

| # | Step | What it shows | Screenshot |
|---|---|---|---|
| 1 | Factory sign-in | cold start, no session | [01-factory-sign-in.png](01-factory-sign-in.png) |
| 2 | Factory code requested | e2e-factory-1788431951983@example.com | [02-factory-code-requested.png](02-factory-code-requested.png) |
| 3 | Factory signed in | code 367653 accepted — no password anywhere | [03-factory-signed-in.png](03-factory-signed-in.png) |
| 4 | Factory organisation | factory: Atelier E2E 1788431951983 | [04-factory-organisation.png](04-factory-organisation.png) |
| 5 | Factory basics | country is stored as an ISO code, which is what matching compares | [05-factory-basics.png](05-factory-basics.png) |
| 6 | Factory company details |  | [06-factory-company-details.png](06-factory-company-details.png) |
| 7 | Factory what you make | from taxonomy_terms: Cut & sew knits, Tops, Bottoms | [07-factory-what-you-make.png](07-factory-what-you-make.png) |
| 8 | Factory services and equipment | equipment is free text on purpose | [08-factory-services-and-equipment.png](08-factory-services-and-equipment.png) |
| 9 | Factory capacity | 2,400 sweater hours shows 3429 pieces | [09-factory-capacity.png](09-factory-capacity.png) |
| 10 | Factory verification | registration is private; unverified certs do not count towards matching | [10-factory-verification.png](10-factory-verification.png) |
| 11 | Factory showcase |  | [11-factory-showcase.png](11-factory-showcase.png) |
| 12 | Factory review | checklist computed from the data, never stored | [12-factory-review.png](12-factory-review.png) |
| 13 | Factory terms | signature is recorded against a terms version, and cannot be edited later | [13-factory-terms.png](13-factory-terms.png) |
| 14 | Factory published | live and findable, but not yet verified | [14-factory-published.png](14-factory-published.png) |
| 15 | Brand sign-in | cold start, no session | [15-brand-sign-in.png](15-brand-sign-in.png) |
| 16 | Brand code requested | e2e-brand-1788431951983@example.com | [16-brand-code-requested.png](16-brand-code-requested.png) |
| 17 | Brand signed in | code 389095 accepted — no password anywhere | [17-brand-signed-in.png](17-brand-signed-in.png) |
| 18 | Brand organisation | brand: Maison E2E 1788431951983 | [18-brand-organisation.png](18-brand-organisation.png) |
| 19 | Brand basics |  | [19-brand-basics.png](19-brand-basics.png) |
| 20 | Brand about | logo and product imagery upload here, to the public bucket | [20-brand-about.png](20-brand-about.png) |
| 21 | Brand what you make | same vocabulary the factory picked from: Cut & sew knits | [21-brand-what-you-make.png](21-brand-what-you-make.png) |
| 22 | Brand sourcing plan | dollars on screen, minor units in the database | [22-brand-sourcing-plan.png](22-brand-sourcing-plan.png) |
| 23 | Brand preferences |  | [23-brand-preferences.png](23-brand-preferences.png) |
| 24 | Brand trust | team invitations and the private registration upload | [24-brand-trust.png](24-brand-trust.png) |
| 25 | Brand review |  | [25-brand-review.png](25-brand-review.png) |
| 26 | Brand complete | both sides onboarded against one schema | [26-brand-complete.png](26-brand-complete.png) |
| 27 | Brand dashboard | matches the new factory at 77% — good | [27-brand-dashboard.png](27-brand-dashboard.png) |
| 28 | Brand requests | empty until the first one is written | [28-brand-requests.png](28-brand-requests.png) |
| 29 | RFQ describe | category: Tops | [29-rfq-describe.png](29-rfq-describe.png) |
| 30 | RFQ specifics | sourcing responsibility is stored — full package and CMT are not comparable prices | [30-rfq-specifics.png](30-rfq-specifics.png) |
| 31 | RFQ timeline | delivery month drives the capacity factor in matching | [31-rfq-timeline.png](31-rfq-timeline.png) |
| 32 | RFQ questions | answers are shared with every factory quoting, unless marked private | [32-rfq-questions.png](32-rfq-questions.png) |
| 33 | RFQ review | visibility decides who can see it; verification decides who can bid | [33-rfq-review.png](33-rfq-review.png) |
| 34 | RFQ published |  | [34-rfq-published.png](34-rfq-published.png) |
| 35 | Session survives reload | onboarding not shown again | [35-session-survives-reload.png](35-session-survives-reload.png) |

## Assertions

- ✅ the sweater reference style is 42 min/piece, not 18
- ✅ capacity is 3,429 pieces, not the 8,000 the prototype's 18 min/pc would give
- ✅ working shown to the factory cites 42 min/pc: "2,400 hours × 60 ÷ 42 min per Basic crewneck sweater"
- ✅ country persisted as ISO PT, not the display label
- ✅ MOQ persisted as a number
- ✅ profile published, so brands can find it
- ✅ publishing did not self-verify — quoting stays gated on an admin review
- ✅ equipment free text kept verbatim
- ✅ the database computes the same 3,429 the screen showed (got 3429)
- ✅ taxonomy selections saved as 6 links, not free text
- ✅ "$18" stored as 1800 minor units (got 1800)
- ✅ brand onboarding marked complete
- ✅ match score computed between the two orgs just created: 77% (good)
- ✅ a draft is created on entry and its id is in the url
- ✅ the request is open and accepting quotes
- ✅ published to every factory, per the choice on screen
- ✅ quantity persisted as a number
- ✅ "$18" stored as 1800 minor units (got 1800)
- ✅ who buys the materials is recorded, so quotes are comparable
- ✅ requirements saved as 2 taxonomy links, not free text
- ✅ a delivery month is set, so capacity counts toward matching
- ✅ the question was saved against the request
- ✅ the colour breakdown is rows, not a display string
- ✅ the factory scores 67% against this specific request
- ✅ both signatures recorded (2)

## The one worth reading twice

The capacity step enters **2,400 line hours** against a sweater reference style
and asserts the screen shows **3,429 pieces** — then asserts Postgres computes
3,429 from the same inputs.

The prototypes' dashboard assumes 18 minutes per piece for every category. A
sweater is really 42, so that copy would show **8,000** — about 2.3x the true
figure, on the number a brand uses to decide whether a factory can take their
order. The conversion now exists once in SQL and once in JS, deliberately
mirrored, and both are pinned by this test.
