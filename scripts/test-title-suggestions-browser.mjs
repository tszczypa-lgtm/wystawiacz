import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const source = await readFile(new URL("../public/wystawiacz/title-suggestions.js", import.meta.url));
const styles = await readFile(new URL("../public/wystawiacz/title-suggestions.css", import.meta.url));
const originalStyles = await readFile(new URL("../public/wystawiacz/styles.css", import.meta.url));
const fullPage = (await readFile(new URL("../public/wystawiacz/index.html", import.meta.url), "utf8")).replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://test.local").pathname;
  if (["/titles.css", "/title-suggestions.css", "/styles.css"].includes(path)) { res.setHeader("Content-Type", "text/css"); res.end(path === "/styles.css" ? originalStyles : styles); return; }
  if (path === "/full.html") { res.setHeader("Content-Type", "text/html"); res.end(fullPage); return; }
  res.setHeader("Content-Type", req.url === "/titles.js" ? "text/javascript" : "text/html");
  res.end(req.url === "/titles.js" ? source : '<link rel="stylesheet" href="/titles.css"><input id="partNumber"><input id="titleModeFull" type="checkbox"><input id="titleModePart" type="checkbox"><p id="titleSuggestionStatus"></p><section class="title-suggestions" style="width:350px;box-sizing:border-box"><div id="titleSuggestionResults"></div></section><script src="/titles.js"></script>');
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
        return { groups: [{ source: "allegro", titles: ["Hak holowniczy", "Wspornik", "Pompa ABS", "Sterownik ABS"].map(name => ({ title: `${name} VW Tiguan allegro ${number}`, url: "https://allegro.pl/listing" })) }] };
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
  assert.deepEqual(await page.locator(".title-add").allTextContents(), ["+", "+"]);
  await page.locator(".title-choice").first().click();
  await page.locator(".title-add").nth(1).click();
  assert.equal(await page.evaluate(() => window.chosen), "Pompa ABS");
  assert.deepEqual(await page.evaluate(() => window.appended), ["Sterownik ABS"]);
  assert.equal(await page.locator("#titleSuggestionStatus").textContent(), "");
  await page.locator("#titleModeFull").check();
  await page.waitForFunction(() => document.querySelector(".title-choice")?.textContent.includes("VW Golf"));
  assert.equal(await page.locator(".title-add").count(), 0, "Plus buttons only appear in the second checkbox mode");
  await page.locator("#titleModePart").check();
  await page.waitForFunction(() => document.querySelectorAll(".title-add").length === 2);
  await page.evaluate(() => { window.product = "two"; });
  await page.locator(".title-add").nth(1).click();
  assert.deepEqual(await page.evaluate(() => window.appended), ["Sterownik ABS"], "Reject stale append after changing products");
  await page.reload();
  await page.evaluate(() => {
    window.chosen = "";
    window.TitleSuggestions.mount({
      getContext: () => ({ number: document.getElementById("partNumber").value, productId: "four-test" }),
      search: async () => ({ groups: [{ source: "allegro", titles: ["Pompa ABS", "Sterownik ABS", "Czujnik ABS", "Wspornik"].map(name => ({ title: `${name} BMW F40 uklad hamulcowy kompletny 5A2EBA9`, url: "https://allegro.pl/listing" })) }] }),
      choose: title => { window.chosen = title; }, append: () => {}
    });
  });
  await page.locator("#partNumber").fill("5A2EBA9");
  await page.waitForFunction(() => document.querySelectorAll(".title-choice").length === 4);
  await page.locator(".title-choice").first().click();
  assert.equal(await page.evaluate(() => window.chosen), "Pompa ABS");
  assert.equal(await page.locator(".title-candidate a").count(), 4);
  await page.locator("#titleModeFull").check();
  await page.waitForFunction(() => document.querySelector(".title-choice")?.textContent.startsWith("Pompa ABS"));
  for (const width of [350, 260, 200]) {
    await page.evaluate(width => { document.querySelector(".title-suggestions").style.width = `${width}px`; }, width);
    const layout = await page.evaluate(() => {
      const row = document.querySelector(".title-candidate");
      const choice = row.querySelector(".title-choice");
      const link = row.querySelector("a");
      return { row: row.getBoundingClientRect().width, title: choice.getBoundingClientRect().width, height: choice.getBoundingClientRect().height, controlsBelow: link.getBoundingClientRect().top >= choice.getBoundingClientRect().bottom, overflow: row.scrollWidth > row.clientWidth + 1 };
    });
    assert.ok(layout.title >= layout.row * 0.98, `Title must stay full width at ${width}px`);
    assert.ok(layout.height < 160, "Title must not become a vertical letter column");
    assert.ok(layout.controlsBelow, "Append button and source links sit below the title");
    assert.equal(layout.overflow, false, "Controls wrap without horizontal overflow");
  }
  assert.deepEqual(errors, []);
  await page.goto(`http://127.0.0.1:${server.address().port}/full.html`);
  await page.addScriptTag({ url: "/titles.js" });
  await page.evaluate(() => {
    localStorage.setItem("wystawiacz-title-mode", "full");
    window.TitleSuggestions.mount({
      getContext: () => ({ number: document.getElementById("partNumber").value, productId: "full-page" }),
      search: async () => ({ groups: [{ source: "allegro", titles: ["VOLKSWAGEN TIGUAN MK2 TOW BAR ELECTRIC WITH HOOK & WIRING 5NA803881F", "Czujnik parktronik PDC VW Golf VII 5NA803881F"].map(title => ({ title, url: "https://allegro.pl/listing" })) }] }),
      choose: title => { window.chosen = title; }, append: () => {}
    });
  });
  await page.locator("#partNumber").fill("5NA803881F");
  await page.waitForFunction(() => document.querySelector(".title-choice"));
  for (const width of [1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => {
      const row = document.querySelector(".title-candidate");
      const title = row.querySelector(".title-choice");
      return { row: row.getBoundingClientRect().width, title: title.getBoundingClientRect().width, height: title.getBoundingClientRect().height, overflow: row.scrollWidth > row.clientWidth + 1 };
    });
    assert.ok(layout.title >= layout.row * 0.98, `Full form title width at viewport ${width}: ${JSON.stringify(layout)}`);
    assert.ok(layout.height < 160, `Full form title height at viewport ${width}: ${JSON.stringify(layout)}`);
    assert.equal(layout.overflow, false);
  }
  await page.locator("#titleModePart").check();
  await page.waitForFunction(() => document.querySelector(".title-choice")?.textContent === "Czujnik parktronik PDC");
  await page.locator(".title-choice").click();
  assert.equal(await page.evaluate(() => window.chosen), "Czujnik parktronik PDC", "Keep descriptive name without the catalog vehicle");
  console.log("Browser: four Allegro suggestions, modes, append, full-form layout, complete suffix, stale-offer protection and caching passed.");
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
