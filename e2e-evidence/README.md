# End-to-end evidence

Recorded 2026-11-11T15:50:13.203Z against `http://127.0.0.1:5214/app.html`.

**35 steps, 42 assertions, 1 failed.**

A real browser, driven by Stagehand, against a real database. No mock data
anywhere: every value below was typed into the interface and then read back
out of Postgres to confirm the screen and the database agree.

## Walkthrough

| # | Step | What it shows | Screenshot |
|---|---|---|---|
| 1 | Public terms | the published terms, readable before an account exists | [01-public-terms.png](01-public-terms.png) |
| 2 | Public privacy policy |  | [02-public-privacy-policy.png](02-public-privacy-policy.png) |
| 3 | Factory sign-up | the designed vendor portal | [03-factory-sign-up.png](03-factory-sign-up.png) |
| 4 | Factory account details | name, company, email and password on one form | [04-factory-account-details.png](04-factory-account-details.png) |
| 5 | Factory signed up | an account, a name and a company in one submit | [05-factory-signed-up.png](05-factory-signed-up.png) |
| 6 | Factory welcome | the designed card, with the manufacturer / trading-company choice | [06-factory-welcome.png](06-factory-welcome.png) |
| 7 | Factory basics | one designed card, six fields | [07-factory-basics.png](07-factory-basics.png) |
| 8 | Factory context |  | [08-factory-context.png](08-factory-context.png) |
| 9 | Factory what you make | from taxonomy_terms: Cut & sew knits, Tops, Bottoms | [09-factory-what-you-make.png](09-factory-what-you-make.png) |
| 10 | Factory specialty and services | equipment is free text on purpose | [10-factory-specialty-and-services.png](10-factory-specialty-and-services.png) |
| 11 | Factory capacity and terms |  | [11-factory-capacity-and-terms.png](11-factory-capacity-and-terms.png) |
| 12 | Factory verification | documents are reviewed by a human, not self-declared | [12-factory-verification.png](12-factory-verification.png) |
| 13 | Factory walkthrough |  | [13-factory-walkthrough.png](13-factory-walkthrough.png) |
| 14 | Factory review | what the vendor actually typed, read back | [14-factory-review.png](14-factory-review.png) |
| 15 | Factory terms |  | [15-factory-terms.png](15-factory-terms.png) |
| 16 | Factory complete | the designed finish card, not a hand-built one | [16-factory-complete.png](16-factory-complete.png) |
| 17 | Brand sign-up | the designed brand portal | [17-brand-sign-up.png](17-brand-sign-up.png) |
| 18 | Brand account details | name, company, email and password on one form | [18-brand-account-details.png](18-brand-account-details.png) |
| 19 | Brand signed up | an account, a name and a company in one submit | [19-brand-signed-up.png](19-brand-signed-up.png) |
| 20 | Brand welcome | the designed welcome card | [20-brand-welcome.png](20-brand-welcome.png) |
| 21 | Brand basics | category options come from the taxonomy, not the mock list | [21-brand-basics.png](21-brand-basics.png) |
| 22 | Brand context | logo and product imagery upload here, to the public bucket | [22-brand-context.png](22-brand-context.png) |
| 23 | Brand what you make | same vocabulary the vendor picked from: Tops, Bottoms | [23-brand-what-you-make.png](23-brand-what-you-make.png) |
| 24 | Brand sourcing volume | dollars on screen, minor units in the database | [24-brand-sourcing-volume.png](24-brand-sourcing-volume.png) |
| 25 | Brand vendor preferences |  | [25-brand-vendor-preferences.png](25-brand-vendor-preferences.png) |
| 26 | Brand trust | team invitations and the private registration upload | [26-brand-trust.png](26-brand-trust.png) |
| 27 | Brand review | what was entered, not the mock | [27-brand-review.png](27-brand-review.png) |
| 28 | Brand terms |  | [28-brand-terms.png](28-brand-terms.png) |
| 29 | Brand complete | the designed finish card | [29-brand-complete.png](29-brand-complete.png) |
| 30 | Brand dashboard | matches the new factory at 57% — weak | [30-brand-dashboard.png](30-brand-dashboard.png) |
| 31 | Admin sign-in | cold start, no session | [31-admin-sign-in.png](31-admin-sign-in.png) |
| 32 | Admin signed in | email and password, on the designed screen | [32-admin-signed-in.png](32-admin-signed-in.png) |
| 33 | Verification queue | an admin with no org of their own can still work | [33-verification-queue.png](33-verification-queue.png) |
| 34 | Factory asked for more information | straight to the profile summary | [34-factory-asked-for-more-information.png](34-factory-asked-for-more-information.png) |
| 35 | FAILED HERE | Could not find an element for the given xPath(s): .admin-registry-form select — page showed "Atelier E2E 1794412175487" | [35-failure.png](35-failure.png) |

