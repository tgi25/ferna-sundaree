// Remembers file handles (File System Access API) per local document in IndexedDB,
// so a PDF opened from a file:// link can be overwritten with Ctrl+S after the user confirms the file once.
const DB = 'ferna-handles', STORE = 'handles';

function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => { resolve(req?.result); db.close(); };
    t.onerror = () => { reject(t.error); db.close(); };
  });
}

export async function getStoredHandle(key) {
  if (!key) return null;
  try { return (await tx('readonly', (s) => s.get(key))) || null; } catch { return null; }
}
export async function putStoredHandle(key, handle) {
  if (!key || !handle) return;
  try { await tx('readwrite', (s) => s.put(handle, key)); } catch (e) { console.warn('handle not stored', e); }
}
export async function deleteStoredHandle(key) {
  try { await tx('readwrite', (s) => s.delete(key)); } catch { /* ignore */ }
}

// Ask for read/write permission (must run inside a user gesture).
export async function ensureWritable(handle) {
  if (!handle.queryPermission) return true;
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}
