# End-to-end evidence

Recorded 2026-11-11T15:59:33.686Z against `http://127.0.0.1:5214/app.html`.

**243 steps, 557 assertions, 1 failed.**

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
| 35 | Factory approved | approving the company verifies it, which unlocks quoting | [35-factory-approved.png](35-factory-approved.png) |
| 36 | Brand approved | both sides verified before either can trade | [36-brand-approved.png](36-brand-approved.png) |
| 37 | Operations workspace | the designed admin console, on marketplace data | [37-operations-workspace.png](37-operations-workspace.png) |
| 38 | Marketplace quotes | every quote across the marketplace, staff only | [38-marketplace-quotes.png](38-marketplace-quotes.png) |
| 39 | Brand returning sign-in | cold start, no session | [39-brand-returning-sign-in.png](39-brand-returning-sign-in.png) |
| 40 | Brand returning signed in | email and password, on the designed screen | [40-brand-returning-signed-in.png](40-brand-returning-signed-in.png) |
| 41 | Second tab sign-in | cold start, no session | [41-second-tab-sign-in.png](41-second-tab-sign-in.png) |
| 42 | Second tab signed in | email and password, on the designed screen | [42-second-tab-signed-in.png](42-second-tab-signed-in.png) |
| 43 | Brand profile | its own answers on the designed profile page | [43-brand-profile.png](43-brand-profile.png) |
| 44 | Edit brand overview | the designed dialog, starting from what onboarding saved | [44-edit-brand-overview.png](44-edit-brand-overview.png) |
| 45 | Brand profile completion | the checklist behind the profile's percentage | [45-brand-profile-completion.png](45-brand-profile-completion.png) |
| 46 | Brand requests | the designed screen, empty until the first one is written | [46-brand-requests.png](46-brand-requests.png) |
| 47 | Describe what you need | Queena's first flow card, on her chrome | [47-describe-what-you-need.png](47-describe-what-you-need.png) |
| 48 | Review the brief | filled from the brief itself, and correctable | [48-review-the-brief.png](48-review-the-brief.png) |
| 49 | The brief, corrected | every field is the brand's, not the model's | [49-the-brief-corrected.png](49-the-brief-corrected.png) |
| 50 | Choose who sees it | the design's own toggle decides open or invite-only | [50-choose-who-sees-it.png](50-choose-who-sees-it.png) |
| 51 | RFQ published | the design's own success step, not a jump to the request page | [51-rfq-published.png](51-rfq-published.png) |
| 52 | Factory again sign-in | cold start, no session | [52-factory-again-sign-in.png](52-factory-again-sign-in.png) |
| 53 | Factory again signed in | email and password, on the designed screen | [53-factory-again-signed-in.png](53-factory-again-signed-in.png) |
| 54 | Factory dashboard | still unverified, so it may look but not bid | [54-factory-dashboard.png](54-factory-dashboard.png) |
| 55 | Factory profile | its own answers on the designed profile page | [55-factory-profile.png](55-factory-profile.png) |
| 56 | Edit overview | the designed dialog, starting from what onboarding saved | [56-edit-overview.png](56-edit-overview.png) |
| 57 | Profile completion | the checklist behind the profile's percentage | [57-profile-completion.png](57-profile-completion.png) |
| 58 | Add a sample image | a real upload, with the name and description brands will read | [58-add-a-sample-image.png](58-add-a-sample-image.png) |
| 59 | Trading company profile | the trading company's own design, with its real answers | [59-trading-company-profile.png](59-trading-company-profile.png) |
| 60 | Factory browse | the brand's request, found by a factory that was never invited | [60-factory-browse.png](60-factory-browse.png) |
| 61 | Factory reads the request | every field traces to a stored column, none of it is copy | [61-factory-reads-the-request.png](61-factory-reads-the-request.png) |
| 62 | Factory quoting sign-in | cold start, no session | [62-factory-quoting-sign-in.png](62-factory-quoting-sign-in.png) |
| 63 | Factory quoting signed in | email and password, on the designed screen | [63-factory-quoting-signed-in.png](63-factory-quoting-signed-in.png) |
| 64 | RFQ details | the screen a vendor gets before it has quoted | [64-rfq-details.png](64-rfq-details.png) |
| 65 | Saved | one nav item that used to go nowhere | [65-saved.png](65-saved.png) |
| 66 | Factory's view of a brand | what the brand told vendors, nothing private | [66-factory-s-view-of-a-brand.png](66-factory-s-view-of-a-brand.png) |
| 67 | The quote | Queena's submit screen, on a real draft row | [67-the-quote.png](67-the-quote.png) |
| 68 | Factory quote | prose on screen, taxonomy ids and rows underneath | [68-factory-quote.png](68-factory-quote.png) |
| 69 | Review quote | totals and the credit price, before paying it | [69-review-quote.png](69-review-quote.png) |
| 70 | Quote sent | and the factory is promised an answer either way | [70-quote-sent.png](70-quote-sent.png) |
| 71 | Revise notice | the cost of editing a sent quote, before it happens | [71-revise-notice.png](71-revise-notice.png) |
| 72 | Revision sent | version 2 in the brand's comparison, version 1 kept as history | [72-revision-sent.png](72-revision-sent.png) |
| 73 | Teammate sign-in | cold start, no session | [73-teammate-sign-in.png](73-teammate-sign-in.png) |
| 74 | Teammate signed in | email and password, on the designed screen | [74-teammate-signed-in.png](74-teammate-signed-in.png) |
| 75 | No Quote flow: the composer | the missing permission, named | [75-no-quote-flow-the-composer.png](75-no-quote-flow-the-composer.png) |
| 76 | No Quote flow: the contract | the quote reads back; Create production steps greyed out | [76-no-quote-flow-the-contract.png](76-no-quote-flow-the-contract.png) |
| 77 | Brand deciding sign-in | cold start, no session | [77-brand-deciding-sign-in.png](77-brand-deciding-sign-in.png) |
| 78 | Brand deciding signed in | email and password, on the designed screen | [78-brand-deciding-signed-in.png](78-brand-deciding-signed-in.png) |
| 79 | Quotes received | Queena's quote list, every figure derived from stored columns | [79-quotes-received.png](79-quotes-received.png) |
| 80 | Contract terms | the quote read back before anything is committed | [80-contract-terms.png](80-contract-terms.png) |
| 81 | Awarded | the loop closes here, on the order it created | [81-awarded.png](81-awarded.png) |
| 82 | Production orders | the brand's side of the work it just commissioned | [82-production-orders.png](82-production-orders.png) |
| 83 | The brand's own tab | added, filed into and reloaded: it is saved now | [83-the-brand-s-own-tab.png](83-the-brand-s-own-tab.png) |
| 84 | The order | before the brand confirms the steps, the builder is the whole screen | [84-the-order.png](84-the-order.png) |
| 85 | The schedule | drafted from the quote; the brand sets it | [85-the-schedule.png](85-the-schedule.png) |
| 86 | Brand confirms the steps | its confirmation alone starts the order | [86-brand-confirms-the-steps.png](86-brand-confirms-the-steps.png) |
| 87 | Fund first payment | Stripe's card form in the designed screen, fee and total beside it | [87-fund-first-payment.png](87-fund-first-payment.png) |
| 88 | Winning factory sign-in | cold start, no session | [88-winning-factory-sign-in.png](88-winning-factory-sign-in.png) |
| 89 | Winning factory signed in | email and password, on the designed screen | [89-winning-factory-signed-in.png](89-winning-factory-signed-in.png) |
| 90 | Factory hears the outcome | award_quote wrote this row; now something shows it | [90-factory-hears-the-outcome.png](90-factory-hears-the-outcome.png) |
| 91 | Factory's orders | its own designed list, live | [91-factory-s-orders.png](91-factory-s-orders.png) |
| 92 | Factory's own tab | its "..." had no menu; now it files orders too | [92-factory-s-own-tab.png](92-factory-s-own-tab.png) |
| 93 | The order, active | the designed header, on production_order_summary | [93-the-order-active.png](93-the-order-active.png) |
| 94 | Posting an update | a note and photographs, from the design's Add update dialog | [94-posting-an-update.png](94-posting-an-update.png) |
| 95 | Update posted | the brand decides; the factory does not mark its own work done | [95-update-posted.png](95-update-posted.png) |
| 96 | Bank details for manual payouts | the whole number, typed twice; only the last four come back | [96-bank-details-for-manual-payouts.png](96-bank-details-for-manual-payouts.png) |
| 97 | The factory waits | nothing is held yet, and the screen says so | [97-the-factory-waits.png](97-the-factory-waits.png) |
| 98 | Teammate on the order sign-in | cold start, no session | [98-teammate-on-the-order-sign-in.png](98-teammate-on-the-order-sign-in.png) |
| 99 | Teammate on the order signed in | email and password, on the designed screen | [99-teammate-on-the-order-signed-in.png](99-teammate-on-the-order-signed-in.png) |
| 100 | No Release funds | Fund greyed out, permission on hover | [100-no-release-funds.png](100-no-release-funds.png) |
| 101 | Release funds given | Fund step, live | [101-release-funds-given.png](101-release-funds-given.png) |
| 102 | Removed while open | the page says so at once | [102-removed-while-open.png](102-removed-while-open.png) |
| 103 | Brand funding sign-in | cold start, no session | [103-brand-funding-sign-in.png](103-brand-funding-sign-in.png) |
| 104 | Brand funding signed in | email and password, on the designed screen | [104-brand-funding-signed-in.png](104-brand-funding-signed-in.png) |
| 105 | Fund before approving | approval needs the money held | [105-fund-before-approving.png](105-fund-before-approving.png) |
| 106 | The brand reads the update | on the step's row, over the order | [106-the-brand-reads-the-update.png](106-the-brand-reads-the-update.png) |
| 107 | Fund | one required tick, then the card | [107-fund.png](107-fund.png) |
| 108 | Factory, funded sign-in | cold start, no session | [108-factory-funded-sign-in.png](108-factory-funded-sign-in.png) |
| 109 | Factory, funded signed in | email and password, on the designed screen | [109-factory-funded-signed-in.png](109-factory-funded-signed-in.png) |
| 110 | Funded | the factory can rely on money TSC holds, not on the brand's word | [110-funded.png](110-funded.png) |
| 111 | Brand approving sign-in | cold start, no session | [111-brand-approving-sign-in.png](111-brand-approving-sign-in.png) |
| 112 | Brand approving signed in | email and password, on the designed screen | [112-brand-approving-signed-in.png](112-brand-approving-signed-in.png) |
| 113 | Approve dialog | the designed dialog: approving releases what TSC holds | [113-approve-dialog.png](113-approve-dialog.png) |
| 114 | Approved | the step is done and its payout requested | [114-approved.png](114-approved.png) |
| 115 | Admin paying out sign-in | cold start, no session | [115-admin-paying-out-sign-in.png](115-admin-paying-out-sign-in.png) |
| 116 | Admin paying out signed in | email and password, on the designed screen | [116-admin-paying-out-signed-in.png](116-admin-paying-out-signed-in.png) |
| 117 | The payments board | a required step: staff have no org to notify | [117-the-payments-board.png](117-the-payments-board.png) |
| 118 | Paid out by bank | for a factory Stripe cannot pay | [118-paid-out-by-bank.png](118-paid-out-by-bank.png) |
| 119 | Pay with Wise | the statement Wise needs for CNY, before any money moves | [119-pay-with-wise.png](119-pay-with-wise.png) |
| 120 | Pay with PayPal | asks once, naming the amount and the address | [120-pay-with-paypal.png](120-pay-with-paypal.png) |
| 121 | Marked paid out | a PayPal factory paid another way: the reference is what it reads | [121-marked-paid-out.png](121-marked-paid-out.png) |
| 122 | A factory's earnings | Paid, Awaiting approval, and the withdrawal with its reference | [122-a-factory-s-earnings.png](122-a-factory-s-earnings.png) |
| 123 | Admin paying out sign-in | cold start, no session | [123-admin-paying-out-sign-in.png](123-admin-paying-out-sign-in.png) |
| 124 | Admin paying out signed in | email and password, on the designed screen | [124-admin-paying-out-signed-in.png](124-admin-paying-out-signed-in.png) |
| 125 | Factory paid sign-in | cold start, no session | [125-factory-paid-sign-in.png](125-factory-paid-sign-in.png) |
| 126 | Factory paid signed in | email and password, on the designed screen | [126-factory-paid-signed-in.png](126-factory-paid-signed-in.png) |
| 127 | Paid out | the step done and the money with the factory | [127-paid-out.png](127-paid-out.png) |
| 128 | The conversation | kept with the order, so it is there when someone asks what was agreed | [128-the-conversation.png](128-the-conversation.png) |
| 129 | The factory writes in Chinese | and does not have to think about who reads it | [129-the-factory-writes-in-chinese.png](129-the-factory-writes-in-chinese.png) |
| 130 | Brand reading sign-in | cold start, no session | [130-brand-reading-sign-in.png](130-brand-reading-sign-in.png) |
| 131 | Brand reading signed in | email and password, on the designed screen | [131-brand-reading-signed-in.png](131-brand-reading-signed-in.png) |
| 132 | Conversations | one per piece of work, not one per company | [132-conversations.png](132-conversations.png) |
| 133 | The brand reads it | the original first, with English translation on request | [133-the-brand-reads-it.png](133-the-brand-reads-it.png) |
| 134 | A reply | the first conversation either prototype could not actually have | [134-a-reply.png](134-a-reply.png) |
| 135 | It arrives live | the other side's message appears while the page is open | [135-it-arrives-live.png](135-it-arrives-live.png) |
| 136 | A file | Attach file works, and the other side can open it | [136-a-file.png](136-a-file.png) |
| 137 | Contact details after a contract | the order's conversation delivers a phone number | [137-contact-details-after-a-contract.png](137-contact-details-after-a-contract.png) |
| 138 | Brand proposing a call sign-in | cold start, no session | [138-brand-proposing-a-call-sign-in.png](138-brand-proposing-a-call-sign-in.png) |
| 139 | Brand proposing a call signed in | email and password, on the designed screen | [139-brand-proposing-a-call-signed-in.png](139-brand-proposing-a-call-signed-in.png) |
| 140 | Schedule call | the designed dialog: a real month, times in your zone | [140-schedule-call.png](140-schedule-call.png) |
| 141 | Call details |  | [141-call-details.png](141-call-details.png) |
| 142 | Invite sent | Waiting for the factory to answer | [142-invite-sent.png](142-invite-sent.png) |
| 143 | Session ended elsewhere | sending a call leads to sign-in | [143-session-ended-elsewhere.png](143-session-ended-elsewhere.png) |
| 144 | Factory answering a call sign-in | cold start, no session | [144-factory-answering-a-call-sign-in.png](144-factory-answering-a-call-sign-in.png) |
| 145 | Factory answering a call signed in | email and password, on the designed screen | [145-factory-answering-a-call-signed-in.png](145-factory-answering-a-call-signed-in.png) |
| 146 | Propose another time | prefilled with the brand's title | [146-propose-another-time.png](146-propose-another-time.png) |
| 147 | Brand accepting a call sign-in | cold start, no session | [147-brand-accepting-a-call-sign-in.png](147-brand-accepting-a-call-sign-in.png) |
| 148 | Brand accepting a call signed in | email and password, on the designed screen | [148-brand-accepting-a-call-signed-in.png](148-brand-accepting-a-call-signed-in.png) |
| 149 | Call confirmed | Join opens 10 minutes before | [149-call-confirmed.png](149-call-confirmed.png) |
| 150 | Brand dashboard: Scheduled calls |  | [150-brand-dashboard-scheduled-calls.png](150-brand-dashboard-scheduled-calls.png) |
| 151 | Brand dashboard: Join call | a confirmed call is joinable before it starts | [151-brand-dashboard-join-call.png](151-brand-dashboard-join-call.png) |
| 152 | Factory dashboard with a call sign-in | cold start, no session | [152-factory-dashboard-with-a-call-sign-in.png](152-factory-dashboard-with-a-call-sign-in.png) |
| 153 | Factory dashboard with a call signed in | email and password, on the designed screen | [153-factory-dashboard-with-a-call-signed-in.png](153-factory-dashboard-with-a-call-signed-in.png) |
| 154 | Factory dashboard: Scheduled calls |  | [154-factory-dashboard-scheduled-calls.png](154-factory-dashboard-scheduled-calls.png) |
| 155 | Starting soon: Cancel call | cancellable until the start | [155-starting-soon-cancel-call.png](155-starting-soon-cancel-call.png) |
| 156 | Conversations at 375 | no sideways scroll | [156-conversations-at-375.png](156-conversations-at-375.png) |
| 157 | Settings → Notifications | the factory turns call and message emails off | [157-settings-notifications.png](157-settings-notifications.png) |
| 158 | Brand inviting again sign-in | cold start, no session | [158-brand-inviting-again-sign-in.png](158-brand-inviting-again-sign-in.png) |
| 159 | Brand inviting again signed in | email and password, on the designed screen | [159-brand-inviting-again-signed-in.png](159-brand-inviting-again-signed-in.png) |
| 160 | Factory turning emails back on sign-in | cold start, no session | [160-factory-turning-emails-back-on-sign-in.png](160-factory-turning-emails-back-on-sign-in.png) |
| 161 | Factory turning emails back on signed in | email and password, on the designed screen | [161-factory-turning-emails-back-on-signed-in.png](161-factory-turning-emails-back-on-signed-in.png) |
| 162 | Brand withdrawing the follow-up sign-in | cold start, no session | [162-brand-withdrawing-the-follow-up-sign-in.png](162-brand-withdrawing-the-follow-up-sign-in.png) |
| 163 | Brand withdrawing the follow-up signed in | email and password, on the designed screen | [163-brand-withdrawing-the-follow-up-signed-in.png](163-brand-withdrawing-the-follow-up-signed-in.png) |
| 164 | The email | in Mailpit: the designed frame, the notification, one button | [164-the-email.png](164-the-email.png) |
| 165 | Admin running the daily job sign-in | cold start, no session | [165-admin-running-the-daily-job-sign-in.png](165-admin-running-the-daily-job-sign-in.png) |
| 166 | Admin running the daily job signed in | email and password, on the designed screen | [166-admin-running-the-daily-job-signed-in.png](166-admin-running-the-daily-job-signed-in.png) |
| 167 | Daily jobs | run by hand on a test site | [167-daily-jobs.png](167-daily-jobs.png) |
| 168 | AI suggestions | no key on this site: nothing stands in | [168-ai-suggestions.png](168-ai-suggestions.png) |
| 169 | A suggested request | staff read and edit it; nothing is sent yet | [169-a-suggested-request.png](169-a-suggested-request.png) |
| 170 | Request sent | the factory's review now waits on it | [170-request-sent.png](170-request-sent.png) |
| 171 | Test data found | the list, and the rule in words, before anything is deleted | [171-test-data-found.png](171-test-data-found.png) |
| 172 | Confirm | nothing is deleted until staff confirm | [172-confirm.png](172-confirm.png) |
| 173 | Test data deleted | Deleted 2 companies, 0 orders, 0 users and 0 files. | [173-test-data-deleted.png](173-test-data-deleted.png) |
| 174 | Factory, credits sign-in | cold start, no session | [174-factory-credits-sign-in.png](174-factory-credits-sign-in.png) |
| 175 | Factory, credits signed in | email and password, on the designed screen | [175-factory-credits-signed-in.png](175-factory-credits-signed-in.png) |
| 176 | Credits | the designed Credits tab on the real ledger | [176-credits.png](176-credits.png) |
| 177 | Invite refused | the company's own email domain does not count | [177-invite-refused.png](177-invite-refused.png) |
| 178 | Invite sent | a Pending row until TSC verifies the invited factory | [178-invite-sent.png](178-invite-sent.png) |
| 179 | Invited factory sign-up | the designed vendor portal | [179-invited-factory-sign-up.png](179-invited-factory-sign-up.png) |
| 180 | Invited factory account details | name, company, email and password on one form | [180-invited-factory-account-details.png](180-invited-factory-account-details.png) |
| 181 | Invited factory signed up | an account, a name and a company in one submit | [181-invited-factory-signed-up.png](181-invited-factory-signed-up.png) |
| 182 | Factory, invite joined sign-in | cold start, no session | [182-factory-invite-joined-sign-in.png](182-factory-invite-joined-sign-in.png) |
| 183 | Factory, invite joined signed in | email and password, on the designed screen | [183-factory-invite-joined-signed-in.png](183-factory-invite-joined-signed-in.png) |
| 184 | Invite joined | still pending: it pays when TSC verifies them | [184-invite-joined.png](184-invite-joined.png) |
| 185 | Admin, credits sign-in | cold start, no session | [185-admin-credits-sign-in.png](185-admin-credits-sign-in.png) |
| 186 | Admin, credits signed in | email and password, on the designed screen | [186-admin-credits-signed-in.png](186-admin-credits-signed-in.png) |
| 187 | Adjust refused | a balance never goes below zero | [187-adjust-refused.png](187-adjust-refused.png) |
| 188 | Credits adjusted | staff add 50 with a reason the company sees | [188-credits-adjusted.png](188-credits-adjusted.png) |
| 189 | Invited factory, credits sign-in | cold start, no session | [189-invited-factory-credits-sign-in.png](189-invited-factory-credits-sign-in.png) |
| 190 | Invited factory, credits signed in | email and password, on the designed screen | [190-invited-factory-credits-signed-in.png](190-invited-factory-credits-signed-in.png) |
| 191 | Invited factory credits | its grant and the adjustment, with the reason | [191-invited-factory-credits.png](191-invited-factory-credits.png) |
| 192 | Factory, referral paid sign-in | cold start, no session | [192-factory-referral-paid-sign-in.png](192-factory-referral-paid-sign-in.png) |
| 193 | Factory, referral paid signed in | email and password, on the designed screen | [193-factory-referral-paid-signed-in.png](193-factory-referral-paid-signed-in.png) |
| 194 | Referral bonus | +500 once the invited factory was verified | [194-referral-bonus.png](194-referral-bonus.png) |
| 195 | Brand again sign-in | cold start, no session | [195-brand-again-sign-in.png](195-brand-again-sign-in.png) |
| 196 | Brand again signed in | email and password, on the designed screen | [196-brand-again-signed-in.png](196-brand-again-signed-in.png) |
| 197 | Invite-only chosen | publishing this without inviting anyone used to strand it | [197-invite-only-chosen.png](197-invite-only-chosen.png) |
| 198 | Choose who sees it | ranked by fit against this request, same score the factory sees | [198-choose-who-sees-it.png](198-choose-who-sees-it.png) |
| 199 | A vendor's profile, from the invite step | the brand's designed view of the vendor, real data | [199-a-vendor-s-profile-from-the-invite-step.png](199-a-vendor-s-profile-from-the-invite-step.png) |
| 200 | Invitations saved |  | [200-invitations-saved.png](200-invitations-saved.png) |
| 201 | Browse vendors | every verified, published vendor, on the designed marketplace | [201-browse-vendors.png](201-browse-vendors.png) |
| 202 | Filtered by Club Standard | each filter narrows the list, and the line under the count names it | [202-filtered-by-club-standard.png](202-filtered-by-club-standard.png) |
| 203 | List view filters at 950px | a dialog, with how many vendors match | [203-list-view-filters-at-950px.png](203-list-view-filters-at-950px.png) |
| 204 | Browse vendors, list view | the design's directory layout, same vendors and filters | [204-browse-vendors-list-view.png](204-browse-vendors-list-view.png) |
| 205 | Saved vendors | the vendors this brand saved, on the designed Saved page | [205-saved-vendors.png](205-saved-vendors.png) |
| 206 | Payments | the brand's order payments, on the designed Payments page | [206-payments.png](206-payments.png) |
| 207 | Brand at home sign-in | cold start, no session | [207-brand-at-home-sign-in.png](207-brand-at-home-sign-in.png) |
| 208 | Brand at home signed in | email and password, on the designed screen | [208-brand-at-home-signed-in.png](208-brand-at-home-signed-in.png) |
| 209 | Brand home | what needs you, before anything else | [209-brand-home.png](209-brand-home.png) |
| 210 | Cancellation proposed | from the order card's menu; nothing changes until the factory answers | [210-cancellation-proposed.png](210-cancellation-proposed.png) |
| 211 | Waiting on the factory | the banner the proposing side sees, with Withdraw | [211-waiting-on-the-factory.png](211-waiting-on-the-factory.png) |
| 212 | Factory answers sign-in | cold start, no session | [212-factory-answers-sign-in.png](212-factory-answers-sign-in.png) |
| 213 | Factory answers signed in | email and password, on the designed screen | [213-factory-answers-signed-in.png](213-factory-answers-signed-in.png) |
| 214 | The factory is asked | Keep order, or Accept cancellation | [214-the-factory-is-asked.png](214-the-factory-is-asked.png) |
| 215 | Cancelled | both sides agreed; the order says when and why | [215-cancelled.png](215-cancelled.png) |
| 216 | Brand after the cancellation sign-in | cold start, no session | [216-brand-after-the-cancellation-sign-in.png](216-brand-after-the-cancellation-sign-in.png) |
| 217 | Brand after the cancellation signed in | email and password, on the designed screen | [217-brand-after-the-cancellation-signed-in.png](217-brand-after-the-cancellation-signed-in.png) |
| 218 | Cancelled tab | the brand's cancelled order, with nothing to file | [218-cancelled-tab.png](218-cancelled-tab.png) |
| 219 | Factory after the cancellation sign-in | cold start, no session | [219-factory-after-the-cancellation-sign-in.png](219-factory-after-the-cancellation-sign-in.png) |
| 220 | Factory after the cancellation signed in | email and password, on the designed screen | [220-factory-after-the-cancellation-signed-in.png](220-factory-after-the-cancellation-signed-in.png) |
| 221 | Brand after the factory looked sign-in | cold start, no session | [221-brand-after-the-factory-looked-sign-in.png](221-brand-after-the-factory-looked-sign-in.png) |
| 222 | Brand after the factory looked signed in | email and password, on the designed screen | [222-brand-after-the-factory-looked-signed-in.png](222-brand-after-the-factory-looked-signed-in.png) |
| 223 | Reorder | the order's request, copied into a new draft | [223-reorder.png](223-reorder.png) |
| 224 | Reorder: invite | the same factory, ticked | [224-reorder-invite.png](224-reorder-invite.png) |
| 225 | The team | who else acts as this brand | [225-the-team.png](225-the-team.png) |
| 226 | Invited | name, title and permissions from the drawer; emailed | [226-invited.png](226-invited.png) |
| 227 | Resend too soon | said in words | [227-resend-too-soon.png](227-resend-too-soon.png) |
| 228 | Withdraw asks first |  | [228-withdraw-asks-first.png](228-withdraw-asks-first.png) |
| 229 | Colleague sign-in | cold start, no session | [229-colleague-sign-in.png](229-colleague-sign-in.png) |
| 230 | Colleague signed in | email and password, on the designed screen | [230-colleague-signed-in.png](230-colleague-signed-in.png) |
| 231 | You have been invited | the invitation was in the database from the start; nothing ever showed it | [231-you-have-been-invited.png](231-you-have-been-invited.png) |
| 232 | Joined | straight into the brand they were invited to, with no onboarding to redo | [232-joined.png](232-joined.png) |
| 233 | Invited while in a company | Join or Not now, over the current workspace | [233-invited-while-in-a-company.png](233-invited-while-in-a-company.png) |
| 234 | Joined from the banner | now in the factory's workspace | [234-joined-from-the-banner.png](234-joined-from-the-banner.png) |
| 235 | No RFQ flow: the quote form | the missing permission, named | [235-no-rfq-flow-the-quote-form.png](235-no-rfq-flow-the-quote-form.png) |
| 236 | Leave asks first | a member leaving the factory | [236-leave-asks-first.png](236-leave-asks-first.png) |
| 237 | Left | back in the brand | [237-left.png](237-left.png) |
| 238 | When it breaks | the reference on screen is the one in the database | [238-when-it-breaks.png](238-when-it-breaks.png) |
| 239 | Deep link survives a hard refresh | the rewrite works, in dev and in production | [239-deep-link-survives-a-hard-refresh.png](239-deep-link-survives-a-hard-refresh.png) |
| 240 | Session survives reload | onboarding not shown again | [240-session-survives-reload.png](240-session-survives-reload.png) |
| 241 | Forgot password | asked for, without confirming who is a customer | [241-forgot-password.png](241-forgot-password.png) |
| 242 | Choose a new password | the link lands here, not on the dashboard | [242-choose-a-new-password.png](242-choose-a-new-password.png) |
| 243 | Choose a new password, behind a block | the link is verified through our own host | [243-choose-a-new-password-behind-a-block.png](243-choose-a-new-password-behind-a-block.png) |

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
- ✅ the review page says who was emailed (Email to the company The request for more information: e2e-factory-1794412362292@example.com Sent · Nov 11, 2026, 10:53 )
- ✅ and the email carries the request exactly as staff wrote it
- ✅ the review summary shows the note just sent, without a reload
- ✅ and the badge says Needs information
- ✅ and Profile status says the same (Needs information)
- ✅ no chip heading is drawn without chips (0)
- ✅ the factory lands on its profile summary, with no extra page first
- ✅ the factory sends its profile back to staff's queue
- ✅ and staff are emailed, with a link to the review
- ✅ Approve is greyed until a registry check finds the company
- ✅ the registry check is recorded on the review page (the Registry row says found)
- ✅ Profile completeness is still shown after approval (63%)
- ✅ the factory is now verified in the database
- ✅ and approved at the Basic trust tier (got basic)
- ✅ the database granted 500 credits on approval, once ([{"delta":500}])
- ✅ the factory's balance is 500 (500)
- ✅ and its bell says so
- ✅ the queue row for this brand was found and opened
- ✅ the brand is now verified too
- ✅ the operations workspace opens for staff
- ✅ and does not turn away an account that is on the admin list
- ✅ the verification queue reads the marketplace rather than erroring
- ✅ the queue loaded rather than erroring
- ✅ the marketplace-wide quote table opens
- ✅ an open request says it is open to all, not how many were invited (RFQ-8cc9decd Organic cotton shirting, SS27 Demo Brand Nov 11 Open to all vendors)
- ✅ with Keep me logged in unticked, a second tab opens signed out
- ✅ the first tab is still the brand after the second signs in as the factory
- ✅ and still the brand after a reload
- ✅ the profile is the brand's own, by the name it gave
- ✅ with its revenue band, which only the brand itself sees
- ✅ none of the design's example brand, and no Publish button
- ✅ View as public leaves the revenue out, as vendors will see it
- ✅ saving closes the brand's dialog
- ✅ and the new overview is the saved profile
- ✅ the brand's completion page shows the same 57% as its profile
- ✅ with no payment-method item, which nothing stores
- ✅ a brand with no requests is told so, not shown a blank panel
- ✅ the tab counts are real, not the mock's literals (Active quotes (0))
- ✅ a draft row exists before the review card is filled in
- ✅ the review card reads a specific category out of the brief (Womenswear / woven shirts)
- ✅ the review card reads the quantity and colour split out of the brief
- ✅ the calendar sets the quote deadline to the day picked (2026-12-20)
- ✅ each vendor carries a real fit score against this request
- ✅ the request summary beside it is this request, not the design's example shirt
- ✅ the request is open and accepting quotes
- ✅ published to every factory, per the choice on screen
- ✅ quantity persisted as a number
- ✅ "$18" stored as 1800 minor units (got 1800)
- ✅ who buys the materials is recorded, so quotes are comparable
- ✅ the picked date is stored as a real deadline, the end of 2026-12-20 (2026-12-21T04:59:59+00:00)
- ✅ requirements saved as 3 taxonomy links, not free text
- ✅ a delivery month is set, so capacity counts toward matching
- ✅ the brand's own question is saved (1 question(s) in total)
- ✅ "3 colors, 100 each" became 3 rows, not a display string
- ✅ each row carries its own quantity
- ✅ the factory scores 42% against this specific request
- ✅ signing back in skips onboarding and lands on the dashboard
- ✅ the profile is the factory's own, by the name it gave
- ✅ the MOQ and nearest port onboarding saved are on it
- ✅ the free-text equipment becomes one tag per machine
- ✅ none of the design's example factory, and no Publish button
- ✅ View as public switches to what brands see
- ✅ saving closes the dialog
- ✅ and the new overview is on the profile
- ✅ it is the saved profile, not just the screen
- ✅ the completion page shows the same 63% as the profile
- ✅ with none of the design's example checks
- ✅ the new image is in the dialog with its name and description
- ✅ and on the profile's samples card
- ✅ stored as a public sample image, name and description with it
- ✅ a trading company gets its own designed profile, under its own name
- ✅ none of the design's example company
- ✅ the commercial-terms dialog saves, and the profile shows it
- ✅ into the trading company's own column
- ✅ the request a brand published minutes ago is visible to a factory
- ✅ the quantity the brand typed reaches the factory's card
- ✅ the brand is named, not anonymous — nobody quotes a stranger
- ✅ an approved factory browses without the look-but-do-not-bid gate
- ✅ the request the brand published is the one on screen
- ✅ the quantity the brand typed is what the factory reads
- ✅ the brand's question reaches the factory
- ✅ no brand contact details leak into the factory's view
- ✅ and is not told it may read but not quote, because it may now do both
- ✅ no request match panel or figure is shown to the factory about itself
- ✅ the brand behind the request is named from the database
- ✅ and the design's example brand is nowhere on it
- ✅ with Send quote as the primary action
- ✅ the saved request is on the Saved page
- ✅ the factory reads the brand's own profile
- ✅ and not its revenue, nor the design's example brand
- ✅ Save brand saves it
- ✅ and it is under Saved brands
- ✅ the quote field "unitPrice" can actually be typed into
- ✅ "unitPrice" holds what was typed ($17.10 / unit)
- ✅ the quote field "quantity" can actually be typed into
- ✅ "quantity" holds what was typed (300 units)
- ✅ the quote field "leadTime" can actually be typed into
- ✅ "leadTime" holds what was typed (26 days)
- ✅ the quote field "capacityWindow" can actually be typed into
- ✅ "capacityWindow" holds what was typed (2026-12-21 to 2027-01-10 · 300 units)
- ✅ the quote field "paymentTerms" can actually be typed into
- ✅ "paymentTerms" holds what was typed (30% deposit / 70% before shipment)
- ✅ the quote field "incoterms" can actually be typed into
- ✅ "incoterms" holds what was typed (FOB quoted)
- ✅ "validUntil" holds the date picked (2026-12-11)
- ✅ the quote field "sample.0.stage" can actually be typed into
- ✅ "sample.0.stage" holds what was typed (Fit sample)
- ✅ the quote field "sample.0.cost" can actually be typed into
- ✅ "sample.0.cost" holds what was typed ($95)
- ✅ the quote field "sample.0.timing" can actually be typed into
- ✅ "sample.0.timing" holds what was typed (10 days)
- ✅ the quote field "sample.1.stage" can actually be typed into
- ✅ "sample.1.stage" holds what was typed (PP sample)
- ✅ the quote field "sample.1.cost" can actually be typed into
- ✅ "sample.1.cost" holds what was typed ($165)
- ✅ the review step names what sending costs
- ✅ and totals the quote that was actually typed
- ✅ not the design's example price
- ✅ the bottom bar offers the send, at its price
- ✅ the quote was accepted
- ✅ sending charged 25 credits (500 → 475)
- ✅ the confirmation shows the vendor's own figures
- ✅ the quote is submitted (submitted)
- ✅ "$17.10 / unit" became 1710 minor units (1710)
- ✅ the quantity is a number
- ✅ '30% deposit / 70%' matched a payment term rather than being stored as prose
- ✅ 'FOB quoted' matched an incoterm
- ✅ the deposit split came with it (30%) — without one the order's schedule is unagreeable
- ✅ the sample plan is 2 rows, not a drawn plan
- ✅ the samples subtotal is computed from the rows (26000)
- ✅ editing a sent quote says what sending it again costs first
- ✅ the quote field "unitPrice" can actually be typed into
- ✅ "unitPrice" holds what was typed ($16.95 / unit)
- ✅ the bottom bar offers the send, at its price
- ✅ sending the revision charged again (475 → 450)
- ✅ the revision is version 2 at $16.95, and version 1 is kept as superseded ([{"version":1,"status":"superseded","unit_price_cents":1710},{"version":2,"status":"submitted","unit_price_cents":1695}])
- ✅ the owner invites a teammate with Approve samples only (200 )
- ✅ they join as a member with exactly what was ticked, and the title ({"role":"member","permissions":["approve"],"title":"Production lead"})
- ✅ the composer says which permission is missing (You need the Quote flow permission at Maison E2E 1794412362292 for this. An owner can give it to you in Settings.)
- ✅ in place of the composer, not under it
- ✅ the contract's greyed button names the permission on hover
- ✅ and "Create production steps" is greyed out, not hidden ([{"label":"Create production steps","disabled":true,"title":"Needs the Quote flow permission"}])
- ✅ both quotes are listed (2 cards)
- ✅ the list shows the same total the factory saw, not a re-parsed string
- ✅ the quoting factory is named on its card
- ✅ the quoting factory has a card (position 2)
- ✅ the terms are this quote's, not the design's example
- ✅ the chosen quote is accepted
- ✅ the other quote was auto-declined in the same transaction
- ✅ the request is closed
- ✅ awarding created a production order — nobody pressed another button
- ✅ both factories were notified (2) — nobody quotes into silence
- ✅ the awarded work appears as an order (1 card)
- ✅ the designed card is showing a real request title, not the mock one
- ✅ and no mock counterparty leaked through — the constants are not being read
- ✅ a new tab opens, empty, and says how to fill it
- ✅ after a reload the tab is still there, with the order in it
- ✅ Manage tabs renamed and moved it, and that survived a reload (Active orders (1) | Spring 2292 capsule | Closed (0))
- ✅ the menu marks the tab the order is in (✓ Spring 2292 capsule)
- ✅ choosing a ✓ tab again takes the order out of it
- ✅ a schedule was generated from the quote, not typed (6 steps)
- ✅ the factory's own sample stages became the first steps
- ✅ the steps total exactly what was agreed (534500)
- ✅ nobody faces a blank schedule — 6 steps are already there
- ✅ with no unsaved changes the builder's hint says nothing
- ✅ there is no "Agree to this schedule" any more
- ✅ "Continue to funding" lands on the first payment's Fund screen
- ✅ the Fund screen draws Stripe's Payment Element inside the design's billing card
- ✅ the brand confirming the steps starts the order
- ✅ no factory agreement was needed
- ✅ the winning factory is told on its dashboard, without asking
- ✅ /notifications opens the dashboard's Activity drawer
- ✅ the factory's designed order list shows the real request
- ✅ and none of the factory design's example brands
- ✅ the factory never sees how the brand filed the order
- ✅ the factory files the order under a tab of its own, from the card's new menu
- ✅ the factory has no schedule to agree
- ✅ the header total is the sum of the steps, not a literal ($5,345.00)
- ✅ nothing is paid yet ($0.00)
- ✅ activation created one payment per paying step and none for the rest (4)
- ✅ the factory's update dialog has one button, Post update: no "send for approval"
- ✅ the update was stored
- ✅ the update attached to the step that opened the composer, not to the first one on the page
- ✅ posting is all the factory does: the step stays open, for the brand to approve from the update
- ✅ the list opens on the factory's own country
- ✅ where Stripe can pay out, PayPal is offered beside the bank account (#92)
- ✅ where it cannot, a bank or PayPal, and Payoneer can no longer be chosen
- ✅ a bank in mainland China is set up on Wise's form
- ✅ a bank elsewhere gets the form staff pay from by hand
- ✅ the factory can say where staff pay it by bank
- ✅ and the bank's country is kept with it
- ✅ the open step's payment is due before any work is approved
- ✅ the factory is told plainly the brand has not funded the step yet
- ✅ and nothing says the money is held
- ✅ without Release funds the due step's Fund is greyed out, not hidden, with no sentence
- ✅ the owner gives Release funds and Fund appears on the open page, no reload (630 ms)
- ✅ the owner takes it away: Fund greys out and the sentence returns (862 ms)
- ✅ removed while the page is open, they are told "You no longer have access to Maison E2E 1794412362292" (676 ms)
- ✅ and the membership is gone
- ✅ and no company is created for them from their signup answers
- ✅ and the database no longer shows them the order
- ✅ an unfunded paid step offers "Fund step", not "Approve" (Fund step)
- ✅ the brand can read the factory's update across the org boundary
- ✅ a step link opens its pop-up on top of the order, with the timeline behind it
- ✅ approving an unfunded paid step is refused (fund "Fit sample" first: TSC pays the factory from the money it holds when you approve)
- ✅ Fund asks for one tick, not two
- ✅ and it says where this step's money goes (Before funding I understand funds are released after I approve this step.)
- ✅ it starts unticked, with the pay button greyed
- ✅ checkout gives the Payment Element its client secret (200)
- ✅ the charge is the step plus the service fee (5%)
- ✅ Stripe's answer is recorded: held by TSC (confirmed)
- ✅ with the card it was paid by (Visa ···4242)
- ✅ the money is held by TSC, and nothing is owed to the factory yet
- ✅ the header moved because a payment row moved (9500)
- ✅ the next step waits for the brand's approval, not for the money
- ✅ the same step that said "awaiting funding" now awaits the brand's approval
- ✅ and the order activity says the money is funded and held by TSC
- ✅ once funded, the step offers "Approve" (Approve)
- ✅ the dialog says approving releases the step's amount, without the fee
- ✅ the note typed in the approve dialog is stored with the approval
- ✅ approving a funded step completes it
- ✅ and asks for the factory's payout
- ✅ a factory with no Stripe account is not paid automatically; staff pay it (confirmed)
- ✅ the next step opened on the approval
- ✅ the payments board is its own page (Payments)
- ✅ the approved payment is under "Payout owed", named by its order
- ✅ with the factory's bank details to pay it by hand
- ✅ and no Pay with Wise or PayPal: its method is neither
- ✅ the row asks for the bank's reference
- ✅ and staff cannot mark it paid without one
- ✅ staff mark it paid out by bank, from its row
- ✅ and confirm it when asked
- ✅ the payment is paid out
- ✅ and stamped with which member of staff did it
- ✅ and the record says which account, and the reference
- ✅ the factory reads the reference
- ✅ a factory on Wise's form is paid with Wise, or by bank
- ✅ and Pay with Wise can be pressed, since its full number is on file
- ✅ a payment in CNY stops at Wise's statement, and Continue waits for its tick
- ✅ ticking it frees Continue
- ✅ Cancel goes back to Pay with Wise
- ✅ a factory with nothing set up says so on its row
- ✅ and there is no provider to pay it through
- ✅ a PayPal factory's row says so, with its address
- ✅ and offers Pay with PayPal
- ✅ it asks once first, naming the amount and the address
- ✅ Cancel goes back, and nothing moved
- ✅ a PayPal row doesn't offer Mark paid by bank: there are no bank details to send to
- ✅ the payment is paid out, with the reference
- ✅ the factory's card shows its balance and says it is paid by PayPal (PayPal kowloon-payouts@example.com)
- ✅ its withdrawals name the reference
- ✅ and each earning says where it stands: Paid once sent, Awaiting approval while the brand has not approved
- ✅ adding a method offers a bank or PayPal, not Payoneer
- ✅ two different emails cannot be saved, and Save says why
- ✅ a new PayPal account becomes the one TSC pays
- ✅ the factory's order says the step was paid
- ✅ the message is stored exactly as it was typed, character for character
- ✅ and attributed to the factory that sent it, not to whoever the screen assumed
- ✅ it was translated for the brand: "The cuff has been made according to the new size chart, plea"
- ✅ the translation is not simply a copy of the original
- ✅ the brand's bell says it in English, keeping the Chinese for a Chinese email ("The cuff has been made according to the ")
- ✅ the brand has not read this conversation yet
- ✅ the order's own conversation is listed (TSC-000044)
- ✅ the conversation opens at its newest message (0px from it)
- ✅ received messages show the original first
- ✅ the received message offers a translation
- ✅ the English translation appears on request
- ✅ and offers the original back
- ✅ Show Original restores the received text
- ✅ opening the conversation recorded that it was read — the count cannot get stuck
- ✅ both sides have now said something (2 delivered messages on this thread)
- ✅ pressing Send empties the box and draws the message once, at once (27 ms, 1 bubble)
- ✅ an insert the network delivers twice saves one message (1 row)
- ✅ and the sender sees it once, as sent (1 bubble, delivered)
- ✅ the factory's message was saved from its own session
- ✅ the factory's message appears on the brand's open page without a refresh (1138 ms)
- ✅ and the open conversation scrolls to it (0px from the newest)
- ✅ a new conversation from the other side arrives live with an unread badge of 1, and the open one stays open (badge "1", 0 read)
- ✅ a .txt is not offered, and refused in words if picked ("carton-notes.txt can't be attached. Attach a PDF, a photo (P")
- ✅ a file sent on its own is linked to its message and delivered (delivered)
- ✅ the factory can open the brand's file (200)
- ✅ the file is shown on the message, as a button that opens it
- ✅ sending a file scrolls only the conversation, never the page (page at 0px, 0px taller than the window)
- ✅ searching for TSC-000044 lists only its conversation (1)
- ✅ a search with no match says so ("No conversations match "no-such-run-mwcasg1g".")
- ✅ the conversation is still at its newest message (0px)
- ✅ after a contract a phone number is delivered (delivered)
- ✅ the patterns still found it, for the record (held/pattern: a phone number)
- ✅ the factory is notified once, as for any new message
- ✅ and the brand's bubble is not marked "Not sent"
- ✅ the conversation offers the designed "Schedule call"
- ✅ and not the instant "Live video chat" (no presence behind it)
- ✅ a day and a time are picked, and Continue opens the details
- ✅ Send invite
- ✅ the invite is saved as proposed
- ✅ the factory is notified once (1)
- ✅ the brand's panel shows the invite, waiting for the factory
- ✅ a second invite is started
- ✅ the page's session is ended on the server (204)
- ✅ Send invite, with the ended session
- ✅ the screen goes to sign-in
- ✅ and no invite was saved
- ✅ the factory sees the invite, with Accept / Propose another time / Decline
- ✅ the factory proposes another time
- ✅ it picks another day and time, in Shanghai time
- ✅ Send new time
- ✅ the first time is marked countered, and the factory's new time waits on the brand
- ✅ the brand accepts the new time
- ✅ the call is confirmed
- ✅ the confirmed call offers Add to calendar and Google Calendar
- ✅ the brand's dashboard lists it under Scheduled calls
- ✅ with the factory's time in the zone it proposed in (Shanghai)
- ✅ before the start, the open dashboard offers Join call
- ✅ and still does once the call is starting soon, with no reload
- ✅ the factory's dashboard lists it too
- ✅ with Join call, since its window is open
- ✅ the conversation's call card says Starting soon
- ✅ and still offers Cancel call
- ✅ Conversations fits a 375 px phone, with the calls drawer closed (375 in 375)
- ✅ the brand's call invite reached the factory by email
- ✅ and its button opens the conversation
- ✅ with the call's time, in the factory's own time zone
- ✅ the factory turns "Messages and call invites" emails off in Settings
- ✅ the brand picks another day for a follow-up call
- ✅ and sends the invite
- ✅ the factory is still told in the bell
- ✅ but with its switch off, no email is queued for it
- ✅ and none arrives
- ✅ the factory turns them back on
- ✅ the brand withdraws the follow-up invite
- ✅ with the switch on again, the factory is emailed
- ✅ the factory has a step in progress, due in three days
- ✅ an admin error is drawn in the danger colour (rgb(179, 52, 22) vs rgb(179, 52, 22))
- ✅ the job reports what it sent ("1 capacity reminder, 3 steps due soon; 7 emails sent; 1 review email sent.")
- ✅ the brand, which has to fund the step, is reminded once
- ✅ and the reminder arrives by email, worded for America/New_York: ""PP sample" is due in 3 days"
- ✅ running it again sends nothing twice
- ✅ the seeded factory waiting for review is there (run seed:demo if not)
- ✅ a two-hour-old leftover test company is in place
- ✅ staff open Atlas Knit Studio's review
- ✅ the review page offers AI suggestions, on request only ("Ask AI for suggestions")
- ❌ the AI lists suggestions, or the page says it is not set up
- ✅ each suggestion is labelled "Suggestion", with no score or verdict (none shown)
- ✅ the message is suggested, or built from the checks ("Not asked: Contact domain. A company under review cannot change these from its profile.")
- ✅ sending records the request for more information
- ✅ with the note exactly as staff edited it
- ✅ and the factory is told, in those words
- ✅ Settings → Test data lists the leftover company
- ✅ but not this run's own companies (under an hour old)
- ✅ and not the demo companies
- ✅ deleting asks first ("Delete 2 companies and 0 users?")
- ✅ and says what it deleted ("Deleted 2 companies, 0 orders, 0 users and 0 files.")
- ✅ the leftover company is gone
- ✅ this run's companies are untouched
- ✅ the demo companies are untouched (6 of 6)
- ✅ Payments → Credits shows the ledger's balance (450)
- ✅ with the verification grant as a row
- ✅ and the quote it sent, 25 credits
- ✅ newest first: the quote above the grant
- ✅ the invite dialog says an email is sent ("We'll email this factory an invitation to join, with a link to sign up. You earn 500 credits when it joins with this address and TSC verifies it; it gets the 500 credits every verified factory gets.")
- ✅ an address on the company's own domain is refused ("Invite another company: example.com is your own email domain.")
- ✅ a good address closes the modal
- ✅ and says it was sent ("Invite sent to e2e-invited-1794412362292@invited-mill.test. You earn 500 credits when TSC verifies them.")
- ✅ the invite is a Pending row
- ✅ the database recorded the invite as emailed
- ✅ the invite email arrived, from this factory ("Atelier E2E 1794412362292 invited you to The Sourcing Club")
- ✅ Invited factory: the Terms link opens the factory terms in a new tab (/app.html?legal=terms&type=factory)
- ✅ Invited factory: the Privacy link opens the privacy policy in a new tab (/app.html?legal=privacy)
- ✅ the invited factory's company exists
- ✅ signing up with the invited address linked the invite
- ✅ the invited factory is marked as having finished onboarding
- ✅ the inviter's row now says the factory joined
- ✅ staff open the invited factory's review
- ✅ the invited factory got its 500 on verification (500)
- ✅ and a bell item saying so
- ✅ the inviter earned 500 for bringing it in
- ✅ and the invite is marked as paid out
- ✅ the review page's Credits card shows 500 (Credits Balance 500 credits Verified onboarding bonus · Profile verified +500 Ad)
- ✅ removing more than the balance is refused ("This company has 500 credits; you cannot remove 600.")
- ✅ the Adjust credits refusal is red (rgb(179, 52, 22) vs rgb(179, 52, 22))
- ✅ switching to Add credits clears the refusal
- ✅ and so does changing the amount
- ✅ adding 50 with a reason closes the dialog
- ✅ the balance is 550 (550)
- ✅ and the card shows it
- ✅ the invited factory sees 550 and the reason staff gave
- ✅ the inviter's pending row became a Referral bonus
- ✅ both companies named "Atelier E2E 1794412362292" are listed (2)
- ✅ ticking one of two same-named vendors ticks only that one
- ✅ the open-to-all toggle is off before publishing
- ✅ it is that vendor's profile, with the design's way back to the selection
- ✅ none of the design's example vendor
- ✅ back on the invite step, the same vendor is still chosen
- ✅ publishing was accepted
- ✅ the invite step published it (status open)
- ✅ the request is invite-only (invited_only)
- ✅ one factory was invited (1)
- ✅ and only one of the two same-named companies: the invite goes by company, not by name
- ✅ the e2e factory is listed (6 factories)
- ✅ no unpublished vendor is listed (1 unpublished in the database)
- ✅ none of the design's example vendors, scores or order counts
- ✅ search narrows the list to that factory (Atelier E2E 1794412362292)
- ✅ Reset brings every vendor back
- ✅ the "Production type" filter narrows the list (Cut & sew knits: 2 of 6)
- ✅ the "Product categories" filter narrows the list (Tops: 5 of 6)
- ✅ the "Specializes in" filter narrows the list (In-house pattern room: 1 of 6)
- ✅ the "Price point" filter narrows the list (Luxury $500+: 1 of 6)
- ✅ the "Location" filter narrows the list (China: 4 of 6)
- ✅ the "Certifications" filter narrows the list (GOTS: 1 of 6)
- ✅ the "Lead time" filter narrows the list (Under 30 days: 1 of 6)
- ✅ the "Club Standard" filter narrows the list (Trusted: 1 of 6)
- ✅ the "Open capacity" filter narrows the list (Next 30 days: 1 of 6)
- ✅ the Factories tab lists exactly the verified, published factories (6 shown, 6 in the database)
- ✅ the Location group offers Portugal
- ✅ Location: Portugal shows exactly the factories based there (2 of 6)
- ✅ the summary line names the filter ("matching Portugal, best fit first")
- ✅ the Club Standard group is drawn
- ✅ Club Standard: Verified shows exactly the factories staff gave that tier (3 of 6)
- ✅ MOQ: pressing the bars sets the lowest MOQ to 175 and leaves only factories at or above it (4 of 6)
- ✅ Sort: Lowest MOQ orders the factories by MOQ (150, 150, 200, 200, 200, 300)
- ✅ the Sort button says which order is on ("Sort: Lowest MOQ")
- ✅ Sort: Best fit puts the original order back
- ✅ the dialog's "Show 2 factories" matches the list behind it (2)
- ✅ the Filters button counts the filters on ("Filters · 1")
- ✅ the filter is still on after switching to the cards
- ✅ the Trading companies tab lists only trading companies (1)
- ✅ List view opens the designed directory list
- ✅ a card opens that vendor's profile, with "Back to vendors"
- ✅ Back to vendors returns to Browse vendors
- ✅ Save on a Browse card turns it to "Saved" (Saved, Message, Request quote)
- ✅ it is on the brand's own list in the database
- ✅ Saved lists that vendor
- ✅ in the brand's own account
- ✅ none of the design's example brand, vendors or scores
- ✅ its profile says Saved, with the way back to Saved
- ✅ pressing Saved removes it (Save factory again)
- ✅ Saved is empty again, and says how to save one
- ✅ every payment on the brand's order that money has moved for is listed, fee included (1)
- ✅ with its state in the design's words and the factory's name
- ✅ a payment still due is in the list too, as Due, ahead of the rest (1)
- ✅ Paid is what has been paid out, fee included ($99.75, expected $99.75)
- ✅ Held is what TSC holds, fee included ($0.00, expected $0.00)
- ✅ with Due now and Remaining beside them
- ✅ none of the design's example payments, fees or cards
- ✅ no Discounts tab, and not the design's $50 example
- ✅ a payment opens its transaction page, or the Fund screen while it is due
- ✅ the designed home greets the org by name, from the database
- ✅ and no longer greets every brand as the design's example one
- ✅ the snapshot counts the order that exists (1)
- ✅ the brand is told what is waiting on them (2 card(s))
- ✅ and the design's example alerts are not shown as if they were real
- ✅ the brand proposes cancelling from the card's menu, with its reason ({"status":"active","cancel_proposed_by_org":"9a73c2da-eef9-47a8-b422-6d7a87aee5da","cancel_reason":"Season dropped"})
- ✅ and the card says so
- ✅ the brand withdraws it from the same menu, and the order carries on
- ✅ proposed from the order page, the brand is shown its proposal and its reason, with Withdraw
- ✅ and no answer of its own to give: that is the factory's
- ✅ the factory sees the brand's proposal and its reason on the order
- ✅ Keep order turns the proposal down and the order carries on
- ✅ the brand proposes again
- ✅ accepting asks first, and says what cancelling does
- ✅ the factory accepts and the order is cancelled (cancelled)
- ✅ a cancelled order is under Cancelled, not Closed (Active orders (0) Spring 2292 capsule Closed (0) Cancelled (1) + Add tab)
- ✅ and the tab lists it
- ✅ it leaves the custom tab it was filed in
- ✅ and the dashboard
- ✅ the factory's Cancelled tab has it too
- ✅ Reorder style opens a new draft request in the composer
- ✅ which says which order it repeats, and with whom
- ✅ named as a reorder ("E2E woven shirts 1794412362292 (reorder)")
- ✅ the category, region and certification come back as typed (Womenswear / Portugal / GOTS)
- ✅ and the colour breakdown in the words that saved it (300 units total · 3 colors, 100 each)
- ✅ with the brand's question and its extra details
- ✅ last run's delivery month is left for the brand to set again
- ✅ the factory that made it heads the vendor list, already ticked
- ✅ and the request goes to that factory only, unless the brand opens it
- ✅ the reorder is sent, invite-only (open, invited_only)
- ✅ and remembers the order it repeats
- ✅ with the new delivery month the brand typed
- ✅ the same factory is invited (Atelier E2E 1794412362292)
- ✅ saving the copy kept its 3 requirement links (3)
- ✅ the last owner's own Leave is drawn disabled
- ✅ and no "Make member" is offered on the last owner
- ✅ the invitation is stored and waiting
- ✅ with the name, title and permissions from the drawer (Cleo Colleague, Finance, approve,releaseFunds)
- ✅ and it was emailed
- ✅ the email names the company (Remy Brand invited you to join Maison E2E 1794412362292 on The Sourcing Club)
- ✅ the Invited list shows it with its title (colleague-1794412362292@example.com Finance Sent today Resend Withdraw)
- ✅ Resend within ten minutes is refused, and says when to try again
- ✅ Withdraw asks first, naming the address
- ✅ and once confirmed it leaves the list and is withdrawn (revoked)
- ✅ an invited person is offered the organisation, not asked to create one
- ✅ the brand now has two people (2)
- ✅ one owner and one member — joining does not confer the money permissions
- ✅ and they land in that organisation, not one of their own
- ✅ with the permissions and title they were invited with (approve,releaseFunds, Finance)
- ✅ a factory invites the same person (200 )
- ✅ the invitation is a banner over the brand they are in, naming the factory
- ✅ Join switches them to the factory, as a member with Add update (["addUpdate"])
- ✅ a factory member without RFQ flow is told which permission the quote form needs (You need the RFQ flow permission at Atelier E2E 1794412362292 for this. An owner can give it to you in Settings.)
- ✅ Leave asks first
- ✅ and once confirmed they are no longer in the factory
- ✅ and they are back in the brand they still belong to
- ✅ a crash says what is and is not lost, rather than showing a blank page
- ✅ and offers a way out — reload, or back to the start
- ✅ the crash was reported, under the reference shown (78A21ADF)
- ✅ with the real error message, not a generic one
- ✅ and the screen it happened on
- ✅ navigating away clears the crash — one broken screen does not poison the next
- ✅ both signatures recorded (2)
- ✅ 0 draft request(s) exist and never appeared in browse
- ✅ the reset form never says whether an account exists — it is not a customer lookup
- ✅ a reset link was emailed
- ✅ the reset link opens our own page, not the database's host
- ✅ the token leaves the address as soon as the page reads it
- ✅ saving the new password lets them through
- ✅ the old password no longer works
- ✅ and the new one does
- ✅ the reset link works once
- ✅ behind the block, the reset email is still asked for
- ✅ through our own host
- ✅ the emailed link opens our own page
- ✅ the link's token is verified through our own host
- ✅ saving the new password behind the block lets them through
- ✅ and the new password went through our own host
- ✅ the new password works

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
