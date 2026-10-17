/**
 * The email sent for an ordinary notification (a quote, a payment, a message,
 * a call). Built on the same frame as the designed onboarding and approval
 * emails: logo, white card with the blue bar, eyebrow, title, one button.
 *
 * The title and body are the notification's own words, as the bell shows
 * them. The frame around them is hand-written in English and Chinese; the
 * notification text itself is not translated.
 *
 * Self-contained on purpose: Vercel builds api/ on its own and a static
 * import from src/ stops the function starting, so the link rules are a copy
 * of `notificationLink` in src/shared/notification-link.mjs, and the dates a
 * copy of `notificationBody` in src/shared/notification-text.mjs. The smoke
 * test fails if either pair ever disagrees.
 */

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

/** Same answers as notificationLink() in src/shared/notification-link.mjs. */
export function notificationPath(notification, { isFactory }) {
  const { subject_type: type, subject_id: id } = notification;
  if (!id) return null;
  if (type === "rfq" && !isFactory && ["quote_received", "quote_withdrawn"].includes(notification.kind)) {
    return `/rfqs/${id}/quotes`;
  }
  if (type === "rfq") return isFactory ? `/browse/${id}` : `/rfqs/${id}`;
  if (type === "order") return `/orders/${id}`;
  if (type === "milestone" && notification.order_id) return `/orders/${notification.order_id}/milestones/${id}`;
  if (type === "payment" && notification.order_id) return `/orders/${notification.order_id}/payments/${id}`;
  if (type === "thread") return `/messages/${id}`;
  // Capacity is updated from the factory's dashboard.
  if (type === "capacity" && isFactory) return "/";
  // Credits are on the factory's Payments page.
  if (type === "credits" && isFactory) return "/payout?tab=credits";
  return null;
}

/** Same answers as notificationBody() in src/shared/notification-text.mjs. */
export function notificationBody(notification, { timeZone, withZone = false } = {}) {
  const body = String(notification?.body ?? "");
  const data = notification?.data ?? {};
  const moment = (iso) => formatMoment(iso, timeZone, withZone);

  if (data.quote_deadline && /Quotes close [^.]*\./.test(body)) {
    const when = moment(data.quote_deadline);
    if (when) return body.replace(/Quotes close [^.]*\./, `Quotes close ${when}.`);
  }
  if (data.starts_at && String(notification?.kind ?? "").startsWith("call_")) {
    const when = moment(data.starts_at);
    if (when) return body ? `${body} · ${when}` : when;
  }
  return body;
}

function formatMoment(iso, timeZone, withZone) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const options = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  if (withZone) options.timeZoneName = "short";
  try {
    return new Intl.DateTimeFormat("en-US", { ...options, ...(timeZone ? { timeZone } : {}) }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(date);
  }
}

// Each switch's name is the designed Settings label; the Chinese is the
// factory prototype's own hand-written translation where one exists.
const copy = {
  en: {
    eyebrow: {
      rfq: (isFactory) => (isFactory ? "New RFQ matches" : "New quote activity"),
      payments: () => "Payment and approval requests",
      messages: () => "Messages and call invites",
    },
    greeting: (name) => (name ? `Hi ${name},` : "Hi,"),
    lead: (company) => `There is an update for ${company} on The Sourcing Club.`,
    cta: "Open in The Sourcing Club",
    ctaFallback: "Open The Sourcing Club",
    why: (company, setting) =>
      `You’re receiving this because ${company} has “${setting}” emails turned on. Any member can turn them off in Settings → Notifications.`,
    questions: "Questions? Reply to this email or contact",
  },
  zh: {
    eyebrow: {
      rfq: (isFactory) => (isFactory ? "新的匹配询价" : "新的报价动态"),
      payments: () => "付款与审批请求",
      messages: () => "消息与通话邀请",
    },
    greeting: (name) => (name ? `${name} 你好，` : "你好，"),
    lead: (company) => `${company} 在 The Sourcing Club 有一条新动态。`,
    cta: "在 The Sourcing Club 中查看",
    ctaFallback: "打开 The Sourcing Club",
    why: (company, setting) =>
      `你收到这封邮件，是因为 ${company} 开启了“${setting}”邮件通知。任何成员都可以在 设置 → 通知 中关闭。`,
    questions: "有问题？直接回复此邮件，或联系",
  },
};

/**
 * The designed frame: logo, white card with the blue bar, eyebrow, greeting,
 * title, body, one button, footer. Shared by every email built here.
 */
