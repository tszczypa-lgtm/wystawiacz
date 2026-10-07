import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../public/wystawiacz/title-editor.js", import.meta.url), "utf8");
const context = { window: {} };
vm.runInNewContext(source, context);
const editor = context.window.TitleEditor;
assert.equal(editor.error("Hak holowniczy VW Tiguan 5NA803881F"), "");
assert.ok(editor.error("Hak 1234567").includes("3 slow"));
assert.ok(editor.error("A ".repeat(38)).includes("12 znakow") === false);
assert.ok(editor.error("ABC ".repeat(20)).includes("75"));
assert.equal(editor.length("ąś😀"), 3);
const app = await readFile(new URL("../public/wystawiacz/app.js", import.meta.url), "utf8");
const ast = ts.createSourceFile("app.js", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = ast.statements.filter(ts.isFunctionDeclaration).map(fn => fn.getText(ast)).join("\n");
const integration = vm.createContext({ window: { TitleEditor: editor }, state: { allegroConnected: true } });
vm.runInContext(functions, integration);
assert.ok(vm.runInContext('validateProductBeforePublish({ title: "ABC ".repeat(20) })', integration).includes("75"));
assert.ok(app.includes("titleEditor.refresh();\n  summaryTitle"));
assert.ok(app.includes("window.TitleEditor.length(title) > 75"));

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/editor.js" ? "text/javascript" : "text/html; charset=utf-8");
  res.end(req.url === "/editor.js" ? source : '<textarea id="titleInput"></textarea><input type="checkbox" id="titleUppercase"><output id="titleCharacterCount"></output><small id="titleLengthHint"></small><script src="/editor.js"></script><script>window.editor = TitleEditor.mount();</script>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const input = page.locator("#titleInput");
  await input.fill("Hak holowniczy VW Tiguan 5na803881f");
  assert.equal(await page.locator("#titleCharacterCount").textContent(), `${editor.length(await input.inputValue())} / 75 znakow`);
  await page.locator("#titleUppercase").check();
  assert.equal(await input.inputValue(), "HAK HOLOWNICZY VW TIGUAN 5NA803881F");
  await page.evaluate(() => {
    const input = document.getElementById("titleInput");
    input.value = "Przełącznik szyb Škoda 5q0959857";
    window.editor.refresh();
  });
  assert.equal(await input.inputValue(), "PRZEŁĄCZNIK SZYB ŠKODA 5Q0959857");
  await page.reload();
  assert.ok(await page.locator("#titleUppercase").isChecked());
  await input.fill("a".repeat(64) + " 5na803881f");
  assert.equal(await page.locator("#titleCharacterCount").textContent(), "75 / 75 znakow");
  await input.fill("a".repeat(65) + " 5na803881f");
  assert.equal(await page.locator("#titleCharacterCount").textContent(), "76 / 75 znakow");
  assert.ok((await input.inputValue()).endsWith("5NA803881F"), "Never truncate the part-number suffix");
  assert.equal(await input.getAttribute("aria-invalid"), "true");
  await page.locator("#titleUppercase").uncheck();
  await input.fill("Hak holowniczy Volkswagen Tiguan");
  assert.equal(await input.inputValue(), "Hak holowniczy Volkswagen Tiguan");
  assert.equal(await input.getAttribute("aria-invalid"), "false");
  console.log("Title editor: uppercase preference, manual/programmatic titles, 75/76 counter, complete suffix and publish guard passed.");
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
