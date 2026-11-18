'use strict';
// Ferna Sundaree — extension API bridge, registered BEFORE the electron-chrome-extensions preload.
// That library freezes `chrome` once it has added its APIs, so namespaces it does not know
// (chrome.sidePanel) must be added first. crx-extra.js (registered after it) adds the rest.
//
// The bridge calls Ferna's handlers through the library's own router channel ('crx-msg' with
// the extension's id), so every call is checked for the calling extension and its permissions
// in the main process (src/main/crxmore.js). Runs only in extension service workers and
// chrome-extension:// pages.

const { contextBridge, ipcRenderer, webFrame } = require('electron');

const listeners = new Map(); // event name → Set of callbacks
const bridge = {
  invoke: (extId, name, ...args) => ipcRenderer.invoke('crx-msg', extId, name, ...args),
  on(extId, name, cb) {
    if (typeof cb !== 'function') return;
    let set = listeners.get(name);
    if (!set) {
      set = new Set();
      listeners.set(name, set);
      ipcRenderer.send('crx-add-listener', extId, name);
      ipcRenderer.on(`crx-${name}`, (e, ...args) => { for (const f of [...set]) { try { f(...args); } catch (err) { console.error(err); } } });
    }
    set.add(cb);
  },
  off(extId, name, cb) { const set = listeners.get(name); if (set) set.delete(cb); },
  has(extId, name, cb) { const set = listeners.get(name); return !!set && (cb ? set.has(cb) : set.size > 0); },
};

function mainWorld() {
  const chrome = globalThis.chrome;
  const B = globalThis.__fernaCrx;
  if (!chrome || !B || !chrome.runtime || !chrome.runtime.id || typeof chrome.runtime.getManifest !== 'function') return;
  const id = chrome.runtime.id;
  const m = chrome.runtime.getManifest() || {};
  if (!(m.permissions || []).includes('sidePanel') || chrome.sidePanel) return;
  const call = name => (...args) => {
    const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    const p = B.invoke(id, name, ...args);
    if (!cb) return p;
    p.then(v => cb(v), () => cb());
    return undefined;
  };
  const ev = name => ({
    addListener: cb => B.on(id, name, cb), removeListener: cb => B.off(id, name, cb),
    hasListener: cb => B.has(id, name, cb), hasListeners: () => B.has(id, name),
  });
  chrome.sidePanel = {
    open: call('sidePanel.open'), close: call('sidePanel.close'),
    setOptions: call('sidePanel.setOptions'), getOptions: call('sidePanel.getOptions'),
    setPanelBehavior: call('sidePanel.setPanelBehavior'), getPanelBehavior: call('sidePanel.getPanelBehavior'),
    getLayout: () => Promise.resolve({ side: 'right' }),
    onOpened: ev('sidePanel.onOpened'), onClosed: ev('sidePanel.onClosed'),
  };
}

if (process.type === 'service-worker' || (typeof location !== 'undefined' && location.href.startsWith('chrome-extension://'))) {
  try {
    if (!process.contextIsolated) { globalThis.__fernaCrx = bridge; mainWorld(); }
    else {
      contextBridge.exposeInMainWorld('__fernaCrx', bridge);
      if ('executeInMainWorld' in contextBridge) contextBridge.executeInMainWorld({ func: mainWorld });
      else webFrame.executeJavaScript(`(${mainWorld})();`);
    }
  } catch (e) {
    console.error('Ferna extension API bridge failed', e);
  }
}
