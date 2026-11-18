'use strict';
// Chrome extensions and themes for Ferna Sundaree.
//  • chrome.* APIs (tabs, windows, action, contextMenus, …): electron-chrome-extensions
//  • "Add to Chrome" on chromewebstore.google.com and auto-update: electron-chrome-web-store
//  • install from .crx (signature verified) / .zip, load unpacked folders (developer mode)
//  • Chrome themes (.crx with a "theme" manifest) mapped onto Ferna's UI
// Every install shows the extension's permissions and needs the user's confirmation.

const fs = require('fs');
const path = require('path');
const { dialog, nativeImage, Menu, MenuItem } = require('electron');
const crx = require('./crx');
const { themeFromManifest } = require('./themes');
const { JsonStore } = require('./store');

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

class ExtensionManager {
  constructor(ctx, dataDir) {
    this.ctx = ctx;
    this.storeDir = path.join(dataDir, 'Extensions');
    this.unpackedDir = path.join(dataDir, 'Extensions-unpacked');
    this.themesDir = path.join(dataDir, 'Themes');
    this.reg = new JsonStore(path.join(dataDir, 'extensions.json'), { disabled: [], pinned: [], tabsPinned: [], unpacked: [], theme: null, known: {} });
    this.lib = null;
    this.ready = false;
    this.iconCache = new Map();
    this.errors = {};
  }

  get ses() { return this.ctx.webSession; }
  get api() { return this.ses.extensions; }

  // ------------------------------------------------------------ start-up
  async init() {
    for (const d of [this.storeDir, this.unpackedDir, this.themesDir]) fs.mkdirSync(d, { recursive: true });
    const { ElectronChromeExtensions } = require('electron-chrome-extensions');
    // Store downloads are unpacked with adm-zip inside the library; send them through our reader.
    require('./zipsafe').hardenAdmZip();
    const { installChromeWebStore } = require('electron-chrome-web-store');
    const ctx = this.ctx;
    // The bridge and chrome.sidePanel must be in place before the library freezes `chrome`.
    for (const type of ['frame', 'service-worker']) {
      this.ses.registerPreloadScript({ id: `ferna-crx-early-${type}`, type, filePath: path.join(__dirname, '..', 'preload', 'crx-early.js') });
    }
    this.lib = new ElectronChromeExtensions({
      session: this.ses,
      createTab: async details => {
        const win = (details.windowId && ctx.windows.find(w => w.win.id === details.windowId)) || ctx.lastFocused || ctx.windows[0];
        const t = win.newTab(details.url || 'about:blank', { activate: details.active !== false, forceWeb: true });
        return [t.view.webContents, win.win];
      },
      selectTab: wc => {
        const win = ctx.windowFor(wc);
        const t = win && win.tabs.find(x => x.view && x.view.webContents === wc);
        if (t) win.activate(t);
      },
      removeTab: wc => {
        const win = ctx.windowFor(wc);
        const t = win && win.tabs.find(x => x.view && x.view.webContents === wc);
        if (t) win.closeTab(t);
      },
      createWindow: async details => {
        const urls = Array.isArray(details.url) ? details.url : details.url ? [details.url] : [];
        const w = ctx.newWindow({ url: urls[0] || 'about:blank', private: false, forceWeb: true });
        urls.slice(1).forEach(u => w.newTab(u));
        return w.win;
      },
      removeWindow: bw => { const w = ctx.windows.find(x => x.win === bw); if (w) w.win.close(); },
      // chrome.permissions.request (optional permissions): ask the user, remember the answer.
      requestPermissions: (ext, request) => this.requestOptionalPermissions(ext, request),
    });
    // Our fixes for APIs the library leaves as stubs; registered after its preload so `chrome` exists.
    for (const type of ['frame', 'service-worker']) {
      this.ses.registerPreloadScript({ id: `ferna-crx-extra-${type}`, type, filePath: path.join(__dirname, '..', 'preload', 'crx-extra.js') });
    }
    // Side panel, tab capture, downloads, zoom events and keyboard shortcuts (crxmore.js).
    require('./crxmore').install(this);
    // Repaint toolbar buttons whenever an extension changes its icon, badge or title.
    const ba = this.lib.api.browserAction;
    const origUpdate = ba.onUpdate.bind(ba);
    ba.onUpdate = () => { origUpdate(); this.scheduleToolbar(); };
    this.lib.on('browser-action-popup-created', popup => {
      popup.browserWindow && popup.browserWindow.webContents.setWindowOpenHandler(({ url }) => {
        const w = ctx.lastFocused || ctx.windows[0];
        if (w && /^(https?|chrome-extension):/i.test(url)) w.newTab(url, { forceWeb: true });
        return { action: 'deny' };
      });
    });

    await installChromeWebStore({
      session: this.ses,
      extensionsPath: this.storeDir,
      loadExtensions: false,
      autoUpdate: true,
      minimumManifestVersion: 2,
      beforeInstall: details => this.beforeStoreInstall(details),
    });

    this.api.on('extension-loaded', (e, ext) => { this.remember(ext); this.scheduleToolbar(); });
    this.api.on('extension-unloaded', () => this.scheduleToolbar());
    await this.loadAll();
    this.applySavedTheme();
    this.ready = true;
    this.scheduleToolbar();
  }

