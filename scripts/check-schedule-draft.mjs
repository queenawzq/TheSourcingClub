/**
 * What a brand types on "Add production steps" stays until it saves or leaves.
 *
 * The order page re-reads every 15 s and on anything the other side does, and
 * each read is a new array. `useEffect(() => setRows(saved), [saved])` therefore
 * wiped unsaved edits every 15 s, with the cursor still in the box: an e2e that
 * types and saves straight away never sees it. So this runs the real hook, with
 * only React's hook calls and the database replaced, through the reads a page
 * gets. No database, no browser; it runs in the build.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const REACT_STUB = `
export const useState = (v) => globalThis.__hooks.useState(v);
export const useRef = (v) => globalThis.__hooks.useRef(v);
export const useMemo = (f, d) => globalThis.__hooks.useMemo(f, d);
export const useEffect = (f, d) => globalThis.__hooks.useEffect(f, d);
export default {};
`;
const DOMAIN_STUB = `
export const agreeSchedule = (...a) => globalThis.__domain.agreeSchedule(...a);
export const getOrder = (...a) => globalThis.__domain.getOrder(...a);
export const saveSchedule = (...a) => globalThis.__domain.saveSchedule(...a);
export const listPayments = (...a) => globalThis.__domain.listPayments(...a);
export const formatCapacityWindow = () => "";
`;

// ---- A very small React: enough to run one hook, its effects, and re-renders ----
function mount(hook, firstProps) {
  let slots = [];
  let at = 0;
  let queued = [];
  let dirty = false;
  let props = firstProps;
  let value;
  const same = (a, b) => a && b && a.length === b.length && a.every((item, i) => Object.is(item, b[i]));
  globalThis.__hooks = {
    useState(initial) {
      const i = at++;
      if (!(i in slots)) slots[i] = { value: initial };
      const slot = slots[i];
      return [slot.value, (next) => {
        const resolved = typeof next === "function" ? next(slot.value) : next;
        if (!Object.is(resolved, slot.value)) { slot.value = resolved; dirty = true; }
      }];
    },
    useRef(initial) {
      const i = at++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i];
    },
    useMemo(make, deps) {
      const i = at++;
      if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { deps, value: make() };
      return slots[i].value;
    },
    useEffect(effect, deps) {
      const i = at++;
      if (!slots[i] || !same(slots[i].deps, deps)) { slots[i] = { deps }; queued.push(effect); }
    },
  };
  const flush = () => {
    do {
      dirty = false;
      at = 0;
      queued = [];
      value = hook(props);
      queued.forEach((effect) => effect());
    } while (dirty);
    return value;
  };
  flush();
  return {
    get draft() { return value; },
    // A read answering: new props, new arrays, whatever their content.
    read(next) { props = { ...props, ...next }; return flush(); },
    act(work) { const out = work(value); flush(); return out; },
    async actAsync(work) { const out = await work(value); flush(); return out; },
  };
}

// ---- The real hook, bundled with those two things replaced ----
const bundleOf = (entry) => build({
  entryPoints: [entry],
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
  logLevel: "silent",
  define: { "import.meta.env": "{}" },
  plugins: [{
    name: "stubs",
    setup(b) {
      b.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "stub" }));
      b.onResolve({ filter: /lib\/domain\// }, (args) => ({ path: args.path, namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
        contents: args.path === "react" ? REACT_STUB : DOMAIN_STUB,
        loader: "js",
      }));
    },
  }],
});
const folder = mkdtempSync(join(tmpdir(), "schedule-draft-"));
const bundled = join(folder, "hook.mjs");
writeFileSync(bundled, (await bundleOf("src/app/order/useScheduleDraft.js")).outputFiles[0].text);
const { useScheduleDraft } = await import(pathToFileURL(bundled).href);
// What Manage steps on a running order (ScheduleEditor.jsx) says, from the
// same functions; its rows carry a kind and no type.
const viewBundled = join(folder, "order-view.mjs");
writeFileSync(viewBundled, (await bundleOf("src/app/order/order-view.js")).outputFiles[0].text);
const { scheduleBar, scheduleProblem, stepAmount } = await import(pathToFileURL(viewBundled).href);
rmSync(folder, { recursive: true, force: true });

let failures = 0;
let checks = 0;
const check = (ok, note) => {
  checks += 1;
  if (!ok) {
    failures += 1;
    console.log(`  ✗ ${note}`);
  }
};

// ---- A "database" and the page's reads ----
const step = (id, sort, title, cents, kind = "payment_only") => ({
  id, sort, title, kind, amount_cents: cents, currency: "usd", description: null, due_on: null,
});
const start = () => [step("a", 10, "Bulk deposit", 150000), step("b", 20, "Balance", 350000)];
const order = { id: "o", order_total_cents: 500000, currency: "usd", schedule_revision: 1 };
// Every read is a fresh copy, as PostgREST's is.
const fresh = (rows) => rows.map((row) => ({ ...row }));

function page(database = start(), saveImpl) {
  const state = { database };
  let root;
  const reload = async () => { root.read({ milestones: fresh(state.database) }); };
  globalThis.__domain = {
    saveSchedule: saveImpl ?? (async (_id, lines) => {
      state.database = lines.map((line, i) => step(`s${i}`, line.sort, line.title, line.amount_cents, line.kind));
    }),
    getOrder: async () => order,
    agreeSchedule: async () => {},
    listPayments: async () => [],
  };
  root = mount(useScheduleDraft, { order, milestones: fresh(state.database), reload });
  return { root, state, poll: () => root.read({ milestones: fresh(state.database) }) };
}
const amounts = (draft) => draft.rows.map((row) => row.amount);

// ---- Typing, across 40 s of polling, with nothing changing underneath ----
{
  const { root, poll } = page();
  check(!root.draft.dirty && root.draft.hint === "", "fresh from the database: nothing unsaved");
  root.act((d) => d.onChange(0, { amount: "1000" }));
  for (let second = 15; second <= 45; second += 15) {
    poll();
    check(root.draft.rows[0].amount === "1000", `a typed amount survives the read at ${second} s`);
  }
  check(root.draft.dirty && root.draft.hint === "Unsaved changes", "and still reads as unsaved");
  check(!root.draft.changedElsewhere, "nobody else changed anything");
}
// ---- A step with no name: said at once, and gone once it has one ----
{
  const { root } = page();
  root.act((d) => d.onAdd());
  check(root.draft.problem === "Step 3 needs a name", `an added step asks for its name (${root.draft.problem})`);
  check(!root.draft.canConfirm && !root.draft.canSave, "neither button is live while it has none");
  root.act((d) => d.onChange(2, { title: "Wash test" }));
  check(root.draft.problem === "", "typing the name clears it");
  check(root.draft.canConfirm && root.draft.canSave, "and both buttons come back");
  root.act((d) => d.onChange(2, { type: "Paid release" }));
  check(root.draft.problem === "Step 3 needs an amount", `a paid step asks for its amount (${root.draft.problem})`);
}
// ---- A refusal goes when the steps change ----
{
  const { root } = page(start(), async () => { throw new Error("save the schedule: refused"); });
  root.act((d) => d.onChange(0, { title: "Deposit" }));
  await root.actAsync((d) => d.save());
  check(root.draft.error?.message === "save the schedule: refused", "a refusal is kept");
  root.act((d) => d.onChange(0, { title: "Deposit two" }));
  check(root.draft.error === null, "and goes on the next edit");
}
// ---- Adding, removing, renaming, moving ----
{
  const { root, poll } = page();
  root.act((d) => d.onAdd());
  poll();
  check(root.draft.rows.length === 3, "an added step survives a read");
  root.act((d) => d.onChange(2, { title: "Fit sample" }));
  poll();
  check(root.draft.rows[2]?.title === "Fit sample", "its name survives a read");
  root.act((d) => d.onRemove(0));
  poll();
  check(root.draft.rows.length === 2 && root.draft.rows[0].title === "Balance", "a removed step stays removed");
  root.act((d) => d.onMove(1, -1));
  poll();
  check(root.draft.rows[0].title === "Fit sample", "a moved step stays moved");
}
// ---- The factory does something: the step's state moves, its words and figures don't ----
{
  const { root, state, poll } = page();
  root.act((d) => d.onChange(1, { amount: "4000" }));
  state.database = state.database.map((row) => ({ ...row, state: "submitted", updated_at: "later" }));
  poll();
  check(root.draft.rows[1].amount === "4000", "the other side's activity leaves the draft alone");
  check(!root.draft.changedElsewhere, "and is not called a change to the steps");
}
// ---- A clean draft follows the database ----
{
  const { root, state, poll } = page();
  state.database = [step("a", 10, "Bulk deposit", 200000), step("b", 20, "Balance", 300000)];
  poll();
  check(amounts(root.draft)[0] === "$2,000", "with no edits, a teammate's save shows at once");
  check(!root.draft.dirty && !root.draft.changedElsewhere, "and leaves nothing unsaved");
}
// ---- A teammate saves over a draft with edits: neither is lost ----
{
  const { root, state, poll } = page();
  root.act((d) => d.onChange(0, { amount: "1000" }));
  state.database = [step("a", 10, "Bulk deposit", 200000), step("b", 20, "Balance", 300000)];
  poll();
  check(root.draft.rows[0].amount === "1000", "a teammate's save does not wipe what is typed");
  check(root.draft.changedElsewhere, "and the page says the steps changed");
  poll();
  check(root.draft.changedElsewhere && root.draft.rows[0].amount === "1000", "and goes on saying so on the next read");
  root.act((d) => d.takeSaved());
  check(amounts(root.draft)[0] === "$2,000" && !root.draft.dirty && !root.draft.changedElsewhere, "Use their steps takes theirs");
}
// ---- Saving ----
{
  const { root, state } = page();
  root.act((d) => d.onChange(0, { amount: "1000" }));
  root.act((d) => d.onChange(1, { amount: "4000" }));
  check(root.draft.canSave, "a balanced edit can be saved");
  await root.actAsync((d) => d.save());
  check(state.database[0].amount_cents === 100000, "the save sent what was typed");
  check(amounts(root.draft)[0] === "$1,000" && !root.draft.dirty, "the saved steps replace the draft");
  check(!root.draft.changedElsewhere, "my own save is not somebody else's change");
  check(root.draft.hint === "Saved", "and the page says Saved");
  root.act((d) => d.onChange(0, { amount: "2000" }));
  check(root.draft.hint === "Unsaved changes", "the next edit is unsaved again");
}
// ---- A database that tidies what it was sent is still my own save ----
{
  const { root, state } = page(start(), async (_id, lines) => {
    state2.database = lines.map((line, i) => step(`s${i}`, (i + 1) * 100, line.title, line.amount_cents, line.kind));
  });
  const state2 = state;
  root.act((d) => d.onChange(0, { amount: "1000" }));
  root.act((d) => d.onChange(1, { amount: "4000" }));
  await root.actAsync((d) => d.save());
  check(!root.draft.dirty && !root.draft.changedElsewhere, "a save the database tidied leaves nothing unsaved");
}
// ---- A refused save loses nothing ----
{
  const { root } = page(start(), async () => { throw new Error("refused"); });
  root.act((d) => d.onChange(0, { amount: "1000" }));
  root.act((d) => d.onChange(1, { amount: "4000" }));
  await root.actAsync((d) => d.save());
  check(root.draft.error?.message === "refused", "a refused save says why");
  check(root.draft.rows[0].amount === "1000" && root.draft.dirty, "and keeps what was typed");
}
// ---- Manage steps on a running order: the same words as the builder ----
{
  const running = [
    { kind: "approval_and_payment", title: "Bulk deposit", amount: stepAmount(192000, "USD") },
    { kind: "progress_only", title: "Bulk production", amount: "" },
    { kind: "payment_only", title: "Final balance", amount: stepAmount(428400, "USD") },
  ];
  check(running[0].amount === "$1,920" && running[2].amount === "$4,284", `amounts read as money (${running[0].amount}, ${running[2].amount})`);
  check(stepAmount(6500, "USD") === "$65" && stepAmount(1250, "USD") === "$12.50", "whole dollars and cents both");
  const bar = (rows, error = null) => scheduleBar({
    problem: scheduleProblem(rows), error, total: 620400, orderTotal: 620400, currency: "USD", until: "save",
  });
  check(scheduleProblem(running) === "", "a running order's steps have nothing to fix");
  check(bar(running) === "Steps total $6,204.00 of $6,204.00", `the bar gives the total (${bar(running)})`);
  const added = [...running, { kind: "progress_only", title: "", amount: "" }];
  check(bar(added) === "Step 4 needs a name", `an added step asks for its name (${bar(added)})`);
  const unpaid = [...running, { kind: "approval_and_payment", title: "Wash test", amount: "" }];
  check(bar(unpaid) === "Step 4 needs an amount", `a paid step with a kind and no type asks for its amount (${bar(unpaid)})`);
  const refused = bar(running, new Error("update the milestones: step 6 needs a title"));
  check(refused === "Step 6 needs a title", `a refusal is a sentence, not the raw error (${refused})`);
  const off = scheduleBar({ problem: "", error: null, total: 600000, orderTotal: 620400, currency: "USD", until: "save" });
  check(off.endsWith(": these have to match before you can save"), `a mismatch says what it stops (${off})`);
}

if (failures) {
  console.error(`check:schedule-draft: ${failures} of ${checks} failed`);
  process.exit(1);
}
console.log(`check:schedule-draft: ${checks} checks passed`);
