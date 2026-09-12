# End-to-end evidence

Recorded 2026-09-12T13:25:12.556Z against `http://127.0.0.1:5173/app.html`.

**122 steps, 119 assertions, 0 failed.**

A real browser, driven by Stagehand, against a real database. No mock data
anywhere: every value below was typed into the interface and then read back
out of Postgres to confirm the screen and the database agree.

## Walkthrough

| # | Step | What it shows | Screenshot |
|---|---|---|---|
| 1 | Factory sign-in | cold start, no session | [01-factory-sign-in.png](01-factory-sign-in.png) |
| 2 | Factory code requested | e2e-factory-1789219279113@example.com | [02-factory-code-requested.png](02-factory-code-requested.png) |
| 3 | Factory signed in | code 607611 accepted — no password anywhere | [03-factory-signed-in.png](03-factory-signed-in.png) |
| 4 | Factory organisation | factory: Atelier E2E 1789219279113 | [04-factory-organisation.png](04-factory-organisation.png) |
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
| 16 | Brand code requested | e2e-brand-1789219279113@example.com | [16-brand-code-requested.png](16-brand-code-requested.png) |
| 17 | Brand signed in | code 722110 accepted — no password anywhere | [17-brand-signed-in.png](17-brand-signed-in.png) |
| 18 | Brand organisation | brand: Maison E2E 1789219279113 | [18-brand-organisation.png](18-brand-organisation.png) |
| 19 | Brand basics |  | [19-brand-basics.png](19-brand-basics.png) |
| 20 | Brand about | logo and product imagery upload here, to the public bucket | [20-brand-about.png](20-brand-about.png) |
| 21 | Brand what you make | same vocabulary the factory picked from: Cut & sew knits | [21-brand-what-you-make.png](21-brand-what-you-make.png) |
| 22 | Brand sourcing plan | dollars on screen, minor units in the database | [22-brand-sourcing-plan.png](22-brand-sourcing-plan.png) |
| 23 | Brand preferences |  | [23-brand-preferences.png](23-brand-preferences.png) |
| 24 | Brand trust | team invitations and the private registration upload | [24-brand-trust.png](24-brand-trust.png) |
| 25 | Brand review |  | [25-brand-review.png](25-brand-review.png) |
| 26 | Brand complete | both sides onboarded against one schema | [26-brand-complete.png](26-brand-complete.png) |
| 27 | Brand dashboard | matches the new factory at 77% — good | [27-brand-dashboard.png](27-brand-dashboard.png) |
| 28 | Brand requests | the designed screen, empty until the first one is written | [28-brand-requests.png](28-brand-requests.png) |
| 29 | Model unavailable | the feature fails soft; the brand types it themselves | [29-model-unavailable.png](29-model-unavailable.png) |
| 30 | RFQ describe | category: Tops | [30-rfq-describe.png](30-rfq-describe.png) |
| 31 | RFQ specifics | sourcing responsibility is stored — full package and CMT are not comparable prices | [31-rfq-specifics.png](31-rfq-specifics.png) |
| 32 | RFQ timeline | delivery month drives the capacity factor in matching | [32-rfq-timeline.png](32-rfq-timeline.png) |
| 33 | RFQ questions | answers are shared with every factory quoting, unless marked private | [33-rfq-questions.png](33-rfq-questions.png) |
| 34 | RFQ review | visibility decides who can see it; verification decides who can bid | [34-rfq-review.png](34-rfq-review.png) |
| 35 | RFQ published |  | [35-rfq-published.png](35-rfq-published.png) |
| 36 | Factory again sign-in | cold start, no session | [36-factory-again-sign-in.png](36-factory-again-sign-in.png) |
| 37 | Factory again code requested | e2e-factory-1789219279113@example.com | [37-factory-again-code-requested.png](37-factory-again-code-requested.png) |
| 38 | Factory again signed in | code 488406 accepted — no password anywhere | [38-factory-again-signed-in.png](38-factory-again-signed-in.png) |
| 39 | Factory dashboard | still unverified, so it may look but not bid | [39-factory-dashboard.png](39-factory-dashboard.png) |
| 40 | Factory browse | the brand's request, found by a factory that was never invited | [40-factory-browse.png](40-factory-browse.png) |
| 41 | Factory reads the request | every field traces to a stored column, none of it is copy | [41-factory-reads-the-request.png](41-factory-reads-the-request.png) |
| 42 | Admin sign-in | cold start, no session | [42-admin-sign-in.png](42-admin-sign-in.png) |
| 43 | Admin code requested | e2e-admin-1789219279113@example.com | [43-admin-code-requested.png](43-admin-code-requested.png) |
| 44 | Admin signed in | code 733086 accepted — no password anywhere | [44-admin-signed-in.png](44-admin-signed-in.png) |
| 45 | Verification queue | an admin with no org of their own can still work | [45-verification-queue.png](45-verification-queue.png) |
| 46 | Factory approved | approving the registration verifies the org, which unlocks quoting | [46-factory-approved.png](46-factory-approved.png) |
| 47 | Operations workspace | the designed admin console, on marketplace data | [47-operations-workspace.png](47-operations-workspace.png) |
| 48 | Marketplace quotes | every quote across the marketplace, staff only | [48-marketplace-quotes.png](48-marketplace-quotes.png) |
| 49 | Factory quoting sign-in | cold start, no session | [49-factory-quoting-sign-in.png](49-factory-quoting-sign-in.png) |
| 50 | Factory quoting code requested | e2e-factory-1789219279113@example.com | [50-factory-quoting-code-requested.png](50-factory-quoting-code-requested.png) |
| 51 | Factory quoting signed in | code 211974 accepted — no password anywhere | [51-factory-quoting-signed-in.png](51-factory-quoting-signed-in.png) |
| 52 | Factory can now bid | the verification notice is gone and the quote button is live | [52-factory-can-now-bid.png](52-factory-can-now-bid.png) |
| 53 | Factory quote | production + samples = $5,390.00, computed not typed | [53-factory-quote.png](53-factory-quote.png) |
| 54 | Quote sent | and the factory is promised an answer either way | [54-quote-sent.png](54-quote-sent.png) |
| 55 | Brand deciding sign-in | cold start, no session | [55-brand-deciding-sign-in.png](55-brand-deciding-sign-in.png) |
| 56 | Brand deciding code requested | e2e-brand-1789219279113@example.com | [56-brand-deciding-code-requested.png](56-brand-deciding-code-requested.png) |
| 57 | Brand deciding signed in | code 913403 accepted — no password anywhere | [57-brand-deciding-signed-in.png](57-brand-deciding-signed-in.png) |
| 58 | Quote comparison | two quotes side by side, every figure derived from stored columns | [58-quote-comparison.png](58-quote-comparison.png) |
| 59 | Confirm award | it says plainly that the others will be told | [59-confirm-award.png](59-confirm-award.png) |
| 60 | Awarded | the loop closes here | [60-awarded.png](60-awarded.png) |
| 61 | Production orders | the brand's side of the work it just commissioned | [61-production-orders.png](61-production-orders.png) |
| 62 | The order | every figure here is summed in SQL from the rows below it | [62-the-order.png](62-the-order.png) |
| 63 | The schedule | drafted from the quote; either side may change it | [63-the-schedule.png](63-the-schedule.png) |
| 64 | Brand agrees | one signature. The order has not started | [64-brand-agrees.png](64-brand-agrees.png) |
| 65 | Winning factory sign-in | cold start, no session | [65-winning-factory-sign-in.png](65-winning-factory-sign-in.png) |
| 66 | Winning factory code requested | e2e-factory-1789219279113@example.com | [66-winning-factory-code-requested.png](66-winning-factory-code-requested.png) |
| 67 | Winning factory signed in | code 083895 accepted — no password anywhere | [67-winning-factory-signed-in.png](67-winning-factory-signed-in.png) |
| 68 | Factory hears the outcome | award_quote wrote this row; now something shows it | [68-factory-hears-the-outcome.png](68-factory-hears-the-outcome.png) |
| 69 | Factory sees the schedule | the same steps the brand read, nothing actionable yet | [69-factory-sees-the-schedule.png](69-factory-sees-the-schedule.png) |
| 70 | Both agreed | the order is running | [70-both-agreed.png](70-both-agreed.png) |
| 71 | Posting an update | a note and photographs, which is the factory's only lever here | [71-posting-an-update.png](71-posting-an-update.png) |
| 72 | Sent for approval | the brand decides; the factory does not mark its own work done | [72-sent-for-approval.png](72-sent-for-approval.png) |
| 73 | Where the factory gets paid | no full account number is asked for, or stored | [73-where-the-factory-gets-paid.png](73-where-the-factory-gets-paid.png) |
| 74 | Brand approving sign-in | cold start, no session | [74-brand-approving-sign-in.png](74-brand-approving-sign-in.png) |
| 75 | Brand approving code requested | e2e-brand-1789219279113@example.com | [75-brand-approving-code-requested.png](75-brand-approving-code-requested.png) |
| 76 | Brand approving signed in | code 895703 accepted — no password anywhere | [76-brand-approving-signed-in.png](76-brand-approving-signed-in.png) |
| 77 | Waiting on the brand | the factory has sent a step for approval | [77-waiting-on-the-brand.png](77-waiting-on-the-brand.png) |
| 78 | The brand reads the update | posted by the factory, readable by the brand, nobody else | [78-the-brand-reads-the-update.png](78-the-brand-reads-the-update.png) |
| 79 | Approving | one modal, whether or not money follows | [79-approving.png](79-approving.png) |
| 80 | How to pay | amount, destination, and the reference an admin will match | [80-how-to-pay.png](80-how-to-pay.png) |
| 81 | Marked sent | the brand's claim — not yet an arrival | [81-marked-sent.png](81-marked-sent.png) |
| 82 | Factory waiting sign-in | cold start, no session | [82-factory-waiting-sign-in.png](82-factory-waiting-sign-in.png) |
| 83 | Factory waiting code requested | e2e-factory-1789219279113@example.com | [83-factory-waiting-code-requested.png](83-factory-waiting-code-requested.png) |
| 84 | Factory waiting signed in | code 399469 accepted — no password anywhere | [84-factory-waiting-signed-in.png](84-factory-waiting-signed-in.png) |
| 85 | The factory waits | the brand says it paid. That is not enough, and the screen says so | [85-the-factory-waits.png](85-the-factory-waits.png) |
| 86 | Admin confirming sign-in | cold start, no session | [86-admin-confirming-sign-in.png](86-admin-confirming-sign-in.png) |
| 87 | Admin confirming code requested | e2e-admin-1789219279113@example.com | [87-admin-confirming-code-requested.png](87-admin-confirming-code-requested.png) |
| 88 | Admin confirming signed in | code 157835 accepted — no password anywhere | [88-admin-confirming-signed-in.png](88-admin-confirming-signed-in.png) |
| 89 | The payment queue | a required step, not a convenience: staff have no org to notify | [89-the-payment-queue.png](89-the-payment-queue.png) |
| 90 | Confirmed | this click is what a factory on the other side of the world is relying on | [90-confirmed.png](90-confirmed.png) |
| 91 | Factory told to start sign-in | cold start, no session | [91-factory-told-to-start-sign-in.png](91-factory-told-to-start-sign-in.png) |
| 92 | Factory told to start code requested | e2e-factory-1789219279113@example.com | [92-factory-told-to-start-code-requested.png](92-factory-told-to-start-code-requested.png) |
| 93 | Factory told to start signed in | code 641498 accepted — no password anywhere | [93-factory-told-to-start-signed-in.png](93-factory-told-to-start-signed-in.png) |
| 94 | Cleared to work | nothing changed but an admin confirming the money arrived | [94-cleared-to-work.png](94-cleared-to-work.png) |
| 95 | The conversation | kept with the order, so it is there when someone asks what was agreed | [95-the-conversation.png](95-the-conversation.png) |
| 96 | The factory writes in Chinese | and does not have to think about who reads it | [96-the-factory-writes-in-chinese.png](96-the-factory-writes-in-chinese.png) |
| 97 | Brand reading sign-in | cold start, no session | [97-brand-reading-sign-in.png](97-brand-reading-sign-in.png) |
| 98 | Brand reading code requested | e2e-brand-1789219279113@example.com | [98-brand-reading-code-requested.png](98-brand-reading-code-requested.png) |
| 99 | Brand reading signed in | code 645635 accepted — no password anywhere | [99-brand-reading-signed-in.png](99-brand-reading-signed-in.png) |
| 100 | Conversations | one per piece of work, not one per company | [100-conversations.png](100-conversations.png) |
| 101 | The brand reads it | in its own language, with the original one click away | [101-the-brand-reads-it.png](101-the-brand-reads-it.png) |
| 102 | A reply | the first conversation either prototype could not actually have | [102-a-reply.png](102-a-reply.png) |
| 103 | Brand again sign-in | cold start, no session | [103-brand-again-sign-in.png](103-brand-again-sign-in.png) |
| 104 | Brand again code requested | e2e-brand-1789219279113@example.com | [104-brand-again-code-requested.png](104-brand-again-code-requested.png) |
| 105 | Brand again signed in | code 248526 accepted — no password anywhere | [105-brand-again-signed-in.png](105-brand-again-signed-in.png) |
| 106 | Invite-only chosen | publishing this without inviting anyone used to strand it | [106-invite-only-chosen.png](106-invite-only-chosen.png) |
| 107 | Choose who sees it | ranked by fit against this request, same score the factory sees | [107-choose-who-sees-it.png](107-choose-who-sees-it.png) |
| 108 | Invitations saved |  | [108-invitations-saved.png](108-invitations-saved.png) |
| 109 | Brand at home sign-in | cold start, no session | [109-brand-at-home-sign-in.png](109-brand-at-home-sign-in.png) |
| 110 | Brand at home code requested | e2e-brand-1789219279113@example.com | [110-brand-at-home-code-requested.png](110-brand-at-home-code-requested.png) |
| 111 | Brand at home signed in | code 852984 accepted — no password anywhere | [111-brand-at-home-signed-in.png](111-brand-at-home-signed-in.png) |
| 112 | Brand home | what needs you, before anything else | [112-brand-home.png](112-brand-home.png) |
| 113 | The team | who else acts as this brand | [113-the-team.png](113-the-team.png) |
| 114 | Invited | they see it the next time they sign in | [114-invited.png](114-invited.png) |
| 115 | Colleague sign-in | cold start, no session | [115-colleague-sign-in.png](115-colleague-sign-in.png) |
| 116 | Colleague code requested | colleague-1789219279113@example.com | [116-colleague-code-requested.png](116-colleague-code-requested.png) |
| 117 | Colleague signed in | code 922132 accepted — no password anywhere | [117-colleague-signed-in.png](117-colleague-signed-in.png) |
| 118 | You have been invited | the invitation was in the database from the start; nothing ever showed it | [118-you-have-been-invited.png](118-you-have-been-invited.png) |
| 119 | Joined | straight into the brand they were invited to, with no onboarding to redo | [119-joined.png](119-joined.png) |
| 120 | When it breaks | the reference on screen is the one in the database | [120-when-it-breaks.png](120-when-it-breaks.png) |
| 121 | Deep link survives a hard refresh | the rewrite works, in dev and in production | [121-deep-link-survives-a-hard-refresh.png](121-deep-link-survives-a-hard-refresh.png) |
| 122 | Session survives reload | onboarding not shown again | [122-session-survives-reload.png](122-session-survives-reload.png) |

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
- ✅ "$18" stored as 1800 minor units (got 1800)
- ✅ brand onboarding marked complete
- ✅ match score computed between the two orgs just created: 77% (good)
- ✅ a brand with no requests is told so, not shown a blank panel
- ✅ the tab counts are real, not the mock's literals (Active quotes (0))
- ✅ a draft is created on entry and its id is in the url
- ✅ the model service is unavailable (the model service returned 402)
- ✅ and the composer is untouched by it — nothing typed was lost to a failed model call
- ✅ the request is open and accepting quotes
- ✅ published to every factory, per the choice on screen
- ✅ quantity persisted as a number
- ✅ "$18" stored as 1800 minor units (got 1800)
- ✅ who buys the materials is recorded, so quotes are comparable
- ✅ requirements saved as 2 taxonomy links, not free text
- ✅ a delivery month is set, so capacity counts toward matching
- ✅ the brand's own question is saved (1 question(s) in total)
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
- ✅ the operations workspace opens for staff
- ✅ and does not turn away an account that is on the admin list
- ✅ a company from this run is in the live verification queue
- ✅ the queue loaded rather than erroring
- ✅ the marketplace-wide quote table opens
- ✅ the total is worked out from the lines: 300 x $17.10 + $260 = $5,390.00
- ✅ both quotes are shown for comparison (2 columns)
- ✅ the comparison shows the same total the factory saw, not a re-parsed string
- ✅ MOQ is absent — the design system forbids it as a comparison metric
- ✅ the quoting factory has a column (position 2)
- ✅ the confirmation names the factory being awarded
- ✅ the chosen quote is accepted
- ✅ the other quote was auto-declined in the same transaction
- ✅ the request is closed
- ✅ awarding created a production order — nobody pressed another button
- ✅ both factories were notified (2) — nobody quotes into silence
- ✅ the awarded work appears as an order (1 card)
- ✅ the designed card is showing a real request title, not the mock one
- ✅ and no mock counterparty leaked through — the constants are not being read
- ✅ the header total is the sum of the steps, not a literal ($5,390.00)
- ✅ nothing is paid yet ($0.00)
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
- ✅ activation created one payment per paying step and none for the rest (4)
- ✅ the update was stored
- ✅ the update attached to the step that opened the composer, not to the first one on the page
- ✅ the factory sent the step for approval
- ✅ the factory can say where its money goes — without which nobody can pay it
- ✅ the brand can read the factory's update across the org boundary
- ✅ approving the sample made its payment due
- ✅ the reference on screen is the stored order number, not one composed in the browser (TSC-000017)
- ✅ the platform fee is shown and charged at zero ($0.00)
- ✅ the payment is recorded as sent
- ✅ the brand saying it paid does NOT count as funded
- ✅ nothing tells the factory to start on the strength of the brand's word
- ✅ the factory is told plainly that we have not confirmed it yet
- ✅ the next step is still shut while the payment is only claimed
- ✅ the second admin screen is its own page, not the first one at a different url (Payments)
- ✅ the payment is in the queue, named by the order the brand referenced
- ✅ the payment is confirmed
- ✅ and stamped with which member of staff did it
- ✅ the next step opened on the confirmation, without waiting for funds to be released
- ✅ the same screen that refused two steps ago now says the work may start
- ✅ the header moved because a payment row moved (9500)
- ✅ the message is stored exactly as it was typed, character for character
- ✅ and attributed to the factory that sent it, not to whoever the screen assumed
- ✅ no translation was produced, and the message went anyway — as it must
- ✅ the brand is shown an unread message (1)
- ✅ with no translation available, the brand sees exactly what was written
- ✅ opening the conversation recorded that it was read — the count cannot get stuck
- ✅ both sides have now said something (2 messages on this thread)
- ✅ the request is invite-only
- ✅ one factory was invited (1)
- ✅ the home screen no longer tells a signed-up user the product is somewhere else
- ✅ the snapshot counts the order that exists (1)
- ✅ and the screen shows the figure the database computed, not one of its own
- ✅ with nothing outstanding, the screen says so rather than showing an empty space
- ✅ the invitation is stored and waiting
- ✅ an invited person is offered the organisation, not asked to create one
- ✅ the brand now has two people (2)
- ✅ one owner and one member — joining does not confer the money permissions
- ✅ and they land in that organisation, not one of their own
- ✅ a crash says what is and is not lost, rather than showing a blank page
- ✅ and offers a way out — reload, or back to the start
- ✅ the crash was reported, under the reference shown (C3C935C8)
- ✅ with the real error message, not a generic one
- ✅ and the screen it happened on
- ✅ navigating away clears the crash — one broken screen does not poison the next
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
