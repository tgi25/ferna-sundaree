'use strict';
// Ad-blocking scriptlets (uBlock-style +js rules), run once in each web page frame as it starts,
// before the page's own code, as uBlock Origin runs them. Asks the browser which ones apply to
// this frame's address; exposes nothing to the page.
const { ipcRenderer, webFrame } = require('electron');
try {
  if (/^https?:/i.test(location.href)) {
    const scripts = ipcRenderer.sendSync('ferna-scriptlets', location.href);
    if (Array.isArray(scripts)) for (const sc of scripts) if (typeof sc === 'string') webFrame.executeJavaScript(sc).catch(() => {});
  }
} catch (e) { /* not available */ }
