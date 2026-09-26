# End-to-end evidence

Recorded 2026-09-26T21:00:37.795Z against `http://127.0.0.1:5173/app.html`.

**116 steps, 163 assertions, 0 failed.**

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
| 34 | Factory approved | approving the company verifies it, which unlocks quoting | [34-factory-approved.png](34-factory-approved.png) |
| 35 | Brand approved | both sides verified before either can trade | [35-brand-approved.png](35-brand-approved.png) |
| 36 | Operations workspace | the designed admin console, on marketplace data | [36-operations-workspace.png](36-operations-workspace.png) |
| 37 | Marketplace quotes | every quote across the marketplace, staff only | [37-marketplace-quotes.png](37-marketplace-quotes.png) |
| 38 | Brand returning sign-in | cold start, no session | [38-brand-returning-sign-in.png](38-brand-returning-sign-in.png) |
| 39 | Brand returning signed in | email and password, on the designed screen | [39-brand-returning-signed-in.png](39-brand-returning-signed-in.png) |
| 40 | Brand requests | the designed screen, empty until the first one is written | [40-brand-requests.png](40-brand-requests.png) |
| 41 | Describe what you need | Queena's first flow card, on her chrome | [41-describe-what-you-need.png](41-describe-what-you-need.png) |
| 42 | Review the brief | read back and correctable — Skip AI leaves it empty to fill | [42-review-the-brief.png](42-review-the-brief.png) |
| 43 | The brief, corrected | every field is the brand's, not the model's | [43-the-brief-corrected.png](43-the-brief-corrected.png) |
| 44 | Choose who sees it | the design's own toggle decides open or invite-only | [44-choose-who-sees-it.png](44-choose-who-sees-it.png) |
| 45 | RFQ published |  | [45-rfq-published.png](45-rfq-published.png) |
| 46 | Factory again sign-in | cold start, no session | [46-factory-again-sign-in.png](46-factory-again-sign-in.png) |
| 47 | Factory again signed in | email and password, on the designed screen | [47-factory-again-signed-in.png](47-factory-again-signed-in.png) |
| 48 | Factory dashboard | still unverified, so it may look but not bid | [48-factory-dashboard.png](48-factory-dashboard.png) |
| 49 | Factory browse | the brand's request, found by a factory that was never invited | [49-factory-browse.png](49-factory-browse.png) |
| 50 | Factory reads the request | every field traces to a stored column, none of it is copy | [50-factory-reads-the-request.png](50-factory-reads-the-request.png) |
| 51 | Factory quoting sign-in | cold start, no session | [51-factory-quoting-sign-in.png](51-factory-quoting-sign-in.png) |
| 52 | Factory quoting signed in | email and password, on the designed screen | [52-factory-quoting-signed-in.png](52-factory-quoting-signed-in.png) |
| 53 | Factory can now bid | the verification notice is gone and the quote button is live | [53-factory-can-now-bid.png](53-factory-can-now-bid.png) |
| 54 | The quote | Queena's submit screen, on a real draft row | [54-the-quote.png](54-the-quote.png) |
| 55 | Factory quote | prose on screen, taxonomy ids and rows underneath | [55-factory-quote.png](55-factory-quote.png) |
| 56 | Quote sent | and the factory is promised an answer either way | [56-quote-sent.png](56-quote-sent.png) |
| 57 | Brand deciding sign-in | cold start, no session | [57-brand-deciding-sign-in.png](57-brand-deciding-sign-in.png) |
| 58 | Brand deciding signed in | email and password, on the designed screen | [58-brand-deciding-signed-in.png](58-brand-deciding-signed-in.png) |
| 59 | Quotes received | Queena's quote list, every figure derived from stored columns | [59-quotes-received.png](59-quotes-received.png) |
| 60 | Awarded | the loop closes here | [60-awarded.png](60-awarded.png) |
| 61 | Production orders | the brand's side of the work it just commissioned | [61-production-orders.png](61-production-orders.png) |
| 62 | The order | before either side agrees, the schedule is the whole screen | [62-the-order.png](62-the-order.png) |
| 63 | The schedule | drafted from the quote; either side may change it | [63-the-schedule.png](63-the-schedule.png) |
| 64 | Brand agrees | one signature. The order has not started | [64-brand-agrees.png](64-brand-agrees.png) |
| 65 | Winning factory sign-in | cold start, no session | [65-winning-factory-sign-in.png](65-winning-factory-sign-in.png) |
| 66 | Winning factory signed in | email and password, on the designed screen | [66-winning-factory-signed-in.png](66-winning-factory-signed-in.png) |
| 67 | Factory hears the outcome | award_quote wrote this row; now something shows it | [67-factory-hears-the-outcome.png](67-factory-hears-the-outcome.png) |
| 68 | Factory sees the schedule | the same steps the brand read, nothing actionable yet | [68-factory-sees-the-schedule.png](68-factory-sees-the-schedule.png) |
| 69 | Both agreed | the order is running | [69-both-agreed.png](69-both-agreed.png) |
| 70 | The order, active | the designed header, on production_order_summary | [70-the-order-active.png](70-the-order-active.png) |
| 71 | Posting an update | a note and photographs, which is the factory's only lever here | [71-posting-an-update.png](71-posting-an-update.png) |
| 72 | Sent for approval | the brand decides; the factory does not mark its own work done | [72-sent-for-approval.png](72-sent-for-approval.png) |
| 73 | Where the factory gets paid | no full account number is asked for, or stored | [73-where-the-factory-gets-paid.png](73-where-the-factory-gets-paid.png) |
| 74 | Brand approving sign-in | cold start, no session | [74-brand-approving-sign-in.png](74-brand-approving-sign-in.png) |
| 75 | Brand approving signed in | email and password, on the designed screen | [75-brand-approving-signed-in.png](75-brand-approving-signed-in.png) |
| 76 | Waiting on the brand | the factory has sent a step for approval | [76-waiting-on-the-brand.png](76-waiting-on-the-brand.png) |
| 77 | The brand reads the update | posted by the factory, readable by the brand, nobody else | [77-the-brand-reads-the-update.png](77-the-brand-reads-the-update.png) |
| 78 | Approved | from the row, on the state that row is actually in | [78-approved.png](78-approved.png) |
| 79 | How to pay | amount, destination, and the reference an admin will match | [79-how-to-pay.png](79-how-to-pay.png) |
| 80 | Marked sent | the brand's claim — not yet an arrival | [80-marked-sent.png](80-marked-sent.png) |
| 81 | Factory waiting sign-in | cold start, no session | [81-factory-waiting-sign-in.png](81-factory-waiting-sign-in.png) |
| 82 | Factory waiting signed in | email and password, on the designed screen | [82-factory-waiting-signed-in.png](82-factory-waiting-signed-in.png) |
| 83 | The factory waits | the brand says it paid. That is not enough, and the screen says so | [83-the-factory-waits.png](83-the-factory-waits.png) |
| 84 | Admin confirming sign-in | cold start, no session | [84-admin-confirming-sign-in.png](84-admin-confirming-sign-in.png) |
| 85 | Admin confirming signed in | email and password, on the designed screen | [85-admin-confirming-signed-in.png](85-admin-confirming-signed-in.png) |
| 86 | The payment queue | a required step, not a convenience: staff have no org to notify | [86-the-payment-queue.png](86-the-payment-queue.png) |
| 87 | Confirmed | this click is what a factory on the other side of the world is relying on | [87-confirmed.png](87-confirmed.png) |
| 88 | Factory told to start sign-in | cold start, no session | [88-factory-told-to-start-sign-in.png](88-factory-told-to-start-sign-in.png) |
| 89 | Factory told to start signed in | email and password, on the designed screen | [89-factory-told-to-start-signed-in.png](89-factory-told-to-start-signed-in.png) |
| 90 | Cleared to work | nothing changed but an admin confirming the money arrived | [90-cleared-to-work.png](90-cleared-to-work.png) |
| 91 | The conversation | kept with the order, so it is there when someone asks what was agreed | [91-the-conversation.png](91-the-conversation.png) |
| 92 | The factory writes in Chinese | and does not have to think about who reads it | [92-the-factory-writes-in-chinese.png](92-the-factory-writes-in-chinese.png) |
| 93 | Brand reading sign-in | cold start, no session | [93-brand-reading-sign-in.png](93-brand-reading-sign-in.png) |
| 94 | Brand reading signed in | email and password, on the designed screen | [94-brand-reading-signed-in.png](94-brand-reading-signed-in.png) |
| 95 | Conversations | one per piece of work, not one per company | [95-conversations.png](95-conversations.png) |
| 96 | The brand reads it | in its own language, with the original one click away | [96-the-brand-reads-it.png](96-the-brand-reads-it.png) |
| 97 | A reply | the first conversation either prototype could not actually have | [97-a-reply.png](97-a-reply.png) |
| 98 | Brand again sign-in | cold start, no session | [98-brand-again-sign-in.png](98-brand-again-sign-in.png) |
| 99 | Brand again signed in | email and password, on the designed screen | [99-brand-again-signed-in.png](99-brand-again-signed-in.png) |
| 100 | Invite-only chosen | publishing this without inviting anyone used to strand it | [100-invite-only-chosen.png](100-invite-only-chosen.png) |
| 101 | Choose who sees it | ranked by fit against this request, same score the factory sees | [101-choose-who-sees-it.png](101-choose-who-sees-it.png) |
| 102 | Invitations saved |  | [102-invitations-saved.png](102-invitations-saved.png) |
| 103 | Brand at home sign-in | cold start, no session | [103-brand-at-home-sign-in.png](103-brand-at-home-sign-in.png) |
| 104 | Brand at home signed in | email and password, on the designed screen | [104-brand-at-home-signed-in.png](104-brand-at-home-signed-in.png) |
| 105 | Brand home | what needs you, before anything else | [105-brand-home.png](105-brand-home.png) |
| 106 | The team | who else acts as this brand | [106-the-team.png](106-the-team.png) |
| 107 | Invited | they see it the next time they sign in | [107-invited.png](107-invited.png) |
| 108 | Colleague sign-in | cold start, no session | [108-colleague-sign-in.png](108-colleague-sign-in.png) |
| 109 | Colleague signed in | email and password, on the designed screen | [109-colleague-signed-in.png](109-colleague-signed-in.png) |
| 110 | You have been invited | the invitation was in the database from the start; nothing ever showed it | [110-you-have-been-invited.png](110-you-have-been-invited.png) |
| 111 | Joined | straight into the brand they were invited to, with no onboarding to redo | [111-joined.png](111-joined.png) |
| 112 | When it breaks | the reference on screen is the one in the database | [112-when-it-breaks.png](112-when-it-breaks.png) |
| 113 | Deep link survives a hard refresh | the rewrite works, in dev and in production | [113-deep-link-survives-a-hard-refresh.png](113-deep-link-survives-a-hard-refresh.png) |
| 114 | Session survives reload | onboarding not shown again | [114-session-survives-reload.png](114-session-survives-reload.png) |
| 115 | Forgot password | asked for, without confirming who is a customer | [115-forgot-password.png](115-forgot-password.png) |
| 116 | Choose a new password | the link lands here, not on the dashboard | [116-choose-a-new-password.png](116-choose-a-new-password.png) |

