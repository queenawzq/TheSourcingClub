/**
 * Queena's shape for "ask for changes" (Nov 5): a summary, bullets of what to
 * upload, a friendly close. Pins that a note staff typed becomes that in the
 * real builder, that nothing typed is lost or unescaped, and that Test emails
 * shows the same shape, so the sample cannot go back to one sentence.
 */
import { readFileSync } from "node:fs";
import { accountApprovedEmail, declinedEmail, needsInformationEmail } from "./generate-account-approved-email.mjs";
import { noteHasList, parseReviewNote, reviewNoteHtml } from "../src/shared/review-note.mjs";

let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) {
    failures += 1;
    console.error(`FAIL  ${name}${detail ? `: ${detail}` : ""}`);
  }
};
const list = (note) => parseReviewNote(note).filter((block) => block.type === "list").flatMap((block) => block.items);

for (const [typed, text] of [
  ["- item", "item"], ["* item", "item"], ["• item", "item"], ["•item", "item"], ["· item", "item"],
  ["・营业执照", "营业执照"], ["– item", "item"], ["— item", "item"], ["－ 营业执照", "营业执照"],
  ["1. item", "item"], ["1) item", "item"], ["1、营业执照", "营业执照"], ["（1）营业执照", "营业执照"],
  ["(2) item", "item"], ["一、营业执照", "营业执照"], ["十二、营业执照", "营业执照"],
]) check(`"${typed}" is a list item`, list(typed).join() === text, JSON.stringify(parseReviewNote(typed)));

for (const typed of ["-5 units", "well-made", "2026 年", "-", "- ", "1.5 kg of cotton", "2026. Next", "*important*", "3.5"]) {
  check(`"${typed}" is not a list item`, !noteHasList(typed), JSON.stringify(parseReviewNote(typed)));
}

const shaped = "Summary line.\r\n\r\n- First\r\n\r\n- Second\r\n  carries on\r\n\r\nWe look forward to it.";
const blocks = parseReviewNote(shaped);
check("summary, one list, close", blocks.map((block) => block.type).join() === "paragraph,list,paragraph", JSON.stringify(blocks));
check("a blank line keeps one list", blocks[1]?.items?.length === 2);
check("an indented line joins its item", blocks[1]?.items?.[1] === "Second carries on");
check("a note of markers only keeps its words", parseReviewNote("-\n-").flatMap((block) => block.lines ?? block.items).join() === "-,-");

const evil = '<script>alert(1)</script>\n\n- <img src=x onerror="alert(1)"> & more\n1. "quoted"';
const evilHtml = reviewNoteHtml(evil);
check("nothing typed reaches HTML unescaped", !/<script|<img/.test(evilHtml), evilHtml);
check("the ampersand is escaped", evilHtml.includes("&amp; more"));
check("numbers keep their place", reviewNoteHtml("3. third").includes('start="3"'));
check("Chinese is marked as Chinese", reviewNoteHtml("- 营业执照").startsWith('<div lang="zh">'));
check("English is not", !reviewNoteHtml("- licence").includes("lang="));

const note = "Nearly there.\n\n- Registration\n- Website\n\nWe look forward to it.";
const options = { companyName: "A & B Ltd", recipientName: "", locale: "en", loginUrl: "https://tsc.test/app.html", note };
const needs = needsInformationEmail(options);
check("the request has a real list", /<ul[^>]*>.*Registration.*Website.*<\/ul>/s.test(needs.html));
check("the request's text part is exactly as typed", needs.text.includes(note));
check("the request is in the designed frame", needs.html.includes("email-shell") && needs.html.includes("<img"));
check("the company name is escaped", needs.html.includes("A &amp; B Ltd"));

const declined = declinedEmail({ ...options, note: "The name differs.\n\n- Licence" });
check("the decline has the logo and the frame", declined.html.includes("email-shell") && declined.html.includes("<img"));
check("the decline carries its reason", /Reason given.*The name differs.*<ul/s.test(declined.html) && declined.text.includes("The name differs."));
check("the decline's subject", declined.subject === "We could not verify your profile");
const noReason = declinedEmail({ ...options, note: "" });
check("a decline with no reason draws no empty card", !noReason.html.includes("Reason given") && !noReason.text.includes("Reason given"));
check("the decline in Chinese", declinedEmail({ ...options, locale: "zh" }).subject === "你的资料未能通过审核");

const approved = accountApprovedEmail({ ...options, note: "" });
check("an approval with no note has no note box", !approved.html.includes("A note from our team"));

// Test emails: its sample is parsed from the file, so importing it needs no keys.
const testEmails = readFileSync(new URL("../api/send-test-email.js", import.meta.url), "utf8");
for (const locale of ["en", "zh"]) {
  const sample = testEmails.match(new RegExp(`${locale}: "((?:[^"\\\\]|\\\\.)*\\\\n\\\\n- (?:[^"\\\\]|\\\\.)*)"`))?.[1];
  const parsed = sample ? parseReviewNote(JSON.parse(`"${sample}"`)).map((block) => block.type).join() : "";
  check(`Test emails' ${locale} sample is summary, list, close`, parsed === "paragraph,list,paragraph", parsed);
}
check("Test emails sends the sample for a request", /needs_information", locale, name, SAMPLE_REQUEST/.test(testEmails));

const suggest = await import("../api/suggest-review-request.js");
const answer = await suggest.shapeSuggestion("Hello,\n\nNearly there.\n\n1. Licence\n2. Website\n\nWe look forward to it.\n\nWarm regards,\nThe Sourcing Club");
check("a model's greeting and sign-off go, its list stays", answer === "Nearly there.\n\n- Licence\n- Website\n\nWe look forward to it.", answer);
check("a model's paragraph is refused", (await suggest.shapeSuggestion("Please upload your licence and add your website.")) === null);
check("a missing close is filled", (await suggest.shapeSuggestion("- Licence")).endsWith("We look forward to receiving these."));
const summaryKept = await suggest.shapeSuggestion("Hi team, your licence could not be read.\n\n- Licence");
check("a summary that starts with Hi stays", summaryKept.startsWith("Hi team, your licence could not be read."), summaryKept);

if (failures) {
  console.error(`\ncheck:review-email: ${failures} failed`);
  process.exit(1);
}
console.log("check:review-email: ok");
