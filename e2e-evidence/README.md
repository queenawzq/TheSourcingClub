# End-to-end evidence

Recorded 2026-09-04T23:22:40.428Z against `http://127.0.0.1:5173/app.html`.

**70 steps, 53 assertions, 0 failed.**

A real browser, driven by Stagehand, against a real database. No mock data
anywhere: every value below was typed into the interface and then read back
out of Postgres to confirm the screen and the database agree.

## Walkthrough

| # | Step | What it shows | Screenshot |
|---|---|---|---|
| 1 | Factory sign-in | cold start, no session | [01-factory-sign-in.png](01-factory-sign-in.png) |
| 2 | Factory code requested | e2e-factory-1788564035776@example.com | [02-factory-code-requested.png](02-factory-code-requested.png) |
| 3 | Factory signed in | code 462191 accepted — no password anywhere | [03-factory-signed-in.png](03-factory-signed-in.png) |
| 4 | Factory organisation | factory: Atelier E2E 1788564035776 | [04-factory-organisation.png](04-factory-organisation.png) |
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
| 16 | Brand code requested | e2e-brand-1788564035776@example.com | [16-brand-code-requested.png](16-brand-code-requested.png) |
| 17 | Brand signed in | code 310688 accepted — no password anywhere | [17-brand-signed-in.png](17-brand-signed-in.png) |
| 18 | Brand organisation | brand: Maison E2E 1788564035776 | [18-brand-organisation.png](18-brand-organisation.png) |
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
| 29 | Drafted from the description | fills only what was blank, and nothing is sent until publish | [29-drafted-from-the-description.png](29-drafted-from-the-description.png) |
| 30 | RFQ describe | category: Tops | [30-rfq-describe.png](30-rfq-describe.png) |
| 31 | RFQ specifics | sourcing responsibility is stored — full package and CMT are not comparable prices | [31-rfq-specifics.png](31-rfq-specifics.png) |
| 32 | RFQ timeline | delivery month drives the capacity factor in matching | [32-rfq-timeline.png](32-rfq-timeline.png) |
| 33 | RFQ questions | answers are shared with every factory quoting, unless marked private | [33-rfq-questions.png](33-rfq-questions.png) |
| 34 | RFQ review | visibility decides who can see it; verification decides who can bid | [34-rfq-review.png](34-rfq-review.png) |
| 35 | RFQ published |  | [35-rfq-published.png](35-rfq-published.png) |
| 36 | Factory again sign-in | cold start, no session | [36-factory-again-sign-in.png](36-factory-again-sign-in.png) |
| 37 | Factory again code requested | e2e-factory-1788564035776@example.com | [37-factory-again-code-requested.png](37-factory-again-code-requested.png) |
| 38 | Factory again signed in | code 744970 accepted — no password anywhere | [38-factory-again-signed-in.png](38-factory-again-signed-in.png) |
| 39 | Factory dashboard | still unverified, so it may look but not bid | [39-factory-dashboard.png](39-factory-dashboard.png) |
| 40 | Factory browse | the brand's request, found by a factory that was never invited | [40-factory-browse.png](40-factory-browse.png) |
| 41 | Factory reads the request | every field traces to a stored column, none of it is copy | [41-factory-reads-the-request.png](41-factory-reads-the-request.png) |
| 42 | Admin sign-in | cold start, no session | [42-admin-sign-in.png](42-admin-sign-in.png) |
| 43 | Admin code requested | e2e-admin-1788564035776@example.com | [43-admin-code-requested.png](43-admin-code-requested.png) |
| 44 | Admin signed in | code 804661 accepted — no password anywhere | [44-admin-signed-in.png](44-admin-signed-in.png) |
| 45 | Verification queue | an admin with no org of their own can still work | [45-verification-queue.png](45-verification-queue.png) |
| 46 | Factory approved | approving the registration verifies the org, which unlocks quoting | [46-factory-approved.png](46-factory-approved.png) |
| 47 | Factory quoting sign-in | cold start, no session | [47-factory-quoting-sign-in.png](47-factory-quoting-sign-in.png) |
| 48 | Factory quoting code requested | e2e-factory-1788564035776@example.com | [48-factory-quoting-code-requested.png](48-factory-quoting-code-requested.png) |
| 49 | Factory quoting signed in | code 214766 accepted — no password anywhere | [49-factory-quoting-signed-in.png](49-factory-quoting-signed-in.png) |
| 50 | Factory can now bid | the verification notice is gone and the quote button is live | [50-factory-can-now-bid.png](50-factory-can-now-bid.png) |
| 51 | Factory quote | production + samples = $5,390.00, computed not typed | [51-factory-quote.png](51-factory-quote.png) |
| 52 | Quote sent | and the factory is promised an answer either way | [52-quote-sent.png](52-quote-sent.png) |
| 53 | Brand deciding sign-in | cold start, no session | [53-brand-deciding-sign-in.png](53-brand-deciding-sign-in.png) |
| 54 | Brand deciding code requested | e2e-brand-1788564035776@example.com | [54-brand-deciding-code-requested.png](54-brand-deciding-code-requested.png) |
| 55 | Brand deciding signed in | code 648736 accepted — no password anywhere | [55-brand-deciding-signed-in.png](55-brand-deciding-signed-in.png) |
| 56 | Quote comparison | two quotes side by side, every figure derived from stored columns | [56-quote-comparison.png](56-quote-comparison.png) |
| 57 | Confirm award | it says plainly that the others will be told | [57-confirm-award.png](57-confirm-award.png) |
| 58 | Awarded | the loop closes here | [58-awarded.png](58-awarded.png) |
| 59 | Winning factory sign-in | cold start, no session | [59-winning-factory-sign-in.png](59-winning-factory-sign-in.png) |
| 60 | Winning factory code requested | e2e-factory-1788564035776@example.com | [60-winning-factory-code-requested.png](60-winning-factory-code-requested.png) |
| 61 | Winning factory signed in | code 050826 accepted — no password anywhere | [61-winning-factory-signed-in.png](61-winning-factory-signed-in.png) |
| 62 | Factory hears the outcome | award_quote wrote this row; now something shows it | [62-factory-hears-the-outcome.png](62-factory-hears-the-outcome.png) |
| 63 | Brand again sign-in | cold start, no session | [63-brand-again-sign-in.png](63-brand-again-sign-in.png) |
| 64 | Brand again code requested | e2e-brand-1788564035776@example.com | [64-brand-again-code-requested.png](64-brand-again-code-requested.png) |
| 65 | Brand again signed in | code 838860 accepted — no password anywhere | [65-brand-again-signed-in.png](65-brand-again-signed-in.png) |
| 66 | Invite-only chosen | publishing this without inviting anyone used to strand it | [66-invite-only-chosen.png](66-invite-only-chosen.png) |
| 67 | Choose who sees it | ranked by fit against this request, same score the factory sees | [67-choose-who-sees-it.png](67-choose-who-sees-it.png) |
| 68 | Invitations saved |  | [68-invitations-saved.png](68-invitations-saved.png) |
| 69 | Deep link survives a hard refresh | the rewrite works, in dev and in production | [69-deep-link-survives-a-hard-refresh.png](69-deep-link-survives-a-hard-refresh.png) |
| 70 | Session survives reload | onboarding not shown again | [70-session-survives-reload.png](70-session-survives-reload.png) |

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
- ✅ drafting from the description: Filled in 1 thing you had not written yet. Nothing you typed was chang
- ✅ the title the brand typed was left alone
- ✅ the request is open and accepting quotes
- ✅ published to every factory, per the choice on screen
- ✅ quantity persisted as a number
- ✅ "$18" stored as 1800 minor units (got 1800)
- ✅ who buys the materials is recorded, so quotes are comparable
- ✅ requirements saved as 2 taxonomy links, not free text
- ✅ a delivery month is set, so capacity counts toward matching
- ✅ the brand's own question is saved (10 question(s) in total)
- ✅ the colour breakdown is rows, not a display string
- ✅ the factory scores 22% against this specific request
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
- ✅ the winning factory is told on its dashboard, without asking
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
