// Ferna Feeds — connects the feed page (shared with Ferna Sundaree) to the extension:
// window.ferna.cmd(name, ...args) goes to the service worker; saving and opening files happen here.
(() => {
const listeners = new Map();
const on = (name, fn) => { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); };
chrome.runtime.onMessage.addListener(m => {
  if (m && m.t === 'refresh') for (const fn of listeners.get('refresh') || []) fn(m);
});
const call = (name, args) => chrome.runtime.sendMessage({ t: 'cmd', name, args }).then(r => {
  if (r && r.__error) throw new Error(r.__error);
  return r;
});
function download(text, name, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function pickFile(accept) {
  return new Promise(resolve => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept; i.hidden = true;
    i.onchange = async () => { const f = i.files[0]; i.remove(); if (!f) return resolve(null); if (f.size > 5 * 1024 * 1024) return resolve({ error: 'File too large' }); resolve({ text: await f.text() }); };
    document.body.append(i); i.click();
  });
}
const local = {
  async 'feeds:export-all'() { download(JSON.stringify(await call('feeds:export-data', []), null, 2), 'Ferna feeds and settings.json', 'application/json'); return { ok: true }; },
  async 'feeds:opml-export'() { download(await call('feeds:opml-data', []), 'Ferna feeds.opml', 'text/x-opml'); return { ok: true }; },
  async 'feeds:import-all'() { const f = await pickFile('.json,.opml,.xml,application/json,text/xml'); if (!f) return { ok: false }; if (f.error) return { ok: false, error: f.error }; return call('feeds:import-text', [f.text]); },
  async 'feeds:opml-import'() { const f = await pickFile('.opml,.xml,.txt,text/xml'); if (!f) return { ok: false }; if (f.error) return { ok: false, error: f.error }; return call('feeds:import-text', [f.text]); },
  async 'feeds:close-panel'() { window.close(); return true; },
};
window.ferna = { cmd: (name, ...args) => (local[name] ? local[name](...args) : call(name, args)), on };
document.documentElement.classList.add('ext');
})();
