'use strict';
// Preload for Ferna's own pages only (ferna://…). It exposes one frozen object.
// Web pages never get this preload: Ferna swaps a tab's view instead of letting a
// view move between ferna:// and the web, and the check below is a second guard.

const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set(['refresh', 'assistant', 'state', 'overlay', 'find-open', 'find-close', 'find-result', 'focus-address', 'toast', 'downloads', 'extensions']);

if (location.protocol === 'ferna:') {
  contextBridge.exposeInMainWorld('ferna', Object.freeze({
    host: location.host,
    cmd: (name, ...args) => ipcRenderer.invoke('ferna', name, ...args),
    on: (channel, fn) => {
      if (!EVENTS.has(channel) || typeof fn !== 'function') return () => {};
      const h = (_e, data) => fn(data);
      ipcRenderer.on(channel, h);
      return () => ipcRenderer.removeListener(channel, h);
    },
  }));
}
