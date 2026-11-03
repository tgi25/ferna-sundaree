'use strict';
// Favicon cache: keeps each site's icon on this PC (encrypted with the profile, as history is),
// so sleeping tabs, pinned sites and the common bar keep their icons when their pages are not
// loaded, and after a restart. Icons are fetched with the tab's own session (same cookies and
// ad blocking as the page), checked to be an image, shrunk to 32 × 32 and kept as data: URLs.
// Private windows learn nothing.

const crypto = require('crypto');
const { pageUrlOf, folderOf } = require('./workspaces');

const MAX_ENTRIES = 600;
const MAX_BYTES = 256 * 1024;
const IMAGE_TYPES = /^image\/(png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon|svg\+xml|bmp)$/i;

function hostKey(url) {
  try { const u = new URL(url); return /^(https?):$/.test(u.protocol) ? `host:${u.hostname.replace(/^www\./, '').toLowerCase()}` : ''; } catch { return ''; }
}
function pageKey(url) {
  const p = pageUrlOf(url || '');
  if (!/^(https?|file):/i.test(p)) return '';
  return `page:${p.split('#')[0]}`;
}
function folderKey(url) {
  const p = pageUrlOf(url || '');
  if (!/^(https?|file):/i.test(p)) return '';
  try { return `folder:${folderOf(p)}`; } catch { return ''; }
}

/** Keys an icon is filed under, most specific first. */
function keysFor(url) { return [pageKey(url), folderKey(url), hostKey(url)].filter(Boolean); }

const isDataImage = v => typeof v === 'string' && v.length < 400000 && /^data:image\/(png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon|svg\+xml|bmp);base64,[A-Za-z0-9+/=]+$/.test(v);

class FaviconCache {
  /** @param store a JsonStore with { icons: { key: { d, t } } } */
  constructor(store, { nativeImage = null } = {}) {
    this.store = store;
    if (!this.store.data.icons || typeof this.store.data.icons !== 'object') this.store.data.icons = {};
    this.nativeImage = nativeImage;
    this.pending = new Map(); // icon URL → Promise<data URL>
    this.byIconUrl = new Map(); // icon URL → data URL (this session)
  }

  /** The kept icon for an address (its page, else its folder, else its site), or ''. */
  lookup(url) {
    const icons = this.store.data.icons;
    for (const k of keysFor(url)) { const e = icons[k]; if (e && isDataImage(e.d)) return e.d; }
    return '';
  }

  /**
   * A short ferna://favicon/ address for the kept icon (served from this cache on the browser's
   * own pages only; web pages cannot reach it), or ''. Changes when the icon changes.
   */
  urlFor(url) {
    const icons = this.store.data.icons;
    for (const k of keysFor(url)) {
      const e = icons[k];
      if (e && isDataImage(e.d)) { if (!e.h) e.h = crypto.createHash('sha1').update(e.d).digest('hex').slice(0, 10); return `ferna://favicon/?k=${encodeURIComponent(k)}&v=${e.h}`; }
    }
    return '';
  }

  /** The bytes behind a ferna://favicon/ address: { type, buf } or null. */
  file(key) {
    const e = this.store.data.icons[key];
    if (!e || !isDataImage(e.d)) return null;
    const m = /^data:([^;]+);base64,(.*)$/.exec(e.d);
    return m ? { type: m[1], buf: Buffer.from(m[2], 'base64') } : null;
  }

  /** File an icon (data: URL) under the page, its folder and its site. */
  put(url, data) {
    if (!isDataImage(data)) return;
    const icons = this.store.data.icons;
    const t = Date.now();
    let changed = false;
    for (const k of keysFor(url)) { if (!icons[k] || icons[k].d !== data) { icons[k] = { d: data, t }; changed = true; } else if (t - icons[k].t > 86400000) { icons[k].t = t; changed = true; } }
    const keys = Object.keys(icons);
    if (keys.length > MAX_ENTRIES) {
      keys.sort((a, b) => icons[a].t - icons[b].t).slice(0, keys.length - MAX_ENTRIES).forEach(k => delete icons[k]);
      changed = true;
    }
    if (changed) this.store.save();
  }

  /** Turn fetched bytes into a small data: URL, or '' if they are not an image. */
  toDataUrl(buf, type) {
    if (!buf || !buf.length || buf.length > MAX_BYTES) return '';
    type = String(type || '').split(';')[0].trim().toLowerCase();
    if (!IMAGE_TYPES.test(type)) {
      // Servers often send icons as octet-stream: recognise PNG, ICO, GIF, JPEG by their bytes.
      const b = buf;
      if (b[0] === 0x89 && b[1] === 0x50) type = 'image/png';
      else if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) type = 'image/x-icon';
      else if (b[0] === 0x47 && b[1] === 0x49) type = 'image/gif';
      else if (b[0] === 0xff && b[1] === 0xd8) type = 'image/jpeg';
      else return '';
    }
    if (this.nativeImage && /png|jpeg|gif|webp|bmp/.test(type)) {
      try {
        const img = this.nativeImage.createFromBuffer(buf);
        if (!img.isEmpty()) {
          const sz = img.getSize();
          const small = sz.width > 32 || sz.height > 32 ? img.resize({ width: 32, height: 32, quality: 'best' }) : img;
          return `data:image/png;base64,${small.toPNG().toString('base64')}`;
        }
      } catch { /* keep as it is */ }
    }
    if (buf.length > 64 * 1024) return '';
    return `data:${type};base64,${buf.toString('base64')}`;
  }

  /**
   * Learn the icon a page announced. Returns the data: URL (or '' if it could not be fetched).
   * fetchFn(url) → Promise<{ ok, headers: { get }, arrayBuffer() }> (the tab's session fetch).
   */
  async learn(pageUrl, iconUrl, fetchFn) {
    if (!keysFor(pageUrl).length || !iconUrl) return '';
    if (isDataImage(iconUrl)) { this.put(pageUrl, iconUrl); return iconUrl; }
    if (!/^https?:/i.test(iconUrl)) return '';
    const known = this.byIconUrl.get(iconUrl);
    if (known) { this.put(pageUrl, known); return known; }
    if (!this.pending.has(iconUrl)) {
      this.pending.set(iconUrl, (async () => {
        try {
          const r = await fetchFn(iconUrl);
          if (!r || !r.ok) return '';
          const len = Number(r.headers.get('content-length') || 0);
          if (len > MAX_BYTES) return '';
          const buf = Buffer.from(await r.arrayBuffer());
          return this.toDataUrl(buf, r.headers.get('content-type'));
        } catch { return ''; }
      })().finally(() => setTimeout(() => this.pending.delete(iconUrl), 0)));
    }
    const data = await this.pending.get(iconUrl);
    if (data) { this.byIconUrl.set(iconUrl, data); if (this.byIconUrl.size > 300) this.byIconUrl.delete(this.byIconUrl.keys().next().value); this.put(pageUrl, data); }
    return data;
  }
}

module.exports = { FaviconCache, keysFor, isDataImage };
