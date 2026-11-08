import test from "node:test";
import assert from "node:assert/strict";
import { connectNeedsNotice } from "../api/_connect-needs.js";

const fine = { details_submitted: true, payouts_enabled: true, transfers_active: true, requirements_due: [] };
const stripe = (over = {}) => ({
  details_submitted: true, payouts_enabled: true, capabilities: { transfers: "active" },
  requirements: { currently_due: [] }, ...over,
});

test("nothing changed: nothing said", () => {
  assert.equal(connectNeedsNotice(fine, stripe()), null);
});

test("still in its first setup: nothing said, the card already asks", () => {
  assert.equal(connectNeedsNotice(null, stripe({ details_submitted: false, requirements: { currently_due: ["external_account"] } })), null);
});

test("a new item due on a working account is said, once", () => {
  const next = stripe({ requirements: { currently_due: ["individual.verification.document"] } });
  const notice = connectNeedsNotice(fine, next);
  assert.equal(notice.kind, "payout_method_changed");
  assert.equal(notice.title, "Finish setup to withdraw");
  // The same state again (the stored row now has it): silent.
  assert.equal(connectNeedsNotice({ ...fine, requirements_due: ["individual.verification.document"] }, next), null);
});

test("transfers stop: receiving earnings is what is at stake", () => {
  const notice = connectNeedsNotice(fine, stripe({ capabilities: { transfers: "inactive" }, payouts_enabled: false, requirements: { currently_due: ["individual.verification.document"] } }));
  assert.equal(notice.title, "Finish setup to receive earnings");
});

test("only withdrawals stop, something due", () => {
  const notice = connectNeedsNotice(fine, stripe({ payouts_enabled: false, requirements: { currently_due: ["business_profile.url"] } }));
  assert.equal(notice.title, "Finish setup to withdraw");
});

test("stopped with nothing due (under review): never Finish setup", () => {
  const notice = connectNeedsNotice(fine, stripe({ payouts_enabled: false }));
  assert.equal(notice.title, "Withdrawals are paused");
  assert.doesNotMatch(notice.body, /Finish setup/);
  const both = connectNeedsNotice(fine, stripe({ payouts_enabled: false, capabilities: { transfers: "inactive" } }));
  assert.equal(both.title, "Payments to you are paused");
});

test("restored: nothing said", () => {
  assert.equal(connectNeedsNotice({ ...fine, payouts_enabled: false, requirements_due: ["x"] }, stripe()), null);
});

test("no word names Stripe", () => {
  for (const next of [stripe({ payouts_enabled: false }), stripe({ requirements: { currently_due: ["x"] } })]) {
    const notice = connectNeedsNotice(fine, next);
    assert.doesNotMatch(`${notice.title} ${notice.body}`, /stripe/i);
  }
});
