import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const source = await readFile(new URL("../public/wystawiacz/title-suggestions.js", import.meta.url));
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/titles.js" ? "text/javascript" : "text/html");
  res.end(req.url === "/titles.js" ? source : '<input id="partNumber"><input id="titleModeFull" type="checkbox"><input id="titleModePart" type="checkbox"><p id="titleSuggestionStatus"></p><div id="titleSuggestionResults"></div><script src="/titles.js"></script>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(() => {
    window.calls = [];
    window.chosen = "";
    window.product = "one";
    window.controller = window.TitleSuggestions.mount({
      getContext: () => ({ number: document.getElementById("partNumber").value, productId: window.product }),
      search: async number => {
        window.calls.push(number);
        await new Promise(resolve => setTimeout(resolve, 200));
        return { groups: ["allegro", "google"].map(source => ({ source, titles: [1, 2].map(i => ({ title: `${i === 1 ? "Hak holowniczy" : "Wspornik"} VW Tiguan ${source} ${number}`, url: "https://example.test/part" })) })) };
      },
      choose: title => { window.chosen = title; }
    });
  });
  await page.locator("#partNumber").fill("5NA803881F");
  await page.waitForTimeout(1700);
  assert.deepEqual(await page.evaluate(() => window.calls), [], "Disabled mode must not call either source");
  await page.locator("#titleModeFull").check();
  await page.waitForFunction(() => document.querySelectorAll(".title-candidate button").length === 4);
  assert.deepEqual(await page.evaluate(() => window.calls), ["5NA803881F"]);
  assert.equal(await page.evaluate(() => window.chosen), "", "Never select a title automatically");
  await page.locator(".title-candidate button").first().click();
  assert.equal(await page.evaluate(() => window.chosen), "Hak holowniczy VW Tiguan allegro 5NA803881F");
  await page.evaluate(() => { window.product = "two"; window.chosen = ""; });
  await page.locator(".title-candidate button").first().click();
  assert.equal(await page.evaluate(() => window.chosen), "", "Reject a stale title after changing offers");
  await page.waitForFunction(() => document.querySelectorAll(".title-candidate button").length === 4);
  assert.equal(await page.evaluate(() => window.calls.length), 1, "Same number uses cached suggestions");
  await page.locator("#partNumber").fill("5NA803881B");
  assert.equal(await page.locator(".title-candidate button").count(), 0);
  await page.waitForFunction(() => document.querySelectorAll(".title-candidate button").length === 4);
  assert.ok((await page.locator(".title-candidate button").allTextContents()).every(title => title.endsWith("5NA803881B")));
  const calls = await page.evaluate(() => window.calls.length);
  await page.locator("#titleModePart").check();
  assert.equal(await page.locator("#titleModeFull").isChecked(), false);
  await page.waitForFunction(() => document.querySelector(".title-candidate button")?.textContent === "Hak holowniczy");
  await page.locator(".title-candidate button").first().click();
  assert.equal(await page.evaluate(() => window.chosen), "Hak holowniczy", "Part mode contains no car model or OEM number");
  assert.equal(await page.evaluate(() => window.calls.length), calls, "Changing modes reuses source results");
  assert.equal(await page.evaluate(() => localStorage.getItem("wystawiacz-title-mode")), "part");
  await page.locator("#titleModePart").uncheck();
  assert.equal(await page.locator(".title-candidate button").count(), 0);
  await page.locator("#partNumber").fill("5NA803881C");
  await page.waitForTimeout(1700);
  assert.equal(await page.evaluate(() => window.calls.length), calls);
  await page.reload();
  await page.evaluate(() => {
    window.chosen = "";
    window.appended = [];
    window.product = "one";
    window.TitleSuggestions.mount({
      getContext: () => ({ number: document.getElementById("partNumber").value, productId: window.product }),
      search: async () => ({ groups: [{ source: "allegro", titles: ["Pompa ABS VW Golf", "Sterownik ABS VW Golf"].map(title => ({ title, url: "https://example.test/part" })) }] }),
      choose: title => { window.chosen = title; },
      append: name => window.appended.push(name)
    });
  });
  await page.locator("#titleModePart").check();
  await page.locator("#partNumber").fill("5NA803881F");
  await page.waitForFunction(() => document.querySelectorAll(".title-add").length === 2);
  await page.locator(".title-choice").first().click();
  await page.locator(".title-add").nth(1).click();
  assert.equal(await page.evaluate(() => window.chosen), "Pompa ABS");
  assert.deepEqual(await page.evaluate(() => window.appended), ["Sterownik ABS"]);
  await page.evaluate(() => { window.product = "two"; });
  await page.locator(".title-add").nth(1).click();
  assert.deepEqual(await page.evaluate(() => window.appended), ["Sterownik ABS"], "Reject stale append after changing products");
  await page.reload();
  await page.evaluate(() => {
    window.chosen = "";
    window.TitleSuggestions.mount({
      getContext: () => ({ number: document.getElementById("partNumber").value, productId: "ai-test" }),
      search: async () => ({ groups: [{ source: "ai", titles: [{ title: "Zespol hydrauliczny BMW F40 5A2EBA9", partName: "Zespol hydrauliczny", url: "https://parts.test/one", sources: ["https://parts.test/one", "https://other.test/two"], note: "<img src=x onerror=alert(1)> Sprawdz zestaw." }] }] }),
      choose: title => { window.chosen = title; }
    });
  });
  await page.locator("#partNumber").fill("5A2EBA9");
  await page.waitForFunction(() => document.querySelector(".title-choice")?.textContent === "Zespol hydrauliczny");
  await page.locator(".title-choice").click();
  assert.equal(await page.evaluate(() => window.chosen), "Zespol hydrauliczny", "Use explicit AI part name, not dictionary truncation");
  assert.equal(await page.locator(".title-candidate a").count(), 2);
  assert.equal(await page.locator(".title-source img").count(), 0, "AI explanations render only as text");
  assert.deepEqual(errors, []);
  console.log("Browser: automatic 2+2 suggestions, click selection, complete suffix, stale-offer protection and caching passed.");
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