  async requestOptionalPermissions(ext, request) {
    const perms = (request.permissions || []).slice().sort();
    const origins = (request.origins || []).slice().sort();
    const granted = this.reg.data.granted || (this.reg.data.granted = {});
    const had = granted[ext.id] || { permissions: [], origins: [] };
    if (perms.every(p => had.permissions.includes(p)) && origins.every(o => had.origins.includes(o))) return true;
    const warnings = crx.permissionWarnings({ permissions: perms, host_permissions: origins });
    const win = this.ctx.lastFocused || this.ctx.windows[0];
    const opts = {
      type: 'question', buttons: ['Allow', 'Deny'], defaultId: 1, cancelId: 1, noLink: true,
      title: 'Extension permission',
      message: `“${ext.name}” is asking for more access`,
      detail: (warnings.length ? warnings : perms.concat(origins)).map(w => `• ${w}`).join('\n'),
    };
    if (process.env.FERNA_TEST === '1' && this.ctx.testAnswerPermissions !== undefined) return !!this.ctx.testAnswerPermissions;
    const { response } = win ? await dialog.showMessageBox(win.win, opts) : await dialog.showMessageBox(opts);
    if (response !== 0) return false;
    granted[ext.id] = { permissions: [...new Set([...had.permissions, ...perms])], origins: [...new Set([...had.origins, ...origins])] };
    this.reg.save();
    return true;
  }

  remember(ext) {
    const known = this.reg.data.known;
    const src = ext.path.startsWith(this.storeDir) ? 'store' : 'unpacked';
    const prev = known[ext.id];
    const perms = crx.permissionWarnings(ext.manifest || {});
    // Extension guard: an update that asks for more access is paused until you approve it.
    if (prev && prev.perms && this.ctx.settings.data.extensionGuard !== false && prev.version !== ext.version) {
      const added = perms.filter(p => !prev.perms.includes(p));
      if (added.length && !(this.reg.data.disabled || []).includes(ext.id)) {
        known[ext.id] = { ...prev, path: ext.path, version: ext.version, pendingPerms: perms };
        this.reg.save();
        setImmediate(() => this.guardAsk(ext, added));
        return;
      }
    }
    known[ext.id] = { path: ext.path, source: prev && prev.source === 'file' && src === 'store' ? 'file' : src, name: ext.name, version: ext.version, perms };
    if (!this.reg.data.pinned.includes(ext.id) && !this.reg.data.everPinned?.includes?.(ext.id)) {
      this.reg.data.pinned.push(ext.id);
      this.reg.data.everPinned = [...(this.reg.data.everPinned || []), ext.id];
    }
    this.reg.save();
  }

  /** Pause an updated extension that wants more access, and ask. */
  async guardAsk(ext, added) {
    await this.setEnabled(ext.id, false).catch(() => {});
    const win = this.ctx.lastFocused || this.ctx.windows[0];
    const opts = {
      type: 'warning', buttons: ['Keep it paused', 'Allow and turn on'], defaultId: 0, cancelId: 0, noLink: true,
      title: 'Extension paused',
      message: `“${ext.name}” was updated and now asks for more access`,
      detail: `New access it wants:\n${added.map(a => `• ${a}`).join('\n')}\n\nIt is turned off until you decide. You can also review it on the Extensions page.`,
    };
    if (process.env.FERNA_TEST === '1' && this.ctx.testGuardAnswer !== undefined) { if (this.ctx.testGuardAnswer) await this.guardApprove(ext.id); return; }
    const { response } = win ? await dialog.showMessageBox(win.win, opts) : await dialog.showMessageBox(opts);
    if (response === 1) await this.guardApprove(ext.id);
  }

