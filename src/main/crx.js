'use strict';
// Chrome extension packages: CRX3 parsing with signature verification, extension ids,
// and safe unzipping (no path traversal). No Electron dependency, so it is unit-tested.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zipsafe = require('./zipsafe');

const MAGIC = Buffer.from('Cr24');
const SIGNED_PREFIX = Buffer.from('CRX3 SignedData\x00', 'binary');

/** Chrome extension id: first 16 bytes of SHA-256, hex digits 0-f mapped to a-p. */
function idFromBytes(buf) {
  const hex = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32);
  return [...hex].map(c => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16))).join('');
}
const idFromPublicKey = der => idFromBytes(der);
const idFromCrxId = buf => [...buf.toString('hex')].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');

// ---- minimal protobuf reader (wire types 0 and 2 are all CRX3 headers use) ----
function readVarint(buf, pos) {
  let result = 0;
  let shift = 0;
  for (;;) {
    if (pos.i >= buf.length) throw new Error('Truncated varint');
    const b = buf[pos.i++];
    result += (b & 0x7f) * 2 ** shift;
    if (!(b & 0x80)) return result;
    shift += 7;
    if (shift > 49) throw new Error('Varint too long');
  }
}
function fields(buf) {
  const out = [];
  const pos = { i: 0 };
  while (pos.i < buf.length) {
    const key = readVarint(buf, pos);
    const field = Math.floor(key / 8);
    const wire = key & 7;
    if (wire === 0) out.push({ field, value: readVarint(buf, pos) });
    else if (wire === 2) {
      const len = readVarint(buf, pos);
      if (pos.i + len > buf.length) throw new Error('Truncated field');
      out.push({ field, value: buf.subarray(pos.i, pos.i + len) });
      pos.i += len;
    } else if (wire === 5) pos.i += 4;
    else if (wire === 1) pos.i += 8;
    else throw new Error(`Unsupported wire type ${wire}`);
  }
  return out;
}

/**
 * Parse and verify a CRX3 file.
 * @returns {{id:string, zip:Buffer, verified:boolean}}
 */
function parseCrx(buf) {
  if (buf.length < 12 || !buf.subarray(0, 4).equals(MAGIC)) throw new Error('Not a Chrome extension package (.crx)');
  const version = buf.readUInt32LE(4);
  if (version !== 3) throw new Error(`Unsupported CRX version ${version} (only CRX3 is accepted)`);
  const headerLen = buf.readUInt32LE(8);
  if (12 + headerLen > buf.length) throw new Error('Corrupt CRX header');
  const header = buf.subarray(12, 12 + headerLen);
  const zip = buf.subarray(12 + headerLen);
  const proofs = [];
  let signedHeaderData = null;
  for (const f of fields(header)) {
    if ((f.field === 2 || f.field === 3) && Buffer.isBuffer(f.value)) {
      const p = { algo: f.field === 2 ? 'rsa' : 'ecdsa' };
      for (const g of fields(f.value)) {
        if (g.field === 1) p.publicKey = g.value;
        if (g.field === 2) p.signature = g.value;
      }
      if (p.publicKey && p.signature) proofs.push(p);
    } else if (f.field === 10000) signedHeaderData = f.value;
  }
  if (!signedHeaderData) throw new Error('CRX has no signed header');
  let crxId = null;
  for (const f of fields(signedHeaderData)) if (f.field === 1) crxId = f.value;
  if (!crxId || crxId.length !== 16) throw new Error('CRX has no extension id');
  const id = idFromCrxId(crxId);

  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(signedHeaderData.length);
  const signed = Buffer.concat([SIGNED_PREFIX, lenBuf, signedHeaderData, zip]);
  // The key whose hash is the id must have a valid signature over the header and archive.
  let publicKey = null;
  for (const p of proofs) {
    if (idFromPublicKey(p.publicKey) !== id) continue;
    try {
      const key = crypto.createPublicKey({ key: p.publicKey, format: 'der', type: 'spki' });
      if (crypto.verify('sha256', signed, key, p.signature)) { publicKey = p.publicKey; break; }
    } catch { /* try the next proof */ }
  }
  if (!publicKey) throw new Error('The package signature is not valid; it may have been tampered with');
  return { id, zip, publicKey, verified: true };
}

