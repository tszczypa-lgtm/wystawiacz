import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../public/wystawiacz/app.js", import.meta.url), "utf8");
const ast = ts.createSourceFile("app.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const helpers = ast.statements.filter(ts.isFunctionDeclaration)
  .filter(fn => ["rotatePreviewPhoto", "applyPhotoRotation", "restorePhotoRotations"].includes(fn.name.text))
  .map(fn => fn.getText(ast)).join("\n");
const original = new File(["original"], "photo2.jpg", { type: "image/jpeg" });
const photo = { name: original.name, file: original, url: "initial" };
const other = { name: "photo1.jpg" };
const selected = [other.name, photo.name];
const products = [{ photoNames: [...selected] }];
const calls = [];
let fail = false;
const context = vm.createContext({
  state: { localPhotosByName: new Map([[other.name, other], [photo.name, photo]]), photoRotations: new Map(), selectedPhotoNames: selected, products },
  previewPhotoName: photo.name, File,
  URL: { createObjectURL: file => { calls.push(file); return `blob:${calls.length}`; }, revokeObjectURL() {} },
  Image: class { naturalWidth = 400; naturalHeight = 200; async decode() { if (fail) throw new Error("decode failed"); } },
  document: { createElement: () => ({ getContext: () => ({ translate() {}, rotate() {}, drawImage() {} }), toBlob: callback => callback(new Blob(["rotated"])) }) },
  renderPhotos() {}, renderProducts() {}, showToast() {}
});
vm.runInContext(helpers, context);
for (let i = 0; i < 4; i++) await vm.runInContext("rotatePreviewPhoto(1)", context);
assert.equal(photo.file, original, "Four rotations restore the original file");
assert.equal(context.state.photoRotations.get(photo.name), 0);
assert.deepEqual([...context.state.localPhotosByName.keys()], [other.name, photo.name]);
assert.deepEqual(context.state.selectedPhotoNames, selected);
assert.deepEqual(products[0].photoNames, selected);
assert.ok(calls.filter(file => file === original).length >= 4, "Each rotation reads the original");
await vm.runInContext("rotatePreviewPhoto(-1)", context);
assert.equal(context.state.photoRotations.get(photo.name), 3);
assert.equal(photo.file.name, original.name);
assert.equal(photo.file.type, "image/jpeg");
const beforeFailure = photo.file;
fail = true;
await vm.runInContext("rotatePreviewPhoto(-1)", context);
assert.equal(photo.file, beforeFailure);
assert.equal(context.state.photoRotations.get(photo.name), 3);
assert.equal(photo.rotating, false);
assert.ok(source.includes("photoRotations: [...state.photoRotations]"));
assert.ok(source.includes("await restorePhotoRotations()"));
console.log("Photo rotation: original preserved, filename/order/main photo unchanged, left/right and failure handling passed.");
