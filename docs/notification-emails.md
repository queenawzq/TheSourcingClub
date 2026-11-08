# Notification email controls

Settings → Notifications controls **company-wide email**, not the activity bell.
Members with Settings access may change it; owners have that access. A missing
preference row means optional email is on. Every company member with an email
address receives enabled notifications.

| Control | Brand | Factory / trading company | Included events |
| --- | --- | --- | --- |
| Sourcing and quotes / RFQs and quotes | Yes | Yes | RFQ invitations, matches, cancellations; quotes received, withdrawn, accepted |
| Payments | Yes | Yes | Payment due, sent, confirmed, rejected, failed, refunded; funds released |
| Orders and milestones | Yes | Yes | Order status, schedules and agreement, milestone submission/approval/dispute, manual and deadline reminders, cancellation negotiation |
| Messages | Yes | Yes | New messages; at most one email per recipient/conversation every six hours |
| Calls and reminders | Yes | Yes | Invitations, responses, counters, cancellation; one reminder per party within an hour of an accepted call |
| Capacity reminders | No | Yes | Monthly reminder after 30 days without a capacity update |

When upgrading from three switches, Orders inherits Payments, Calls inherits
Messages, and Capacity inherits RFQs. Pending emails are recategorized too. This
preserves previous opt-outs. Switching email off leaves in-app activity intact.
Existing bell-only events, including quote declined, message rejected, credits
and referral activity, remain bell-only; these controls do not enable new email
for those events.

## Always sent

These are separate from optional operational email:

- Sign-in and password recovery codes (authentication flow).
- Profile submission receipts and staff review decisions, including requests for information.
- Invitations explicitly requested by a member, including team invitations.
- Payout method security alerts, required payout account information, and failed
  payout/withdrawal alerts (factory side). These use the mandatory `account`
  category and bypass all email switches.
- Staff profile-resubmission alerts remain part of the separate review outbox.

Payout failures are different from a brand's failed payment. A brand's failed
payment remains under Payments. Wise and PayPal attempts notify the factory on
confirmed failure even when there is no bank/address correction to make. Provider
cancellations do not imply a failure. Requirements already detected by Stripe's
`account.updated` event now use the distinct `payout_action_required` kind.

## Scheduler and release requirements

- `/api/notification-emails` runs every five minutes using the existing
  `CRON_SECRET` authorization. The current hosting team is on Vercel Pro,
  supporting that interval; do not switch this deployment to Hobby without an
  alternative scheduler.
- Reminders go to both companies only for accepted calls starting within one
  hour. Late acceptance still gets a reminder. Repeated/concurrent runs are
  deduplicated per call, time and company. No meeting credentials are emailed:
  the link opens the conversation, where the normal join authorization applies.
- Delivery rechecks the call's status and start time. Cancelled, rescheduled or
  already-started calls are skipped before claiming pending/retry emails.
- The five-minute job also drains payout alerts and other notification email,
  so provider actions no longer depend on someone opening the app or the daily
  fallback. Failed deliveries keep the existing outbox retry rules.
- The Stripe **connected-account webhook** must subscribe to `payout.failed`
  alongside `account.updated`. Apply the SQL migration and deploy the handler
  before enabling this additional event. No live webhook configuration is
  changed by this PR. Unknown connected accounts produce no notification;
  repeated events deduplicate by factory and provider payout ID.
- Cron jobs run on production, not PR previews. On a preview/local stack, call
  the GET endpoint with the cron bearer secret to verify scheduling.

## Validation

- `npm run build`
- `npm run emails:test` (templates, mandatory links, recipient time zone,
  scheduler authentication and error handling)
- `supabase/tests/payout_call_emails_test.sql` (real PostgreSQL queue, preferences,
  duplicate suppression, cancellation and provider failures)
- Existing notification and provider-payout SQL regression tests
- Browser walkthrough: brand has five controls, factory has six; call preferences
  persist after reload on both portals, and both show the always-sent explanation.

## Settings screenshots

Brand: [five email controls](../e2e-evidence/email-settings-brand.png).

Factory: [six email controls](../e2e-evidence/email-settings-factory.png).
