/**
 * The other side's words inside a notification email, in the reader's
 * language: a step's name, a request's title. The database writes each
 * notification once, with the values as they were typed ("Your payment for
 * "试身样" is funded"), and src/shared/notification-zh.mjs translates only our
 * own sentences around them. The screens show those values translated
 * (BrandEnglishLayer, FactoryLanguageLayer); an email shows the same words,
 * from the same cache (api/content-translation.js: `profile-en-v1` for a
 * brand's English, `content-zh-v1` for a factory's Chinese), translating what
 * is not cached yet. Never blocking: within the deadline or as written.
 */

const DEADLINE_MS = 6000;
// Kinds whose body is what a person typed (as src/shared/notification-zh.mjs keeps them).
const TYPED_BODY = /^(verification_(approved|declined|needs_information)|matching_evidence_[a-z_]+|cancellation_(proposed|declined)|order_cancelled|milestone_update|milestone_dispute|milestone_approved|message_rejected|payment_rejected|credits_adjusted|rfq_cancelled|call_[a-z]+|message)$/;

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
export async function inReadersWords(service, rows) {
  const orderIds = [...new Set(rows.map((row) => row.order_id).filter(Boolean))];
  let words = [];
  try { words = await orderWords(service, orderIds); } catch { return rows; }
  if (!words.length) return rows;
  const [{ cacheFor, hashOf, profileHashOf, needsChinese, translateAll }, { needsEnglish, translateSources }, { translateText, translateIntoChinese }, { inReaderLanguage }] = await Promise.all([
    import("./content-translation.js"),
    import("../src/shared/profile-translation.mjs"),
    import("./_translate.js"),
    import("../src/shared/words-in-reader-language.mjs"),
  ]);
  const wantZh = rows.some((row) => row.locale === "zh");
  const wantEn = rows.some((row) => row.locale !== "zh");
  const zhSources = wantZh ? [...new Set(words.filter(needsChinese))] : [];
  const { GENERATED_STEPS_ZH: generated } = await import("../src/shared/notification-zh.mjs");
  const toTranslate = zhSources.filter((source) => !generated[source]);
  const enSources = wantEn ? [...new Set(words.filter(needsEnglish))] : [];
  const [zh, en] = await Promise.all([
    toTranslate.length
      ? translateAll(toTranslate, { deadlineMs: DEADLINE_MS, translate: (text, { timeoutMs }) => translateIntoChinese(text, { timeoutMs }), ...cacheFor(service, hashOf) }).catch(() => ({ translations: {} }))
      : { translations: {} },
    enSources.length
      ? translateSources(enSources, { deadlineMs: DEADLINE_MS, translate: (text, { timeoutMs }) => translateText(text, { timeoutMs }), ...cacheFor(service, profileHashOf) }).catch(() => ({ translations: {} }))
      : { translations: {} },
  ]);
  // A generated step keeps the design's Chinese, as on the factory's order page.
  const { GENERATED_STEPS_ZH } = await import("../src/shared/notification-zh.mjs");
  const toZh = new Map([...Object.entries(zh.translations ?? {}), ...Object.entries(GENERATED_STEPS_ZH).filter(([en]) => zhSources.includes(en))]);
  const toEn = new Map(Object.entries(en.translations ?? {}));
  // An English name is replaced only as a whole name, never inside one of
  // our own sentences ("Sample" in "…sample…"); Chinese has no such edges.
  const whole = (text, map) => {
    let out = String(text ?? "");
    for (const [source, translation] of [...map].sort((a, b) => b[0].length - a[0].length)) {
      const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out.replace(new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "g"), () => translation);
    }
    return out;
  };
  return rows.map((row) => {
    const zh = row.locale === "zh";
    const map = zh ? toZh : toEn;
    if (!map.size) return row;
    const swap = (text) => (zh ? whole(text, map) : inReaderLanguage(text, map));
    // A body someone wrote (an update, a reason, a message) stays as written, whole.
    return { ...row, title: swap(row.title), body: TYPED_BODY.test(String(row.kind ?? "")) ? row.body : swap(row.body) };
  });
}
