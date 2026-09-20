# TSC onboarding completion emails

These templates are sent immediately after a user finishes onboarding and submits a profile for verification. They do not imply that the account is already approved.

## Templates

- `onboarding-complete-brand.html`
- `onboarding-complete-factory.html`
- `onboarding-complete-trading-company.html`
- `preview.html` — browser review surface for all three versions

Run `npm run emails` after editing the source in `scripts/generate-onboarding-emails.mjs`.

## Template variables

- `{{ brand_name }}` in the brand version
- `{{ company_name }}` in the factory and trading-company versions
- `{{ dashboard_url }}`
- `{{ support_email }}`
- `{{ company_address }}`

The production templates use table layout, inline styles, web-safe font fallbacks, hidden preheaders, and a narrow responsive rule for broad email-client compatibility. The branded review page loads Satoshi locally, but the send-ready email intentionally falls back to Arial/Helvetica when the recipient does not have Satoshi installed.
