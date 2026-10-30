import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { pathToFileURL, fileURLToPath } from "node:url";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const root = new URL("../public/wystawiacz/", import.meta.url);
let saved, conflict = false, writes = 0, savedTemplate = null, preferenceFailure = false;
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://test.local").pathname;
  if (path.startsWith("/api/")) {
    res.setHeader("Content-Type", "application/json");
    let data = { connected: false, build: "2026-06-02.35", categories: [], parameters: [] };
    if (path === "/api/workspace/preferences") {
      if (preferenceFailure) { res.statusCode = 503; res.end(JSON.stringify({ message: "Testowy blad zapisu" })); return; }
      if (req.method === "PUT") { let raw = ""; for await (const chunk of req) raw += chunk; savedTemplate = JSON.parse(raw).descriptionTemplate; }
      data = { descriptionTemplate: savedTemplate };
    }
    if (path === "/api/workspace/session" && req.method === "PUT") {
      let raw = ""; for await (const chunk of req) raw += chunk;
      writes++;
      if (conflict) { res.statusCode = 409; data = { conflict: true }; }
      else { saved = JSON.parse(raw); data = { revision: saved.revision + 1 }; }
    }
    if (path === "/api/workspace/sessions") data = { sessions: saved ? [{ id: saved.id, name: saved.payload.name, updated_at: new Date().toISOString() }] : [] };
    if (path === "/api/workspace/price-comparison") {
      const number = new URL(req.url, "http://test.local").searchParams.get("number");
      data = { number, results: [{ source: "Otomoto", status: "ok", checkedAt: new Date().toISOString(), count: 3, message: "Min. z pobranych ofert", lowest: { title: `Pompa ${number}`, url: "https://www.otomoto.pl/czesci/oferta/test-ID123.html", amount: 42.5, currency: "PLN" } }, { source: "OLX", status: "blocked", message: "Serwis blokuje automatyczny odczyt." }] };
    }
    if (path === "/api/allegro/shipping-rates") data = { shippingRates: [
      { id: "own-small", name: "Maly", features: { managedByAllegro: false, isFulfillment: false } }, { id: "own-large", name: "Duzy" },
      { id: "fulfillment", name: "One Fulfillment", features: { isFulfillment: true } }, { id: "managed", name: "Gotowy Allegro", features: { managedByAllegro: true } },
    ] };
    if (path === "/api/workspace/session" && req.method === "GET") data = { payload: saved.payload, revision: saved.revision + 1 };
    if (path === "/api/allegro/own-offers") data = { offers: [{ id: "123456789", name: "Pompa ABS BMW F40 1234567" }, { id: "987654321", name: "Pompa ABS BMW F40 1234567A" }] };
    if (path === "/api/allegro/own-offers/123456789") data = { id: "123456789", name: "Pompa ABS BMW F40 1234567", category: { id: "123" }, stock: { available: 2, unit: "PAIR" }, sellingMode: { price: { amount: "500.00" } }, delivery: { shippingRates: { id: "shipping" } }, afterSalesServices: { returnPolicy: { id: "return" }, impliedWarranty: { id: "claim" } }, description: { sections: [{ items: [{ type: "TEXT", content: "<p>Moj opis</p>" }] }] }, productSet: [{ product: { parameters: [] }, marketedBeforeGPSRObligation: true }] };
    res.end(JSON.stringify(data)); return;
  }
  try {
    const name = path === "/" ? "index.html" : path.slice(1);
    if (!/^[a-z0-9.-]+$/i.test(name)) throw Error();
    let body = await readFile(new URL(name, root));
    if (name === "index.html") body = body.toString().replace('<script src="web-auth.js"></script>', '<script>window.getWystawiaczToken=async()=>"test";</script>');
    res.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html; charset=utf-8"); res.end(body);
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(() => {
    window.opened = []; window.open = (...args) => { window.opened.push(args); return null; }; window.confirm = () => true;
    const malicious = { format: "wystawiacz-allegro-session", products: [{ id: "bad", title: "test", stock: '<img src=x onerror="window.hacked=1">', photoNames: [] }] };
    try { SessionSafety.validate(malicious); throw Error("Unsafe import accepted"); } catch (error) { if (error.message === "Unsafe import accepted") throw error; }
    state.products = [{ id: "bad", title: "test", stock: '<img src=x onerror="window.hacked=1">', image: 'x" onerror="window.hacked=1', photoNames: [] }];
    renderProducts();
  });
  assert.equal(await page.locator("#productList img").count(), 0);
  assert.equal(await page.evaluate(() => window.hacked), undefined);
  await page.evaluate(() => {
    state.products = [1, 2, 3].map(n => ({ id: crypto.randomUUID(), title: `Produkt ${n}`, stock: 1, photoNames: [], allegroOfferId: n === 3 ? "123456789" : null })); renderProducts();
    window.published = []; window.inFlight = 0; window.maxFlight = 0;
    publishProduct = async id => {
      window.inFlight++; window.maxFlight = Math.max(window.maxFlight, window.inFlight);
      await new Promise(resolve => setTimeout(resolve, 30));
      window.published.push(id); state.products.find(p => p.id === id).allegroOfferId = "123456789"; window.inFlight--;
    };
  });
  await page.locator("#selectReadyProducts").click();
  assert.equal(await page.locator("[data-select-product-id]:checked").count(), 2);
  await page.locator("#publishSelectedProducts").click();
  await page.waitForFunction(() => !batchPublishing && window.published.length === 2);
  assert.equal(await page.evaluate(() => window.maxFlight), 1);
  await page.locator(".edit-button").first().click();
  assert.match(await page.evaluate(() => window.opened.at(-1)[0]), /offer\/123456789\/edit$/);
  assert.equal(await page.evaluate(() => activeProductId), "");
  await page.evaluate(() => { state.products = []; resetForm(); state.vehicles = [{ id: "a", manufacturer: "BMW", short: "BMW F40", full: "BMW F40\n2019\n2.0 diesel" }, { id: "b", manufacturer: "Volkswagen", short: "VW Golf", full: "VW Golf\n2020\n1.6 TDI" }]; renderVehicles(); });
  await page.locator("#titleInput").fill("Pompa ABS");
  await page.evaluate(() => { state.requiredParameters = [{ id: "side", name: "Strona zabudowy", type: "dictionary", dictionary: [{ id: "LF", value: "Lewy przód" }, { id: "RR", value: "Prawy tył" }] }]; renderRequiredParameters(); });
  await page.locator("#titleSideButtons button").filter({ hasText: /^lewy przód$/ }).click();
  assert.equal(await page.locator("#titleInput").inputValue(), "Pompa ABS lewy przód");
  assert.equal(await page.evaluate(() => titleInput.value.slice(titleInput.selectionStart, titleInput.selectionEnd)), "lewy przód");
  assert.equal(await page.evaluate(() => detectInstallationSideFromTitle().label), "Przód lewa");
  assert.equal(await page.evaluate(() => state.parameterValues.side), "LF");
  await page.locator("#titleSideButtons button").filter({ hasText: /^prawy tył$/ }).click();
  assert.equal(await page.locator("#titleInput").inputValue(), "Pompa ABS prawy tył");
  assert.equal(await page.evaluate(() => detectInstallationSideFromTitle().label), "Tył prawa");
  assert.equal(await page.evaluate(() => state.parameterValues.side), "RR");
  await page.locator("#titleUppercase").check();
  await page.locator("#titleSideButtons button").filter({ hasText: /^lewy tył$/ }).click();
  assert.equal(await page.evaluate(() => titleInput.value.slice(titleInput.selectionStart, titleInput.selectionEnd)), "LEWY TYŁ");
  await page.locator("#titleUppercase").uncheck();
  await page.locator("#partNumber").fill("1234567");
  await page.locator("#titleSideButtons button").filter({ hasText: /^prawy przód$/ }).click();
  assert.equal(await page.locator("#titleInput").inputValue(), "POMPA ABS prawy przód 1234567", "Changing the side after editing another field replaces the old side and keeps the part number intact");
  await page.locator("#partNumber").fill("");
  await page.evaluate(() => { state.requiredParameters = []; });
  await page.locator("#titleInput").fill("Pompa ABS");
  const side = name => page.locator("#titleSideButtons button").filter({ hasText: new RegExp(`^${name}$`) });
  const frontBox = await side("przód").boundingBox(), rearBox = await side("tył").boundingBox(), leftBox = await side("lewy").boundingBox(), rightBox = await side("prawy").boundingBox();
  assert.ok(frontBox.y < leftBox.y && leftBox.y < rearBox.y);
  assert.ok(leftBox.x < frontBox.x && frontBox.x < rightBox.x);
  assert.ok((await side("lewy przód").boundingBox()).x < frontBox.x);
  await page.evaluate(() => loadShippingRates());
  assert.equal(await page.locator("#shippingRateInput").isVisible(), false);
  assert.equal(await page.locator('[data-shipping-group="own"] [data-shipping-rate-id]').count(), 2);
  assert.equal(await page.locator('[data-shipping-group="allegro"] [data-shipping-rate-id]').count(), 2);
  assert.ok((await page.locator('[data-shipping-group="own"]').boundingBox()).x < (await page.locator('[data-shipping-group="allegro"]').boundingBox()).x);
  const shippingBox = await page.locator('.shipping-field').boundingBox();
  assert.ok(shippingBox.width > 500, "Both shipping groups use the available desktop width");
  assert.ok((await page.locator('[data-shipping-group="own"]').boundingBox()).width > shippingBox.width * .4);
  await page.locator('[data-shipping-rate-id="fulfillment"]').click();
  assert.equal(await page.locator("#shippingRateInput").inputValue(), "fulfillment");
  await page.locator('[data-shipping-rate-id="own-large"]').click();
  assert.equal(await page.locator("#shippingRateInput").inputValue(), "own-large");
  assert.equal(await page.locator('[data-shipping-rate-id="own-large"]').getAttribute("aria-pressed"), "true");
  await page.locator('[data-use-vehicle-id="a"]').click();
  assert.equal(await page.locator("#descriptionTextInput").isVisible(), false);
  assert.equal(await page.locator("#descriptionPreviewTitle").count(), 0);
  await page.locator("#descriptionVisualEditor").click();
  await page.locator("#descriptionVisualEditor").focus();
  await page.evaluate(() => { const e = document.querySelector("#descriptionVisualEditor"), range = document.createRange(); range.selectNodeContents(e); range.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(range); });
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("Moje uwagi bez zmian");
  assert.ok((await page.locator("#descriptionTextInput").inputValue()).includes("Moje uwagi bez zmian"));
  await page.locator('[data-use-vehicle-id="b"]').click();
  const changed = await page.locator("#descriptionVisualEditor").innerText();
  assert.ok(changed.includes("VW Golf\n2020\n1.6 TDI")); assert.ok(changed.includes("Moje uwagi bez zmian")); assert.ok(!changed.includes("2019"));
  await page.locator("#descriptionVisualEditor").fill("Pompa ABS");
  await page.keyboard.press("Control+a");
  await page.getByRole("button", { name: "Pogrubienie", exact: true }).click();
  assert.equal(await page.locator(".formatted-description b").textContent(), "Pompa ABS");
  assert.equal(await page.getByRole("button", { name: "Lista", exact: true }).count(), 0);
  await page.locator("#descriptionVisualEditor").fill('<script>window.hacked=2</script>');
  assert.equal(await page.locator("#descriptionVisualEditor").isVisible(), true);
  assert.equal(await page.locator(".formatted-description script").count(), 0);
  assert.equal(await page.evaluate(() => window.hacked), undefined);
  await page.locator("#descriptionVisualEditor").fill("Wstep\nKoniec");
  await page.evaluate(() => {
    const editor = document.querySelector("#descriptionVisualEditor"), walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node; while ((node = walker.nextNode()) && !node.textContent.includes("Wstep")) {}
    if (!node) throw Error("Missing Wstep text in editor");
    const range = document.createRange(); range.setStart(node, node.textContent.length); range.collapse(true);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    editor.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    document.dispatchEvent(new Event("selectionchange"));
  });
  await page.getByRole("button", { name: "Wstaw tytul tutaj", exact: true }).click();
  assert.equal(await page.locator('[data-description-token="title"]').count(), 1);
  const positioned = await page.locator("#descriptionTextInput").inputValue();
  assert.ok(positioned.indexOf("{{TYTUL}}") > positioned.indexOf("Wstep"), positioned);
  await page.getByRole("button", { name: "Wstaw tytul tutaj", exact: true }).click();
  assert.equal(await page.locator('[data-description-token="title"]').count(), 1, "Moving the title must not duplicate it");
  await page.locator("#titleInput").fill("Inny tytul");
  assert.equal(await page.locator('[data-description-token="title"]').textContent(), "INNY TYTUL");
  await page.locator("#descriptionVisualEditor").click();
  await page.keyboard.press("Control+End");
  await page.getByRole("button", { name: "Wstaw dane auta tutaj", exact: true }).click();
  assert.equal(await page.locator('[data-description-token="vehicle"]').count(), 1);
  await page.locator("#addDescriptionExpression").click();
  await page.locator("#descriptionExpressionName").fill("Sprawdzone");
  await page.locator("#descriptionExpressionText").fill('Sprawdzone <img src=x onerror="window.hacked=3">');
  await page.locator("#saveDescriptionExpression").click();
  await page.waitForSelector("[data-expression-id]");
  assert.equal(JSON.parse(savedTemplate).templates.length, 0, "Expressions can be saved before the first template");
  await page.evaluate(() => { const e = document.querySelector("#descriptionVisualEditor"), range = document.createRange(); range.selectNodeContents(e); range.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(range); document.dispatchEvent(new Event("selectionchange")); });
  await page.locator("[data-expression-id]").click();
  assert.ok((await page.locator("#descriptionTextInput").inputValue()).includes("Sprawdzone <img"));
  assert.equal(await page.locator("#descriptionVisualEditor img").count(), 0);
  assert.equal(await page.evaluate(() => window.hacked), undefined);
  await page.locator("#saveDescriptionTemplate").click();
  await page.locator("#descriptionTemplateName").fill("Moj pierwszy szablon");
  await page.locator("#confirmDescriptionTemplate").click();
  await page.waitForFunction(() => document.querySelector("#toast")?.textContent?.includes("Zapisano"));
  assert.equal(JSON.parse(savedTemplate).format, "wystawiacz-description-templates-v3");
  await page.locator("#descriptionVisualEditor").fill("Chwilowy opis");
  await page.locator("[data-template-id]").first().click();
  assert.equal(await page.locator('[data-description-token="title"]').count(), 1);
  assert.equal(await page.locator('[data-description-token="vehicle"]').count(), 1);
  const publication = await page.evaluate(() => buildDescriptionModel().sections[0].items.find(i => i.type === "TEXT").content);
  assert.equal((publication.match(/INNY TYTUL/g) || []).length, 1);
  assert.ok(!publication.includes("{{")); assert.ok(publication.includes("1.6 TDI")); assert.ok(!publication.includes("<br"));
  await mkdir(new URL("../outputs/approved-check/", import.meta.url), { recursive: true });
  await page.locator(".description-panel").screenshot({ path: fileURLToPath(new URL("../outputs/approved-check/description-editor.png", import.meta.url)) });
  const freshPage = await browser.newPage();
  await freshPage.goto(`http://127.0.0.1:${server.address().port}`);
  await freshPage.evaluate(() => { window.confirm = () => true; titleInput.value = "Tytul innej aukcji"; summaryCard.classList.remove("hidden"); updateSummary(); });
  await freshPage.locator("[data-template-id]").first().click();
  assert.equal(await freshPage.locator('[data-description-token="title"]').textContent(), "TYTUL INNEJ AUKCJI");
  assert.ok((await freshPage.locator("#descriptionVisualEditor").innerText()).includes("Wstep"));
  assert.ok((await freshPage.locator("#descriptionTemplateButtons").innerText()).includes("Moj pierwszy szablon"));
  assert.equal(await freshPage.locator("[data-expression-id]").count(), 1);
  assert.equal(await freshPage.locator("#descriptionTemplates select").count(), 0);
  await freshPage.close();
  await page.locator("#descriptionVisualEditor").fill("Poprawiony pierwszy opis");
  await page.locator("#overwriteDescriptionTemplate").click();
  assert.equal(await page.locator("#descriptionVisualEditor").innerText(), "Poprawiony pierwszy opis", "Editing an applied template preserves the changes already typed");
  await page.locator("#cancelDescriptionTemplate").click();
  await page.locator("[data-template-id]").first().click();
  const originalTemplateId = JSON.parse(savedTemplate).templates[0].id;
  await page.locator("#overwriteDescriptionTemplate").click();
  await page.locator("#descriptionTemplateName").fill("Pierwszy zmieniony");
  await page.locator("#confirmDescriptionTemplate").click();
  await page.waitForFunction(() => document.querySelector("#descriptionTemplateStatus").textContent.includes("Zapisano szablon: Pierwszy zmieniony"));
  assert.equal(JSON.parse(savedTemplate).templates.length, 1);
  assert.equal(JSON.parse(savedTemplate).templates[0].id, originalTemplateId, "Editing updates the selected template, not a new copy");
  assert.equal(JSON.parse(savedTemplate).snippets.length, 1, "Editing templates preserves expressions");
  await page.locator("#descriptionVisualEditor").fill("Drugi opis");
  await page.locator("#saveDescriptionTemplate").click();
  await page.locator("#descriptionTemplateName").fill("Drugi szablon");
  preferenceFailure = true;
  await page.locator("#confirmDescriptionTemplate").click();
  await page.waitForFunction(() => document.querySelector("#descriptionTemplateStatus").textContent.includes("Nie zapisano"));
  assert.equal(JSON.parse(savedTemplate).templates.length, 1);
  preferenceFailure = false;
  await page.locator("#confirmDescriptionTemplate").click();
  await page.waitForFunction(() => document.querySelector("#descriptionTemplateStatus").textContent.includes("Zapisano szablon: Drugi"));
  assert.equal(JSON.parse(savedTemplate).templates.length, 2);
  const firstTemplateId = JSON.parse(savedTemplate).templates[0].id;
  await page.locator(`[data-template-id="${firstTemplateId}"]`).click();
  assert.ok((await page.locator("#descriptionVisualEditor").innerText()).includes("Wstep"));
  await page.locator("#titleInput").fill("SILNICZEK SZYBY VW Golf 5Q0959801B");
  await page.locator("#partNumber").fill("5Q0959801B");
  await page.locator("#descriptionVisualEditor").click();
  await page.getByRole("button", { name: "Wstaw czesc + numer bez auta", exact: true }).click();
  assert.equal(await page.locator('[data-description-token="part"]').textContent(), "SILNICZEK SZYBY 5Q0959801B");
  await page.locator('[data-description-token="part"]').click();
  await page.getByRole("button", { name: "Pogrubienie", exact: true }).click();
  assert.ok((await page.locator("#descriptionTextInput").inputValue()).includes("**{{CZESC}}**"));
  assert.ok((await page.evaluate(() => buildDescriptionModel().sections[0].items.find(i => i.type === "TEXT").content)).includes("<b>SILNICZEK SZYBY 5Q0959801B</b>"));
  await page.locator("#titleInput").fill("silniczek szyby VW Golf 5Q0959801B");
  assert.equal(await page.locator('[data-description-token="part"]').evaluate(chip => Boolean(chip.closest("b,strong"))), true, "Dynamic refresh preserves bold block formatting");
  await page.locator('[data-description-token="part"]').click();
  await page.getByRole("button", { name: "Pogrubienie", exact: true }).click();
  assert.ok(!(await page.locator("#descriptionTextInput").inputValue()).includes("**{{CZESC}}**"));
  assert.ok(!(await page.locator("#descriptionTextInput").inputValue()).includes("****"));
  const partOutput = await page.evaluate(() => buildDescriptionModel().sections[0].items.find(i => i.type === "TEXT").content);
  assert.ok(partOutput.includes("SILNICZEK SZYBY 5Q0959801B"));
  assert.ok(!partOutput.includes("{{CZESC}}"));
  await page.locator("#descriptionTemplates").screenshot({ path: fileURLToPath(new URL("../outputs/approved-check/description-templates.png", import.meta.url)) });
  await page.locator(".description-panel").screenshot({ path: fileURLToPath(new URL("../outputs/approved-check/description-editor.png", import.meta.url)) });
  const legacy = await page.evaluate(() => buildProductDescriptionForPublish({ title: "Stara oferta", descriptionText: "Moje stare uwagi" }, []).sections[0].items[0].content);
  assert.ok(legacy.includes("STARA OFERTA")); assert.ok(legacy.includes("Moje stare uwagi"));
  await page.evaluate(() => {
    state.allegroConnected = true; state.selectedPhotoNames = ["moje.jpg"];
    state.shippingRates = [{ id: "shipping", name: "Cennik" }]; shippingRateInput.innerHTML = '<option value="shipping">Cennik</option>';
    state.afterSalesServices.returnPolicies = [{ id: "return", name: "Zwrot" }]; state.afterSalesServices.impliedWarranties = [{ id: "claim", name: "Reklamacja" }];
    state.selectedVehicleId = "";
  });
  await page.locator("#partNumber").fill("1234567");
  await page.locator(".own-offers-panel summary").click();
  await page.waitForSelector(".own-offers-panel button");
  assert.equal(await page.locator(".own-offers-panel button").count(), 1, "A suffix variant must not match the complete part number");
  await page.locator(".own-offers-panel button").click();
  await page.waitForFunction(() => priceInput.value === "500.00");
  assert.equal(await page.locator("#stockUnitInput").inputValue(), "PAIR");
  assert.equal(await page.locator("#shippingRateInput").inputValue(), "shipping");
  assert.equal(await page.locator("#returnPolicyInput").inputValue(), "return");
  assert.deepEqual(await page.evaluate(() => state.selectedPhotoNames), ["moje.jpg"]);
  assert.equal(await page.evaluate(() => activeProductId), "");
  assert.equal(await page.evaluate(() => state.products.length), 0);
  await page.locator('[data-use-vehicle-id="b"]').click();
  assert.ok(!(await page.locator("#titleInput").inputValue()).includes("BMW"));
  const conversion = await page.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 40; canvas.height = 20;
    const png = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    const [a, b] = await Promise.all([PhotoUpload.prepare(png, true), PhotoUpload.prepare(png, true)]);
    return { same: a === b, type: a.type, bytes: a.size };
  });
  assert.equal(conversion.same, true); assert.equal(conversion.type, "image/jpeg"); assert.ok(conversion.bytes > 0);
  await page.evaluate(() => cloudSessions.save());
  assert.equal(writes, 1); assert.equal(saved.revision, 0); assert.equal(saved.payload.draft.price, "500.00"); assert.equal(saved.payload.draft.image, undefined);
  assert.equal(saved.payload.draft.descriptionFullLayout, true);
  await page.locator(".cloud-session-controls input").check();
  assert.equal(await page.evaluate(() => localStorage.getItem("wystawiacz-cloud-autosave")), "true");
  conflict = true;
  await page.locator("#priceInput").fill("600");
  await page.evaluate(() => cloudSessions.save());
  assert.match(await page.locator("#sessionStatus").textContent(), /innej karcie/);
  assert.equal(saved.payload.draft.price, "500.00", "A conflicting autosave never overwrites the server version");
  assert.equal(await page.locator(".cloud-session-controls input").isChecked(), true, "A conflict pauses saving but retains the preference");
  conflict = false;
  await page.locator(".cloud-session-controls button").nth(1).click();
  await page.locator(".cloud-session-list button").first().click();
  await page.waitForFunction(() => priceInput.value === "500.00");
  assert.equal(await page.locator("#priceInput").inputValue(), "500.00", "Opening the server version recovers after a conflict");
  const recoveryWrites = writes;
  await page.locator("#priceInput").fill("650");
  await page.waitForFunction(() => document.querySelector("#sessionStatus").textContent.includes("Zapisano na serwerze"));
  assert.ok(writes > recoveryWrites, "Opening a safe version resumes autosave without losing the preference");
  assert.equal(await page.locator(".cloud-session-controls summary").count(), 0);
  assert.equal(await page.locator(".session-file-controls #saveSessionButton").count(), 1);
  assert.equal(await page.locator(".price-search-row").count(), 5);
  await page.locator(".price-search-row").filter({ hasText: "Ovoko" }).locator("button").first().click();
  assert.equal(new URL(await page.evaluate(() => window.opened.at(-1)[0])).searchParams.get("q"), "1234567");
  for (const site of ["Otomoto", "OLX"]) {
    const row = page.locator(".price-search-row").filter({ hasText: site });
    await row.getByLabel("Od najnizszej").check(); await row.getByText("Po numerze", { exact: true }).click();
    assert.equal(new URL(await page.evaluate(() => window.opened.at(-1)[0])).searchParams.get("search[order]"), "filter_float_price:asc");
  }
  assert.equal(await page.locator("#priceUsedInput").count(), 0);
  await page.getByRole("group", { name: "Allegro: Szukaj", exact: true }).getByText("Po numerze", { exact: true }).click();
  assert.equal(new URL(await page.evaluate(() => window.opened.at(-1)[0])).searchParams.has("stan"), false);
  assert.equal(await page.locator(".price-quote, #checkMarketPrices, #allegroPriceReaderDialog").count(), 0);
  assert.equal(await page.locator(".search-actions input").count(), 7);
  assert.equal(await page.locator("#priceInput").inputValue(), "650", "Search links never change the selling price");

  await mkdir(new URL("../outputs/approved-check/", import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL("../outputs/approved-check/workspace.png", import.meta.url)), fullPage: true });
  conflict = false;
  await page.reload();
  assert.equal(await page.locator(".cloud-session-controls input").isChecked(), true, "Autosave stays enabled after reload");
  const writesBefore = writes;
  await page.locator("#titleInput").fill("Nowy opis po odswiezeniu");
  await page.waitForFunction(() => document.querySelector("#sessionStatus").textContent.includes("Zapisano na serwerze"));
  assert.ok(writes > writesBefore, "A remembered preference actually autosaves, without another click");
  await page.locator(".cloud-session-controls input").uncheck();
  await page.evaluate(async () => {
    priceInput.value = "300";
    const pending = cloudSessions.save(); cloudSessions.newSession(); await pending;
    titleInput.value = "Nowa sesja podczas zapisu"; await cloudSessions.save();
  });
  assert.equal(saved.revision, 0, "A late save response cannot assign the previous session's revision to a new session");
  assert.deepEqual(errors, []);
  console.log("Approved workspace: safe imports, sequential batch/skip published, external editing, vehicle block preservation, rich formatting, own-offer copy with prices/shipping and retained photos, cached JPEG conversion, conflict-safe cloud save and price links passed. No live offers/payments.");
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
