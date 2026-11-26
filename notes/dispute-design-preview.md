# Production-order dispute concept

Local preview: `/dispute-design-preview.html`. Uses sample data and in-memory state; reload resets it. Attachments are selected locally; no uploads, notifications, changes to orders, or money movements are performed. Brand, factory, and admin perspectives are available in the top switcher. Existing production pages are unchanged.

## Proposed process

1. Either party opens one active case per order through the three-dot menu. Identify the affected stage, reason, details, preferred remedy, and optional amount. Attach evidence.
2. Notify the other party and give a clear response deadline, proposed as two business days. Allow a response and further evidence in the same case.
3. A named reviewer reviews the accepted order specification, approved samples, production updates, messages, delivery records, and payment state. Ask targeted questions; record all requests and responses in a shared timeline.
4. Seek an agreement first: rework, replacement, a new delivery date, a partial/full refund, payment release, or cancellation. Record who must do what, by when, and how completion will be verified.
5. Keep the case open as **Resolution agreed / awaiting completion** until obligations are fulfilled. Then close it as **Resolved**. The mockup includes a separate admin completion confirmation before the case can be marked Resolved.

## Admin responsibilities and boundaries

- Assign an owner and show case age, next response due date, and overdue cases in the queue. Escalate safety/fraud issues to senior staff.
- Keep private staff notes separate from shared case messages; every decision needs a visible rationale and audit record.
- Decide payment handling explicitly. Recommend reviewing/pausing only the disputed, unreleased amount when policy and provider capabilities allow it. Do not silently freeze an entire order or promise recovery of an already paid-out amount.
- Record a decision separately from its execution. Refunds, releases, and cancellation need a separate authorized action, current payment-state checks, and duplicate-action protection. The prototype does not perform them.
- Define a short reconsideration window for new evidence; retain the previous decision and reasons when reopening a case.
- Published dispute terms should establish eligibility, filing windows, response deadlines, the platform's authority, and what happens when parties disagree before launch. Avoid promising arbitration or guaranteed refunds without an agreed policy.

## Before production implementation

Persist cases, responses, evidence, assignments, and events with order-party/staff access rules. Use private evidence storage, verify actual uploaded bytes, validate type/size, and scan uploads. Notify participants with links to the case rather than attachments. Add English/Chinese interface copy and original-text controls for translated party content. Determine who can raise cases within each organization and prevent duplicate active cases. A full queue should support status/assignee/age filters and pagination.

## Component alignment
The preview now mounts the existing brand ProjectsScreen / ProjectDetailScreen and factory FactoryProjectsPage / FactoryProjectProgressDetail. Optional render slots add dispute actions and case notices without changing existing callers. The dispute form uses the existing approve-fund / milestone-comment dialog frame, settings close control, onboarding required marker, primary/secondary buttons, upload treatment, and shared color tokens. The perspective switcher is a floating preview-only toolbar.

## Automatic case status
Start review is removed. Submission waits for the other party; an admin response request records pending recipients and a business-day deadline. The case becomes Ready for review only when all requested parties have responded. Extra notes from the opener do not satisfy a pending request to the other party. Recording a resolution leaves the case Awaiting completion. An admin must add a verification note and confirm the agreed actions are complete before marking it Resolved. Viewing a case never changes status. All state and deadline handling remains local to this mockup; there is no email, payment, or database action. Run `node scripts/check-dispute-preview.mjs` for transition checks.

## Flow v2 (Nov 26 mock)

Walkthrough with screenshots: `notes/mocks/2026-11-26-dispute-flow.html` (in the main checkout). Transitions: `dispute-preview-state.mjs`, checked by `node scripts/check-dispute-preview.mjs`.

- **Settle first.** The other side answers within 2 business days: Accept · Make an offer · Reply. Each answer gives the other side 2 business days. The preview's "Next business day" moves the mock clock. (v4 replaces the review stage: see below.)
- **Outcomes are platform actions only:** Refund (capped at what is funded on the step) · Pay out the step · Rework by a new date · Cancel the order · No change. An agreement or the staff "Record resolution" sets it. Money outcomes wait for one staff confirm ("Awaiting completion"); rework by a new date or no change resolves at once.
- **Money while open:** the factory's whole balance is paused ("Withdrawals are paused while a payment is reviewed"), and the disputed step shows "On hold: dispute open" with Approve off. The brand is not paused. Both lift on Resolved or Withdrawn, unless another case or a bank dispute is open.
- **One open case per order.** The case has its own page per side (`/orders/TSC-000524/dispute`), reached from the order card, the order banner, the bell and the emails. Statuses (v4): Open · Awaiting completion · Resolved · Withdrawn.
- **The opener can withdraw** until an outcome is set.

## Flow v3 (Nov 26, approved changes)

