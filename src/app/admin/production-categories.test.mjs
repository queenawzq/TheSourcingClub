import test from "node:test";
import assert from "node:assert/strict";
import { productionCategories } from "./production-categories.mjs";

test("nullable database fields do not crash the admin queue", () => {
  assert.deepEqual(productionCategories({ productionTypes: null, name: null, intro: null, makes: null }), []);
  const result = productionCategories({ name: "Atlas Knit Studio", intro: null, makes: [null] });
  assert.equal(result[0].kind, "knit");
  assert.equal(result[0].inferred, true);
});

test("cut and sew knits mean jersey without adding sweater knitting", () => {
  assert.deepEqual(productionCategories({ productionTypes: ["Cut & sew knits"] }).map((tag) => tag.kind), ["jersey"]);
});

test("saved selections rank ahead of guesses and product evidence breaks ties", () => {
  const result = productionCategories({ productionTypes: ["Jersey", "Wovens"], name: "Knit Studio", makes: ["Poplin blouses"] });
  assert.deepEqual(result.map((tag) => tag.kind), ["woven", "jersey", "knit"]);
  assert.deepEqual(result.map((tag) => tag.inferred), [false, false, true]);
});
