'use strict';
// Chrome extension APIs that electron-chrome-extensions leaves out or stubs, implemented on
// Ferna's own windows, so extensions such as Ferna Feeds, Ferna Zoom, Ferna Equalizer and Ferna
// Screenshot run here as in Chrome:
//   • chrome.sidePanel        — the extension's page in Ferna's side panel (open, close, options,
//                               "open the panel when the toolbar button is clicked")
//   • chrome.tabs.captureVisibleTab — a picture of the visible part of the active tab
//   • chrome.tabs.onZoomChange — sent when you zoom a tab (Ctrl +/−/0, Ctrl + wheel, the panel)
//   • chrome.downloads        — download (also data: and blob: addresses), show, search, events
//   • chrome.commands         — the extension's keyboard shortcuts (suggested_key) and
//                               commands.onCommand / _execute_action
//   • runtime.onInstalled / onStartup — Electron sends neither; extensions set up their menus,
//                               alarms and side panels there
// The page side of these lives in src/preload/crx-early.js and crx-extra.js.

const fs = require('fs');
const path = require('path');
const { WebContentsView, dialog, shell } = require('electron');
const { parseAccelerator, matches } = require('./shortcuts');

const PRELOAD_DIR = path.join(__dirname, '..', 'preload');
// Chrome's names for keys that Ferna's shortcut parser spells differently.
const CHROME_KEYS = { Comma: ',', Period: '.', Up: 'Up', Down: 'Down', Left: 'Left', Right: 'Right', Space: 'Space' };

/** "Alt+Shift+Up" (a manifest suggested_key) → Ferna's key spec, or null. */
function parseChromeKey(s) {
  if (typeof s !== 'string' || !s) return null;
  const parts = s.split('+').map(p => p.trim());
  const key = parts.pop();
  const mods = parts.map(m => ({ MacCtrl: 'Ctrl', Command: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Search: 'Meta' }[m] || m));
  return parseAccelerator([...mods, CHROME_KEYS[key] || key].join('+'));
}

/** The shortcut an extension's manifest asks for on this platform, or ''. */
function suggestedKey(details, platform = process.platform) {
  const k = details && details.suggested_key;
  if (!k) return '';
  if (typeof k === 'string') return k;
  return k[platform === 'win32' ? 'windows' : platform === 'darwin' ? 'mac' : 'linux'] || k.default || '';
}

/** Extension commands with keys: [{ extId, name, key, spec }]. Built-in shortcuts win. */
function commandTable(extensions, builtIn, platform) {
  const out = [];
  const taken = new Set();
  for (const ext of extensions) {
    for (const [name, details] of Object.entries((ext.manifest && ext.manifest.commands) || {})) {
      const key = suggestedKey(details, platform);
      const spec = parseChromeKey(key);
      if (!spec) continue;
      const id = `${spec.ctrl}${spec.shift}${spec.alt}${spec.meta}${spec.code}`;
      if (taken.has(id) || (builtIn && builtIn(spec))) continue; // first extension wins, as in Chrome
      taken.add(id);
      out.push({ extId: ext.id, name, key, spec });
    }
  }
  return out;
}

