// Connection-only diagnostic: no credentials, AUTH, message or queue changes.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
const require = createRequire(import.meta.url);
const { build } = await import(pathToFileURL(require.resolve("esbuild", { paths: [require.resolve("wrangler/package.json")] })).href);
const { Miniflare } = await import(pathToFileURL(require.resolve("miniflare", { paths: [require.resolve("wrangler/package.json")] })).href);
const result = await build({ stdin: { resolveDir: process.cwd(), contents: `
import nodemailer from 'nodemailer';
import { connect } from 'node:tls';
import { orderSmtpSocket } from './lib/order-smtp.ts';
const host = 'serwer2684289.hosting-home.pl';
export default { async fetch(request) {
  if (new URL(request.url).pathname === '/tls') {
    return new Promise(resolve => {
      const socket = connect({ host, port: 465, servername: host, rejectUnauthorized: true });
      const timer = setTimeout(() => socket.destroy(new Error('timeout')), 10000);
      socket.once('data', data => { clearTimeout(timer); resolve(Response.json({ ok: true, authorized: socket.authorized, greeting: String(data).slice(0,3) })); socket.destroy(); });
      socket.once('error', error => { clearTimeout(timer); resolve(Response.json({ ok: false, code: error.code, message: error.message })); });
    });
  }
  const transport = nodemailer.createTransport({ host, port: 465, secure: true,
    ...(new URL(request.url).pathname === '/smtp-fixed' ? { getSocket: orderSmtpSocket(host,465) } : {}),
    tls: { servername: host, minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionTimeout: 10000, greetingTimeout: 5000, socketTimeout: 8000 });
  try { await transport.verify(); return Response.json({ ok: true, authenticated: false }); }
  catch (error) { return Response.json({ ok: false, code: error.code, command: error.command, message: error.message }); }
  finally { transport.close(); }
} };` }, bundle: true, write: false, platform: "neutral", format: "esm", external: ["node:*"], logLevel: "warning" });
const mf = new Miniflare({ modules: true, compatibilityDate: "2026-05-15", compatibilityFlags: ["nodejs_compat"], script: result.outputFiles[0].text,
  cf: false, cachePersist: false, sharedSecret: "connection-only-probe", defaultPersistRoot: path.resolve("outputs/smtp-probe") });
try {
  const results = {};
  for (const probe of ["tls", "smtp", "smtp-fixed"]) {
    const response = await mf.dispatchFetch(`https://probe.local/${probe}`);
    results[probe] = await response.json();
    console.log(probe, results[probe]);
  }
  if (!results["smtp-fixed"].ok) throw new Error("Hostname-preserving SMTP connection failed in workerd");
} finally { await mf.dispose(); }
