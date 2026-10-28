import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = fileURLToPath(new URL("../", import.meta.url));
const nativeRequire = createRequire(import.meta.url);
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const source = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const require = name => {
    if (!name.startsWith("@/") && !name.startsWith(".")) return nativeRequire(name);
    const base = name.startsWith("@/") ? path.join(root, name.slice(2)) : path.resolve(path.dirname(file), name);
    const target = [base, base + ".ts", base + ".tsx"].find(candidate => existsSync(candidate));
    assert.ok(target, `Missing module ${name}`); return load(target);
  };
  new Function("require", "module", "exports", source)(require, module, module.exports);
  return module.exports;
}
for (const route of ["oferta", "kontakt", "regulamin", "prywatnosc"]) {
  const page = load(path.join(root, "app", route, "page.tsx"));
  const html = renderToStaticMarkup(React.createElement(page.default));
  assert.ok(html.includes("Wystawiacz by Tymo"));
  for (const link of ["/oferta", "/kontakt", "/regulamin", "/prywatnosc"]) assert.ok(html.includes(`href="${link}"`));
  if (route === "kontakt" || route === "oferta") {
    assert.ok(html.includes("5482566629")); assert.ok(html.includes("43-520 Mnich"));
    assert.ok(html.includes("mailto:biuro@tymogarage.pl"));
  }
  if (["regulamin", "prywatnosc"].includes(route)) {
    assert.ok(html.includes("Projekt do zatwierdzenia"));
    assert.equal(page.metadata.robots.index, false);
  }
}
const fields = load(path.join(root, "components", "company-fields.tsx"));
const profile = { name: "Jan Kowalski", nip: "", street: "Test 1", postcode: "00-001", city: "Warszawa", country: "PL" };
const personal = renderToStaticMarkup(React.createElement(fields.CompanyFields, { value: { ...profile, customerType: "person" }, onChange() {} }));
const business = renderToStaticMarkup(React.createElement(fields.CompanyFields, { value: { ...profile, nip: "5260250274" }, onChange() {} }));
assert.ok(personal.includes("Imię i nazwisko")); assert.ok(!personal.includes(">NIP<"));
assert.ok(business.includes("NIP")); assert.ok(business.includes("Nazwa firmy"));
const policy = load(path.join(root, "lib", "sales-policy.ts"));
assert.equal(policy.salesPolicy.approved, false);
const documents = load(path.join(root, "lib", "sales-documents.ts"));
const terms = documents.salesDocumentText("regulamin"), privacy = documents.salesDocumentText("prywatnosc");
if (process.argv.includes("--write-documents")) {
  const directory = path.join(root, "outputs", "tpay-review");
  mkdirSync(directory, { recursive: true });
  for (const name of ["regulamin", "prywatnosc"]) writeFileSync(path.join(directory, documents.salesDocumentPath(name).split("/").pop()), documents.salesDocumentText(name), "utf8");
}
assert.ok(terms.includes("Bezpłatny okres próbny trwa 30 dni"));
assert.ok(terms.includes("500 zł brutto"));
assert.ok(terms.includes("Nie ma automatycznego odnawiania"));
assert.ok(terms.includes("Nie oferujemy dodatkowej gwarancji zwrotu"));
assert.ok(terms.includes("zapłata proporcjonalna"));
assert.ok(terms.includes("Samo logowanie nie jest zrzeczeniem"));
assert.ok(terms.includes("Wzór oświadczenia"));
assert.ok(terms.includes("Na reklamację konsumenta odpowiadamy w terminie 14 dni"));
assert.ok(privacy.includes("home.pl"));
assert.ok(privacy.includes("nie deklaruje niezweryfikowanych terminów"));
const download = load(path.join(root, "app", "dokumenty", "[file]", "route.ts"));
for (const name of ["regulamin", "prywatnosc"]) {
  const file = documents.salesDocumentPath(name).split("/").pop();
  const response = await download.GET(new Request(`https://example.test/dokumenty/${file}`), { params: Promise.resolve({ file }) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type"), /text\/plain; charset=utf-8/);
  assert.match(response.headers.get("Content-Disposition"), /^attachment; filename="[a-z0-9.-]+"$/);
  assert.equal(await response.text(), documents.salesDocumentText(name));
}
for (const file of ["regulamin-old.txt", "../.env", "regulamin-\r\nx-test: unsafe.txt"]) {
  assert.equal((await download.GET(new Request("https://example.test/dokumenty/invalid"), { params: Promise.resolve({ file }) })).status, 404);
}
const checkoutFields = load(path.join(root, "components", "checkout-acceptance.tsx"));
const checkoutHtml = renderToStaticMarkup(React.createElement(checkoutFields.CheckoutAcceptance, { sandbox: true, disabled: false, acceptTerms: false, requestEarlyStart: false, onTerms() {}, onEarlyStart() {} }));
assert.equal((checkoutHtml.match(/type="checkbox"/g) || []).length, 2);
assert.ok(!checkoutHtml.includes(' checked=""'));
assert.ok(checkoutHtml.includes("bez prawdziwej umowy, opłaty i aktywacji"));
assert.ok(checkoutHtml.includes('href="/regulamin"'));
assert.ok(checkoutHtml.includes("14 dni od zawarcia umowy na odstąpienie"));
assert.ok(checkoutHtml.includes("wykorzystana usługa jest rozliczana proporcjonalnie"));
const disclosures = checkoutHtml.match(/<details[\s\S]*?<\/details>/g) || [];
assert.equal(disclosures.length, 1);
const visibleCheckout = checkoutHtml.replace(/<details[\s\S]*?<\/details>/g, "");
assert.ok(visibleCheckout.includes("14 dni od zawarcia umowy na odstąpienie"), "Withdrawal notice stays visible, not hidden in details");
assert.ok(visibleCheckout.includes("rozliczana proporcjonalnie"));
assert.ok(visibleCheckout.includes("Chcę rozpocząć usługę po potwierdzeniu płatności"));
assert.ok(checkoutHtml.includes(documents.salesDocumentPath("regulamin")));
assert.ok(checkoutHtml.includes(documents.salesDocumentPath("prywatnosc")));
console.log("Sales pages: public routes, seller details, draft notices, links, personal/business fields and closed production gate passed (SSR component test).");
