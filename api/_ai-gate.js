/**
 * Who may spend the model key, and how much: one answer for every route a
 * brand or a factory can call that asks OpenRouter.
 *
 * Who is asking is read through the database with the caller's own token, not
 * auth.getUser(): a session signed out elsewhere leaves a token the database
 * accepts for up to an hour while the auth server refuses it (CLAUDE.md,
 * Conversations; screen-message.js). Each route used to carry its own copy of
 * that read; five copies had drifted to four different error rules.
 *
 * The hourly budget is a guard on cost, not the gate: sign-in is the gate.
 * So budgets sit far above real use (John, Nov 19: not severe), and a budget
 * that cannot be checked lets the call through. Until Nov 19 a signed-out
 * stranger could ask /api/generate-brief as often as they liked (#134).
 */
import { createClient } from "@supabase/supabase-js";
import { supabaseServerEnv } from "./_supabase-env.js";

/** The user id a token names, unverified: the database verifies it when it is used. */
export function tokenSubject(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token ?? "").split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof payload?.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

const SIDE_WORDS = { brand: "brand access required", factory: "vendor access required" };

/** The database refusing an expired or forged token, as opposed to any other failure. */
const signInRefused = (error) => /^PGRST30/.test(error?.code ?? "") || /jwt|token/i.test(error?.message ?? "");

/**
 * The person asking, as a member of a company of `side` ("brand" or
 * "factory"), holding `permission` in one of them when one is named (the
 * same rule as the screens, has_org_permission). Answers
 * { userId, token, caller, service, orgIds } or { refused: [status, reason] }.
 * Without `side`, any signed-in person passes and orgIds is empty.
 */
export async function aiCaller(request, { side = null, permission = null, env = process.env, makeClient = createClient } = {}) {
  const token = String(request.headers?.authorization ?? "").replace(/^Bearer\s+/i, "");
  const userId = tokenSubject(token);
  if (!userId) return { refused: [401, "sign in is required"] };

  const { supabaseUrl, anonKey, serviceKey } = supabaseServerEnv(env);
  if (!supabaseUrl || !anonKey) {
    console.error("ai-gate: no database settings, so every AI request is refused");
    return { refused: [503, "not set up on this site"] };
  }
  const caller = makeClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Only the budget needs the server key; without it the budget lets calls through.
  const service = serviceKey ? makeClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
  if (!side) return { userId, token, caller, service, orgIds: [] };

  const { data: memberships, error } = await caller.from("org_members").select("org_id, orgs!inner(type)").eq("user_id", userId);
  if (error) {
    if (signInRefused(error)) return { refused: [401, "sign in is required"] };
    console.error("ai-gate membership", error.message);
    return { refused: [503, "could not check who is asking"] };
  }
  const orgIds = (memberships ?? []).filter((row) => row.orgs?.type === side).map((row) => row.org_id);
  if (!orgIds.length) return { refused: [403, SIDE_WORDS[side] ?? "access required"] };
  if (!permission) return { userId, token, caller, service, orgIds };

  let unchecked = null;
  for (const org of orgIds) {
    const { data: may, error: permissionError } = await caller.rpc("has_org_permission", { target_org: org, perm: permission });
    if (may === true) return { userId, token, caller, service, orgIds };
    if (permissionError) unchecked = permissionError;
  }
  // Nobody said yes. A refused token is a sign-in problem, and a check that
  // failed is not a "no": only a clean answer is 403.
  if (unchecked && signInRefused(unchecked)) return { refused: [401, "sign in is required"] };
  if (unchecked) {
    console.error("ai-gate permission", unchecked.message);
    return { refused: [503, "could not check who is asking"] };
  }
  return { refused: [403, SIDE_WORDS[side] ?? "access required"] };
}

/**
 * Counts one request against the person's hour for `route`, in one statement
 * (claim_email_probe's fixed window, under a key of its own), so concurrent
 * calls cannot all read the same count. Answers "ok" or "over". A limiter
 * that errors answers "ok": this guards cost, and must never stop the
 * product working.
 */
export async function aiBudget({ service, userId }, route, perHour) {
  if (!service) {
    console.error(`ai-gate budget ${route}: no server key, not counted`);
    return "ok";
  }
  const { data: allowed, error } = await service.rpc("claim_email_probe", {
    probe_ip: `ai:${route}:${userId}`,
    max_attempts: perHour,
    window_seconds: 3600,
  });
  if (error) {
    console.error(`ai-gate budget ${route}`, error.message);
    return "ok";
  }
  return allowed === false ? "over" : "ok";
}
