import { createClient } from "@supabase/supabase-js";
import { supabaseServerEnv } from "./_supabase-env.js";

const jsonBody = (request) =>
  typeof request.body === "string" ? JSON.parse(request.body) : request.body ?? {};

const isUuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value));

async function authenticatedAdmin(authorization, supabaseUrl, anonKey) {
  if (!authorization?.startsWith("Bearer ")) return null;
  const caller = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const [{ data: isAdmin, error: adminError }, { data: auth, error: userError }] = await Promise.all([
    caller.rpc("is_platform_admin"),
    caller.auth.getUser(),
  ]);
  if (adminError || userError || !isAdmin || !auth.user) return null;
  return auth.user;
}

async function listAllAuthUsers(service) {
  const users = [];
  let page = 1;
  while (true) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const batch = data?.users ?? [];
    users.push(...batch);
    if (batch.length < 1000) return users;
    page += 1;
  }
}

// Every row, a page at a time: a read stops at 1,000 rows without saying so,
// even with the secret key, and the users past it showed no name and "No
// company". `query` must order by something unique. A row added while it
// reads can push one onto the next page, so a row read twice is kept once,
// by `key` (as readEveryPage does in src/lib/read-pages.js).
async function readAllRows(query, key) {
  const rows = [];
  const seen = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query().range(from, from + 999);
    if (error) throw error;
    for (const row of data ?? []) {
      const rowKey = key(row);
      if (!seen.has(rowKey)) rows.push(row);
      seen.add(rowKey);
    }
    if ((data ?? []).length < 1000) return { data: rows };
  }
}

async function listUsers(service, currentUserId) {
  // Vercel compiles api/*.js as CommonJS; the shared ESM rule is imported lazily.
  const { signupFinished } = await import("../src/shared/signup-finished.mjs");
  const [authUsers, profilesResult, membersResult, adminsResult, factoriesResult, brandsResult] = await Promise.all([
    listAllAuthUsers(service),
    readAllRows(() => service.from("user_profiles").select("id, email, full_name, created_at").order("id"), (row) => row.id),
    readAllRows(() => service.from("org_members").select("user_id, role, org_id, created_at, orgs (name, type)").order("created_at").order("user_id").order("org_id"), (row) => `${row.user_id}:${row.org_id}`),
    readAllRows(() => service.from("platform_admins").select("user_id").order("user_id"), (row) => row.user_id),
    readAllRows(() => service.from("factory_profiles").select("org_id, vendor_kind, onboarding_completed_at").order("org_id"), (row) => row.org_id),
    readAllRows(() => service.from("brand_profiles").select("org_id, onboarding_completed_at").order("org_id"), (row) => row.org_id),
  ]);

  const profiles = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));
  const memberships = new Map();
  for (const membership of membersResult.data ?? []) {
    if (!memberships.has(membership.user_id)) memberships.set(membership.user_id, membership);
  }
  const adminIds = new Set((adminsResult.data ?? []).map((admin) => admin.user_id));
  const vendorKinds = new Map((factoriesResult.data ?? []).map((profile) => [profile.org_id, profile.vendor_kind]));
  // A company that finished signup (Nov 26): the Users screen marks the rest "Signup not finished".
  const finished = new Set([...(factoriesResult.data ?? []), ...(brandsResult.data ?? [])]
    .filter((row) => row.onboarding_completed_at).map((row) => row.org_id));
  const now = Date.now();

  return authUsers.map((authUser) => {
    const profile = profiles.get(authUser.id);
    const membership = memberships.get(authUser.id);
    const org = Array.isArray(membership?.orgs) ? membership.orgs[0] : membership?.orgs;
    const isAdmin = adminIds.has(authUser.id);
    const bannedUntil = authUser.banned_until ? new Date(authUser.banned_until).getTime() : 0;
    return {
      id: authUser.id,
      email: profile?.email || authUser.email || "",
      name: profile?.full_name || authUser.user_metadata?.full_name || authUser.user_metadata?.name || authUser.email?.split("@")[0] || "Unnamed user",
      company: isAdmin ? "The Sourcing Club" : org?.name || "No company",
      orgType: isAdmin ? "admin" : org?.type || null,
      vendorKind: membership?.org_id ? vendorKinds.get(membership.org_id) ?? null : null,
      // Only a person whose company hasn't finished is marked: the direct read's rule (R11).
      ...signupFinished(isAdmin, membership?.org_id, finished),
      createdAt: profile?.created_at || authUser.created_at,
      lastActiveAt: authUser.last_sign_in_at || null,
      disabled: bannedUntil > now,
      protected: authUser.id === currentUserId,
    };
  });
}

export default async function handler(request, response) {
  if (!["GET", "PATCH"].includes(request.method)) {
    response.status(405).json({ error: "method not allowed" });
    return;
  }

  const { supabaseUrl, anonKey, serviceKey } = supabaseServerEnv();
  if (!supabaseUrl || !anonKey || !serviceKey) {
    response.status(503).json({ error: "admin user directory is not configured on the server" });
    return;
  }

  const currentUser = await authenticatedAdmin(request.headers.authorization, supabaseUrl, anonKey);
  if (!currentUser) {
    response.status(403).json({ error: "platform staff access is required" });
    return;
  }

  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    if (request.method === "GET") {
      response.status(200).json({ users: await listUsers(service, currentUser.id) });
      return;
    }

    const { userId, disabled } = jsonBody(request);
    if (!isUuid(userId) || typeof disabled !== "boolean") {
      response.status(400).json({ error: "a valid user id and disabled state are required" });
      return;
    }
    if (userId === currentUser.id) {
      response.status(400).json({ error: "you cannot disable your current staff account" });
      return;
    }

    const { error } = await service.auth.admin.updateUserById(userId, {
      ban_duration: disabled ? "876000h" : "none",
    });
    if (error) throw error;
    response.status(200).json({ userId, disabled });
  } catch (error) {
    response.status(500).json({ error: error.message || "the user directory could not be updated" });
  }
}