function emailHtml({ locale, title, eyebrow, greeting, body, url, cta, why, questions }, env) {
  return `<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <title>${escapeHtml(title)}</title>
    <style>
      @media only screen and (max-width: 620px) {
        .email-shell { width: 100% !important; }
        .email-pad { padding-left: 22px !important; padding-right: 22px !important; }
        .email-title { font-size: 24px !important; line-height: 30px !important; }
        .email-footer { padding-left: 22px !important; padding-right: 22px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#F1F4F8;color:#0B1020;font-family:'Satoshi',Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(body || title)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F1F4F8;">
      <tr>
        <td align="center" style="padding:36px 14px;">
          <table class="email-shell" role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;">
            <tr>
              <td style="padding:0 0 16px 4px;">
                <img src="${escapeHtml(env.logoUrl)}" width="104" height="44" alt="The Sourcing Club" style="display:block;width:104px;height:44px;border:0;outline:none;text-decoration:none;object-fit:contain;">
              </td>
            </tr>
            <tr>
              <td style="background:#FFFFFF;border:1px solid #D7E0EA;border-radius:8px;overflow:hidden;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr><td style="height:4px;line-height:4px;background:#1A4DF2;font-size:0;">&nbsp;</td></tr>
                  <tr>
                    <td class="email-pad" style="padding:34px 40px 36px;">
                      <p style="margin:0 0 10px;font-size:12px;line-height:16px;font-weight:700;color:#5A6B87;text-transform:uppercase;">${escapeHtml(eyebrow)}</p>
                      <p style="margin:0 0 14px;font-size:15px;line-height:23px;color:#5A6B87;">${escapeHtml(greeting)}</p>
                      <h1 class="email-title" style="margin:0 0 12px;font-size:28px;line-height:34px;font-weight:800;color:#0B1020;">${escapeHtml(title)}</h1>
                      ${body ? `<p style="margin:0 0 24px;font-size:15px;line-height:23px;color:#5A6B87;white-space:pre-wrap;">${escapeHtml(body)}</p>` : ""}
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td align="center" bgcolor="#1A4DF2" style="border-radius:34px;">
                            <a href="${escapeHtml(url)}" style="display:inline-block;padding:11px 20px;color:#FFFFFF;text-decoration:none;font-size:13px;line-height:18px;font-weight:700;">${escapeHtml(cta)}</a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="email-footer" style="padding:20px 4px 0;color:#5A6B87;">
                <p style="margin:0 0 6px;font-size:12px;line-height:18px;">${escapeHtml(questions)} <a href="mailto:${escapeHtml(env.supportEmail)}" style="color:#1A4DF2;text-decoration:none;">${escapeHtml(env.supportEmail)}</a>.</p>
                <p style="margin:0;font-size:11px;line-height:17px;">${escapeHtml(why)}<br>The Sourcing Club · ${escapeHtml(env.companyAddress)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

}

/**
 * @param row  one claimed outbox row (claim_notification_emails), or sample data
 * @param env  { appUrl, logoUrl, supportEmail, companyAddress }
 * @returns {{ subject: string, html: string, text: string }}
 */
export function notificationEmail(row, env) {
  const locale = row.locale === "zh" ? "zh" : "en";
  const t = copy[locale];
  const isFactory = row.org_type === "factory";
  const company = row.org_name || (locale === "zh" ? "你的公司" : "your company");
  const setting = t.eyebrow[row.category]?.(isFactory) ?? "";
  const path = notificationPath(row, { isFactory });
  const url = `${env.appUrl}/app.html${path ?? ""}${!path && isFactory ? "?portal=factory" : ""}`;
  const cta = path ? t.cta : t.ctaFallback;
  const title = String(row.title ?? "").trim() || t.lead(company);
  // Dates in the recipient's saved zone, named; UTC, named, when unknown.
  const body = notificationBody(row, { timeZone: row.time_zone || "UTC", withZone: true }).trim();
  const why = t.why(company, setting);

  const text = [
    t.greeting(row.recipient_name),
    "",
    title,
    body,
    "",
    `${cta}: ${url}`,
    "",
    why,
    `${t.questions} ${env.supportEmail}.`,
  ].filter((line, index, lines) => line !== "" || lines[index - 1] !== "").join("\n");

  const html = emailHtml({
    locale, title, eyebrow: setting, greeting: t.greeting(row.recipient_name), body, url, cta, why, questions: t.questions,
  }, env);

  return { subject: title, html, text };
}

const inviteCopy = {
  factory: {
    eyebrow: "Invitation",
    title: (inviter) => `${inviter} invited you to The Sourcing Club`,
    body: "The Sourcing Club connects factories with brands looking for production. Create your factory's account, complete your profile, and once TSC verifies it you get 500 credits to send quotes.",
    zh: (inviter) => `${inviter} 邀请你加入 The Sourcing Club。创建工厂账户并完成资料，通过 TSC 验证后即可获得 500 报价额度。`,
    cta: "Create your factory account",
  },
  brand: {
    eyebrow: "Invitation",
    title: (inviter) => `${inviter} invited you to The Sourcing Club`,
    body: "The Sourcing Club helps brands find verified factories, compare quotes and run production orders in one place. Create your brand's account to get started.",
    zh: null,
    cta: "Create your brand account",
  },
};

/**
 * The invite one company sends another (api/send-invite). The sender's own
 * message is quoted as plain text. It promises the invited company only
 * what the product gives it: a factory's 500 credits on verification, and
 * for a brand nothing in money, since the brand discount is not decided.
 *
 * @param invite  { inviterName, kind: "factory" | "brand", message }
 * @param env     { appUrl, logoUrl, supportEmail, companyAddress }
 */
export function inviteEmail(invite, env) {
  const kind = invite.kind === "factory" ? "factory" : "brand";
  const t = inviteCopy[kind];
  const inviter = String(invite.inviterName ?? "").trim() || "A company";
  const title = t.title(inviter);
  const note = String(invite.message ?? "").trim().slice(0, 1000);
  const url = `${env.appUrl}/app.html${kind === "factory" ? "?portal=factory" : ""}`;
  const body = [note ? `“${note}”` : null, t.body, t.zh?.(inviter)].filter(Boolean).join("\n\n");
  const why = `You received this because someone at ${inviter} entered this address. If you weren't expecting it, you can ignore it: nothing was set up for you.`;
  const questions = "Questions? Reply to this email, or contact";

  const text = [title, "", body, "", `${t.cta}: ${url}`, "", why, `${questions} ${env.supportEmail}.`].join("\n");
  const html = emailHtml({ locale: "en", title, eyebrow: t.eyebrow, greeting: "Hello,", body, url, cta: t.cta, why, questions }, env);
  return { subject: title, html, text };
}
