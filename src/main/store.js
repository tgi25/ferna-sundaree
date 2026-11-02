'use strict';
// Profile storage: atomic JSON files, optionally encrypted with Windows DPAPI
// (Electron safeStorage). Nothing here ever leaves the PC.

const fs = require('fs');
const path = require('path');

let safeStorage = null;
try { ({ safeStorage } = require('electron')); } catch { /* plain Node (unit tests) */ }

const ENC_MAGIC = Buffer.from('FSE1'); // marks an encrypted file

function canEncrypt() {
  try {
    if (!(safeStorage && safeStorage.isEncryptionAvailable())) return false;
    // Linux without GNOME Keyring / KWallet falls back to a fixed built-in key: that is not
    // protection, so treat it as no encryption (and say so in the passwords page).
    if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function' && safeStorage.getSelectedStorageBackend() === 'basic_text') return false;
    return true;
  } catch { return false; }
}

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function encode(obj, encrypt) {
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  if (encrypt && canEncrypt()) {
    return Buffer.concat([ENC_MAGIC, safeStorage.encryptString(json.toString('utf8'))]);
  }
  return json;
}

function decode(buf) {
  if (buf.length >= 4 && buf.subarray(0, 4).equals(ENC_MAGIC)) {
    if (!canEncrypt()) throw new Error('Encrypted profile file cannot be decrypted on this account');
    return JSON.parse(safeStorage.decryptString(buf.subarray(4)));
  }
  return JSON.parse(buf.toString('utf8'));
}

class JsonStore {
  /**
   * @param {string} file   absolute path
   * @param {object} defaults
   * @param {{encrypt?: boolean, memoryOnly?: boolean}} opts
   */
  constructor(file, defaults, opts = {}) {
    this.file = file;
    this.encrypt = !!opts.encrypt;
    this.memoryOnly = !!opts.memoryOnly;
    this.defaults = defaults;
    this.data = structuredClone(defaults);
    this._timer = null;
    if (!this.memoryOnly) this.load();
  }

  load() {
    try {
      const buf = fs.readFileSync(this.file);
      const loaded = decode(buf);
      this.data = Object.assign(structuredClone(this.defaults), loaded);
    } catch (e) {
      if (e.code !== 'ENOENT') {
        // Keep the unreadable file aside rather than overwrite it.
        try { fs.renameSync(this.file, `${this.file}.bad-${Date.now()}`); } catch { /* ignore */ }
      }
      this.data = structuredClone(this.defaults);
    }
    return this.data;
  }

  get(key) { return key === undefined ? this.data : this.data[key]; }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  update(fn) {
    fn(this.data);
    this.save();
  }

  /** Debounced save (150 ms); flush() writes immediately. */
  save() {
    if (this.memoryOnly) return;
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 150);
  }

  flush() {
    if (this.memoryOnly) return;
    clearTimeout(this._timer);
    this._timer = null;
    atomicWrite(this.file, encode(this.data, this.encrypt));
  }
}

module.exports = { JsonStore, atomicWrite, encode, decode, canEncrypt };
