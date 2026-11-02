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
// Runs only in extension service workers and chrome-extension:// pages, like the library.

const { contextBridge, webFrame } = require('electron');

function mainWorld() {
  const chrome = globalThis.chrome;
  if (!chrome) return;
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
    else if ('executeInMainWorld' in contextBridge) contextBridge.executeInMainWorld({ func: mainWorld });
    else webFrame.executeJavaScript(`(${mainWorld})();`);
  } catch (e) {
    console.error('Ferna extension API fixes failed', e);
  }
}
