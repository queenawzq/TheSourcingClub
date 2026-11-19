/**
 * check:message-sweep — the daily job screens messages a closed page left
 * `checking` (api/_message-sweep.js), the same way a send is screened
 * (screenOne in api/screen-message.js). No network: a fake database and a
 * fake model.
 *
 * What it pins: the same order of checks (patterns, contract, model); no
 * model key still delivers as pattern_only; one recorded verdict per
 * message; the batch, the concurrency and the time budget.
 */
import { CONCURRENCY, MAX_PER_RUN, OLDER_THAN_MS, sweepCheckingMessages } from "../api/_message-sweep.js";
import { screenOne } from "../api/screen-message.js";

let failures = 0;
const check = (ok, label) => {
  if (ok) console.log(`  ok  ${label}`);
  else { failures += 1; console.log(`FAIL  ${label}`); }
};

/** A fake service client: records the RPCs, answers like the database does. */
function fakeDb({ contract = false, rows = [], alreadyDecided = new Set() } = {}) {
  const calls = { rpc: [], updates: [], query: null };
  const db = {
    calls,
    rpc(name, args) {
      calls.rpc.push({ name, args });
      if (name === "thread_has_contract") return Promise.resolve({ data: contract, error: null });
      if (name === "record_message_screening") {
        // As the database: a message no longer checking is returned unchanged.
        if (alreadyDecided.has(args.target_message)) return Promise.resolve({ data: { delivery: "delivered", held_for: null }, error: null });
        const blocked = args.outcome === "held" && !contract;
        return Promise.resolve({ data: { delivery: blocked ? "blocked" : "delivered", held_for: blocked ? args.held_for : null }, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unknown rpc ${name}` } });
    },
    from(table) {
      const chain = {
        table, filters: [],
        select() { return chain; },
        update(fields) { calls.updates.push(fields); return chain; },
        eq(column, value) { chain.filters.push(["eq", column, value]); return chain; },
        lt(column, value) { chain.filters.push(["lt", column, value]); return chain; },
        order(column, how) { chain.filters.push(["order", column, how.ascending]); return chain; },
        limit(n) { chain.filters.push(["limit", n]); calls.query = chain; return Promise.resolve({ data: rows.slice(0, n), error: null }); },
        then(resolve) { return Promise.resolve({ error: null }).then(resolve); },
      };
      return chain;
    },
  };
  return db;
}
const noTranslation = () => Promise.resolve(null);
const message = (id, body, files = []) => ({ id, thread_id: `t-${id}`, body, delivery: "checking", documents: files.map((file_name) => ({ file_name })) });
const screeningsOf = (db) => db.calls.rpc.filter((call) => call.name === "record_message_screening");

// ---- screenOne: the same order of checks as on send
{
  const db = fakeDb();
  let asked = 0;
  const answer = await screenOne(db, message("a", "Email me at sam@factory.cn"), { ask: () => { asked += 1; return null; }, translate: noTranslation });
  check(answer.delivery === "blocked" && answer.method === "pattern", "a pattern hit is held, and blocked with no contract");
  check(asked === 0, "…without asking the model");
  check(screeningsOf(db)[0].args.held_for === "contact_details", "…recorded as contact details");
}
{
  const db = fakeDb({ contract: true });
  let asked = 0;
  const answer = await screenOne(db, message("b", "Let's sort the fit sample next week"), { ask: () => { asked += 1; return null; }, translate: noTranslation });
  check(answer.delivery === "delivered" && asked === 0, "a thread with a contract delivers without asking the model");
}
{
  const db = fakeDb();
  const answer = await screenOne(db, message("c", "Can you do 300 units by March?"), { ask: async () => null, translate: noTranslation });
  check(answer.delivery === "delivered" && answer.method === "pattern_only", "no model answer (no key, down, too slow) delivers as pattern_only");
}
{
  const saved = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  const db = fakeDb();
  const answer = await screenOne(db, message("d", "Is the 30% deposit fine?"), { translate: noTranslation });
  check(answer.delivery === "delivered" && answer.method === "pattern_only", "with no OpenRouter key at all, the real model call delivers as pattern_only");
  if (saved !== undefined) process.env.OPENROUTER_API_KEY = saved;
}
{
  const db = fakeDb();
  const answer = await screenOne(db, message("e", "add me on the other app"), {
    ask: async () => ({ hold: true, kind: "outside_platform", reason: "asks to move off the platform", model: "m" }),
    translate: noTranslation,
  });
  check(answer.delivery === "blocked" && screeningsOf(db)[0].args.method === "ai", "the model's hold is recorded as the model's");
}
{
  const db = fakeDb();
  await screenOne(db, message("f", "你好"), {
    ask: async () => null,
    translate: async () => ({ source_language: "zh", translation: "Hello", target_language: "en", model: "m" }),
  });
  check(db.calls.updates.length === 1 && db.calls.updates[0].body_translated === "Hello", "the translation is saved before the verdict");
}

// ---- The sweep
{
  const rows = Array.from({ length: 30 }, (_, i) => message(`m${i}`, `ordinary message ${i}`));
  const db = fakeDb({ rows });
  let running = 0;
  let most = 0;
  const seen = [];
  const at = Date.UTC(2026, 10, 19, 7, 0, 0);
  const result = await sweepCheckingMessages(db, {
    now: () => at,
    screen: async (dbArg, m) => {
      running += 1; most = Math.max(most, running); seen.push(m.id);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
      return { delivery: "delivered" };
    },
  });
  const filters = db.calls.query.filters;
  check(filters.some(([kind, col, v]) => kind === "eq" && col === "delivery" && v === "checking"), "it reads only messages still checking");
  check(filters.some(([kind, col, v]) => kind === "lt" && col === "created_at" && v === new Date(at - OLDER_THAN_MS).toISOString()), "…older than five minutes, so a sender's open page answers first");
  check(filters.some(([kind, col, asc]) => kind === "order" && col === "created_at" && asc === true), "…oldest first");
  check(seen.length === MAX_PER_RUN && result.checked === MAX_PER_RUN, `at most ${MAX_PER_RUN} a run (${seen.length})`);
  check(new Set(seen).size === seen.length, "each message screened once");
  check(most === CONCURRENCY, `${CONCURRENCY} at a time (${most})`);
  check(result.delivered === MAX_PER_RUN && result.failed === 0, "the counts add up");
}
{
  const rows = Array.from({ length: 10 }, (_, i) => message(`b${i}`, "hello"));
  const db = fakeDb({ rows });
  let clock = 0;
  const result = await sweepCheckingMessages(db, {
    now: () => clock,
    budgetMs: 20_000,
    screen: async () => { clock += 9_000; return { delivery: "delivered" }; },
  });
  check(result.checked < 10 && result.left === 10 - result.checked, `none started after the time budget (${result.checked} checked, ${result.left} left)`);
}
{
  const rows = [message("x1", "hello"), message("x2", "hello"), message("x3", "hello")];
  const db = fakeDb({ rows });
  const result = await sweepCheckingMessages(db, {
    screen: async (dbArg, m) => {
      if (m.id === "x1") throw new Error("boom");
      if (m.id === "x2") return { error: "the verdict could not be saved" };
      return { delivery: "blocked" };
    },
  });
  check(result.failed === 2 && result.blocked === 1 && result.checked === 3, "one failure does not stop the rest");
}
{
  // The sender's page answered in between: the database returns the row as it is.
  const rows = [message("r1", "Can we confirm the fabric?")];
  const db = fakeDb({ rows, alreadyDecided: new Set(["r1"]) });
  const result = await sweepCheckingMessages(db, { screen: (d, m) => screenOne(d, m, { ask: async () => null, translate: noTranslation }) });
  check(screeningsOf(db).length === 1 && result.delivered === 1, "a message already decided is recorded once, through the same guarded function");
}
{
  const db = fakeDb();
  db.from = () => ({ select() { return this; }, eq() { return this; }, lt() { return this; }, order() { return this; }, limit: () => Promise.resolve({ data: null, error: { message: "down" } }) });
  let threw = false;
  try { await sweepCheckingMessages(db); } catch { threw = true; }
  check(threw, "a failed read is an error the daily job logs, not a silent nothing");
}

if (failures) {
  console.error(`check:message-sweep: ${failures} failed`);
  process.exit(1);
}
console.log("check:message-sweep passed");
