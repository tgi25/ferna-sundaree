'use strict';
// Web-session preload: on YouTube only, removes the ad schedule from the player data before
// the player reads it (see src/main/pagefx/youtube.js). Exposes nothing to the page and opens
// no channel to the browser. Registered only while YouTube ad blocking is on.

const { contextBridge } = require('electron');

const host = (() => { try { return location.hostname; } catch { return ''; } })();
const testHost = (typeof process !== 'undefined' && process.env && process.env.FERNA_TEST_YT_HOST) || '';
if (/(^|\.)(youtube\.com|youtube-nocookie\.com)$/i.test(host) || (testHost && host === testHost)) {
  try { contextBridge.executeInMainWorld({ func: SHIELD }); } catch (e) { /* not available: skip */ }
}

/** Runs in the page's main world before any page script. Must be self-contained. */
function SHIELD() {
  const KEYS = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams', 'adBreakParams'];
  const hasAds = o => o && typeof o === 'object' && KEYS.some(k => k in o);
  function prune(o, depth = 0) {
    if (!o || typeof o !== 'object' || depth > 4) return o;
    for (const k of KEYS) if (k in o) { try { delete o[k]; } catch (e) { /* frozen */ } }
    if (o.playerResponse) prune(o.playerResponse, depth + 1);
    if (Array.isArray(o)) o.forEach(x => prune(x, depth + 1));
    else if (o.response && typeof o.response === 'object') prune(o.response, depth + 1);
    return o;
  }
  const looksLikePlayer = o => o && typeof o === 'object' && (hasAds(o) || hasAds(o.playerResponse) || (Array.isArray(o) && o.some(x => x && (hasAds(x) || hasAds(x.playerResponse)))));

  const nativeParse = JSON.parse;
  const parse = new Proxy(nativeParse, {
    apply(target, self, args) {
      const r = Reflect.apply(target, self, args);
      try { if (looksLikePlayer(r)) prune(r); } catch (e) { /* keep the page working */ }
      return r;
    },
  });
  try { Object.defineProperty(JSON, 'parse', { value: parse, writable: true, configurable: true }); } catch (e) { /* ignore */ }

  if (typeof Response !== 'undefined') {
    const nativeJson = Response.prototype.json;
    Response.prototype.json = new Proxy(nativeJson, {
      apply(target, self, args) {
        return Reflect.apply(target, self, args).then(r => { try { if (looksLikePlayer(r)) prune(r); } catch (e) { /* ignore */ } return r; });
      },
    });
  }

  // The first video's data is assigned inline: var ytInitialPlayerResponse = {...};
  let initial;
  try {
    Object.defineProperty(window, 'ytInitialPlayerResponse', {
      configurable: true,
      get() { return initial; },
      set(v) { initial = prune(v); },
    });
  } catch (e) { /* already defined */ }
}

