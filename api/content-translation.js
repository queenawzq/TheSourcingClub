/**
 * A brand's words in Chinese, for a factory person who reads the app in
 * Chinese: requests (title, brief, notes, questions, colours) and the brand's
 * profile as `brand_profile_for_factory()` gives it (never revenue, email,
 * website or documents).
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
import { translateIntoChinese } from "./_translate.js";

/** The user id a token names, unverified: the database verifies it when it is used (as api/profile-translation.js). */
function tokenSubject(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof payload?.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

export const config = { maxDuration: 60 };

const DEADLINE_MS = 8000;
const MAX_RFQS = 50;
const MAX_BRANDS = 20;
const UUID = /^[0-9a-f-]{36}$/i;

const hashOf = (source) => createHash("sha256").update(`content-zh-v1:${source}`).digest("hex");

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

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "private, no-store");
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
  const { supabaseUrl, anonKey, serviceKey } = supabaseServerEnv();
  if (!supabaseUrl || !anonKey || !serviceKey) return response.status(503).json({ error: "Translation unavailable" });
  const token = String(request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const userId = tokenSubject(token);
  if (!userId) return response.status(401).json({ error: "Sign in required" });
  const caller = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  let body;
  try { body = typeof request.body === "string" ? JSON.parse(request.body) : request.body; }
  catch { return response.status(400).json({ error: "Invalid request" }); }
  const rfqIds = Array.isArray(body?.rfqIds) ? [...new Set(body.rfqIds)] : [];
  const brandOrgIds = Array.isArray(body?.brandOrgIds) ? [...new Set(body.brandOrgIds)] : [];
  if ((!rfqIds.length && !brandOrgIds.length) || rfqIds.length > MAX_RFQS || brandOrgIds.length > MAX_BRANDS
    || [...rfqIds, ...brandOrgIds].some((id) => !UUID.test(id ?? ""))) {
    return response.status(400).json({ error: "Invalid request" });
  }

  // Only a factory's people read the factory's screens in Chinese.
  const { data: memberships, error: membershipError } = await caller.from("org_members").select("orgs!inner(type)").eq("user_id", userId);
  if (membershipError) return response.status(/jwt|token/i.test(membershipError.message ?? "") || membershipError.code === "PGRST301" ? 401 : 503).json({ error: "Sign in required" });
  if (!memberships?.some((row) => row.orgs?.type === "factory")) return response.status(403).json({ error: "Factory access required" });

  const [rfqs, questions, colours, brands] = await Promise.all([
    rfqIds.length ? caller.from("rfqs").select("id,title,brief,material_notes,sample_notes,additional_details,sourcing_details").in("id", rfqIds) : { data: [] },
    rfqIds.length ? caller.from("rfq_questions").select("rfq_id,prompt").in("rfq_id", rfqIds) : { data: [] },
    rfqIds.length ? caller.from("rfq_colour_splits").select("rfq_id,colour").in("rfq_id", rfqIds) : { data: [] },
    Promise.all(brandOrgIds.map(async (id) => {
      const { data, error } = await caller.rpc("brand_profile_for_factory", { brand_org: id });
      return error ? null : data;
    })),
  ]);
  if (rfqs.error) return response.status(503).json({ error: "Request text unavailable" });

  const own = (rows, id) => (rows?.data ?? []).filter((row) => row.rfq_id === id);
  const sources = [...new Set([
    ...(rfqs.data ?? []).flatMap((rfq) => rfqSources(rfq, own(questions, rfq.id), own(colours, rfq.id))),
    ...brands.flatMap(brandSources),
  ])];

  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { translations, missing } = await translateAll(sources, {
    translate: (text, { timeoutMs }) => translateIntoChinese(text, { timeoutMs }),
    cacheRead: async (texts) => {
      const bySource = new Map(texts.map((source) => [hashOf(source), source]));
      const hashes = [...bySource.keys()];
      const reads = await Promise.all(Array.from({ length: Math.ceil(hashes.length / 80) }, (_, i) =>
        service.from("profile_translation_cache").select("source_hash,english,translated").in("source_hash", hashes.slice(i * 80, i * 80 + 80))));
      const failed = reads.find((read) => read.error);
      if (failed) throw failed.error;
      return new Map(reads.flatMap((read) => read.data).map((row) => [bySource.get(row.source_hash), row]));
    },
    cacheWrite: async (rows) => {
      await service.from("profile_translation_cache")
        .upsert(rows.map(({ source, english, translated }) => ({ source_hash: hashOf(source), english, translated })), { onConflict: "source_hash" });
    },
  });
  return response.status(200).json({ translations, incomplete: missing.length > 0 });
}
