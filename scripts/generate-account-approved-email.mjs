import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { reviewNoteHtml } from "../src/shared/review-note.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(root, "email-templates");

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const copy = {
  en: {
    subject: "Your Sourcing Club account is approved",
    preheader: "Your profile is approved. Sign in to The Sourcing Club to access your dashboard.",
    eyebrow: "ACCOUNT VERIFICATION",
    status: "APPROVED · READY TO GO",
    title: "Your account is approved.",
    greeting: (name) => name ? `Hi ${name},` : "Hi,",
    intro: (company) => `${company}'s profile has been approved. You can now log in to The Sourcing Club.`,
    cardEyebrow: "PROFILE STATUS",
    cardTitle: "Verified and ready",
    cardCopy: "Your review is complete and your dashboard is ready for you.",
    nextTitle: "What happens next",
    nextCopy: "Sign in to explore your dashboard and continue where you left off. Your profile details will be there whenever you need them.",
    cta: "Log in to The Sourcing Club",
    noteTitle: "A note from our team",
    help: "Questions? Reply to this email or contact",
    footer: "You’re receiving this because your TSC profile was approved.",
  },
  zh: {
    subject: "你的 The Sourcing Club 账户已通过审核",
    preheader: "你的资料已通过审核。现在可以登录 The Sourcing Club 查看控制台。",
    eyebrow: "账户审核",
    status: "已通过审核 · 可以登录",
    title: "你的账户已通过审核。",
    greeting: (name) => name ? `${name} 你好，` : "你好，",
    intro: (company) => `${company} 的资料已通过审核。你现在可以登录 The Sourcing Club。`,
    cardEyebrow: "资料状态",
    cardTitle: "已通过审核",
    cardCopy: "审核已完成，你的控制台现已开放。",
    nextTitle: "接下来做什么",
    nextCopy: "登录控制台，继续之前的操作。你可以随时查看自己的资料。",
    cta: "登录 The Sourcing Club",
    noteTitle: "我们团队的留言",
    help: "有疑问？直接回复这封邮件，或联系",
    footer: "你收到这封邮件是因为你的 TSC 资料已通过审核。",
  },
};

const needsInformationCopy = {
  en: {
    subject: "We need a little more information",
    preheader: "Our team has a question about your profile. See what is needed to continue review.",
    eyebrow: "ACCOUNT VERIFICATION",
    status: "ACTION NEEDED · PROFILE IN REVIEW",
    title: "We need a little more information.",
    greeting: (name) => name ? `Hi ${name},` : "Hi,",
    intro: (company) => `We've reviewed ${company}'s profile and need a few more details to finish verifying it.`,
    cardEyebrow: "MESSAGE FROM OUR REVIEW TEAM",
    cardTitle: "What we need from you",
    nextTitle: "What happens next",
    nextCopy: "Update your profile with the requested information. Our team will continue the review once you submit your changes.",
    cta: "Update your profile",
    help: "Questions? Reply to this email or contact",
    footer: "You’re receiving this because our team needs more information to review your TSC profile.",
  },
  zh: {
    subject: "我们还需要一些补充信息",
    preheader: "我们的团队需要你补充资料，才能继续审核。",
    eyebrow: "账户审核",
    status: "需要操作 · 资料审核中",
    title: "我们还需要一些补充信息。",
    greeting: (name) => name ? `${name} 你好，` : "你好，",
    intro: (company) => `我们已查看 ${company} 的资料，还需要一些补充信息才能完成审核。`,
    cardEyebrow: "审核团队的留言",
    cardTitle: "需要你提供的信息",
    nextTitle: "接下来做什么",
    nextCopy: "请按要求更新并提交资料。提交后，我们的团队会继续审核。",
    cta: "更新你的资料",
    help: "有疑问？直接回复这封邮件，或联系",
    footer: "你收到这封邮件是因为我们的团队需要更多信息来审核你的 TSC 资料。",
  },
};

