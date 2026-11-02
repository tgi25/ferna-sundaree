// Ferna Screenshots — IndexedDB storage for captures (history) and their edits.

const DB = 'ferna-screenshots', VER = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('captures')) db.createObjectStore('captures', { keyPath: 'id' }).createIndex('ts', 'ts');
      if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => { dbp = null; rej(r.error); };
  });
  return dbp;
}

function tx(stores, mode, fn) {
  return open().then((db) => new Promise((res, rej) => {
    const t = db.transaction(stores, mode);
    let out;
    Promise.resolve(fn(t)).then((v) => { out = v; });
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('Transaction aborted'));
  }));
}

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function putCapture(rec) { return tx(['captures'], 'readwrite', (t) => req(t.objectStore('captures').put(rec))); }
export function getCapture(id) { return tx(['captures'], 'readonly', (t) => req(t.objectStore('captures').get(id))); }
export function listCaptures() {
  return tx(['captures'], 'readonly', (t) => req(t.objectStore('captures').getAll()))
    .then((a) => a.sort((x, y) => y.ts - x.ts));
}
export function deleteCapture(id) {
  return tx(['captures', 'docs'], 'readwrite', (t) => { t.objectStore('captures').delete(id); t.objectStore('docs').delete(id); });
}
export function clearAll() {
  return tx(['captures', 'docs'], 'readwrite', (t) => { t.objectStore('captures').clear(); t.objectStore('docs').clear(); });
}
export function putDoc(id, doc) { return tx(['docs'], 'readwrite', (t) => req(t.objectStore('docs').put({ id, doc, ts: Date.now() }))); }
export function getDoc(id) { return tx(['docs'], 'readonly', (t) => req(t.objectStore('docs').get(id))).then((r) => r && r.doc); }

export async function prune(limit) {
  const all = await listCaptures();
  const extra = all.slice(Math.max(1, limit));
  for (const r of extra) await deleteCapture(r.id);
}
