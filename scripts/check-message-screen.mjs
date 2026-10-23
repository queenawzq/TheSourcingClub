/**
 * The model half of screening a message (api/screen-message.js), on real
 * sentences. Runs only with OPENROUTER_API_KEY set, since it asks the model;
 * without one it says so and passes, like the rest of the site does.
 *
 * The patterns are pinned in check-message-patterns.mjs. These are the
 * judgements only the model makes: asking for a call is ordinary (the
 * platform has its own), proposing to leave the platform is not, and a hold
 * says which of the two kinds it is, because that is what its sender is told.
 */
import { askModel } from "../api/screen-message.js";

if (!process.env.OPENROUTER_API_KEY) {
  console.log("check:screen: skipped (no OPENROUTER_API_KEY)");
  process.exit(0);
}

const DELIVER = [
  // Held on #51's preview, 23 Oct.
  "Hi Ningbo, thanks for the quote. Could we talk through the fit sample on a short call?",
  "Can we have a quick video call tomorrow to go over the lab dips?",
  "Let's schedule a meeting next week to review the PP sample.",
  "Happy to jump on a call if that's easier than writing it all out.",
];

const HOLD = [
  ["Let's move this conversation off the platform, it will be faster for both of us.", "outside_platform"],
  ["We could skip the platform fee if you pay us directly by bank transfer.", "outside_platform"],
  ["Easier to talk on WeChat, can you add me? My id is lina_rue_2026", "contact_details"],
];

let failures = 0;
const fail = (message) => { failures += 1; console.log(`  ✗ ${message}`); };

for (const text of DELIVER) {
  const verdict = await askModel(text, []);
  if (!verdict) fail(`no verdict for "${text}"`);
  else if (verdict.hold) fail(`held: "${text}" (${verdict.reason})`);
}
for (const [text, kind] of HOLD) {
  const verdict = await askModel(text, []);
  if (!verdict) fail(`no verdict for "${text}"`);
  else if (!verdict.hold) fail(`delivered: "${text}" (expected held for ${kind})`);
  else if (verdict.kind !== kind) fail(`"${text}": held for ${verdict.kind}, expected ${kind}`);
}

const total = DELIVER.length + HOLD.length;
if (failures) {
  console.log(`check:screen: ${failures} of ${total} model checks failed`);
  process.exit(1);
}
console.log(`check:screen: all ${total} model checks pass (${HOLD.length} held, ${DELIVER.length} delivered)`);
