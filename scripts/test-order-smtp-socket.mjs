import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const url = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const tls = url("export function connect(options) { return globalThis.__smtpSocketTest.connect(options); }");
const source = ts.transpileModule(await readFile(new URL("../lib/order-smtp.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  .replace('"node:tls"', JSON.stringify(tls)).replace('"nodemailer"', JSON.stringify(import.meta.resolve("nodemailer")));
const { orderSmtpSocket } = await import(url(`const setTimeout=(fn)=>globalThis.__smtpSocketTest.timer(fn); const clearTimeout=()=>{};\n${source}`));
const host = "serwer2684289.hosting-home.pl";
let socket, timeout, throwConnect = false;
globalThis.__smtpSocketTest = {
  connect(options) {
    assert.equal(options.host, host); assert.equal(options.servername, host);
    assert.equal(options.port, 465); assert.equal(options.rejectUnauthorized, true);
    assert.equal(options.minVersion, "TLSv1.2");
    if (throwConnect) throw new Error("connect failed");
    socket = Object.assign(new EventEmitter(), { authorized: true, destroyed: false, destroy() { this.destroyed = true; } });
    return socket;
  },
  timer(fn) { timeout = fn; return 1; },
};
try {
  let calls = [];
  const open = () => orderSmtpSocket(host, 465)({}, (...args) => calls.push(args));
  open(); assert.equal(calls.length, 0, "Do not hand socket over before verified TLS");
  socket.emit("secureConnect");
  assert.equal(calls.length, 1); assert.equal(calls[0][0], null);
  assert.equal(calls[0][1].connection, socket); assert.equal(calls[0][1].secured, true);
  calls = []; open(); socket.authorized = false; socket.emit("secureConnect");
  assert.equal(calls[0][0].code, "ETLS"); assert.equal(calls[0][1], undefined); assert.equal(socket.destroyed, true);
  calls = []; open(); socket.emit("error", Object.assign(new Error("certificate failed"), { code: "CERT_HAS_EXPIRED" }));
  socket.emit("secureConnect"); assert.equal(calls.length, 1); assert.equal(calls[0][0].command, "CONN");
  calls = []; open(); timeout();
  assert.equal(calls[0][0].code, "ETIMEDOUT"); assert.equal(socket.destroyed, true);
  calls = []; throwConnect = true; open();
  assert.equal(calls.length, 1); assert.equal(calls[0][0].command, "CONN");
} finally { delete globalThis.__smtpSocketTest; }
console.log("SMTP socket: hostname/SNI preserved, validated TLS only, errors and timeouts close once; no mail sent.");