const declinedCopy = {
  en: {
    subject: "We could not verify your profile",
    preheader: "Our team could not verify your profile. See the reason given.",
    eyebrow: "ACCOUNT VERIFICATION",
    status: "NOT VERIFIED",
    title: "We could not verify your profile.",
    greeting: (name) => name ? `Hi ${name},` : "Hi,",
    intro: (company) => `We were unable to verify ${company}'s profile at this time.`,
    cardEyebrow: "MESSAGE FROM OUR REVIEW TEAM",
    cardTitle: "Reason given",
    nextTitle: "What you can do",
    nextCopy: "If you think this is a mistake or have new information, just reply to this email and our team will take a look.",
    cta: "Log in to The Sourcing Club",
    help: "Questions? Reply to this email or contact",
    footer: "You’re receiving this because our team reviewed your TSC profile.",
  },
  zh: {
    subject: "你的资料未能通过审核",
    preheader: "我们的团队未能通过你的资料审核。查看原因说明。",
    eyebrow: "账户审核",
    status: "未通过审核",
    title: "你的资料未能通过审核。",
    greeting: (name) => name ? `${name} 你好，` : "你好，",
    intro: (company) => `我们目前无法通过 ${company} 的资料审核。`,
    cardEyebrow: "审核团队的留言",
    cardTitle: "原因说明",
    nextTitle: "你可以做什么",
    nextCopy: "如果你认为这有误，或有新的资料，直接回复这封邮件，我们的团队会查看。",
    cta: "登录 The Sourcing Club",
    help: "有疑问？直接回复这封邮件，或联系",
    footer: "你收到这封邮件是因为我们的团队审核了你的 TSC 资料。",
  },
};

// The status badge: background, border, text.
const BADGE = {
  approved: ["#EAFAF6", "#86D4C7", "#087467"],
  needs_information: ["#FFF7E8", "#F2B253", "#A76500"],
  declined: ["#FDECEC", "#F0A8A8", "#A92323"],
};

