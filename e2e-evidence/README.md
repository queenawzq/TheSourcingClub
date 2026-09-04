# End-to-end evidence

Recorded 2026-09-04T22:42:26.733Z against `http://127.0.0.1:5173/app.html`.

**62 steps, 50 assertions, 0 failed.**

A real browser, driven by Stagehand, against a real database. No mock data
anywhere: every value below was typed into the interface and then read back
out of Postgres to confirm the screen and the database agree.

## Walkthrough

| # | Step | What it shows | Screenshot |
|---|---|---|---|
| 1 | Factory sign-in | cold start, no session | [01-factory-sign-in.png](01-factory-sign-in.png) |
| 2 | Factory code requested | e2e-factory-1788561671845@example.com | [02-factory-code-requested.png](02-factory-code-requested.png) |
| 3 | Factory signed in | code 057005 accepted — no password anywhere | [03-factory-signed-in.png](03-factory-signed-in.png) |
| 4 | Factory organisation | factory: Atelier E2E 1788561671845 | [04-factory-organisation.png](04-factory-organisation.png) |
| 5 | Factory basics | country is stored as an ISO code, which is what matching compares | [05-factory-basics.png](05-factory-basics.png) |
| 6 | Factory company details |  | [06-factory-company-details.png](06-factory-company-details.png) |
| 7 | Factory what you make | from taxonomy_terms: Cut & sew knits, Tops, Bottoms | [07-factory-what-you-make.png](07-factory-what-you-make.png) |
| 8 | Factory services and equipment | equipment is free text on purpose | [08-factory-services-and-equipment.png](08-factory-services-and-equipment.png) |
| 9 | Factory capacity | 2,400 sweater hours shows 3429 pieces | [09-factory-capacity.png](09-factory-capacity.png) |
| 10 | Factory verification | registration goes to the private bucket and enters the review queue | [10-factory-verification.png](10-factory-verification.png) |
| 11 | Factory showcase |  | [11-factory-showcase.png](11-factory-showcase.png) |
| 12 | Factory review | checklist computed from the data, never stored | [12-factory-review.png](12-factory-review.png) |
| 13 | Factory terms | signature is recorded against a terms version, and cannot be edited later | [13-factory-terms.png](13-factory-terms.png) |
| 14 | Factory published | live and findable, but not yet verified | [14-factory-published.png](14-factory-published.png) |
| 15 | Brand sign-in | cold start, no session | [15-brand-sign-in.png](15-brand-sign-in.png) |
| 16 | Brand code requested | e2e-brand-1788561671845@example.com | [16-brand-code-requested.png](16-brand-code-requested.png) |
| 17 | Brand signed in | code 463993 accepted — no password anywhere | [17-brand-signed-in.png](17-brand-signed-in.png) |
| 18 | Brand organisation | brand: Maison E2E 1788561671845 | [18-brand-organisation.png](18-brand-organisation.png) |
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
| 35 | Factory again sign-in | cold start, no session | [35-factory-again-sign-in.png](35-factory-again-sign-in.png) |
| 36 | Factory again code requested | e2e-factory-1788561671845@example.com | [36-factory-again-code-requested.png](36-factory-again-code-requested.png) |
| 37 | Factory again signed in | code 150473 accepted — no password anywhere | [37-factory-again-signed-in.png](37-factory-again-signed-in.png) |
| 38 | Factory dashboard | still unverified, so it may look but not bid | [38-factory-dashboard.png](38-factory-dashboard.png) |
| 39 | Factory browse | the brand's request, found by a factory that was never invited | [39-factory-browse.png](39-factory-browse.png) |
| 40 | Factory reads the request | every field traces to a stored column, none of it is copy | [40-factory-reads-the-request.png](40-factory-reads-the-request.png) |
| 41 | Admin sign-in | cold start, no session | [41-admin-sign-in.png](41-admin-sign-in.png) |
| 42 | Admin code requested | e2e-admin-1788561671845@example.com | [42-admin-code-requested.png](42-admin-code-requested.png) |
| 43 | Admin signed in | code 521889 accepted — no password anywhere | [43-admin-signed-in.png](43-admin-signed-in.png) |
| 44 | Verification queue | an admin with no org of their own can still work | [44-verification-queue.png](44-verification-queue.png) |
| 45 | Factory approved | approving the registration verifies the org, which unlocks quoting | [45-factory-approved.png](45-factory-approved.png) |
| 46 | Factory quoting sign-in | cold start, no session | [46-factory-quoting-sign-in.png](46-factory-quoting-sign-in.png) |
| 47 | Factory quoting code requested | e2e-factory-1788561671845@example.com | [47-factory-quoting-code-requested.png](47-factory-quoting-code-requested.png) |
| 48 | Factory quoting signed in | code 932396 accepted — no password anywhere | [48-factory-quoting-signed-in.png](48-factory-quoting-signed-in.png) |
| 49 | Factory can now bid | the verification notice is gone and the quote button is live | [49-factory-can-now-bid.png](49-factory-can-now-bid.png) |
| 50 | Factory quote | production + samples = $5,390.00, computed not typed | [50-factory-quote.png](50-factory-quote.png) |
| 51 | Quote sent | and the factory is promised an answer either way | [51-quote-sent.png](51-quote-sent.png) |
| 52 | Brand deciding sign-in | cold start, no session | [52-brand-deciding-sign-in.png](52-brand-deciding-sign-in.png) |
| 53 | Brand deciding code requested | e2e-brand-1788561671845@example.com | [53-brand-deciding-code-requested.png](53-brand-deciding-code-requested.png) |
| 54 | Brand deciding signed in | code 638414 accepted — no password anywhere | [54-brand-deciding-signed-in.png](54-brand-deciding-signed-in.png) |
| 55 | Quote comparison | two quotes side by side, every figure derived from stored columns | [55-quote-comparison.png](55-quote-comparison.png) |
| 56 | Confirm award | it says plainly that the others will be told | [56-confirm-award.png](56-confirm-award.png) |
| 57 | Awarded | the loop closes here | [57-awarded.png](57-awarded.png) |
| 58 | Invite-only chosen | publishing this without inviting anyone used to strand it | [58-invite-only-chosen.png](58-invite-only-chosen.png) |
| 59 | Choose who sees it | ranked by fit against this request, same score the factory sees | [59-choose-who-sees-it.png](59-choose-who-sees-it.png) |
| 60 | Invitations saved |  | [60-invitations-saved.png](60-invitations-saved.png) |
| 61 | Deep link survives a hard refresh | the rewrite works, in dev and in production | [61-deep-link-survives-a-hard-refresh.png](61-deep-link-survives-a-hard-refresh.png) |
| 62 | Session survives reload | onboarding not shown again | [62-session-survives-reload.png](62-session-survives-reload.png) |

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
- ✅ signing back in skips onboarding and lands on the dashboard
- ✅ the request a brand published minutes ago is visible to a factory
- ✅ each request is scored against what this factory actually makes
- ✅ the brand is named, not anonymous — nobody quotes a stranger
- ✅ an unverified factory is told it can look but not bid
- ✅ the quantity the brand typed is what the factory reads
- ✅ the brand's question reaches the factory
- ✅ no brand contact details leak into the factory's view
- ✅ the quote button is present but refused — the gate is explained, not hidden
- ✅ the factory's registration is waiting for a decision
- ✅ the queue row for this factory was found and approved
- ✅ the factory is now verified in the database
- ✅ the total is worked out from the lines: 300 x $17.10 + $260 = $5,390.00
- ✅ both quotes are shown for comparison (2 columns)
- ✅ the comparison shows the same total the factory saw, not a re-parsed string
- ✅ MOQ is absent — the design system forbids it as a comparison metric
- ✅ the quoting factory has a column (position 2)
- ✅ the confirmation names the factory being awarded
- ✅ the chosen quote is accepted
- ✅ the other quote was auto-declined in the same transaction
- ✅ the request is closed
- ✅ both factories were notified (2) — nobody quotes into silence
- ✅ the request is invite-only
- ✅ one factory was invited (1)
- ✅ both signatures recorded (2)
- ✅ 0 draft request(s) exist and never appeared in browse

## The one worth reading twice

The capacity step enters **2,400 line hours** against a sweater reference style
and asserts the screen shows **3,429 pieces** — then asserts Postgres computes
3,429 from the same inputs.

The prototypes' dashboard assumes 18 minutes per piece for every category. A
sweater is really 42, so that copy would show **8,000** — about 2.3x the true
figure, on the number a brand uses to decide whether a factory can take their
order. The conversion now exists once in SQL and once in JS, deliberately
mirrored, and both are pinned by this test.
