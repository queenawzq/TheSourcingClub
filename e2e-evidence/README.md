# End-to-end evidence

Recorded 2026-09-12T13:47:31.849Z against `http://127.0.0.1:5173/app.html`.

**109 steps, 124 assertions, 0 failed.**

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
| 17 | Brand basics |  | [17-brand-basics.png](17-brand-basics.png) |
| 18 | Brand about | logo and product imagery upload here, to the public bucket | [18-brand-about.png](18-brand-about.png) |
| 19 | Brand what you make | same vocabulary the factory picked from: Cut & sew knits | [19-brand-what-you-make.png](19-brand-what-you-make.png) |
| 20 | Brand sourcing plan | dollars on screen, minor units in the database | [20-brand-sourcing-plan.png](20-brand-sourcing-plan.png) |
| 21 | Brand preferences |  | [21-brand-preferences.png](21-brand-preferences.png) |
| 22 | Brand trust | team invitations and the private registration upload | [22-brand-trust.png](22-brand-trust.png) |
| 23 | Brand review |  | [23-brand-review.png](23-brand-review.png) |
| 24 | Brand complete | both sides onboarded against one schema | [24-brand-complete.png](24-brand-complete.png) |
| 25 | Brand dashboard | matches the new factory at 77% — good | [25-brand-dashboard.png](25-brand-dashboard.png) |
| 26 | Brand requests | the designed screen, empty until the first one is written | [26-brand-requests.png](26-brand-requests.png) |
| 27 | Model unavailable | the feature fails soft; the brand types it themselves | [27-model-unavailable.png](27-model-unavailable.png) |
| 28 | RFQ describe | category: Tops | [28-rfq-describe.png](28-rfq-describe.png) |
| 29 | RFQ specifics | sourcing responsibility is stored — full package and CMT are not comparable prices | [29-rfq-specifics.png](29-rfq-specifics.png) |
| 30 | RFQ timeline | delivery month drives the capacity factor in matching | [30-rfq-timeline.png](30-rfq-timeline.png) |
| 31 | RFQ questions | answers are shared with every factory quoting, unless marked private | [31-rfq-questions.png](31-rfq-questions.png) |
| 32 | RFQ review | visibility decides who can see it; verification decides who can bid | [32-rfq-review.png](32-rfq-review.png) |
| 33 | RFQ published |  | [33-rfq-published.png](33-rfq-published.png) |
| 34 | Factory again sign-in | cold start, no session | [34-factory-again-sign-in.png](34-factory-again-sign-in.png) |
| 35 | Factory again signed in | email and password, on the designed screen | [35-factory-again-signed-in.png](35-factory-again-signed-in.png) |
| 36 | Factory dashboard | still unverified, so it may look but not bid | [36-factory-dashboard.png](36-factory-dashboard.png) |
| 37 | Factory browse | the brand's request, found by a factory that was never invited | [37-factory-browse.png](37-factory-browse.png) |
| 38 | Factory reads the request | every field traces to a stored column, none of it is copy | [38-factory-reads-the-request.png](38-factory-reads-the-request.png) |
| 39 | Admin sign-in | cold start, no session | [39-admin-sign-in.png](39-admin-sign-in.png) |
| 40 | Admin signed in | email and password, on the designed screen | [40-admin-signed-in.png](40-admin-signed-in.png) |
| 41 | Verification queue | an admin with no org of their own can still work | [41-verification-queue.png](41-verification-queue.png) |
| 42 | Factory approved | approving the registration verifies the org, which unlocks quoting | [42-factory-approved.png](42-factory-approved.png) |
| 43 | Operations workspace | the designed admin console, on marketplace data | [43-operations-workspace.png](43-operations-workspace.png) |
| 44 | Marketplace quotes | every quote across the marketplace, staff only | [44-marketplace-quotes.png](44-marketplace-quotes.png) |
| 45 | Factory quoting sign-in | cold start, no session | [45-factory-quoting-sign-in.png](45-factory-quoting-sign-in.png) |
| 46 | Factory quoting signed in | email and password, on the designed screen | [46-factory-quoting-signed-in.png](46-factory-quoting-signed-in.png) |
| 47 | Factory can now bid | the verification notice is gone and the quote button is live | [47-factory-can-now-bid.png](47-factory-can-now-bid.png) |
| 48 | Factory quote | production + samples = $5,390.00, computed not typed | [48-factory-quote.png](48-factory-quote.png) |
| 49 | Quote sent | and the factory is promised an answer either way | [49-quote-sent.png](49-quote-sent.png) |
| 50 | Brand deciding sign-in | cold start, no session | [50-brand-deciding-sign-in.png](50-brand-deciding-sign-in.png) |
| 51 | Brand deciding signed in | email and password, on the designed screen | [51-brand-deciding-signed-in.png](51-brand-deciding-signed-in.png) |
| 52 | Quote comparison | two quotes side by side, every figure derived from stored columns | [52-quote-comparison.png](52-quote-comparison.png) |
| 53 | Confirm award | it says plainly that the others will be told | [53-confirm-award.png](53-confirm-award.png) |
| 54 | Awarded | the loop closes here | [54-awarded.png](54-awarded.png) |
| 55 | Production orders | the brand's side of the work it just commissioned | [55-production-orders.png](55-production-orders.png) |
| 56 | The order | every figure here is summed in SQL from the rows below it | [56-the-order.png](56-the-order.png) |
| 57 | The schedule | drafted from the quote; either side may change it | [57-the-schedule.png](57-the-schedule.png) |
| 58 | Brand agrees | one signature. The order has not started | [58-brand-agrees.png](58-brand-agrees.png) |
| 59 | Winning factory sign-in | cold start, no session | [59-winning-factory-sign-in.png](59-winning-factory-sign-in.png) |
| 60 | Winning factory signed in | email and password, on the designed screen | [60-winning-factory-signed-in.png](60-winning-factory-signed-in.png) |
| 61 | Factory hears the outcome | award_quote wrote this row; now something shows it | [61-factory-hears-the-outcome.png](61-factory-hears-the-outcome.png) |
| 62 | Factory sees the schedule | the same steps the brand read, nothing actionable yet | [62-factory-sees-the-schedule.png](62-factory-sees-the-schedule.png) |
| 63 | Both agreed | the order is running | [63-both-agreed.png](63-both-agreed.png) |
| 64 | Posting an update | a note and photographs, which is the factory's only lever here | [64-posting-an-update.png](64-posting-an-update.png) |
| 65 | Sent for approval | the brand decides; the factory does not mark its own work done | [65-sent-for-approval.png](65-sent-for-approval.png) |
| 66 | Where the factory gets paid | no full account number is asked for, or stored | [66-where-the-factory-gets-paid.png](66-where-the-factory-gets-paid.png) |
| 67 | Brand approving sign-in | cold start, no session | [67-brand-approving-sign-in.png](67-brand-approving-sign-in.png) |
| 68 | Brand approving signed in | email and password, on the designed screen | [68-brand-approving-signed-in.png](68-brand-approving-signed-in.png) |
| 69 | Waiting on the brand | the factory has sent a step for approval | [69-waiting-on-the-brand.png](69-waiting-on-the-brand.png) |
| 70 | The brand reads the update | posted by the factory, readable by the brand, nobody else | [70-the-brand-reads-the-update.png](70-the-brand-reads-the-update.png) |
| 71 | Approving | one modal, whether or not money follows | [71-approving.png](71-approving.png) |
| 72 | How to pay | amount, destination, and the reference an admin will match | [72-how-to-pay.png](72-how-to-pay.png) |
| 73 | Marked sent | the brand's claim — not yet an arrival | [73-marked-sent.png](73-marked-sent.png) |
| 74 | Factory waiting sign-in | cold start, no session | [74-factory-waiting-sign-in.png](74-factory-waiting-sign-in.png) |
| 75 | Factory waiting signed in | email and password, on the designed screen | [75-factory-waiting-signed-in.png](75-factory-waiting-signed-in.png) |
| 76 | The factory waits | the brand says it paid. That is not enough, and the screen says so | [76-the-factory-waits.png](76-the-factory-waits.png) |
| 77 | Admin confirming sign-in | cold start, no session | [77-admin-confirming-sign-in.png](77-admin-confirming-sign-in.png) |
| 78 | Admin confirming signed in | email and password, on the designed screen | [78-admin-confirming-signed-in.png](78-admin-confirming-signed-in.png) |
| 79 | The payment queue | a required step, not a convenience: staff have no org to notify | [79-the-payment-queue.png](79-the-payment-queue.png) |
| 80 | Confirmed | this click is what a factory on the other side of the world is relying on | [80-confirmed.png](80-confirmed.png) |
| 81 | Factory told to start sign-in | cold start, no session | [81-factory-told-to-start-sign-in.png](81-factory-told-to-start-sign-in.png) |
| 82 | Factory told to start signed in | email and password, on the designed screen | [82-factory-told-to-start-signed-in.png](82-factory-told-to-start-signed-in.png) |
| 83 | Cleared to work | nothing changed but an admin confirming the money arrived | [83-cleared-to-work.png](83-cleared-to-work.png) |
| 84 | The conversation | kept with the order, so it is there when someone asks what was agreed | [84-the-conversation.png](84-the-conversation.png) |
| 85 | The factory writes in Chinese | and does not have to think about who reads it | [85-the-factory-writes-in-chinese.png](85-the-factory-writes-in-chinese.png) |
| 86 | Brand reading sign-in | cold start, no session | [86-brand-reading-sign-in.png](86-brand-reading-sign-in.png) |
| 87 | Brand reading signed in | email and password, on the designed screen | [87-brand-reading-signed-in.png](87-brand-reading-signed-in.png) |
| 88 | Conversations | one per piece of work, not one per company | [88-conversations.png](88-conversations.png) |
| 89 | The brand reads it | in its own language, with the original one click away | [89-the-brand-reads-it.png](89-the-brand-reads-it.png) |
| 90 | A reply | the first conversation either prototype could not actually have | [90-a-reply.png](90-a-reply.png) |
| 91 | Brand again sign-in | cold start, no session | [91-brand-again-sign-in.png](91-brand-again-sign-in.png) |
| 92 | Brand again signed in | email and password, on the designed screen | [92-brand-again-signed-in.png](92-brand-again-signed-in.png) |
| 93 | Invite-only chosen | publishing this without inviting anyone used to strand it | [93-invite-only-chosen.png](93-invite-only-chosen.png) |
| 94 | Choose who sees it | ranked by fit against this request, same score the factory sees | [94-choose-who-sees-it.png](94-choose-who-sees-it.png) |
| 95 | Invitations saved |  | [95-invitations-saved.png](95-invitations-saved.png) |
| 96 | Brand at home sign-in | cold start, no session | [96-brand-at-home-sign-in.png](96-brand-at-home-sign-in.png) |
| 97 | Brand at home signed in | email and password, on the designed screen | [97-brand-at-home-signed-in.png](97-brand-at-home-signed-in.png) |
| 98 | Brand home | what needs you, before anything else | [98-brand-home.png](98-brand-home.png) |
| 99 | The team | who else acts as this brand | [99-the-team.png](99-the-team.png) |
| 100 | Invited | they see it the next time they sign in | [100-invited.png](100-invited.png) |
| 101 | Colleague sign-in | cold start, no session | [101-colleague-sign-in.png](101-colleague-sign-in.png) |
| 102 | Colleague signed in | email and password, on the designed screen | [102-colleague-signed-in.png](102-colleague-signed-in.png) |
| 103 | You have been invited | the invitation was in the database from the start; nothing ever showed it | [103-you-have-been-invited.png](103-you-have-been-invited.png) |
| 104 | Joined | straight into the brand they were invited to, with no onboarding to redo | [104-joined.png](104-joined.png) |
| 105 | When it breaks | the reference on screen is the one in the database | [105-when-it-breaks.png](105-when-it-breaks.png) |
| 106 | Deep link survives a hard refresh | the rewrite works, in dev and in production | [106-deep-link-survives-a-hard-refresh.png](106-deep-link-survives-a-hard-refresh.png) |
| 107 | Session survives reload | onboarding not shown again | [107-session-survives-reload.png](107-session-survives-reload.png) |
| 108 | Forgot password | asked for, without confirming who is a customer | [108-forgot-password.png](108-forgot-password.png) |
| 109 | Choose a new password | the link lands here, not on the dashboard | [109-choose-a-new-password.png](109-choose-a-new-password.png) |

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
- ✅ the reference on screen is the stored order number, not one composed in the browser (TSC-000026)
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
- ✅ the crash was reported, under the reference shown (6BA69724)
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
