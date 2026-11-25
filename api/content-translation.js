/**
 * The other side's words in the reader's language.
 * - Chinese, for a factory person who reads the app in Chinese: requests
 *   (title, brief, notes, questions, colours), an order's step names and
 *   descriptions, the brand's profile as
 *   `brand_profile_for_factory()` gives it (never revenue, email, website or
 *   documents) and the brand's messages.
 * - English (`to: "en"`), for a brand: what a factory typed on its quotes and
 *   orders (notes, answers, shipping text, sample and material lines, step
 *   updates) and its location, intro and sample titles, cached under the
 *   vendor profile's key so one sentence reads the same English everywhere.
 *
 * The text is read here, with the caller's own token, so row level security
 * decides what may be translated; a caller never supplies text. Answers are
 * cached by the exact source text (`profile_translation_cache`, keys of their
 * own: its `english` column holds the Chinese for these), so an edited brief
 * is translated again. Translation never blocks: what is not back within the
 * deadline is reported as `incomplete` and the factory reads the English.
 */
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { supabaseServerEnv } from "./_supabase-env.js";
import { translateIntoChinese, translateText } from "./_translate.js";
import { aiBudget, aiCaller } from "./_ai-gate.js";

export const config = { maxDuration: 60 };

const DEADLINE_MS = 8000;
const MAX_RFQS = 50;
const MAX_BRANDS = 20;
const MAX_MESSAGES = 100;
// Cached text costs nothing: far above a person reading, far below a script.
const REQUESTS_PER_HOUR = 600;
const UUID = /^[0-9a-f-]{36}$/i;
// What one English request translates at most.
const MAX_SOURCES = 120;
// A stage or step title up to this long is a name (no "Automatically
// translated" label); a longer one is a sentence and keeps its label.
const NAME_MAX = 30;

export const hashOf = (source) => createHash("sha256").update(`content-zh-v1:${source}`).digest("hex");
// api/profile-translation.js's key, so a sentence reads the same English everywhere.
export const profileHashOf = (source) => createHash("sha256").update(`profile-en-v1:${source}`).digest("hex");

/**
 * Of the sources, those that name a thing (a sample stage, a step): the
 * brand's screens translate them in place, with no "Automatically
 * translated" label (src/app/BrandEnglishLayer.jsx).
 */
export function stepNameSources({ sampleLines = [], steps = [] }, sources) {
  const shown = new Set(sources);
  return [...new Set([...sampleLines.map((line) => line.stage), ...steps.map((step) => step.title)]
    .filter((text) => typeof text === "string").map((text) => text.trim()))].filter((text) => shown.has(text) && text.length <= NAME_MAX);
}

/** Text worth translating: has English words and no Chinese already. */
export function needsChinese(text) {
  const value = String(text ?? "").trim();
  return value.length > 1 && /[A-Za-z]{2,}/.test(value) && !/[㐀-鿿]/.test(value);
}

export function rfqSources(rfq, questions = [], colours = []) {
  return [
    rfq.title, rfq.brief, rfq.material_notes, rfq.sample_notes, rfq.additional_details, rfq.sourcing_details,
    ...questions.map((question) => question.prompt),
    ...colours.map((split) => split.colour),
  ].filter(needsChinese).map((text) => text.trim());
}

export function brandSources(profile) {
  if (!profile) return [];
  return [
    profile.intro, profile.hq_location,
    ...(profile.assets ?? []).flatMap((asset) => [asset.title, asset.caption]),
  ].filter(needsChinese).map((text) => text.trim());
}

/** Cached first, then the model in parallel until the deadline. Never throws. */
export async function translateAll(sources, { translate, cacheRead, cacheWrite, deadlineMs = DEADLINE_MS, now = () => Date.now() }) {
  const started = now();
  const left = () => deadlineMs - (now() - started);
  const translations = {};
  const missing = [];
  const fresh = [];
  const cached = sources.length ? await cacheRead(sources).catch(() => new Map()) : new Map();
  const todo = sources.filter((source) => {
    const row = cached.get(source);
    if (row?.translated && row.english) { translations[source] = row.english; return false; }
    return true;
  });
  let cursor = 0;
  const worker = async () => {
    while (cursor < todo.length) {
      const source = todo[cursor++];
      if (left() < 1500) { missing.push(source); continue; }
      const result = await translate(source, { timeoutMs: Math.min(6000, left()) });
      if (result.error || !result.translation) { missing.push(source); continue; }
      translations[source] = result.translation;
      fresh.push({ source, english: result.translation, translated: true });
    }
  };
  await Promise.all(Array.from({ length: Math.min(12, todo.length) }, worker));
  if (fresh.length) await cacheWrite(fresh).catch(() => {});
  return { translations, missing };
}