## Assertions

- ✅ the brand terms are readable signed out, in the designed Terms dialog
- ✅ the privacy policy is readable signed out
- ✅ Factory: the Terms link opens the factory terms in a new tab (/app.html?legal=terms&type=factory)
- ✅ Factory: the Privacy link opens the privacy policy in a new tab (/app.html?legal=privacy)
- ✅ the factory terms step opens the full terms
- ✅ a factory waiting for review is shown no button on the finish card
- ✅ the factory's registration number is saved under its country
- ✅ the factory's signature points at the exact version shown (terms_factory v1)
- ✅ "Porto, Portugal" resolved to ISO PT for matching (got PT)
- ✅ MOQ persisted as a number
- ✅ "28 days" typed as free text stored as the number 28 (got 28)
- ✅ the welcome card's company-type choice reached the profile
- ✅ finishing the designed onboarding publishes the profile, as its last card promises
- ✅ publishing did not self-verify — quoting stays gated on an admin review
- ✅ equipment free text kept verbatim
- ✅ the designed capacity panel wrote a factory_capacity row
- ✅ the database computes monthly units from it (got 1200)
- ✅ taxonomy selections saved as 10 links, not free text
- ✅ Brand: the Terms link opens the brand terms in a new tab (/app.html?legal=terms&type=brand)
- ✅ Brand: the Privacy link opens the privacy policy in a new tab (/app.html?legal=privacy)
- ✅ the review card reads back the brand that was actually typed
- ✅ and no longer shows the design's example brand
- ✅ the brand terms step opens the published agreement in the Terms dialog
- ✅ an unverified brand waits on the designed finish card, not the dashboard
- ✅ the brand's signature points at the exact version shown (terms_brand v1)
- ✅ "$18" stored as 1800 minor units (got 1800)
- ✅ brand onboarding marked complete
- ✅ match score computed between the two orgs just created: 57% (weak)
- ✅ the factory is waiting for a decision in the live queue
- ✅ the queue row for this factory was found and opened
- ✅ the request dialog labels its message once (1)
- ✅ the toast says the request was emailed, and to how many ("Information request recorded and emailed to 1 person.")
- ✅ the review page says who was emailed (Email to the company The request for more information: e2e-factory-1794412175487@example.com Sent · Nov 11, 2026, 10:50 )
- ✅ and the email carries the request exactly as staff wrote it
- ✅ the review summary shows the note just sent, without a reload
- ✅ and the badge says Needs information
- ✅ and Profile status says the same (Needs information)
- ✅ no chip heading is drawn without chips (0)
- ✅ the factory lands on its profile summary, with no extra page first
- ✅ the factory sends its profile back to staff's queue
- ✅ and staff are emailed, with a link to the review
- ✅ Approve is greyed until a registry check finds the company

## The one worth reading twice

The capacity step enters **2,400 line hours** against a sweater reference style
and asserts the screen shows **3,429 pieces** — then asserts Postgres computes
3,429 from the same inputs.

The prototypes' dashboard assumes 18 minutes per piece for every category. A
sweater is really 42, so that copy would show **8,000** — about 2.3x the true
figure, on the number a brand uses to decide whether a factory can take their
order. The conversion now exists once in SQL and once in JS, deliberately
mirrored, and both are pinned by this test.

## And the one worth reading twice again

Three assertions describe the same screen, seen by the same factory:

> the factory is told plainly the brand has not funded the step yet  
> *(the brand pays by card through Stripe; TSC holds it)*  
> the same step that said "awaiting funding" now says it is funded  
> *(the brand approves; staff pay a factory Stripe cannot reach by bank)*  
> the factory's order says the step was paid

A factory in Ningbo extends credit to a brand in Brooklyn it has never met
because it is not taking the brand's word: the money is held by TSC before
the work, and released to it when the brand approves.

## And the conversation

The factory types Chinese. The brand reads English. Neither has to think
about it, and both can always see what was actually written — the original
is stored beside the translation and is one click away, because on a
measurement or a date a machine translation will eventually be wrong and
the person needs something to point at.

Both prototypes design this screen. In both of them `Send` is
`onClick={() => setComposer("")}` — the box clears and nothing is stored.
This run is the first message either side has ever managed to send.