  async guardApprove(id) {
    const k = this.reg.data.known[id];
    if (!k) return;
    if (k.pendingPerms) { k.perms = k.pendingPerms; delete k.pendingPerms; }
    this.reg.save();
    await this.setEnabled(id, true);
  }

  /** Latest-version folder of every store/file extension: Extensions/<id>/<version>/manifest.json */
  scanStore() {
    const out = [];
    for (const id of fs.existsSync(this.storeDir) ? fs.readdirSync(this.storeDir) : []) {
      if (!/^[a-p]{32}$/.test(id)) continue;
      let best = null;
      for (const v of fs.readdirSync(path.join(this.storeDir, id))) {
        const dir = path.join(this.storeDir, id, v);
        try {
          const m = crx.readManifest(dir);
          if (!best || compareVersions(m.version, best.manifest.version) > 0) best = { id, dir, manifest: m };
        } catch { /* not an extension folder */ }
      }
      if (best) out.push(best);
    }
    return out;
  }

  async loadOne(dir) {
    const ext = await this.api.loadExtension(dir, { allowFileAccess: false });
    delete this.errors[ext.id];
    if (ext.manifest.manifest_version === 3 && ext.manifest.background && ext.manifest.background.service_worker) {
      await this.ses.serviceWorkers.startWorkerForScope(`chrome-extension://${ext.id}`).catch(() => {});
    }
    return ext;
  }

  async loadAll() {
    const disabled = new Set(this.reg.data.disabled);
    for (const e of this.scanStore()) {
      if (disabled.has(e.id) || e.manifest.theme || this.api.getExtension(e.id)) continue;
      try { await this.loadOne(e.dir); } catch (err) { this.errors[e.id] = err.message; }
    }
    for (const dir of this.reg.data.unpacked) {
      try {
        const m = crx.readManifest(dir);
        const known = Object.entries(this.reg.data.known).find(([, k]) => k.path === dir);
        if (known && disabled.has(known[0])) continue;
        if (!m.theme) await this.loadOne(dir);
      } catch (err) { this.errors[dir] = err.message; }
    }
  }

