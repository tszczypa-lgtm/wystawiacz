import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { pathToFileURL, fileURLToPath } from "node:url";

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const root = new URL("../public/wystawiacz-beta/", import.meta.url);
const requests = [];
let aiCalls = 0;
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://fixture").pathname;
  if (path.startsWith("/api/")) {
    requests.push({ path, method: req.method });
    res.setHeader("Content-Type", "application/json");
    if (path === "/api/beta/status") { res.end(JSON.stringify({ allowed: true, aiEnabled: true })); return; }
    if (path === "/api/beta/transcribe") { aiCalls++; res.end(JSON.stringify({ text: "Pompa ABS 1234567 cena 200 zl, regal B3." })); return; }
    if (path === "/api/beta/suggest") { aiCalls++; res.end(JSON.stringify({ proposal: { partName: "Pompa ABS", partNumber: "1234567", side: "lewy przod", conditionNotes: "Pekniety uchwyt, nie sprawdzono dzialania.", pricePLN: "200", location: "B3", warnings: ["Sprawdz numer"] } })); return; }
    if (path === "/api/allegro/health") { res.end(JSON.stringify({ connected: false })); return; }
    res.statusCode = 409; res.end(JSON.stringify({ message: "Fixture: brak polaczenia" })); return;
  }
  try {
    const name = path === "/" ? "index.html" : path.slice(1);
    if (!/^(?:vendor\/)?[a-z0-9.-]+$/i.test(name)) throw Error();
    let body = await readFile(new URL(name, root));
    if (name === "index.html") body = body.toString().replace('<script src="web-auth.js"></script>', '<script>window.getWystawiaczToken=async()=>"fixture";</script>');
    res.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html; charset=utf-8"); res.end(body);
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1050 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    window.confirm = () => true;
    localStorage.setItem("allegroAssistantPhotoFolder", "STABLE-SENTINEL");
    localStorage.setItem("wystawiacz-cloud-autosave", "true");
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => ({ getTracks: () => [{ stop() {} }] }) });
    window.MediaRecorder = class {
      static isTypeSupported() { return true; }
      constructor(_stream, options) { this.mimeType = options?.mimeType || "audio/webm"; this.state = "inactive"; }
      start() { this.state = "recording"; }
      stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["fixture audio"], { type: this.mimeType }) }); setTimeout(() => this.onstop?.(), 0); }
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/#owner=00000000-0000-0000-0000-000000000001`);
  await page.getByText(/Beta gotowa/).waitFor();
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 40; canvas.height = 40;
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    const files = new DataTransfer();
    for (const name of ["a.png", "b.png", "c.png", "d.png"]) files.items.add(new File([blob], name, { type: "image/png", lastModified: 1 }));
    relinkFolderInput.files = files.files; relinkFolderInput.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForFunction(() => state.localPhotosByName.size === 4);
  assert.equal(await page.locator("#betaBatches,#betaNew,#betaCreate").count(), 0, "No second batch list or large creation panel");
  assert.equal(await page.locator(".photos-card .beta-workflow").count(), 1, "Compact comment is below photos");
  await page.evaluate(() => { previewPhotoName = "c.png"; renderPhotos(); });
  await page.locator("#betaManualQR").click();
  await page.locator("#betaSplitAI").click();
  await page.locator("#betaSplitDialog").waitFor({ state: "visible" });
  assert.equal(await page.locator("#betaSplitPreview li").count(), 2);
  await page.locator("#betaConfirmSplit").click();
  assert.equal(await page.evaluate(() => state.products.length), 2);
  assert.equal(await page.locator("#productList .product-card").count(), 2, "Groups use the existing auction list");
  assert.deepEqual(await page.evaluate(() => state.products.map(product => product.photoNames)), [["a.png", "b.png"], ["c.png", "d.png"]]);
  await page.locator("#betaComment").fill("Pierwsza czesc - pompa");
  await page.locator("#betaRecord").click();
  await page.waitForFunction(() => document.querySelector("#betaRecord").getAttribute("aria-pressed") === "true" && !document.querySelector("#betaRecord").disabled);
  await page.locator("#productList .edit-button").nth(1).click();
  assert.equal(await page.evaluate(() => activeProductId), await page.evaluate(() => state.products[0].id), "Cannot switch parts while recording");
  await page.locator("#betaRecord").click();
  await page.getByText(/Nagranie zapisane przy tej aukcji/).waitFor();
  await page.locator("#productList .edit-button").nth(1).click();
  await page.evaluate(() => { togglePhoto("a.png"); });
  assert.deepEqual(await page.evaluate(() => state.selectedPhotoNames), ["c.png", "d.png"], "Photo already assigned to another part cannot be selected accidentally");
  await page.locator("#betaComment").fill("Druga czesc");
  assert.equal(await page.evaluate(() => state.products.length), 2);
  await page.locator("#productList .edit-button").first().click();
  await page.locator("#betaAIDetails").evaluate(details => { details.open = true; });
  assert.equal(await page.locator("#betaComment").inputValue(), "Pierwsza czesc - pompa");
  assert.ok(await page.locator("#betaAudio").isVisible());
  await page.locator("#betaTranscribe").click();
  await page.getByText(/Najpierw zaznacz zgode/).waitFor(); assert.equal(aiCalls, 0);
  await page.locator("#betaConsent").check();
  await page.locator("#betaTranscribe").click();
  await page.getByText(/Przepisano nagranie/).waitFor();
  await page.locator("#betaSuggest").click();
  await page.locator("#betaProposal").waitFor({ state: "visible" });
  assert.equal(await page.locator("#partNumber").inputValue(), "", "AI suggestions do not silently edit fields");
  await page.getByRole("button", { name: "Zastosuj zaznaczone propozycje" }).click();
  assert.equal(await page.locator("#partNumber").inputValue(), "1234567");
  assert.equal(await page.locator("#priceInput").inputValue(), "200");
  assert.ok((await page.locator("#titleInput").inputValue()).includes("Pompa ABS"));
  assert.equal(await page.evaluate(() => state.products[1].betaComment), "Druga czesc");
  assert.equal(await page.evaluate(() => state.products[1].enteredPartNumber), "");
  assert.ok(await page.locator("#publishCurrentButton").isDisabled());
  await page.locator("#addButton").click();
  await page.locator("#productList .edit-button").first().click();
  assert.equal(await page.locator("#betaComment").inputValue(), "Pompa ABS 1234567 cena 200 zl, regal B3.", "Normal save-changes button preserves beta comment metadata");
  assert.ok(await page.locator("#betaAudio").isVisible());
  await page.evaluate(() => applyOwnOffer({ name: "Pompa z mojej oferty", description: { sections: [{ items: [{ type: "TEXT", content: "<p>Opis z oferty</p>" }] }] }, productSet: [], stock: { available: 1 } }, "7654321"));
  assert.equal(await page.evaluate(() => activeProductId), await page.evaluate(() => state.products[0].id), "Copying offer details fills the current beta group instead of detaching it");
  assert.equal(await page.locator("#betaComment").inputValue(), "Pompa ABS 1234567 cena 200 zl, regal B3.");
  assert.deepEqual(await page.evaluate(() => state.products[0].photoNames), ["a.png", "b.png"]);
  await page.evaluate(() => BetaWorkflow.save());
  await page.getByText(/Zapisano bete lokalnie/).waitFor();
  await page.reload(); await page.locator("#betaRestore").waitFor({ state: "visible" });
  assert.equal(await page.evaluate(() => state.products.length), 0, "Old local save is never overwritten by blank startup");
  await page.locator("#betaRestore").click();
  await page.getByText(/Przywrocono bete wraz/).waitFor();
  assert.equal(await page.evaluate(() => state.products.length), 2);
  assert.equal(await page.evaluate(() => state.localPhotosByName.size), 4);
  assert.deepEqual(await page.evaluate(() => BetaSession.snapshot().betaSeparators), ["c.png"], "Manual QR boundaries survive local restore");
  await page.locator("#betaAIDetails").evaluate(details => { details.open = true; });
  assert.ok(await page.locator("#betaAudio").isVisible());
  await page.locator("#productList .edit-button").nth(1).click();
  assert.equal(await page.locator("#betaComment").inputValue(), "Druga czesc");
  assert.ok(await page.locator("#betaAudio").isHidden());
  const blocked = await page.evaluate(async () => {
    const results = [];
    for (const url of ["/api/allegro/product-offers", "/api/allegro/auth/logout", "/api/workspace/session"]) results.push((await fetch(url, { method: "POST", body: "{}" })).status);
    const preferences = await fetch("/api/workspace/preferences", { method: "PUT", body: JSON.stringify({ descriptionTemplate: "beta-only" }) });
    return { results, preferences: preferences.status, stableFolder: localStorage.getItem("allegroAssistantPhotoFolder"), stableAutosave: localStorage.getItem("wystawiacz-cloud-autosave") };
  });
  assert.deepEqual(blocked.results, [403, 403, 403]); assert.equal(blocked.preferences, 200);
  assert.equal(blocked.stableFolder, "STABLE-SENTINEL"); assert.equal(blocked.stableAutosave, "true");
  assert.ok(requests.every(request => request.method === "GET" || request.path.startsWith("/api/beta/")), "No mutations reach stable or Allegro endpoints");
  assert.equal(await page.evaluate(() => BetaSession.snapshot().format), "wystawiacz-beta-session");
  const stableSafety = await readFile(new URL("../public/wystawiacz/session-safety.js", import.meta.url), "utf8");
  const rejected = await page.evaluate(source => {
    const betaValidate = SessionSafety.validate; const payload = BetaSession.snapshot();
    (0, eval)(source);
    let rejected = false; try { SessionSafety.validate(payload); } catch { rejected = true; }
    SessionSafety.validate = betaValidate; return rejected;
  }, stableSafety);
  assert.ok(rejected, "Stable session importer rejects beta session files");
  assert.deepEqual(errors, []);
  await mkdir(new URL("../outputs/beta-preview/", import.meta.url), { recursive: true });
  await page.locator(".beta-workflow").screenshot({ path: fileURLToPath(new URL("../outputs/beta-preview/workflow.png", import.meta.url)) });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Beta workflow does not overflow mobile viewport");
  console.log("Beta browser: real copied editor, photo grouping, per-part comments/audio, recording switch guard, AI review, IndexedDB recovery and stable storage/network isolation passed. Audio/AI mocked.");
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
