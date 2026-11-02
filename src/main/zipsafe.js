'use strict';
// A small, strict ZIP reader for extension packages (replaces adm-zip, which has unfixed
// advisories: decompression bombs, symlink overwrite, SUID bits, duplicate-name confusion).
//   • stored and deflate entries only; no encryption, no ZIP64 tricks beyond what fits in 32 bits
//   • every name checked: no absolute paths, drive letters, "..", backslash tricks or NULs
//   • duplicate names rejected (case-insensitive, as Windows sees them)
//   • symlinks and special files rejected; file modes are not applied
//   • sizes enforced while inflating (maxOutputLength), not trusted from the headers:
//     per file and in total, plus a cap on the number of entries

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const LIMITS = { maxEntries: 20000, maxFile: 256 * 1024 * 1024, maxTotal: 512 * 1024 * 1024 };

function findEOCD(buf) {
  const min = Math.max(0, buf.length - 0xffff - 22);
  for (let i = buf.length - 22; i >= min; i--) if (buf.readUInt32LE(i) === 0x06054b50) return i;
  throw new Error('Not a ZIP file (no end of central directory)');
}

function checkName(name) {
  if (!name || name.includes('\0') || name.includes('\\')) return false;
  if (name.startsWith('/') || /^[a-z]:/i.test(name)) return false;
  const parts = name.split('/');
  if (parts.some(p => p === '..' || p === '.' && parts.length > 1)) return false;
  return true;
}

/** List entries: [{ name, dir, method, csize, size, offset }]. Throws on anything suspicious. */
function entries(buf, limits = LIMITS) {
  const e = findEOCD(buf);
  const count = buf.readUInt16LE(e + 10);
  const cdSize = buf.readUInt32LE(e + 12);
  const cdOff = buf.readUInt32LE(e + 16);
  if (count > limits.maxEntries) throw new Error('Package has too many files');
  if (cdOff + cdSize > buf.length) throw new Error('Corrupt ZIP (central directory out of range)');
  const out = [];
  const seen = new Set();
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt ZIP (bad central header)');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const madeBy = buf.readUInt16LE(p + 4) >> 8;
    const ext = buf.readUInt32LE(p + 38);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    if (flags & 0x1) throw new Error('Encrypted packages are not supported');
    if (!checkName(name)) throw new Error(`Unsafe path in package: ${name}`);
    const key = name.replace(/\/$/, '').toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate file in package: ${name}`);
    seen.add(key);
    const unixMode = madeBy === 3 ? (ext >>> 16) & 0o170000 : 0;
    const dir = name.endsWith('/') || unixMode === 0o040000;
    if (unixMode && unixMode !== 0o100000 && unixMode !== 0o040000) throw new Error(`Links and special files are not allowed: ${name}`);
    if (!dir && method !== 0 && method !== 8) throw new Error(`Unsupported compression in ${name}`);
    if (csize === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) throw new Error('ZIP64 packages are not supported');
    out.push({ name, dir, method, csize, size, offset });
  }
  return out;
}

function dataOf(buf, ent, limit) {
  const p = ent.offset;
  if (buf.readUInt32LE(p) !== 0x04034b50) throw new Error('Corrupt ZIP (bad local header)');
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const raw = buf.subarray(start, start + ent.csize);
  if (raw.length !== ent.csize) throw new Error('Corrupt ZIP (truncated data)');
  const max = Math.min(limit, ent.size || limit);
  const data = ent.method === 0 ? raw : zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, max) });
  if (data.length !== ent.size) throw new Error(`Size mismatch in ${ent.name}`);
  return data;
}

/** Extract into dir (created). Returns the list of files written. */
function extract(buf, dir, limits = LIMITS) {
  const root = path.resolve(dir);
  fs.mkdirSync(root, { recursive: true });
  let total = 0;
  const written = [];
  for (const ent of entries(buf, limits)) {
    const dest = path.resolve(root, ent.name);
    if (dest !== root && !dest.startsWith(root + path.sep)) throw new Error(`Unsafe path in package: ${ent.name}`);
    if (ent.dir) { fs.mkdirSync(dest, { recursive: true }); continue; }
    if (ent.size > limits.maxFile) throw new Error(`File too large in package: ${ent.name}`);
    const data = dataOf(buf, ent, Math.min(limits.maxFile, limits.maxTotal - total));
    total += data.length;
    if (total > limits.maxTotal) throw new Error('Package is too large');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    // Never follow a link that may already exist at the destination.
    try { if (fs.lstatSync(dest).isSymbolicLink()) throw new Error(`Refusing to overwrite a link: ${ent.name}`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    fs.writeFileSync(dest, data, { flag: 'w', mode: 0o644 });
    written.push(ent.name);
  }
  return written;
}

/**
 * electron-chrome-web-store unpacks store downloads with adm-zip's extractAllTo. Route that
 * through this reader instead, so store installs and updates get the same checks.
 */
function hardenAdmZip() {
  // adm-zip builds a plain object per zip (methods are own properties, not on a prototype), so
  // the module export itself is wrapped. Must run before electron-chrome-web-store is loaded.
  let id;
  try { id = require.resolve('adm-zip', { paths: [path.dirname(require.resolve('electron-chrome-web-store'))] }); } catch { return false; }
  const Orig = require(id);
  if (Orig.__fernaHardened) return true;
  function SafeZip(...args) {
    const z = new Orig(...args);
    z.extractAllTo = target => { extract(z.toBuffer(), target); };
    z.extractAllToAsync = (target, overwrite, keep, cb) => {
      if (typeof overwrite === 'function') cb = overwrite;
      try { extract(z.toBuffer(), target); if (cb) cb(); else return Promise.resolve(); } catch (e) { if (cb) cb(e); else return Promise.reject(e); }
    };
    z.extractEntryTo = () => { throw new Error('extractEntryTo is disabled in Ferna Sundaree'); };
    return z;
  }
  Object.defineProperty(SafeZip, '__fernaHardened', { value: true });
  require.cache[id].exports = SafeZip;
  return true;
}

module.exports = { entries, extract, hardenAdmZip, LIMITS };