/** A safe relative path for chrome.downloads (sub-folders allowed, never outside the folder). */
function safeRelative(name) {
  const parts = String(name || '').replace(/\\/g, '/').split('/')
    .map(p => p.replace(/[<>:"|?*\u0000-\u001f]+/g, '_').replace(/[. ]+$/, '').trim())
    .filter(p => p && p !== '.' && p !== '..');
  return parts.slice(-4);
}

function install(mgr) {
  const ctx = mgr.ctx;
  const lib = mgr.lib;
  const router = lib.ctx.router;
  const handle = router.apiHandler();
  const winOf = (sender, windowId) => (windowId != null && windowId >= 0 && ctx.windows.find(w => w.win.id === windowId))
    || (sender && ctx.windowFor && ctx.windowFor(sender)) || ctx.lastFocused || ctx.windows[0];
  const perms = ext => [...((ext && ext.manifest && ext.manifest.permissions) || []), ...((ext && ext.manifest && ext.manifest.host_permissions) || [])];

  // ---------------------------------------------------------------- side panel
  // Kept across restarts, as Chrome does (extensions set them once, when installed).
  const sp = mgr.reg.data.sidePanel || (mgr.reg.data.sidePanel = {});
  const persist = () => mgr.reg.save();
  const behavior = { get: id => (sp[id] || {}).behavior, set: (id, v) => { sp[id] = { ...(sp[id] || {}), behavior: v }; persist(); } };
  const options = { get: id => (sp[id] || {}).options, set: (id, v) => { sp[id] = { ...(sp[id] || {}), options: v }; persist(); } };
  const panelPath = ext => {
    const o = options.get(ext.id) || {};
    if (o.enabled === false) return '';
    return String(o.path || (ext.manifest.side_panel && ext.manifest.side_panel.default_path) || '').replace(/^\/+/, '');
  };
  function closePanel(win) {
    if (!win || !win.side || win.side.kind !== 'ext') return false;
    const { view, extId } = win.side;
    win.side = null;
    if (!win.win.isDestroyed()) win.win.contentView.removeChildView(view);
    try { if (!view.webContents.isDestroyed()) view.webContents.close(); } catch { /* gone */ }
    win.relayout(); win.pushState();
    router.sendEvent(extId, 'sidePanel.onClosed', { path: '', windowId: win.win.id });
    return true;
  }
  function openPanel(win, ext, { toggle = false } = {}) {
    const rel = panelPath(ext);
    if (!win || !rel) return false;
    if (win.side && win.side.kind === 'ext' && win.side.extId === ext.id) { if (toggle) closePanel(win); return true; }
    if (win.side) {
      if (win.side.kind === 'ext') closePanel(win);
      else { const v = win.side.view; win.side = null; if (!win.win.isDestroyed()) win.win.contentView.removeChildView(v); }
    }
    const view = new WebContentsView({
      webPreferences: { session: ctx.webSession, sandbox: true, contextIsolation: true, nodeIntegration: false, preload: path.join(PRELOAD_DIR, 'sidepanel.js') },
    });
    const wc = view.webContents;
    wc.setWindowOpenHandler(({ url }) => { if (/^(https?|chrome-extension):/i.test(url)) win.newTab(url, { forceWeb: true }); return { action: 'deny' }; });
    wc.on('will-navigate', (e, url) => { if (!url.startsWith(`chrome-extension://${ext.id}/`)) { e.preventDefault(); if (/^https?:/i.test(url)) win.newTab(url); } });
    wc.ipc.on('ferna-sidepanel-close', () => { if (win.side && win.side.view === view) closePanel(win); });
    wc.loadURL(`chrome-extension://${ext.id}/${rel}`);
    win.side = { view, kind: 'ext', extId: ext.id };
    win.win.contentView.addChildView(view);
    if (win.overlay && win.overlay.getVisible()) win.win.contentView.addChildView(win.overlay);
    win.relayout(); win.pushState();
    router.sendEvent(ext.id, 'sidePanel.onOpened', { path: rel, windowId: win.win.id });
    return true;
  }
  handle('sidePanel.setPanelBehavior', ({ extension }, b) => { behavior.set(extension.id, { openPanelOnActionClick: !!(b && b.openPanelOnActionClick) }); }, { permission: 'sidePanel' });
  handle('sidePanel.getPanelBehavior', ({ extension }) => ({ openPanelOnActionClick: !!(behavior.get(extension.id) || {}).openPanelOnActionClick }), { permission: 'sidePanel' });
  handle('sidePanel.setOptions', ({ extension }, o) => {
    if (!o || typeof o !== 'object' || o.tabId != null) return; // options per tab: not supported, kept global
    const cur = options.get(extension.id) || {};
    options.set(extension.id, { ...cur, ...(typeof o.path === 'string' ? { path: o.path } : {}), ...(typeof o.enabled === 'boolean' ? { enabled: o.enabled } : {}) });
    if (o.enabled === false) for (const w of ctx.windows) if (w.side && w.side.kind === 'ext' && w.side.extId === extension.id) closePanel(w);
  }, { permission: 'sidePanel' });
  handle('sidePanel.getOptions', ({ extension }) => { const o = options.get(extension.id) || {}; return { path: panelPath(extension) || undefined, enabled: o.enabled !== false }; }, { permission: 'sidePanel' });
  handle('sidePanel.open', ({ extension, sender }, o) => {
    const w = winOf(sender, o && o.windowId);
    if (!openPanel(w, extension)) throw new Error('No side panel to open');
  }, { permission: 'sidePanel' });
  handle('sidePanel.close', ({ extension, sender }, o) => {
    const w = winOf(sender, o && o.windowId);
    if (w && w.side && w.side.kind === 'ext' && w.side.extId === extension.id) closePanel(w);
  }, { permission: 'sidePanel' });

  /** Toolbar button clicked: true when it opened (or closed) the extension's side panel. */
  mgr.sidePanelClick = (win, extId) => {
    const ext = mgr.api.getExtension(extId);
    if (!ext || !(behavior.get(extId) || {}).openPanelOnActionClick || !panelPath(ext)) return false;
    return openPanel(win, ext, { toggle: true });
  };
  mgr.closeExtPanel = win => closePanel(win);
  mgr.extPanelOf = win => (win && win.side && win.side.kind === 'ext' ? win.side.extId : null);

  // ---------------------------------------------------------------- capture
  const lastCapture = new Map();
  handle('tabs.captureVisibleTab', async ({ extension, sender }, windowId, opts) => {
    const p = perms(extension);
    const win = winOf(sender, windowId);
    const t = win && win.active;
    const wc = t && t.view && !t.view.webContents.isDestroyed() ? t.view.webContents : null;
    if (!wc || t.kind !== 'web') throw new Error('Cannot access contents of the page');
    const url = wc.getURL();
    const hostOk = p.includes('<all_urls>') || p.some(x => /^(\*|https?):\/\/\*\/\*$/.test(x)) || p.includes('activeTab');
    if (!hostOk || !/^(https?|file):/i.test(url)) throw new Error('Cannot access contents of the page. Extension manifest must request permission to access the respective host.');
    // Chrome allows two captures a second per extension.
    const now = Date.now();
    const prev = lastCapture.get(extension.id) || 0;
    if (now - prev < 450) await new Promise(r => setTimeout(r, 450 - (now - prev)));
    lastCapture.set(extension.id, Date.now());
    const img = await wc.capturePage();
    const o = opts && typeof opts === 'object' ? opts : {};
    if (o.format === 'png') return img.toDataURL();
    const q = Number.isFinite(o.quality) ? Math.max(0, Math.min(100, o.quality)) : 92;
    return `data:image/jpeg;base64,${img.toJPEG(q).toString('base64')}`;
  });

  // ---------------------------------------------------------------- zoom events
  mgr.zoomChanged = (wc, oldZoomFactor, newZoomFactor) => {
    router.broadcastEvent('tabs.onZoomChange', { tabId: wc.id, oldZoomFactor, newZoomFactor, zoomSettings: { mode: 'automatic', scope: 'per-tab' } });
  };

  // ---------------------------------------------------------------- downloads
  const done = []; // [{ id, extId, filename, url, mime, bytes, time }]
  let nextId = 1;
  handle('downloads.download', async ({ extension, sender }, o) => {
    if (!o || typeof o !== 'object') throw new Error('Invalid download');
    let bytes = o.bytes ? Buffer.from(o.bytes) : null;
    const url = typeof o.url === 'string' ? o.url : '';
    if (!bytes) {
      if (!/^https?:/i.test(url)) throw new Error('Invalid URL');
      const r = await ctx.webSession.fetch(url, { credentials: 'include' });
      if (!r.ok) throw new Error(`Download failed: HTTP ${r.status}`);
      const len = Number(r.headers.get('content-length') || 0);
      if (len > 512 * 1024 * 1024) throw new Error('File too large');
      bytes = Buffer.from(await r.arrayBuffer());
    }
    if (bytes.length > 512 * 1024 * 1024) throw new Error('File too large');
    let rel = safeRelative(o.filename);
    if (!rel.length) { let n = 'download'; try { n = decodeURIComponent(new URL(url).pathname.split('/').pop()) || n; } catch { /* data or blob */ } rel = safeRelative(n); }
    const name = rel.pop();
    if (require('./policy').isRiskyDownload(name)) throw new Error('Extensions may not save programs or scripts');
    const dir = path.join(ctx.downloadsDir(), ...rel);
    let file = path.join(dir, name);
    if (o.saveAs) {
      const w = winOf(sender);
      const r = w ? await dialog.showSaveDialog(w.win, { defaultPath: file }) : await dialog.showSaveDialog({ defaultPath: file });
      if (r.canceled || !r.filePath) throw new Error('Download canceled');
      file = r.filePath;
    } else if (fs.existsSync(file) && o.conflictAction !== 'overwrite') {
      const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
      for (let i = 1; fs.existsSync(file); i++) file = path.join(dir, `${base} (${i})${ext}`);
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    require('./store').atomicWrite(file, bytes);
    const id = nextId++;
    const item = { id, extId: extension.id, filename: file, url: url || 'data:', mime: o.mime || '', bytes: bytes.length, time: new Date().toISOString() };
    done.push(item); while (done.length > 200) done.shift();
    if (ctx.recordExtensionDownload) ctx.recordExtensionDownload(file, url, bytes.length);
    const details = { id, url: item.url, filename: file, mime: item.mime, state: 'complete', totalBytes: bytes.length, bytesReceived: bytes.length, fileSize: bytes.length, startTime: item.time, endTime: item.time, exists: true, byExtensionId: extension.id, byExtensionName: extension.name, danger: 'safe', paused: false, canResume: false, error: undefined, incognito: false };
    router.sendEvent(extension.id, 'downloads.onCreated', { ...details, state: 'in_progress' });
    setTimeout(() => router.sendEvent(extension.id, 'downloads.onChanged', { id, state: { previous: 'in_progress', current: 'complete' }, endTime: { current: item.time }, exists: { current: true } }), 30);
    return id;
  }, { permission: 'downloads' });
  const find = (ext, id) => done.find(d => d.id === id && d.extId === ext.id);
  handle('downloads.show', ({ extension }, id) => { const d = find(extension, id); if (d && fs.existsSync(d.filename)) shell.showItemInFolder(d.filename); return !!d; }, { permission: 'downloads' });
  handle('downloads.showDefaultFolder', () => { shell.openPath(ctx.downloadsDir()); }, { permission: 'downloads' });
  handle('downloads.search', ({ extension }, q) => done.filter(d => d.extId === extension.id && (!q || q.id == null || q.id === d.id)).map(d => ({ id: d.id, url: d.url, filename: d.filename, mime: d.mime, state: 'complete', totalBytes: d.bytes, bytesReceived: d.bytes, fileSize: d.bytes, startTime: d.time, endTime: d.time, exists: fs.existsSync(d.filename), byExtensionId: d.extId, danger: 'safe', paused: false, canResume: false, incognito: false })), { permission: 'downloads' });

  // ---------------------------------------------------------------- installed / started
  // Delivered once the extension's worker listens for them (it registers at start-up).
  const deliver = (extId, name, args, tries = 0) => {
    const ls = (router.listeners && router.listeners.get(name)) || [];
    if (ls.some(l => l.extensionId === extId)) { router.sendEvent(extId, name, ...args); return; }
    if (tries < 40) setTimeout(() => deliver(extId, name, args, tries + 1), 250);
  };
  if (!mgr.reg.data.crxVersions) {
    // First start of 0.9: extensions you already had are not "installed" again.
    mgr.reg.data.crxVersions = {};
    for (const [id, k] of Object.entries(mgr.reg.data.known || {})) if (k && k.version) mgr.reg.data.crxVersions[id] = k.version;
    mgr.reg.save();
  }
  const started = new Set();
  mgr.api.on('extension-loaded', (e, ext) => {
    const versions = mgr.reg.data.crxVersions;
    const prev = versions[ext.id];
    const details = !prev ? { reason: 'install' } : prev !== ext.version ? { reason: 'update', previousVersion: prev } : null;
    if (prev !== ext.version) { versions[ext.id] = ext.version; mgr.reg.save(); }
    if (details) deliver(ext.id, 'runtime.onInstalled', [details]);
    else if (!started.has(ext.id)) deliver(ext.id, 'runtime.onStartup', []);
    started.add(ext.id);
  });

  // ---------------------------------------------------------------- commands (keyboard shortcuts)
  let table = null;
  const rebuild = () => { table = null; };
  mgr.api.on('extension-loaded', rebuild);
  mgr.api.on('extension-unloaded', rebuild);
  mgr.commandFor = input => {
    if (!input || input.type !== 'keyDown') return null;
    if (!table) {
      const disabled = new Set(mgr.reg.data.disabled || []);
      const builtIn = spec => Object.values(ctx.shortcuts.map).some(list => list.some(s => s.code === spec.code && s.ctrl === spec.ctrl && s.shift === spec.shift && s.alt === spec.alt && s.meta === spec.meta));
      table = commandTable(mgr.api.getAllExtensions().filter(e => !disabled.has(e.id)), builtIn);
    }
    return table.find(c => matches(c.spec, input)) || null;
  };
  mgr.runCommand = (win, c) => {
    const t = win.active;
    if (c.name === '_execute_action' || c.name === '_execute_browser_action') {
      const r = win.extActionRect ? win.extActionRect(c.extId) : undefined;
      mgr.click(win, c.extId, r);
      return;
    }
    const wc = t && t.view && t.kind === 'web' && !t.view.webContents.isDestroyed() ? t.view.webContents : null;
    const tab = wc ? lib.api.tabs.getTabDetails(wc) : undefined;
    router.sendEvent(c.extId, 'commands.onCommand', c.name, tab);
  };
  // chrome.commands.getAll: the keys really in use here.
  handle('commands.getAll', ({ extension }) => {
    const all = Object.entries(extension.manifest.commands || {});
    mgr.commandFor({ type: 'keyDown' }); // builds the table
    return all.map(([name, d]) => { const hit = (table || []).find(c => c.extId === extension.id && c.name === name); return { name, description: d.description || '', shortcut: hit ? hit.key : '' }; });
  });
}

module.exports = { install, parseChromeKey, suggestedKey, commandTable, safeRelative };
