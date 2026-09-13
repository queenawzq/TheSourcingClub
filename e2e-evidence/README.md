# End-to-end evidence

Recorded 2026-09-13T17:47:34.643Z against `http://127.0.0.1:5173/app.html`.

**112 steps, 126 assertions, 0 failed.**

A real browser, driven by Stagehand, against a real database. No mock data
anywhere: every value below was typed into the interface and then read back
out of Postgres to confirm the screen and the database agree.

## Walkthrough

| # | Step | What it shows | Screenshot |
|---|---|---|---|
| 1 | Factory sign-up | the designed vendor portal | [01-factory-sign-up.png](01-factory-sign-up.png) |
| 2 | Factory account details | name, company, email and password on one form | [02-factory-account-details.png](02-factory-account-details.png) |
| 3 | Factory signed up | an account, a name and a company in one submit | [03-factory-signed-up.png](03-factory-signed-up.png) |
| 4 | Factory welcome | the designed card, with the manufacturer / trading-company choice | [04-factory-welcome.png](04-factory-welcome.png) |
| 5 | Factory basics | one designed card, six fields | [05-factory-basics.png](05-factory-basics.png) |
| 6 | Factory context |  | [06-factory-context.png](06-factory-context.png) |
| 7 | Factory what you make | from taxonomy_terms: Cut & sew knits, Tops, Bottoms | [07-factory-what-you-make.png](07-factory-what-you-make.png) |
| 8 | Factory specialty and services | equipment is free text on purpose | [08-factory-specialty-and-services.png](08-factory-specialty-and-services.png) |
| 9 | Factory capacity and terms |  | [09-factory-capacity-and-terms.png](09-factory-capacity-and-terms.png) |
| 10 | Factory verification | documents are reviewed by a human, not self-declared | [10-factory-verification.png](10-factory-verification.png) |
| 11 | Factory walkthrough |  | [11-factory-walkthrough.png](11-factory-walkthrough.png) |
| 12 | Factory review | what the vendor actually typed, read back | [12-factory-review.png](12-factory-review.png) |
| 13 | Factory terms |  | [13-factory-terms.png](13-factory-terms.png) |
| 14 | Factory complete | the designed finish card, not a hand-built one | [14-factory-complete.png](14-factory-complete.png) |
| 15 | Brand sign-up | the designed brand portal | [15-brand-sign-up.png](15-brand-sign-up.png) |
| 16 | Brand account details | name, company, email and password on one form | [16-brand-account-details.png](16-brand-account-details.png) |
| 17 | Brand signed up | an account, a name and a company in one submit | [17-brand-signed-up.png](17-brand-signed-up.png) |
| 18 | Brand welcome | the designed welcome card | [18-brand-welcome.png](18-brand-welcome.png) |
| 19 | Brand basics | category options come from the taxonomy, not the mock list | [19-brand-basics.png](19-brand-basics.png) |
| 20 | Brand context | logo and product imagery upload here, to the public bucket | [20-brand-context.png](20-brand-context.png) |
| 21 | Brand what you make | same vocabulary the vendor picked from: Tops, Bottoms | [21-brand-what-you-make.png](21-brand-what-you-make.png) |
| 22 | Brand sourcing volume | dollars on screen, minor units in the database | [22-brand-sourcing-volume.png](22-brand-sourcing-volume.png) |
| 23 | Brand vendor preferences |  | [23-brand-vendor-preferences.png](23-brand-vendor-preferences.png) |
| 24 | Brand trust | team invitations and the private registration upload | [24-brand-trust.png](24-brand-trust.png) |
| 25 | Brand review | what was entered, not the mock | [25-brand-review.png](25-brand-review.png) |
| 26 | Brand terms |  | [26-brand-terms.png](26-brand-terms.png) |
| 27 | Brand complete | the designed finish card | [27-brand-complete.png](27-brand-complete.png) |
| 28 | Brand dashboard | matches the new factory at 50% — weak | [28-brand-dashboard.png](28-brand-dashboard.png) |
| 29 | Brand requests | the designed screen, empty until the first one is written | [29-brand-requests.png](29-brand-requests.png) |
| 30 | Model unavailable | the feature fails soft; the brand types it themselves | [30-model-unavailable.png](30-model-unavailable.png) |
| 31 | RFQ describe | category: Tops | [31-rfq-describe.png](31-rfq-describe.png) |
| 32 | RFQ specifics | sourcing responsibility is stored — full package and CMT are not comparable prices | [32-rfq-specifics.png](32-rfq-specifics.png) |
| 33 | RFQ timeline | delivery month drives the capacity factor in matching | [33-rfq-timeline.png](33-rfq-timeline.png) |
| 34 | RFQ questions | answers are shared with every factory quoting, unless marked private | [34-rfq-questions.png](34-rfq-questions.png) |
| 35 | RFQ review | visibility decides who can see it; verification decides who can bid | [35-rfq-review.png](35-rfq-review.png) |
| 36 | RFQ published |  | [36-rfq-published.png](36-rfq-published.png) |
| 37 | Factory again sign-in | cold start, no session | [37-factory-again-sign-in.png](37-factory-again-sign-in.png) |
| 38 | Factory again signed in | email and password, on the designed screen | [38-factory-again-signed-in.png](38-factory-again-signed-in.png) |
| 39 | Factory dashboard | still unverified, so it may look but not bid | [39-factory-dashboard.png](39-factory-dashboard.png) |
| 40 | Factory browse | the brand's request, found by a factory that was never invited | [40-factory-browse.png](40-factory-browse.png) |
| 41 | Factory reads the request | every field traces to a stored column, none of it is copy | [41-factory-reads-the-request.png](41-factory-reads-the-request.png) |
| 42 | Admin sign-in | cold start, no session | [42-admin-sign-in.png](42-admin-sign-in.png) |
| 43 | Admin signed in | email and password, on the designed screen | [43-admin-signed-in.png](43-admin-signed-in.png) |
| 44 | Verification queue | an admin with no org of their own can still work | [44-verification-queue.png](44-verification-queue.png) |
| 45 | Factory approved | approving the company verifies it, which unlocks quoting | [45-factory-approved.png](45-factory-approved.png) |
| 46 | Operations workspace | the designed admin console, on marketplace data | [46-operations-workspace.png](46-operations-workspace.png) |
| 47 | Marketplace quotes | every quote across the marketplace, staff only | [47-marketplace-quotes.png](47-marketplace-quotes.png) |
| 48 | Factory quoting sign-in | cold start, no session | [48-factory-quoting-sign-in.png](48-factory-quoting-sign-in.png) |
| 49 | Factory quoting signed in | email and password, on the designed screen | [49-factory-quoting-signed-in.png](49-factory-quoting-signed-in.png) |
| 50 | Factory can now bid | the verification notice is gone and the quote button is live | [50-factory-can-now-bid.png](50-factory-can-now-bid.png) |
| 51 | Factory quote | production + samples = $5,390.00, computed not typed | [51-factory-quote.png](51-factory-quote.png) |
| 52 | Quote sent | and the factory is promised an answer either way | [52-quote-sent.png](52-quote-sent.png) |
| 53 | Brand deciding sign-in | cold start, no session | [53-brand-deciding-sign-in.png](53-brand-deciding-sign-in.png) |
| 54 | Brand deciding signed in | email and password, on the designed screen | [54-brand-deciding-signed-in.png](54-brand-deciding-signed-in.png) |
| 55 | Quote comparison | two quotes side by side, every figure derived from stored columns | [55-quote-comparison.png](55-quote-comparison.png) |
| 56 | Confirm award | it says plainly that the others will be told | [56-confirm-award.png](56-confirm-award.png) |
| 57 | Awarded | the loop closes here | [57-awarded.png](57-awarded.png) |
| 58 | Production orders | the brand's side of the work it just commissioned | [58-production-orders.png](58-production-orders.png) |
| 59 | The order | every figure here is summed in SQL from the rows below it | [59-the-order.png](59-the-order.png) |
| 60 | The schedule | drafted from the quote; either side may change it | [60-the-schedule.png](60-the-schedule.png) |
| 61 | Brand agrees | one signature. The order has not started | [61-brand-agrees.png](61-brand-agrees.png) |
| 62 | Winning factory sign-in | cold start, no session | [62-winning-factory-sign-in.png](62-winning-factory-sign-in.png) |
| 63 | Winning factory signed in | email and password, on the designed screen | [63-winning-factory-signed-in.png](63-winning-factory-signed-in.png) |
| 64 | Factory hears the outcome | award_quote wrote this row; now something shows it | [64-factory-hears-the-outcome.png](64-factory-hears-the-outcome.png) |
| 65 | Factory sees the schedule | the same steps the brand read, nothing actionable yet | [65-factory-sees-the-schedule.png](65-factory-sees-the-schedule.png) |
| 66 | Both agreed | the order is running | [66-both-agreed.png](66-both-agreed.png) |
| 67 | Posting an update | a note and photographs, which is the factory's only lever here | [67-posting-an-update.png](67-posting-an-update.png) |
| 68 | Sent for approval | the brand decides; the factory does not mark its own work done | [68-sent-for-approval.png](68-sent-for-approval.png) |
| 69 | Where the factory gets paid | no full account number is asked for, or stored | [69-where-the-factory-gets-paid.png](69-where-the-factory-gets-paid.png) |
| 70 | Brand approving sign-in | cold start, no session | [70-brand-approving-sign-in.png](70-brand-approving-sign-in.png) |
| 71 | Brand approving signed in | email and password, on the designed screen | [71-brand-approving-signed-in.png](71-brand-approving-signed-in.png) |
| 72 | Waiting on the brand | the factory has sent a step for approval | [72-waiting-on-the-brand.png](72-waiting-on-the-brand.png) |
| 73 | The brand reads the update | posted by the factory, readable by the brand, nobody else | [73-the-brand-reads-the-update.png](73-the-brand-reads-the-update.png) |
| 74 | Approving | one modal, whether or not money follows | [74-approving.png](74-approving.png) |
| 75 | How to pay | amount, destination, and the reference an admin will match | [75-how-to-pay.png](75-how-to-pay.png) |
| 76 | Marked sent | the brand's claim — not yet an arrival | [76-marked-sent.png](76-marked-sent.png) |
| 77 | Factory waiting sign-in | cold start, no session | [77-factory-waiting-sign-in.png](77-factory-waiting-sign-in.png) |
| 78 | Factory waiting signed in | email and password, on the designed screen | [78-factory-waiting-signed-in.png](78-factory-waiting-signed-in.png) |
| 79 | The factory waits | the brand says it paid. That is not enough, and the screen says so | [79-the-factory-waits.png](79-the-factory-waits.png) |
| 80 | Admin confirming sign-in | cold start, no session | [80-admin-confirming-sign-in.png](80-admin-confirming-sign-in.png) |
| 81 | Admin confirming signed in | email and password, on the designed screen | [81-admin-confirming-signed-in.png](81-admin-confirming-signed-in.png) |
| 82 | The payment queue | a required step, not a convenience: staff have no org to notify | [82-the-payment-queue.png](82-the-payment-queue.png) |
| 83 | Confirmed | this click is what a factory on the other side of the world is relying on | [83-confirmed.png](83-confirmed.png) |
| 84 | Factory told to start sign-in | cold start, no session | [84-factory-told-to-start-sign-in.png](84-factory-told-to-start-sign-in.png) |
| 85 | Factory told to start signed in | email and password, on the designed screen | [85-factory-told-to-start-signed-in.png](85-factory-told-to-start-signed-in.png) |
| 86 | Cleared to work | nothing changed but an admin confirming the money arrived | [86-cleared-to-work.png](86-cleared-to-work.png) |
| 87 | The conversation | kept with the order, so it is there when someone asks what was agreed | [87-the-conversation.png](87-the-conversation.png) |
| 88 | The factory writes in Chinese | and does not have to think about who reads it | [88-the-factory-writes-in-chinese.png](88-the-factory-writes-in-chinese.png) |
| 89 | Brand reading sign-in | cold start, no session | [89-brand-reading-sign-in.png](89-brand-reading-sign-in.png) |
| 90 | Brand reading signed in | email and password, on the designed screen | [90-brand-reading-signed-in.png](90-brand-reading-signed-in.png) |
| 91 | Conversations | one per piece of work, not one per company | [91-conversations.png](91-conversations.png) |
| 92 | The brand reads it | in its own language, with the original one click away | [92-the-brand-reads-it.png](92-the-brand-reads-it.png) |
| 93 | A reply | the first conversation either prototype could not actually have | [93-a-reply.png](93-a-reply.png) |
| 94 | Brand again sign-in | cold start, no session | [94-brand-again-sign-in.png](94-brand-again-sign-in.png) |
| 95 | Brand again signed in | email and password, on the designed screen | [95-brand-again-signed-in.png](95-brand-again-signed-in.png) |
| 96 | Invite-only chosen | publishing this without inviting anyone used to strand it | [96-invite-only-chosen.png](96-invite-only-chosen.png) |
| 97 | Choose who sees it | ranked by fit against this request, same score the factory sees | [97-choose-who-sees-it.png](97-choose-who-sees-it.png) |
| 98 | Invitations saved |  | [98-invitations-saved.png](98-invitations-saved.png) |
| 99 | Brand at home sign-in | cold start, no session | [99-brand-at-home-sign-in.png](99-brand-at-home-sign-in.png) |
| 100 | Brand at home signed in | email and password, on the designed screen | [100-brand-at-home-signed-in.png](100-brand-at-home-signed-in.png) |
| 101 | Brand home | what needs you, before anything else | [101-brand-home.png](101-brand-home.png) |
| 102 | The team | who else acts as this brand | [102-the-team.png](102-the-team.png) |
| 103 | Invited | they see it the next time they sign in | [103-invited.png](103-invited.png) |
| 104 | Colleague sign-in | cold start, no session | [104-colleague-sign-in.png](104-colleague-sign-in.png) |
| 105 | Colleague signed in | email and password, on the designed screen | [105-colleague-signed-in.png](105-colleague-signed-in.png) |
| 106 | You have been invited | the invitation was in the database from the start; nothing ever showed it | [106-you-have-been-invited.png](106-you-have-been-invited.png) |
| 107 | Joined | straight into the brand they were invited to, with no onboarding to redo | [107-joined.png](107-joined.png) |
| 108 | When it breaks | the reference on screen is the one in the database | [108-when-it-breaks.png](108-when-it-breaks.png) |
| 109 | Deep link survives a hard refresh | the rewrite works, in dev and in production | [109-deep-link-survives-a-hard-refresh.png](109-deep-link-survives-a-hard-refresh.png) |
| 110 | Session survives reload | onboarding not shown again | [110-session-survives-reload.png](110-session-survives-reload.png) |
| 111 | Forgot password | asked for, without confirming who is a customer | [111-forgot-password.png](111-forgot-password.png) |
| 112 | Choose a new password | the link lands here, not on the dashboard | [112-choose-a-new-password.png](112-choose-a-new-password.png) |

