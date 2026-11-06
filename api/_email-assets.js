/**
 * Where an email's images come from: always the production site.
 *
 * Links in an email point at the app the reader should open (`appUrl`, a
 * preview's own address on a preview). Images cannot: a Vercel preview sits
 * behind deployment protection, so Gmail's image proxy is refused and the logo
 * shows as a broken box. The logo is the same file everywhere, so every email
 * takes it from production, as scripts/generate-account-approved-email.mjs
 * and generate-onboarding-emails.mjs already default to.
 *
 * The leading underscore keeps Vercel from serving this file as a route.
 */
export const EMAIL_LOGO_URL = "https://the-sourcing-club.vercel.app/assets/logo.png";
