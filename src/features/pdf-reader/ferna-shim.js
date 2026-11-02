// Ferna Sundaree bridge for the built-in Ferna PDF Reader.
// The viewer code is the extension's own; this file supplies the few chrome.* APIs it
// uses, implemented over Ferna's IPC gate:
//   • chrome.storage.sync/local  → encrypted profile store in the browser
//   • chrome.runtime.connectNative('com.fernasolutions.pdf_saver') → the browser itself
//     plays the save helper, so Save overwrites local files with no extra install
//   • chrome.downloads           → saved straight into the Downloads folder
//   • fetch() of web/file PDFs   → read by the browser with the tab's own session
(() => {
  'use strict';
  const api = window.ferna;
  if (!api || api.host !== 'pdf') return;

  const cb = (p, done) => (typeof done === 'function' ? p.then(v => done(v), () => done(undefined)) : p);
  const area = name => ({
    get: (keys, done) => cb(api.cmd('pdf:storage', name, 'get', keys === undefined ? null : keys), done),
    set: (obj, done) => cb(api.cmd('pdf:storage', name, 'set', obj || {}), done),
    remove: (keys, done) => cb(api.cmd('pdf:storage', name, 'remove', keys), done),
    clear: done => cb(api.cmd('pdf:storage', name, 'clear', null), done),
  });

  const runtime = {
    lastError: undefined,
    id: 'ferna-pdf-reader',
    getManifest: () => ({ name: 'Ferna PDF Reader', version: '1.6.0', manifest_version: 3 }),
    getURL: p => new URL(p, 'ferna://pdf/').href,
    connectNative(host) {
      const onMsg = [];
      const onDisc = [];
      let chain = Promise.resolve();
      let open = host === 'com.fernasolutions.pdf_saver';
      const port = {
        name: host,
        onMessage: { addListener: f => onMsg.push(f), removeListener: f => { const i = onMsg.indexOf(f); if (i >= 0) onMsg.splice(i, 1); } },
        onDisconnect: { addListener: f => onDisc.push(f), removeListener: () => {} },
        postMessage(msg) {
          if (!open) throw new Error('Port closed');
          // Replies must arrive in order: the viewer matches them to a FIFO queue.
          chain = chain.then(() => api.cmd('pdf:helper', msg)).then(
            r => onMsg.forEach(f => f(r)),
            e => onMsg.forEach(f => f({ ok: false, error: String(e && e.message || e).replace(/^Error invoking remote method 'ferna': (Error: )?/, '') })),
          );
        },
        disconnect() { open = false; },
      };
      if (!open) setTimeout(() => { runtime.lastError = { message: 'Unknown native host' }; onDisc.forEach(f => f()); runtime.lastError = undefined; }, 0);
      return port;
    },
  };

  let nextDl = 1;
  const dlDone = new Map();
  const dlListeners = [];
  const downloads = {
    download(opts, done) {
      const p = (async () => {
        const res = await origFetch(opts.url);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const r = await api.cmd('pdf:download', String(opts.filename || 'document.pdf'), bytes, opts.conflictAction === 'overwrite', !!opts.saveAs);
        if (!r) throw new Error('Download canceled');
        const id = nextDl++;
        dlDone.set(id, r);
        setTimeout(() => dlListeners.forEach(f => f({ id, state: { previous: 'in_progress', current: 'complete' } })), 0);
        return id;
      })();
      if (typeof done !== 'function') return p;
      p.then(id => done(id), e => { runtime.lastError = { message: e.message }; try { done(undefined); } finally { runtime.lastError = undefined; } });
      return undefined;
    },
    search(q, done) {
      const r = dlDone.get(q && q.id);
      const items = r ? [{ id: q.id, filename: r, state: 'complete' }] : [];
      if (typeof done === 'function') done(items);
      return Promise.resolve(items);
    },
    erase(q, done) { dlDone.delete(q && q.id); if (typeof done === 'function') done([]); return Promise.resolve([]); },
    show() {},
    onChanged: { addListener: f => dlListeners.push(f), removeListener: f => { const i = dlListeners.indexOf(f); if (i >= 0) dlListeners.splice(i, 1); } },
  };

  window.chrome = { runtime, storage: { sync: area('sync'), local: area('local') }, downloads };

  // Web and local PDFs are read by the browser (with the tab's cookies); AI provider
  // and model-download requests go straight out, as the viewer expects.
  // Local AI servers (Ollama, LM Studio, llama.cpp) answer under /v1/ or /api/.
  const DIRECT = /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/(v1|api)\/|https:\/\/(api\.anthropic\.com|api\.openai\.com|huggingface\.co|[a-z0-9-]+\.hf\.co|cdn-lfs[a-z0-9.-]*\.huggingface\.co|raw\.githubusercontent\.com)\/)/i;
  const origFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input && input.url;
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (typeof url === 'string' && method === 'GET' && /^(https?|file):/i.test(url) && !DIRECT.test(url)) {
      return api.cmd('pdf:read', url).then(bytes => new Response(bytes, {
        status: 200, headers: { 'content-type': 'application/pdf', 'content-length': String(bytes.byteLength) },
      }));
    }
    return origFetch(input, init);
  };
})();
