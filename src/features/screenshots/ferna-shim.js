// Ferna Sundaree bridge for the built-in Ferna Screenshots editor, history and settings.
// The browser captures pages itself (no content script, no capture-rate limit) and hands
// the image to the extension's own editor through its IndexedDB history.
(() => {
  'use strict';
  const api = window.ferna;
  if (!api || api.host !== 'shots') return;

  const listeners = [];
  window.chrome = {
    runtime: {
      getURL: p => new URL(p, 'ferna://shots/').href,
      openOptionsPage: () => api.cmd('shots:open', 'ferna://shots/options.html'),
      getManifest: () => ({ name: 'Ferna Screenshots', version: '1.0.0' }),
    },
    storage: {
      sync: {
        get: keys => api.cmd('shots:storage', 'get', keys === undefined ? null : keys),
        set: obj => api.cmd('shots:storage', 'set', obj || {}),
      },
    },
    tabs: { create: ({ url }) => api.cmd('shots:open', String(url)) },
    commands: { getAll: () => api.cmd('shots:commands') },
    downloads: {
      async download({ url, filename, saveAs }) {
        const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
        const r = await api.cmd('shots:download', String(filename || 'screenshot.png'), bytes, !!saveAs);
        if (!r) throw new Error('Download canceled');
        setTimeout(() => listeners.forEach(f => f({ id: r.id, state: { previous: 'in_progress', current: 'complete' } })), 0);
        return r.id;
      },
      show: id => api.cmd('shots:reveal', id),
      onChanged: { addListener: f => listeners.push(f), removeListener: f => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); } },
    },
  };

  // A capture handed over by the browser: ?id=<browser shot id>&import=1
  const q = new URLSearchParams(location.search);
  if (!/\/editor\.html$/.test(location.pathname) || q.get('import') !== '1') return;
  window.__fernaReady = (async () => {
    const id = q.get('id');
    const db = await import('./lib/db.js');
    if (await db.getCapture(id)) return;
    const meta = await api.cmd('shot:meta', id);
    if (!meta) return;
    const blob = await (await fetch(meta.src)).blob();
    const bmp = await createImageBitmap(blob);
    const tw = Math.min(360, bmp.width);
    const th = Math.max(1, Math.min(1200, Math.round(bmp.height * (tw / bmp.width))));
    const c = new OffscreenCanvas(tw, th);
    const cx = c.getContext('2d');
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(bmp, 0, 0, bmp.width, Math.min(bmp.height, th * (bmp.width / tw)), 0, 0, tw, th);
    const thumb = await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    const rec = {
      id, ts: Date.parse(meta.time) || Date.now(), url: meta.url || '', title: meta.title || '',
      width: bmp.width, height: bmp.height, blob, thumb, mode: meta.mode || 'visible',
      scale: meta.scale || 1, cssW: meta.cssW || bmp.width, cssH: meta.cssH || bmp.height,
      downscaled: !!meta.downscaled, truncated: !!meta.truncated,
    };
    await db.putCapture(rec);
    const { getSettings } = await import('./lib/settings.js');
    const st = await getSettings();
    db.prune(st.historyLimit || 40).catch(() => {});
    history.replaceState(null, '', `editor.html?id=${encodeURIComponent(id)}`);
    if (q.get('quick') === '1') {
      // "Save immediately" mode: export with the stamp, save, and close this tab.
      const { exportBlob } = await import('./lib/export.js');
      const { buildFilename } = await import('./lib/util.js');
      const doc = { objects: [], crop: null, stamp: st.stamp };
      const { blob: out, ext } = await exportBlob(bmp, doc, rec, st, st.quickFormat, null);
      const bytes = new Uint8Array(await out.arrayBuffer());
      await api.cmd('shots:download', buildFilename(st.filePattern, rec, ext, st.folder), bytes, !!st.saveAs);
      api.cmd('shots:quickDone', 'Screenshot saved to Downloads/' + (st.folder || ''));
    }
  })().catch(e => console.error('Ferna import failed', e));
})();
