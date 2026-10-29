import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const source = await readFile(new URL("../public/wystawiacz/app.js", import.meta.url), "utf8");
const ast = ts.createSourceFile("app.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = ast.statements.filter(ts.isFunctionDeclaration)
  .filter(fn => ["renderProducts", "removeProduct", "escapeHtml", "updateProductNavigation"].includes(fn.name.text))
  .map(fn => fn.getText(ast)).join("\n");
const cloud = await readFile(new URL("../public/wystawiacz/cloud-sessions.js", import.meta.url), "utf8");
assert.match(cloud, /addEventListener\("wystawiacz-session-change", scheduleAutosave\)/);
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 650 } });
  const errors = [], requests = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => requests.push(request.url()));
  await page.setContent('<div id="emptyState">Lista pusta</div><div id="productList"></div><button id="previousProductButton"></button><button id="nextProductButton"></button><span id="activeProductLabel"></span>');
  await page.addStyleTag({ content: await readFile(new URL("../public/wystawiacz/styles.css", import.meta.url), "utf8") });
  await page.addScriptTag({ content: `
    const state = { products: [], localPhotosByName: new Map([['photo.jpg', { file: 'original' }]]) };
    const publishingProducts = new Set(), selectedProductIds = new Set();
    let batchPublishing = false, activeProductId = '';
    const productList = document.querySelector('#productList'), emptyState = document.querySelector('#emptyState');
    const previousProductButton = document.querySelector('#previousProductButton'), nextProductButton = document.querySelector('#nextProductButton'), activeProductLabel = document.querySelector('#activeProductLabel');
    window.resetCalls = 0; window.editCalls = 0; window.changes = 0;
    document.addEventListener('wystawiacz-session-change', () => window.changes++);
    function renderBatchToolbar() {}
    function findPhotoUrl() { return ''; }
    function showToast() {}
    function publishProduct() { throw Error('Removal must not publish'); }
    function editProduct() { window.editCalls++; }
    function resetForm() { window.resetCalls++; activeProductId = ''; }
    ${functions}
  ` });
  const seed = () => page.evaluate(() => {
    state.products = [
      { id: 'draft', title: 'Pompa <ABS>', enteredPartNumber: '123', stock: 1, price: '', photoNames: ['photo.jpg'] },
      { id: 'published', title: 'Lampa', enteredPartNumber: '456', stock: 1, price: '100', allegroOfferId: 'offer-123', photoNames: ['photo.jpg'] },
    ];
    activeProductId = 'draft'; selectedProductIds.add('draft'); renderProducts();
  });
  await seed();
  assert.equal(await page.locator('.remove-product-button').count(), 2);
  assert.equal(await page.locator('.remove-product-button').first().evaluate(button => getComputedStyle(button).fontSize), '11px');
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('[data-remove-product-id="draft"]').click();
  assert.equal(await page.locator('.product-card').count(), 2);
  assert.equal(await page.evaluate(() => window.editCalls), 0);

  page.once('dialog', async dialog => { assert.match(dialog.message(), /nie usuwa ani nie kończy aukcji na Allegro/); await dialog.accept(); });
  await page.locator('[data-remove-product-id="draft"]').click();
  assert.equal(await page.locator('.product-card').count(), 1);
  assert.deepEqual(await page.evaluate(() => ({ active: activeProductId, selected: selectedProductIds.has('draft'), reset: resetCalls, changes, photo: state.localPhotosByName.has('photo.jpg') })), { active: '', selected: false, reset: 1, changes: 1, photo: true });
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-remove-product-id="published"]').click();
  assert.equal(await page.locator('.product-card').count(), 0);
  assert.ok(await page.locator('#emptyState').isVisible());
  assert.ok(await page.locator('#nextProductButton').isDisabled());
  assert.equal(await page.evaluate(() => window.resetCalls), 1);

  await seed();
  await page.evaluate(() => { batchPublishing = true; renderProducts(); });
  assert.ok(await page.locator('[data-remove-product-id="draft"]').isDisabled());
  assert.equal(await page.evaluate(() => removeProduct('draft')), false);
  await page.evaluate(() => { batchPublishing = false; publishingProducts.add('draft'); renderProducts(); });
  assert.ok(await page.locator('[data-remove-product-id="draft"]').isDisabled());
  assert.equal(await page.evaluate(() => removeProduct('draft')), false);
  assert.equal(await page.evaluate(() => removeProduct('missing')), false);
  await page.evaluate(() => { publishingProducts.clear(); activeProductId = 'published'; renderProducts(); });
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-remove-product-id="draft"]').click();
  assert.equal(await page.evaluate(() => activeProductId), 'published');
  assert.equal(await page.evaluate(() => window.resetCalls), 1);
  assert.equal(await page.evaluate(() => window.editCalls), 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, [], 'No request to Allegro or any server on removal');
  console.log('Remove products: compact buttons, cancel/confirm, draft and published rows, active form/selection cleanup, shared photos, publish locks, autosave notification and no Allegro requests passed in Chrome.');
} finally { await browser.close(); }
