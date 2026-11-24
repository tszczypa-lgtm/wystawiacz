import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const output = await build({ stdin: { contents: 'export {loadCombinedInventory} from "./lib/combined-inventory-client";', resolveDir: root, loader: "ts" }, bundle: true, write: false, platform: "node", format: "esm", plugins: [{ name: "fixture", setup(builder) {
  builder.onResolve({ filter: /^\.\/(account-client|allegro-client|ovoko-transfer-client|supabase)$/ }, args => ({ path: args.path, namespace: "fixture" }));
  builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path.endsWith("account-client") ? 'export const accountRequest=(...args)=>globalThis.fixture.account(...args)' : args.path.endsWith("allegro-client") ? 'export const allegroRequest=(...args)=>globalThis.fixture.allegro(...args)' : args.path.endsWith("ovoko-transfer-client") ? 'export const ovokoTransferRequest=(...args)=>globalThis.fixture.transfers(...args)' : 'export function createSupabaseBrowserClient(){return{auth:{getSession:async()=>({data:{session:{access_token:"fixture-only",user:{id:globalThis.fixture.owner}}}})}}}', loader: "js" }));
} }] });
const originalFetch = globalThis.fetch;
let generation = 0;
async function fixture({ total = 1501, admin = true, failA = false, failO = false, rotateA = false, rotateO = false, revokeAtEnd = false } = {}) {
  const calls = []; let identities = 0, connections = 0, accountChecks = 0;
  globalThis.fixture = {
    owner: "fixture-owner",
    account: async () => ({ isAdmin: admin, access: { allowed: !revokeAtEnd || ++accountChecks < 2 }, account: { email: "owner@test" } }),
    allegro: async path => {
      calls.push(path); if (failA) throw new Error("Allegro fixture unavailable");
      if (path === "/seller-identity") return { sellerId: rotateA && ++identities > 1 ? "666" : "555" };
      assert.equal(new URL(path, "https://fixture.test").searchParams.get("status"), "", "Unified tabs must load ended offers too, not only ACTIVE");
      const offset = Number(new URL(path, "https://fixture.test").searchParams.get("offset"));
      return { totalCount: total, offers: Array.from({ length: Math.min(200, total - offset) }, (_, i) => ({ id: String(offset + i + 1), name: "part", status: "ACTIVE" })) };
    },
    transfers: async input => { assert.equal(input.operation, "statuses"); calls.push("journal"); return { ok: true, statuses: {} }; },
  };
  globalThis.fetch = async (path, options) => {
    calls.push(path);
    if (path.endsWith("/status")) return Response.json({ connected: true, verifiedAt: rotateO && ++connections > 1 ? "new" : "old" });
    const body = JSON.parse(options.body); assert.equal(options.method, "POST"); assert.equal(body.useSaved, true);
    if (body.operation === "statuses") return Response.json({ ok: true, readOnly: true, rows: [{ id: "0", name: "Na stanie" }] });
    assert.equal(body.operation, "inventory"); if (failO) return Response.json({ message: "Ovoko fixture unavailable" }, { status: 503 });
    const offset = (body.page - 1) * 100;
    return Response.json({ ok: true, readOnly: true, rows: Array.from({ length: Math.min(100, total - offset) }, (_, i) => ({ id: String(offset + i + 1), name: "part", status: "0" })), pagination: { page: body.page, limit: 100, total } });
  };
  const { loadCombinedInventory } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}#${generation++}`);
  const load = (previous, options) => loadCombinedInventory(previous, new AbortController().signal, () => {}, options);
  return { load, calls };
}
try {
  let test = await fixture(); let snapshot = await test.load();
  assert.equal(snapshot.allegro.length, 1501); assert.equal(snapshot.ovoko.length, 1501); assert.equal(snapshot.allegroComplete, true); assert.equal(snapshot.ovokoComplete, true); assert.deepEqual(snapshot.errors, []);
  test = await fixture({ total: 2050 }); snapshot = await test.load(); assert.equal(snapshot.allegro.length, 2000); assert.equal(snapshot.ovoko.length, 2000); assert.ok(!snapshot.allegroComplete && !snapshot.ovokoComplete);
  snapshot = await test.load(snapshot); assert.equal(snapshot.allegro.length, 2050); assert.equal(snapshot.ovoko.length, 2050); assert.ok(snapshot.allegroComplete && snapshot.ovokoComplete);
  test = await fixture({ total: 1, admin: false }); snapshot = await test.load(); assert.equal(snapshot.allegro.length, 1); assert.equal(snapshot.ovoko.length, 1); assert.ok(test.calls.includes("journal"), "Regular accounts load their own mappings");
  test = await fixture({ total: 1, failA: true }); snapshot = await test.load(); assert.equal(snapshot.allegro.length, 0); assert.equal(snapshot.ovoko.length, 1); assert.equal(snapshot.allegroComplete, false); assert.match(snapshot.errors[0], /Allegro/);
  test = await fixture({ total: 1, failO: true }); snapshot = await test.load(); assert.equal(snapshot.allegro.length, 1); assert.equal(snapshot.ovoko.length, 0); assert.equal(snapshot.ovokoComplete, false);
  test = await fixture({ total: 1, rotateA: true }); snapshot = await test.load(); assert.equal(snapshot.allegro.length, 0); assert.equal(snapshot.ovoko.length, 1); assert.deepEqual(snapshot.transfers, {});
  test = await fixture({ total: 1, rotateO: true }); snapshot = await test.load(); assert.equal(snapshot.ovoko.length, 0); assert.equal(snapshot.ovokoComplete, false);
  test = await fixture({ total: 1 }); snapshot = await test.load(); await assert.rejects(test.load({ ...snapshot, accountEmail: "other@test" }), /Konto Wystawiacza/);
  test = await fixture({ total: 1, admin: false, revokeAtEnd: true }); await assert.rejects(test.load(), /uprawnienia/);
  test = await fixture({ total: 401, admin: false }); let partial = 0; snapshot = await test.load(undefined, { partial: value => { partial++; assert.ok(value.allegro.length || value.ovoko.length); } }); assert.ok(partial >= 3);
  let before = test.calls.filter(p => p.startsWith("/inventory") || p === "journal" || p.endsWith("/read")).length;
  await test.load(); assert.equal(test.calls.filter(p => p.startsWith("/inventory") || p === "journal" || p.endsWith("/read")).length, before, "Navigation reuses an owner-scoped verified cache without fetching the full inventory");
  await test.load(undefined, { force: true }); assert.ok(test.calls.filter(p => p.startsWith("/inventory")).length > 3, "Explicit refresh bypasses the cache");
  before = test.calls.filter(p => p.startsWith("/inventory")).length; globalThis.fixture.owner = "another-owner"; await test.load(); assert.ok(test.calls.filter(p => p.startsWith("/inventory")).length > before, "No cache sharing between authenticated owners");
  console.log("Combined loader: 1501 records, bounded 2000-row chunks and continuation, read-only contracts, role isolation, separate provider failures and connection-change guards passed.");
} finally { globalThis.fetch = originalFetch; delete globalThis.fixture; }
