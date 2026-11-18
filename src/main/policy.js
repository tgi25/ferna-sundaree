'use strict';
// Pure security and navigation policy helpers (no Electron), unit-tested.

const net = require('net');

const SEARCH_ENGINES = {
  google: { name: 'Google', search: 'https://www.google.com/search?q=%s' },
  duckduckgo: { name: 'DuckDuckGo', search: 'https://duckduckgo.com/?q=%s' },
  brave: { name: 'Brave Search', search: 'https://search.brave.com/search?q=%s' },
  bing: { name: 'Bing', search: 'https://www.bing.com/search?q=%s' },
  startpage: { name: 'Startpage', search: 'https://www.startpage.com/do/search?query=%s' },
};

const DOH_PROVIDERS = {
  cloudflare: ['https://cloudflare-dns.com/dns-query', 'https://dns.quad9.net/dns-query'],
  quad9: ['https://dns.quad9.net/dns-query'],
  google: ['https://dns.google/dns-query'],
};

function isPrivateHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.test') ||
      h.endsWith('.internal') || h.endsWith('.lan') || h.endsWith('.home.arpa')) return true;
  if (!h.includes('.') && !net.isIP(h)) return true; // intranet single-label names
  if (net.isIPv4(h)) {
    const [a, b] = h.split('.').map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 169 && b === 254) || a === 0;
  }
  if (net.isIPv6(h)) return h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80');
  return false;
}

/** HTTPS-first: should this top-level http:// navigation be upgraded? */
function shouldUpgrade(url, exceptions = []) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'http:') return false;
  if (isPrivateHost(u.hostname)) return false;
  return !exceptions.includes(u.hostname.toLowerCase());
}

function upgradeUrl(url) {
  const u = new URL(url);
  u.protocol = 'https:';
  if (u.port === '80') u.port = '';
  return u.toString();
}

const URLISH = /^(?:[a-z][a-z0-9+.-]*:\/\/|about:|data:|file:|ferna:|view-source:)/i;
// chrome:// pages people type, mapped to Ferna's own pages.
const CHROME_PAGES = { extensions: 'ferna://extensions/', settings: 'ferna://settings/', history: 'ferna://history/', downloads: 'ferna://downloads/', bookmarks: 'ferna://bookmarks/', newtab: 'ferna://newtab/' };

