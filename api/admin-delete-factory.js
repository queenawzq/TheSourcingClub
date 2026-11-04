import { createClient } from "@supabase/supabase-js";
import { supabaseServerEnv } from "./_supabase-env.js";

export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ error: "method not allowed" });
  const { supabaseUrl, anonKey, serviceKey } = supabaseServerEnv();
  if (!supabaseUrl || !anonKey || !serviceKey) return response.status(503).json({ error: "Factory deletion is not configured" });
  const authorization = String(request.headers.authorization ?? "");
  if (!authorization.startsWith("Bearer ")) return response.status(401).json({ error: "Sign in is required" });
  let body;
  try { body = typeof request.body === "string" ? JSON.parse(request.body) : request.body ?? {}; }
  catch { return response.status(400).json({ error: "Invalid request" }); }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.orgId ?? "") || typeof body.confirmName !== "string") {
    return response.status(400).json({ error: "A factory and its confirmation name are required" });
  }
  const caller = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data, error } = await caller.rpc("admin_delete_factory", { target_org: body.orgId, confirm_name: body.confirmName });
  if (error) {
    const message = error.code === "23503" ? "Other records still reference this factory; it cannot be deleted" : error.message;
    return response.status(error.code === "42501" ? 403 : 400).json({ error: message });
  }
  // Only after the DB transaction succeeds. Never remove files for a factory
  // whose deletion was refused. The receipt retains paths for a cleanup retry.
  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let cleanupPending = false;
  try {
    for (const bucket of new Set(data.files.map((file) => file.bucket))) {
      const paths = data.files.filter((file) => file.bucket === bucket).map((file) => file.path);
      for (let i = 0; i < paths.length; i += 100) {
        const result = await service.storage.from(bucket).remove(paths.slice(i, i + 100));
        if (result.error) cleanupPending = true;
      }
    }
    if (!cleanupPending) {
      const result = await service.from("admin_factory_deletions").update({ files_cleaned_at: new Date().toISOString() }).eq("id", data.id);
      if (result.error) cleanupPending = true;
    }
  } catch { cleanupPending = true; }
  return response.status(200).json({ deleted: true, name: data.name, cleanupPending });
}
