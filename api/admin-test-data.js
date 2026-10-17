/**
 * Clear the companies and users test runs leave behind.
 *
 *   GET  → what would be deleted (admin_test_data_preview), so staff see it
 *          before anything happens.
 *   POST { orgIds, userIds } → delete them. The database deletes only the ids
 *          sent that ALSO match its rule now (purge_test_data), so a stale or
 *          edited list can only ever delete less.
 *
 * What counts as test data is decided in one SQL function,
 * test_data_candidates() (migration 20261016000100). This route adds two
 * things SQL cannot do:
 *   - it refuses the production project outright, whoever asks;
 *   - it removes the companies' files from storage first (storage.objects
 *     refuses deletes from SQL), then asks the database to delete the rows.
 */
import { createClient } from "@supabase/supabase-js";
import { supabaseServerEnv } from "./_supabase-env.js";

// thesourcingclub-dev: despite the name, the live marketplace.
export const PRODUCTION_REF = "wxzliajdtwekqdvwzqfb";

function json(response, status, body) {
  response.status(status).json(body);
}

function bodyOf(request) {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) return request.body;
  try {
    return JSON.parse(Buffer.isBuffer(request.body) ? request.body.toString("utf8") : request.body || "{}");
  } catch {
    return {};
  }
}

const uuids = (list) => (Array.isArray(list) ? list : [])
  .filter((id) => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id));

export default async function handler(request, response) {
  if (request.method !== "GET" && request.method !== "POST") return json(response, 405, { error: "method not allowed" });

  const { supabaseUrl, anonKey, serviceKey } = supabaseServerEnv();
  // Before anything else, and whoever is asking.
  if (String(supabaseUrl ?? "").includes(PRODUCTION_REF)) {
    return json(response, 403, { error: "test data is never cleared on the live marketplace" });
  }
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json(response, 503, { error: "clearing test data is not set up on this site" });
  }

  const authorization = String(request.headers.authorization ?? "");
  if (!/^Bearer\s+\S/.test(authorization)) return json(response, 401, { error: "sign in is required" });
  const caller = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });

  // The preview is staff-only in the database (42501 for anyone else), so
  // reading it is also the access check.
  const { data: preview, error: previewError } = await caller.rpc("admin_test_data_preview");
  if (previewError) {
    return previewError.code === "42501"
      ? json(response, 403, { error: "platform staff access is required" })
      : json(response, 500, { error: "the test data could not be listed" });
  }
  if (request.method === "GET") return json(response, 200, preview);

  const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who } = await service.auth.getUser(authorization.replace(/^Bearer\s+/i, ""));
  const { orgIds, userIds } = bodyOf(request);
  const asked = uuids(orgIds);
  const matching = new Set((preview.companies ?? []).map((company) => company.id));
  const orgs = asked.filter((id) => matching.has(id));

  // Files first: once the rows are gone nothing says where they were.
  let filesRemoved = 0;
  if (orgs.length) {
    const { data: files, error: filesError } = await service
      .from("documents")
      .select("bucket, storage_path")
      .in("org_id", orgs);
    if (filesError) return json(response, 500, { error: "the companies' files could not be listed" });
    for (const bucket of new Set(files.map((file) => file.bucket))) {
      const paths = files.filter((file) => file.bucket === bucket && file.storage_path).map((file) => file.storage_path);
      for (let start = 0; start < paths.length; start += 100) {
        const { data: removed, error } = await service.storage.from(bucket).remove(paths.slice(start, start + 100));
        if (error) return json(response, 500, { error: `files in ${bucket} could not be removed` });
        filesRemoved += removed?.length ?? 0;
      }
    }
  }

  const { data: result, error } = await service.rpc("purge_test_data", {
    org_ids: orgs,
    user_ids: uuids(userIds),
    acting_user: who?.user?.id ?? null,
  });
  if (error) return json(response, error.code === "42501" ? 403 : 500, { error: "the test data could not be deleted" });
  return json(response, 200, { ...result, skipped: (result?.skipped ?? 0) + asked.length - orgs.length, files: filesRemoved });
}
