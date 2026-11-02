'use strict';
// Tracker, ad and malware-domain blocking with Ghostery's engine and the uBlock Origin /
// EasyList lists. The browser process matches network requests and, per page, works out the
// cosmetic rules (element hiding CSS and uBlock-style scriptlets), which src/main/pagefx
// inserts. No preload or IPC is given to web pages for this.

const fs = require('fs');
const path = require('path');

const PREFIX = 'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets';
const LISTS = [
  `${PREFIX}/easylist/easylist.txt`,
  `${PREFIX}/easylist/easyprivacy.txt`,
  `${PREFIX}/peter-lowe/serverlist.txt`,
  `${PREFIX}/ublock-origin/filters.txt`,
  `${PREFIX}/ublock-origin/filters-2024.txt`,
  `${PREFIX}/ublock-origin/badware.txt`,
  `${PREFIX}/ublock-origin/privacy.txt`,
  `${PREFIX}/ublock-origin/quick-fixes.txt`,
  `${PREFIX}/ublock-origin/unbreak.txt`,
];
const MAX_AGE = 7 * 24 * 3600 * 1000;

class Blocker {
  constructor(dir) {
    this.file = path.join(dir, 'blocker-engine-v2.bin'); // v2: cosmetic filters and scriptlets included
    this.engine = null;
    this.updated = null;
    this.status = 'loading';
    this.lib = null;
  }

  async init() {
    try {
      this.lib = require('@ghostery/adblocker-electron');
    } catch (e) {
      this.status = 'unavailable';
      return;
    }
    try {
      const st = fs.statSync(this.file);
      this.engine = this.lib.ElectronBlocker.deserialize(new Uint8Array(fs.readFileSync(this.file)));
      this.updated = st.mtime;
      this.status = 'ready';
      if (Date.now() - st.mtimeMs > MAX_AGE) this.refresh().catch(() => {});
    } catch {
      await this.refresh().catch(() => { this.status = this.engine ? 'ready' : 'lists unavailable'; });
    }
  }

  /** Extra list URLs the user subscribed to (Settings → My filters). */
  setExtraLists(urls) { this.extraLists = (urls || []).filter(u => /^https:\/\//i.test(u)).slice(0, 20); }

  /**
   * The user's own rules (uBlock / Adblock Plus syntax), kept in a small separate engine so a
   * change applies at once without rebuilding the big one. Its exceptions (@@) win over the lists.
   * Returns the number of rules it understood.
   */
  setCustom(text) {
    this.customText = String(text || '');
    this.custom = null;
    if (!this.lib || !this.customText.trim()) return 0;
    try {
      this.custom = this.lib.ElectronBlocker.parse(this.customText, { loadCosmeticFilters: true, loadNetworkFilters: true, enableCompression: false });
      return this.customText.split(/\r?\n/).filter(l => l.trim() && !/^\s*!/.test(l)).length;
    } catch { this.custom = null; return 0; }
  }

  async refresh() {
    const engine = await this.lib.ElectronBlocker.fromLists(fetch, [...LISTS, ...(this.extraLists || [])], {
      loadCosmeticFilters: true, loadNetworkFilters: true, enableCompression: true,
    });
    const bytes = engine.serialize();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(`${this.file}.tmp`, bytes);
    fs.renameSync(`${this.file}.tmp`, this.file);
    this.engine = engine;
    this.updated = new Date();
    this.status = 'ready';
  }

  /** @returns {{block:boolean, redirect?:string}} */
  match(details) {
    if (!this.engine && !this.custom) return { block: false };
    try {
      const req = this.lib.fromElectronDetails(details);
      if (this.custom) {
        const c = this.custom.match(req);
        if (c.exception) return { block: false };
        if (c.match) return { block: true };
      }
      if (!this.engine) return { block: false };
      const { match, redirect } = this.engine.match(req);
      if (redirect) return { block: false, redirect: redirect.dataUrl };
      return { block: !!match };
    } catch {
      return { block: false };
    }
  }
}

module.exports = { Blocker, LISTS };
