import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { pathToFileURL, fileURLToPath } from "node:url";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const root = new URL("../public/wystawiacz/", import.meta.url);
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://test.local").pathname;
  if (path.startsWith("/api/")) { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ connected: false, build: "2026-06-02.35", categories: [] })); return; }
  try {
    const name = path === "/" ? "index.html" : path.slice(1);
    if (!/^[a-z0-9.-]+$/i.test(name)) throw new Error("Invalid file");
    let body = await readFile(new URL(name, root));
    if (name === "index.html") body = body.toString().replace('<script src="web-auth.js"></script>', '<script>window.getWystawiaczToken = async () => "test-session";</script>');
    res.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : "text/html; charset=utf-8");
    res.end(body);
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  // Parent React portal fills this slot in production; verify its child-document layout.
  await page.evaluate(() => {
    const nav = document.getElementById("accountNavigation");
    const back = document.createElement("a"); back.textContent = "Powrot do panelu konta"; back.href = "/panel";
    const logout = document.createElement("button"); logout.textContent = "Wyloguj";
    nav.append(back, logout);
  });
  assert.equal(await page.locator(".hero-copy, .step-indicator").count(), 0);
  assert.equal(await page.locator("#vehiclesDialog").isVisible(), false);
  assert.ok((await page.locator(".session-card").boundingBox()).height < 125);
  const accountBox = await page.locator(".connection-card").boundingBox();
  const sessionBox = await page.locator(".session-card").boundingBox();
  assert.equal(accountBox.y, sessionBox.y, "Account and session sit side by side on desktop");
  assert.ok(sessionBox.x > accountBox.x + accountBox.width);
  await page.locator(".connection-details summary").click();
  assert.equal(await page.locator("#connectionDescription").isVisible(), true);
  await page.locator(".connection-details summary").click();
  await page.locator("#openVehiclesButton").click();
  assert.equal(await page.locator("#vehiclesDialog").isVisible(), true);
  await page.locator("#vehicleManufacturerInput").fill("Volkswagen");
  await page.locator("#vehicleShortInput").fill("VW Golf VII");
  await page.locator("#vehicleFullInput").fill("Volkswagen Golf VII 2019");
  await page.locator("#addVehicleButton").click();
  assert.equal(await page.locator("#vehicleList .vehicle-chip").count(), 1);
  await page.locator("#closeVehiclesButton").click();
  await page.locator("#titleInput").fill("Czujnik parktronik PDC");
  await page.locator("#partNumber").fill("5Q0919275B");
  await page.locator("#vehicleButtons button").click();
  assert.equal(await page.locator("#titleInput").inputValue(), "Czujnik parktronik PDC VW Golf VII 5Q0919275B");
  await page.locator("#openVehiclesButton").click();
  await page.locator("[data-edit-vehicle-id]").click();
  await page.locator("#vehicleShortInput").fill("VW Golf VIII");
  await page.locator("#vehicleFullInput").fill("Volkswagen Golf VIII 2021");
  await page.locator("#addVehicleButton").click();
  assert.equal(await page.locator("#vehicleList .vehicle-chip").count(), 1, "Edit keeps model id rather than adding duplicates");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#titleInput").inputValue(), "Czujnik parktronik PDC VW Golf VIII 5Q0919275B");
  assert.ok((await page.locator("#descriptionTextInput").inputValue()).includes("Volkswagen Golf VIII 2021"));
  await page.locator("#openVehiclesButton").click();
  await page.locator("[data-edit-vehicle-id]").click();
  await page.locator("#vehicleShortInput").fill("Unsaved");
  await page.locator("#cancelVehicleEditButton").click();
  assert.equal(await page.locator("#vehicleShortInput").inputValue(), "");
  assert.ok((await page.locator("#vehicleList").textContent()).includes("VW Golf VIII"));
  await page.locator("#closeVehiclesButton").click();
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 500; canvas.height = 300;
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "#e5e7eb"; ctx.fillRect(0, 0, 500, 300);
    ctx.fillStyle = "#182230"; ctx.font = "32px sans-serif"; ctx.fillText("Zdjecie produktu", 100, 160);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg"));
    for (const name of ["one.jpg", "two.jpg"]) {
      const file = new File([blob], name, { type: "image/jpeg" });
      state.localPhotosByName.set(name, { name, file, url: URL.createObjectURL(file) });
    }
    renderPhotos();
  });
  await page.locator("#togglePhotoButton").click();
  await page.locator("#nextPhotoButton").click();
  await page.locator("#togglePhotoButton").click();
  await page.locator("#rotatePhotoRightButton").click();
  await page.waitForFunction(() => state.photoRotations.get("two.jpg") === 1);
  assert.deepEqual(await page.evaluate(() => state.selectedPhotoNames), ["one.jpg", "two.jpg"]);
  await page.locator("#mainPhotoButton").click();
  assert.deepEqual(await page.evaluate(() => state.selectedPhotoNames), ["two.jpg", "one.jpg"]);
  await page.locator("#sessionNameInput").fill("Layout test");
  await page.evaluate(() => {
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => { if (blob.type.startsWith("application/json")) window.savedSessionBlob = blob; return create(blob); };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (!this.download) click.call(this); };
  });
  await page.locator("#saveSessionButton").click();
  const session = JSON.parse(await page.evaluate(() => window.savedSessionBlob.text()));
  assert.equal(session.vehicles[0].short, "VW Golf VIII");
  assert.deepEqual(session.photoRotations, [["two.jpg", 1]]);
  await page.locator("#loadSessionInput").setInputFiles({ name: "session.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(session)) });
  await page.waitForFunction(() => state.vehicles[0]?.short === "VW Golf VIII" && state.selectedPhotoNames[0] === "two.jpg");
  for (const width of [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No page overflow at ${width}`);
    const buttons = await page.locator(".photo-navigation button").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().top));
    assert.ok(Math.max(...buttons) - Math.min(...buttons) < 2, `Photo navigation stays on one row at ${width}`);
    await page.locator("#openVehiclesButton").click();
    assert.ok(await page.locator("#closeVehiclesButton").isVisible());
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await mkdir(new URL("../outputs/layout-check/", import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL("../outputs/layout-check/workspace.png", import.meta.url)) });
  await page.locator("#openVehiclesButton").click();
  await page.screenshot({ path: fileURLToPath(new URL("../outputs/layout-check/models.png", import.meta.url)) });
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.scrollTo(0, 500));
  assert.ok((await page.locator(".topbar").boundingBox()).y < 0, "Account navigation scrolls out with page");
  assert.deepEqual(errors, []);
  console.log("Workspace: actual app scripts, modal add/edit/cancel, selected model/title, photo order/rotation/main, session save/load and responsive layout passed. No live API calls.");
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
