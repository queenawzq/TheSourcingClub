import assert from "node:assert/strict";
import { englishTranslation } from "../src/shared/message-translation.mjs";
import { translateText } from "../api/_translate.js";
const chinese = { body: "袖口做好了", body_lang: "zh", body_translated: "The cuffs are ready", body_translated_lang: "en" };
assert.equal(englishTranslation(chinese).body, chinese.body);
assert.equal(englishTranslation(chinese).translation, chinese.body_translated);
assert.equal(englishTranslation(chinese).showAltLabel, "Translate to English");
assert.equal(englishTranslation(chinese).hideAltLabel, "Show Original");
assert.equal(englishTranslation(chinese, { own: true }).translation, undefined);
const english = { body: "hello", body_lang: "en", body_translated: "你好", body_translated_lang: "zh" };
assert.equal(englishTranslation(english).translation, undefined);
assert.equal(englishTranslation(english, { own: true }).translation, undefined);
assert.equal(englishTranslation({ ...chinese, body_lang: null }).translation, undefined);
assert.equal(englishTranslation({ ...chinese, body_translated: null }).translation, undefined);
assert.equal(englishTranslation({ ...chinese, body_translated: chinese.body }).translation, undefined);
assert.equal(englishTranslation({ ...chinese, body_lang: "fr" }).translation, chinese.body_translated);
const oldKey = process.env.OPENROUTER_API_KEY;
const oldFetch = globalThis.fetch;
process.env.OPENROUTER_API_KEY = "test-placeholder";
try {
  for (const [text, source, translation] of [["hello", "en", "hello"], ["袖口做好了", "zh", "The cuffs are ready"], ["Les poignets sont prêts", "fr", "The cuffs are ready"]]) {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify({ source_language: source, target_language: "en", translation }) } }] } }] }) });
    const result = await translateText(text);
    assert.equal(result.source_language, source);
    assert.equal(result.translation, source === "en" ? null : translation);
  }
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify({ source_language: "zh", target_language: "fr", translation: "bonjour" }) } }] } }] }) });
  assert.equal((await translateText("你好")).translation, null);
} finally {
  globalThis.fetch = oldFetch;
  if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = oldKey;
}
console.log("Message translation checks passed: received-only, original-first, English target, detection, and unavailable translation.");
