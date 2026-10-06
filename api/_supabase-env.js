/**
 * Which Supabase project the serverless functions talk to.
 *
 * Production and local dev read the variables this project has always used.
 * A PR preview is different: Supabase branching gives each PR that changes
 * the database its own branch, and writes that branch's details into Vercel
 * for the PR's preview under its own names — SUPABASE_URL,
 * SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY. Picking those up one by
 * one would pair the branch's address with production's keys (or the other
 * way round), so they are used only as a set, and only on a preview build.
 *
 * The leading underscore keeps Vercel from serving this file as a route.
 */
export function supabaseServerEnv(env = process.env) {
  if (
    env.VERCEL_ENV === "preview" &&
    env.SUPABASE_URL &&
    env.SUPABASE_PUBLISHABLE_KEY &&
    env.SUPABASE_SECRET_KEY
  ) {
    return {
      supabaseUrl: env.SUPABASE_URL,
      anonKey: env.SUPABASE_PUBLISHABLE_KEY,
      serviceKey: env.SUPABASE_SECRET_KEY,
    };
  }
  return {
    supabaseUrl: env.SUPABASE_URL ?? env.VITE_SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
  };
}
