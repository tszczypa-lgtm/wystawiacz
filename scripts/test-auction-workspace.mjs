import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { pathToFileURL, fileURLToPath } from "node:url";
import ts from "typescript";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const read = file => readFile(new URL("../public/wystawiacz/" + file, import.meta.url), "utf8");
const html = (await read("index.html")).replace(/<script[\s\S]*?<\/script>/g, "").replace(/<link[^>]+>/g, "");
const app = await read("app.js");
const ast = ts.createSourceFile("app.js", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = ast.statements.filter(ts.isFunctionDeclaration).filter(fn => ["renderProducts", "escapeHtml", "updateProductNavigation"].includes(fn.name.text)).map(fn => fn.getText(ast)).join("\n");
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://workspace.test/**", route => route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("https://workspace.test/");
  for (const file of ["styles.css", "workspace-layout.css"]) await page.addStyleTag({ content: await read(file) });
  await page.addScriptTag({ content: `
    const state = { products: [], localPhotosByName: new Map() };
    const publishingProducts = new Set(), selectedProductIds = new Set();
    let batchPublishing = false, activeProductId = '';
    const productList = document.querySelector('#productList'), emptyState = document.querySelector('#emptyState');
    const previousProductButton = document.querySelector('#previousProductButton'), nextProductButton = document.querySelector('#nextProductButton'), activeProductLabel = document.querySelector('#activeProductLabel');
    function renderBatchToolbar() {}
    function findPhotoUrl() { return ''; }
    function publishProduct() { throw Error('Must not publish'); }
    function removeProduct() {}
    function editProduct() {}
    function resetVehicleEditor() {}
    function showToast() {}
    ${functions}
    window.opened = []; window.open = (...args) => { opened.push(args); return {}; };
    window.reads = [];
  ` });
  for (const file of ["own-offers.js", "price-search.js", "workspace-layout.js"]) await page.addScriptTag({ content: await read(file) });
  await page.evaluate(() => {
    document.querySelector("#summaryCard").classList.remove("hidden");
    window.pricing = OwnOffers.mount({
      numberInput: document.querySelector("#partNumber"), connected: () => true,
      request: async path => {
        reads.push(path);
        return { offers: [
          { id: "123", name: "Pompa ABS 1234567", sellingMode: { price: { amount: "150.50", currency: "PLN" } } },
          { id: "456", name: "Pompa 1234567", sellingMode: { price: { amount: "175", currency: "PLN" } } },
          { id: "789", name: "Pompa 1234567A", sellingMode: { price: { amount: "10", currency: "PLN" } } },
        ] };
      }, apply() { throw Error("Must not copy without click"); }, notify() {}
    });
    PriceSearch.mount({ number: () => document.querySelector("#partNumber").value, title: () => "Pompa ABS", notify() {} });
    state.products = Array.from({ length: 12 }, (_, i) => ({ id: String(i), title: "Pompa ABS " + (i + 1), enteredPartNumber: "1234567", stock: 1, price: "150", photoNames: [] }));
    renderProducts();
  });
  await page.waitForFunction(() => document.querySelector("#productCount").textContent === "12");
  assert.equal(await page.locator(".product-number").first().textContent(), "#1");
  assert.equal(await page.locator(".product-number").last().textContent(), "#12");
  const heights = await page.locator("#productList").evaluate(list => {
    const cards = [...list.children];
    return { scroll: list.scrollHeight, client: list.clientHeight, ten: cards[9].offsetTop + cards[9].offsetHeight - cards[0].offsetTop };
  });
  assert.ok(heights.scroll > heights.client);
  assert.ok(Math.abs(heights.client - heights.ten) < 12);
  await page.locator('[data-list-layout="left"]').click();
  assert.equal(await page.locator(".list-section").evaluate(el => getComputedStyle(el).position), "fixed");
  assert.equal(await page.evaluate(() => localStorage.getItem("wystawiacz-list-layout")), "left");
  await page.locator('[data-list-layout="bottom"]').click();
  await page.locator("#partNumber").fill("1234567");
  await page.waitForFunction(() => document.querySelectorAll(".own-price-choice").length === 2);
  assert.match(await page.locator(".own-price-list").textContent(), /150,50/);
  assert.equal(await page.locator(".price-quote").count(), 0);
  assert.equal(await page.locator(".search-actions input").count(), 0);
  await page.getByRole("group", { name: "Allegro: Kolejnosc cen", exact: true }).getByText("Od najwyzszej").click();
  await page.getByRole("group", { name: "Allegro: Szukaj", exact: true }).getByText("Po numerze").click();
  let opened = await page.evaluate(() => opened);
  assert.equal(new URL(opened.at(-1)[0]).searchParams.get("order"), "pd");
  assert.equal(new URL(opened.at(-1)[0]).searchParams.get("string"), "1234567");
  await page.getByRole("group", { name: "OLX: Kolejnosc cen", exact: true }).getByText("Od najnizszej").click();
  await page.getByRole("group", { name: "OLX: Szukaj", exact: true }).getByText("Po tytule").click();
  opened = await page.evaluate(() => opened);
  assert.equal(new URL(opened.at(-1)[0]).searchParams.get("search[order]"), "filter_float_price:asc");
  await page.getByRole("button", { name: "Edytuj ceny wystawionych", exact: true }).click();
  assert.equal(await page.locator(".own-price-dialog[open] a").count(), 2);
  assert.match(await page.locator(".own-price-dialog a").first().getAttribute("href"), /^https:\/\/allegro.pl\/offer\/123\/edit$/);
  await page.locator(".own-price-dialog button").click();
  await page.locator(".own-price-choice input").last().uncheck();
  await page.getByRole("button", { name: "Edytuj ceny wystawionych", exact: true }).click();
  opened = await page.evaluate(() => opened);
  assert.equal(opened.at(-1)[0], "https://allegro.pl/offer/123/edit");
  assert.equal(await page.locator("#priceInput").inputValue(), "");
  assert.ok((await page.evaluate(() => reads)).every(path => path.startsWith("/api/own-offers?number=")));
  await page.locator("#partNumber").fill("7654321");
  assert.equal(await page.locator(".own-price-choice").count(), 0);
  assert.ok(await page.getByRole("button", { name: "Edytuj ceny wystawionych", exact: true }).isDisabled());
  await page.locator("#partNumber").fill("1234567");
  await page.waitForFunction(() => document.querySelectorAll(".own-price-choice").length === 2);
  await mkdir(new URL("../outputs/workspace-preview/", import.meta.url), { recursive: true });
  await page.locator(".search-actions").screenshot({ path: fileURLToPath(new URL("../outputs/workspace-preview/search.png", import.meta.url)) });
  await page.locator('[data-list-layout="left"]').click();
  await page.locator(".list-section").screenshot({ path: fileURLToPath(new URL("../outputs/workspace-preview/list-left.png", import.meta.url)) });
  await page.setViewportSize({ width: 700, height: 900 });
  assert.notEqual(await page.locator(".list-section").evaluate(el => getComputedStyle(el).position), "fixed");
  assert.deepEqual(errors, []);
  console.log("Auction workspace: ten-row scroll, numbering, saved left/bottom layout, search buttons, own exact-number prices and external-only edit links passed. Mocked own-offer reads; no live Allegro writes.");
} finally { await browser.close(); }
