# Production-order dispute concept

Local preview: `/dispute-design-preview.html`. Uses sample data and in-memory state; reload resets it. Attachments are selected locally; no uploads, notifications, changes to orders, or money movements are performed. Brand, factory, and admin perspectives are available in the top switcher. Existing production pages are unchanged.

## Proposed process

1. Either party opens one active case per order through the three-dot menu. Identify the affected stage, reason, details, preferred remedy, and optional amount. Attach evidence.
2. Notify the other party and give a clear response deadline, proposed as two business days. Allow a response and further evidence in the same case.
3. A named TSC reviewer reviews the accepted order specification, approved samples, production updates, messages, delivery records, and payment state. Ask targeted questions; record all requests and responses in a shared timeline.
4. Seek an agreement first: rework, replacement, a new delivery date, a partial/full refund, payment release, or cancellation. Record who must do what, by when, and how completion will be verified.
5. Keep the case open as **Resolution agreed / awaiting completion** until obligations are fulfilled. Then close it as **Resolved**. The mockup includes a separate admin completion confirmation before the case can be marked Resolved.

## Admin responsibilities and boundaries

- Assign an owner and show case age, next response due date, and overdue cases in the queue. Escalate safety/fraud issues to senior staff.
- Keep private staff notes separate from shared case messages; every decision needs a visible rationale and audit record.
- Decide payment handling explicitly. Recommend reviewing/pausing only the disputed, unreleased amount when policy and provider capabilities allow it. Do not silently freeze an entire order or promise recovery of an already paid-out amount.
- Record a decision separately from its execution. Refunds, releases, and cancellation need a separate authorized action, current payment-state checks, and duplicate-action protection. The prototype does not perform them.
- Define a short reconsideration window for new evidence; retain the previous decision and reasons when reopening a case.
- Published dispute terms should establish eligibility, filing windows, response deadlines, TSC's authority, and what happens when parties disagree before launch. Avoid promising arbitration or guaranteed refunds without an agreed policy.

## Before production implementation

Persist cases, responses, evidence, assignments, and events with order-party/staff access rules. Use private evidence storage, verify actual uploaded bytes, validate type/size, and scan uploads. Notify participants with links to the case rather than attachments. Add English/Chinese interface copy and original-text controls for translated party content. Determine who can raise cases within each organization and prevent duplicate active cases. A full queue should support status/assignee/age filters and pagination.

## TSC component alignment
The preview now mounts the existing brand ProjectsScreen / ProjectDetailScreen and factory FactoryProjectsPage / FactoryProjectProgressDetail. Optional render slots add dispute actions and case notices without changing existing callers. The dispute form uses the existing approve-fund / milestone-comment dialog frame, settings close control, onboarding required marker, primary/secondary buttons, upload treatment, and shared color tokens. The perspective switcher is a floating preview-only toolbar.

## Automatic case status
Start review is removed. Submission waits for the other party; an admin response request records pending recipients and a business-day deadline. The case becomes Ready for TSC review only when all requested parties have responded. Extra notes from the opener do not satisfy a pending request to the other party. Recording a resolution leaves the case Awaiting completion. An admin must add a verification note and confirm the agreed actions are complete before marking it Resolved. Viewing a case never changes status. All state and deadline handling remains local to this mockup; there is no email, payment, or database action. Run `node scripts/check-dispute-preview.mjs` for transition checks.
