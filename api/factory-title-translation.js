import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { supabaseServerEnv } from "./_supabase-env.js";
import { translateText } from "./_translate.js";
export const config = { maxDuration: 60 };
export default async function handler(request, response) {
  response.setHeader("Cache-Control", "private, no-store");
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
  const { supabaseUrl, anonKey, serviceKey } = supabaseServerEnv();
  if (!supabaseUrl || !anonKey || !serviceKey) return response.status(503).json({ error: "Translation unavailable" });
  const caller = createClient(supabaseUrl, anonKey, { auth: { persistSession: false }, global: { headers: { Authorization: String(request.headers.authorization ?? "") } } });
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return response.status(401).json({ error: "Sign in required" });
  let body;
  try { body = typeof request.body === "string" ? JSON.parse(request.body) : request.body; }
  catch { return response.status(400).json({ error: "Invalid request" }); }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body?.id ?? "") || !["rfq", "order", "brand"].includes(body?.kind)) return response.status(400).json({ error: "Invalid record" });
  const { data: members, error: memberError } = await caller.from("org_members").select("orgs!inner(type)").eq("user_id", user.id);
  if (memberError || !members?.some(row => row.orgs?.type === "factory")) return response.status(403).json({ error: "Factory access required" });
  // Read through the caller's RLS: never accept arbitrary text or use service
  // access to fetch an RFQ/order that this factory cannot already view.
  const field = body.field ?? "title";
  if (!["title", "description", "material", "sourcingDetails", "additionalDetails", "intro"].includes(field)) return response.status(400).json({ error: "Invalid field" });
  const isOrder = body.kind === "order";
  let source;
  if (body.kind === "brand") {
    if (field !== "intro") return response.status(400).json({ error: "Invalid brand field" });
    const { data, error } = await caller.rpc("brand_profile_for_factory", { brand_org: body.id });
    if (error || !data) return response.status(404).json({ error: "Record not found" });
    source = data.intro;
  } else {
    const { data, error } = await caller.from(isOrder ? "production_orders" : "rfqs").select(isOrder ? "rfqs(title,brief,material_notes,sourcing_details,additional_details)" : "title,brief,material_notes,sourcing_details,additional_details").eq("id", body.id).maybeSingle();
    const record = isOrder ? data?.rfqs : data;
    source = field === "title" ? record?.title : field === "material" ? record?.material_notes : field === "sourcingDetails" ? record?.sourcing_details : field === "additionalDetails" ? record?.additional_details : record?.brief || record?.material_notes;
    if (error || !data) return response.status(404).json({ error: "Record not found" });
  }
  if (!source?.trim()) return response.status(200).json({ source: source ?? "", translation: null });
  const hash = createHash("sha256").update(`factory-title-zh-v1:${source}`).digest("hex");
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: cached, error: cacheError } = await service.from("factory_title_translation_cache").select("translation,translated").eq("source_hash", hash).maybeSingle();
  if (cacheError) return response.status(503).json({ error: "Translation cache unavailable" });
  if (cached) return response.status(200).json({ source, translation: cached.translated ? cached.translation : null });
  if (source.length > 40000) return response.status(422).json({ error: "Description too long to translate" });
  const results = await Promise.all((source.match(/[\s\S]{1,4000}/g) ?? []).map(chunk => translateText(chunk, { context: field === "title" ? "request title" : "request description", targetLanguage: "zh", timeoutMs: 12000 })));
  if (results.some(result => result.error)) return response.status(503).json({ error: "Translation unavailable" });
  const translated = results.some(result => result.source_language !== "zh" && Boolean(result.translation));
  const result = { translation: results.map((result, index) => result.translation ?? source.match(/[\s\S]{1,4000}/g)[index]).join("") };
  await service.from("factory_title_translation_cache").upsert({ source_hash: hash, translation: result.translation ?? source, translated }, { onConflict: "source_hash", ignoreDuplicates: true });
  return response.status(200).json({ source, translation: translated ? result.translation : null });
}
