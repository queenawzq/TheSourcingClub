#!/usr/bin/env node
/**
 * src/app/live-quiet.css hides the design's intro sentences on the live app.
 * It must never be able to hide what a person needs: a control, a heading or
 * an error. Each selector of a hiding rule is read here.
 */
import { readFileSync } from "node:fs";

const css = readFileSync("src/app/live-quiet.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
// The discount tab bar is the one deliberate control; it says why in the file.
const ALLOWED = new Set([".billing-page-shell .billing-tabs"]);
const FORBIDDEN = [
  [/(^|[\s>+~])(button|input|select|textarea|a|h[1-6]|label|form)([\s.:#[>+~]|$)/, "a control or a heading"],
  [/error|alert|invalid|warning|failed|refus/i, "an error"],
  [/\bbtn\b|-btn|\baction|-action|\bcta\b/i, "an action"],
];
const problems = [];
let rules = 0;
for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  if (!/display\s*:\s*none/.test(body)) continue;
  for (const selector of selectors.split(/,(?![^()]*\))/).map((part) => part.trim()).filter(Boolean)) {
    rules += 1;
    if (ALLOWED.has(selector)) continue;
    // Whatever sits inside :has() and :not() is a condition, not what is hidden.
    const target = selector.replace(/:(has|not)\((?:[^()]|\([^()]*\))*\)/g, "");
    for (const [pattern, what] of FORBIDDEN) {
      if (pattern.test(target)) problems.push(`${selector}: could hide ${what}`);
    }
  }
}
if (!rules) problems.push("no hiding rule was read: has the file moved?");
if (problems.length) {
  console.error(`live-quiet.css:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`live-quiet.css: ${rules} selectors, none can hide a control, a heading or an error`);
