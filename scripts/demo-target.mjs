/**
 * Which database a demo script writes to, and the guards in front of it:
 * a local stack (from `supabase status`), or a test database named in
 * SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_KEY with --remote.
 * The production project is refused outright.
 *
 * Shared by scripts/seed-demo.mjs and scripts/seed-demo-zh-factory.mjs, so
 * both refuse the same things.
 */
import { execFileSync } from "node:child_process";

const PRODUCTION_REF = "wxzliajdtwekqdvwzqfb";

function localStack() {
  try {
    return JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }));
  } catch {
    return {};
  }
}

// A JWT-style key names its project in the payload; the newer sb_secret_ keys
// don't, so the URL check is the one that always applies.
function keyRef(key) {
  try {
    return JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).ref ?? null;
  } catch {
    return null;
  }
}

export function demoTarget(verb = "seed") {
  const fromEnv = process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_KEY;
  const stack = fromEnv ? {} : localStack();
  const URL = process.env.SUPABASE_URL ?? stack.API_URL;
  const ANON = process.env.SUPABASE_ANON_KEY ?? stack.PUBLISHABLE_KEY ?? stack.ANON_KEY;
  const SERVICE = process.env.SUPABASE_SERVICE_KEY ?? stack.SECRET_KEY ?? stack.SERVICE_ROLE_KEY;
  if (!URL || !ANON || !SERVICE) {
    console.error(`No Supabase to ${verb}. Run \`supabase start\` first, or set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_KEY.`);
    process.exit(1);
  }
  if (URL.includes(PRODUCTION_REF) || keyRef(SERVICE) === PRODUCTION_REF) {
    console.error(`Refusing to ${verb}: that is the production database.`);
    process.exit(1);
  }
  const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/.test(URL);
  if (!isLocal && !process.argv.includes("--remote")) {
    console.error(`Refusing to ${verb} ${new globalThis.URL(URL).host} without --remote. Pass it only for a test database.`);
    process.exit(1);
  }
  return { URL, ANON, SERVICE, isLocal };
}

// A demo document that shows something when it is opened: its own name.
export function demoPdf(name) {
  const title = name.replace(/\.pdf$/, "").replace(/[()\\]/g, "");
  const stream = `BT /F1 18 Tf 40 700 Td (${title}) Tj 0 -28 Td /F1 11 Tf (Demo document. Not a real record.) Tj ET`;
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Count 1/Kids[3 0 R]>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    `<</Length ${stream.length}>>\nstream\n${stream}\nendstream`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const at = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return at;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    + offsets.map((at) => `${String(at).padStart(10, "0")} 00000 n \n`).join("")
    + `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}
