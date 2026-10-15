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
 * of `notificationLink` in src/shared/notification-link.mjs. The smoke test
 * fails if the two ever disagree.
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
  return null;
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
  const body = String(row.body ?? "").trim();
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

  const html = `<!doctype html>
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
                      <p style="margin:0 0 10px;font-size:12px;line-height:16px;font-weight:700;color:#5A6B87;text-transform:uppercase;">${escapeHtml(setting)}</p>
                      <p style="margin:0 0 14px;font-size:15px;line-height:23px;color:#5A6B87;">${escapeHtml(t.greeting(row.recipient_name))}</p>
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
                <p style="margin:0 0 6px;font-size:12px;line-height:18px;">${escapeHtml(t.questions)} <a href="mailto:${escapeHtml(env.supportEmail)}" style="color:#1A4DF2;text-decoration:none;">${escapeHtml(env.supportEmail)}</a>.</p>
                <p style="margin:0;font-size:11px;line-height:17px;">${escapeHtml(why)}<br>The Sourcing Club · ${escapeHtml(env.companyAddress)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject: title, html, text };
}
