/**
 * A withdrawal and the removal of its method at the same instant (round 14,
 * 20261120340000, review finding A4): two real database sessions against the
 * local stack.
 *
 *   1. The removal runs first and has not committed when the withdrawal
 *      starts. request_withdrawal() reads the account `for share`, so it
 *      waits for the removal, then finds no account and says "Choose one of
 *      your saved withdrawal methods." Before the lock it read the row the
 *      removal had not committed yet, went on, and failed on the foreign key
 *      with Postgres's own words.
 *   2. The withdrawal runs first and has not committed when the removal
 *      starts. The removal waits, then its guard sees the withdrawal and
 *      refuses with "TSC is about to pay this account…".
 *
 * Needs the local stack (`supabase start`) and Docker: it runs psql inside
 * the stack's database container, because a transaction held open across
 * two sessions cannot be done through the API. Its fixtures are committed
 * (ids e14?…, slugs pgtap-r14race-*), removed before and after each run.
 *
 *   node scripts/check-withdrawal-race.mjs
 *
 * RACE_FN=<function name> runs the same steps against another definition of
 * request_withdrawal (used once to show the check fails on the old one).
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const projectId = /^\s*project_id\s*=\s*"([^"]+)"/m.exec(readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8"))?.[1];
assert.ok(projectId, "project_id in supabase/config.toml");
const container = `supabase_db_${projectId}`;
const fn = process.env.RACE_FN || "request_withdrawal";
assert.match(fn, /^[a-z_0-9]+$/, "RACE_FN is a plain function name");
const PSQL = ["exec", "-i", container, "psql", "-U", "postgres", "-h", "127.0.0.1", "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1"];

const OWNER = "e14a0000-0000-0000-0000-000000000001";
const BRAND_OWNER = "e14a0000-0000-0000-0000-000000000002";
const BRAND = "e14b0000-0000-0000-0000-00000000000b";
const FACTORY = "e14b0000-0000-0000-0000-0000000000e1";
const ACCOUNT = "e1490000-0000-0000-0000-000000000001";
const ACCOUNT_2 = "e1490000-0000-0000-0000-000000000002";

function sql(text) {
  return execFileSync("docker", PSQL, { input: text, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

const CLEANUP = `
set session_replication_role = replica;
delete from public.notifications where org_id in ('${FACTORY}', '${BRAND}');
delete from public.payment_takes where org_id = '${FACTORY}';
delete from public.factory_withdrawals where org_id = '${FACTORY}';
delete from public.payment_events where payment_id in (select id from public.order_payments where order_id = 'e14d0000-0000-0000-0000-000000000001');
delete from public.order_payments where order_id = 'e14d0000-0000-0000-0000-000000000001';
delete from public.order_milestones where order_id = 'e14d0000-0000-0000-0000-000000000001';
delete from public.production_orders where id = 'e14d0000-0000-0000-0000-000000000001';
delete from public.quotes where id = 'e14c1000-0000-0000-0000-000000000001';
delete from public.rfqs where id = 'e14c0000-0000-0000-0000-000000000001';
delete from public.factory_payout_preferences where org_id = '${FACTORY}';
delete from public.factory_payout_accounts where org_id = '${FACTORY}';
delete from public.org_members where org_id in ('${FACTORY}', '${BRAND}');
delete from public.orgs where id in ('${FACTORY}', '${BRAND}');
delete from auth.users where id in ('${OWNER}', '${BRAND_OWNER}');
set session_replication_role = origin;
select count(*) from public.orgs where slug like 'pgtap-r14race-%';
`;

// A factory with $500 approved and cleared, one PayPal method (or two).
function setup(accounts) {
  sql(CLEANUP);
  sql(`
begin;
set local session_replication_role = replica;
insert into auth.users (id, email) values ('${OWNER}', 'pgtap-r14race-01@example.com'), ('${BRAND_OWNER}', 'pgtap-r14race-02@example.com');
insert into public.orgs (id, type, name, slug) values
  ('${BRAND}', 'brand', 'R14 Race Brand', 'pgtap-r14race-brand'),
  ('${FACTORY}', 'factory', 'R14 Race Factory', 'pgtap-r14race-factory');
insert into public.org_members (org_id, user_id, role, permissions) values
  ('${FACTORY}', '${OWNER}', 'owner', '{}'), ('${BRAND}', '${BRAND_OWNER}', 'owner', '{}');
insert into public.rfqs (id, brand_org_id, title, status, visibility, quantity_total) values
  ('e14c0000-0000-0000-0000-000000000001', '${BRAND}', 'R14 race request', 'awarded', 'invited_only', 100);
insert into public.quotes (id, rfq_id, factory_org_id, status, unit_price_cents, production_quantity, submitted_at) values
  ('e14c1000-0000-0000-0000-000000000001', 'e14c0000-0000-0000-0000-000000000001', '${FACTORY}', 'accepted', 100, 1, now());
insert into public.production_orders
  (id, rfq_id, quote_id, brand_org_id, factory_org_id, unit_price_cents, status, schedule_brand_agreed_at, schedule_brand_agreed_by,
   production_quantity, bulk_subtotal_cents, sample_subtotal_cents, order_total_cents, deposit_pct, balance_pct, order_number)
values ('e14d0000-0000-0000-0000-000000000001', 'e14c0000-0000-0000-0000-000000000001', 'e14c1000-0000-0000-0000-000000000001',
        '${BRAND}', '${FACTORY}', 50000, 'active', now() - interval '60 days', '${BRAND_OWNER}', 1, 50000, 0, 50000, 50, 50, 'R14-RACE');
insert into public.order_milestones (id, order_id, kind, title, amount_cents, state, sort, completed_at) values
  ('e14e0000-0000-0000-0000-000000000001', 'e14d0000-0000-0000-0000-000000000001', 'approval_and_payment', 'R14 race step', 50000, 'complete', 10, now() - interval '5 days');
insert into public.order_payments
  (id, order_id, milestone_id, amount_cents, currency, state, confirmed_at, release_requested_at, stripe_payment_intent_id, stripe_charge_id, funds_available_at)
values ('e14f0000-0000-0000-0000-000000000001', 'e14d0000-0000-0000-0000-000000000001', 'e14e0000-0000-0000-0000-000000000001', 50000, 'USD', 'confirmed',
        now() - interval '30 days', now() - interval '5 days', 'pi_pgtap_r14race', 'ch_pgtap_r14race', now() - interval '20 days');
insert into public.factory_payout_accounts (id, org_id, method, paypal_email, is_primary, details_changed_at) values
  ${[ACCOUNT, ACCOUNT_2].slice(0, accounts).map((id, i) => `('${id}', '${FACTORY}', 'paypal', 'pgtap-r14race-${i}@example.com', ${i === 0}, '2026-11-01')`).join(",\n  ")};
commit;`);
}

const AS_OWNER = `select set_config('request.jwt.claims', '{"sub":"${OWNER}","role":"authenticated"}', false) \\g /dev/null
set role authenticated;
`;

/** A psql session kept open; resolves `ready` when it prints `marker`. */
function session(label) {
  const child = spawn("docker", PSQL, { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  let err = "";
  const waiters = [];
  child.stdout.on("data", (d) => { out += d; for (const w of waiters) w(); });
  child.stderr.on("data", (d) => { err += d; });
  const exited = new Promise((resolve) => child.on("close", (code) => resolve(code)));
  return {
    write: (text) => child.stdin.write(text),
    end: () => child.stdin.end(),
    until: (marker, ms = 15000) => new Promise((resolve, reject) => {
      const check = () => { if (out.includes(marker)) resolve(); };
      waiters.push(check);
      check();
      setTimeout(() => reject(new Error(`${label}: no "${marker}" within ${ms} ms. stdout: ${out} stderr: ${err}`)), ms).unref();
    }),
    exited,
    get out() { return out; },
    get err() { return err; },
  };
}

/** Waits until a session is blocked on a lock running `needle`. */
async function blockedOn(needle, ms = 15000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const n = Number(sql(`select count(*) from pg_stat_activity where wait_event_type = 'Lock' and query like '%${needle}%' and query not like '%pg_stat_activity%';`));
    if (n > 0) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

const accountsLeft = () => Number(sql(`select count(*) from public.factory_payout_accounts where org_id = '${FACTORY}';`));
const withdrawalsOf = () => sql(`select coalesce(string_agg(status || ':' || coalesce(account_id::text, 'none'), ','), '') from public.factory_withdrawals where org_id = '${FACTORY}';`);

try {
  // 1. Removal first, withdrawal waits on it.
  setup(2);
  {
    const remover = session("removal");
    remover.write(`begin;\n${AS_OWNER}select public.remove_payout_account('${ACCOUNT_2}', null) \\g /dev/null\n\\echo REMOVED_NOT_COMMITTED\n`);
    await remover.until("REMOVED_NOT_COMMITTED");
    const withdrawer = session("withdrawal");
    withdrawer.write(`${AS_OWNER}select (public.${fn}('${FACTORY}', 10000, '${ACCOUNT_2}')).status;\n`);
    withdrawer.end();
    assert.ok(await blockedOn(`${fn}(`), "the withdrawal waits for the removal (the account row is locked)");
    remover.write("commit;\n\\echo COMMITTED\n");
    remover.end();
    await remover.until("COMMITTED");
    assert.equal(await remover.exited, 0, `the removal commits (${remover.err})`);
    const code = await withdrawer.exited;
    assert.notEqual(code, 0, "the withdrawal is refused");
    assert.doesNotMatch(withdrawer.err, /foreign key|violates|_fkey/i, `no raw foreign key error reaches the factory: ${withdrawer.err.trim()}`);
    assert.match(withdrawer.err, /Choose one of your saved withdrawal methods\./, `the readable refusal: ${withdrawer.err.trim()}`);
    assert.equal(accountsLeft(), 1, "the removed account is gone, the other stays");
    assert.equal(withdrawalsOf(), "", "and no withdrawal was recorded");
    console.log("ok 1 - removal first: the withdrawal waits, then is refused in words");
  }

  // 2. Withdrawal first, removal waits on it and is refused by its guard.
  setup(1);
  {
    const withdrawer = session("withdrawal");
    withdrawer.write(`begin;\n${AS_OWNER}select (public.${fn}('${FACTORY}', 10000, '${ACCOUNT}')).status \\g /dev/null\n\\echo ASKED_NOT_COMMITTED\n`);
    await withdrawer.until("ASKED_NOT_COMMITTED");
    const remover = session("removal");
    remover.write(`${AS_OWNER}select public.remove_payout_account('${ACCOUNT}', null);\n`);
    remover.end();
    assert.ok(await blockedOn("remove_payout_account("), "the removal waits for the withdrawal");
    withdrawer.write("commit;\n\\echo COMMITTED\n");
    withdrawer.end();
    await withdrawer.until("COMMITTED");
    assert.equal(await withdrawer.exited, 0, `the withdrawal commits (${withdrawer.err})`);
    assert.notEqual(await remover.exited, 0, "the removal is refused");
    assert.match(remover.err, /TSC is about to pay this account, so it cannot be removed until that payment is sent/, `the guard's refusal: ${remover.err.trim()}`);
    assert.equal(accountsLeft(), 1, "the account stays");
    assert.equal(withdrawalsOf(), `requested:${ACCOUNT}`, "with the withdrawal to it");
    console.log("ok 2 - withdrawal first: the removal waits, then its guard refuses it");
  }
} finally {
  const left = sql(CLEANUP);
  if (left !== "0") console.error(`cleanup left ${left} fixture companies`);
}
console.log("check-withdrawal-race: pass");
