import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { readCases } from "./ovoko-read-fixtures.mjs";

const require = createRequire(import.meta.url);
const { Miniflare } = await import(pathToFileURL(require.resolve("miniflare", { paths: [require.resolve("wrangler/package.json")] })).href);
const bundled = await build({
  stdin: { contents: 'import { handleOvokoApi } from "./lib/ovoko-api"; export default { fetch: handleOvokoApi };', resolveDir: process.cwd(), sourcefile: "ovoko-worker-test.ts" },
  bundle: true, write: false, format: "esm", platform: "browser", target: "es2022",
});
const owner = "00000000-0000-0000-0000-000000000001";
const credentials = { username: "fixture", password: "private-password&+", user_token: "private-token" };
let mode = 200, user = 0, probes = 0;
let readCase = null;
const mf = new Miniflare({
  modules: true, compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"],
  script: bundled.outputFiles[0].text,
  bindings: { SUPABASE_SERVICE_ROLE_KEY: "fixture", NEXT_PUBLIC_SUPABASE_URL: "https://database.test" },
  // Intercept outbound traffic, not worker fetch(): Request construction uses real workerd semantics.
  outboundService: async request => {
    const url = new URL(request.url);
    const id = owner.slice(0, -3) + String(user).padStart(3, "0");
    if (url.hostname === "database.test") {
      assert.equal(request.method, "GET");
      if (url.pathname === "/auth/v1/user") return Response.json({ id, email_confirmed_at: "2026-11-20T00:00:00Z" });
      if (url.pathname === "/rest/v1/customer_accounts") return Response.json([{ owner_id: id, company: {}, suspended: false }]);
      if (url.pathname === "/rest/v1/account_admins") return Response.json([{ owner_id: id }]);
    }
    assert.equal(url.href, `https://api.rrr.lt${readCase?.path || "/get/car_brands"}`, "Never follow redirects or send credentials to another endpoint");
    probes++;
    assert.equal(request.method, "POST");
    assert.deepEqual(Object.fromEntries(new URLSearchParams(await request.text())), credentials);
    if (mode !== 200) return new Response("private-token", { status: mode, headers: { Location: "https://evil.test/private-token" } });
    if (readCase) return Response.json({ status_code: "R200", ...readCase.result });
    return Response.json({ status_code: "R200", list: [{ id: "1", name: "Audi" }] });
  },
});
try {
  for (const status of [200, 301, 302, 303, 307, 308]) {
    mode = status; user++;
    const before = probes;
    const response = await mf.dispatchFetch("https://ovoko.test/api/ovoko/test", {
      method: "POST", headers: { Authorization: "Bearer fixture", Origin: "https://ovoko.test", "Content-Type": "application/json" }, body: JSON.stringify(credentials),
    });
    assert.equal(response.status, status === 200 ? 200 : 502);
    const body = await response.text();
    assert.ok(!body.includes("private-"));
    if (status === 200) assert.deepEqual(JSON.parse(body).brands, [{ id: "1", name: "Audi" }]);
    else assert.match(body, /przekierowanie/);
    assert.equal(probes, before + 1, "Exactly one upstream read, no redirected request");
  }
  mode = 200;
  for (const fixture of readCases) {
    user++; readCase = fixture; const before = probes;
    const response = await mf.dispatchFetch("https://ovoko.test/api/ovoko/read", {
      method: "POST", headers: { Authorization: "Bearer fixture", Origin: "https://ovoko.test", "Content-Type": "application/json" }, body: JSON.stringify({ ...credentials, operation: fixture.operation, ...(fixture.brandId ? { brandId: fixture.brandId } : {}) }),
    });
    assert.equal(response.status, 200, fixture.operation);
    const result = await response.json(); assert.deepEqual(result.rows, fixture.rows);
    assert.ok(!JSON.stringify(result).includes("private-"));
    assert.equal(probes, before + 1);
  }
  console.log("Ovoko workerd: real fetch completed; all five redirect types blocked without forwarding credentials. All outbound services mocked.");
} finally { await mf.dispose(); }
