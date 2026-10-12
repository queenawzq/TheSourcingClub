/**
 * The pattern half of screening a message: contact details for leaving the
 * platform, found without asking a model.
 *
 * A hit holds the message for staff at once (api/screen-message.js), so this
 * list has to be narrow. Numbers are everywhere in a conversation about
 * clothing — quantities, prices, sizes, dates, order numbers — and a pattern
 * that held "300 units, $18.40, ship 2026-11-02" would bury staff and stall
 * every order. So only clearly contact-shaped things count here; anything
 * subtler ("let's sort this outside") is the model's to judge.
 * scripts/check-message-patterns.mjs pins both the hits and the near-misses.
 *
 * Pure and dependency-free so a node script can import it. The leading
 * underscore keeps Vercel from serving it as a route.
 */

// Our own addresses are not a way off the platform.
const OWN_DOMAINS = /(^|\.)(sourcing-club\.com|the-sourcing-club\.vercel\.app)$/i;

const TLD = "com|net|org|cn|io|co|hk|tw|uk|me|app|info|biz|shop|store|online|site|xyz|ly|gl|link|page";

const EMAIL = /[a-z0-9._%+-]+@([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})/gi;
// "name [at] brand [dot] com", "name at brand dot com", "name(at)brand.com"
const EMAIL_SPELLED = new RegExp(
  String.raw`[a-z0-9._%+-]+\s*(?:[\[(]\s*at\s*[\])]|\s+at\s+|艾特)\s*[a-z0-9-]+\s*(?:\.|[\[(]\s*dot\s*[\])]|\s+dot\s+|点)\s*(?:${TLD})\b`,
  "i",
);

const URL = /\bhttps?:\/\/[^\s]+|\bwww\.[a-z0-9-]+\.[a-z]{2,}[^\s]*/gi;
const BARE_DOMAIN = new RegExp(String.raw`\b((?:[a-z0-9-]+\.)+(?:${TLD}))(?=$|[\s/:?#),.!])`, "gi");

