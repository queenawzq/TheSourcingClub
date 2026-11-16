/**
 * A notification in Chinese, for a reader whose `user_profiles.locale` is zh.
 *
 * The database writes each notification once, in English, for the whole
 * company; who reads it, and in which language, is only known when it is
 * read. So the bell and the email say it in the reader's language here, from
 * the English the database wrote: each title and each sentence the database
 * (or the server) can write has its Chinese below, keyed on the fixed words
 * around the values. The values (names, order numbers, step titles, amounts)
 * are kept as written; dates come from `data` in the reader's zone.
 *
 * Anything not recognised is shown in English, whole: half a sentence in
 * each language is worse than either. What people typed (a reviewer's note,
 * a cancellation reason, a step update) is never translated here; a message
 * is, through `data.message_text`, by the server that screened it.
 *
 * No imports, on purpose: both src/shared/notification-text.mjs and
 * scripts/generate-notification-email.mjs (built on its own for api/) use it.
 * `npm run check:dates` renders every kind here and fails on English left in a
 * Chinese title.
 */

const AMOUNT = String.raw`((?:\$|[A-Z]{3} )[\d,]+\.\d\d)`;
const amountRe = (source) => new RegExp(source.replaceAll("AMT", AMOUNT));

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

/** "2026-11-20" → "11月20日"; null for anything else. A date column is a day: no zone. */
export function zhDay(value) {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
  return day ? `${Number(day[2])}月${Number(day[3])}日` : null;
}

