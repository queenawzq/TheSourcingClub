/**
 * The Chinese for one piece of live screen text, from the design's dictionary
 * (`factoryMainZhText`) and staff-written taxonomy labels. Used by
 * `FactoryLanguageLayer`.
 *
 * Whole texts only. The prototype's own pass also swaps words inside
 * sentences ("deposit" → "定金"), which suits its fixed mock copy but turned a
 * brand's step "Bulk deposit" into "Bulk 定金" and a brief into half a
 * sentence in each language. Here a text is translated when it is a whole
 * dictionary entry, a staff label, or one of the patterns below; a pattern
 * keeps the names and titles it carries as written ("Bulk deposit is
 * complete" → "Bulk deposit 已完成"), translating a captured part only when
 * that part is itself a whole entry. Anything else stays as it is.
 */
import { factoryMainZhText } from "../factory-prototype/main.jsx";
import { zhPayoutWords } from "../shared/notification-zh.mjs";

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = { Mon: "一", Tue: "二", Wed: "三", Thu: "四", Fri: "五", Sat: "六", Sun: "日" };
const MON = "(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";
const LONG = `(${LONG_MONTHS.join("|")})`;
const monthOf = (name) => MONTHS[name.slice(0, 3)];

/** A whole entry: the design's dictionary, a staff label, or a list of staff labels. */
export function wholeEntry(text, terms) {
  if (Object.hasOwn(factoryMainZhText, text)) return factoryMainZhText[text];
  // Where the factory's money is, and why a payout failed: the bell's Chinese.
  const payout = zhPayoutWords(text);
  if (payout) return payout;
  const term = terms?.get(text);
  if (term) return term;
  if (terms && text.includes(", ")) {
    const parts = text.split(", ");
    if (parts.every((part) => terms.has(part))) return parts.map((part) => terms.get(part)).join("、");
  }
  return null;
}

// The profile's completion note lists these (src/app/profile/factory-profile-view.js).
const PROFILE_TODO = [
  ["client references and sample images", "客户案例和样品图片"],
  ["the missing certificate files", "缺少的证书文件"],
  ["your business registration", "营业执照"],
  ["your factory details", "工厂详情"],
  ["your production fit", "生产匹配"],
  ["capacity and terms", "产能与条款"],
  ["a walkthrough video", "工厂巡视视频"],
];
function profileTodo(list) {
  let rest = list.replace(/ and more$/, "");
  const found = [];
  while (rest) {
    const hit = PROFILE_TODO.find(([en]) => rest.startsWith(en));
    if (!hit) return null;
    found.push(hit[1]);
    rest = rest.slice(hit[0].length).replace(/^(, | and )/, "");
  }
  return `补充${found.join("、")}${/ and more$/.test(list) ? "等" : ""}，让资料更完整。`;
}

// A name or a step title inside a pattern: short, not a sentence.
const titleLike = (text) => text.length <= 60 && !/[.!?](\s|$)|[。！？]/.test(text);

const clock = (hour, minute, half) => `${half === "AM" ? "上午" : "下午"} ${hour}:${minute}`;

/**
 * [pattern, (match, inner) => Chinese]. `inner(text)` is the Chinese for a
 * captured part when it is itself translatable, else the part as written.
 */
// A cancellation reason is the other side's sentence: kept as written.
const PROPOSED = /^(.+) proposed cancelling: (.*)$/;
const YOU_PROPOSED = /^You proposed cancelling: (.*)$/;

