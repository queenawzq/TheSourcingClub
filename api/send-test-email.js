import { createClient } from "@supabase/supabase-js";
import { onboardingEmail } from "../scripts/generate-onboarding-emails.mjs";
import { messageFor } from "./send-review-decision.js";

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

const TEMPLATES = {
  "onboarding-brand": () => onboardingEmail("brand", sampleOnboarding("Sample Brand Co.", "/app.html")),
  "onboarding-factory": () => onboardingEmail("factory", sampleOnboarding("Sample Factory Ltd.", "/app.html?portal=factory")),
  "onboarding-trading-company": () => onboardingEmail("trading-company", sampleOnboarding("Sample Trading Co.", "/app.html?portal=factory")),
  "review-approved": (locale, name) => review("approved", locale, name, ""),
  "review-needs-information": (locale, name) => review("needs_information", locale, name, SAMPLE_NOTE),
  "review-declined": (locale, name) => review("declined", locale, name, SAMPLE_NOTE),
};

function sampleOnboarding(companyName, path) {
  return {
    companyName,
    dashboardUrl: `${appUrl()}${path}`,
    supportEmail: process.env.SUPPORT_EMAIL ?? "operations@thesourcingclub.com",
    companyAddress: process.env.COMPANY_ADDRESS ?? "New York, USA",
  };
}

function review(decision, locale, name, note) {
  return messageFor({ decision, locale, recipient_name: name, note, orgs: { name: "Sample Company" } });
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ sent: false, error: "method not allowed" });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
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

  const name = auth.user.user_metadata?.full_name || auth.user.user_metadata?.name || "";
  const message = build(locale === "zh" ? "zh" : "en", name);
  const to = auth.user.email;

  try {
    const delivery = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], ...message, subject: `[Test] ${message.subject}` }),
    });
    const payload = await delivery.json().catch(() => ({}));
    if (!delivery.ok) throw new Error(payload.message || `email provider returned ${delivery.status}`);
    response.status(200).json({ sent: true, to, error: null });
  } catch (error) {
    response.status(502).json({ sent: false, error: String(error.message || error).slice(0, 300) });
  }
}