/** "11月20日（周五）16:00", with "GMT+8" when asked; in the zone given, else the runtime's. */
export function zhMoment(date, timeZone, withZone = false) {
  const options = { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  if (withZone) options.timeZoneName = "short";
  let parts;
  try {
    parts = new Intl.DateTimeFormat("zh-CN", { ...options, ...(timeZone ? { timeZone } : {}) }).formatToParts(date);
  } catch {
    // An unknown zone name: say it in UTC rather than not at all.
    parts = new Intl.DateTimeFormat("zh-CN", { ...options, timeZone: "UTC" }).formatToParts(date);
  }
  const part = (type) => parts.find((each) => each.type === type)?.value ?? "";
  const zone = withZone && part("timeZoneName") ? ` ${part("timeZoneName")}` : "";
  return `${Number(part("month"))}月${Number(part("day"))}日（${part("weekday")}）${part("hour")}:${part("minute")}${zone}`;
}

/** "Nov 20" (the database's to_char 'FMMon FMDD') → "11月20日"; else as written. */
function zhMonthDay(value) {
  const words = /^([A-Z][a-z]{2}) (\d{1,2})$/.exec(String(value ?? "").trim());
  return words && MONTHS[words[1]] ? `${MONTHS[words[1]]}月${Number(words[2])}日` : value;
}

/** The words the database puts in when a name is missing. */
const fallbackName = (name) => ({
  "The brand": "品牌",
  "A brand": "一个品牌",
  "A vendor": "一家供应商",
  "a request": "一个询价",
  "your request": "你的询价",
  "none": "无",
}[name] ?? name);

const quoted = (text) => `“${fallbackName(text)}”`;

/**
 * A value inside a Chinese sentence: spaced from the Chinese around it when it
 * is a name ("Maison Rue 就 TSC-1042 给…"), not when it is our own Chinese
 * fallback ("一个品牌正在…").
 */
const own = (text) => fallbackName(text) !== text;
const lead = (text) => (own(text) ? fallbackName(text) : `${text} `);
const inner = (text) => (own(text) ? fallbackName(text) : ` ${text} `);

/** A space between Chinese and a Latin word: "账号和 SWIFT 代码". */
const spaced = (text) => String(text)
  .replace(/([\u4e00-\u9fff])([A-Za-z0-9])/g, "$1 $2")
  .replace(/([A-Za-z0-9])([\u4e00-\u9fff])/g, "$1 $2");

/** "Chase ending 1234" → "Chase（尾号 1234）". */
const bank = (named) => String(named).replace(/ ending (\d+)$/, "（尾号 $1）");

/** Stripe's "Bank account ending in 1234" / "Debit card ending in 4242". */
const stripeMethod = (named) => {
  const parts = /^(bank account|debit card)(?: ending in (\d+))?$/i.exec(String(named).trim());
  if (!parts) return null;
  const what = /^bank/i.test(parts[1]) ? "银行账户" : "借记卡";
  return parts[2] ? `${what}（尾号 ${parts[2]}）` : what;
};

/** "account number, SWIFT code and address" → "账号、SWIFT 代码和地址". */
const DETAILS = {
  "bank details": "银行信息",
  "PayPal address": "PayPal 地址",
  "SWIFT code": "SWIFT 代码",
  "account number": "账号",
  "account holder's name": "账户持有人姓名",
  address: "地址",
  "bank name": "银行名称",
};
const details = (list) => {
  const named = String(list).split(/, | and /).map((each) => DETAILS[each.trim()]);
  if (named.some((each) => !each)) return null;
  return spaced(named.length > 1 ? `${named.slice(0, -1).join("、")}和${named.at(-1)}` : named[0]);
};

/** "GOTS certificate" / "Your evidence" (a term's English label) → "GOTS 证书" / "你的证明材料". */
const evidence = (label) => String(label)
  .replace(/^Your\b ?/, "你的")
  .replace(/ ?certificate$/, " 证书")
  .replace(/ ?evidence$/, " 证明材料")
  .replace(/^你的 /, "你的");

/**
 * Titles, by kind. Each pattern is the English the database writes, anchored
 * at both ends; the function gets the captured values.
 */
const TITLES = [
  ["team_member_joined", /^(.+) joined (.+)$/, (who, org) => `${who} 已加入 ${org}`],
  ["team_member_left", /^(.+) left (.+)$/, (who, org) => `${who} 已离开 ${org}`],
  ["team_member_removed", /^(.+) no longer has access to (.+)$/, (who, org) => `${who} 已无法访问 ${org}`],
  ["order_activated", /^(.+) is under way$/, (order) => `${order} 已开始生产`],
  ["credits_adjusted", /^TSC added (\d+) credits$/, (n) => `TSC 为你增加了 ${n} 额度`],
  ["credits_adjusted", /^TSC removed (\d+) credits$/, (n) => `TSC 扣除了你 ${n} 额度`],
  ["verification_approved", /^Your profile is verified$/, () => "你的资料已通过验证"],
  ["verification_declined", /^We could not verify your profile$/, () => "我们无法验证你的资料"],
  ["verification_needs_information", /^We need a little more information$/, () => "我们还需要一些信息"],
  ["verification_reopened", /^Your legal name changed: TSC will verify it again$/, () => "你的法定名称已变更：TSC 将重新验证"],
  ["verification_reopened", /^Your company name changed: TSC will verify it again$/, () => "你的公司名称已变更：TSC 将重新验证"],
  ["verification_reopened", /^Your registration number changed: TSC will verify it again$/, () => "你的注册号已变更：TSC 将重新验证"],
  ["order_completed", /^(.+) is complete$/, (order) => `${order} 已完成`],
  ["payment_due", amountRe("^AMT is due on (.+)$"), (amount, order) => `${order} 有一笔 ${amount} 待付款`],
  ["schedule_agreed", /^The factory agreed the production steps on (.+)$/, (order) => `工厂已同意 ${order} 的生产步骤`],
  ["schedule_updated", /^The brand changed the production steps on (.+)$/, (order) => `品牌修改了 ${order} 的生产步骤`],
  ["schedule_updated", /^The brand updated milestones on (.+)$/, (order) => `品牌更新了 ${order} 的生产步骤`],
  ["message", /^(.+) messaged you about (.+)$/, (who, about) => `${who} 就${inner(about)}给你发了消息`],
  ["message_rejected", /^Your message to (.+) about (.+) was not delivered$/, (who, about) => `你就${inner(about)}发给 ${who} 的消息未送达`],
  ["milestone_approved", /^"(.+)" was approved$/, (step) => `${quoted(step)}已获批准`],
  ["milestone_submitted", /^"(.+)" is ready for you$/, (step) => `${quoted(step)}等待你审核`],
  ["milestone_dispute", /^Dispute opened on "(.+)"$/, (step) => `${quoted(step)}已发起争议`],
  ["milestone_update", /^New update on "(.+)"$/, (step) => `${quoted(step)}有新的进度更新`],
  ["milestone_update", /^New comment on "(.+)"$/, (step) => `${quoted(step)}有新的评论`],
  ["milestone_reminder", /^Reminder: "(.+)"$/, (step) => `提醒：${quoted(step)}`],
  ["quote_accepted", /^Your quote for "(.+)" was accepted$/, (rfq) => `你对${quoted(rfq)}的报价已被接受`],
  ["quote_accepted", /^Your quote was accepted$/, () => "你的报价已被接受"],
  ["quote_declined", /^Your quote was not selected$/, () => "你的报价未被选中"],
  ["quote_received", /^(.+) sent a (revised quote|quote) on "(.+)"$/, (who, what, rfq) => `${lead(who)}就${quoted(rfq)}发送了${what === "quote" ? "报价" : "修改后的报价"}`],
  ["quote_withdrawn", /^(.+) withdrew its quote on "(.+)"$/, (who, rfq) => `${lead(who)}撤回了对${quoted(rfq)}的报价`],
  ["order_created", /^Production order (.+) is ready$/, (order) => `生产订单 ${order} 已创建`],
  ["order_cancelled", /^(.+) was cancelled$/, (order) => `${order} 已取消`],
  ["rfq_cancelled", /^(.+) cancelled "(.+)"$/, (who, rfq) => `${lead(who)}已取消${quoted(rfq)}`],
  ["rfq_matched", /^New request that matches you: "(.+)"$/, (rfq) => `新的匹配询价：${quoted(rfq)}`],
  ["rfq_invited", /^(.+) invited you to quote on "(.+)"$/, (who, rfq) => `${lead(who)}邀请你为${quoted(rfq)}报价`],
  ["cancellation_proposed", /^(.+) has been proposed for cancellation$/, (order) => `${order} 被提议取消`],
  ["cancellation_declined", /^(.+?): (.+) wants to keep the order$/, (order, who) => `${order}：${who} 希望保留订单`],
  ["cancellation_withdrawn", /^(.+): cancellation withdrawn$/, (order) => `${order}：取消提议已撤回`],
  ["payment_confirmed", /^Payment confirmed on (.+)$/, (order) => `${order} 的付款已确认`],
  ["payment_confirmed", /^Your payment on (.+) was confirmed$/, (order) => `你在 ${order} 的付款已确认`],
  ["payment_confirmed", /^Payment held for "(.+)"$/, (step) => `${quoted(step)}的款项已由 TSC 托管`],
  ["payment_confirmed", /^Your payment for "(.+)" is funded$/, (step) => `你为${quoted(step)}支付的款项已到账`],
  ["payment_failed", /^Your payment for "(.+)" did not go through$/, (step) => `你为${quoted(step)}的付款未成功`],
  ["payment_failed", /^The payment for "(.+)" did not go through$/, (step) => `${quoted(step)}的付款未成功`],
  ["payment_processing", /^A payment for "(.+)" is on its way$/, (step) => `${quoted(step)}的一笔付款正在处理中`],
  ["payment_refunded", /^Your payment for "(.+)" was refunded$/, (step) => `你为${quoted(step)}支付的款项已退款`],
  ["payment_refunded", /^The payment for "(.+)" was refunded$/, (step) => `${quoted(step)}的款项已退款`],
  ["payment_refunded", /^The payment for "(.+)" went back to the brand$/, (step) => `${quoted(step)}的款项已退回品牌`],
  ["payment_rejected", /^We could not find your payment on (.+)$/, (order) => `我们未找到你在 ${order} 的付款`],
  ["payment_sent", /^(.+) says a payment is on its way$/, (who) => `${who} 表示付款已在途中`],
  ["funds_released", amountRe("^AMT released to you$"), (amount) => `${amount} 已打款给你`],
  ["funds_released", amountRe("^AMT paid out to you$"), (amount) => `${amount} 已支付给你`],
  ["withdrawal", amountRe("^Withdrawal of AMT requested$"), (amount) => `已申请提现 ${amount}`],
  ["withdrawal", amountRe("^Withdrawal of AMT cancelled$"), (amount) => `提现 ${amount} 已取消`],
  ["withdrawal", amountRe("^Withdrawal of AMT declined$"), (amount) => `提现 ${amount} 被拒绝`],
  ["withdrawal", amountRe("^Withdrawal of AMT did not go through$"), (amount) => `提现 ${amount} 未成功`],
  ["payout_method_changed", /^Your payout methods changed$/, () => "你的收款方式已变更"],
  ["payout_method_changed", /^Withdrawals are paused$/, () => "提现已暂停"],
  ["payout_method_changed", /^Payments to you are paused$/, () => "向你的付款已暂停"],
  ["payout_method_changed", /^Finish setup to withdraw$/, () => "完成设置后即可提现"],
  ["payout_method_changed", /^Finish setup to receive earnings$/, () => "完成设置后即可收款"],
  ["payout_method_changed", /^Check your (.+)$/, (list) => (details(list) ? `请检查你的${details(list)}` : null)],
  ["credits_granted", /^You have (\d+) credits$/, (n) => `你获得了 ${n} 额度`],
  ["referral_rewarded", /^You earned (\d+) credits$/, (n) => `你赚取了 ${n} 额度`],
  ["referral_joined", /^(.+) joined from your invite$/, (who) => `${who} 通过你的邀请加入了`],
  ["capacity_reminder", /^Set your open capacity$/, () => "设置你的可接单产能"],
  ["capacity_reminder", /^Is your capacity still right\?$/, () => "你的产能信息还准确吗？"],
  ["matching_evidence_approved", /^(.+) was approved$/, (label) => `${evidence(label)}已通过审核`],
  ["matching_evidence_rejected", /^(.+) was not accepted$/, (label) => `${evidence(label)}未被接受`],
  ["matching_evidence_needs_information", /^We need more information about (.+)$/, (label) => spaced(`我们需要更多关于${evidence(label)}的信息`)],
  ["call_proposed", /^(.+) invited you to a call about (.+)$/, (who, about) => `${who} 邀请你就${inner(about)}进行通话`],
  ["call_accepted", /^(.+) accepted your call about (.+)$/, (who, about) => `${who} 接受了关于${inner(about)}的通话`],
  ["call_declined", /^(.+) declined your call about (.+)$/, (who, about) => `${who} 拒绝了关于${inner(about)}的通话`],
  ["call_countered", /^(.+) proposed another time for your call about (.+)$/, (who, about) => `${who} 为关于${inner(about)}的通话提议了新时间`],
  ["call_cancelled", /^(.+) withdrew the invite to a call about (.+)$/, (who, about) => `${who} 撤回了关于${inner(about)}的通话邀请`],
  ["call_cancelled", /^(.+) cancelled the call about (.+)$/, (who, about) => `${who} 取消了关于${inner(about)}的通话`],
];

/**
 * Sentences a body can be made of: the database's fixed bodies, the payout
 * notices (database and server), the refund and failure reasons the server
 * passes in. A body is translated sentence by sentence, or not at all.
 * `ctx.day` is the step's due date from `data`, `ctx.deadline` the quote
 * deadline in the reader's zone.
 */
const SENTENCES = [
  // People
  [/^They accepted the invitation and can now work with the permissions it gave them\.$/, () => "对方已接受邀请，现在可以按邀请中的权限开展工作。"],
  [/^Everything they worked on stays with the company\.$/, () => "其经手的所有内容都保留在公司中。"],
  [/^The invitation they sent was withdrawn\.$/, () => "其发出的邀请已撤回。"],
  [/^The (\d+) invitations they sent were withdrawn\.$/, (n) => `其发出的 ${n} 份邀请已撤回。`],
  // Orders and steps
  [/^The brand confirmed the production steps\.$/, () => "品牌已确认生产步骤。"],
  [/^The first step is open\.$/, () => "第一个步骤已开启。"],
  [/^Every step on this order is done\.$/, () => "此订单的所有步骤均已完成。"],
  [/^Confirm them and the order starts\.$/, () => "确认后订单即开始。"],
  [/^The brand approved this step\.$/, () => "品牌已批准此步骤。"],
  [amountRe("^TSC will send you AMT\\.$"), (amount) => `TSC 将向你支付 ${amount}。`],
  [amountRe("^TSC will send you AMT once you add a withdrawal method\\.$"), (amount) => `你添加提现方式后，TSC 将向你支付 ${amount}。`],
  [/^You can carry on to the next step\.$/, () => "你可以继续进行下一步。"],
  [/^(.+) accepted your quote for "(.+)"\.$/, (who, rfq) => `${who} 接受了你对${quoted(rfq)}的报价。`],
  [/^The brand is setting the production steps; you will be told when they start\.$/, () => "品牌正在设置生产步骤，开始时会通知你。"],
  [/^"(.+)" was awarded to another factory\.$/, (rfq) => `${quoted(rfq)}已授予其他工厂。`],
  [/^Thank you for quoting\.$/, () => "感谢你的报价。"],
  [/^Review the production steps drafted from their quote, then confirm them to start\.$/, () => "请查看根据其报价起草的生产步骤，确认后即可开始。"],
  [/^(.+) accepted\.$/, (who) => `${who} 已接受。`],
  [/^Nothing starts until the brand confirms them\.$/, () => "品牌确认之前，任何步骤都不会开始。"],
  [/^If something does not work for you, message the brand\.$/, () => "如有不合适之处，请给品牌发消息。"],
  [/^Review the updated production steps, payment amounts, and due dates\.$/, () => "请查看更新后的生产步骤、付款金额和截止日期。"],
  [/^The factory has sent this step for your approval\.$/, () => "工厂已提交此步骤，等待你批准。"],
  [/^This production step on (.+) is due (?:[A-Z][a-z]{2} \d{1,2}) and needs an update\.$/, (order, ctx) => (ctx.day ? `${order} 中的此生产步骤将于 ${ctx.day} 到期，需要更新进度。` : null)],
  [/^This step on (.+) is waiting for your payment\.$/, (order) => `${order} 中的此步骤正在等待你付款。`],
  [/^This step on (.+) is waiting for your approval\.$/, (order) => `${order} 中的此步骤正在等待你的批准。`],
  [/^It is due (?:[A-Z][a-z]{2} \d{1,2})\.$/, (ctx) => (ctx.day ? `截止日期：${ctx.day}。` : null)],
  [/^This production step was due (\d{4}-\d{2}-\d{2}) and needs an update\.$/, (day) => `此生产步骤已于 ${zhDay(day)} 到期，需要更新进度。`],
  [/^This production step is due (\d{4}-\d{2}-\d{2}) and needs an update\.$/, (day) => `此生产步骤将于 ${zhDay(day)} 到期，需要更新进度。`],
  [/^The payment for this step is due\.$/, () => "此步骤的款项已到期。"],
  [/^This step is waiting for your approval\.$/, () => "此步骤正在等待你的批准。"],
  [/^(.+) withdrew its proposal to cancel\.$/, (who) => `${who} 撤回了取消提议。`],
  [/^The order carries on\.$/, () => "订单将继续进行。"],
  // Requests and quotes
  [/^(.+) is looking for a factory\.$/, (who) => `${lead(who)}正在寻找工厂。`],
  [/^Quotes close ([A-Z][a-z]{2} \d{1,2}|.+)\.$/, (when, ctx) => `报价截止：${ctx.deadline ?? zhMonthDay(when)}。`],
  [/^Open the request to read the brief and send a quote\.$/, () => "打开询价查看需求并发送报价。"],
  [/^Compare it with the other quotes on this request\.$/, () => "请与此询价的其他报价进行比较。"],
  [/^It no longer appears in your comparison\.$/, () => "它将不再出现在你的比较中。"],
  [/^The brand is no longer taking quotes on this request\.$/, () => "品牌已不再接受此询价的报价。"],
  // Payments
  [/^"(.+)"\.$/, (step) => `${quoted(step)}。`],
  [/^Fund it by card; TSC holds it until the step is done\.$/, () => "请用银行卡付款，TSC 会托管这笔款项，直到该步骤完成。"],
  [amountRe('^AMT has arrived for "(.+)"\\.$'), (amount, step) => `${quoted(step)}的 ${amount} 已到账。`],
  [/^You can start this work\.$/, () => "你可以开始这项工作了。"],
  [amountRe("^AMT received\\.$"), (amount) => `已收到 ${amount}。`],
  [/^The factory has been told to begin\.$/, () => "已通知工厂开始。"],
  [amountRe("^AMT received on (.+)\\.$"), (amount, order) => `已收到 ${order} 的 ${amount}。`],
  [/^TSC will pay the factory\.$/, () => "TSC 将向工厂付款。"],
  [/^TSC holds it and pays the factory when you approve this step\.$/, () => "TSC 会托管这笔款项，并在你批准此步骤后向工厂付款。"],
  [amountRe("^TSC received AMT on (.+) and will send it to you\\.$"), (amount, order) => `TSC 已收到 ${order} 的 ${amount}，将支付给你。`],
  [amountRe("^TSC received AMT on (.+) and will send it to you once you add a withdrawal method\\.$"), (amount, order) => `TSC 已收到 ${order} 的 ${amount}，你添加提现方式后将支付给你。`],
  [amountRe("^TSC holds AMT for this step on (.+)\\.$"), (amount, order) => `TSC 已为 ${order} 中的此步骤托管 ${amount}。`],
  [/^You can start this work; it is paid to you when the brand approves it\.$/, () => "你可以开始这项工作，品牌批准后款项将支付给你。"],
  [amountRe("^AMT on (.+)\\.$"), (amount, order) => `${order}：${amount}。`],
  [/^It is still being confirmed\.$/, () => "款项仍在确认中。"],
  [/^We will tell you when TSC holds it; please do not start this work yet\.$/, () => "TSC 托管后我们会通知你，请暂时不要开始这项工作。"],
  [/^We will confirm here once it lands — please do not start on this yet\.$/, () => "款项到账后我们会在这里确认，请暂时不要开始这项工作。"],
  [/^Pay again from the step's payment page on (.+)\.$/, (order) => `请在 ${order} 中该步骤的付款页面重新付款。`],
  [/^Nothing is held for this step on (.+) yet\.$/, (order) => `${order} 中的此步骤尚无托管款项。`],
  [/^The brand has been asked to pay again\.$/, () => "已请品牌重新付款。"],
  [/^The brand has been asked to pay again; we will tell you when it is held\.$/, () => "已请品牌重新付款，托管后我们会通知你。"],
  [/^TSC no longer holds money for this step on (.+)\.$/, (order) => `TSC 已不再为 ${order} 中的此步骤托管款项。`],
  [/^You will be asked to pay when the step opens on (.+)\.$/, (order) => `${order} 中该步骤开启时，会再请你付款。`],
  [/^The order was cancelled\.$/, () => "订单已取消。"],
  [/^(.+) was cancelled\.$/, (order) => `${order} 已取消。`],
  [/^You were refunded\.$/, () => "款项已退还给你。"],
  [/^The amount changed while you were paying\.$/, () => "你付款时金额发生了变化。"],
  [/^You were refunded; please pay again\.$/, () => "款项已退还，请重新付款。"],
  [/^The order was cancelled before your payment went through\.$/, () => "你的付款完成前订单已被取消。"],
  [/^This step was not open for payment\.$/, () => "此步骤尚未开放付款。"],
  [/^This step no longer takes a payment\.$/, () => "此步骤不再需要付款。"],
  // Why a card payment failed (api/_card-words.js)
  [/^Your card was declined\.$/, () => "你的银行卡被拒绝。"],
  [/^The payment did not go through, so nothing was charged\.$/, () => "付款未成功，未扣任何费用。"],
  [/^Your bank did not confirm this payment, so nothing was charged\.$/, () => "你的银行未确认此笔付款，未扣任何费用。"],
  [/^This card could not be used, so nothing was charged\.$/, () => "此卡无法使用，未扣任何费用。"],
  [/^Your card has insufficient funds\.$/, () => "你的银行卡余额不足。"],
  [/^Your card has expired\.$/, () => "你的银行卡已过期。"],
  [/^The security code is wrong\.$/, () => "安全码错误。"],
  [/^The card number is wrong\.$/, () => "卡号错误。"],
  [/^The postal code doesn't match this card\.$/, () => "邮政编码与此卡不符。"],
  [/^The card could not be processed, so nothing was charged\.$/, () => "此卡无法处理，未扣任何费用。"],
  [/^Sent to (.+) against (.+)\.$/, (to, order) => `已转入 ${bank(to)}，对应订单 ${order}。`],
  [/^Sent by Payoneer against (.+)\.$/, (order) => `已通过 Payoneer 支付，对应订单 ${order}。`],
  [/^Payoneer payment ID (.+)\.$/, (id) => `Payoneer 付款编号：${id}。`],
  [/^Sent by bank transfer against (.+)\.$/, (order) => `已通过银行转账支付，对应订单 ${order}。`],
  [/^Sent against (.+)\.$/, (order) => `对应订单 ${order}。`],
  // Withdrawals
  [/^To (.+)\.$/, (to) => `转至 ${bank(to)}。`],
  [/^TSC will send it after checking\.$/, () => "TSC 审核后将发送。"],
  [/^The amount is back in your balance\.$/, () => "该金额已退回你的余额。"],
  [/^Check your withdrawal method, then withdraw again\.$/, () => "请检查你的提现方式，然后重新提现。"],
  [/^Sent by bank transfer to (.+)\.$/, (to) => `已通过银行转账转入 ${bank(to)}。`],
  [/^Sent to (.+)\.$/, (to) => `已转入 ${bank(to)}。`],
  [amountRe("^Fee AMT; you receive AMT\\.$"), (fee, receives) => `手续费 ${fee}；你将收到 ${receives}。`],
  [amountRe("^Your payment of AMT is waiting\\.$"), (amount) => `你的一笔 ${amount} 款项正在等待处理。`],
  [/^Check your (.+)\.$/, (list) => (details(list) ? `请检查你的${details(list)}。` : null)],
  // Payout methods
  [/^If nobody at your company made this change, email (\S+) now\.$/, (address) => `如果这不是你公司的人员所做的更改，请立即发邮件至 ${address}。`],
  [/^TSC now pays your connected payout account\.$/, () => "TSC 现在向你已连接的收款账户付款。"],
  [/^TSC now pays your bank account at (.+), instead of Payoneer account (.+)\.$/, (named, old) => `TSC 现在向你在 ${bank(named)} 的银行账户付款，不再向 Payoneer 账户 ${old} 付款。`],
  [/^TSC now pays your bank account at (.+)\.$/, (named) => `TSC 现在向你在 ${bank(named)} 的银行账户付款。`],
  [/^TSC now pays (PayPal|Payoneer) account (.+)\.$/, (provider, account) => `TSC 现在向 ${provider} 账户 ${account} 付款。`],
  [/^TSC no longer pays your bank account at (.+), and you have no default payout method\.$/, (named) => `TSC 不再向你在 ${bank(named)} 的银行账户付款，你目前没有默认收款方式。`],
  [/^TSC no longer pays Payoneer account (.+), and you have no default payout method\.$/, (account) => `TSC 不再向 Payoneer 账户 ${account} 付款，你目前没有默认收款方式。`],
  [/^Your bank account at (.+) was saved\.$/, (named) => `你在 ${bank(named)} 的银行账户已保存。`],
  [/^Your bank account at (.+) was removed\.$/, (named) => `你在 ${bank(named)} 的银行账户已移除。`],
  [/^Your bank account at (.+) replaced a withdrawal method\.$/, (named) => `你在 ${bank(named)} 的银行账户替换了一种提现方式。`],
  [/^Your saved bank account changed: it is now (.+), in the name of (.+)\.$/, (named, holder) => `你保存的银行账户已变更：现为 ${bank(named)}，户名 ${holder}。`],
  [/^The bank account TSC pays changed: it is now (.+), in the name of (.+)\.$/, (named, holder) => `TSC 付款的银行账户已变更：现为 ${bank(named)}，户名 ${holder}。`],
  [/^(PayPal|Payoneer) account (.+) was added\.$/, (provider, account) => `已添加 ${provider} 账户 ${account}。`],
  [/^(PayPal|Payoneer) account (.+) was removed\.$/, (provider, account) => `已移除 ${provider} 账户 ${account}。`],
  [/^The (PayPal|Payoneer) account changed from (.+) to (.+)\.$/, (provider, from, to) => `${provider} 账户已从 ${fallbackName(from)} 更改为 ${to}。`],
  [/^(.+) was added as a withdrawal method( and is now the default)?\.$/, (named, isDefault) => (stripeMethod(named) ? `已添加${stripeMethod(named)}作为提现方式${isDefault ? "，并设为默认" : ""}。` : null)],
  [/^Withdrawals now go to (.+)\.$/, (named) => (stripeMethod(named) ? `提现现在将转入${stripeMethod(named)}。` : null)],
  [/^(.+) was removed from your withdrawal methods\.$/, (named) => (stripeMethod(named) ? `${stripeMethod(named)}已从你的提现方式中移除。` : null)],
  [/^(.+) is now your default\.$/, (named) => (stripeMethod(named) ? `${stripeMethod(named)}现在是你的默认提现方式。` : null)],
  [/^Your withdrawal account is being reviewed\.$/, () => "你的提现账户正在审核中。"],
  [/^Your earnings are safe\.$/, () => "你的收入是安全的。"],
  [/^We will email you if we need anything\.$/, () => "如需更多信息，我们会发邮件给你。"],
  [/^We need a few more details for your withdrawal account\.$/, () => "你的提现账户还需要补充一些信息。"],
  [/^Open Payments and choose Finish setup\.$/, () => "请打开“付款”并选择“完成设置”。"],
  // Credits and capacity
  [/^Your profile is verified\.$/, () => "你的资料已通过验证。"],
  [/^Each quote you send uses (\d+) credits\.$/, (n) => `每发送一份报价使用 ${n} 额度。`],
  [/^(.+), the factory you invited, is now verified\.$/, (who) => `你邀请的工厂 ${who} 已通过验证。`],
  [/^You earn (\d+) credits when TSC verifies their profile\.$/, (n) => `TSC 验证其资料后，你将获得 ${n} 额度。`],
  [/^You haven't set your open capacity yet\.$/, () => "你还没有设置可接单产能。"],
  [/^You last updated your open capacity (\d+) days ago\.$/, (n) => `你上次更新可接单产能是在 ${n} 天前。`],
  [/^Brands see it when they choose who to invite, so add it from your dashboard\.$/, () => "品牌在选择邀请对象时会看到它，请在工作台中添加。"],
  [/^Brands see it when they choose who to invite, so update it from your dashboard\.$/, () => "品牌在选择邀请对象时会看到它，请在工作台中更新。"],
];

/** Where a body turns into what someone typed: the rest is kept as written. */
const TYPED_TAILS = [
  [" Their note: ", "品牌备注："],
  [" TSC's note: ", "TSC 备注："],
  [" TSC's reason: ", "TSC 的理由："],
  [" Reference: ", "参考号："],
];

/** Sentences end at ". ", "? " or the end; a dot inside an address or an amount does not end one. */
function sentencesOf(text) {
  return String(text).match(/[^.?]+(?:[.?](?=\s|$)|[.?][^\s.?][^.?]*)*[.?]?/g)?.map((each) => each.trim()).filter(Boolean) ?? [];
}

function translateSentence(sentence, ctx) {
  for (const [pattern, render] of SENTENCES) {
    const match = pattern.exec(sentence);
    if (!match) continue;
    const values = match.slice(1);
    // A rule without captures gets ctx first; one with captures gets it last.
    const out = values.length ? render(...values, ctx) : render(ctx);
    if (out != null) return out;
  }
  return null;
}

/** The body's Chinese, or null when any sentence of it is not one we know. */
function translateSentences(text, ctx) {
  const parts = sentencesOf(text);
  if (!parts.length) return null;
  const out = [];
  for (const part of parts) {
    const zh = translateSentence(part, ctx);
    if (zh == null) return null;
    out.push(zh);
  }
  return out.join("");
}

/**
 * @param notification  { kind, title }
 * @returns the title in Chinese, or null when it is not one we know
 */
export function zhNotificationTitle(notification) {
  const kind = String(notification?.kind ?? "");
  const title = String(notification?.title ?? "").trim();
  for (const [ruleKind, pattern, render] of TITLES) {
    if (ruleKind !== kind) continue;
    const match = pattern.exec(title);
    if (!match) continue;
    const out = render(...match.slice(1));
    if (out != null) return out;
  }
  return null;
}

/**
 * @param notification  { kind, body, data }
 * @param ctx           { deadline?: the quote deadline in the reader's words }
 * @returns the body in Chinese, the body as written when it is what someone
 *          typed, or null when it is ours and not one we know
 */
export function zhNotificationBody(notification, ctx = {}) {
  const body = String(notification?.body ?? "").trim();
  if (!body) return "";
  const context = { day: zhDay(notification?.data?.due_on), ...ctx };
  for (const [marker, label] of TYPED_TAILS) {
    const at = body.indexOf(marker);
    if (at < 0) continue;
    const head = translateSentences(body.slice(0, at), context);
    return head == null ? null : `${head}${label}${body.slice(at + marker.length)}`;
  }
  const whole = translateSentences(body, context);
  if (whole != null) return whole;
  // A note, a reason or an update: what someone typed, shown as typed.
  return TYPED_BODY_KINDS.test(String(notification?.kind ?? "")) ? body : null;
}

/** Kinds whose body is what a person wrote (or a call's title), not ours. */
const TYPED_BODY_KINDS = /^(verification_(approved|declined|needs_information)|matching_evidence_[a-z_]+|cancellation_(proposed|declined)|order_cancelled|milestone_update|milestone_dispute|milestone_approved|message_rejected|payment_rejected|credits_adjusted|rfq_cancelled|call_[a-z]+|message)$/;

/** Every kind with a Chinese title; check:dates renders a sample of each. */
export const ZH_TITLE_KINDS = [...new Set(TITLES.map(([kind]) => kind))];
