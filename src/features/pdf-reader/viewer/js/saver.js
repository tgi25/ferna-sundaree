// Silent saving without Save dialogs.
//  • Local files (file://…): through the "Ferna PDF save helper" (a small native-messaging host installed once).
//  • Web PDFs: through chrome.downloads into the Downloads folder (first time: a new unique name; afterwards the
//    same file is overwritten).
const HOST = 'com.fernasolutions.pdf_saver';
const CHUNK = 512 * 1024; // raw bytes per message (≈ 700 KB base64)

const hasRuntime = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.connectNative;

// --------------------------------------------------------------- native helper connection (kept open)
let port = null;
let queue = [];     // pending {resolve, reject}
let lastError = '';

function connect() {
  if (port) return port;
  if (!hasRuntime) throw new Error('Native messaging is not available.');
  port = chrome.runtime.connectNative(HOST);
  port.onMessage.addListener((msg) => {
    const p = queue.shift();
    if (!p) return;
    if (msg && msg.ok) p.resolve(msg); else p.reject(new Error(msg?.error || 'Save helper error'));
  });
  port.onDisconnect.addListener(() => {
    lastError = chrome.runtime.lastError?.message || 'Save helper disconnected';
    port = null;
    const q = queue; queue = [];
    for (const p of q) p.reject(new Error(lastError));
  });
  return port;
}

function call(msg, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let p;
    try { p = connect(); } catch (e) { reject(e); return; }
    const t = setTimeout(() => reject(new Error('Save helper did not respond.')), timeoutMs);
    queue.push({ resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
    try { p.postMessage(msg); } catch (e) { queue.pop(); clearTimeout(t); reject(e); }
  });
}

let availability = null; // cached promise
export function helperAvailable(force = false) {
  if (force) availability = null;
  availability ||= call({ cmd: 'ping' }, 6000).then(() => true, () => { availability = null; return false; });
  return availability;
}

function toBase64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function writeWithHelper(path, bytes, onProgress, { create = false } = {}) {
  await call({ cmd: 'begin', path, create });
  try {
    for (let o = 0; o < bytes.length; o += CHUNK) {
      await call({ cmd: 'chunk', data: toBase64(bytes.subarray(o, o + CHUNK)) });
      onProgress?.(Math.min(1, (o + CHUNK) / bytes.length));
    }
    return await call({ cmd: 'commit', size: bytes.length });
  } catch (e) {
    call({ cmd: 'abort' }).catch(() => {});
    throw e;
  }
}

function fromBase64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Read a PDF from disk through the helper (Firefox cannot read file:// URLs from an extension).
export async function readWithHelper(path, onProgress) {
  let msg = await call({ cmd: 'read', path, offset: 0, length: CHUNK }, 30000);
  const size = Number(msg.size) || 0;
  const out = new Uint8Array(size);
  let o = 0;
  for (;;) {
    const part = fromBase64(msg.data || '');
    out.set(part.subarray(0, Math.max(0, size - o)), o);
    o += part.length;
    onProgress?.(size ? Math.min(1, o / size) : 1);
    if (o >= size || !part.length) break;
    msg = await call({ cmd: 'read', path, offset: o, length: CHUNK }, 30000);
  }
  return o >= size ? out : out.subarray(0, o);
}

// The helper's own Windows Open / Save As window (Firefox has no File System Access API).
// Returns the chosen absolute path, or null when cancelled.
export async function helperPick(kind, name = '') {
  const msg = await call({ cmd: kind === 'save' ? 'pickSave' : 'pickOpen', name }, 15 * 60 * 1000);
  return msg.path || null;
}

// C:\Users\me\a b.pdf → file:///C:/Users/me/a%20b.pdf ;  \\server\share\x.pdf → file://server/share/x.pdf
export function pathToFileUrl(p) {
  const enc = (s) => s.split('/').map((seg, i) => (i === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg))).join('/');
  if (p.startsWith('\\\\')) { const rest = p.slice(2).replace(/\\/g, '/'); const k = rest.indexOf('/'); return 'file://' + rest.slice(0, k) + enc(rest.slice(k)).replace(/^%2F/, '/'); }
  return 'file:///' + enc(p.replace(/\\/g, '/').replace(/^\//, ''));
}

// file:///C:/Users/me/a%20b.pdf → C:\Users\me\a b.pdf ;  file://server/share/x.pdf → \\server\share\x.pdf
export function fileUrlToPath(url) {
  const u = new URL(url);
  let p = decodeURIComponent(u.pathname);
  const isWin = /^\/[A-Za-z]:/.test(p) || u.host;
  if (u.host) return '\\\\' + u.host + p.replace(/\//g, '\\');
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
  return isWin ? p.replace(/\//g, '\\') : p;
}

// --------------------------------------------------------------- downloads (web PDFs)
const hasDownloads = typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.download;
export const canDownloadSilently = () => !!hasDownloads;

// Saves into the Downloads folder. relName: file name relative to Downloads.
// Returns the absolute path of the written file.
// askWhere: show the browser's Save As window (resolves null when cancelled).
export function saveToDownloads(bytes, relName, overwrite, askWhere = false) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    chrome.downloads.download({ url, filename: relName, conflictAction: overwrite ? 'overwrite' : 'uniquify', saveAs: askWhere }, (id) => {
      const err = chrome.runtime.lastError?.message;
      if (askWhere && (id == null || /cancel/i.test(err || ''))) { URL.revokeObjectURL(url); resolve(null); return; }
      if (err || id == null) { URL.revokeObjectURL(url); reject(new Error(err || 'Download failed')); return; }
      const done = (delta) => {
        if (delta.id !== id || !delta.state) return;
        if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
          chrome.downloads.onChanged.removeListener(done);
          URL.revokeObjectURL(url);
          chrome.downloads.search({ id }, (items) => {
            const it = items && items[0];
            if (delta.state.current === 'interrupted' || !it) { reject(new Error('Saving was interrupted (' + (it?.error || 'unknown') + ')')); return; }
            resolve(it.filename);
            chrome.downloads.erase({ id }); // keep the downloads list tidy; the file stays on disk
          });
        }
      };
      chrome.downloads.onChanged.addListener(done);
    });
  });
}
