import assert from "node:assert/strict";
import { vendorSummary } from "../src/app/browse/vendor-summary.js";

assert.equal(vendorSummary({ makes: ["Shirts", "Shirts", "Dresses"], specialties: ["Sampling"], intro: "Long company history" }), "Makes: Shirts, Dresses. Specializes in: Sampling.");
assert.equal(vendorSummary(), "");
assert.equal(vendorSummary({ intro: null }), "");
assert.equal(vendorSummary({ intro: "  Knitwear   manufacturer. " }), "Knitwear manufacturer.");
const long = vendorSummary({ intro: "Company history ".repeat(50) });
assert.ok(long.length <= 180);
assert.ok(long.endsWith("…"));
assert.equal(vendorSummary({ specialties: ["Embroidery"] }), "Specializes in: Embroidery.");
console.log("Vendor summary checks passed");
