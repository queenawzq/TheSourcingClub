import { createClient } from "@supabase/supabase-js";
import { EMAIL_LOGO_URL } from "./_email-assets.js";
import { supabaseServerEnv } from "./_supabase-env.js";
import { messageFor, resubmissionAlertMessage } from "./_review-decision-sender.js";

/**
 * Send one of the product's emails to the signed-in admin, filled with sample
 * data, so staff can see exactly what a company receives.
 *
 * The message comes from the same builder the real send uses — Queena's
 * designed onboarding emails, and the review-decision copy — so a test cannot
 * drift from the real thing. It goes only to the caller's own address: this
 * must never become a way to send mail to anyone else.
 */
const RESEND_ENDPOINT = "https://api.resend.com/emails";
// Replies land in the operations inbox (forwarded by api/inbound-email.js),
// not at the noreply sender, which has no mailbox.
const REPLY_TO = process.env.SUPPORT_EMAIL ?? "operations@contact.sourcing-club.com";

// Loaded with import(), not a static import: Vercel compiles api/*.js to
// CommonJS, and a static import of this .mjs becomes a require() that
// crashes the function before it runs (ERR_REQUIRE_ESM, a bare 500).
const loadOnboardingEmail = () =>
  import("../scripts/generate-onboarding-emails.mjs").then((module) => module.onboardingEmail);

const jsonBody = (request) =>
  typeof request.body === "string" ? JSON.parse(request.body) : request.body ?? {};

