/**
 * What a blocked message tells its sender, and the guidelines behind it.
 *
 * Queena's request (call of Nov 7): a message with contact details before a
 * contract is not sent, says so in one line, and links to the guidelines in a
 * pop-up. The three rules are Upwork's own buckets (sharing contact details,
 * paying outside, talking outside), worded for TSC. Upwork: contact details
 * may be shared once a contract has started. Fiverr: no contact details,
 * outside payments or outside contracts at all.
 *
 * Chinese is hand-written, never machine-translated (same rule as the legal
 * documents), and still needs a native speaker's check before it ships.
 * One language per surface: the reader gets one or the other, never both.
 */
export const MESSAGE_GUIDELINES = {
  en: {
    notSent: "Not sent",
    blocked: "TSC doesn't allow exchanging contact details before a contract. Repeated attempts may restrict your account. See the",
    link: "guidelines",
    title: "Messaging guidelines",
    close: "Close guidelines",
    rules: [
      {
        heading: "Contact details",
        body: "Before a contract, don't share or ask for an email, phone number, WeChat, WhatsApp or other app ID, social account or website link. Once a contract starts, you may share them.",
      },
      {
        heading: "Payments",
        body: "Pay and get paid only through TSC. Don't ask for or offer payment outside it.",
      },
      {
        heading: "Talking outside TSC",
        body: "Before a contract, keep the conversation on TSC. Use Schedule call for calls, not another app.",
      },
    ],
    footer: "Repeated attempts may restrict your account.",
  },
  zh: {
    notSent: "未发送",
    blocked: "签订合同前，TSC 不允许交换联系方式。多次尝试可能导致账户受限。请查看",
    link: "沟通规则",
    title: "沟通规则",
    close: "关闭",
    rules: [
      {
        heading: "联系方式",
        body: "签订合同前，请勿发送或索要邮箱、电话、微信、WhatsApp 等账号、社交媒体账号或网站链接。合同开始后即可交换。",
      },
      {
        heading: "付款",
        body: "所有付款和收款只能通过 TSC 进行。请勿要求或提出在平台外付款。",
      },
      {
        heading: "平台外沟通",
        body: "签订合同前，请在 TSC 内沟通。需要通话请使用“预约通话”，不要转到其他应用。",
      },
    ],
    footer: "多次违反可能导致账户受限。",
  },
};

/** The reader's guidelines: Chinese for a Chinese browser, English otherwise. */
export function guidelinesFor(languages) {
  const first = (Array.isArray(languages) ? languages : [languages]).find(Boolean) ?? "";
  return /^zh\b/i.test(String(first)) ? MESSAGE_GUIDELINES.zh : MESSAGE_GUIDELINES.en;
}
