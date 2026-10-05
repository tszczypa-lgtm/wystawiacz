import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
assert.equal(read("../app/page.tsx").trim(), 'export { default } from "./login/page";');
assert.match(read("../app/login/page.tsx"), /<LoginForm\s*\/>/);
assert.match(read("../app/layout.tsx"), /title: "Wystawiacz by Tymo"/);
assert.match(read("../app/panel/account-shell.tsx"), />Wystawiacz by Tymo<\/a>/);
const home = read("../../outputs/tymogarage-home/index.html");
assert.match(home, /Strona w budowie/);
assert.match(home, /warsztatu elektroniki/);
assert.match(home, /href="https:\/\/wystawiacz\.tszczypa\.workers\.dev\/login"/);
assert.equal((home.match(/<a\s/g) || []).length, 1);
assert.match(read("../vite.config.ts"), /keep_vars:\s*true/);
console.log("Entry points and branding checks passed.");
