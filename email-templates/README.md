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

Run `npm run emails` after editing the source in `scripts/generate-onboarding-emails.mjs`.
Run `npm run emails:approved` after editing `scripts/generate-account-approved-email.mjs`.

The approval message is sent by `api/send-review-decision.js` when a profile is approved. It uses the same TSC shell as these onboarding emails, supports English and Chinese copy, and includes an optional note from the reviewer.

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
