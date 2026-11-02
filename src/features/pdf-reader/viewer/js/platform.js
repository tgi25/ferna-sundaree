// Browser differences between the Chrome/Brave/Edge and Firefox builds of Ferna PDF Reader.
// (Set window.__fernaForceFirefox = true before the viewer loads to test the Firefox paths in Chromium.)
export const IS_FIREFOX = /\bFirefox\//.test(navigator.userAgent) || !!globalThis.__fernaForceFirefox;
export const BROWSER_NAME = IS_FIREFOX ? 'Firefox' : (navigator.brave ? 'Brave' : /\bEdg\//.test(navigator.userAgent) ? 'Edge' : 'Chrome');
// Installed from the Chrome Web Store / Edge Add-ons (store installs carry an update_url): the save helper is a separate download.
export const FROM_STORE = !IS_FIREFOX && !!(globalThis.chrome && chrome.runtime && chrome.runtime.getManifest && chrome.runtime.getManifest().update_url);
export const HELPER_URL = 'https://tgi25.github.io/ferna-software/ferna-pdf-reader/#install';
export const EXT_SCHEME = location.protocol.replace(':', '');   // chrome-extension | moz-extension
