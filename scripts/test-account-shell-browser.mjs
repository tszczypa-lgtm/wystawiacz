import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const cssPath = fileURLToPath(new URL("../app/globals.css", import.meta.url));
const css = await postcss([tailwind({ base: root })]).process(await readFile(cssPath, "utf8"), { from: cssPath });
const bundle = await build({
  stdin: {
    contents: 'import React from "react"; import { createRoot } from "react-dom/client"; import { AccountShell } from "./app/panel/account-shell"; createRoot(document.getElementById("root")).render(<AccountShell active="/panel/inventory"><section data-testid="content">Account content</section></AccountShell>);',
    resolveDir: root, loader: "tsx",
  },
  bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "account-fixtures", setup(builder) {
    builder.onResolve({ filter: /^@\/lib\/(account-client|supabase)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({
      contents: args.path.endsWith("account-client")
        ? 'export async function accountRequest(){return {isAdmin:location.search.includes("admin=1")}}'
        : 'export function createSupabaseBrowserClient(){return {auth:{signOut:async()=>{sessionStorage.setItem("signedOut","yes")}}}}',
      loader: "js",
    }));
  } }],
});

const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div></body></html>' }));
  for (const admin of [false, true]) {
    await page.goto(`https://account.test/panel/inventory?admin=${Number(admin)}`);
    await page.addStyleTag({ content: css.css });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const nav = page.getByRole("navigation", { name: "Panel konta" });
    await nav.waitFor();
    if (admin) await nav.getByRole("link", { name: "Administrator", exact: true }).waitFor();
    assert.equal(await nav.locator('a[aria-current="page"]').getAttribute("href"), "/panel/inventory");
    assert.equal(await nav.getByRole("link", { name: "Administrator", exact: true }).count(), Number(admin));
    for (const width of [320, 390, 767, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      const layout = await page.evaluate(() => {
        const nav = document.querySelector('nav[aria-label="Panel konta"]');
        const content = document.querySelector('[data-testid="content"]');
        const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, right: r.right, bottom: r.bottom }; };
        return {
          nav: rect(nav), content: rect(content), display: getComputedStyle(nav).display,
          overflow: document.documentElement.scrollWidth > innerWidth,
          links: [...nav.querySelectorAll("a")].map(a => ({ ...rect(a), fontSize: getComputedStyle(a).fontSize })),
        };
      });
      assert.equal(layout.overflow, false, `No shell overflow at ${width}px (admin=${admin})`);
      for (const link of layout.links) {
        assert.ok(link.x >= 0 && link.right <= width, "Navigation stays within viewport");
        assert.ok(link.bottom > link.y && link.width > 0, "Navigation remains visible");
      }
      assert.equal(layout.links[0].fontSize, "16px", "Keep readable navigation text");
      assert.ok(await page.getByRole("button", { name: "Wyloguj", exact: true }).isVisible());
      if (width >= 768) {
        assert.equal(layout.display, "grid");
        assert.equal(layout.nav.x, 24);
        assert.equal(layout.nav.width, 192);
        assert.equal(layout.content.x, 236);
        assert.equal(layout.content.width, width - 260);
        assert.ok(layout.links.every(link => link.bottom - link.y >= 44), "Keep comfortable navigation targets");
      } else {
        assert.equal(layout.display, "flex", "Keep wrapping mobile navigation");
        assert.equal(layout.nav.x, 20);
        assert.ok(layout.content.y >= layout.nav.bottom, "Mobile content stays below navigation");
        assert.equal(layout.content.width, width - 40);
      }
    }
  }
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.getByRole("button", { name: "Wyloguj", exact: true }).click();
  await page.waitForURL("https://account.test/login");
  assert.equal(await page.evaluate(() => sessionStorage.getItem("signedOut")), "yes", "Logout still signs out before redirecting");
  assert.deepEqual(errors, []);
  console.log("Account shell: desktop width, mobile wrapping, readable links, admin navigation and mocked logout passed at 320-1920px. No live API calls.");
} finally {
  await browser.close();
}