function appUrl() {
  const configured = process.env.PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (productionHost) return `https://${productionHost.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  return "https://the-sourcing-club.vercel.app";
}

const SAMPLE_NOTE = "This is a sample note from a reviewer. In a real email it is whatever the reviewer wrote.";
// A request for more information has a shape: a summary, what to upload, a
// friendly close. The sample shows it, so a test can check the bullets.
// `check:review-email` pins that both parse into a list.
export const SAMPLE_REQUEST = {
  en: "Your profile is nearly complete, but a few items are still missing.\n\n- A current business registration certificate showing your legal name\n- Your company website, added under Factory details\n- A short walkthrough video of your production floor\n\nWe look forward to receiving these.",
  zh: "你的资料已基本完成，但还缺少以下几项。\n\n- 最新的营业执照，需显示公司法定名称\n- 公司网站，请填写在工厂详情中\n- 一段生产车间的短视频\n\n期待收到你的资料。",
};

const TEMPLATES = {
  "onboarding-brand": async () => (await loadOnboardingEmail())("brand", sampleOnboarding("Sample Brand Co.", "/app.html")),
  "onboarding-factory": async () => (await loadOnboardingEmail())("factory", sampleOnboarding("Sample Factory Ltd.", "/app.html?portal=factory")),
  "onboarding-trading-company": async () => (await loadOnboardingEmail())("trading-company", sampleOnboarding("Sample Trading Co.", "/app.html?portal=factory")),
  "review-approved": (locale, name) => review("approved", locale, name, ""),
  "review-needs-information": (locale, name) => review("needs_information", locale, name, SAMPLE_REQUEST[locale === "zh" ? "zh" : "en"]),
  "review-declined": (locale, name) => review("declined", locale, name, SAMPLE_NOTE),
  "review-resubmitted": () => resubmissionAlertMessage({ orgId: "00000000-0000-4000-8000-000000000000", orgName: "Sample Factory Ltd.", orgType: "factory", note: SAMPLE_NOTE }, { appUrl: appUrl() }),
  "notification": (locale, name) => sampleNotification(locale, name),
  "notification-payout-change": (locale, name) => samplePayoutChange(locale, name),
  "team-invite": (locale, name) => sampleTeamInvite(name),
};

// A teammate's invitation, with sample permissions.
async function sampleTeamInvite(name) {
  const { teamInviteEmail } = await import("../scripts/generate-notification-email.mjs");
  const app = appUrl();
  return teamInviteEmail({
    companyName: "Sample Brand Co.",
    kind: "brand",
    inviterName: "Sample Owner",
    inviteeName: name,
    title: "Production lead",
    permissions: ["approve", "rfqFlow"],
    email: "you@example.com",
    expiresAt: new Date(Date.now() + 14 * 86400000).toISOString(),
  }, {
    appUrl: app,
    logoUrl: EMAIL_LOGO_URL,
    supportEmail: REPLY_TO,
    companyAddress: process.env.COMPANY_ADDRESS ?? "New York, USA",
  });
}

// The alert everyone at a factory gets when its payout methods change.
async function samplePayoutChange(locale, name) {
  const { notificationEmail } = await import("../scripts/generate-notification-email.mjs");
  return notificationEmail({
    locale,
    recipient_name: name,
    org_name: "Sample Factory Ltd.",
    org_type: "factory",
    category: "account",
    kind: "payout_method_changed",
    title: "Your payout methods changed",
    body: "Payoneer account sample@example.com was added. If nobody at your company made this change, email operations@contact.sourcing-club.com now.",
  }, {
    appUrl: appUrl(),
    logoUrl: EMAIL_LOGO_URL,
    supportEmail: REPLY_TO,
    companyAddress: process.env.COMPANY_ADDRESS ?? "New York, USA",
  });
}

// The email a member gets for an ordinary notification, with a sample quote.
async function sampleNotification(locale, name) {
  const { notificationEmail } = await import("../scripts/generate-notification-email.mjs");
  return notificationEmail({
    locale,
    recipient_name: name,
    org_name: "Sample Brand Co.",
    org_type: "brand",
    category: "rfq",
    kind: "quote_received",
    subject_type: "rfq",
    subject_id: null,
    title: "Sample Factory Ltd. sent a quote on \"Organic cotton shirts\"",
    body: "$18.40 a unit for 300 units, 28 days after sample approval.",
  }, {
    appUrl: appUrl(),
    logoUrl: EMAIL_LOGO_URL,
    supportEmail: REPLY_TO,
    companyAddress: process.env.COMPANY_ADDRESS ?? "New York, USA",
  });
}

function sampleOnboarding(companyName, path) {
  return {
    companyName,
    dashboardUrl: `${appUrl()}${path}`,
    logoUrl: EMAIL_LOGO_URL,
    supportEmail: REPLY_TO,
    companyAddress: process.env.COMPANY_ADDRESS ?? "New York, USA",
  };
}

function review(decision, locale, name, note) {
  return messageFor({ decision, locale, recipient_name: name, note, orgs: { name: "Sample Company", type: "factory" } }, { appUrl: appUrl() });
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ sent: false, error: "method not allowed" });
    return;
  }

  const { supabaseUrl, anonKey } = supabaseServerEnv();
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const authorization = request.headers.authorization;

  if (!supabaseUrl || !anonKey || !resendKey || !from) {
    response.status(503).json({ sent: false, error: "email is not configured on the server" });
    return;
  }
  if (!authorization?.startsWith("Bearer ")) {
    response.status(401).json({ sent: false, error: "sign in is required" });
    return;
  }

  const caller = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const [{ data: isAdmin, error: adminError }, { data: auth, error: userError }] = await Promise.all([
    caller.rpc("is_platform_admin"),
    caller.auth.getUser(),
  ]);
  if (adminError || userError || !isAdmin || !auth.user?.email) {
    response.status(403).json({ sent: false, error: "platform staff access is required" });
    return;
  }

  const { template, locale } = jsonBody(request);
  const build = TEMPLATES[template];
  if (!build) {
    response.status(400).json({ sent: false, error: `unknown email "${template}"` });
    return;
  }

  const to = auth.user.email;
  // A reserved address (the demo staff login is @example.com) has no mailbox,
  // and the provider refuses it with a message meant for developers. Say so
  // plainly before trying.
  const { reservedEmailNotice } = await import("../src/shared/reserved-email.mjs");
  const reserved = reservedEmailNotice(to);
  if (reserved) {
    response.status(422).json({ sent: false, error: reserved });
    return;
  }

  const name = auth.user.user_metadata?.full_name || auth.user.user_metadata?.name || "";
  const message = await build(locale === "zh" ? "zh" : "en", name);

  try {
    const delivery = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], reply_to: REPLY_TO, ...message, subject: `[Test] ${message.subject}` }),
    });
    const payload = await delivery.json().catch(() => ({}));
    if (!delivery.ok) {
      // The provider's own words are for us, not for the person testing.
      console.error("send-test-email: provider refused", delivery.status, payload.message ?? "");
      response.status(502).json({
        sent: false,
        error: `The email service did not accept the test email for ${to}, so nothing was sent. Try again in a minute; if it keeps failing, the sending setup needs checking.`,
      });
      return;
    }
    response.status(200).json({ sent: true, to, error: null });
  } catch (error) {
    console.error("send-test-email: could not reach the provider", error);
    response.status(502).json({ sent: false, error: "The email service could not be reached, so nothing was sent. Try again in a minute." });
  }
}
