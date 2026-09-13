# End-to-end evidence

Recorded 2026-09-13T15:24:27.978Z against `http://127.0.0.1:5173/app.html`.

**17 steps, 11 assertions, 1 failed.**

A real browser, driven by Stagehand, against a real database. No mock data
anywhere: every value below was typed into the interface and then read back
out of Postgres to confirm the screen and the database agree.

## Walkthrough

| # | Step | What it shows | Screenshot |
|---|---|---|---|
| 1 | Factory sign-up | the designed vendor portal | [01-factory-sign-up.png](01-factory-sign-up.png) |
| 2 | Factory account details | name, company, email and password on one form | [02-factory-account-details.png](02-factory-account-details.png) |
| 3 | Factory signed up | an account, a name and a company in one submit | [03-factory-signed-up.png](03-factory-signed-up.png) |
| 4 | Factory basics | country is stored as an ISO code, which is what matching compares | [04-factory-basics.png](04-factory-basics.png) |
| 5 | Factory company details |  | [05-factory-company-details.png](05-factory-company-details.png) |
| 6 | Factory what you make | from taxonomy_terms: Cut & sew knits, Tops, Bottoms | [06-factory-what-you-make.png](06-factory-what-you-make.png) |
| 7 | Factory services and equipment | equipment is free text on purpose | [07-factory-services-and-equipment.png](07-factory-services-and-equipment.png) |
| 8 | Factory capacity | 2,400 sweater hours shows 3429 pieces | [08-factory-capacity.png](08-factory-capacity.png) |
| 9 | Factory verification | registration goes to the private bucket and enters the review queue | [09-factory-verification.png](09-factory-verification.png) |
| 10 | Factory showcase |  | [10-factory-showcase.png](10-factory-showcase.png) |
| 11 | Factory review | checklist computed from the data, never stored | [11-factory-review.png](11-factory-review.png) |
| 12 | Factory terms | signature is recorded against a terms version, and cannot be edited later | [12-factory-terms.png](12-factory-terms.png) |
| 13 | Factory published | live and findable, but not yet verified | [13-factory-published.png](13-factory-published.png) |
| 14 | Brand sign-up | the designed brand portal | [14-brand-sign-up.png](14-brand-sign-up.png) |
| 15 | Brand account details | name, company, email and password on one form | [15-brand-account-details.png](15-brand-account-details.png) |
| 16 | Brand signed up | an account, a name and a company in one submit | [16-brand-signed-up.png](16-brand-signed-up.png) |
| 17 | FAILED HERE | timed out waiting for heading "brand basics" — page showed "Welcome to The Sourcing Club" | [17-failure.png](17-failure.png) |

## Assertions

- ✅ the sweater reference style is 42 min/piece, not 18
- ✅ capacity is 3,429 pieces, not the 8,000 the prototype's 18 min/pc would give
- ✅ working shown to the factory cites 42 min/pc: "2,400 hours × 60 ÷ 42 min per Basic crewneck sweater"
- ✅ the registration is stored and waiting for review, not merely selected
- ✅ country persisted as ISO PT, not the display label
- ✅ MOQ persisted as a number
- ✅ profile published, so brands can find it
- ✅ publishing did not self-verify — quoting stays gated on an admin review
- ✅ equipment free text kept verbatim
- ✅ the database computes the same 3,429 the screen showed (got 3429)
- ✅ taxonomy selections saved as 6 links, not free text

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

Four assertions describe the same screen, seen by the same factory, four
minutes apart:

> nothing tells the factory to start on the strength of the brand's word  
> the next step is still shut while the payment is only claimed  
> *(an admin confirms the money arrived)*  
> the next step opened on the confirmation, without waiting for funds to be released  
> the same screen that refused two steps ago now says the work may start

Nothing changed in between but one click by a member of staff. That click is
the entire reason a factory in Ningbo would extend credit to a brand in
Brooklyn it has never met: it is not taking the brand's word, and it is not
taking ours either — it is reading a stamp written by a third party who
checked the account. Remove the admin step and the platform is a notepad.

## And the conversation

The factory types Chinese. The brand reads English. Neither has to think
about it, and both can always see what was actually written — the original
is stored beside the translation and is one click away, because on a
measurement or a date a machine translation will eventually be wrong and
the person needs something to point at.

Both prototypes design this screen. In both of them `Send` is
`onClick={() => setComposer("")}` — the box clears and nothing is stored.
This run is the first message either side has ever managed to send.
