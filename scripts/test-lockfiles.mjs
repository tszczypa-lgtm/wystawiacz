import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const yaml = require(require.resolve("js-yaml", { paths: [require.resolve("eslint/package.json")] }));
const manifestText = await readFile(path.join(root, "package.json"), "utf8");
const manifest = JSON.parse(manifestText);
const npm = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
const pnpmText = await readFile(path.join(root, "pnpm-lock.yaml"), "utf8");
const pnpm = yaml.load(pnpmText);

for (const group of ["dependencies", "devDependencies"]) {
  assert.deepEqual(Object.keys(pnpm.importers["."][group]).sort(), Object.keys(manifest[group]).sort());
  assert.deepEqual(npm.packages[""][group], manifest[group]);
  for (const [name, spec] of Object.entries(manifest[group])) {
    assert.equal(pnpm.importers["."][group][name].specifier, spec, `pnpm spec mismatch: ${name}`);
  }
}
const version = manifest.dependencies.nodemailer;
assert.equal(pnpm.importers["."].dependencies.nodemailer.version, version);
assert.ok(pnpm.snapshots[`nodemailer@${version}`]);
assert.equal(pnpm.packages[`nodemailer@${version}`].resolution.integrity, npm.packages["node_modules/nodemailer"].integrity);

if (process.env.PNPM_CLI) {
  // No node_modules from the user's workspace is removed or reinstalled.
  const fixtures = path.join(root, "outputs", "lockfile-check");
  const bad = structuredClone(pnpm);
  delete bad.importers["."].dependencies.nodemailer;
  for (const [name, text] of [["outdated", yaml.dump(bad)]]) {
    const cwd = path.join(fixtures, name);
    await mkdir(cwd, { recursive: true });
    await writeFile(path.join(cwd, "package.json"), manifestText);
    await writeFile(path.join(cwd, "pnpm-lock.yaml"), text);
    const result = spawnSync(process.execPath, [process.env.PNPM_CLI, "--dir", cwd, "install", "--ignore-workspace", "--frozen-lockfile", "--offline", "--ignore-scripts", "--store-dir", path.join(fixtures, "store"), "--reporter=append-only"], {
      cwd, encoding: "utf8", timeout: 60000, windowsHide: true, env: { ...process.env, CI: "true" },
    });
    const output = result.stdout + result.stderr;
    assert.notEqual(result.status, 0, "Frozen check must reject the previous lockfile");
    assert.match(output, /ERR_PNPM_OUTDATED_LOCKFILE/, output || String(result.error));
    console.log("pnpm frozen lockfile regression: missing Nodemailer rejected as expected");
  }
}
console.log("npm/pnpm lockfiles match package.json; SMTP dependency and integrity are present. No full dependency install or deployment performed.");
