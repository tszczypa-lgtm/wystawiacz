import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
try {
  const page = await browser.newPage(); const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://qr.test/**", route => route.fulfill({ contentType: "text/html", body: '<article class="photos-card"><div class="card-heading">Zdjecia</div><div id="photoGrid"></div></article>' }));
  await page.goto("https://qr.test/");
  for (const file of ["vendor/qrcode-1.4.4.js", "vendor/jsQR-1.4.0.js", "beta-qr.js"]) await page.addScriptTag({ content: await readFile(new URL(`../public/wystawiacz-beta/${file}`, import.meta.url), "utf8") });
  await page.evaluate(async () => {
    window.fixtureState = { localPhotosByName: new Map(), products: [] }; window.fixturePreview = "";
    window.renderPhotos = () => { const grid = document.getElementById("photoGrid"); grid.replaceChildren(); for (const photo of fixtureState.localPhotosByName.values()) { const button = document.createElement("button"); button.dataset.photoName = photo.name; grid.append(button); } };
    window.togglePhoto = () => {};
    window.makePhoto = async (name, type) => {
      const canvas = document.createElement("canvas"); canvas.width = 1000; canvas.height = 800;
      const ctx = canvas.getContext("2d"); ctx.fillStyle = "#fafafa"; ctx.fillRect(0, 0, 1000, 800);
      if (type === "qr" || type === "foreign") {
        const qr = document.createElement("canvas"); BetaQR.paint(qr);
        if (type === "foreign") {
          const code = qrcode(0, "H"); code.addData("https://untrusted.test/?x=<script>evil</script>"); code.make(); const n = code.getModuleCount(); qr.width = qr.height = (n + 8) * 8;
          const q = qr.getContext("2d"); q.fillStyle = "white"; q.fillRect(0, 0, qr.width, qr.height); q.fillStyle = "black";
          for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (code.isDark(y, x)) q.fillRect((x + 4) * 8, (y + 4) * 8, 8, 8);
        }
        ctx.translate(500, 400); ctx.rotate(.15); ctx.drawImage(qr, -qr.width / 2, -qr.height / 2);
      } else { ctx.fillStyle = "#334455"; ctx.fillRect(100, 100, 200, 100); }
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", .88));
      const file = new File([blob], name, { type: "image/jpeg", lastModified: 1 }); fixtureState.localPhotosByName.set(name, { name, file });
    };
    // Intentionally shuffled camera filenames, including 2 before 10, leading/trailing repeated separators.
    for (const [name, type] of [["IMG_10.jpg", "part"], ["IMG_2.jpg", "part"], ["IMG_1.jpg", "qr"], ["IMG_0.jpg", "part"], ["IMG_11.jpg", "qr"], ["IMG_12.jpg", "part"], ["IMG_13.jpg", "part"], ["IMG_14.jpg", "foreign"], ["IMG_15.jpg", "qr"], ["IMG_16.jpg", "qr"]]) await makePhoto(name, type);
    window.fixturePreview = "IMG_13.jpg";
    window.qrControls = BetaQR.mount({ state: fixtureState, previewName: () => fixturePreview, allowed: () => true, blocked: () => false, changed() {}, busyChanged() {}, beforeScan() {}, create(groups) { for (const names of groups) fixtureState.products.push({ id: crypto.randomUUID(), photoNames: names }); } });
    window.prints = 0; window.print = () => { window.prints++; };
  });
  await page.locator("#betaMakeQR").click();
  const decoded = await page.evaluate(() => { const c = document.getElementById("betaQrCanvas"), pixels = c.getContext("2d").getImageData(0, 0, c.width, c.height); return jsQR(pixels.data, c.width, c.height)?.data; });
  assert.equal(decoded, "WYSTAWIACZ:BETA:SEPARATOR:1", "Printed/downloaded code is a real decodable QR");
  await page.locator("#betaPrintQR").click(); assert.equal(await page.evaluate(() => prints), 1);
  await page.locator("#betaCloseQR").click();
  await page.locator("#betaManualQR").click();
  await page.locator("#betaSplitAI").click();
  await page.locator("#betaSplitDialog").waitFor({ state: "visible" });
  assert.equal(await page.locator("#betaSplitPreview li").count(), 4, "Preamble, real QR and manual boundary form four nonempty groups");
  await page.locator("#betaConfirmSplit").click();
  const groups = await page.evaluate(() => fixtureState.products.map(product => product.photoNames));
  assert.deepEqual(groups, [["IMG_0.jpg"], ["IMG_2.jpg", "IMG_10.jpg"], ["IMG_12.jpg"], ["IMG_13.jpg", "IMG_14.jpg"]]);
  assert.equal(await page.evaluate(() => fixtureState.localPhotosByName.size), 10, "Source images, including separator photos, remain intact");
  await page.locator("#betaSplitAI").click();
  await page.getByText(/Brak nowych aukcji/).waitFor();
  assert.equal(await page.evaluate(() => fixtureState.products.length), 4, "Repeated processing does not duplicate or overwrite listings");
  await page.evaluate(() => fixtureState.localPhotosByName.set("IMG_17.jpg", { name: "IMG_17.jpg", file: new File(["corrupt"], "IMG_17.jpg", { type: "image/jpeg" }) }));
  await page.locator("#betaSplitAI").click();
  await page.getByText(/Nie odczytano IMG_17/).waitFor();
  assert.equal(await page.evaluate(() => fixtureState.products.length), 4, "Unreadable image aborts without partial creation");
  await page.evaluate(async () => { fixtureState.localPhotosByName.delete("IMG_17.jpg"); for (let i = 20; i < 55; i++) await makePhoto(`IMG_${i}.jpg`, "part"); });
  await page.locator("#betaSplitAI").click(); await page.locator("#betaCancelSplit").click();
  await page.getByText(/Anulowano skanowanie/).waitFor();
  assert.equal(await page.evaluate(() => fixtureState.products.length), 4);
  assert.deepEqual(errors, []);
  console.log("QR: real printed-code roundtrip, rotated JPEG detection, natural order, manual boundaries, foreign QR kept, repeat safety, unreadable-image rollback and cancellation passed. No AI/network image uploads.");
} finally { await browser.close(); }