function reviewDecisionEmail({
  companyName = "your company",
  recipientName = "",
  locale = "en",
  loginUrl = "https://the-sourcing-club.vercel.app/app.html",
  logoUrl = "https://the-sourcing-club.vercel.app/assets/logo.png",
  supportEmail = "operations@contact.sourcing-club.com",
  companyAddress = "New York, USA",
  note = "",
  decision = "approved",
} = {}) {
  const needsInformation = decision === "needs_information";
  const declined = decision === "declined";
  const t = (needsInformation ? needsInformationCopy : declined ? declinedCopy : copy)[locale === "zh" ? "zh" : "en"];
  const safeNote = String(note ?? "").trim();
  // The note is the card on a request or a decline, and a box of its own on an approval.
  const noteInCard = needsInformation || declined;
  const badge = BADGE[decision] ?? BADGE.approved;
  if (needsInformation && !safeNote) {
    throw new Error("A reviewer note is required for a more-information email");
  }
  const noteHtml = !noteInCard && safeNote ? `
                  <tr>
                    <td class="email-pad" style="padding:0 40px 24px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F8FAFC;border:1px solid #D7E0EA;border-radius:8px;">
                        <tr><td style="padding:20px 22px;">
                          <p style="margin:0 0 8px;font-size:14px;line-height:20px;font-weight:700;color:#0B1020;">${escapeHtml(t.noteTitle)}</p>
                          ${reviewNoteHtml(safeNote, { fontSize: "13px", lineHeight: "20px", color: "#5A6B87" })}
                        </td></tr>
                      </table>
                    </td>
                  </tr>` : "";
  const html = `<!doctype html>
<html lang="${locale === "zh" ? "zh" : "en"}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <title>${escapeHtml(t.subject)}</title>
    <style>
      @media only screen and (max-width: 620px) {
        .email-shell { width: 100% !important; }
        .email-pad { padding-left: 22px !important; padding-right: 22px !important; }
        .email-title { font-size: 27px !important; line-height: 32px !important; }
        .email-footer { padding-left: 22px !important; padding-right: 22px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#F1F4F8;color:#0B1020;font-family:'Satoshi',Arial,Helvetica,'PingFang SC','Microsoft YaHei','Noto Sans CJK SC',sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(t.preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F1F4F8;">
      <tr><td align="center" style="padding:36px 14px;">
        <table class="email-shell" role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;">
          <tr><td style="padding:0 0 16px 4px;">
            <img src="${escapeHtml(logoUrl)}" width="104" height="44" alt="The Sourcing Club" style="display:block;width:104px;height:44px;border:0;outline:none;text-decoration:none;">
          </td></tr>
          <tr><td style="background:#FFFFFF;border:1px solid #D7E0EA;border-radius:8px;overflow:hidden;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr><td style="height:4px;line-height:4px;background:#1A4DF2;font-size:0;">&nbsp;</td></tr>
              <tr><td class="email-pad" style="padding:38px 40px 24px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
                  <td style="height:24px;padding:0 10px;background:${badge[0]};border:1px solid ${badge[1]};border-radius:5px;color:${badge[2]};font-size:11px;line-height:24px;font-weight:700;">${escapeHtml(t.status)}</td>
                </tr></table>
                <p style="margin:22px 0 10px;font-size:12px;line-height:16px;font-weight:700;color:#5A6B87;text-transform:uppercase;">${escapeHtml(t.eyebrow)}</p>
                <h1 class="email-title" style="margin:0 0 14px;font-size:34px;line-height:39px;font-weight:800;color:#0B1020;">${escapeHtml(t.title)}</h1>
                <p style="margin:0 0 8px;font-size:15px;line-height:23px;color:#0B1020;">${escapeHtml(t.greeting(recipientName))}</p>
                <p style="margin:0;font-size:15px;line-height:23px;color:#5A6B87;">${escapeHtml(t.intro(companyName))}</p>
              </td></tr>
${declined && !safeNote ? "" : `              <tr><td class="email-pad" style="padding:0 40px 24px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F8FAFC;border:1px solid #D7E0EA;border-radius:8px;">
                  <tr><td style="padding:22px;">
                    <p style="margin:0 0 6px;font-size:11px;line-height:16px;font-weight:700;color:#5A6B87;text-transform:uppercase;">${escapeHtml(t.cardEyebrow)}</p>
                    <p style="margin:0 0 5px;font-size:17px;line-height:22px;font-weight:700;color:#0B1020;">${escapeHtml(t.cardTitle)}</p>
                    ${noteInCard ? `<div style="padding-top:5px;">${reviewNoteHtml(safeNote)}</div>` : `<p style="margin:0;font-size:13px;line-height:19px;color:#5A6B87;">${escapeHtml(t.cardCopy)}</p>`}
                  </td></tr>
                </table>
              </td></tr>`}${noteHtml}
              <tr><td class="email-pad" style="padding:0 40px 38px;">
                <h2 style="margin:0 0 8px;font-size:17px;line-height:22px;font-weight:700;color:#0B1020;">${escapeHtml(t.nextTitle)}</h2>
                <p style="margin:0 0 22px;font-size:14px;line-height:21px;color:#5A6B87;">${escapeHtml(t.nextCopy)}</p>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
                  <td align="center" bgcolor="#1A4DF2" style="border-radius:34px;">
                    <a href="${escapeHtml(loginUrl)}" style="display:inline-block;padding:11px 20px;color:#FFFFFF;text-decoration:none;font-size:13px;line-height:18px;font-weight:700;">${escapeHtml(t.cta)}</a>
                  </td>
                </tr></table>
              </td></tr>
            </table>
          </td></tr>
          <tr><td class="email-footer" style="padding:20px 4px 0;color:#5A6B87;">
            <p style="margin:0 0 6px;font-size:12px;line-height:18px;">${escapeHtml(t.help)} <a href="mailto:${escapeHtml(supportEmail)}" style="color:#1A4DF2;text-decoration:none;">${escapeHtml(supportEmail)}</a>.</p>
            <p style="margin:0;font-size:11px;line-height:17px;">${escapeHtml(t.footer)}<br>The Sourcing Club · ${escapeHtml(companyAddress)}</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  const noteText = safeNote ? `\n\n${noteInCard ? t.cardTitle : t.noteTitle}:\n${safeNote}` : "";
  const text = `${t.greeting(recipientName)}\n\n${t.intro(companyName)}${noteText}\n\n${t.nextTitle}\n${t.nextCopy}\n\n${t.cta}: ${loginUrl}\n\n${t.help} ${supportEmail}.\nThe Sourcing Club · ${companyAddress}`;
  return { subject: t.subject, html, text };
}

export const accountApprovedEmail = (options) => reviewDecisionEmail({ ...options, decision: "approved" });
export const needsInformationEmail = (options) => reviewDecisionEmail({ ...options, decision: "needs_information" });
export const declinedEmail = (options) => reviewDecisionEmail({ ...options, decision: "declined" });

const isDirectRun = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  await mkdir(outputDir, { recursive: true });
  const sample = accountApprovedEmail({
    recipientName: "Queena Wang",
    companyName: "Wonder Lab",
    logoUrl: "../assets/logo.png",
    loginUrl: "https://the-sourcing-club.vercel.app/app.html",
  });
  await writeFile(path.join(outputDir, "account-approved.html"), sample.html);
  const needsInformationSample = needsInformationEmail({
    recipientName: "Queena Wang",
    companyName: "Wonder Lab",
    logoUrl: "../assets/logo.png",
    loginUrl: "https://the-sourcing-club.vercel.app/app.html",
    note: "Your profile is nearly complete, but we could not confirm your registration.\n\n- A current business registration certificate showing your company name and address\n- Your company website, so we can match the legal name\n\nWe look forward to receiving these.",
  });
  await writeFile(path.join(outputDir, "more-information-needed.html"), needsInformationSample.html);
  console.log(`Generated account review emails in ${outputDir}`);
}