/** Extract a zip buffer into dir with the strict reader (src/main/zipsafe.js). Returns the manifest. */
function extractZip(zipBuf, dir) {
  const root = path.resolve(dir);
  zipsafe.extract(zipBuf, root);
  // Some zips wrap everything in one top-level folder.
  let base = root;
  if (!fs.existsSync(path.join(base, 'manifest.json'))) {
    const subs = fs.readdirSync(root).filter(n => fs.statSync(path.join(root, n)).isDirectory());
    if (subs.length === 1 && fs.existsSync(path.join(root, subs[0], 'manifest.json'))) base = path.join(root, subs[0]);
  }
  const manifestPath = path.join(base, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('The package has no manifest.json');
  return { base, manifest: readManifest(base) };
}

function readManifest(dir) {
  let text = fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const m = JSON.parse(text);
  if (!m || typeof m !== 'object' || typeof m.name !== 'string') throw new Error('Invalid manifest.json');
  return m;
}

/** Resolve "__MSG_name__" strings from _locales (default_locale, then en). */
function localized(dir, manifest, value) {
  const m = /^__MSG_(.+)__$/.exec(value || '');
  if (!m) return value || '';
  for (const loc of [manifest.default_locale, 'en', 'en_US']) {
    if (!loc) continue;
    try {
      const msgs = JSON.parse(fs.readFileSync(path.join(dir, '_locales', loc, 'messages.json'), 'utf8'));
      const hit = Object.entries(msgs).find(([k]) => k.toLowerCase() === m[1].toLowerCase());
      if (hit) return hit[1].message;
    } catch { /* next locale */ }
  }
  return value;
}

/** Human-readable permission warnings, close to Chrome's install dialog. */
function permissionWarnings(manifest) {
  const perms = new Set([...(manifest.permissions || []), ...(manifest.optional_permissions || [])].filter(p => typeof p === 'string'));
  const hosts = [...(manifest.host_permissions || []), ...[...perms].filter(p => p.includes('://') || p === '<all_urls>')];
  for (const cs of manifest.content_scripts || []) hosts.push(...(cs.matches || []));
  const out = [];
  if (hosts.some(h => h === '<all_urls>' || /^\*:\/\/\*\/\*$/.test(h) || /^https?:\/\/\*\/\*$/.test(h))) out.push('Read and change all your data on all websites');
  else if (hosts.length) out.push(`Read and change your data on ${[...new Set(hosts.map(h => h.replace(/^\*?:?\/?\/?|\/\*?$/g, '')))].slice(0, 4).join(', ')}${hosts.length > 4 ? ' and more' : ''}`);
  const MAP = {
    history: 'Read and change your browsing history', tabs: 'Read your browsing history', bookmarks: 'Read and change your bookmarks',
    downloads: 'Manage your downloads', cookies: 'Read and change cookies', clipboardRead: 'Read data you copy and paste',
    clipboardWrite: 'Modify data you copy and paste', nativeMessaging: 'Communicate with cooperating native applications',
    management: 'Manage your apps, extensions and themes', privacy: 'Change your privacy-related settings', proxy: 'Read and change your proxy settings',
    debugger: 'Access the page debugger backend', webRequest: 'Watch and change your network traffic', declarativeNetRequest: 'Block content on any page',
    notifications: 'Display notifications', geolocation: 'Detect your physical location', topSites: 'Read a list of your most frequently visited websites',
    contentSettings: 'Change settings that control websites\' access to features', desktopCapture: 'Capture content of your screen',
  };
  for (const [p, t] of Object.entries(MAP)) if (perms.has(p) && !out.includes(t)) out.push(t);
  return out;
}

module.exports = { parseCrx, extractZip, readManifest, localized, permissionWarnings, idFromPublicKey, idFromBytes, fields };
