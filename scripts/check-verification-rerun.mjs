// npm run check:rerun: Run again (staff verification review, Nov 12), with
// stubbed steps and a fake database. No network, no stack.
//   - every failure is short plain words, never a raw error or a tech word;
//   - the staff test comes before any read;
//   - an out-of-date reading is re-read from the current upload, an edit on a
//     current one is laid over it with no model call;
//   - the footer's words for VIES down and an address the map can't place;
//   - the caller's before/after score.
import assert from "node:assert/strict";
import {
  RERUN_WORDS, checkFields, editsFrom, failureCode, outOfDateWords, readingOutOfDate, rerunFailureWords, scoreChangeWords,
} from "../src/shared/verification-rerun.mjs";
import { addressOutcome, handle, runGroup, standingEdits, viesNeedsAsking } from "../api/verification-rerun.js";
import { overlayEdits } from "../api/registry-assist.js";
import { modelFailure } from "../api/admin-review-assist.js";
import { createRerun, groupScore } from "../src/lib/domain/verification-rerun.js";
import * as rules from "../src/shared/verification-rerun.mjs";

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name}\n     ${error.message}`);
  }
}

const ORG = "11111111-2222-3333-4444-555555555555";
const TECH = /openrouter|nominatim|openstreetmap|overpass|ocr|stripe|supabase|postgres|rpc|http|error|exception|null|undefined|json|token|\b[45]\d\d\b|api/i;

// ------------------------------------------------------------------ words

await check("every failure is short plain words", () => {
  for (const [code, words] of Object.entries(RERUN_WORDS)) {
    assert.ok(words.length <= 60, `${code} is ${words.length} characters`);
    assert.ok(!TECH.test(words), `${code} has a tech word: ${words}`);
    assert.match(words, /^[A-Z].*[.]$/, `${code} is a sentence`);
  }
  assert.equal(rerunFailureWords("nonsense"), RERUN_WORDS.failed);
});

await check("the footer's words for the brief's four failures", () => {
  assert.equal(rerunFailureWords("ai_off"), "AI reading isn't set up.");
  assert.equal(rerunFailureWords("ai_timeout"), "The AI took too long. Try again.");
  assert.equal(rerunFailureWords("address_not_found"), "Address not found on the map. Add the postcode.");
  assert.equal(rerunFailureWords("registry_unreachable", { source: "EU VIES" }), "EU VIES didn't answer. Try again later.");
});

await check("model failures map to our codes, never their sentences", () => {
  assert.equal(failureCode("AI help is not set up on this site."), "ai_off");
  assert.equal(failureCode("Reading documents with AI is off on this site."), "ai_off");
  assert.equal(failureCode(modelFailure("timeout")), "ai_timeout");
  assert.equal(failureCode(modelFailure(401)), "ai_off");
  assert.equal(failureCode(modelFailure(402)), "ai_off");
  assert.equal(failureCode(modelFailure(429)), "ai_busy");
  assert.equal(failureCode(modelFailure(503)), "ai_busy");
  assert.equal(failureCode(modelFailure("unreadable")), "ai_failed");
  assert.equal(failureCode("No registration document is uploaded."), "no_file");
  assert.equal(failureCode("The document is over 5 MB, too large for the AI. Open it yourself."), "file_too_large");
  assert.equal(failureCode("The document could not be opened."), "file_unreadable");
  assert.equal(failureCode("something else"), "failed");
});

// ------------------------------------------------------------- out of date

const reading = (over = {}) => ({ checkedAt: "2026-11-09T18:05:00Z", details: { fileId: "old", numberAtReading: "513284976", titleAtReading: "Têxteis Douro", ...over } });

await check("a reading from an earlier upload is out of date (Portugal)", () => {
  const state = readingOutOfDate({ reading: reading(), newestFile: { id: "new", createdAt: "2026-11-11T09:00:00Z" }, number: "513284976", title: "Têxteis Douro" });
  assert.deepEqual(state, { reason: "earlier_upload", since: "2026-11-09T18:05:00Z" });
  assert.equal(outOfDateWords(state, { timeZone: "UTC" }), "Read from an earlier upload, Nov 9");
});

await check("a reading for an old number or name is out of date; a current one is not", () => {
  const newest = { id: "old" };
  assert.equal(readingOutOfDate({ reading: reading(), newestFile: newest, number: "999", title: "Têxteis Douro" }).reason, "number_changed");
  assert.equal(readingOutOfDate({ reading: reading(), newestFile: newest, number: "513284976", title: "Other Lda" }).reason, "name_changed");
  assert.equal(readingOutOfDate({ reading: reading(), newestFile: newest, number: "513284976", title: "têxteis  douro" }), null);
  assert.equal(readingOutOfDate({ reading: null, newestFile: newest }).reason, "never_read");
  assert.equal(readingOutOfDate({ reading: null, newestFile: null }), null);
  assert.equal(outOfDateWords(null), "");
});

// ------------------------------------------------------------------ fields

await check("fields are checked against their group", () => {
  assert.deepEqual(checkFields("business_registration", { legalName: "  Têxteis Douro – Confecções, Lda " }), { fields: { legalName: "Têxteis Douro – Confecções, Lda" } });
  assert.equal(checkFields("business_registration", { siteAddress: "x" }).code, "unknown_field");
  assert.equal(checkFields("photos", {}).code, "bad_request");
  assert.equal(checkFields("company_information", { scope: "x".repeat(2001) }).code, "too_long");
  assert.equal(checkFields("certification", { validUntil: "31/08/2027" }).code, "bad_date");
  assert.equal(checkFields("business_registration", ["x"]).code, "bad_request");
});

await check("only real changes are edits", () => {
  assert.deepEqual(editsFrom({ legalName: "Têxteis Douro, Lda", number: "513284976 " }, { legalName: "Têxteis Douro, Lda", number: "513284976" }), []);
  // HK marked from the number format (PICKS C), only between China and Hong Kong.
  assert.equal(rules.numberCountry("12345678", "CN"), "HK");
  assert.equal(rules.numberCountry("1234567", "CN"), "HK");
  assert.equal(rules.numberCountry("91330212MA2H4K8L3X", "HK"), "CN");
  assert.equal(rules.numberCountry("91330212MA2H4K8L3X", "CN"), null);
  assert.equal(rules.numberCountry("12345678", "HK"), null);
  assert.equal(rules.numberCountry("513284976", "PT"), null);
  assert.deepEqual(editsFrom({ legalName: "Têxteis Douro – Confecções, Lda" }, { legalName: "Têxteis Douro, Lda" }), [{ field: "legalName", from: "Têxteis Douro, Lda", to: "Têxteis Douro – Confecções, Lda" }]);
  assert.deepEqual(editsFrom({ siteAddress: "Rua da Igreja 214, 4750-142" }, {}), [{ field: "siteAddress", from: null, to: "Rua da Igreja 214, 4750-142" }]);
});

await check("edits win over what the model read; earlier edits carry only on the same file", () => {
  const out = overlayEdits({ legalName: "Têxteis Douro, Lda", readable: false, activityCodes: [] }, [{ key: "legalName", value: "Têxteis Douro – Confecções, Lda" }, { key: "activityCodes", value: "14130 · Other outerwear\n46420" }]);
  assert.equal(out.legalName, "Têxteis Douro – Confecções, Lda");
  assert.deepEqual(out.activityCodes, ["14130 · Other outerwear", "46420"]);
  assert.equal(out.readable, true);
  const previous = { details: { fileId: "f1", staffEdits: [{ field: "representative", from: "A", to: "B" }] } };
  const today = [{ field: "legalName", from: "x", to: "y" }];
  assert.equal(standingEdits({ previous, fileId: "f1", edits: today, READING_KEYS: rules.READING_KEYS }).length, 2);
  assert.equal(standingEdits({ previous, fileId: "f2", edits: today, READING_KEYS: rules.READING_KEYS }).length, 1);
});

await check("an address the map can't place says to add the postcode", () => {
  assert.equal(addressOutcome({ available: true, address: "Rua da Igreja 214", found: false, lookupFailed: false }).code, "address_not_found");
  assert.equal(addressOutcome({ available: true, address: "Rua da Igreja 214", found: false, lookupFailed: true }).code, "map_unreachable");
  assert.equal(addressOutcome({ available: true, address: "", found: false }).code, "no_address");
  assert.equal(addressOutcome({ available: false, reason: "The address check failed. Run it again." }).code, "map_unreachable");
  assert.equal(addressOutcome({ timedOut: true }).code, "map_unreachable");
  assert.equal(addressOutcome({ available: true, address: "x", found: true, judgement: "industrial" }).judgement, "industrial");
});

// ------------------------------------------------------------- the groups

/** A fake service client answering the chains the route uses. */
function fakeDb(tables, calls = []) {
  return {
    from(table) {
      calls.push(`from:${table}`);
      let rows = [...(tables[table] ?? [])];
      const q = {
        select: () => q,
        eq: (col, value) => { rows = rows.filter((row) => row[col] === value); return q; },
        neq: (col, value) => { rows = rows.filter((row) => row[col] !== value); return q; },
        order: () => q,
        limit: (n) => { rows = rows.slice(0, n); return q; },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve) => resolve({ data: rows, error: null }),
      };
      return q;
    },
    async rpc(name, args) {
      calls.push(`rpc:${name}`);
      if (name === "company_title") return { data: "Têxteis Douro", error: null };
      if (name === "company_names_match") return { data: args.a.toLowerCase().includes("douro"), error: null };
      return { data: tables[`rpc:${name}`] ?? true, error: null };
    },
  };
}

function stubSteps(log, { readAnswer = { available: true, saved: true }, vies = { result: "registered", details: {} }, address = { available: true, address: "x", found: true, judgement: "industrial" }, photos = { available: true } } = {}) {
  const context = {
    detail: { registration: { country: "PT", number: "513284976" }, title: "Têxteis Douro" },
    files: [{ id: "new", createdAt: "2026-11-11T09:00:00Z" }],
    signals: [],
  };
  return {
    registryAssist: async () => ({
      readingContext: async () => context,
      runReadDocument: async (args) => { log.push(["read", args.edits]); return readAnswer; },
      rereadWithEdits: async (args) => { log.push(["reuse", args.edits]); return readAnswer; },
      runAddressCheck: async (args) => { log.push(["address", args.siteAddress]); return address; },
    }),
    photoCheck: async () => ({ runPhotoCheck: async () => { log.push(["photos"]); return photos; } }),
    vies: async () => ({ askVies: async () => { log.push(["vies"]); return vies; } }),
  };
}

const ptTables = (fileId) => ({
  verification_signals: [{ org_id: ORG, kind: "document_reading", subject_id: fileId, automatic: true, checked_at: "2026-11-09T18:05:00Z", details: { fileId, numberAtReading: "513284976", titleAtReading: "Têxteis Douro", extracted: { legalName: "Têxteis Douro, Lda" } } }],
  company_registrations: [{ org_id: ORG, country_code: "PT", number: "513284976" }],
});

await check("Portugal: an out-of-date reading is read again from the current upload, and VIES asked again", async () => {
  const log = [];
  const result = await runGroup({ orgId: ORG, group: "business_registration", fields: {}, edits: [], asServer: fakeDb(ptTables("old")), requestedBy: "staff", steps: stubSteps(log), rules });
  assert.equal(result.ok, true);
  assert.deepEqual(log.map(([step]) => step), ["read", "vies"]);
  assert.equal(result.ran.reading.from, "file");
});

await check("an edit on a current reading is laid over it, with no model call", async () => {
  const log = [];
  const edits = [{ field: "legalName", from: "Têxteis Douro, Lda", to: "Têxteis Douro – Confecções, Lda" }];
  const result = await runGroup({ orgId: ORG, group: "business_registration", fields: { legalName: edits[0].to }, edits, asServer: fakeDb(ptTables("new")), requestedBy: "staff", steps: stubSteps(log), rules });
  assert.equal(result.ok, true);
  assert.deepEqual(log[0], ["reuse", [{ key: "legalName", value: "Têxteis Douro – Confecções, Lda" }]]);
});

await check("an edit on an out-of-date reading still reads the current upload, with the edit over it", async () => {
  const log = [];
  const edits = [{ field: "legalName", from: "a", to: "Têxteis Douro – Confecções, Lda" }];
  await runGroup({ orgId: ORG, group: "business_registration", fields: { legalName: edits[0].to }, edits, asServer: fakeDb(ptTables("old")), requestedBy: "staff", steps: stubSteps(log), rules });
  assert.deepEqual(log[0], ["read", [{ key: "legalName", value: "Têxteis Douro – Confecções, Lda" }]]);
});

await check("VIES down: the reading is kept and the footer says EU VIES didn't answer", async () => {
  const result = await runGroup({ orgId: ORG, group: "business_registration", fields: {}, edits: [], asServer: fakeDb(ptTables("old")), requestedBy: "staff", steps: stubSteps([], { vies: { result: "could_not_check", details: { reason: "timed out" } } }), rules });
  assert.equal(result.ok, false);
  assert.equal(result.code, "registry_unreachable");
  assert.equal(rerunFailureWords(result.code, { source: result.source }), "EU VIES didn't answer. Try again later.");
  assert.equal(result.ran.reading.ran, true);
});

await check("a worse reading never replaces a readable one", async () => {
  const stored = { details: { fileId: "f1", extracted: { readable: true, legalName: "Têxteis Douro, Lda", registrationNumber: "513284974", address: "Rua da Igreja 214" } } };
  assert.equal(rules.worseReading({ readable: false }, stored, "f2"), true, "an unreadable reading of any file");
  assert.equal(rules.worseReading({ readable: true, legalName: "Têxteis Douro, Lda" }, stored, "f1"), true, "fewer fields from the same file");
  assert.equal(rules.worseReading({ readable: true, legalName: "x", registrationNumber: "1", address: "y" }, stored, "f1"), false, "as many fields");
  assert.equal(rules.worseReading({ readable: true, legalName: "x" }, stored, "f2"), false, "another file may have fewer");
  assert.equal(rules.worseReading({ readable: false }, { details: { extracted: { readable: false } } }, "f1"), false, "nothing readable to keep");
  assert.equal(rules.worseReading({ readable: false }, null, "f1"), false, "nothing stored");
});

await check("Run again that reads worse keeps the stored reading, in the footer's words", async () => {
  const calls = [];
  const result = await runGroup({ orgId: ORG, group: "business_registration", fields: {}, edits: [], asServer: fakeDb(ptTables("old"), calls), requestedBy: "staff", steps: stubSteps([], { readAnswer: { available: true, saved: false, kept: true } }), rules });
  assert.equal(result.ok, false);
  assert.equal(result.code, "kept_reading");
  assert.equal(rerunFailureWords(result.code), "Couldn't read the file. Kept the earlier reading.");
});

await check("the reading step asks the reader to keep a better stored reading", async () => {
  let asked = null;
  const steps = stubSteps([]);
  const assist = await steps.registryAssist();
  steps.registryAssist = async () => ({ ...assist, runReadDocument: async (args) => { asked = args.keepIfWorse; return { available: true, saved: true }; } });
  await runGroup({ orgId: ORG, group: "business_registration", fields: {}, edits: [], asServer: fakeDb(ptTables("old")), requestedBy: "staff", steps, rules });
  assert.equal(typeof asked?.worse, "function");
  assert.equal(asked.previous.details.fileId, "old");
});

await check("the map not answering keeps the last address check: Run again asks for that", async () => {
  let asked = null;
  const steps = stubSteps([]);
  const assist = await steps.registryAssist();
  steps.registryAssist = async () => ({ ...assist, runAddressCheck: async (args) => { asked = args.keepIfFailed; return { available: true, kept: true, address: "x", found: false, lookupFailed: true }; } });
  const result = await runGroup({ orgId: ORG, group: "company_information", fields: {}, edits: [], asServer: fakeDb(ptTables("new")), requestedBy: "staff", steps, rules });
  assert.equal(asked, true);
  assert.equal(result.code, "map_unreachable");
});

await check("VIES is asked again only when the number changed or nothing was asked", async () => {
  assert.equal(viesNeedsAsking({ number: "513284974", last: null }), true, "no earlier answer");
  assert.equal(viesNeedsAsking({ number: "513284974", last: { number_checked: "513284974" } }), false, "same number: keep");
  assert.equal(viesNeedsAsking({ number: "PT 513 284 974", last: { number_checked: "513284974" } }), false, "same number, written differently");
  assert.equal(viesNeedsAsking({ number: "513284982", last: { number_checked: "513284974" } }), true, "staff edited the number");
  assert.equal(viesNeedsAsking({ number: "513284974", readNumber: "513284982", last: { number_checked: "513284974" } }), true, "a new reading read another number");
});

await check("Run again keeps the last VIES answer for an unchanged number, without asking", async () => {
  const log = [];
  const calls = [];
  const tables = { ...ptTables("new"), registry_checks: [{ org_id: ORG, source: "vies", automatic: true, result: "registered", number_checked: "513284976" }] };
  const result = await runGroup({ orgId: ORG, group: "business_registration", fields: {}, edits: [], asServer: fakeDb(tables, calls), requestedBy: "staff", steps: stubSteps(log), rules });
  assert.equal(result.ok, true);
  assert.ok(!log.some(([step]) => step === "vies"), "VIES not asked");
  assert.ok(!calls.includes("rpc:record_registry_check"), "nothing recorded over the last answer");
});

await check("VIES erroring keeps its last answer: nothing is recorded over it", async () => {
  const calls = [];
  const tables = { ...ptTables("new"), registry_checks: [{ org_id: ORG, source: "vies", automatic: true, result: "registered", number_checked: "513284974" }] };
  const result = await runGroup({ orgId: ORG, group: "business_registration", fields: {}, edits: [], asServer: fakeDb(tables, calls), requestedBy: "staff", steps: stubSteps([], { vies: { result: "could_not_check", details: {} } }), rules });
  assert.equal(result.code, "registry_unreachable");
  assert.ok(!calls.includes("rpc:record_registry_check"), "no could_not_check recorded over the last answer");
});

await check("VIES erroring with no earlier answer still records that it couldn't check", async () => {
  const calls = [];
  await runGroup({ orgId: ORG, group: "business_registration", fields: {}, edits: [], asServer: fakeDb(ptTables("new"), calls), requestedBy: "staff", steps: stubSteps([], { vies: { result: "could_not_check", details: {} } }), rules });
  assert.ok(calls.includes("rpc:record_registry_check"));
});

await check("AI not set up: said in words, nothing else pretends to have run", async () => {
  const result = await runGroup({ orgId: ORG, group: "business_registration", fields: {}, edits: [], asServer: fakeDb({ ...ptTables("old"), company_registrations: [{ org_id: ORG, country_code: "CN", number: "x" }] }), requestedBy: "staff", steps: stubSteps([], { readAnswer: { available: false, reason: "AI help is not set up on this site." } }), rules });
  assert.equal(result.ok, false);
  assert.equal(rerunFailureWords(result.code), "AI reading isn't set up.");
  assert.equal(result.ran.registry.ran, false); // China: nothing automatic to ask
});

await check("a step that hangs is said as a time-out, inside the budget", async () => {
  const steps = stubSteps([]);
  const assist = await steps.registryAssist();
  steps.registryAssist = async () => ({ ...assist, runReadDocument: () => new Promise(() => {}) });
  const started = Date.now();
  const result = await runGroup({ orgId: ORG, group: "business_registration", fields: {}, edits: [], asServer: fakeDb(ptTables("old")), requestedBy: "staff", steps, rules, budgetMs: 300 });
  assert.equal(result.code, "ai_timeout");
  assert.ok(Date.now() - started < 3000);
});

await check("company information: the edited address goes to the map; no postcode says so", async () => {
  const log = [];
  const result = await runGroup({ orgId: ORG, group: "company_information", fields: { siteAddress: "Rua da Igreja 214, Arcozelo, Barcelos" }, edits: [{ field: "siteAddress", from: null, to: "Rua da Igreja 214, Arcozelo, Barcelos" }], asServer: fakeDb(ptTables("new")), requestedBy: "staff", steps: stubSteps(log, { address: { available: true, address: "Rua da Igreja 214", found: false } }), rules });
  assert.deepEqual(log.find(([step]) => step === "address"), ["address", "Rua da Igreja 214, Arcozelo, Barcelos"]);
  assert.ok(log.some(([step]) => step === "photos"));
  assert.equal(result.ok, false);
  assert.equal(rerunFailureWords(result.code), "Address not found on the map. Add the postcode.");
});

await check("certification: an edited date in the past is read as expired", async () => {
  const calls = [];
  const db = fakeDb({ factory_certifications: [{ id: "c1", org_id: ORG, expires_at: "2027-08-31", created_at: "2026-11-01" }], verification_signals: [] }, calls);
  const result = await runGroup({ orgId: ORG, group: "certification", fields: { validUntil: "2025-08-31", holder: "Têxteis Douro – Confecções, Lda" }, edits: [{ field: "validUntil", from: null, to: "2025-08-31" }], asServer: db, requestedBy: "staff", steps: stubSteps([]), rules });
  assert.equal(result.ok, true);
  assert.equal(result.ran.certificate.expired, true);
  assert.equal(result.ran.certificate.holderMatches, true);
  assert.ok(calls.includes("rpc:record_verification_signal"));
});

// ------------------------------------------------------------ the route

function fakeResponse() {
  const out = { status: 0, body: null };
  return { out, status(code) { out.status = code; return this; }, json(body) { out.body = body; return this; } };
}

function clients({ staff, member = false, calls }) {
  return (url, key, options) => {
    const caller = Boolean(options?.global?.headers?.Authorization);
    const db = fakeDb({ ...ptTables("old"), "rpc:is_platform_admin": staff, "rpc:is_org_member": member }, calls);
    if (!caller) return db;
    return { ...db, from: (table) => { calls.push(`caller-from:${table}`); return db.from(table); } };
  };
}

const ENV = { supabaseUrl: "http://db", anonKey: "anon", serviceKey: "service" };
const request = (body, authorization = "Bearer a.eyJzdWIiOiJzdGFmZiJ9.b") => ({ method: "POST", headers: { authorization }, body });

await check("signed out: refused in words", async () => {
  const response = fakeResponse();
  await handle(request({ orgId: ORG, group: "business_registration" }, ""), response, { env: ENV, makeClient: clients({ staff: true, calls: [] }) });
  assert.equal(response.out.status, 401);
  assert.equal(response.out.body.error, "Sign in again, then retry.");
});

await check("not staff: refused before anything is read", async () => {
  const calls = [];
  const response = fakeResponse();
  await handle(request({ orgId: ORG, group: "business_registration", fields: { legalName: "x" } }), response, { env: ENV, makeClient: clients({ staff: false, calls }) });
  assert.equal(response.out.status, 403);
  assert.equal(response.out.body.error, "Only TSC staff can do this.");
  assert.deepEqual(calls, ["rpc:is_platform_admin"]);
});

await check("staff in the company itself: refused", async () => {
  const response = fakeResponse();
  await handle(request({ orgId: ORG, group: "business_registration" }), response, { env: ENV, makeClient: clients({ staff: true, member: true, calls: [] }) });
  assert.equal(response.out.status, 403);
});

await check("a field from another group is refused by name", async () => {
  const response = fakeResponse();
  await handle(request({ orgId: ORG, group: "business_registration", fields: { siteAddress: "x" } }), response, { env: ENV, makeClient: clients({ staff: true, calls: [] }) });
  assert.equal(response.out.status, 400);
  assert.equal(response.out.body.field, "siteAddress");
  assert.equal(response.out.body.error, "That field can't be edited here.");
});

await check("staff: edits recorded as the staff member, then the group runs", async () => {
  const calls = [];
  const log = [];
  const response = fakeResponse();
  await handle(request({ orgId: ORG, group: "business_registration", fields: { legalName: "Têxteis Douro – Confecções, Lda" } }), response, { env: ENV, makeClient: clients({ staff: true, calls }), steps: stubSteps(log) });
  assert.equal(response.out.status, 200, JSON.stringify(response.out.body));
  assert.equal(response.out.body.ok, true);
  assert.deepEqual(response.out.body.edits, ["legalName"]);
  assert.ok(calls.indexOf("rpc:record_verification_field_edits") > -1);
  assert.ok(!calls.includes("rpc:admin_set_registration_number"), "an unchanged number is not saved");
  assert.ok(log.length >= 2);
});

await check("an edited number is saved as the staff number first", async () => {
  const calls = [];
  const response = fakeResponse();
  await handle(request({ orgId: ORG, group: "business_registration", fields: { number: "513284977" } }), response, { env: ENV, makeClient: clients({ staff: true, calls }), steps: stubSteps([]) });
  const set = calls.indexOf("rpc:admin_set_registration_number");
  assert.ok(set > -1 && set < calls.indexOf("rpc:record_verification_field_edits"));
});

// ---------------------------------------------------------- the caller

const verificationAt = (score) => ({ groups: [{ key: "business_registration", label: "Business registration", checks: [{ key: "licence", weight: 30, score }, { key: "registry", weight: 30, score: 95 }] }] });

await check("the caller: before and after for 'Score updated: 75% to 95%'", async () => {
  const run = createRerun({
    getToken: async () => "t",
    fetchImpl: async () => ({ status: 200, json: async () => ({ ok: true, ran: { reading: { ran: true } }, edits: [] }) }),
    readScore: async () => verificationAt(95),
  });
  const result = await run({ orgId: ORG, group: "business_registration", before: verificationAt(55) });
  assert.equal(result.ok, true);
  assert.equal(result.before, 75);
  assert.equal(result.after, 95);
  assert.equal(result.delta, 20);
  assert.equal(result.words, "Score updated: 75% to 95%");
  assert.equal(groupScore({ groups: [{ key: "x", score: 12, checks: [] }] }, "x"), 12);
  assert.equal(scoreChangeWords(80, 80), "Score unchanged: 80%");
});

await check("the caller: a failure part-way carries the words and the new score", async () => {
  const run = createRerun({
    getToken: async () => "t",
    fetchImpl: async () => ({ status: 200, json: async () => ({ ok: false, code: "registry_unreachable", error: "EU VIES didn't answer. Try again later.", ran: { reading: { ran: true } } }) }),
    readScore: async () => verificationAt(95),
  });
  const result = await run({ orgId: ORG, group: "business_registration", before: verificationAt(55) });
  assert.equal(result.ok, false);
  assert.equal(result.error, "EU VIES didn't answer. Try again later.");
  assert.equal(result.after, 95);
});

await check("the caller: refused or unreachable is words only, never thrown", async () => {
  const refused = createRerun({ getToken: async () => "t", fetchImpl: async () => ({ status: 403, json: async () => { throw new Error("no body"); } }), readScore: async () => null });
  assert.deepEqual(await refused({ orgId: ORG, group: "business_registration" }), { ok: false, code: "not_staff", error: "Only TSC staff can do this." });
  const offline = createRerun({ getToken: async () => "t", fetchImpl: async () => { throw new TypeError("Failed to fetch"); }, readScore: async () => null });
  assert.equal((await offline({ orgId: ORG, group: "business_registration" })).error, "Couldn't run the checks. Try again.");
  const signedOut = createRerun({ getToken: async () => null, readScore: async () => null });
  assert.equal((await signedOut({ orgId: ORG, group: "business_registration" })).error, "Sign in again, then retry.");
});

if (failures) {
  console.error(`\ncheck:rerun: ${failures} failed`);
  process.exit(1);
}
console.log("\ncheck:rerun: all Run again checks pass");
