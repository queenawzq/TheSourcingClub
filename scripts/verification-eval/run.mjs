/**
 * Verification eval: runs the REAL document reading over every test document
 * and scores it.
 *
 *   npm run eval:verification            # every case
 *   npm run eval:verification -- cn-trader tr-factory   # some cases
 *
 * How it stays the real code: `api/registry-assist.js`'s own handler is
 * called with `action: "read_document"`, exactly as the staff review page
 * calls it. Only the database is stood in for: every Supabase request the
 * handler makes (staff check, the company's details, the file download, the
 * save) is answered here from the case's folder, and the request to
 * OpenRouter goes out unchanged, with the handler's own prompt, schema and
 * model. The model is told nothing about a test: it sees what staff's
 * button would send it.
 *
 * Needs OPENROUTER_API_KEY (environment, or the file EVAL_ENV_FILE names, or
 * .env.local here or in the main
 * checkout). Never printed.
 *
 * Each case is docs/<case>/document.(png|jpg|pdf) + expected.json:
 *   typed   what the factory typed (country, number, title, location)
 *   fields  what should be read off the document
 *   flags   which warnings should fire: trading_scope, name_differs,
 *           number_differs, address_differs, specimen_or_edited, unreadable
 *
 * A flag the code under test does not produce yet is "n/a", never a miss:
 * read_document is being extended in parallel (specimen flag, address).
 * Writes scripts/verification-eval/last-run.md.
 */
import fs from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, "../..");
const DOCS = path.join(HERE, "docs");