/** Cache reads and writes for one key prefix (`hash(source)`). */
export function cacheFor(service, hash) {
  return {
    cacheRead: async (texts) => {
      const bySource = new Map(texts.map((source) => [hash(source), source]));
      const hashes = [...bySource.keys()];
      // 80 hashes a read keeps the address under the gateway's limit.
      const reads = await Promise.all(Array.from({ length: Math.ceil(hashes.length / 80) }, (_, i) =>
        service.from("profile_translation_cache").select("source_hash,english,translated").in("source_hash", hashes.slice(i * 80, i * 80 + 80))));
      const failed = reads.find((read) => read.error);
      if (failed) throw failed.error;
      return new Map(reads.flatMap((read) => read.data).map((row) => [bySource.get(row.source_hash), row]));
    },
    cacheWrite: async (rows) => {
      await service.from("profile_translation_cache")
        .upsert(rows.map(({ source, english, translated }) => ({ source_hash: hash(source), english, translated })), { onConflict: "source_hash" });
    },
  };
}

const ids = (value, max) => (Array.isArray(value) ? [...new Set(value)] : []).slice(0, max + 1);

/** What a factory wrote, for a brand: quotes, answers, step updates, its location and intro. */
export function factoryWordsSources({ quotes = [], answers = [], sampleLines = [], materialLines = [], updates = [], profiles = [], sampleTitles = [], steps = [] }, needsEnglish) {
  return [...new Set([
    ...quotes.flatMap((quote) => [quote.shipping_notes, quote.sourcing_includes, quote.factory_response, quote.factory_notes]),
    ...answers.map((answer) => answer.answer_text),
    ...sampleLines.flatMap((line) => [line.stage, line.includes]),
    // The order's steps: named from the quote's sample stages, as written.
    ...steps.flatMap((step) => [step.title, step.description]),
    ...materialLines.map((line) => line.material),
    ...updates.map((update) => update.body),
    ...profiles.flatMap((profile) => [profile.location, profile.intro]),
    ...sampleTitles,
  ].filter((text) => typeof text === "string" && text.trim() && needsEnglish(text)).map((text) => text.trim()))];
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "private, no-store");
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
  const { supabaseUrl, anonKey, serviceKey } = supabaseServerEnv();
  if (!supabaseUrl || !anonKey || !serviceKey) return response.status(503).json({ error: "Translation unavailable" });
  let body;
  try { body = typeof request.body === "string" ? JSON.parse(request.body) : request.body; }
  catch { return response.status(400).json({ error: "Invalid request" }); }
  const toEnglish = body?.to === "en";
  const rfqIds = ids(body?.rfqIds, MAX_RFQS);
  const brandOrgIds = ids(body?.brandOrgIds, MAX_BRANDS);
  const messageIds = ids(body?.messageIds, MAX_MESSAGES);
  const quoteIds = ids(body?.quoteIds, MAX_RFQS);
  const orderIds = ids(body?.orderIds, MAX_RFQS);
  const factoryOrgIds = ids(body?.factoryOrgIds, MAX_RFQS);
  const all = toEnglish ? [...quoteIds, ...orderIds, ...factoryOrgIds] : [...rfqIds, ...brandOrgIds, ...messageIds, ...orderIds];
  if (!all.length || rfqIds.length > MAX_RFQS || brandOrgIds.length > MAX_BRANDS || messageIds.length > MAX_MESSAGES
    || quoteIds.length > MAX_RFQS || orderIds.length > MAX_RFQS || factoryOrgIds.length > MAX_RFQS
    || all.some((id) => !UUID.test(id ?? ""))) {
    return response.status(400).json({ error: "Invalid request" });
  }

  // Chinese is for a factory's people; English for a brand's.
  const side = toEnglish ? "brand" : "factory";
  // Who is asking (api/_ai-gate.js), once the side is known from the body.
  const who = await aiCaller(request, { side });
  if (who.refused) {
    const status = who.refused[0];
    return response.status(status).json({ error: status === 403 ? `${side === "brand" ? "Brand" : "Factory"} access required` : status === 401 ? "Sign in required" : "Translation unavailable" });
  }
  if ((await aiBudget(who, "content-translation", REQUESTS_PER_HOUR)) === "over") {
    return response.status(429).json({ error: "Too many translation requests, try again later" });
  }
  const { caller } = who;

  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  if (toEnglish) return english(caller, service, { quoteIds, orderIds, factoryOrgIds }, response);

  // An order's conversation is named after its request: the request is read through the order.
  if (orderIds.length) {
    const orders = await caller.from("production_orders").select("rfq_id").in("id", orderIds);
    if (orders.error) return response.status(503).json({ error: "Order text unavailable" });
    for (const order of orders.data ?? []) if (order.rfq_id && !rfqIds.includes(order.rfq_id) && rfqIds.length < MAX_RFQS) rfqIds.push(order.rfq_id);
  }
  const [rfqs, questions, colours, brands, messages, steps] = await Promise.all([
    rfqIds.length ? caller.from("rfqs").select("id,title,brief,material_notes,sample_notes,additional_details,sourcing_details").in("id", rfqIds) : { data: [] },
    rfqIds.length ? caller.from("rfq_questions").select("rfq_id,prompt").in("rfq_id", rfqIds) : { data: [] },
    rfqIds.length ? caller.from("rfq_colour_splits").select("rfq_id,colour").in("rfq_id", rfqIds) : { data: [] },
    Promise.all(brandOrgIds.map(async (id) => {
      const { data, error } = await caller.rpc("brand_profile_for_factory", { brand_org: id });
      return error ? null : data;
    })),
    // Read through messages_read: only a party's delivered messages.
    messageIds.length ? caller.from("messages").select("id,body").in("id", messageIds) : { data: [] },
    // The order's steps as the brand named and described them.
    orderIds.length ? caller.from("order_milestones").select("title,description").in("order_id", orderIds) : { data: [] },
  ]);
  if (rfqs.error || messages.error) return response.status(503).json({ error: "Text unavailable" });

  const own = (rows, id) => (rows?.data ?? []).filter((row) => row.rfq_id === id);
  const sources = [...new Set([
    ...(rfqs.data ?? []).flatMap((rfq) => rfqSources(rfq, own(questions, rfq.id), own(colours, rfq.id))),
    ...brands.flatMap(brandSources),
    ...(messages.data ?? []).map((message) => message.body).filter(needsChinese).map((text) => text.trim()),
    ...(steps.data ?? []).flatMap((step) => [step.title, step.description]).filter(needsChinese).map((text) => text.trim()),
  ])];

  const { translations, missing } = await translateAll(sources, {
    translate: (text, { timeoutMs }) => translateIntoChinese(text, { timeoutMs }),
    ...cacheFor(service, hashOf),
  });
  return response.status(200).json({ translations, missing, incomplete: missing.length > 0 });
}

