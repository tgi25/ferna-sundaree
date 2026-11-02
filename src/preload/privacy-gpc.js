'use strict';
// Global Privacy Control (globalprivacycontrol.org): tells pages, as the Sec-GPC header tells
// servers, that you do not want your data sold or shared. Registered only while the setting
// is on. Exposes nothing else and opens no channel to the browser.
const { contextBridge } = require('electron');
try {
  contextBridge.executeInMainWorld({
    func: () => {
      try {
        Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true, configurable: true, enumerable: true });
      } catch (e) { /* ignore */ }
    },
  });
} catch (e) { /* not available */ }
