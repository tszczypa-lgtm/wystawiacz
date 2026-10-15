import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
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
const checkoutFields = load(path.join(root, "components", "checkout-acceptance.tsx"));
const checkoutHtml = renderToStaticMarkup(React.createElement(checkoutFields.CheckoutAcceptance, { sandbox: true, disabled: false, acceptTerms: false, requestEarlyStart: false, onTerms() {}, onEarlyStart() {} }));
assert.equal((checkoutHtml.match(/type="checkbox"/g) || []).length, 2);
assert.ok(!checkoutHtml.includes(' checked=""'));
assert.ok(checkoutHtml.includes("bez prawdziwej umowy i oplaty"));
assert.ok(checkoutHtml.includes('href="/regulamin"'));
assert.ok(checkoutHtml.includes("Samo rozpoczecie uslugi nie oznacza utraty prawa odstapienia"));
console.log("Sales pages: public routes, seller details, draft notices, links, personal/business fields and closed production gate passed (SSR component test).");
