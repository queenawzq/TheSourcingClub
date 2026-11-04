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
  const authorization = String(request.headers.authorization ?? "");
  const caller = createClient(supabaseUrl, anonKey, { auth: { persistSession: false }, global: { headers: { Authorization: authorization } } });
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return response.status(401).json({ error: "Sign in required" });
  let body;
  try { body = typeof request.body === "string" ? JSON.parse(request.body) : request.body; }
  catch { return response.status(400).json({ error: "Invalid request" }); }
  const orgId = body?.orgId;
  if (!/^[0-9a-f-]{36}$/i.test(orgId ?? "")) return response.status(400).json({ error: "Invalid factory" });
  const { data: memberships, error: membershipError } = await caller.from("org_members").select("orgs!inner(type)").eq("user_id", user.id);
  if (membershipError || !memberships?.some((row) => row.orgs?.type === "brand")) return response.status(403).json({ error: "Brand access required" });
  const { data: profile, error } = await caller.from("factory_profiles").select("intro,location,nearest_port,equipment_notes,orgs(name)").eq("org_id", orgId).not("published_at", "is", null).maybeSingle();
  if (error || !profile) return response.status(404).json({ error: "Published profile not found" });
  const { data: media, error: mediaError } = await caller.from("documents").select("title,caption").eq("org_id", orgId).eq("kind", "product_image").eq("bucket", "org-public").order("created_at").limit(12);
  if (mediaError) return response.status(503).json({ error: "Profile text unavailable" });
  const { data: references, error: referenceError } = await caller.from("profile_references").select("title").eq("org_id", orgId).limit(12);
  if (referenceError) return response.status(503).json({ error: "Profile references unavailable" });
  // Text is read from the authorized profile, never supplied by arbitrary callers.
  const sources = [...new Set([profile.orgs?.name, ...Object.values(profile), ...(media ?? []).flatMap((row) => [row.title, row.caption]), ...(references ?? []).map((row) => row.title)].filter((text) => typeof text === "string" && text.trim()))];
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const translations = {};
  let failed = false;
  for (let i = 0; i < sources.length; i += 6) {
    await Promise.all(sources.slice(i, i + 6).map(async (source) => {
      const hash = createHash("sha256").update(`profile-en-v1:${source}`).digest("hex");
      const { data: cached } = await service.from("profile_translation_cache").select("english,translated").eq("source_hash", hash).maybeSingle();
      if (cached) { if (cached.translated) translations[source] = cached.english; return; }
      // The shared translator accepts at most 4000 characters per request.
      const chunks = source.match(/[\s\S]{1,4000}/g) ?? [];
      const results = await Promise.all(chunks.map(async (chunk) => {
        let result = await translateText(chunk, { context: "factory profile", timeoutMs: 6000 });
        if (result.error || !result.source_language) result = await translateText(chunk, { context: "factory profile", timeoutMs: 2000 });
        return result;
      }));
      if (results.some((result) => result.error || !result.source_language)) { failed = true; return; }
      const english = results.map((result, index) => result.translation ?? chunks[index]).join("");
      const translated = results.some((result) => result.source_language !== "en");
      await service.from("profile_translation_cache").upsert({ source_hash: hash, english, translated }, { onConflict: "source_hash", ignoreDuplicates: true });
      if (translated) translations[source] = english;
    }));
  }
  return response.status(200).json({ translations, incomplete: failed });
}
