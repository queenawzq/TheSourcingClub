# TSC onboarding completion emails

These templates are sent immediately after a user finishes onboarding and submits a profile for verification. They do not imply that the account is already approved.

`api/send-onboarding-complete.js` sends the generated design through Resend.
The database migration `20260921000100_onboarding_submission_emails.sql`
queues one message per organization owner when onboarding is first completed;
subsequent saves cannot create duplicates.

## Templates

- `onboarding-complete-brand.html`
- `onboarding-complete-factory.html`
- `onboarding-complete-trading-company.html`
- `preview.html` — browser review surface for all three versions
- `account-approved.html` — branded approval email sample based on the live sender
- `more-information-needed.html` — branded review follow-up sample; its highlighted request is a sample admin note

Run `npm run emails` after editing the source in `scripts/generate-onboarding-emails.mjs`.
Run `npm run emails:approved` after editing `scripts/generate-account-approved-email.mjs`; it regenerates both review-decision samples.
Run `npm run emails:test` to verify all live template variants and the review sender's admin-note rendering.

The review-decision messages are sent by `api/send-review-decision.js` to each queued recipient's email address. Approval and more-information messages share the same TSC design and support English and Chinese copy. For a more-information decision, the highlighted request is the admin's actual note, saved with that decision; sending fails if it is blank. The static preview contains sample text only.
`api/send-onboarding-complete.js` renders the brand, factory, or trading-company design from the queued profile type. Both senders pass the TSC logo as an absolute URL and direct replies to the operations inbox.

Production delivery uses `RESEND_API_KEY`, `RESEND_FROM_EMAIL`,
`SUPABASE_SERVICE_ROLE_KEY`, and the public Supabase URL/key already required
by the other API functions. `PUBLIC_APP_URL`, `SUPPORT_EMAIL`, and
`COMPANY_ADDRESS` are optional overrides.

## Template variables

- `{{ brand_name }}` in the brand version
- `{{ company_name }}` in the factory and trading-company versions
- `{{ dashboard_url }}`
- `{{ logo_url }}` — absolute HTTPS URL to the TSC logo image (`assets/logo.png`); email clients cannot use a relative site path
- `{{ support_email }}`
- `{{ company_address }}`

The production templates use table layout, inline styles, web-safe font fallbacks, hidden preheaders, and a narrow responsive rule for broad email-client compatibility. The branded review page loads Satoshi locally, but the send-ready email intentionally falls back to Arial/Helvetica when the recipient does not have Satoshi installed.
