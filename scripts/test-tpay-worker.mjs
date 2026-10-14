import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { Miniflare } = await import(pathToFileURL(require.resolve("miniflare", { paths: [require.resolve("wrangler/package.json")] })).href);
const certs = [];
for (const name of ["notifications-jws.pem", "tpay-jws-root.pem"]) {
  const response = await fetch(`https://secure.sandbox.tpay.com/x509/${name}`);
  assert.equal(response.status, 200); certs.push(await response.text());
}
const mf = new Miniflare({ modules: true, compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], script: `
import { X509Certificate } from 'node:crypto';
export default { async fetch() {
  try {
    const leaf = new X509Certificate(${JSON.stringify(certs[0])});
    const root = new X509Certificate(${JSON.stringify(certs[1])});
    return Response.json({ ca: root.ca, verified: leaf.verify(root.publicKey) });
  } catch (error) { return Response.json({ error: error.message }, { status: 500 }); }
} };` });
try {
  const response = await mf.dispatchFetch("https://local.test");
  const result = await response.json(); console.log(result);
  assert.equal(response.status, 200); assert.equal(result.verified, true);
} finally { await mf.dispose(); }
