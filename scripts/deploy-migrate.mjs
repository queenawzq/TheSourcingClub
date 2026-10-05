/**
 * Apply pending database migrations during the Vercel PRODUCTION build.
 *
 * Merging to `main` deploys the site; this makes the same merge apply the
 * migrations that came with it, so new code never goes live against a
 * database that lacks its schema. It runs after `npm run build` (see
 * vercel.json): a build that fails never touches the database, and a
 * migration that fails fails the deploy, so the previous site stays live.
 *
 * It only acts when all of these hold, and says why when it does not:
 *
 *   - VERCEL_ENV is "production". Preview builds run unmerged PR code and
 *     must never reach the production database; local and Netlify builds do
 *     not run this script at all.
 *   - SUPABASE_DB_URL is set. It is the Session pooler connection string
 *     (IPv4; the direct connection is IPv6-only), scoped to Production in
 *     Vercel. Without it the script skips, so it is inert until added.
 *   - The commit is on `main`. "Promote to Production" on a PR preview builds
 *     that PR's code with production variables; applying its migrations
 *     would put unreviewed SQL on the live database.
 *
 * `--include-all` because PRs merge out of timestamp order: a migration
 * written before one that is already applied is still pending, and without
 * the flag `db push` refuses it. `--yes` because nobody is there to answer.
 *
 * Production must never hold a migration the files do not: `db push` then
 * exits non-zero and the build fails. That is why a rollback is Vercel's
 * Instant Rollback (no rebuild), not a redeploy of an older commit.
 *
 * The connection string is never printed.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "node_modules", ".bin", "supabase");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const PRODUCTION_BRANCH = "main";

const log = (line) => console.log(`[deploy-migrate] ${line}`);
const fail = (line) => {
  console.error(`[deploy-migrate] ERROR: ${line}`);
  process.exit(1);
};

const cliVersion = existsSync(CLI)
  ? spawnSync(CLI, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).stdout?.trim()
  : "";
const migrations = existsSync(MIGRATIONS)
  ? readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql"))
  : [];

log(`Supabase CLI ${cliVersion || "not installed"}; ${migrations.length} migration files`);

const env = process.env.VERCEL_ENV || "(not a Vercel build)";
if (env !== "production") {
  log(`skipping: not a production build (VERCEL_ENV=${env})`);
  process.exit(0);
}
if (!process.env.SUPABASE_DB_URL) {
  log("skipping: SUPABASE_DB_URL is not set, so migrations are not applied by this deploy");
  process.exit(0);
}

const ref = process.env.VERCEL_GIT_COMMIT_REF || "(unknown)";
if (ref !== PRODUCTION_BRANCH) {
  fail(`refusing to migrate a production build of "${ref}"; only "${PRODUCTION_BRANCH}" applies migrations`);
}
if (!cliVersion) {
  fail("the Supabase CLI is not installed (devDependency `supabase` in package.json)");
}
if (migrations.length === 0) {
  fail("supabase/migrations/ is missing or empty in this build; check .vercelignore");
}

log(`applying pending migrations from ${ref}`);
const push = spawnSync(
  CLI,
  ["db", "push", "--db-url", process.env.SUPABASE_DB_URL, "--include-all", "--yes"],
  { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"] },
);
if (push.status !== 0) {
  fail(`supabase db push failed (exit ${push.status ?? push.signal}); this deploy is stopped and the live site is unchanged`);
}
log("migrations are up to date");