  // ------------------------------------------------------------ installing
  async confirm(manifest, dir, { source, icon, win } = {}) {
    // Parental controls: adding an extension (which could get around the filter) needs the password.
    if (this.ctx.parental && this.ctx.parental.on() && !(await this.ctx.parentalGate(this.ctx.lastFocused || this.ctx.windows[0], 'add an extension'))) return false;
    const name = crx.localized(dir, manifest, manifest.name);
    const warnings = crx.permissionWarnings(manifest);
    const opts = {
      type: 'question', buttons: ['Cancel', 'Add extension'], defaultId: 1, cancelId: 0, noLink: true,
      title: 'Add extension', message: `Add “${name}”?`, icon: icon || undefined,
      detail: (warnings.length ? `It can:\n• ${warnings.join('\n• ')}\n\n` : 'It needs no special permissions.\n\n') +
        `Source: ${source}. Extensions run inside the pages they can access; add only ones you trust.`,
    };
    const parent = win || (this.ctx.lastFocused && this.ctx.lastFocused.win);
    const r = parent ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts);
    return r.response === 1;
  }

  async beforeStoreInstall({ id, localizedName, manifest, icon, browserWindow }) {
    const win = this.ctx.windows.find(w => w.win === browserWindow) || this.ctx.lastFocused;
    if (manifest && manifest.theme) {
      // Themes are applied by Ferna itself rather than loaded as an extension.
      (async () => {
        try {
          const { downloadExtension } = require('electron-chrome-web-store');
          const dir = await downloadExtension(id, this.themesDir);
          this.applyTheme(id, dir);
          if (win) win.sendUi('toast', { text: `Theme “${localizedName || manifest.name}” applied. Reset it in Settings → Appearance.` });
        } catch (e) {
          if (win) win.sendUi('toast', { text: `Could not install the theme: ${e.message}` });
        }
      })();
      return { action: 'deny' };
    }
    const ok = await this.confirm(manifest, null, { source: 'Chrome Web Store', icon, win: win && win.win });
    if (ok) {
      this.reg.data.disabled = this.reg.data.disabled.filter(x => x !== id);
      this.reg.save();
      setTimeout(() => win && win.sendUi('toast', { text: `“${localizedName || manifest.name}” added. Its button is in the toolbar; manage it in Extensions.` }), 1500);
    }
    return { action: ok ? 'allow' : 'deny' };
  }

  /** Install a .crx, .zip or unpacked folder chosen by the user. */
  async installFromPath(p, { win, skipConfirm = false } = {}) {
    const st = fs.statSync(p);
    if (st.isDirectory()) return this.loadUnpacked(p, { win, skipConfirm });
    const buf = fs.readFileSync(p);
    if (buf.subarray(0, 4).toString('binary') === 'Cr24') {
      const pkg = crx.parseCrx(buf);
      const tmp = path.join(this.storeDir, `.tmp-${pkg.id}-${Date.now()}`);
      let res;
      try {
        res = crx.extractZip(pkg.zip, tmp);
      } catch (e) { fs.rmSync(tmp, { recursive: true, force: true }); throw e; }
      const m = res.manifest;
      if (m.theme) {
        const dir = path.join(this.themesDir, pkg.id);
        fs.rmSync(dir, { recursive: true, force: true });
        fs.renameSync(res.base, dir);
        fs.rmSync(tmp, { recursive: true, force: true });
        this.applyTheme(pkg.id, dir);
        return { theme: true, id: pkg.id, name: crx.localized(dir, m, m.name) };
      }
      if (!skipConfirm && !(await this.confirm(m, res.base, { source: `file ${path.basename(p)} (signature verified)`, win }))) {
        fs.rmSync(tmp, { recursive: true, force: true });
        return null;
      }
      // Keep the package's own id: write its public key into the manifest, as Chrome does.
      m.key = pkg.publicKey.toString('base64');
      fs.writeFileSync(path.join(res.base, 'manifest.json'), JSON.stringify(m, null, 2));
      const dest = path.join(this.storeDir, pkg.id, `${String(m.version).replace(/[^0-9.]/g, '') || '0'}_0`);
      if (this.api.getExtension(pkg.id)) this.api.removeExtension(pkg.id);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(res.base, dest);
      fs.rmSync(tmp, { recursive: true, force: true });
      this.reg.data.known[pkg.id] = { path: dest, source: 'file', name: m.name, version: m.version };
      this.reg.data.disabled = this.reg.data.disabled.filter(x => x !== pkg.id);
      this.reg.save();
      const ext = await this.loadOne(dest);
      return { id: ext.id, name: ext.name };
    }
    if (buf.subarray(0, 2).toString('binary') === 'PK') {
      const dir = path.join(this.unpackedDir, `${path.basename(p).replace(/\.[^.]+$/, '').replace(/[^a-z0-9._-]+/gi, '_').slice(0, 40)}-${Date.now().toString(36)}`);
      let res;
      try { res = crx.extractZip(buf, dir); } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); throw e; }
      if (res.manifest.theme) {
        const id = `zip-${Date.now().toString(36)}`;
        const tdir = path.join(this.themesDir, id);
        fs.renameSync(res.base, tdir);
        fs.rmSync(dir, { recursive: true, force: true });
        this.applyTheme(id, tdir);
        return { theme: true, id, name: res.manifest.name };
      }
      if (!skipConfirm && !(await this.confirm(res.manifest, res.base, { source: `file ${path.basename(p)} (unsigned zip)`, win }))) {
        fs.rmSync(dir, { recursive: true, force: true });
        return null;
      }
      const ext = await this.loadOne(res.base);
      this.reg.data.unpacked.push(res.base);
      this.reg.data.known[ext.id] = { path: res.base, source: 'zip', name: ext.name, version: ext.version, owned: true };
      this.reg.save();
      return { id: ext.id, name: ext.name };
    }
    throw new Error('Choose a .crx or .zip extension package, or an unpacked extension folder');
  }

  async loadUnpacked(dir, { win, skipConfirm = false } = {}) {
    const m = crx.readManifest(dir);
    if (m.theme) {
      this.applyTheme(`unpacked-${Date.now().toString(36)}`, dir);
      return { theme: true, name: m.name };
    }
    if (!skipConfirm && !(await this.confirm(m, dir, { source: `unpacked folder ${dir} (developer mode)`, win }))) return null;
    const ext = await this.loadOne(dir);
    if (!this.reg.data.unpacked.includes(dir)) this.reg.data.unpacked.push(dir);
    this.reg.data.known[ext.id] = { path: dir, source: 'unpacked', name: ext.name, version: ext.version };
    this.reg.save();
    return { id: ext.id, name: ext.name };
  }

  // ------------------------------------------------------------ managing
  async uninstall(id) {
    const k = this.reg.data.known[id];
    // Installed again later, it is new again (runtime.onInstalled) with no side panel choices.
    if (this.reg.data.crxVersions) delete this.reg.data.crxVersions[id];
    if (this.reg.data.sidePanel) delete this.reg.data.sidePanel[id];
    if (this.api.getExtension(id)) this.api.removeExtension(id);
    if (k && k.path.startsWith(this.storeDir)) fs.rmSync(path.join(this.storeDir, id), { recursive: true, force: true });
    if (k && (k.source === 'unpacked' || k.source === 'zip')) {
      this.reg.data.unpacked = this.reg.data.unpacked.filter(d => d !== k.path);
      if (k.owned && path.resolve(k.path).startsWith(path.resolve(this.unpackedDir) + path.sep)) {
        const top = path.relative(this.unpackedDir, k.path).split(path.sep)[0];
        fs.rmSync(path.join(this.unpackedDir, top), { recursive: true, force: true });
      }
    }
    delete this.reg.data.known[id];
    this.reg.data.disabled = this.reg.data.disabled.filter(x => x !== id);
    this.reg.data.pinned = this.reg.data.pinned.filter(x => x !== id);
    this.reg.data.tabsPinned = (this.reg.data.tabsPinned || []).filter(x => x !== id);
    // A later reinstall starts fresh (pinned to the toolbar again, like a first install).
    this.reg.data.everPinned = (this.reg.data.everPinned || []).filter(x => x !== id);
    this.reg.save();
    this.scheduleToolbar();
  }

  async setEnabled(id, on) {
    const k = this.reg.data.known[id];
    if (!k) return false;
    if (on) {
      this.reg.data.disabled = this.reg.data.disabled.filter(x => x !== id);
      this.reg.save();
      if (!this.api.getExtension(id)) {
        const dir = k.path.startsWith(this.storeDir) ? (this.scanStore().find(e => e.id === id) || {}).dir || k.path : k.path;
        await this.loadOne(dir);
      }
    } else {
      if (!this.reg.data.disabled.includes(id)) this.reg.data.disabled.push(id);
      this.reg.save();
      if (this.api.getExtension(id)) this.api.removeExtension(id);
    }
    this.scheduleToolbar();
    return true;
  }

  setPinned(id, on) {
    const p = this.reg.data.pinned.filter(x => x !== id);
    if (on) p.push(id);
    this.reg.data.pinned = p;
    this.reg.save();
    this.scheduleToolbar();
  }

  /** Extensions pinned to Ferna Tabs' action area (the address strip inside Ferna Tabs and the
   *  tabs list at the pointer), so they stay at hand while Ctrl+Shift+H hides the bars. */
  tabsPinnedList() { return Array.isArray(this.reg.data.tabsPinned) ? this.reg.data.tabsPinned : (this.reg.data.tabsPinned = []); }
  setTabsPinned(id, on) {
    const p = this.tabsPinnedList().filter(x => x !== id);
    if (on) p.push(id);
    this.reg.data.tabsPinned = p;
    this.reg.save();
    this.scheduleToolbar();
  }
  /** Move a Ferna Tabs button before another one (or to the end). */
  moveTabsPinned(id, beforeId) {
    const p = this.tabsPinnedList().filter(x => x !== id);
    if (p.length === this.tabsPinnedList().length) return;
    const i = beforeId ? p.indexOf(beforeId) : -1;
    p.splice(i < 0 ? p.length : i, 0, id);
    this.reg.data.tabsPinned = p;
    this.reg.save();
    this.scheduleToolbar();
  }

  async iconDataUrl(ext, size = 48) {
    const m = ext.manifest || {};
    const icons = m.icons || {};
    const action = m.action || m.browser_action || {};
    const cand = typeof action.default_icon === 'string' ? action.default_icon : null;
    const sizes = Object.keys(icons).map(Number).sort((a, b) => Math.abs(a - size) - Math.abs(b - size));
    const rel = cand || (sizes.length ? icons[sizes[0]] : null) || (action.default_icon && typeof action.default_icon === 'object' ? Object.values(action.default_icon).pop() : null);
    if (!rel) return null;
    const file = path.join(ext.path, String(rel).replace(/^\//, ''));
    if (!path.resolve(file).startsWith(path.resolve(ext.path))) return null;
    const img = nativeImage.createFromPath(file);
    return img.isEmpty() ? null : img.resize({ width: Math.min(size, 64), quality: 'best' }).toDataURL();
  }

  /** Every known extension, loaded or not, for the Extensions page. */
  async list() {
    const out = [];
    const loaded = new Map(this.api.getAllExtensions().map(e => [e.id, e]));
    const ids = new Set([...Object.keys(this.reg.data.known), ...loaded.keys()]);
    for (const id of ids) {
      const ext = loaded.get(id);
      const k = this.reg.data.known[id] || {};
      let manifest = ext && ext.manifest;
      const dir = ext ? ext.path : k.path;
      if (!manifest) { try { manifest = crx.readManifest(dir); } catch { continue; } }
      const opt = manifest.options_ui && manifest.options_ui.page || manifest.options_page;
      out.push({
        id, enabled: !!ext, source: k.source || 'store',
        name: crx.localized(dir, manifest, manifest.name), version: manifest.version,
        description: crx.localized(dir, manifest, manifest.description || ''),
        icon: await this.iconDataUrl({ manifest, path: dir }),
        warnings: crx.permissionWarnings(manifest), pinned: this.reg.data.pinned.includes(id), tabsPinned: this.tabsPinnedList().includes(id),
        hasAction: !!(manifest.action || manifest.browser_action), optionsUrl: opt ? `chrome-extension://${id}/${opt.replace(/^\//, '')}` : null,
        mv: manifest.manifest_version, error: this.errors[id] || null,
        allSites: crx.permissionWarnings(manifest).some(w => /all your data on all websites/.test(w)),
        paused: !!k.pendingPerms,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  // ------------------------------------------------------------ toolbar
  scheduleToolbar() {
    clearTimeout(this._tb);
    this._tb = setTimeout(() => this.ctx.windows.forEach(w => this.pushToolbar(w)), 60);
  }

  async iconFor(id, tabId, action) {
    const key = `${id}|${tabId}|${action.iconModified || 0}|${action.tabs && action.tabs[tabId] && action.tabs[tabId].iconModified || 0}`;
    if (this.iconCache.has(key)) return this.iconCache.get(key);
    let url = null;
    try {
      const res = this.lib.api.browserAction.handleCRXRequest(new Request(`crx://extension-icon/${id}/32/2${tabId ? `?tabId=${tabId}` : ''}`));
      if (res.ok) url = `data:image/png;base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
    } catch { /* fall back to the manifest icon */ }
    if (!url) {
      const ext = this.api.getExtension(id);
      url = ext ? await this.iconDataUrl(ext, 32) : null;
    }
    if (this.iconCache.size > 300) this.iconCache.clear();
    this.iconCache.set(key, url);
    return url;
  }

  async toolbarState(win) {
    if (!this.lib) return { ready: false, actions: [], all: 0 };
    const t = win.active;
    const tabId = t && t.view && t.kind === 'web' && (t.view.webContents && !(!t.view.webContents || t.view.webContents.isDestroyed())) ? t.view.webContents?.id : null;
    const map = this.lib.api.browserAction.actionMap;
    const pinned = this.reg.data.pinned;
    const tabsPinned = this.tabsPinnedList();
    const loaded = this.api.getAllExtensions();
    const actions = [];
    for (const ext of loaded) {
      const a = map.get(ext.id);
      if (!a || (!pinned.includes(ext.id) && !tabsPinned.includes(ext.id))) continue;
      const tabA = (tabId && a.tabs[tabId]) || {};
      const pick = k => (tabA[k] !== undefined ? tabA[k] : a[k]);
      const color = pick('color');
      actions.push({
        id: ext.id, title: pick('title') || ext.name, text: pick('text') || '',
        color: Array.isArray(color) ? `rgba(${color.slice(0, 3).join(',')},${(color[3] ?? 255) / 255})` : (typeof color === 'string' ? color : ''),
        icon: await this.iconFor(ext.id, tabId, a), order: pinned.indexOf(ext.id),
        toolbar: pinned.includes(ext.id), tabs: tabsPinned.includes(ext.id), tabsOrder: tabsPinned.indexOf(ext.id),
      });
    }
    actions.sort((x, y) => x.order - y.order);
    // The toolbar shows its own pins; Ferna Tabs shows `tabsActions`, in its own order.
    const tabsActions = actions.filter(x => x.tabs).sort((x, y) => x.tabsOrder - y.tabsOrder);
    return { ready: true, actions: actions.filter(x => x.toolbar), tabsActions, all: loaded.length, tabId };
  }

  async pushToolbar(win) {
    if (win.win.isDestroyed() || win.ui.webContents.isDestroyed()) return;
    const st = await this.toolbarState(win);
    win.ui.webContents.send('extensions', st);
    // The tabs list at the pointer shows the Ferna Tabs buttons too.
    if (win.overlayMode === 'pointer' && win.overlay && !win.overlay.webContents.isDestroyed()) win.overlay.webContents.send('extensions', st);
  }

  click(win, id, rect) {
    // "Open the side panel when the toolbar button is clicked" (chrome.sidePanel), on any page.
    if (this.sidePanelClick && this.sidePanelClick(win, id)) return;
    const t = win.active;
    const tabId = t && t.view && t.kind === 'web' ? t.view.webContents?.id : -1;
    if (tabId < 0) { win.sendUi('toast', { text: 'Extensions work on web pages. Open a website first.' }); return; }
    this.lib.api.browserAction.activateClick({ eventType: 'click', extensionId: id, tabId, anchorRect: rect, alignment: 'bottom left' });
  }

  /** Right-click on an extension button (toolbar or Ferna Tabs): the extension's own menu items,
   *  Options, and where its button is shown. */
  contextMenu(win, id, rect) {
    const ext = this.api.getExtension(id);
    const menu = new Menu();
    const add = o => menu.append(new MenuItem(o));
    if (ext) {
      const m = ext.manifest || {};
      add({ label: ext.name, click: () => win.newTab(m.homepage_url || `https://chromewebstore.google.com/detail/${id}`) });
      add({ type: 'separator' });
      let own = [];
      try { own = this.lib.ctx.store.buildMenuItems(id, 'browser_action') || []; } catch { /* none */ }
      if (own.length) { own.forEach(i => menu.append(i)); add({ type: 'separator' }); }
      const opt = m.options_page || (m.options_ui && m.options_ui.page);
      add({ label: 'Options', enabled: !!opt, click: () => opt && win.newTab(`chrome-extension://${id}/${String(opt).replace(/^\//, '')}`) });
      add({ type: 'separator' });
    }
    const onBar = this.reg.data.pinned.includes(id), onTabs = this.tabsPinnedList().includes(id);
    add({ label: 'Pin to the toolbar', type: 'checkbox', checked: onBar, click: () => this.setPinned(id, !onBar) });
    add({ label: 'Pin to Ferna Tabs', sublabel: 'Stays at hand while the bars are hidden (Ctrl+Shift+H)', type: 'checkbox', checked: onTabs, click: () => this.setTabsPinned(id, !onTabs) });
    // Order of the Ferna Tabs buttons, from their own menu.
    const list = this.tabsPinnedList(), at = list.indexOf(id);
    if (onTabs && rect && rect.place === 'tabs' && list.length > 1) {
      add({ label: 'Move left', enabled: at > 0, click: () => this.moveTabsPinned(id, list[at - 1]) });
      add({ label: 'Move right', enabled: at < list.length - 1, click: () => this.moveTabsPinned(id, list[at + 2] || null) });
    }
    add({ type: 'separator' });
    add({ label: 'Manage extension', click: () => win.openInternal('ferna://extensions/') });
    const r = rect && Number.isFinite(rect.x) ? rect : null;
    menu.popup(r ? { window: win.win, x: Math.floor(r.x), y: Math.floor(r.y + (r.height || 0)) } : { window: win.win });
  }

  /** Puzzle-button menu: every loaded extension with pin toggles. */
  puzzleMenu(win) {
    const loaded = this.api.getAllExtensions().sort((a, b) => a.name.localeCompare(b.name));
    // Each extension can be pinned to the toolbar, to Ferna Tabs (shown while the bars are
    // hidden), or both.
    const items = loaded.length ? [
      { label: 'Pin to the toolbar', enabled: false },
      ...loaded.map(e => ({ label: e.name, type: 'checkbox', checked: this.reg.data.pinned.includes(e.id), click: () => this.setPinned(e.id, !this.reg.data.pinned.includes(e.id)) })),
      { type: 'separator' },
      { label: 'Pin to Ferna Tabs (stays at hand while the bars are hidden)', enabled: false },
      ...loaded.map(e => ({ label: e.name, type: 'checkbox', checked: this.tabsPinnedList().includes(e.id), click: () => this.setTabsPinned(e.id, !this.tabsPinnedList().includes(e.id)) })),
    ] : [{ label: 'No extensions installed', enabled: false }];
    items.push(
      { type: 'separator' },
      { label: 'Manage extensions', click: () => win.openInternal('ferna://extensions/') },
      { label: 'Get extensions from the Chrome Web Store', click: () => win.newTab('https://chromewebstore.google.com/category/extensions') },
      { label: 'Get themes', click: () => win.newTab('https://chromewebstore.google.com/category/themes') },
    );
    Menu.buildFromTemplate(items).popup({ window: win.win });
  }

  // tabs → chrome.tabs
  addTab(wc, win) {
    if (!this.lib || wc.session !== this.ses) return;
    try { this.lib.addTab(wc, win.win); } catch { /* not a web tab */ }
  }
  selectTab(wc) {
    if (!this.lib || !wc || wc.isDestroyed() || wc.session !== this.ses) return;
    try { this.lib.selectTab(wc); } catch { /* ignore */ }
    this.scheduleToolbar();
  }
  contextMenuItems(wc, params) {
    if (!this.lib) return [];
    try { return this.lib.getContextMenuItems(wc, params); } catch { return []; }
  }

  // ------------------------------------------------------------ themes
  applyTheme(id, dir) {
    const m = crx.readManifest(dir);
    if (!m.theme) throw new Error('Not a theme');
    this.reg.data.theme = { id, dir, name: m.name };
    this.reg.save();
    this.theme = { id, dir, ...themeFromManifest(m, dir) };
    this.ctx.onThemeChanged();
  }

  applySavedTheme() {
    const t = this.reg.data.theme;
    if (!t) { this.theme = null; return; }
    try {
      this.theme = { id: t.id, dir: t.dir, ...themeFromManifest(crx.readManifest(t.dir), t.dir) };
    } catch { this.theme = null; }
  }

  resetTheme() {
    this.reg.data.theme = null;
    this.reg.save();
    this.theme = null;
    this.ctx.onThemeChanged();
  }

  /** What the UI pages need: CSS variables and image URLs. */
  themeState() {
    const t = this.theme;
    if (!t) return null;
    const images = {};
    for (const [k, rel] of Object.entries(t.images)) images[k] = `ferna://theme/${encodeURIComponent(t.id)}/${rel.split('/').map(encodeURIComponent).join('/')}`;
    return { id: t.id, name: t.name, vars: t.vars, images, dark: t.dark, ntp: t.ntp };
  }

  /** ferna://theme/<id>/<file> → image bytes from the active theme only. */
  themeFile(id, rel) {
    const t = this.theme;
    if (!t || t.id !== id || !/\.(png|jpe?g|gif|webp|bmp)$/i.test(rel)) return null;
    const file = path.resolve(t.dir, rel);
    if (!file.startsWith(path.resolve(t.dir) + path.sep)) return null;
    try { return fs.readFileSync(file); } catch { return null; }
  }
}

module.exports = { ExtensionManager, compareVersions };