// A handle has a letter in it: "@ 18.40" and "@300" are prices and counts.
const HANDLE = /(^|[\s(（,，:：])@(?=[a-z0-9_.]*[a-z])[a-z0-9_.]{3,}/i;

// Apps whose name alone, next to an invitation or an id, means "talk there".
const APPS = [
  ["WeChat", String.raw`we\s?chat|weixin|wei\s?xin|微信|威信|薇信`],
  ["WhatsApp", String.raw`whats\s?app|whatsap|wa\.me`],
  ["Telegram", String.raw`telegram|t\.me\/`],
  ["Skype", String.raw`skype`],
  ["Viber", String.raw`viber`],
  ["KakaoTalk", String.raw`kakao`],
  ["Instagram", String.raw`instagram|insta\b`],
  ["Facebook", String.raw`facebook|messenger`],
  ["LinkedIn", String.raw`linkedin`],
  ["DingTalk", String.raw`dingtalk|钉钉`],
];
// Short or everyday names ("line", "signal", "qq", "tg", "vx") count only
// with an id right after them.
const SHORT_APP_IDS = [
  ["QQ", /\bqq\s*(?:号|号码|id|no\.?|number)?\s*[:：]?\s*\d{5,}/i],
  ["WeChat", /\b(?:vx|v信|wx)\s*(?:号|id)?\s*[:：]?\s*[a-z0-9_-]{5,}/i],
  ["Line", /\bline\s*id\s*[:：]?\s*[a-z0-9_.-]{4,}/i],
  ["Telegram", /\btg\s*[:：@]\s*[a-z0-9_]{4,}/i],
];
// What makes a mention of an app an invitation rather than a remark.
const INVITE_EN = String.raw`add|contact|message|msg|call|reach|chat|talk|text|find|ping|dm|send|scan|on|via|over|through|my|id|number|account`;
const INVITE_ZH = String.raw`加|联系|找|扫|聊|号`;
const INVITE = String.raw`\b(?:${INVITE_EN})\b|${INVITE_ZH}`;
// An id-like token: letters/digits/underscores, at least one digit or underscore.
const ID_TOKEN = String.raw`(?=[a-z0-9_.-]*[0-9_])[a-z0-9_.-]{5,}`;

// Phone numbers. "+" then digits is always a phone. Without "+", groups split
// by spaces, dots, dashes or brackets, at least 9 digits, with one group of 4+
// and none shorter than 3 (so dates like 2026-10-12 are not phones), and not
// followed by a unit (so "1500 2500 3000 units" is not either). A Chinese
// mobile is 11 digits starting 13–19. Seven or more Chinese numerals in a row
// are a number read out.
const PHONE_PLUS = /\+\s?\(?\d[\d\s().-]{5,}\d/g;
const PHONE_GROUPED = /(?<![\d.,/:-])\(?\d{2,5}\)?(?:[ .-]\(?\d{3,5}\)?){1,3}(?![\d.,/:%-])/g;
const UNIT_AFTER = /^\s*(?:units?|pcs|pieces?|pc|sets?|pairs?|件|个|套|条|gsm|g|kg|cm|mm|m|yards?|yds?|meters?|metres?|%|usd|rmb|cny|dollars?|元)\b/i;
const CN_MOBILE = /(?<!\d)1[3-9]\d{9}(?!\d)/;
const CN_NUMERALS = /[零〇一二三四五六七八九两幺]{7,}/;

const digitsIn = (value) => value.replace(/\D/g, "");

function phoneIn(text) {
  for (const match of text.matchAll(PHONE_PLUS)) {
    if (digitsIn(match[0]).length >= 7) return true;
  }
  for (const match of text.matchAll(PHONE_GROUPED)) {
    const groups = match[0].match(/\d+/g);
    const digits = groups.join("");
    if (digits.length < 9) continue;
    if (!groups.some((group) => group.length >= 4)) continue;
    if (groups.slice(1).some((group) => group.length < 3)) continue;
    if (UNIT_AFTER.test(text.slice(match.index + match[0].length))) continue;
    return true;
  }
  return CN_MOBILE.test(text) || CN_NUMERALS.test(text);
}

function emailIn(text) {
  for (const match of text.matchAll(EMAIL)) {
    if (!OWN_DOMAINS.test(match[1])) return true;
  }
  return EMAIL_SPELLED.test(text);
}

function linkIn(text) {
  for (const match of text.matchAll(URL)) {
    const host = match[0].replace(/^https?:\/\//i, "").split(/[/?#:]/)[0];
    if (!OWN_DOMAINS.test(host)) return true;
  }
  for (const match of text.matchAll(BARE_DOMAIN)) {
    if (!OWN_DOMAINS.test(match[1])) return true;
  }
  return false;
}

function appIn(text, { nameAlone = false } = {}) {
  for (const [label, name] of APPS) {
    const mention = new RegExp(`(${name})`, "i");
    if (!mention.test(text)) continue;
    if (nameAlone) return label;
    const invited = new RegExp(
      String.raw`(?:${INVITE})[^.!?\n]{0,30}(?:${name})|(?:${name})[^.!?\n]{0,25}(?:${INVITE}|${ID_TOKEN}|[:：]\s*\S{4,})`,
      "i",
    );
    if (invited.test(text)) return label;
  }
  for (const [label, pattern] of SHORT_APP_IDS) {
    if (pattern.test(text)) return label;
  }
  return null;
}

/** What, if anything, in one piece of text is a way to reach someone off the platform. */
function scan(text, { fileName = false } = {}) {
  if (emailIn(text)) return "an email address";
  if (linkIn(text)) return "a link";
  const app = appIn(text, { nameAlone: fileName });
  if (app) return `${/^[AEIOU]/.test(app) ? "an" : "a"} ${app} contact`;
  if (phoneIn(text)) return "a phone number";
  if (HANDLE.test(text)) return "a social media handle";
  // A file called "qr code.png" is how a WeChat contact is usually passed on.
  if (fileName && /(^|[^a-z])qr([^a-z]|$)|二维码/i.test(text)) return "a QR code";
  return null;
}

/**
 * Look at a message and its attachments' names.
 * Returns { hit, reason }: reason is a short phrase for staff ("a phone number").
 */
export function findContactDetails(body, fileNames = []) {
  // NFKC folds full-width digits and letters (１３８…, ＷｅＣｈａｔ) into
  // their ASCII forms, which is how they are typed to dodge a filter.
  const text = String(body ?? "").normalize("NFKC");
  const inBody = scan(text);
  if (inBody) return { hit: true, reason: inBody };

  for (const name of fileNames ?? []) {
    // Underscores and dashes are spaces in a file name; the extension is not a domain.
    const readable = String(name ?? "").normalize("NFKC")
      .replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_-]+/g, " ");
    const inName = scan(readable, { fileName: true });
    if (inName) return { hit: true, reason: `${inName} in an attachment's name` };
  }
  return { hit: false, reason: null };
}