const PATTERNS = [
  // The payout fee the factory paid: its payments row (PayoutDetails) and the paid notification.
  [/^Payout fee (\S+) is taken from this payment: you receive (\S+)\.$/, (m) => `提现手续费 ${m[1]} 从该笔款项中扣除：你收到 ${m[2]}。`],
  [/^Step (\S+)\. Payout fee (\S+) is taken from this payment: you receive (\S+)\.$/, (m) => `步骤金额 ${m[1]}。提现手续费 ${m[2]} 从该笔款项中扣除：你收到 ${m[3]}。`],
  // Dates and times.
  [new RegExp(`^${MON} (\\d{1,2}), (\\d{4})$`), (m) => `${m[3]} 年 ${MONTHS[m[1]]} 月 ${Number(m[2])} 日`],
  [new RegExp(`^${MON} (\\d{1,2})$`), (m) => `${MONTHS[m[1]]} 月 ${Number(m[2])} 日`],
  [new RegExp(`^${MON} (\\d{1,2}), (\\d{4}) - ${MON} (\\d{1,2}), (\\d{4})$`), (m) => `${m[3]} 年 ${MONTHS[m[1]]} 月 ${Number(m[2])} 日 - ${m[6]} 年 ${MONTHS[m[4]]} 月 ${Number(m[5])} 日`],
  [new RegExp(`^${LONG} (\\d{4})$`), (m) => `${m[2]} 年 ${monthOf(m[1])} 月`],
  [new RegExp(`^${LONG}$`), (m) => `${monthOf(m[1])} 月`],
  [new RegExp(`^${LONG} capacity$`), (m) => `${monthOf(m[1])} 月产能`],
  [/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), (.+)$/, (m, inner) => `周${DAYS[m[1]]}，${inner(m[2])}`],
  [/^(\d{1,2}):(\d{2}) (AM|PM)( [A-Z]{2,5})?$/, (m) => `${clock(m[1], m[2], m[3])}${m[4] ?? ""}`],
  [/^just now$/i, () => "刚刚"],
  [/^(Today|Yesterday), (.+)$/, (m, inner) => `${m[1] === "Today" ? "今天" : "昨天"} ${inner(m[2])}`],
  [/^Last message (.+)$/, (m, inner) => `最新消息 ${inner(m[1])}`],
  [/^(\d+) (?:min|mins|minute|minutes) ago$/, (m) => `${m[1]} 分钟前`],
  [/^(\d+) (?:hr|hrs|hour|hours) ago$/, (m) => `${m[1]} 小时前`],
  [/^(\d+) days? ago$/, (m) => `${m[1]} 天前`],
  [/^(\d+)m ago$/, (m) => `${m[1]} 分钟前`],
  [/^(\d+)h ago$/, (m) => `${m[1]} 小时前`],
  [/^(\d+)d ago$/, (m) => `${m[1]} 天前`],
  [/^(\d+)w ago$/, (m) => `${m[1]} 周前`],
  [/^(\d+) weeks? ago$/, (m) => `${m[1]} 周前`],
  [new RegExp(`^${MON} roughly ([\\d,.-]+) pieces$`), (m) => `${MONTHS[m[1]]} 月约 ${m[2]} 件`],
  [/^([\d,]+) units?$/, (m) => `${m[1]} 件`],
  [/^([\d,]+)\s*[-–]\s*([\d,]+) units$/, (m) => `${m[1]}–${m[2]} 件`],
  [/^(\d+) days?$/, (m) => `${m[1]} 天`],
  [/^(\d+)\s*[-–]\s*(\d+) days$/, (m) => `${m[1]}–${m[2]} 天`],
  [/^([\d,]+) employees$/, (m) => `${m[1]} 名员工`],
  [/^(\d+)% deposit \/ (\d+)% balance$/, (m) => `${m[1]}% 定金 / ${m[2]}% 尾款`],
  [/^(\$[\d,.]+) - (\$[\d,.]+) per unit$/, (m) => `每件 ${m[1]} - ${m[2]}`],
  [/^(\$[\d,.]+) \/ unit$/, (m) => `${m[1]} / 件`],
  [/^(\$[\d,.]+) order total$/, (m) => `订单总额 ${m[1]}`],
  // Prefixes with a date or a name after them.
  [/^Posted (.+)$/, (m, inner) => `发布于 ${inner(m[1])}`],
  [/^Started (.+)$/, (m, inner) => `开始于 ${inner(m[1])}`],
  [/^Awarded (.+)$/, (m, inner) => `授予于 ${inner(m[1])}`],
  [/^Quote due (.+)$/, (m, inner) => `报价截止 ${inner(m[1])}`],
  [/^Quotes close (.+)$/, (m, inner) => `报价截止 ${inner(m[1])}`],
  [/^due (.+)$/, (m, inner) => `截止 ${inner(m[1])}`],
  [/^Updated (.+)$/, (m, inner) => `更新于 ${inner(m[1])}`],
  [new RegExp(`^Available to withdraw on ${MON} (\\d{1,2})$`), (m) => `${MONTHS[m[1]]} 月 ${Number(m[2])} 日起可提现`],
  // Counts on cards and tabs.
  [/^(\d+) awaiting brand review$/, (m) => `${m[1]} 个待品牌审核`],
  [/^(\d+) need updates?$/, (m) => `${m[1]} 个需要更新`],
  [/^(\d+) orders? awaiting a schedule$/, (m) => `${m[1]} 个订单待排期`],
  [/^(\d+) production steps? needs? an update$/, (m) => `${m[1]} 个生产步骤需要更新`],
  [/^(\d+) unread messages?$/, (m) => `${m[1]} 条未读消息`],
  [/^(\$[\d,.]+) awaiting brand funding$/, (m) => `${m[1]} 待品牌付款`],
  [/^Waiting on (\$[\d,.]+) from the brand$/, (m) => `等待品牌支付 ${m[1]}`],
  [/^(\d+) open requests?$/, (m) => `${m[1]} 个开放询价`],
  [/^(Active RFQs|Drafts|Invited|Closed|Active orders|Cancelled|Archived|Saved brands|Saved RFQs) \((\d+)\)$/, (m, inner) => `${inner(m[1])} (${m[2]})`],
  [/^([\d,]+) credits = (\$[\d,.]+) value\.$/, (m) => `${m[1]} 额度 = ${m[2]} 价值。`],
  [/^([+-]?[\d,]+) credits$/, (m) => `${m[1]} 额度`],
  // Sentences carrying a name or a step title, kept as written.
  [/^Your quote was submitted and is visible to (.+)\.$/, (m) => `你的报价已提交，${m[1]} 可以查看。`],
  [/^Sent to (.+)$/, (m) => `已发送给 ${m[1]}`],
  [/^(.+) has been notified\. Your quote appears on their comparison page.*$/, (m) => `已通知 ${m[1]}。你的报价会出现在对方的报价比较页。`],
  [/^Totals are calculated after saving the quote\. Review the breakdown before sending it to (.+?)\.?$/, (m) => `保存报价后会计算总计。发送给 ${m[1]} 前请确认明细。`],
  [/^Complete these required fields before reviewing: (.+)\.$/, (m, inner) => `审核前请填写这些必填项：${m[1].split(", ").map((field) => inner(field)).join("、")}。`],
  [/^Message (.+)\.\.\.$/, (m) => `给 ${m[1]} 发消息...`],
  [/^Now: (.+)$/, (m, inner) => `当前：${inner(m[1])}`],
  [PROPOSED, (m) => `${m[1]} 提议取消：${m[2]}`, { free: true }],
  [YOU_PROPOSED, (m) => `你提议取消：${m[1]}`, { free: true }],
  [/^(.+) confirmed the production steps$/, (m) => `${m[1]} 已确认生产步骤`],
  [/^(\$[\d,.]+) is due for (.+)$/, (m, inner) => `${inner(m[2])} 应付 ${m[1]}`],
  [/^(\$[\d,.]+) funded for (.+), held by TSC$/, (m, inner) => `${inner(m[2])} 已付 ${m[1]}，由 TSC 托管`],
  [/^(.+) is complete$/, (m, inner) => `${inner(m[1])} 已完成`],
  [/^You posted on (.+)$/, (m, inner) => `你在「${inner(m[1])}」发布了更新`],
  [/^(.+) posted on (.+)$/, (m, inner) => `${m[1]} 在「${inner(m[2])}」发布了更新`],
  [/^Order (TSC-\d+) created$/, (m) => `订单 ${m[1]} 已创建`],
  [/^Nothing posted yet(.*)$/, (m, inner) => `尚未发布${m[1] ? inner(m[1].trim()) : ""}`],
  [/^Done$/, () => "已完成"],
  [/^Brand asks:?$/, () => "品牌提问："],
  [/^Brand asks: (.+)$/, (m, inner) => `品牌提问：${inner(m[1])}`, { free: true }],
  [/^Declined by (.+)$/, (m) => `${m[1]} 已拒绝`],
  [/^(.+) proposed another time$/, (m) => `${m[1]} 提议了其他时间`],
  [/^(.+) invited you to a call$/, (m) => `${m[1]} 邀请你通话`],
  [/^Waiting for (.+) to answer$/, (m) => `等待 ${m[1]} 回复`],
  [/^(Cancelled|Confirmed|Withdrawn|Ended) by (.+)$/, (m, inner) => `${inner(m[1])}（${m[2]}）`],
  [/^Needs the (.+) permission$/, (m, inner) => `需要「${inner(m[1]).replace(/权限$/, "")}」权限`],
  [/^You need the (.+) permission at (.+) for this\. An owner can give it to you in Settings\.$/, (m, inner) => `你需要 ${m[2]} 的「${inner(m[1]).replace(/权限$/, "")}」权限才能执行此操作。所有者可以在设置中为你开通。`],
  [/^Add (.+) to strengthen this profile\.$/, (m) => profileTodo(m[1])],
];

/**
 * The Chinese for `text`, or null. `content(text)` is the server's
 * translation of a brand's words, consulted for captured parts too.
 */
export function chineseText(text, { terms, content = () => null } = {}) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;
  const direct = content(trimmed) ?? wholeEntry(trimmed, terms);
  if (direct) return direct;
  const inner = (part) => chineseText(part, { terms, content }) ?? part;
  // "Maple Row Studio · Quote due Nov 24 · Sample before bulk": each part on
  // its own; empty parts and names stay as they are.
  if (trimmed.includes(" · ")) {
    const parts = trimmed.split(" · ");
    const translated = parts.map((part) => (part.trim() ? inner(part.trim()) : part));
    return translated.some((part, index) => part !== parts[index]) ? translated.filter((part, index) => part.trim() || index === 0).join(" · ") : null;
  }
  for (const [pattern, build, { free = false } = {}] of PATTERNS) {
    const match = trimmed.match(pattern);
    // Every captured name or title must look like one, not a sentence; a
    // `free` capture is the other side's sentence, kept or translated whole.
    if (match && (free || match.slice(1).every((part) => part == null || titleLike(part)))) return build(match, inner);
  }
  return null;
}
