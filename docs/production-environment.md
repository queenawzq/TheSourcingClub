# Production environment variables

What Vercel **Production** needs before payments (#49), message screening
(#51) and video calls (#52) go live. Preview and Development keep the test
values they have now; only Production changes. Values are secrets: set them in
Vercel → the-sourcing-club → Settings → Environment Variables, environment
**Production** only, never in the repository.

Checked against Vercel on 2026-10-15: none of the Stripe or Zoom variables
below is set for Production yet.

## Stripe (payments, #49): from TSC's own Stripe account, live mode

| Variable | Where it comes from |
|---|---|
| `VITE_STRIPE_PUBLISHABLE_KEY` | Stripe → Developers → API keys, `pk_live_…` |
| `STRIPE_SECRET_KEY` | same page, `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | the `whsec_…` of the "Your account" webhook below |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | the `whsec_…` of the "Connected accounts" webhook below |

Also in Stripe, live mode:

- **Connect turned on** (platform, Express accounts, capabilities
  `card_payments` + `transfers`): factories are paid through it.
- **Two webhooks** (Developers → Webhooks), both to the production site's
  `/api/stripe-webhook` (for example
  `https://the-sourcing-club.vercel.app/api/stripe-webhook`):
  - "Your account": `payment_intent.processing`, `payment_intent.succeeded`,
    `payment_intent.payment_failed`;
  - "Connected accounts": `account.updated`.

`VITE_STRIPE_PUBLISHABLE_KEY` is built into the page, so it must be set before
the production build that ships #49. The code refuses a live key (`sk_live_`)
anywhere but a production deploy, so these cannot reach a preview.

## Zoom (video calls, #52): from TSC's own Zoom account

Two apps in the Zoom App Marketplace (Develop → Build App), on the account
that will own every meeting:

| Variable | Zoom app |
|---|---|
| `ZOOM_ACCOUNT_ID` | **Server-to-Server OAuth** app (scope `meeting:write:meeting:admin`, activated): creates the meetings |
| `ZOOM_CLIENT_ID` | same app |
| `ZOOM_CLIENT_SECRET` | same app |
| `ZOOM_SDK_CLIENT_ID` | **General app** with Meeting SDK turned on, added to the account: signs each join |
| `ZOOM_SDK_CLIENT_SECRET` | same app |

The in-page video only joins meetings created by the same account, which is
why both apps must be on TSC's account. Without all five, calls still
schedule and "Join call" says video isn't set up yet.

## Already set, nothing to do

- `OPENROUTER_API_KEY` (message screening, #51): set for Production,
  Preview and Development.
- `OPENROUTER_SCREEN_MODEL`: optional; screening falls back to
  `OPENROUTER_MODEL`, then `anthropic/claude-opus-5`.
- `SUPABASE_DB_URL` (Production only): runs the new migrations on deploy.
