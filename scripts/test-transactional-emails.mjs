import assert from "node:assert/strict";
import { onboardingEmail } from "./generate-onboarding-emails.mjs";
import { accountApprovedEmail, needsInformationEmail } from "./generate-account-approved-email.mjs";
import { messageFor } from "../api/send-review-decision.js";

for (const kind of ["brand", "factory", "trading-company"]) {
  const message = onboardingEmail(kind, {
    companyName: "A & B <Co>",
    dashboardUrl: "https://example.com/app.html",
    logoUrl: "https://example.com/assets/logo.png",
  });
  assert.match(message.html, /A &amp; B &lt;Co&gt;/);
  assert.match(message.html, /width="104" height="44"/);
  assert.match(message.html, /https:\/\/example.com\/assets\/logo.png/);
  assert.match(message.text, /A & B <Co>/);
}

const approved = accountApprovedEmail({ companyName: "Wonder Lab", recipientName: "Queena" });
assert.match(approved.html, /Your account is approved/);
assert.match(approved.html, /width="104" height="44"/);

const note = "Upload <registration> & tax ID.\nPlease reply if unavailable.";
const followUp = needsInformationEmail({ companyName: "Wonder Lab", recipientName: "Queena", note });
assert.match(followUp.html, /Upload &lt;registration&gt; &amp; tax ID\.<br>Please reply if unavailable\./);
assert.ok(followUp.text.includes(note));
assert.throws(() => needsInformationEmail({ note: "  " }), /reviewer note is required/);

const liveMessage = await messageFor({
  decision: "needs_information",
  locale: "en",
  recipient_name: "Queena",
  note,
  orgs: { name: "Wonder Lab" },
});
assert.equal(liveMessage.subject, followUp.subject);
assert.ok(liveMessage.text.includes(note));
assert.match(liveMessage.html, /What we need from you/);

console.log("Transactional email templates and review sender passed.");
