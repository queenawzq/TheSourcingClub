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
check("the request has one introduction: the note's", !/We've reviewed|What we need from you/.test(needs.html + needs.text), needs.text);
check("the request still says which company", needs.text.includes("About A & B Ltd") && /About A &amp; B Ltd/.test(needs.html));
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
const ITEMS = ["Upload your licence (Verification)."];
const answer = await suggest.shapeSuggestion("Hello,\n\nNearly there.\n\n1. A list it was told not to write\n\nWe look forward to it.\n\nWarm regards,\nThe Sourcing Club", ITEMS);
check("the list is ours; the greeting, its list and the sign-off go", answer === "Nearly there.\n\n- Upload your licence (Verification).\n\nWe look forward to it.", answer);
check("a missing summary and close are filled", (await suggest.shapeSuggestion("- Licence", ITEMS)) === "We need a few more details to finish reviewing your profile.\n\n- Upload your licence (Verification).\n\nWe look forward to receiving these.");
const summaryKept = await suggest.shapeSuggestion("Hi team, your licence could not be read.\n\nThanks for this.", ITEMS);
check("a summary that starts with Hi stays", summaryKept.startsWith("Hi team, your licence could not be read."), summaryKept);

// F15: a company under review sees only its onboarding steps, so nothing else may be asked.
const asked = (label, result, detail, type = "Factory") => suggest.requestItem({ label, result, detail }, type);
for (const [why, item] of [
  ["a member address on the domain", asked("Contact domain", "Review", "No member address uses acme.com.")],
  ["a public-provider address", asked("Contact domain", "Review", "Every member address uses a public email provider, so nothing corroborates acme.com.")],
  ["no address on file", asked("Contact domain", "Missing", "No member email address is on file, so a decision cannot be sent.")],
  ["a registration waiting for staff", asked("Business registration", "Review", "Uploaded 06 Nov 2026. Not yet reviewed. Contents are not checked against any registry.")],
  ["terms already signed", asked("Terms accepted", "Clear", "Signed")],
  ["certificates all on file", asked("Certification evidence", "Review", "2 claimed, 2 with a document, 0 already verified.")],
  ["a check nobody mapped", asked("A new check", "Missing", "Something")],
]) check(`the company is not asked about ${why}`, item === null, item);
check("a missing website is asked for", /website.*Factory details/.test(asked("Contact domain", "Missing", "No website was given, so member addresses cannot be compared against one.")));
check("a brand is sent to its own sections", /Trust/.test(asked("Business registration", "Missing", "", "Brand")));
check("a trading company has no walkthrough section", !/walkthrough/i.test(asked("Production evidence", "Missing", "0 files", "Trading company")));
check("missing fields are named", /Fill in your website, MOQ/.test(asked("Company details", "Review", "Not filled in: website, MOQ.")));
check("one missing field reads as one", asked("Company details", "Review", "Not filled in: website.") === 'Fill in your website: your profile marks it "Not added yet".', asked("Company details", "Review", "Not filled in: website."));
check("several missing fields read as several", /marks each one/.test(asked("Company details", "Review", "Not filled in: MOQ, website. Onboarding was never submitted.")));

// The re-test on the preview: the website was asked for twice, from two checks.
const NO_WEBSITE = { label: "Contact domain", result: "Missing", detail: "No website was given, so member addresses cannot be compared against one." };
const companyGap = (fields) => ({ label: "Company details", result: "Review", detail: `Not filled in: ${fields}.` });
const DUPLICATE = { label: "Duplicate company signal", result: "Review", detail: "Shares a legal name or website domain with at least one other company on the platform." };
const twice = suggest.requestItems([companyGap("website"), NO_WEBSITE], "Factory");
check("a missing website is one bullet", twice.items.length === 1 && twice.items[0].includes("website"), twice.items);
check("the merged check is not reported as not asked", twice.notAsked.length === 0, twice.notAsked);
const order = suggest.requestItems([NO_WEBSITE, companyGap("MOQ, website")], "Factory");
check("it is one bullet in either order, the other fields kept", order.items.length === 1 && /MOQ, website/.test(order.items[0]), order.items);
const alone = suggest.requestItems([NO_WEBSITE], "Factory");
check("the website is still asked for when only Contact domain says so", alone.items.length === 1 && /website/.test(alone.items[0]), alone.items);
const other = suggest.requestItems([companyGap("MOQ"), NO_WEBSITE], "Factory");
check("a website no field names keeps its own bullet", other.items.length === 2, other.items);
const checked = suggest.requestItems([companyGap("website"), DUPLICATE], "Factory");
check("the website is not asked for again by the duplicate check", checked.items.filter((item) => /website/.test(item)).length === 1 && checked.items.some((item) => /legal company name is correct/.test(item)), checked.items);
const full = suggest.requestItems([DUPLICATE], "Factory");
check("the duplicate check names both when both are filled in", /legal company name and website are correct/.test(full.items[0] ?? ""), full.items);
const notTheirs = suggest.requestItems([{ label: "Contact domain", result: "Review", detail: "No member address uses acme.com." }], "Factory");
check("what the company cannot do is still reported as not asked", notTheirs.notAsked.join() === "Contact domain" && !notTheirs.items.length, notTheirs);

const invented = await suggest.shapeSuggestion("We also need a team member email address on the acme.com domain.\n\nWe look forward to it.", ITEMS);
check("a sentence asking for what the company cannot do goes", !/team member/.test(invented), invented);

if (failures) {
  console.error(`\ncheck:review-email: ${failures} failed`);
  process.exit(1);
}
console.log("check:review-email: ok");