/** A factory's own words in English for a brand, through the vendor profile's cache. */
async function english(caller, service, { quoteIds, orderIds, factoryOrgIds }, response) {
  const orders = orderIds.length
    ? await caller.from("production_orders").select("id,quote_id,factory_org_id").in("id", orderIds)
    : { data: [] };
  if (orders.error) return response.status(503).json({ error: "Order text unavailable" });
  const allQuoteIds = [...new Set([...quoteIds, ...(orders.data ?? []).map((order) => order.quote_id).filter(Boolean)])];
  const quotes = allQuoteIds.length
    ? await caller.from("quotes").select("id,factory_org_id,shipping_notes,sourcing_includes,factory_response,factory_notes").in("id", allQuoteIds)
    : { data: [] };
  if (quotes.error) return response.status(503).json({ error: "Quote text unavailable" });
  const factories = [...new Set([...factoryOrgIds, ...(orders.data ?? []).map((order) => order.factory_org_id), ...(quotes.data ?? []).map((quote) => quote.factory_org_id)].filter(Boolean))].slice(0, 60);
  const shownQuotes = (quotes.data ?? []).map((quote) => quote.id);
  const [answers, sampleLines, materialLines, milestones, profiles, samples] = await Promise.all([
    shownQuotes.length ? caller.from("quote_question_answers").select("answer_text").in("quote_id", shownQuotes) : { data: [] },
    shownQuotes.length ? caller.from("quote_sample_lines").select("stage,includes").in("quote_id", shownQuotes) : { data: [] },
    shownQuotes.length ? caller.from("quote_material_lines").select("material").in("quote_id", shownQuotes) : { data: [] },
    orderIds.length ? caller.from("order_milestones").select("id,title,description").in("order_id", orderIds) : { data: [] },
    // Published profiles only, as the vendor page and Browse read them.
    factories.length ? caller.from("factory_profiles").select("org_id,location,intro").in("org_id", factories) : { data: [] },
    // Sample titles, as a Browse card shows them (titled from the file name when untitled).
    factories.length ? caller.from("documents").select("title,file_name").in("org_id", factories).eq("kind", "product_image").eq("bucket", "org-public") : { data: [] },
  ]);
  const milestoneIds = (milestones.data ?? []).map((row) => row.id);
  const updates = milestoneIds.length
    ? await caller.from("milestone_updates").select("body").in("milestone_id", milestoneIds)
    : { data: [] };

  const { needsEnglish, translateSources, titleFromFileName } = await import("../src/shared/profile-translation.mjs");
  const all = factoryWordsSources({
    quotes: quotes.data, answers: answers.data, sampleLines: sampleLines.data, materialLines: materialLines.data,
    updates: updates.data, profiles: profiles.data, steps: milestones.data,
    sampleTitles: (samples.data ?? []).map((sample) => sample.title || titleFromFileName(sample.file_name)),
  }, needsEnglish);
  const sources = all.slice(0, MAX_SOURCES);
  const names = stepNameSources({ sampleLines: sampleLines.data, steps: milestones.data }, sources);
  // The vendor profile's key: one sentence reads the same English on Browse,
  // the vendor page, the invite step, quotes and the order.
  const { translations, missing } = await translateSources(sources, {
    deadlineMs: DEADLINE_MS,
    translate: (text, { timeoutMs }) => translateText(text, { timeoutMs }),
    ...cacheFor(service, profileHashOf),
  });
  // Sources past the cut were not asked for: incomplete, so a later screen
  // (the order page, for its one order) asks again.
  return response.status(200).json({ translations, missing, incomplete: missing.length > 0 || all.length > MAX_SOURCES, names: names.filter((name) => translations[name]) });
}
