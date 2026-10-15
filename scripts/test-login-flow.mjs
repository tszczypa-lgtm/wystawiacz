import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = ts.transpileModule(readFileSync(new URL("../app/login/login-form.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
let state, cursor, effects, callback, unsubscribed, clients, signup, signedIn;
const moves = [];
globalThis.window = { location: { origin: "https://example.test", pathname: "/login", search: "", hash: "", assign: p => moves.push(p), replace: p => moves.push(p) }, history: { replaceState() {} } };
const hooks = {
  useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], v => { state[i] = v; }]; },
  useRef(initial) { const i = cursor++; return state[i] ??= { current: initial }; },
  useEffect(fn) { if (!effects.length) effects.push(fn()); },
};
const auth = {
  onAuthStateChange(fn) { callback = fn; return { data: { subscription: { unsubscribe() { unsubscribed++; } } } }; },
  async signUp(args) { signup = args; return { data: { session: null }, error: null }; },
  async signInWithPassword(args) { signedIn = args; return { data: { session: {} }, error: null }; },
};
const module = { exports: {} };
new Function("require", "module", "exports", source)(name => {
  if (name === "react") return hooks;
  if (name === "@/lib/supabase") return { createSupabaseBrowserClient() { clients++; return { auth }; } };
  if (name === "@/lib/account-validation") return { emptyCompany: {}, validateSignup() { return { customerType: "person" }; } };
  if (name === "@/components/company-fields") return { CompanyFields() {} };
  return require(name);
}, module, module.exports);
function reset() { state = []; cursor = 0; effects = []; unsubscribed = 0; clients = 0; moves.length = 0; }
function render() { cursor = 0; return module.exports.LoginForm(); }
function nodes(tree) { if (!tree || typeof tree !== "object") return []; return [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)]; }
function button(tree, text) { return nodes(tree).find(n => n.type === "button" && n.props.children === text); }
reset();
let tree = render();
button(tree, "Nie mam konta - zaloz nowe").props.onClick();
tree = render();
nodes(tree).find(n => n.type === "input" && n.props.type === "email").props.onChange({ target: { value: "test@example.test" } });
tree = render();
await tree.props.onSubmit({ preventDefault() {} });
tree = render();
assert.equal(tree.type, "section");
assert.equal(nodes(tree).some(n => n.type === "form"), false);
assert.ok(button(tree, "Przejdz do logowania"));
assert.equal(signup.options.emailRedirectTo, "https://example.test/login");
assert.equal(clients, 1);
callback("SIGNED_IN", { user: {} });
assert.deepEqual(moves, ["/panel"]);
button(tree, "Przejdz do logowania").props.onClick();
tree = render();
assert.equal(tree.type, "form");
assert.ok(nodes(tree).some(n => n.type === "input" && n.props.type === "email" && n.props.value === "test@example.test"));
await tree.props.onSubmit({ preventDefault() {} });
assert.equal(signedIn.email, "test@example.test");
effects[0](); assert.equal(unsubscribed, 1);
reset(); render(); callback("INITIAL_SESSION", { user: {} }); assert.deepEqual(moves, ["/panel"]);
reset(); render(); callback("INITIAL_SESSION", null); assert.deepEqual(moves, []);
console.log("Login flow: pending-confirmation screen, retained email, login, session/cross-tab callback, single client and cleanup passed (mocked component hooks).");