## Assertions

- ✅ the brand terms are readable signed out, in the designed Terms dialog
- ✅ the privacy policy is readable signed out
- ✅ Factory: the Terms link opens the factory terms in a new tab (/app.html?legal=terms&type=factory)
- ✅ Factory: the Privacy link opens the privacy policy in a new tab (/app.html?legal=privacy)
- ✅ the factory terms step opens the full terms
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
- ✅ the factory is now verified in the database
- ✅ the queue row for this brand was found and opened
- ✅ the brand is now verified too
- ✅ the operations workspace opens for staff
- ✅ and does not turn away an account that is on the admin list
- ✅ the verification queue reads the marketplace rather than erroring
- ✅ the queue loaded rather than erroring
- ✅ the marketplace-wide quote table opens
- ✅ a brand with no requests is told so, not shown a blank panel
- ✅ the tab counts are real, not the mock's literals (Active quotes (0))
- ✅ a draft row exists before the review card is filled in
- ✅ the request is open and accepting quotes
- ✅ published to every factory, per the choice on screen
- ✅ quantity persisted as a number
- ✅ "$18" stored as 1800 minor units (got 1800)
- ✅ who buys the materials is recorded, so quotes are comparable
- ✅ requirements saved as 4 taxonomy links, not free text
- ✅ a delivery month is set, so capacity counts toward matching
- ✅ the brand's own question is saved (1 question(s) in total)
- ✅ "3 colors, 100 each" became 3 rows, not a display string
- ✅ each row carries its own quantity
- ✅ the factory scores 42% against this specific request
- ✅ signing back in skips onboarding and lands on the dashboard
- ✅ the request a brand published minutes ago is visible to a factory
- ✅ the quantity the brand typed reaches the factory's card
- ✅ the brand is named, not anonymous — nobody quotes a stranger
- ✅ an approved factory browses without the look-but-do-not-bid gate
- ✅ the request the brand published is the one on screen
- ✅ the quantity the brand typed is what the factory reads
- ✅ the brand's question reaches the factory
- ✅ no brand contact details leak into the factory's view
- ✅ and is not told it may read but not quote, because it may now do both
- ✅ the quote field "unitPrice" exists on the designed screen
- ✅ the quote field "quantity" exists on the designed screen
- ✅ the quote field "leadTime" exists on the designed screen
- ✅ the quote field "paymentTerms" exists on the designed screen
- ✅ the quote field "incoterms" exists on the designed screen
- ✅ the quote field "validUntil" exists on the designed screen
- ✅ the quote field "sample.0.stage" exists on the designed screen
- ✅ the quote field "sample.0.cost" exists on the designed screen
- ✅ the quote field "sample.0.timing" exists on the designed screen
- ✅ the quote field "sample.1.stage" exists on the designed screen
- ✅ the quote field "sample.1.cost" exists on the designed screen
- ✅ the quote was accepted
- ✅ the quote is submitted (submitted)
- ✅ "$17.10 / unit" became 1710 minor units (1710)
- ✅ the quantity is a number
- ✅ '30% deposit / 70%' matched a payment term rather than being stored as prose
- ✅ 'FOB quoted' matched an incoterm
- ✅ the deposit split came with it (30%) — without one the order's schedule is unagreeable
- ✅ the sample plan is 2 rows, not a drawn plan
- ✅ the samples subtotal is computed from the rows (26000)
- ✅ both quotes are listed (2 cards)
- ✅ the list shows the same total the factory saw, not a re-parsed string
- ✅ the quoting factory is named on its card
- ✅ the quoting factory has a card (position 2)
- ✅ the chosen quote is accepted
- ✅ the other quote was auto-declined in the same transaction
- ✅ the request is closed
- ✅ awarding created a production order — nobody pressed another button
- ✅ both factories were notified (2) — nobody quotes into silence
- ✅ the awarded work appears as an order (1 card)
- ✅ the designed card is showing a real request title, not the mock one
- ✅ and no mock counterparty leaked through — the constants are not being read
- ✅ a schedule was generated from the quote, not typed (6 steps)
- ✅ the factory's own sample stages became the first steps
- ✅ the steps total exactly what was agreed (539000)
- ✅ nobody faces a blank schedule — 6 steps are already there
- ✅ one side agreeing does NOT start the order
- ✅ only the brand's agreement is recorded
- ✅ the winning factory is told on its dashboard, without asking
- ✅ the factory reads its own wording off the same stored status the brand read differently
- ✅ no step can be worked or paid before both sides have agreed
- ✅ the order starts only once BOTH sides have agreed
- ✅ the header total is the sum of the steps, not a literal ($5,390.00)
- ✅ nothing is paid yet ($0.00)
- ✅ activation created one payment per paying step and none for the rest (4)
- ✅ the update was stored
- ✅ the update attached to the step that opened the composer, not to the first one on the page
- ✅ the factory sent the step for approval
- ✅ the factory can say where its money goes — without which nobody can pay it
- ✅ the brand can read the factory's update across the org boundary
- ✅ approving the sample made its payment due
- ✅ the reference on screen is the stored order number, not one composed in the browser (TSC-000007)
- ✅ the platform fee is shown and charged at zero ($0.00)
- ✅ the payment is recorded as sent
- ✅ the brand saying it paid does NOT count as funded
- ✅ nothing tells the factory to start on the strength of the brand's word
- ✅ the factory is told plainly that we have not confirmed it yet
- ✅ the next step is still shut while the payment is only claimed
- ✅ the payments queue is its own page (Payments)
- ✅ the payment is in the queue, named by the order the brand referenced
- ✅ the payment is confirmed
- ✅ and stamped with which member of staff did it
- ✅ the next step opened on the confirmation, without waiting for funds to be released
- ✅ the same screen that refused two steps ago now says the work may start
- ✅ the header moved because a payment row moved (9500)
- ✅ the message is stored exactly as it was typed, character for character
- ✅ and attributed to the factory that sent it, not to whoever the screen assumed
- ✅ it was translated for the brand: "The cuffs have been made according to the new size chart, pl"
- ✅ the translation is not simply a copy of the original
- ✅ the brand has not read this conversation yet
- ✅ the order's own conversation is listed (TSC-000007)
- ✅ the brand is shown English first, not a sentence it cannot read
- ✅ with the original always one click away — a translation is a convenience, not the record
- ✅ opening the conversation recorded that it was read — the count cannot get stuck
- ✅ both sides have now said something (2 messages on this thread)
- ✅ the open-to-all toggle is off before publishing
- ✅ publishing was accepted
- ✅ the invite step published it (status open)
- ✅ the request is invite-only (invited_only)
- ✅ one factory was invited (1)
- ✅ the designed home greets the org by name, from the database
- ✅ and no longer greets every brand as the design's example one
- ✅ the snapshot counts the order that exists (1)
- ✅ a brand with requests and orders gets the working dashboard, and no attention card is invented
- ✅ and the design's example alerts are not shown as if they were real
- ✅ the invitation is stored and waiting
- ✅ an invited person is offered the organisation, not asked to create one
- ✅ the brand now has two people (2)
- ✅ one owner and one member — joining does not confer the money permissions
- ✅ and they land in that organisation, not one of their own
- ✅ a crash says what is and is not lost, rather than showing a blank page
- ✅ and offers a way out — reload, or back to the start
- ✅ the crash was reported, under the reference shown (3175219F)
- ✅ with the real error message, not a generic one
- ✅ and the screen it happened on
- ✅ navigating away clears the crash — one broken screen does not poison the next
- ✅ both signatures recorded (2)
- ✅ 0 draft request(s) exist and never appeared in browse
- ✅ the reset form never says whether an account exists — it is not a customer lookup
- ✅ a reset link was emailed
- ✅ saving the new password lets them through
- ✅ the old password no longer works
- ✅ and the new one does

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
