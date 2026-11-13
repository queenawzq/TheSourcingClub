import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { supabaseServerEnv } from "./_supabase-env.js";
import { translateText } from "./_translate.js";

export const config = { maxDuration: 60 };

// The model phase of one request: answers that are not back by then are left
// for the next visit (Nov 13, B7; it used to run batches of 6 one after another).
const DEADLINE_MS = 8000;
// Browse sends its cards in one request, not one per card.
const MAX_ORGS = 50;

const loadRules = () => import("../src/shared/profile-translation.mjs");

/** The user id a token names, unverified: the database verifies it when it is used (as api/screen-message.js). */
export function tokenSubject(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof payload?.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

const hashOf = (source) => createHash("sha256").update(`profile-en-v1:${source}`).digest("hex");

/**
 * `{ orgId }`: the vendor page, every string it shows.
 * `{ orgIds, scope: "card" }`: Browse and dashboard cards, what a card shows.
 * Answers `{ translations, incomplete }`, or for orgIds `{ byOrg: { id: { translations, incomplete } } }`.
 */
export default async function handler(request, response) {
  response.setHeader("Cache-Control", "private, no-store");
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed" });
  const { supabaseUrl, anonKey, serviceKey } = supabaseServerEnv();
  if (!supabaseUrl || !anonKey || !serviceKey) return response.status(503).json({ error: "Translation unavailable" });
  // Who is asking, asked of the database with the caller's own token, not
  // auth.getUser(): the auth server refuses a token the database still
  // accepts (CLAUDE.md, Conversations), which answered 401 right after a
  // sign-in (Nov 9 retest, B1).
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
  const single = body?.orgId != null;
  const orgIds = single ? [body.orgId] : Array.isArray(body?.orgIds) ? [...new Set(body.orgIds)] : [];
  if (!orgIds.length || orgIds.length > MAX_ORGS || orgIds.some((id) => !/^[0-9a-f-]{36}$/i.test(id ?? ""))) {
    return response.status(400).json({ error: "Invalid factory" });
  }
  const scope = single ? "page" : "card";
  const { data: memberships, error: membershipError } = await caller.from("org_members").select("orgs!inner(type)").eq("user_id", userId);
  // The database refuses an expired or forged token.
  if (membershipError) return response.status(/jwt|token/i.test(membershipError.message ?? "") || membershipError.code === "PGRST301" ? 401 : 503).json({ error: "Sign in required" });
  if (!memberships?.some((row) => row.orgs?.type === "brand")) return response.status(403).json({ error: "Brand access required" });

  // Text is read from the authorized profiles, never supplied by the caller.
  const [profiles, media, references] = await Promise.all([
    caller.from("factory_profiles").select("org_id,intro,location,nearest_port,equipment_notes").in("org_id", orgIds).not("published_at", "is", null),
    caller.from("documents").select("org_id,kind,title,caption,file_name,created_at").in("org_id", orgIds)
      .in("kind", scope === "card" ? ["product_image"] : ["product_image", "walkthrough"]).eq("bucket", "org-public").order("created_at"),
    scope === "card" ? { data: [] } : caller.from("profile_references").select("org_id,title").in("org_id", orgIds).order("sort").limit(12),
  ]);
  if (profiles.error) return response.status(503).json({ error: "Profile text unavailable" });
  if (single && !profiles.data?.length) return response.status(404).json({ error: "Published profile not found" });
  if (media.error) return response.status(503).json({ error: "Profile text unavailable" });
  if (references.error) return response.status(503).json({ error: "Profile references unavailable" });

  const { profileSources, translateSources } = await loadRules();
  const sourcesByOrg = new Map(profiles.data.map((profile) => {
    const own = (rows) => (rows ?? []).filter((row) => row.org_id === profile.org_id);
    const files = own(media.data);
    return [profile.org_id, profileSources({
      profile,
      // The page shows the first 12 samples by date (as before) and the newest walkthrough.
      samples: files.filter((file) => file.kind === "product_image").slice(0, 12),
      walkthrough: files.filter((file) => file.kind === "walkthrough").at(-1) ?? null,
      references: own(references.data),
    }, scope)];
  }));

  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { translations, missing } = await translateSources([...new Set([...sourcesByOrg.values()].flat())], {
    deadlineMs: DEADLINE_MS,
    translate: (text, { timeoutMs }) => translateText(text, { context: "factory profile", timeoutMs }),
    cacheRead: async (sources) => {
      const bySource = new Map(sources.map((source) => [hashOf(source), source]));
      const hashes = [...bySource.keys()];
      // 80 hashes a read keeps the address under the gateway's limit.
      const reads = await Promise.all(Array.from({ length: Math.ceil(hashes.length / 80) }, (_, i) =>
        service.from("profile_translation_cache").select("source_hash,english,translated").in("source_hash", hashes.slice(i * 80, i * 80 + 80))));
      const failed = reads.find((read) => read.error);
      if (failed) throw failed.error;
      return new Map(reads.flatMap((read) => read.data).map((row) => [bySource.get(row.source_hash), row]));
    },
    // Upsert, not insert-ignore: a row that wrongly said "not translated" (B2) is replaced.
    cacheWrite: async (rows) => {
      await service.from("profile_translation_cache")
        .upsert(rows.map(({ source, english, translated }) => ({ source_hash: hashOf(source), english, translated })), { onConflict: "source_hash" });
    },
  });

  const missed = new Set(missing);
  const answerFor = (sources) => ({
    translations: Object.fromEntries(sources.filter((source) => source in translations).map((source) => [source, translations[source]])),
    incomplete: sources.some((source) => missed.has(source)),
  });
  if (single) return response.status(200).json(answerFor(sourcesByOrg.get(orgIds[0]) ?? []));
  return response.status(200).json({ byOrg: Object.fromEntries([...sourcesByOrg].map(([id, sources]) => [id, answerFor(sources)])) });
}
