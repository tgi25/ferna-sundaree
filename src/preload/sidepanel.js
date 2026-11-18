'use strict';
// Ferna Sundaree — an extension's page in the side panel (chrome.sidePanel). In Chrome,
// window.close() in a side panel closes the panel; a page in Ferna's panel is not a window,
// so that call is passed to the browser here.
const { contextBridge, ipcRenderer, webFrame } = require('electron');

if (typeof location !== 'undefined' && location.href.startsWith('chrome-extension://')) {
  try {
    contextBridge.exposeInMainWorld('__fernaPanel', { close: () => ipcRenderer.send('ferna-sidepanel-close') });
    const fn = () => {
      const p = globalThis.__fernaPanel;
      try { delete globalThis.__fernaPanel; } catch { /* keep */ }
      if (p) window.close = () => p.close();
    };
    if ('executeInMainWorld' in contextBridge) contextBridge.executeInMainWorld({ func: fn });
    else webFrame.executeJavaScript(`(${fn})();`);
  } catch (e) { console.error('Ferna side panel preload failed', e); }
}
