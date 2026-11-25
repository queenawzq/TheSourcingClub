/**
 * The other side's words inside a notification email, in the reader's
 * language: a step's name, a request's title. The database writes each
 * notification once, with the values as they were typed ("Your payment for
 * "试身样" is funded"), and src/shared/notification-zh.mjs translates only our
 * own sentences around them. The screens show those values translated
 * (BrandEnglishLayer, FactoryLanguageLayer); an email shows the same words,
 * from the same cache (api/content-translation.js: `profile-en-v1` for a
 * brand's English, `content-zh-v1` for a factory's Chinese).
 *
 * Only a name where the database puts a name is replaced: in quotes
 * ("Fit sample"), as an order's title ("Linen vest (TSC-000541)", "… on
 * Linen vest."), or between "for" and "on" ("funded $80.00 for Fit sample on
 * …"). A step called "Review" never rewrites "Review the production steps".
 *
 * Never blocking: what is not cached is translated within the deadline, or
 * left as typed. `translateMisses: false` reads the cache only (the Stripe
 * webhook, which must answer Stripe without waiting for a model).
 */

const DEADLINE_MS = 6000;

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `text` with each name in `map` replaced where the database writes a name. */
export function swapNames(text, map) {
  let out = String(text ?? "");
  for (const [source, translation] of [...map].sort((a, b) => b[0].length - a[0].length)) {
    const name = escape(source);
    const put = (_, before = "") => `${before}${translation}`;
    out = out
      .replace(new RegExp(`"${name}"`, "g"), () => `"${translation}"`)
      .replace(new RegExp(`(^|\\s)${name}(?= \\(TSC-\\d)`, "g"), put)
      .replace(new RegExp(`( for )${name}(?= on )`, "g"), put)
      .replace(new RegExp(`( on )${name}(?=[.,]?(?:\\s|$))`, "g"), put);
  }
  return out;
}

/** The request titles and step names of the rows' orders. */
async function orderWords(service, orderIds) {
  if (!orderIds.length) return [];
  const [orders, steps] = await Promise.all([
    service.from("production_orders").select("id, rfqs (title)").in("id", orderIds),
    service.from("order_milestones").select("title").in("order_id", orderIds),
  ]);
  return [
    ...(orders.data ?? []).map((order) => order.rfqs?.title),
    ...(steps.data ?? []).map((step) => step.title),
  ].filter((text) => typeof text === "string" && text.trim()).map((text) => text.trim());
}

/**
 * @returns rows → rows, each title and body with the order's words in its
 *   reader's language (`row.locale`: "zh" reads Chinese, anything else English)
 */
export async function inReadersWords(service, rows, { translateMisses = true } = {}) {
  const orderIds = [...new Set(rows.map((row) => row.order_id).filter(Boolean))];
  let words = [];
  try { words = await orderWords(service, orderIds); } catch { return rows; }
  const [{ cacheFor, hashOf, profileHashOf, needsChinese, translateAll }, { needsEnglish, translateSources }, { translateText, translateIntoChinese }, { GENERATED_STEPS_ZH, TYPED_BODY_KINDS }] = await Promise.all([
    import("./content-translation.js"),
    import("../src/shared/profile-translation.mjs"),
    import("./_translate.js"),
    import("../src/shared/notification-zh.mjs"),
  ]);
  // Only the words these emails carry, for the readers they go to.
  const shown = (locale) => (word) => rows.some((row) => (row.locale === "zh") === (locale === "zh") && `${row.title ?? ""}\n${row.body ?? ""}`.includes(word));
  const zhSources = [...new Set(words.filter(needsChinese).filter(shown("zh")))];
  const enSources = [...new Set(words.filter(needsEnglish).filter(shown("en")))];
  if (!zhSources.length && !enSources.length) return rows;
  // A generated step keeps the design's Chinese, as on the factory's order page.
  const toTranslate = zhSources.filter((source) => !GENERATED_STEPS_ZH[source]);
  const none = async () => ({ error: "cache only" });
  const [zh, en] = await Promise.all([
    toTranslate.length
      ? translateAll(toTranslate, { deadlineMs: DEADLINE_MS, translate: translateMisses ? (text, { timeoutMs }) => translateIntoChinese(text, { timeoutMs }) : none, ...cacheFor(service, hashOf) }).catch(() => ({ translations: {} }))
      : { translations: {} },
    enSources.length
      ? translateSources(enSources, { deadlineMs: DEADLINE_MS, translate: translateMisses ? (text, { timeoutMs }) => translateText(text, { timeoutMs }) : none, ...cacheFor(service, profileHashOf) }).catch(() => ({ translations: {} }))
      : { translations: {} },
  ]);
  const toZh = new Map([...Object.entries(zh.translations ?? {}), ...Object.entries(GENERATED_STEPS_ZH).filter(([en]) => zhSources.includes(en))]);
  const toEn = new Map(Object.entries(en.translations ?? {}));
  return rows.map((row) => {
    const map = row.locale === "zh" ? toZh : toEn;
    if (!map.size) return row;
    // A body someone wrote (an update, a reason, a message) stays as written, whole.
    return { ...row, title: swapNames(row.title, map), body: TYPED_BODY_KINDS.test(String(row.kind ?? "")) ? row.body : swapNames(row.body, map) };
  });
}