/** Address-bar text → URL to load. */
function normalizeInput(text, engineKey = 'google') {
  const t = String(text || '').trim();
  if (!t) return null;
  const chromePage = /^(?:chrome|edge|brave|about):\/?\/?([a-z-]+)/i.exec(t);
  if (chromePage && CHROME_PAGES[chromePage[1].toLowerCase()]) return CHROME_PAGES[chromePage[1].toLowerCase()];
  if (URLISH.test(t)) {
    if (/^javascript:/i.test(t)) return null;
    if (/^chrome:/i.test(t)) return null;
    return t;
  }
  if (/^(localhost|\[[0-9a-f:]+\]|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/.*)?$/i.test(t)) return `http://${t}`;
  if (!/\s/.test(t) && /^[^/?#]+\.[a-z]{2,63}(:\d+)?([/?#].*)?$/i.test(t)) return `https://${t}`;
  const engine = SEARCH_ENGINES[engineKey] || SEARCH_ENGINES.google;
  return engine.search.replace('%s', encodeURIComponent(t));
}

const RISKY_EXT = new Set([
  'exe', 'msi', 'msix', 'appx', 'bat', 'cmd', 'com', 'scr', 'pif', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse',
  'wsf', 'wsh', 'hta', 'cpl', 'msc', 'jar', 'lnk', 'reg', 'iso', 'img', 'vhd', 'vhdx', 'dll', 'sys',
  'docm', 'xlsm', 'pptm', 'dotm', 'xltm', 'one', 'chm', 'appref-ms', 'application',
]);

function isRiskyDownload(filename) {
  const m = /\.([a-z0-9-]+)$/i.exec(String(filename || ''));
  return !!m && RISKY_EXT.has(m[1].toLowerCase());
}

/** Content for the NTFS Zone.Identifier stream (Mark of the Web). */
function zoneIdentifier(url, referrer) {
  const safe = s => String(s || '').replace(/[\r\n]/g, '');
  const lines = ['[ZoneTransfer]', 'ZoneId=3'];
  if (referrer && /^https?:/i.test(referrer)) lines.push(`ReferrerUrl=${safe(referrer)}`);
  if (url && /^https?:/i.test(url)) lines.push(`HostUrl=${safe(url)}`);
  return lines.join('\r\n') + '\r\n';
}

// Permissions a site may ask the user for; anything else is refused outright.
const PROMPTABLE = new Set(['media', 'geolocation', 'notifications', 'midi', 'midiSysex', 'clipboard-read',
  'idle-detection', 'window-management', 'storage-access', 'top-level-storage-access']);
// Harmless permissions granted without asking. Screen wake lock keeps the screen on during a
// video call or a presentation (Chrome grants it without asking too). Screen sharing
// (display-capture) always goes through Ferna's picker, which is where you agree to it.
const AUTO_ALLOW = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write', 'keyboardLock', 'screen-wake-lock', 'display-capture']);

/** The key a decision is saved under. Camera and microphone are separate, as in Chrome. */
function permissionKey(origin, permission, mediaType) {
  return permission === 'media' && (mediaType === 'audio' || mediaType === 'video') ? `${origin}|media:${mediaType}` : `${origin}|${permission}`;
}

/**
 * 'allow' | 'deny' | 'ask' for a permission of a site. decisions: saved answers; grants: answers
 * for this browser session only ("Allow" without "Remember"). For media, mediaType 'audio' or
 * 'video' picks microphone or camera; 'speaker-selection' (choosing speakers, as video-call sites
 * do) follows the microphone, as in Chrome.
 */
function permissionDecision(permission, origin, decisions = {}, mediaType, grants) {
  if (AUTO_ALLOW.has(permission)) return 'allow';
  if (permission === 'speaker-selection') return permissionDecision('media', origin, decisions, 'audio', grants) === 'allow' ? 'allow' : 'deny';
  if (!PROMPTABLE.has(permission)) return 'deny';
  const look = key => (grants && grants.get(key)) || decisions[key];
  if (permission === 'media' && (mediaType === 'audio' || mediaType === 'video')) {
    const own = look(permissionKey(origin, 'media', mediaType));
    if (own === 'allow' || own === 'deny') return own;
  } else if (permission === 'media') {
    // A check without a type (some device lists): either answer counts.
    const a = look(permissionKey(origin, 'media', 'audio')), v = look(permissionKey(origin, 'media', 'video'));
    if (a === 'allow' || v === 'allow') return 'allow';
    if (a === 'deny' && v === 'deny') return 'deny';
  }
  const saved = look(`${origin}|${permission}`); // also older saves of 'media' for both
  if (saved === 'allow' || saved === 'deny') return saved;
  return 'ask';
}

/** Safe file name for a screenshot: {domain}_{date}_{time}.{ext} */
function screenshotName(url, date, ext) {
  let domain = 'page';
  try { domain = new URL(url).hostname.replace(/^www\./, '') || 'page'; } catch { /* keep */ }
  const p = n => String(n).padStart(2, '0');
  const d = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  const t = `${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`;
  return `${domain.replace(/[^a-z0-9.-]/gi, '_')}_${d}_${t}.${ext}`;
}

module.exports = {
  SEARCH_ENGINES, DOH_PROVIDERS, isPrivateHost, shouldUpgrade, upgradeUrl, normalizeInput,
  isRiskyDownload, zoneIdentifier, permissionDecision, permissionKey, PROMPTABLE, AUTO_ALLOW, screenshotName,
};
