'use strict';
// Sync without an account: the core (pure, unit-tested).
//   • Encryption: AES-256-GCM with a key derived from your passphrase (scrypt). The salt is
//     stored in the file, so every PC with the passphrase derives the same key.
//   • Merging: three-way, per item, against what was last synced from this PC (the "base"):
//     changed on one side → that side wins; changed on both → the newer change wins; deleted on
//     one side and untouched on the other → deleted; new on either side → added.

const crypto = require('crypto');

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };

function deriveKey(passphrase, salt) {
  return crypto.scryptSync(String(passphrase).normalize('NFKC'), salt, 32, SCRYPT);
}

function seal(obj, key, salt) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(Buffer.from(JSON.stringify(obj), 'utf8')), c.final()]);
  return JSON.stringify({ format: 'ferna-sync', v: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') });
}

/** Parse the outer file (no key needed): { salt } or throws. */
function header(text) {
  const o = JSON.parse(text);
  if (!o || o.format !== 'ferna-sync' || o.v !== 1) throw new Error('Not a Ferna sync file');
  return { salt: Buffer.from(o.salt, 'base64'), o };
}

function open(text, key) {
  const { o } = header(text);
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(o.iv, 'base64'));
  d.setAuthTag(Buffer.from(o.tag, 'base64'));
  try {
    return JSON.parse(Buffer.concat([d.update(Buffer.from(o.data, 'base64')), d.final()]).toString('utf8'));
  } catch { throw new Error('Wrong passphrase (or the sync file is damaged)'); }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const stamp = n => (n && (n.changed || n.mod || n.ts || n.created)) || 0;

/**
 * Three-way merge of lists of objects with string `id`s.
 * Returns the merged list in local order, with items new from the remote appended.
 */
function merge3(base, local, remote) {
  base = base || []; local = local || []; remote = remote || [];
  const B = new Map(base.map(x => [x.id, x]));
  const L = new Map(local.map(x => [x.id, x]));
  const R = new Map(remote.map(x => [x.id, x]));
  const pick = id => {
    const b = B.get(id), l = L.get(id), r = R.get(id);
    if (l && r) {
      if (same(l, r)) return l;
      if (b && same(l, b)) return r;
      if (b && same(r, b)) return l;
      return stamp(r) > stamp(l) ? r : l;
    }
    if (l && !r) return b && same(l, b) ? null : l;      // deleted remotely, untouched here → delete
    if (r && !l) return b && same(r, b) ? null : r; // deleted here, untouched there → delete
    return null;
  };
  const out = [];
  const seen = new Set();
  for (const x of local) { const v = pick(x.id); seen.add(x.id); if (v) out.push(v); }
  for (const x of remote) { if (seen.has(x.id)) continue; seen.add(x.id); const v = pick(x.id); if (v) out.push(v); }
  return out;
}

/** Three-way merge of a plain value (an array kept whole, or a setting). */
function merge3value(base, local, remote) {
  if (same(local, remote)) return local;
  if (same(local, base)) return remote;
  return local;
}

/** Settings that follow you between PCs (not window sizes, paths, or per-PC choices). */
const SYNCED_SETTINGS = ['searchEngine', 'theme', 'accent', 'tabPosition', 'verticalWidth', 'verticalCollapsed', 'bookmarksBarHidden', 'httpsFirst', 'httpsExceptions',
  'blocker', 'blockerAllow', 'cosmeticFiltering', 'youtubeAds', 'popupBlocker', 'popupAllow', 'customFilters', 'filterLists', 'safeBrowsing', 'stripTracking', 'gpc',
  'fingerprintProtection', 'lookalikeWarnings', 'passwordWarnings', 'selectionMenu', 'wsShowNames', 'stripFavoritesOnly', 'shortcuts', 'zoomPrefs', 'zoomSites',
  'sleepingTabs', 'sleepAfterMinutes', 'autoPip', 'linkPreview', 'translateTo', 'spellLangs', 'readerRate', 'reader', 'equalizer'];

function mergeSettings(base = {}, local = {}, remote = {}) {
  const out = {};
  for (const k of SYNCED_SETTINGS) if (k in local || k in remote) out[k] = merge3value(base[k], local[k], remote[k]);
  return out;
}

/** History: union by address + time, newest first, capped. */
function mergeHistory(local = [], remote = [], cap = 20000) {
  const m = new Map();
  for (const e of [...local, ...remote]) if (e && e.url) m.set(`${e.url}|${e.ts}`, e);
  return [...m.values()].sort((a, b) => b.ts - a.ts).slice(0, cap);
}

module.exports = { deriveKey, seal, open, header, merge3, merge3value, mergeSettings, mergeHistory, SYNCED_SETTINGS };