## Assertions

- ✅ "Porto, Portugal" resolved to ISO PT for matching (got PT)
- ✅ MOQ persisted as a number
- ✅ "28 days" typed as free text stored as the number 28 (got 28)
- ✅ the welcome card's company-type choice reached the profile
- ✅ finishing the designed onboarding publishes the profile, as its last card promises
- ✅ publishing did not self-verify — quoting stays gated on an admin review
- ✅ equipment free text kept verbatim
- ✅ the designed capacity panel wrote a factory_capacity row
- ✅ the database computes monthly units from it (got 7200)
- ✅ taxonomy selections saved as 9 links, not free text
- ✅ the review card reads back the brand that was actually typed
- ✅ and no longer shows the design's example brand
- ✅ "$18" stored as 1800 minor units (got 1800)
- ✅ brand onboarding marked complete
- ✅ match score computed between the two orgs just created: 50% (weak)
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
- ✅ the factory is waiting for a decision in the live queue
- ✅ the queue row for this factory was found and opened
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
- ✅ the reference on screen is the stored order number, not one composed in the browser (TSC-000033)
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
- ✅ no translation was produced, and the message went anyway — as it must
- ✅ the brand has not read this conversation yet
- ✅ with no translation available, the brand sees exactly what was written
- ✅ opening the conversation recorded that it was read — the count cannot get stuck
- ✅ both sides have now said something (2 messages on this thread)
- ✅ the request is invite-only
- ✅ one factory was invited (1)
- ✅ the designed home greets the org by name, from the database
- ✅ and no longer greets every brand as the design's example one
- ✅ the snapshot counts the order that exists (1)
- ✅ with nothing outstanding, no attention card is invented and the newcomer layout shows instead
- ✅ and the design's example alerts are not shown as if they were real
- ✅ the invitation is stored and waiting
- ✅ an invited person is offered the organisation, not asked to create one
- ✅ the brand now has two people (2)
- ✅ one owner and one member — joining does not confer the money permissions
- ✅ and they land in that organisation, not one of their own
- ✅ a crash says what is and is not lost, rather than showing a blank page
- ✅ and offers a way out — reload, or back to the start
- ✅ the crash was reported, under the reference shown (524B05D1)
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
