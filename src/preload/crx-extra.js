'use strict';
// Extension API fixes for Ferna Sundaree. Registered on the web session right after the
// electron-chrome-extensions preload, so it runs after that library has built `chrome`.
//
// chrome.privacy: the library defines the settings objects but their get/set/clear do nothing
// and never call back, so any extension that waits for them hangs (LastPass's login waits on
// privacy.services.passwordSavingEnabled.get and shows a spinner forever). Here they answer
// like Chrome does. Ferna has no built-in password manager, autofill or prediction service, so
// those settings read as off and are "controllable_by_this_extension"; changes are accepted and
// kept for the life of the extension context.
//
// browser: see mainWorld().
//
// extras(): chrome.storage.sync as its own area (the library makes it the same object as local,
// so a change was reported as 'local' and extensions listening for 'sync' missed it),
// chrome.tabs.onZoomChange and captureVisibleTab, chrome.downloads (the library's are stubs that
// do nothing), action.setBadgeTextColor. Their main-process side is src/main/crxmore.js; the
// bridge they use (__fernaCrx) comes from crx-early.js and is removed from the page here.
//
// Runs only in extension service workers and chrome-extension:// pages, like the library.

const { contextBridge, webFrame } = require('electron');

function mainWorld() {
  // (Inside mainWorld: this function is sent to the page as text, so it cannot see the file's other functions.)
  function extras() {
    const chrome = globalThis.chrome;
    const B = globalThis.__fernaCrx;
    try { delete globalThis.__fernaCrx; } catch { /* not configurable */ }
    if (!chrome || !chrome.runtime || !chrome.runtime.id) return;
    const id = chrome.runtime.id;
    const m = (typeof chrome.runtime.getManifest === 'function' && chrome.runtime.getManifest()) || {};
    const perms = m.permissions || [];
    const later = fn => (typeof queueMicrotask === 'function' ? queueMicrotask(fn) : setTimeout(fn, 0));
    const withCb = (p, cb) => { if (typeof cb !== 'function') return p; p.then(v => later(() => cb(v)), () => later(() => cb())); return undefined; };
    const ev = name => ({
      addListener: cb => B && B.on(id, name, cb), removeListener: cb => B && B.off(id, name, cb),
      hasListener: cb => !!B && B.has(id, name, cb), hasListeners: () => !!B && B.has(id, name),
    });
    const call = (name, ...args) => (B ? B.invoke(id, name, ...args) : Promise.reject(new Error(`${name} is not available`)));
  
    // ---- storage.sync: its own area, kept in local storage under a prefix ----
    const S = chrome.storage;
    if (S && S.local && (!S.sync || S.sync === S.local) && perms.includes('storage')) {
      const L = S.local;
      const P = '\u0001ferna-sync:';
      const isSync = k => typeof k === 'string' && k.startsWith(P);
      const strip = o => { const out = {}; for (const [k, v] of Object.entries(o || {})) if (isSync(k)) out[k.slice(P.length)] = v; return out; };
      const onlyLocal = o => { const out = {}; for (const [k, v] of Object.entries(o || {})) if (!isSync(k)) out[k] = v; return out; };
      const keyList = keys => (keys == null ? null : typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys));
      const syncArea = {
        QUOTA_BYTES: 102400, QUOTA_BYTES_PER_ITEM: 8192, MAX_ITEMS: 512, MAX_WRITE_OPERATIONS_PER_HOUR: 1800, MAX_WRITE_OPERATIONS_PER_MINUTE: 120,
        get(keys, cb) {
          if (typeof keys === 'function') { cb = keys; keys = null; }
          const list = keyList(keys);
          const p = (list ? L.get(list.map(k => P + k)) : L.get(null)).then(r => {
            const got = strip(r);
            if (keys && typeof keys === 'object' && !Array.isArray(keys)) for (const [k, v] of Object.entries(keys)) if (!(k in got)) got[k] = v;
            return got;
          });
          return withCb(p, cb);
        },
        set(items, cb) { const o = {}; for (const [k, v] of Object.entries(items || {})) o[P + k] = v; return withCb(L.set(o), cb); },
        remove(keys, cb) { return withCb(L.remove((keyList(keys) || []).map(k => P + k)), cb); },
        clear(cb) { return withCb(L.get(null).then(r => L.remove(Object.keys(r).filter(isSync))), cb); },
        getBytesInUse(keys, cb) { if (typeof keys === 'function') { cb = keys; keys = null; } return withCb(this.get(keys).then(o => new TextEncoder().encode(JSON.stringify(o)).length), cb); },
        setAccessLevel: () => Promise.resolve(),
        getKeys(cb) { return withCb(this.get(null).then(o => Object.keys(o)), cb); },
      };
      const localArea = Object.create(L);
      Object.assign(localArea, {
        get(keys, cb) { if (typeof keys === 'function') { cb = keys; keys = null; } return withCb(L.get(keys).then(r => (keys == null ? onlyLocal(r) : r)), cb); },
        set: (items, cb) => withCb(L.set(items), cb),
        remove: (keys, cb) => withCb(L.remove(keys), cb),
        clear: cb => withCb(L.get(null).then(r => L.remove(Object.keys(r).filter(k => !isSync(k)))), cb),
        getKeys(cb) { return withCb(L.get(null).then(r => Object.keys(onlyLocal(r))), cb); },
      });
      // One native listener, split into 'local' and 'sync' changes.
      const native = S.onChanged;
      const fan = { all: new Set(), local: new Set(), sync: new Set() };
      let hooked = false;
      const hook = () => {
        if (hooked || !native) return;
        hooked = true;
        native.addListener((changes, area) => {
          if (area !== 'local') { for (const f of [...fan.all]) f(changes, area); return; }
          const lc = onlyLocal(changes), sc = strip(changes);
          if (Object.keys(lc).length) { for (const f of [...fan.all]) f(lc, 'local'); for (const f of [...fan.local]) f(lc); }
          if (Object.keys(sc).length) { for (const f of [...fan.all]) f(sc, 'sync'); for (const f of [...fan.sync]) f(sc); }
        });
      };
      const evOf = set => ({ addListener: f => { if (typeof f === 'function') { set.add(f); hook(); } }, removeListener: f => set.delete(f), hasListener: f => set.has(f), hasListeners: () => set.size > 0 });
      syncArea.onChanged = evOf(fan.sync);
      localArea.onChanged = evOf(fan.local);
      try {
        S.sync = syncArea; S.local = localArea; S.onChanged = evOf(fan.all);
      } catch (e) { console.error('Ferna: storage.sync could not be separated', e); }
    }
  
    // ---- runtime.onInstalled / onStartup: sent by Ferna (Electron sends neither) ----
    if (chrome.runtime && B) {
      try { chrome.runtime.onInstalled = ev('runtime.onInstalled'); chrome.runtime.onStartup = ev('runtime.onStartup'); } catch { /* read-only */ }
    }

    // ---- tabs: zoom events and a picture of the visible tab ----
    if (chrome.tabs && B) {
      try { chrome.tabs.onZoomChange = ev('tabs.onZoomChange'); } catch { /* read-only */ }
      chrome.tabs.captureVisibleTab = (...args) => {
        const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
        let windowId = null, options = {};
        if (typeof args[0] === 'number' || args[0] === null) { windowId = args[0]; options = args[1] || {}; } else options = args[0] || {};
        return withCb(call('tabs.captureVisibleTab', windowId, options), cb);
      };
    }
  
    // ---- downloads ----
    if (chrome.downloads && perms.includes('downloads') && B) {
      const D = chrome.downloads;
      D.download = (o, cb) => withCb((async () => {
        if (!o || typeof o.url !== 'string') throw new Error('Invalid download');
        const req = { url: o.url, filename: typeof o.filename === 'string' ? o.filename : '', saveAs: !!o.saveAs, conflictAction: o.conflictAction || 'uniquify' };
        // blob: and data: addresses only exist in this extension's own context: send the bytes.
        if (/^(blob|data):/i.test(o.url)) {
          const r = await fetch(o.url);
          req.bytes = new Uint8Array(await r.arrayBuffer());
          req.mime = r.headers.get('content-type') || '';
          req.url = '';
        }
        return call('downloads.download', req);
      })(), cb);
      D.show = (dlId, cb) => withCb(call('downloads.show', dlId), cb);
      D.showDefaultFolder = cb => withCb(call('downloads.showDefaultFolder'), cb);
      D.search = (q, cb) => withCb(call('downloads.search', q || {}), cb);
      D.onCreated = ev('downloads.onCreated');
      D.onChanged = ev('downloads.onChanged');
    }
  
    // ---- action: badge text colour (Chrome 110) is accepted; Ferna draws badge text in white ----
    for (const a of [chrome.action, chrome.browserAction]) {
      if (a && typeof a.setBadgeTextColor !== 'function') { try { a.setBadgeTextColor = (d, cb) => withCb(Promise.resolve(), cb); } catch { /* frozen */ } }
    }
  }

  const chrome = globalThis.chrome;
  if (!chrome) return;
  try { extras(); } catch (e) { console.error('Ferna extension API extras failed', e); }
  // Chromium also exposes a native `browser` namespace, separate from `chrome` and without the
  // APIs the library adds (windows, contextMenus, action, notifications …). Cross-browser
  // extensions such as LastPass prefer `browser` when it exists, find browser.windows missing
  // and crash at start-up. Make `browser` the same object as `chrome`.
  if (globalThis.browser !== chrome) {
    try { Object.defineProperty(globalThis, 'browser', { value: chrome, writable: true, configurable: true, enumerable: false }); }
    catch { try { globalThis.browser = chrome; } catch { /* leave it */ } }
  }
  if (!chrome.privacy) return;
  // Values Ferna reports. "Off" for features Ferna does not have; WebRTC uses Chrome's default.
  const DEFAULTS = {
    'network.networkPredictionEnabled': false,
    'network.webRTCIPHandlingPolicy': 'default',
    'services.autofillAddressEnabled': false,
    'services.autofillCreditCardEnabled': false,
    'services.passwordSavingEnabled': false,
    'websites.hyperlinkAuditingEnabled': false,
  };
  const later = fn => (typeof queueMicrotask === 'function' ? queueMicrotask(fn) : setTimeout(fn, 0));
  const answer = (cb, value) => {
    if (typeof cb === 'function') { later(() => cb(value)); return undefined; }
    return Promise.resolve(value);
  };
  for (const [key, initial] of Object.entries(DEFAULTS)) {
    const [group, name] = key.split('.');
    const setting = chrome.privacy[group] && chrome.privacy[group][name];
    if (!setting || setting.__ferna) continue;
    let value = initial;
    let changed = false;
    const listeners = [];
    const state = () => ({ value, levelOfControl: changed ? 'controlled_by_this_extension' : 'controllable_by_this_extension' });
    const emit = () => { const s = state(); listeners.slice().forEach(l => { try { l(s); } catch (e) { console.error(e); } }); };
    Object.defineProperties(setting, {
      __ferna: { value: true },
      get: { value: (details, cb) => answer(typeof details === 'function' ? details : cb, state()), configurable: true },
      set: {
        value: (details, cb) => {
          if (details && 'value' in details && typeof details.value === typeof initial) { value = details.value; changed = true; emit(); }
          return answer(cb, undefined);
        },
        configurable: true,
      },
      clear: {
        value: (details, cb) => { value = initial; changed = false; emit(); return answer(typeof details === 'function' ? details : cb, undefined); },
        configurable: true,
      },
      onChange: {
        value: {
          addListener: l => { if (typeof l === 'function') listeners.push(l); },
          removeListener: l => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); },
          hasListener: l => listeners.includes(l),
          hasListeners: () => listeners.length > 0,
        },
        configurable: true,
      },
    });
  }
}

if (process.type === 'service-worker' || (typeof location !== 'undefined' && location.href.startsWith('chrome-extension://'))) {
  try {
    if (!process.contextIsolated) mainWorld();
    else if ('executeInMainWorld' in contextBridge) contextBridge.executeInMainWorld({ func: mainWorld, args: [] });
    else webFrame.executeJavaScript(`(${mainWorld})();`);
  } catch (e) {
    console.error('Ferna extension API fixes failed', e);
  }
}