// --- the key, never printed ------------------------------------------------
function keyFromEnvFiles() {
  const candidates = [...(process.env.EVAL_ENV_FILE ? [path.resolve(process.env.EVAL_ENV_FILE)] : []), path.join(ROOT, ".env.local"),path.resolve(ROOT, "../../../.env.local"), path.resolve(ROOT, "../.env.local")];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const line = fs.readFileSync(file, "utf8").split("\n").find((l) => /^\s*OPENROUTER_API_KEY\s*=/.test(l));
    const value = line?.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
    if (value) return value;
  }
  return "";
}
if (!process.env.OPENROUTER_API_KEY) process.env.OPENROUTER_API_KEY = keyFromEnvFiles();
if (!process.env.OPENROUTER_API_KEY) {
  console.error("OPENROUTER_API_KEY is not set (environment or .env.local). Nothing was run.");
  process.exit(2);
}
for (const file of [path.join(ROOT, ".env.local")]) {
  // The model choice follows the site's own setting when one is there.
  if (!process.env.OPENROUTER_REVIEW_MODEL && fs.existsSync(file)) {
    const m = fs.readFileSync(file, "utf8").match(/^\s*OPENROUTER_REVIEW_MODEL\s*=\s*(.+)$/m);
    if (m) process.env.OPENROUTER_REVIEW_MODEL = m[1].trim().replace(/^["']|["']$/g, "");
  }
}

// --- a stand-in database ---------------------------------------------------
const FAKE = "http://verification-eval.invalid";
process.env.SUPABASE_URL = FAKE;
process.env.SUPABASE_ANON_KEY = "eval-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "eval-service";
delete process.env.VERCEL_ENV;
process.env.VERIFY_AI_READS_DOCUMENTS = "on";

let current = null; // { detail, signals, file: { buffer, mime, name } , saved: [] }
const realFetch = globalThis.fetch;
const reply = (body, status = 200, type = "application/json") =>
  new Response(type === "application/json" ? JSON.stringify(body) : body, { status, headers: { "Content-Type": type } });

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  if (!url.startsWith(FAKE)) return realFetch(input, init);
  const { pathname } = new URL(url);
  if (pathname.startsWith("/auth/v1/user")) return reply({ id: "00000000-0000-4000-8000-00000000e7a1", aud: "authenticated", role: "authenticated" });
  if (pathname.startsWith("/storage/v1/object/")) return reply(current.file.buffer, 200, current.file.mime);
  const rpc = pathname.match(/\/rest\/v1\/rpc\/([a-z_]+)/)?.[1];
  if (rpc === "admin_registry_detail") return reply(current.detail);
  if (rpc === "admin_verification_signals") return reply({ signals: [], registrationFiles: [current.fileRow] });
  if (rpc === "record_verification_signal") {
    try { current.saved.push(JSON.parse(init.body ?? "{}")); } catch { /* ignore */ }
    return reply(null);
  }
  // Anything else the handler starts reading later gets an empty answer,
  // so a new read never breaks the eval; it is listed in the report.
  current.unknown.add(`${init.method ?? "GET"} ${pathname}`);
  return reply(null);
};

const { default: handler } = await import("../../api/registry-assist.js");
const { normaliseRegistrationNumber } = await import("../../src/shared/registration-number.mjs");

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", pdf: "application/pdf" };

async function runCase(id) {
  const dir = path.join(DOCS, id);
  const expected = JSON.parse(fs.readFileSync(path.join(dir, "expected.json"), "utf8"));
  const docName = fs.readdirSync(dir).find((f) => f.startsWith("document."));
  const ext = docName.split(".").pop().toLowerCase();
  const typed = expected.typed ?? {};
  current = {
    file: { buffer: fs.readFileSync(path.join(dir, docName)), mime: MIME[ext] },
    fileRow: { id: `eval-${id}`, bucket: "org-private", path: `eval/${id}/${docName}`, name: docName, mimeType: MIME[ext] },
    detail: {
      registration: { country: typed.country ?? null, number: typed.number ?? null },
      title: typed.title ?? null, displayName: typed.title ?? null, location: typed.location ?? null,
      address: typed.location ?? null,
    },
    saved: [], unknown: new Set(),
  };
  let status = 0;
  let body = null;
  const response = { status(code) { status = code; return this; }, json(value) { body = value; return this; }, setHeader() { return this; } };
  const started = Date.now();
  await handler({ method: "POST", headers: { authorization: "Bearer eval-staff" }, body: { action: "read_document", orgId: `eval-${id}` } }, response);
  return { id, expected, status, body, ms: Date.now() - started, unknown: [...current.unknown] };
}

// --- scoring ---------------------------------------------------------------
const plain = (s) => String(s ?? "").normalize("NFKC").replace(/[\s\p{Cf}，,。.、;；:：()（）\-—'"]/gu, "").toLowerCase();

function flagsFrom(body) {
  const out = {};
  // The handler gave up (no key, model down, timeout): not a judgement on the
  // document, so no flag is scored for it. It is listed under "Not read".
  if (!body || body.available === false) return out;
  const extracted = body.extracted ?? {};
  const diffs = Array.isArray(body.differences) ? body.differences : [];
  out.unreadable = extracted.readable === false;
  out.trading_scope = Boolean(body.tradingScope?.trading);
  out.name_differs = diffs.some((d) => d.field === "name");
  out.number_differs = diffs.some((d) => d.field === "number");
  // Address and specimen: whatever shape the extended reading gives them.
  const addressKnown = diffs.some((d) => d.field === "address") || "addressDiffers" in body || "address" in (body.comparison ?? {}) || body.addressCheck !== undefined;
  if (addressKnown) out.address_differs = diffs.some((d) => d.field === "address") || Boolean(body.addressDiffers || body.comparison?.address?.differs || body.addressCheck?.differs);
  const specimenKeys = ["specimen", "looksEdited", "edited", "specimenOrEdited", "isSpecimen", "looksLikeSpecimen", "tampered"];
  const sources = [extracted, body, body.documentWarnings ?? {}, body.authenticity ?? {}];
  const found = sources.flatMap((s) => specimenKeys.filter((k) => k in s).map((k) => s[k]));
  if (found.length || Array.isArray(body.warnings)) {
    out.specimen_or_edited = found.some((v) => v === true || (typeof v === "string" && v && !/^(no|false|none)$/i.test(v)))
      || (Array.isArray(body.warnings) && body.warnings.some((w) => /specimen|edit|sample|tamper/i.test(JSON.stringify(w))));
  }
  return out;
}

function fieldResults(expected, body, country) {
  const want = expected.fields ?? {};
  const got = body?.extracted ?? {};
  const rows = [];
  for (const [key, value] of Object.entries(want)) {
    if (key === "businessScopeIncludes") {
      rows.push({ key: "businessScope", ok: plain(got.businessScope).includes(plain(value)), want: `…${value}…`, got: got.businessScope ?? "" });
    } else if (key === "registrationNumber") {
      const ok = normaliseRegistrationNumber(country, got.registrationNumber ?? "") === normaliseRegistrationNumber(country, value);
      rows.push({ key, ok, want: value, got: got.registrationNumber ?? "" });
    } else {
      rows.push({ key, ok: plain(got[key]) === plain(value) || (key === "legalName" && plain(got.legalNameEnglish) === plain(value)), want: value, got: got[key] ?? "" });
    }
  }
  return rows;
}

const FLAG_NAMES = ["trading_scope", "name_differs", "number_differs", "address_differs", "specimen_or_edited", "unreadable"];

// --- run -------------------------------------------------------------------
const only = process.argv.slice(2);
const cases = fs.readdirSync(DOCS).filter((d) => fs.existsSync(path.join(DOCS, d, "expected.json"))).filter((d) => !only.length || only.includes(d)).sort();
const results = [];
for (const id of cases) {
  process.stdout.write(`${id} … `);
  const r = await runCase(id);
  const country = r.expected.typed?.country;
  r.fields = fieldResults(r.expected, r.body, country);
  r.flags = flagsFrom(r.body);
  // An unreadable document must not come back with invented fields.
  if (r.expected.mustNotInvent && r.body?.extracted) {
    const invented = ["registrationNumber", "legalName", "legalRepresentative", "address"].filter((k) => String(r.body.extracted[k] ?? "").trim());
    r.invented = invented;
  }
  results.push(r);
  console.log(`${r.ms} ms${r.body?.available === false ? ` (not read: ${r.body.reason})` : ""}`);
}

// Totals: a flag counts only where the code produced it.
const tally = { fieldsOk: 0, fieldsAll: 0 };
const flagTally = Object.fromEntries(FLAG_NAMES.map((f) => [f, { caught: 0, missed: 0, falseAlarm: 0, quiet: 0, na: 0 }]));
for (const r of results) {
  if (r.body?.available === false) continue;
  for (const f of r.fields) { tally.fieldsAll += 1; if (f.ok) tally.fieldsOk += 1; }
  for (const name of FLAG_NAMES) {
    const want = Boolean(r.expected.flags?.[name]);
    if (!(name in r.flags)) { flagTally[name].na += 1; continue; }
    const got = r.flags[name];
    if (want && got) flagTally[name].caught += 1;
    else if (want) flagTally[name].missed += 1;
    else if (got) flagTally[name].falseAlarm += 1;
    else flagTally[name].quiet += 1;
  }
}
const sum = (pick) => FLAG_NAMES.reduce((n, f) => n + pick(flagTally[f]), 0);
const t = (name) => flagTally[name];
const ratio = (a, b) => (b ? `${a}/${b}` : "n/a");
const mismatchCaught = t("name_differs").caught + t("number_differs").caught + t("address_differs").caught;
const mismatchAll = mismatchCaught + t("name_differs").missed + t("number_differs").missed + t("address_differs").missed;
const model = results.find((r) => r.body?.model)?.body.model ?? process.env.OPENROUTER_REVIEW_MODEL ?? "(handler default)";

const summary = [
  ["Fields read correctly", ratio(tally.fieldsOk, tally.fieldsAll)],
  ["Traders caught", ratio(t("trading_scope").caught, t("trading_scope").caught + t("trading_scope").missed)],
  ["Mismatches caught (name, number, address)", ratio(mismatchCaught, mismatchAll) + (t("address_differs").na ? ` (address n/a on ${t("address_differs").na})` : "")],
  ["Specimen / edited caught", t("specimen_or_edited").na === results.length ? "n/a (not produced by this code)" : ratio(t("specimen_or_edited").caught, t("specimen_or_edited").caught + t("specimen_or_edited").missed)],
  ["Unreadable caught", ratio(t("unreadable").caught, t("unreadable").caught + t("unreadable").missed)],
  ["Documents not read (service failure, not scored)", `${results.filter((r) => r.body?.available === false).length}`],
  ["False alarms", `${sum((x) => x.falseAlarm)} (of ${sum((x) => x.falseAlarm + x.quiet)} checks that should stay quiet)`],
];

const lines = [];
lines.push(`# Verification eval — last run`, ``);
lines.push(`Run ${new Date().toISOString()} · model \`${model}\` · ${results.length} documents · code at \`${(() => { try { return fs.readFileSync(path.join(ROOT, ".git"), "utf8").trim(); } catch { return "worktree"; } })().startsWith("gitdir") ? "this worktree" : "this checkout"}\``, ``);
lines.push(`| Score | Result |`, `|---|---|`);
for (const [k, v] of summary) lines.push(`| ${k} | ${v} |`);
lines.push(``, `## Per document`, ``);
lines.push(`| Document | Fields | Flags expected | Flags raised | Verdict | ms |`, `|---|---|---|---|---|---|`);
for (const r of results) {
  const okFields = r.fields.filter((f) => f.ok).length;
  const want = FLAG_NAMES.filter((f) => r.expected.flags?.[f]);
  const raised = FLAG_NAMES.filter((f) => r.flags[f]);
  const missed = want.filter((f) => f in r.flags && !r.flags[f]);
  const extra = raised.filter((f) => !r.expected.flags?.[f]);
  const na = want.filter((f) => !(f in r.flags));
  const bad = r.fields.filter((f) => !f.ok).map((f) => f.key);
  const verdict = [
    missed.length ? `missed ${missed.join(", ")}` : "",
    extra.length ? `false alarm ${extra.join(", ")}` : "",
    bad.length ? `wrong ${bad.join(", ")}` : "",
    r.invented?.length ? `invented ${r.invented.join(", ")}` : "",
    na.length ? `n/a ${na.join(", ")}` : "",
  ].filter(Boolean).join("; ") || "ok";
  lines.push(`| ${r.id} | ${r.fields.length ? `${okFields}/${r.fields.length}` : "–"} | ${want.join(", ") || "none"} | ${raised.join(", ") || "none"} | ${verdict} | ${r.ms} |`);
}
lines.push(``, `## Field misses`, ``);
const misses = results.flatMap((r) => r.fields.filter((f) => !f.ok).map((f) => `- **${r.id}** ${f.key}: expected \`${f.want}\`, read \`${String(f.got).slice(0, 120)}\``));
lines.push(...(misses.length ? misses : ["None."]));
const notRead = results.filter((r) => r.body?.available === false);
if (notRead.length) lines.push(``, `## Not read`, ``, ...notRead.map((r) => `- **${r.id}**: ${r.body.reason}`));
const unknown = [...new Set(results.flatMap((r) => r.unknown))];
if (unknown.length) lines.push(``, `## Database reads answered empty`, ``, `The handler asked for these; the eval answered nothing. Add them to run.mjs if they matter:`, ``, ...unknown.map((u) => `- \`${u}\``));
lines.push(``, `Made-up documents all carry a SPECIMEN / 测试样本 stamp, so "specimen" should fire on every one of them; a false alarm for it can only be measured on a real public document (docs/public-*).`);

const report = `${lines.join("\n")}\n`;
fs.writeFileSync(path.join(HERE, "last-run.md"), report);
console.log(`\n${report}`);
