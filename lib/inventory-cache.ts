import type { CombinedSnapshot } from "./combined-inventory";
type Cached = { owner: string; savedAt: number; snapshot: CombinedSnapshot };
let memory: Cached | undefined;
async function store<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  if (typeof indexedDB === "undefined") return;
  return new Promise(resolve => {
    const open = indexedDB.open("wystawiacz-inventory-v1", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("snapshots");
    open.onerror = () => resolve(undefined);
    open.onblocked = () => resolve(undefined);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction("snapshots", mode), request = run(tx.objectStore("snapshots"));
      let value: T | undefined;
      request.onsuccess = () => { value = request.result; };
      tx.oncomplete = () => { db.close(); resolve(value); };
      tx.onerror = tx.onabort = () => { db.close(); resolve(undefined); };
    };
  });
}
export async function readInventoryCache(owner: string) {
  const cached = memory?.owner === owner ? memory : await store("readonly", s => s.get(owner)) as Cached | undefined;
  if (!cached || cached.owner !== owner || Date.now() - cached.savedAt > 5 * 60000 || cached.savedAt > Date.now()) return;
  memory = cached;
  return structuredClone(cached.snapshot);
}
export async function writeInventoryCache(owner: string, snapshot: CombinedSnapshot) {
  if (snapshot.errors.length) return;
  const cached = { owner, savedAt: Date.now(), snapshot: structuredClone(snapshot) };
  memory = cached;
  await store("readwrite", s => s.put(cached, owner));
}
export async function clearInventoryCache(owner: string) {
  if (memory?.owner === owner) memory = undefined;
  await store("readwrite", s => s.delete(owner));
}
