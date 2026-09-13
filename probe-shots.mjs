import { Stagehand, localBrowser } from "@browserbasehq/stagehand";
const B = "http://127.0.0.1:5173";
const OUT = "/tmp/claude-501/-Users-johnmaheswaran-code-TheSourcingClub/4d770465-5f7d-4377-b2b5-11cbfdfb78f2/scratchpad";
const browser = await localBrowser.launch({ headless: true });
const sh = await Stagehand.create({ browser });
for (const [file, url] of [
  ["designed-brand-onboarding.png", `${B}/prototype.html?view=brand-onboarding`],
  ["designed-factory-onboarding.png", `${B}/factory-prototype.html?onboarding=1`],
]) {
  const page = await sh.browser.context.newPage(url);
  await page.setViewportSize(1440, 1000);
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${OUT}/${file}` });
  console.log(file, "->", (await page.locator("h1,h2").first().innerText().catch(() => "?")).slice(0, 70));
}
await sh.close();
await browser.close().catch(() => {});
