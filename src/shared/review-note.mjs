/**
 * How a reviewer's note is laid out. Staff type plain text and a list is what
 * they typed: "- item", "• item", "1. item", or the Chinese "一、item" and
 * "1、item". The note is stored and sent in the plain-text email exactly as
 * typed; this only decides how the HTML email and the app draw it. Shared by
 * scripts/generate-account-approved-email.mjs and src/shared/ReviewNote.jsx, so
 * the two cannot disagree. `npm run check:review-email` pins hits and near-misses.
 */
const UNORDERED = /^\s*(?:[-*–—－＊]\s+|[•·・●▪◦‣]\s*)(\S.*)$/;
const ORDERED = [
  /^\s*(\d{1,3})[.)．）]\s+(\S.*)$/, // 1. item   1) item
  /^\s*(\d{1,3})、\s*(\S.*)$/, // 1、item
  /^\s*[（(](\d{1,3})[)）]\s*(\S.*)$/, // （1）item
  /^\s*([一二三四五六七八九十]{1,3})[、．.]\s*(\S.*)$/, // 一、item
];

const CHINESE_DIGITS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function chineseNumber(value) {
  if (!value.includes("十")) return CHINESE_DIGITS[value] ?? 1;
  const [tens, ones] = value.split("十");
  return (CHINESE_DIGITS[tens] ?? 1) * 10 + (CHINESE_DIGITS[ones] ?? 0);
}

function listLine(line) {
  const unordered = line.match(UNORDERED);
  if (unordered) return { ordered: false, text: unordered[1].trim() };
  for (const pattern of ORDERED) {
    const found = line.match(pattern);
    if (found) {
      const number = /^\d/.test(found[1]) ? Number(found[1]) : chineseNumber(found[1]);
      return { ordered: true, number, text: found[2].trim() };
    }
  }
  return null;
}

/**
 * @returns {Array<{ type: "paragraph", lines: string[] } |
 *   { type: "list", ordered: boolean, start: number, items: string[] }>}
 * Every word typed is in one block or another: nothing is dropped.
 */
export function parseReviewNote(note) {
  const lines = String(note ?? "").replace(/\r\n?/g, "\n").trim().split("\n");
  const blocks = [];
  let open = null; // the block the next line continues, if any
  let blank = false;
  for (const line of lines) {
    if (!line.trim()) {
      blank = true;
      continue;
    }
    const item = listLine(line);
    if (item) {
      // A blank line between two items does not end the list.
      if (open?.type === "list" && open.ordered === item.ordered) {
        open.items.push(item.text);
      } else {
        open = { type: "list", ordered: item.ordered, start: item.number ?? 1, items: [item.text] };
        blocks.push(open);
      }
    } else if (open?.type === "list" && !blank && /^\s/.test(line)) {
      // An indented line carries on the item above it.
      open.items[open.items.length - 1] += ` ${line.trim()}`;
    } else if (open?.type === "paragraph" && !blank) {
      open.lines.push(line.trim());
    } else if (line.trim()) {
      open = { type: "paragraph", lines: [line.trim()] };
      blocks.push(open);
    }
    blank = false;
  }
  return blocks;
}

/** True when the note has a list in it. */
export const noteHasList = (note) => parseReviewNote(note).some((block) => block.type === "list");

const CHINESE = /[㐀-鿿]/;
/** True when the note is written, at least partly, in Chinese. */
export const noteHasChinese = (note) => CHINESE.test(String(note ?? ""));

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

/** The note as email HTML: inline styles only, every word escaped. */
export function reviewNoteHtml(note, { fontSize = "15px", lineHeight = "23px", color = "#0B1020" } = {}) {
  const blocks = parseReviewNote(note);
  const text = `font-size:${fontSize};line-height:${lineHeight};color:${color};`;
  const html = blocks.map((block, index) => {
    const margin = index === blocks.length - 1 ? "0" : "0 0 12px";
    if (block.type === "paragraph") {
      return `<p style="margin:${margin};${text}">${block.lines.map(escapeHtml).join("<br>")}</p>`;
    }
    const tag = block.ordered ? "ol" : "ul";
    const start = block.ordered && block.start !== 1 ? ` start="${block.start}"` : "";
    const items = block.items.map((item) => `<li style="margin:0 0 6px;${text}">${escapeHtml(item)}</li>`).join("");
    return `<${tag}${start} style="margin:${margin};padding:0 0 0 22px;${text}">${items}</${tag}>`;
  }).join("");
  // Mail clients pick their Chinese font from the language.
  return noteHasChinese(note) ? `<div lang="zh">${html}</div>` : html;
}