Walkthrough: `notes/mocks/2026-11-26-dispute-flow.html` (main checkout). Guided player in the preview: the "Walkthrough" panel (preview-only chrome), ← → keys, `?step=N` deep link, `&player=closed` to hide it. Steps and replay: `dispute-preview-steps.mjs`.

- **Negotiation window.** Each answer gives the other side 2 business days, but never past 5 business days from opening. A deadline is the whole day (23:59 New York). Waiting on / Due use the capped deadline. (What happens at the end of the window: v4.)
- **Rework by a new date** replaces "New due date": the step reopens with the new due date and stays unapproved; its money stays funded and the brand approves it with the normal Approve when the rework arrives.
- **Release other payments** (admin case page, one confirm, optional staff note): lifts the factory's withdrawal pause for everything except the disputed step, which stays on hold. Recorded on the timeline as a staff-only entry; the parties' timelines don't show it. The factory's balance card loses "· Withdrawals paused" and keeps "$1,700.00 on hold"; the factory gets a bell item. Default stays: the whole balance paused.
- **Dispute emails always send**, whatever the company's email settings (a missed email means a missed deadline). Nothing on screen changes; the email footer uses the always-sent line ("Sent to everyone at …") instead of the "turn them off in Settings" line, which would be untrue.
- **Dispute from a step.** The brand's step menu already has "Initiate dispute" (`canDispute` / `onInitiateDispute` in LiveOrderDetail). In the preview it opens the same Open a dispute dialog with the stage filled in. ProjectDetailScreen has no slot to swap its own step dialog, so the preview intercepts the click before React does; in the product this needs one optional prop on ProjectDetailScreen (e.g. `onDisputeStep`) for Queena's file. The factory's order screen has no per-step dispute item.
- **Words.** No "TSC" in new text: staff are "our team" to the parties ("Our team is handling this case · Priya Shah", "Our team is deciding"); held money is "Funded: held until approval" (v4; the order page's own line is "Funded: held by TSC"). Order numbers (TSC-000524) and the admin workspace name are the product's own.
- **Factory balance** is production's StripePayoutCard markup and wording: "Earnings stay in your balance until you withdraw them. · Withdrawals paused", "$X on hold", Withdraw disabled with the title "Withdrawals paused". No reason line, as in production; the bell, emails and order card explain why.

## Flow v4 (Nov 26): the Upwork model

The standard followed is Upwork's dispute process: the platform's dispute team has the case from the moment it is filed, the two sides can still settle between themselves, and the team decides when they don't.

- **Our team has the case from opening.** It is in the admin queue at once, assigned (Priya Shah), and both sides' case pages say so under the heading: "Our team is handling this case · Priya Shah" (after closing: "Handled by our team · Priya Shah"). The timeline's second entry is "Our team is handling this case · Assigned to Priya Shah". The opened email to the other side says the same, with the answer date and the decision date.
- **The sides can still settle.** The other side answers with Accept the request / Make an offer / Reply, 2 business days per answer, capped at 5 business days from opening; offers and counter-offers work as before. An agreement leaves staff only the money action (Awaiting completion), as before.
- **No agreement by the end of the 5 business days: our team decides.** The case page, order banner and admin banner say "Our team decides if not settled by Dec 3". At the end of that day the timeline gets "Our team is deciding · No agreement by Dec 3", both sides get a bell item and an email ("TSC-000524 dispute: our team is deciding"), and Waiting on becomes Staff. The status stays Open: there is no separate stage. The sides can still offer, accept or reply until our team records the resolution.
- **A missed answer changes nothing by itself.** The side that missed it reads "Your response was due Nov 30", the other side and staff see it overdue, and it may still answer until the window ends. (Decision made here: handing the case to our team on a missed turn would make "Our team decides if not settled by Dec 3" untrue; staff can act on an overdue case at any time.)
- **Staff can act at any time**: Request a response (the asked side may answer out of turn; answering our team does not hand the turn over) or Record resolution, before or after the window ends.
- **Removed**: "Ask our team to step in" (case page link, dialog, timeline event, state function, walkthrough step), the "In review" status, the escalation transition, "Review started" / "Review starts …" wording and the "review" email.
- **Status words, one set everywhere** (order card and banner, case page, bell, emails, admin queue and case): **Open** (until an outcome is set; who must act is Waiting on: the brand, the factory, both, or Staff) · **Awaiting completion** (an agreed or decided money outcome waits for staff) · **Resolved** · **Withdrawn**.
- **Progress**: Opened → Answer or settle → Decision → Resolved. "Decision" appears only once our team is deciding or has decided, so an agreement reads Opened → Answer or settle → Resolved and a withdrawal ends in Withdrawn.
- **Admin queue** has an "Assigned to" column.
- **Money held on a step reads "Funded: held until approval"** on the brand's step line, the case page's step box and the admin case's Money box.
- **Emails**: Case opened · Offer made · Our team is deciding · Response requested · Withdrawn · Resolved, all sent whatever the email settings. The factory's bell item when staff release other payments stays.
