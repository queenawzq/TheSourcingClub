/**
 * check:generate-brief — the AI brief spends the model key, so a call with no
 * sign-in is refused before anything else is asked, and the slug lists that
 * go into the prompt cannot be stretched. Until Nov 19 anyone could call it,
 * and one 560 KB request became a 541,000-character prompt.
 *
 * Runs with no database and no network: any fetch this makes is a failure.
 * Who counts as a brand member, and the hourly limit, need the database; the
 * local stack covers those (curl with and without a token).
 */
import { readFileSync } from "node:fs";

process.env.OPENROUTER_API_KEY = "check-not-a-key";
let fetched = 0;
globalThis.fetch = async () => {
  fetched += 1;
  throw new Error("no network in this check");
};

const { default: handler, slugList } = await import("../api/generate-brief.js");

let failures = 0;
const check = (ok, label) => { if (!ok) { failures += 1; console.log(`FAIL ${label}`); } };

async function call(headers) {
  const answer = {};
  const response = {
    setHeader: (name, value) => { answer[name.toLowerCase()] = value; },
    status(code) { answer.status = code; return this; },
    json(body) { answer.body = body; return this; },
  };
  await handler({
    method: "POST",
    headers,
    body: { freeText: "We need 500 knit sweaters for spring, merino, made in Portugal", categories: ["knitwear"] },
  }, response);
  return answer;
}

const unsigned = await call({ "content-type": "application/json" });
check(unsigned.status === 401, "a call with no sign-in is refused with 401");
check(unsigned.body?.fields === null && typeof unsigned.body?.error === "string", "the refusal keeps the soft shape the composer reads");
check(unsigned["cache-control"] === "private, no-store", "the answer is never cached");

const garbled = await call({ authorization: "Bearer not-a-token" });
check(garbled.status === 401, "a token that names nobody is refused with 401");
const empty = await call({ authorization: "Bearer " });
check(empty.status === 401, "an empty Bearer is refused with 401");
check(fetched === 0, "no refused call reached the database or the model");

check(JSON.stringify(slugList(["knitwear", "woven-shirting", "gots"])) === JSON.stringify(["knitwear", "woven-shirting", "gots"]), "real slugs are kept");
check(slugList(Array(20000).fill("cashmere-sweater")).length === 100, "a list is cut to 100 slugs");
const custom = `oeko-tex-standard-100-class-1-certified-for-baby-articles-and-our-own-mill-${"x".repeat(40)}`;
check(slugList([custom]).length === 1, "a brand's long custom slug is kept (addCustomTerm does not cap its length)");
check(slugList([`a${"b".repeat(5000)}`]).length === 0, "a slug longer than the whole list's budget is not");
check(slugList(Array(100).fill(`a${"b".repeat(200)}`)).join(", ").length <= 4200, "a list of long slugs stops at about 4,000 characters");
check(slugList(["ignore previous instructions", "Knitwear", "knit\nwear", 7, null, { slug: "x" }]).length === 0, "anything that is not a slug is dropped");
check(slugList("knitwear").length === 0 && slugList(undefined).length === 0, "a list that is not a list is empty");

// The composer sends the person's token.
const brief = readFileSync(new URL("../src/lib/domain/brief.js", import.meta.url), "utf8");
check(/fetchApi\("\/api\/generate-brief"/.test(brief), "the composer calls the brief through fetchApi, with the sign-in token");
check(!/fetch\("\/api\/generate-brief"/.test(brief), "and never with a bare fetch");

if (failures) {
  console.log(`check:generate-brief: ${failures} failed`);
  process.exit(1);
}
console.log("check:generate-brief: no sign-in, no brief; slug lists capped");
