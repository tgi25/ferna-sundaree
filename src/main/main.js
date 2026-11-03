'use strict';
// Ferna Sundaree — main process entry point.

const path = require('path');
const fs = require('fs');
const {
  app, session, protocol, nativeTheme, nativeImage, dialog, shell, clipboard, net, BaseWindow, webContents, safeStorage, Menu,
} = require('electron');

// ---------- before ready ----------

// Profiles: each has its own folder (cookies, bookmarks, passwords, extensions) and runs as its
// own instance. Started with --profile=<name>; "Default" otherwise.
const argValue = name => { const a = process.argv.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
const PROFILE = (argValue('profile') || 'Default').replace(/[^\w .-]/g, '').trim().slice(0, 40) || 'Default';
const PROFILES_DIR = process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'FernaSundaree', 'Profiles')
  : path.join(app.getPath('appData'), 'FernaSundaree', 'Profiles');
const DATA_DIR = process.env.FERNA_SUNDAREE_DATA || path.join(PROFILES_DIR, PROFILE);
app.setPath('userData', DATA_DIR);
app.setName('Ferna Sundaree');
// Present as plain Chrome everywhere, including extension service workers, which ignore the
// session user agent. Sites and extensions that see "Electron/" in the user agent take
// desktop-app code paths (LastPass then reads document.cookie in its worker and stalls).
const CHROME_UA = app.userAgentFallback.replace(/\s(Electron|ferna-sundaree|Ferna ?Sundaree)\/\S+/gi, '');
app.userAgentFallback = CHROME_UA;
if (process.platform === 'win32') app.setAppUserModelId('com.fernasolutions.sundaree');

// Every renderer is sandboxed. The only exception is the Linux test harness running as
// root (Chromium cannot sandbox root); it is never honoured on Windows or in a packaged build.
const TEST_NO_SANDBOX = process.platform === 'linux' && !app.isPackaged && process.env.FERNA_TEST_NO_SANDBOX === '1';
if (!TEST_NO_SANDBOX) app.enableSandbox();

// Startup-only protections (they need a restart to change), read before the app is ready.
const POLICY = require('./grouppolicy').read();
const EARLY = (() => { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'settings.json'), 'utf8')); } catch { return {}; } })();
Object.assign(EARLY, require('./grouppolicy').settingsFrom(POLICY));
// Third-party cookies: blocked by Chromium itself, both cookie headers and document.cookie in
// embedded frames (partitioned "CHIPS" cookies, which cannot track across sites, still work).
if (EARLY.blockThirdPartyCookies !== false) app.commandLine.appendSwitch('test-third-party-cookie-phaseout');
// Enhanced security mode: JavaScript runs without the optimising compiler (JIT), which removes
// the code most browser exploits target. Pages run slower and WebAssembly is unavailable.
if (EARLY.enhancedSecurity === true) app.commandLine.appendSwitch('js-flags', '--jitless');
// Per-session secret for fingerprinting noise; renderers inherit it (src/preload/privacy-fp.js).
process.env.FERNA_FP_SEED = require('crypto').randomBytes(16).toString('hex');
protocol.registerSchemesAsPrivileged([
  { scheme: 'ferna', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

if (!process.env.FERNA_TEST && !app.requestSingleInstanceLock()) {
  app.quit();
}

const { JsonStore, canEncrypt } = require('./store');
const { ShortcutRegistry, DEFAULTS: SHORTCUT_DEFAULTS } = require('./shortcuts');
const policy = require('./policy');
const ws = require('./workspaces');
const pagefx = require('./pagefx');
const privacy = require('./privacy');
const lookalike = require('./lookalike');
const ipc = require('./ipc');
const { Blocker } = require('./blocker');
const { FernaWindow, NEWTAB, isInternal } = require('./window');

const ROOT = path.join(__dirname, '..');
const PAGES = path.join(ROOT, 'pages');
const FEATURES = path.join(ROOT, 'features');
const VERSION = require(path.join(ROOT, '..', 'package.json')).version;

const DEFAULT_SETTINGS = {
  tabPosition: 'top', tabBarHidden: false, bookmarksBarHidden: false, verticalWidth: 240, verticalCollapsed: false,
  searchEngine: 'google', restoreSession: true, theme: 'system', accent: '#2563eb',
  httpsFirst: true, httpsExceptions: [], dohMode: 'automatic', dohProvider: 'cloudflare',
  blocker: true, blockerAllow: [], permissions: {}, shortcuts: {},
  pdfDefault: true, bookmarkFolder: '',
  zoomPrefs: {}, zoomSites: {}, hideToolbarWithTabs: false,
  wsShowNames: false, stripFavoritesOnly: false,
  safeBrowsing: true, customFilters: '', filterLists: [],
  autoUpdate: true,
  blockThirdPartyCookies: true, enhancedSecurity: false, gpc: true, fingerprintProtection: true, stripTracking: true, webrtcProtection: true,
  lookalikeWarnings: true, passwordWarnings: true, defenderScan: true, extensionGuard: true,
  selectionMenu: true, popupBlocker: true, popupAllow: [], cosmeticFiltering: true, listScriptlets: false, youtubeAds: true, equalizer: {},
  historyDays: 90, lastWorkspace: null, hints: {},
  // 0.5
  bookmarkBackupDays: 1, bookmarkBackupKeep: 14, bookmarkLastBackup: 0,
  sleepingTabs: true, sleepAfterMinutes: 60, autoPip: true, linkPreview: true,
  passwordManager: true, passwordLeakCheck: false, autofillAddresses: true, autofillCards: true, passwordNever: [],
  assistant: { provider: 'ollama', model: '', endpoint: '', skills: [] },
  translateTo: 'en', translateAsked: false, translateService: '', spellLangs: [],
  readerRate: 1, readerVoice: '', reader: {},
  sync: { folder: '', enabled: false, passwords: true, history: false, last: 0 },
  splitRatio: 0.5, sideWidth: 380,
  // 0.6
  eqPresets: [], workspaceThemes: true, adaptiveTheme: false, themeSchedule: { on: false, dark: '19:00', light: '06:30' }, highContrastToolbar: true,
};

// ---------- context shared by every window ----------

const ctx = {
  version: VERSION,
  profile: PROFILE,
  profilesDir: PROFILES_DIR,
  dataDir: DATA_DIR,
  windows: [],
  lastFocused: null,
  contents: new Map(), // webContents id → FernaWindow
  upgraded: new Map(), // webContents id → {from, to}
  downloads: [],
  shots: new Map(),
  privateCount: 0,
  iconPath: path.join(ROOT, '..', 'build', 'icon.png'),
};

function initStores() {
  const P = f => path.join(DATA_DIR, f);
  ctx.settings = new JsonStore(P('settings.json'), DEFAULT_SETTINGS);
  // 0.6.3: strict secure DNS (no fallback) made the first visit to busy sites fail while the
  // encrypted lookups warmed up (Facebook: "Something went wrong" until reloaded). Automatic
  // still encrypts DNS whenever the provider answers, as Chrome does.
  if (!ctx.settings.data.dns063) {
    ctx.settings.update(d => { if (d.dohMode === 'secure') d.dohMode = 'automatic'; d.dns063 = true; });
  }
  ctx.ws = new JsonStore(P('workspaces.json'), { workspaces: [], common: [], allPinned: [] });
  if (!Array.isArray(ctx.ws.data.allPinned)) ctx.ws.data.allPinned = [];
  ctx.bookmarks = new JsonStore(P('bookmarks.enc'), { items: [] }, { encrypt: true });
  ctx.bookmarks.data.items = require('./bookmarks').repair(ctx.bookmarks.data.items);
  ctx.history = new JsonStore(P('history.enc'), { entries: [] }, { encrypt: true });
  ctx.sessionStore = new JsonStore(P('session.enc'), { windows: [] }, { encrypt: true });
  ctx.shotsStore = new JsonStore(P('screenshots.json'), {});
  ctx.pdfStore = new JsonStore(P('pdf-reader.enc'), { sync: {}, local: {} }, { encrypt: true });
  ctx.shortcuts = new ShortcutRegistry(ctx.settings.data.shortcuts);
  pruneHistory();
}

ctx.isDark = () => nativeTheme.shouldUseDarkColors;
ctx.setLastFocused = w => { ctx.lastFocused = w; };
// ---------- look-alike addresses and first visits ----------
ctx.lookalikeHits = new Map();
ctx.lookalikeAllowed = new Set();
let knownCache = { at: 0, hosts: new Set() };
/** Hosts and registrable domains you have visited (or bookmarked); refreshed every minute. */
ctx.knownHosts = () => {
  if (Date.now() - knownCache.at < 60000) return knownCache.hosts;
  const hosts = new Set();
  const add = u => { const h = ws.hostOf(u); if (!h) return; hosts.add(h); const p = lookalike.parts(h); if (p.domain) hosts.add(p.domain); };
  for (const e of ctx.history.data.entries) add(e.url);
  for (const b of ctx.bookmarks.data.items) if (b.url) add(b.url);
  knownCache = { at: Date.now(), hosts };
  return hosts;
};
/** Your bookmarked sites, also protected against look-alikes. */
ctx.bookmarkHosts = () => [...new Set(ctx.bookmarks.data.items.filter(b => /^https?:/.test(b.url || '')).map(b => lookalike.parts(ws.hostOf(b.url)).domain).filter(Boolean))].slice(0, 500);
/** Visited before today's last hour? (for the password warning) */
ctx.visitedBefore = url => {
  const h = ws.hostOf(url);
  const cutoff = Date.now() - 3600 * 1000;
  return ctx.history.data.entries.some(e => e.ts < cutoff && ws.hostOf(e.url) === h) || ctx.bookmarks.data.items.some(b => b.url && ws.hostOf(b.url) === h);
};

ctx.registerContents = (wc, win) => {
  ctx.contents.set(wc.id, win);
  wc.once('destroyed', () => ctx.contents.delete(wc.id));
};
ctx.windowFor = wc => ctx.contents.get(wc.id) || null;
ctx.tabForContents = id => {
  const win = ctx.contents.get(id);
  return win ? win.tabs.find(t => t.view && t.view.webContents?.id === id) || null : null;
};
ctx.downloadsDir = () => app.getPath('downloads');
ctx.screenshotDir = () => {
  const d = path.join(ctx.downloadsDir(), 'Ferna Screenshots');
  fs.mkdirSync(d, { recursive: true });
  return d;
};
ctx.searchUrl = q => policy.normalizeInput(q.includes('.') || q.includes(':') ? `${q} ` : q, ctx.settings.data.searchEngine);
ctx.broadcast = () => ctx.windows.forEach(w => w.relayout());
/** Tell open internal pages of one kind (e.g. 'bookmarks') that their data changed. */
ctx.notifyPages = (host, channel = 'refresh', data = null) => {
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue;
    let h = '';
    try { h = new URL(wc.getURL()).host; } catch { continue; }
    if (h === host && wc.session === ctx.uiSession) wc.send(channel, data);
  }
};
ctx.broadcastBookmarks = () => ctx.notifyPages('bookmarks');
ctx.onThemeChanged = () => {
  ctx.broadcast();
  for (const w of ctx.windows) for (const t of w.tabs) {
    if (t.view && t.kind === 'internal' && /^ferna:\/\/newtab/.test(t.url) && (t.view.webContents && !(!t.view.webContents || t.view.webContents.isDestroyed()))) t.view.webContents.reload();
  }
};
ctx.quit = () => { saveSession(true); app.quit(); };

ctx.setSetting = (key, value) => {
  ctx.settings.set(key, value);
  if (['gpc', 'fingerprintProtection', 'listScriptlets', 'customFilters'].includes(key)) for (const ses of ctx.webSessions || []) setPrivacyPreloads(ses);
  if (key === 'webrtcProtection') for (const w of ctx.windows) for (const t of w.tabs) if (t.kind === 'web' && t.view && t.view.webContents && !t.view.webContents.isDestroyed()) privacy.protectContents(t.view.webContents, ctx.settings.data);
  if (key === 'blocker' || key === 'youtubeAds') for (const ses of ctx.webSessions || []) pagefx.setYouTubeShield(ses, !!ctx.settings.data.blocker && ctx.settings.data.youtubeAds !== false);
  if (key === 'selectionMenu' || key === 'searchEngine') for (const w of ctx.windows) for (const t of w.tabs) if (t.kind === 'web') ctx.pageFx.domReady(w, t);
  if (key === 'theme' || key === 'themeSchedule') { if (ctx.applyThemeSchedule) ctx.applyThemeSchedule(); else nativeTheme.themeSource = value; }
  if (key === 'dohMode' || key === 'dohProvider') configureDns();
  ctx.broadcast();
};

ctx.allowPopups = host => {
  if (!host) return;
  const list = ctx.settings.data.popupAllow || [];
  if (!list.includes(host)) ctx.settings.set('popupAllow', [...list, host].slice(-500));
};
ctx.newPrivateSession = () => {
  const ses = session.fromPartition(`ferna-private-${++ctx.privateCount}`, { cache: false });
  hardenSession(ses, { private: true });
  return ses;
};

ctx.newWindow = (opts = {}) => {
  const w = new FernaWindow(ctx, opts);
  ctx.windows.push(w);
  return w;
};

ctx.onWindowClosing = win => {
  if (win.private) return;
  if (win.appMode) return;
  const others = ctx.windows.filter(w => w !== win && !w.private && !w.appMode);
  if (!others.length) saveSession(true, [win]);
};
ctx.onWindowClosed = win => {
  ctx.windows = ctx.windows.filter(w => w !== win);
  if (ctx.lastFocused === win) ctx.lastFocused = ctx.windows[ctx.windows.length - 1] || null;
  if (ctx.windows.some(w => !w.private)) saveSession(true);
  if (!ctx.windows.length) {
    for (const s of [ctx.settings, ctx.ws, ctx.bookmarks, ctx.history]) s.flush();
    app.quit();
  }
};

// ---------- session restore ----------

let sessionTimer = null;
function saveSession(now = false, onlyThese = null) {
  const run = () => {
    const wins = (onlyThese || ctx.windows).filter(w => !w.private && !w.appMode && !w.win.isDestroyed());
    if (!wins.length && !onlyThese) return;
    ctx.sessionStore.data.windows = wins.map(w => w.serialize());
    ctx.sessionStore.flush();
  };
  clearTimeout(sessionTimer);
  if (now) run(); else sessionTimer = setTimeout(run, 1000);
}
ctx.saveSessionSoon = () => saveSession(false);

// ---------- history ----------

function pruneHistory() {
  const cutoff = Date.now() - (ctx.settings.data.historyDays || 90) * 864e5;
  const e = ctx.history.data.entries;
  const kept = e.filter(x => x.ts >= cutoff).slice(-50000);
  if (kept.length !== e.length) ctx.history.set('entries', kept);
}

ctx.addHistory = (url, title) => {
  if (!/^(https?|file):/i.test(url)) return;
  const e = ctx.history.data.entries;
  const last = e[e.length - 1];
  if (last && last.url === url && Date.now() - last.ts < 30 * 60 * 1000) { last.ts = Date.now(); last.title = title || last.title; }
  else e.push({ url, title: title || '', ts: Date.now() });
  ctx.history.save();
};
ctx.updateHistoryTitle = (url, title) => {
  const e = ctx.history.data.entries;
  for (let i = e.length - 1; i >= Math.max(0, e.length - 20); i--) {
    if (e[i].url === url) { e[i].title = title; ctx.history.save(); return; }
  }
};

// ---------- bookmarks ----------

const BM = require('./bookmarks');
const bmId = BM.bmId;
const bmItems = () => ctx.bookmarks.data.items;
const bmSaved = () => { ctx.bookmarks.save(); ctx.broadcast(); ctx.broadcastBookmarks(); if (ctx.sync) ctx.sync.soon(); };
ctx.findBookmark = url => url && bmItems().find(b => b.url === url);
/** Folder chosen in Settings for new bookmarks and the bookmarks popup ('' = none chosen). */
ctx.defaultBookmarkFolder = () => {
  const f = ctx.settings.data.bookmarkFolder || '';
  return f && (f in BM.ROOTS || bmItems().some(x => x.id === f && x.type === 'folder')) ? f : '';
};
ctx.toggleBookmark = (url, title) => {
  const items = bmItems();
  const i = items.findIndex(b => b.url === url);
  if (i >= 0) items.splice(i, 1);
  else BM.addBookmark(items, { parent: ctx.defaultBookmarkFolder() || 'bar', url, title });
  bmSaved();
};
ctx.updateBookmark = (id, patch) => { const ok = BM.update(bmItems(), id, patch || {}); if (ok) bmSaved(); return ok; };
ctx.deleteBookmark = id => { ctx.bookmarks.data.items = BM.remove(bmItems(), id); bmSaved(); };
/** One operation from the bookmarks popup or manager. Returns the new list. */
ctx.bookmarkOp = (op, a = {}) => {
  const items = bmItems();
  let ok = true;
  if (op === 'add') ok = !!BM.addBookmark(items, { parent: a.parent, url: a.url, title: a.title, index: a.index });
  else if (op === 'folder') ok = !!BM.addFolder(items, { parent: a.parent, title: a.title, index: a.index });
  else if (op === 'update') ok = BM.update(items, a.id, a);
  else if (op === 'move') ok = BM.move(items, a.id, a.parent, a.index);
  else if (op === 'delete') ctx.bookmarks.data.items = BM.remove(items, a.id);
  else ok = false;
  if (ok) bmSaved();
  return { ok, items: bmItems() };
};
function importBookmarksHtml(html) { const n = BM.importHtml(bmItems(), String(html)); bmSaved(); return n; }
function exportBookmarksHtml() { return BM.exportHtml(bmItems()); }

// ---------- workspaces & common bar ----------

/** Pinned sites of a workspace, or of All tabs when wsId is '' / null. */
ctx.pinnedList = wsId => {
  if (!wsId) return ctx.ws.data.allPinned || (ctx.ws.data.allPinned = []);
  const w = ctx.ws.data.workspaces.find(x => x.id === wsId);
  return w ? w.pinned : null;
};
ctx.findPin = (wsId, url) => {
  const list = ctx.pinnedList(wsId);
  // Same page or same folder; a pin on a parent folder does not count as this page being pinned.
  const folder = ws.folderOf(url);
  return list ? list.findIndex(p => p.url === url || (p.folder || ws.folderOf(p.url)) === folder) : -1;
};
ctx.pinSite = (wsId, url, title) => {
  const list = ctx.pinnedList(wsId);
  if (!list || !/^(https?|file):/i.test(url || '') || ctx.findPin(wsId, url) >= 0 || list.length >= 60) return false;
  list.push({ url, title: title || url, folder: ws.folderOf(url) });
  ctx.ws.save(); ctx.broadcast();
  return true;
};
ctx.unpinSite = (wsId, index) => {
  const list = ctx.pinnedList(wsId);
  if (!list || !list[index]) return;
  list.splice(index, 1);
  ctx.ws.save(); ctx.broadcast();
};
ctx.findCommon = url => { const f = ws.folderOf(url); return ctx.ws.data.common.findIndex(c => c.url === url || (c.folder || ws.folderOf(c.url)) === f); };
ctx.addCommon = (url, title) => {
  const c = ctx.ws.data.common;
  const folder = ws.folderOf(url);
  if (!/^(https?|file):/i.test(url || '') || c.length >= 20 || c.some(x => x.folder === folder)) return false;
  c.push({ url, title: title || url, folder });
  ctx.ws.save(); ctx.broadcast();
  return true;
};
ctx.removeCommon = i => { ctx.ws.data.common.splice(i, 1); ctx.ws.save(); ctx.broadcast(); };
ctx.moveCommon = (from, to) => {
  const c = ctx.ws.data.common;
  const [x] = c.splice(from, 1);
  c.splice(to, 0, x);
  ctx.ws.save(); ctx.broadcast();
};
ctx.createWorkspace = name => {
  const w = ws.newWorkspace(String(name).trim().slice(0, 40) || 'Workspace', ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2'][ctx.ws.data.workspaces.length % 6]);
  ctx.ws.data.workspaces.push(w);
  ctx.ws.save(); ctx.broadcast();
  return w;
};
ctx.deleteWorkspace = id => {
  ctx.ws.data.workspaces = ctx.ws.data.workspaces.filter(w => w.id !== id);
  ctx.ws.save();
  for (const win of ctx.windows) {
    if (win.currentWs === id) win.currentWs = null;
    win.tabs.forEach(t => { if (t.wsOverride === id) t.wsOverride = null; });
  }
  ctx.broadcast();
};
ctx.toggleBlockerAllow = host => {
  const a = ctx.settings.data.blockerAllow;
  const i = a.indexOf(host);
  if (i >= 0) a.splice(i, 1); else a.push(host);
  ctx.settings.save(); ctx.broadcast();
};

// ---------- zoom ----------

const zoom = require('./zoom');
ctx.zoomPrefs = () => ({ ...zoom.DEFAULTS, ...(ctx.settings.data.zoomPrefs || {}) });

/** Current zoom state of a tab: per site (saved) or per tab. */
ctx.zoomState = (win, tab) => {
  const prefs = ctx.zoomPrefs();
  if (prefs.mode === 'tab' || win.private) return tab.zoom || (tab.zoom = zoom.defaultState(prefs));
  const key = zoom.siteKey(tab.url, prefs);
  const saved = key && ctx.settings.data.zoomSites[key];
  return saved ? { ...zoom.defaultState(prefs), ...saved } : zoom.defaultState(prefs);
};

function sameState(a, b) { return ['type', 'full', 'text', 'nonText', 'minFont'].every(k => a[k] === b[k]); }

function saveZoomState(win, tab, state) {
  const prefs = ctx.zoomPrefs();
  if (prefs.mode === 'tab' || win.private) { tab.zoom = state; return [[win, tab]]; }
  const key = zoom.siteKey(tab.url, prefs);
  if (!key) { tab.zoom = state; return [[win, tab]]; }
  if (sameState(state, zoom.defaultState(prefs))) delete ctx.settings.data.zoomSites[key];
  else ctx.settings.data.zoomSites[key] = state;
  ctx.settings.save();
  // Every open tab of the same site follows.
  const out = [];
  for (const w of ctx.windows) if (!w.private) for (const t of w.tabs) if (t.view && t.kind === 'web' && zoom.siteKey(t.url, prefs) === key) out.push([w, t]);
  return out;
}

async function applyZoom(win, tab, { textOnly = false } = {}) {
  if (!tab.view || tab.kind !== 'web' || (!tab.view.webContents || tab.view.webContents.isDestroyed())) return;
  const wc = tab.view.webContents;
  const prefs = ctx.zoomPrefs();
  const e = zoom.effective(ctx.zoomState(win, tab), prefs);
  try {
    if (!textOnly) {
      if (tab._zoomCss) { await wc.removeInsertedCSS(tab._zoomCss).catch(() => {}); tab._zoomCss = null; }
      if (e.useCss) {
        wc.setZoomFactor(1);
        if (Math.abs(e.pageFactor - 1) > 0.001) tab._zoomCss = await wc.insertCSS(`html { zoom: ${e.pageFactor} !important; }`, { cssOrigin: 'user' });
      } else {
        wc.setZoomFactor(e.pageFactor);
      }
    }
    const textActive = Math.abs(e.textFactor - 1) > 0.001 || e.minFont > 0;
    if (textActive || tab._tz) {
      await wc.executeJavaScriptInIsolatedWorld(zoom.ISOLATED_WORLD, [{ code: zoom.TEXT_ZOOM_SCRIPT }]);
      await wc.executeJavaScriptInIsolatedWorld(zoom.ISOLATED_WORLD, [{ code: `window.__fernaTZ(${e.textFactor}, ${e.minFont}, ${e.lineSpacing})` }]);
      tab._tz = textActive;
    }
  } catch { /* page navigated away meanwhile */ }
  win.pushState();
}

ctx.zoomOnNavigate = (win, tab) => { tab._tz = false; tab._zoomCss = null; applyZoom(win, tab); };
ctx.zoomOnDomReady = (win, tab) => {
  const e = zoom.effective(ctx.zoomState(win, tab), ctx.zoomPrefs());
  if (e.useCss || Math.abs(e.textFactor - 1) > 0.001 || e.minFont > 0) applyZoom(win, tab, { textOnly: !e.useCss });
};
ctx.zoomOnLoad = (win, tab) => {
  const prefs = ctx.zoomPrefs();
  if (!prefs.autofitOnLoad || prefs.mode !== 'site') return;
  const key = zoom.siteKey(tab.url, prefs);
  if (key && !ctx.settings.data.zoomSites[key]) ctx.zoomAct(win, tab, 'autofit', null, { save: false });
};

ctx.zoomDisplay = (win, tab) => {
  if (!tab || tab.kind !== 'web') return { level: 100, type: 'full', minFont: 0, isDefault: true };
  const prefs = ctx.zoomPrefs();
  const st = ctx.zoomState(win, tab);
  return { level: zoom.displayLevel(st), type: st.type, minFont: st.minFont || 0, isDefault: sameState(st, zoom.defaultState(prefs)) };
};

/** Zoom actions (toolbar panel, shortcuts, menus): in, out, inSmall, outSmall, set, reset,
 *  type, setType, autofit, minFont, fontReset, setDefault. */
ctx.zoomAct = async (win, tab, action, value, opts = {}) => {
  if (!tab || tab.kind !== 'web' || !tab.view || !tab.view.webContents || tab.view.webContents.isDestroyed()) return null;
  const prefs = ctx.zoomPrefs();
  const st = { ...ctx.zoomState(win, tab) };
  const levelKey = st.type === 'text' ? 'text' : 'full';
  switch (action) {
    case 'in': case 'out': st[levelKey] = zoom.nextLevel(st[levelKey], action, prefs); break;
    case 'inSmall': st[levelKey] = zoom.nextLevel(st[levelKey], 'in', prefs, true); break;
    case 'outSmall': st[levelKey] = zoom.nextLevel(st[levelKey], 'out', prefs, true); break;
    case 'set': if (Number.isFinite(value)) st[levelKey] = zoom.clamp(value); break;
    case 'reset': Object.assign(st, { type: prefs.defaultType, full: prefs.defaultFull, text: prefs.defaultText, nonText: prefs.defaultNonText }); break;
    case 'type': st.type = st.type === 'text' ? 'full' : 'text'; break;
    case 'setType': if (value === 'text' || value === 'full') st.type = value; break;
    case 'minFont': if (Number.isFinite(value)) st.minFont = Math.max(0, Math.min(40, Math.round(value))); break;
    case 'fontReset': st.minFont = prefs.minFont; break;
    case 'autofit': {
      try {
        const m = await tab.view.webContents.executeJavaScriptInIsolatedWorld(zoom.ISOLATED_WORLD, [{ code: zoom.MEASURE_SCRIPT }]);
        st.type = 'full';
        st.full = zoom.autofitLevel(m, zoom.effective(st, prefs).pageFactor * 100, prefs);
      } catch { return null; }
      break;
    }
    case 'setDefault': {
      const p = ctx.settings.data.zoomPrefs = { ...(ctx.settings.data.zoomPrefs || {}) };
      p.defaultType = st.type; p.defaultFull = st.full; p.defaultText = st.text; p.minFont = st.minFont;
      ctx.settings.save();
      win.sendUi('toast', { text: `Default zoom set to ${st.type === 'text' ? 'text' : 'full'} ${zoom.displayLevel(st)}%.` });
      break;
    }
    default: return null;
  }
  const targets = opts.save === false ? [[win, tab]] : saveZoomState(win, tab, st);
  if (opts.save === false) tab.zoom = st;
  await Promise.all(targets.map(([w, t]) => applyZoom(w, t)));
  return ctx.zoomPanelData(win, tab);
};

ctx.zoomPanelData = (win, tab) => {
  const prefs = ctx.zoomPrefs();
  const st = ctx.zoomState(win, tab);
  return {
    state: st, level: zoom.displayLevel(st), levels: [...new Set(prefs.levels.map(zoom.clamp))].sort((a, b) => a - b),
    site: prefs.mode === 'tab' || win.private ? null : zoom.siteKey(tab.url, prefs), mode: win.private ? 'tab' : prefs.mode,
    fonts: [0, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24],
  };
};

// ---------- downloads ----------

let nextDownloadId = 1;
function uniquePath(dir, name) {
  const safe = (name || 'download').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 180) || 'download';
  const ext = path.extname(safe);
  const base = safe.slice(0, safe.length - ext.length);
  let p = path.join(dir, safe);
  for (let i = 1; fs.existsSync(p) || ctx.downloads.some(d => d.path === p && d.state === 'progressing'); i++) p = path.join(dir, `${base} (${i})${ext}`);
  return p;
}

function publicDownload(d) {
  return { id: d.id, filename: d.filename, path: d.path, url: d.url, state: d.state, received: d.received, total: d.total, paused: d.paused, risky: d.risky, start: d.start, scan: d.scan || null };
}
ctx.downloadSummary = () => ({ active: ctx.downloads.filter(d => d.state === 'progressing').length, total: ctx.downloads.length });

function notifyDownloads() {
  for (const w of ctx.windows) {
    w.pushState();
    for (const t of w.tabs) {
      if (t.view && t.kind === 'internal' && /^ferna:\/\/downloads/.test(t.url) && (t.view.webContents && !(!t.view.webContents || t.view.webContents.isDestroyed()))) {
        t.view.webContents.send('downloads', ctx.downloads.map(publicDownload));
      }
    }
  }
}

function onWillDownload(e, item, wc) {
  if (ctx.hasPdfReader && ctx.settings.data.pdfDefault && item.getMimeType() === 'application/pdf' && /^(https?|file):/i.test(item.getURL()) &&
      !(item.getContentDisposition() || '').toLowerCase().startsWith('attachment')) {
    item.cancel();
    const win = (wc && ctx.windowFor(wc)) || ctx.lastFocused;
    const tab = wc && ctx.tabForContents(wc.id);
    if (win && tab && (!tab.url || tab.url === 'about:blank')) win.navigate(tab, ctx.pdfViewerUrl(item.getURL()));
    else if (win) win.newTab(ctx.pdfViewerUrl(item.getURL()), { index: tab ? win.tabs.indexOf(tab) + 1 : undefined });
    return;
  }
  if (ctx.settings.data.safeBrowsing !== false && ctx.safety) {
    const chain = [item.getURL(), ...(item.getURLChain ? item.getURLChain() : [])];
    const kind = chain.map(u => ctx.safety.check(u)).find(Boolean);
    if (kind) {
      item.cancel();
      const win = (wc && ctx.windowFor(wc)) || ctx.lastFocused;
      if (win) win.sendUi('toast', { text: `Download blocked: ${item.getFilename()} comes from a known ${kind === 'phishing' ? 'phishing' : 'malware'} site.` });
      return;
    }
  }
  const p = uniquePath(ctx.downloadsDir(), item.getFilename());
  item.setSavePath(p);
  const d = {
    id: nextDownloadId++, item, path: p, filename: path.basename(p), url: item.getURL(), referrer: wc && !wc.isDestroyed() ? wc.getURL() : '',
    state: 'progressing', received: 0, total: item.getTotalBytes(), paused: false, risky: policy.isRiskyDownload(p), start: Date.now(),
  };
  ctx.downloads.unshift(d);
  if (ctx.downloads.length > 200) ctx.downloads.pop();
  if (d.risky) {
    item.pause();
    const win = wc && ctx.windowFor(wc);
    const opts = {
      type: 'warning', buttons: ['Discard', 'Keep'], defaultId: 0, cancelId: 0, noLink: true,
      title: 'Ferna Sundaree', message: `“${d.filename}” can harm your computer.`,
      detail: `Files of this type can run programs on your PC. Keep it only if you trust ${(() => { try { return new URL(d.url).hostname; } catch { return 'the source'; } })()}.`,
    };
    (win ? dialog.showMessageBox(win.win, opts) : dialog.showMessageBox(opts)).then(r => {
      if (r.response === 1) item.resume(); else item.cancel();
    });
  }
  item.on('updated', (ev, state) => {
    d.received = item.getReceivedBytes();
    d.total = item.getTotalBytes();
    d.paused = item.isPaused();
    d.state = state === 'interrupted' ? 'interrupted' : 'progressing';
    notifyDownloads();
  });
  item.once('done', (ev, state) => {
    d.state = state;
    d.received = item.getReceivedBytes();
    d.item = null;
    if (state === 'completed' && process.platform === 'win32') {
      // Mark of the Web: lets SmartScreen and Defender treat the file as downloaded.
      try { fs.writeFileSync(`${d.path}:Zone.Identifier`, policy.zoneIdentifier(d.url, d.referrer)); } catch { /* non-NTFS */ }
      if (ctx.settings.data.defenderScan !== false) {
        d.scan = 'scanning';
        require('./defender').scan(d.path).then(r => {
          d.scan = r;
          if (r === 'threat') {
            const w = ctx.lastFocused || ctx.windows[0];
            if (w) w.sendUi('toast', { text: `Microsoft Defender found a threat in ${d.filename} and removed it.` });
          }
          notifyDownloads();
        });
      }
    }
    notifyDownloads();
  });
  notifyDownloads();
}

// ---------- screenshots ----------

let nextShot = 1;
ctx.storeShot = (image, meta) => {
  const id = `s${nextShot++}-${Math.random().toString(36).slice(2, 8)}`;
  ctx.shots.set(id, { image, meta, png: null });
  while (ctx.shots.size > 12) ctx.shots.delete(ctx.shots.keys().next().value);
  return id;
};
ctx.dropShot = id => ctx.shots.delete(id);
ctx.openShot = (win, image, meta) => {
  const id = ctx.storeShot(image, meta);
  const quick = ctx.shotSettings().afterCapture === 'save';
  win.newTab(`ferna://shots/editor.html?id=${id}&import=1${quick ? '&quick=1' : ''}`, {
    index: win.active ? win.tabs.indexOf(win.active) + 1 : undefined, activate: !quick,
  });
};

// ---------- PDF (Ferna PDF Reader hook) ----------

const PDF_VIEWER = path.join(FEATURES, 'pdf-reader', 'viewer', 'viewer.html');
ctx.hasPdfReader = fs.existsSync(PDF_VIEWER);
ctx.pdfViewerUrl = url => `ferna://pdf/viewer/viewer.html?file=${encodeURIComponent(url)}`;
ctx.pdfViewerFor = url => {
  if (!ctx.hasPdfReader || !/\.pdf([?#]|$)/i.test(url || '') || !/^(https?|file):/i.test(url)) return null;
  return ctx.pdfViewerUrl(url);
};

// ---------- Ferna Screenshots settings (shared with the editor's own settings page) ----------

ctx.shotSettings = () => {
  const s = (ctx.shotsStore && ctx.shotsStore.data.settings) || {};
  return {
    afterCapture: s.afterCapture === 'save' ? 'save' : 'editor',
    maxHeight: Number.isFinite(s.maxHeight) ? Math.max(1000, Math.min(100000, s.maxHeight)) : 30000,
    resolution: s.resolution === 'css' ? 'css' : 'device',
    delay: Number.isFinite(s.delay) ? Math.max(0, Math.min(10, s.delay)) : 0,
  };
};

// ---------- network & session hardening ----------

ctx.upgradedFrom = (wcId, url) => {
  const e = ctx.upgraded.get(wcId);
  if (!e) return null;
  const strip = u => u.split('#')[0].replace(/\/$/, '');
  return strip(url) === strip(e.to) ? e.from : null;
};

const PERMISSION_LABEL = {
  media: 'use your camera or microphone', geolocation: 'know your location', notifications: 'show notifications',
  midi: 'use MIDI devices', midiSysex: 'control MIDI devices', 'clipboard-read': 'read your clipboard',
  'display-capture': 'share your screen', 'idle-detection': 'know when you are away', 'window-management': 'manage windows on your displays',
  'storage-access': 'use cookies inside other sites', 'top-level-storage-access': 'use cookies inside other sites',
};

/** Register or remove the privacy preloads (they run in every frame of web pages). */
function setPrivacyPreloads(ses) {
  // The scriptlet preload only while something can use it: the lists' scriptlets (an opt-in
  // setting) or +js rules of your own.
  const scriptlets = ctx.settings.data.listScriptlets === true || /\+js\(/.test(String(ctx.settings.data.customFilters || ''));
  const want = { 'ferna-gpc': ctx.settings.data.gpc !== false ? 'privacy-gpc.js' : null, 'ferna-fp': ctx.settings.data.fingerprintProtection !== false ? 'privacy-fp.js' : null, 'ferna-scriptlets': scriptlets ? 'scriptlets.js' : null };
  let have = [];
  try { have = ses.getPreloadScripts().map(p => p.id); } catch { /* older Electron */ }
  for (const [id, file] of Object.entries(want)) {
    try {
      if (file && !have.includes(id)) ses.registerPreloadScript({ id, type: 'frame', filePath: path.join(ROOT, 'preload', file) });
      if (!file && have.includes(id)) ses.unregisterPreloadScript(id);
    } catch { /* ignore */ }
  }
}

function hardenSession(ses, { private: isPrivate = false } = {}) {
  setPrivacyPreloads(ses);
  // Global Privacy Control header on every request.
  ses.webRequest.onBeforeSendHeaders((d, cb) => {
    const headers = { ...d.requestHeaders };
    if (ctx.settings.data.gpc !== false) headers['Sec-GPC'] = '1';
    // Parental controls: YouTube's Restricted Mode.
    if (ctx.parental && ctx.parental.on()) { let h = ''; try { h = new URL(d.url).hostname; } catch { /* none */ } if (ctx.parental.youtubeRestrict(h)) headers['YouTube-Restrict'] = 'Strict'; }
    cb({ requestHeaders: headers });
  });
  ctx.webSessions = ctx.webSessions || new Set();
  ctx.webSessions.add(ses);
  pagefx.setYouTubeShield(ses, !!ctx.settings.data.blocker && ctx.settings.data.youtubeAds !== false);
  ses.setUserAgent(CHROME_UA);

  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    let origin = '';
    try { origin = new URL(details.requestingUrl || wc.getURL()).origin; } catch { /* none */ }
    const decisions = isPrivate ? {} : ctx.settings.data.permissions;
    const d = policy.permissionDecision(permission, origin, decisions);
    if (d !== 'ask') return callback(d === 'allow');
    const win = ctx.windowFor(wc);
    let label = PERMISSION_LABEL[permission] || permission;
    if (permission === 'media' && details.mediaTypes) {
      const t = details.mediaTypes;
      label = t.includes('video') && t.includes('audio') ? 'use your camera and microphone' : t.includes('video') ? 'use your camera' : 'use your microphone';
    }
    const opts = {
      type: 'question', buttons: ['Block', 'Allow'], defaultId: 0, cancelId: 0, noLink: true,
      title: 'Permission request', message: `${origin || 'This page'} wants to ${label}.`,
      checkboxLabel: isPrivate ? undefined : 'Remember my choice for this site', checkboxChecked: !isPrivate,
    };
    (win ? dialog.showMessageBox(win.win, opts) : dialog.showMessageBox(opts)).then(r => {
      const allow = r.response === 1;
      if (!isPrivate && r.checkboxChecked && origin) {
        ctx.settings.data.permissions[`${origin}|${permission}`] = allow ? 'allow' : 'deny';
        ctx.settings.save();
      }
      callback(allow);
    });
  });
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin) =>
    policy.permissionDecision(permission, requestingOrigin, isPrivate ? {} : ctx.settings.data.permissions) === 'allow');
  ses.setDevicePermissionHandler(() => false);
  ses.setDisplayMediaRequestHandler((req, cb) => cb({})); // screen sharing needs a picker; refused in v0.1

  ses.webRequest.onBeforeRequest((details, cb) => {
    const s = ctx.settings.data;
    const { url, resourceType, webContentsId } = details;
    // Parental controls first: nothing else may let a blocked site through.
    if (ctx.parental && ctx.parental.on() && /^https?:/i.test(url)) {
      const why = ctx.parental.check(url);
      if (why) { if (resourceType === 'mainFrame') ctx.parental.record(webContentsId, url, why); return cb({ cancel: true }); }
      if (resourceType === 'mainFrame' && details.method === 'GET') { const ss = ctx.parental.safeSearchUrl(url); if (ss) return cb({ redirectURL: ss }); }
    }
    if (resourceType === 'mainFrame') {
      if (s.httpsFirst && policy.shouldUpgrade(url, s.httpsExceptions)) {
        const to = policy.upgradeUrl(url);
        ctx.upgraded.set(webContentsId, { from: url, to });
        return cb({ redirectURL: to });
      }
      if (ctx.upgraded.has(webContentsId) && !url.startsWith(ctx.upgraded.get(webContentsId).to.split('#')[0])) ctx.upgraded.delete(webContentsId);
      if (s.stripTracking !== false && details.method === 'GET') {
        const clean = privacy.stripTracking(url);
        if (clean !== url) return cb({ redirectURL: clean });
      }
    }
    // Look-alike addresses: only for sites you have never visited or bookmarked.
    if (resourceType === 'mainFrame' && s.lookalikeWarnings !== false && /^https?:/.test(url) && !(ctx.lookalikeAllowed || new Set()).has(ws.hostOf(url))) {
      const verdict = lookalike.check(ws.hostOf(url), ctx.knownHosts(), ctx.bookmarkHosts());
      if (verdict) { ctx.lookalikeHits.set(webContentsId, { url, ...verdict }); return cb({ cancel: true }); }
    }
    // Safe browsing first: it works even with ad blocking off.
    if (s.safeBrowsing !== false && ctx.safety && /^https?:/.test(url)) {
      const kind = ctx.safety.check(url);
      if (kind && !ctx.safety.isAllowed(url)) {
        if (resourceType === 'mainFrame') ctx.safety.hits.set(webContentsId, { url, kind });
        return cb({ cancel: true });
      }
    }
    if (s.blocker && /^https?:/.test(url) && ctx.blocker && ctx.blocker.engine) {
      // The page the request belongs to: its top frame, which is right even during the first
      // load (webContents.getURL() still shows the previous page then).
      let top = '';
      try { top = (details.frame && details.frame.top && details.frame.top.url) || ''; } catch { /* frame gone */ }
      if (!top) { try { top = details.webContents ? details.webContents.getURL() : ''; } catch { /* gone */ } }
      const host = ws.hostOf(resourceType === 'mainFrame' ? url : top);
      if (!host || !s.blockerAllow.includes(host)) {
        const r = ctx.blocker.match(details);
        if (r.block) {
          const tab = ctx.tabForContents(webContentsId);
          if (tab) { tab.blocked = (tab.blocked || 0) + 1; const w = ctx.contents.get(webContentsId); if (w && w.activeId === tab.id) w.pushState(); }
          return cb({ cancel: true });
        }
        if (r.redirect) return cb({ redirectURL: r.redirect });
      }
    }
    cb({});
  });

  // PDFs served at any address (not only *.pdf) open in Ferna PDF Reader: the response is
  // turned into a redirect, which the tab's will-redirect guard swaps into the reader view.
  ses.webRequest.onHeadersReceived((d, cb) => {
    if (d.resourceType !== 'mainFrame' || d.method !== 'GET' || !ctx.hasPdfReader || !ctx.settings.data.pdfDefault || !/^https?:/i.test(d.url)) return cb({});
    const h = {};
    for (const [k, v] of Object.entries(d.responseHeaders || {})) h[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : String(v);
    const pdf = /^application\/(x-)?pdf\b/i.test(h['content-type'] || '') && !/^\s*attachment/i.test(h['content-disposition'] || '');
    if (!pdf || d.statusCode < 200 || d.statusCode >= 300) return cb({});
    cb({ statusLine: 'HTTP/1.1 302 Found', responseHeaders: { Location: [ctx.pdfViewerUrl(d.url)], 'Cache-Control': ['no-store'] } });
  });
  ses.on('will-download', onWillDownload);
  try { ses.setSpellCheckerLanguages((ctx.settings.data.spellLangs || []).length ? ctx.settings.data.spellLangs : ['en-US']); } catch { ses.setSpellCheckerLanguages(['en-US']); }
}

function configureDns() {
  const s = ctx.settings.data;
  try {
    if (s.dohMode === 'off') app.configureHostResolver({ secureDnsMode: 'off' });
    else app.configureHostResolver({ secureDnsMode: s.dohMode === 'automatic' ? 'automatic' : 'secure', secureDnsServers: policy.DOH_PROVIDERS[s.dohProvider] || policy.DOH_PROVIDERS.cloudflare });
  } catch { /* not supported on this platform */ }
}

// ---------- ferna:// protocol (internal pages only, on the UI session) ----------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8', '.traineddata': 'application/octet-stream', '.gz': 'application/gzip', '.pdf': 'application/pdf',
};
const BASE_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ferna: https: http:; " +
  "connect-src 'self'; font-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const PDF_CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; " +
  "connect-src 'self' blob: data: https://api.anthropic.com https://api.openai.com https://huggingface.co https://*.hf.co https://*.huggingface.co https://raw.githubusercontent.com http://localhost:* http://127.0.0.1:*; " +
  "object-src 'none'; frame-ancestors 'none'; base-uri 'none'";
const SHOTS_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ferna:; " +
  "connect-src 'self' blob: data: ferna:; font-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'";

function serveFile(base, rel, csp) {
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base + path.sep) && file !== base) return new Response('Forbidden', { status: 403 });
  let target = file;
  try { if (fs.statSync(target).isDirectory()) target = path.join(target, 'index.html'); } catch { /* handled below */ }
  try {
    const data = fs.readFileSync(target);
    return new Response(data, {
      headers: {
        'content-type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
        'content-security-policy': csp, 'x-content-type-options': 'nosniff', 'cache-control': 'no-cache',
        'cross-origin-opener-policy': 'same-origin', 'referrer-policy': 'no-referrer',
      },
    });
  } catch {
    return new Response('<!doctype html><title>Not found</title><p style="font:14px system-ui;padding:2em">This Ferna page does not exist.</p>', {
      status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': BASE_CSP },
    });
  }
}

function installProtocol(ses) {
  ses.protocol.handle('ferna', req => {
    const u = new URL(req.url);
    const host = u.host.toLowerCase();
    const rel = decodeURIComponent(u.pathname);
    if (host === 'shotimg' || ((host === 'shots' || host === 'overlay') && rel.startsWith('/_shot/'))) {
      const id = path.basename(rel, '.png');
      const shot = ctx.shots.get(id);
      if (!shot) return new Response('Gone', { status: 404 });
      if (!shot.png) shot.png = shot.image.toPNG();
      return new Response(shot.png, { headers: { 'content-type': 'image/png', 'cache-control': 'no-store' } });
    }
    if (host === 'theme') {
      const parts = rel.replace(/^\//, '').split('/');
      const data = ctx.ext && ctx.ext.themeFile(parts[0], parts.slice(1).join('/'));
      if (!data) return new Response('Not found', { status: 404 });
      return new Response(data, { headers: { 'content-type': MIME[path.extname(rel).toLowerCase()] || 'image/png', 'cache-control': 'no-cache' } });
    }
    if (host === 'pdf') return serveFile(path.join(FEATURES, 'pdf-reader'), rel, PDF_CSP);
    if (host === 'shots') return serveFile(path.join(FEATURES, 'screenshots'), rel, SHOTS_CSP);
    if (rel.startsWith('/_shared/')) return serveFile(path.join(PAGES, '_shared'), rel.slice('/_shared/'.length), BASE_CSP);
    if (!/^[a-z0-9-]+$/.test(host) || host.startsWith('_')) return new Response('Not found', { status: 404 });
    return serveFile(path.join(PAGES, host), rel, BASE_CSP);
  });
}

// ---------- IPC commands ----------

function senderWindow(c) { return ctx.windowFor(c.wc); }
function senderTab(c) {
  const w = senderWindow(c);
  return w ? w.tabs.find(t => t.view && t.view.webContents?.id === c.wc.id) : null;
}
/** Task manager: memory and CPU of every tab, plus the browser's own processes. */
function taskList() {
  const metrics = new Map(app.getAppMetrics().map(m => [m.pid, m]));
  const used = new Set();
  const rows = [];
  for (const w of ctx.windows) for (const t of w.tabs) {
    const wc = t.view && !t.view.webContents.isDestroyed() ? t.view.webContents : null;
    const pid = wc ? wc.getOSProcessId() : 0;
    const m = metrics.get(pid);
    if (m) used.add(pid);
    rows.push({
      windowId: w.id, tabId: t.id, title: t.title || t.url, url: t.url, favicon: t.favicon, private: w.private,
      state: !wc ? 'sleeping' : t.id === w.activeId ? 'active' : 'loaded', audible: !!t.audible, pid,
      memory: m ? Math.round(m.memory.workingSetSize / 1024) : 0, cpu: m ? Math.round(m.cpu.percentCPUUsage * 10) / 10 : 0,
      keepLoaded: !!t.keepLoaded, sleptAt: t.slept || 0,
    });
  }
  const other = [...metrics.values()].filter(m => !used.has(m.pid)).map(m => ({
    type: m.type === 'Browser' ? 'Ferna Sundaree' : m.type === 'GPU' ? 'Graphics (GPU)' : m.type === 'Utility' ? `Utility: ${m.serviceName || m.name || ''}`.replace(/: $/, '') : m.type === 'Tab' ? 'Internal page or extension' : m.type,
    pid: m.pid, memory: Math.round(m.memory.workingSetSize / 1024), cpu: Math.round(m.cpu.percentCPUUsage * 10) / 10,
  }));
  return { tabs: rows, other, total: Math.round([...metrics.values()].reduce((a, m) => a + m.memory.workingSetSize, 0) / 1024) };
}

const RUNNABLE = new Set([...Object.keys(SHORTCUT_DEFAULTS), 'settings']);

function registerCommands() {
  const C = ipc.command;
  const UI = ['ui', 'overlay'];

  C('ui:ready', [], ['ui'], c => senderWindow(c).state());
  // Asked synchronously by src/preload/scriptlets.js in web page frames as they start. Only
  // answers frames of web tabs (Ferna's own pages and other webContents get nothing).
  require('electron').ipcMain.on('ferna-scriptlets', e => {
    let out = [];
    try {
      const frame = e.senderFrame;
      const url = frame && frame.url;
      const isTab = ctx.windows.some(w => w.tabs.some(t => t.kind === 'web' && t.view && t.view.webContents === e.sender));
      if (isTab && /^https?:/i.test(url || '') && ctx.pageFx) out = ctx.pageFx.scriptletsFor(url);
    } catch { out = []; }
    e.returnValue = out;
  });
  C('run', ['string'], ['ui', 'overlay', 'newtab', 'settings'], (c, cmd) => {
    const w = senderWindow(c);
    if (!RUNNABLE.has(cmd)) return false;
    if (cmd === 'settings') w.openInternal('ferna://settings/'); else w.run(cmd);
    return true;
  });
  const tabById = (w, id) => w.tabs.find(t => t.id === id);
  C('tab:activate', ['int'], UI, (c, id) => { const w = senderWindow(c); const t = tabById(w, id); if (t) { w.closeOverlay(); w.activate(t); } });
  C('tab:close', ['int'], UI, (c, id) => { const w = senderWindow(c); const t = tabById(w, id); if (t) w.closeTab(t); });
  C('tab:new', ['string?'], UI, (c, url) => senderWindow(c).newTab(url ? policy.normalizeInput(url, ctx.settings.data.searchEngine) : NEWTAB) && true);
  C('tab:move', ['int', 'int'], ['ui'], (c, id, to) => { const w = senderWindow(c); const t = tabById(w, id); if (t) w.moveTab(t, to); });
  C('tab:menu', ['int'], ['ui'], (c, id) => { const w = senderWindow(c); const t = tabById(w, id); if (t) require('./menus').tabMenu(w, t).popup({ window: w.win }); });
  C('tab:mute', ['int'], ['ui'], (c, id) => { const w = senderWindow(c); const t = tabById(w, id); if (t) w.setMuted(t, !t.muted); });
  C('tab:ws', ['int', 'string'], UI, (c, id, wsId) => {
    const w = senderWindow(c);
    const t = tabById(w, id);
    if (t && (wsId === 'none' || ctx.ws.data.workspaces.some(x => x.id === wsId))) w.moveTabToWorkspace(t, wsId);
  });
  C('menu:shot', [], ['ui'], c => { const w = senderWindow(c); require('./menus').shotMenu(w).popup({ window: w.win }); });

  C('nav:copy', [], ['ui'], c => {
    const w = senderWindow(c);
    const t = w && w.active;
    const url = t ? require('./workspaces').pageUrlOf(t.pendingUrl || t.url) : '';
    if (!url || url === 'ferna://newtab/') return false;
    clipboard.writeText(url);
    w.sendUi('toast', { text: 'Address copied.' });
    return true;
  });
  C('nav:go', ['string'], ['ui', 'newtab'], (c, text) => {
    const w = senderWindow(c);
    const url = policy.normalizeInput(text, ctx.settings.data.searchEngine);
    if (!url) return false;
    const t = c.host === 'newtab' ? senderTab(c) : w.active;
    if (t) w.navigate(t, url); else w.newTab(url);
    return true;
  });
  for (const [name, cmd] of [['nav:back', 'back'], ['nav:forward', 'forward'], ['nav:reload', 'reload']]) {
    C(name, [], ['ui'], c => senderWindow(c).run(cmd));
  }
  C('nav:stop', [], ['ui'], c => { const t = senderWindow(c).active; if (t && t.view && t.view.webContents) t.view.webContents.stop(); });

  C('ws:switch', ['string?'], UI, (c, id) => senderWindow(c).switchWorkspace(id || null));
  C('ws:menu', ['string?'], ['ui'], (c, id) => { const w = senderWindow(c); require('./menus').workspaceMenu(w, id).popup({ window: w.win }); });
  C('ws:new', [], ['ui'], c => { const w = senderWindow(c); w.promptNewWorkspace(id => w.switchWorkspace(id)); });
  C('common:open', ['int'], UI, (c, i) => { const w = senderWindow(c); w.closeOverlay(); w.openCommon(i); });
  C('common:menu', ['int'], ['ui'], (c, i) => { const w = senderWindow(c); const m = require('./menus').commonMenu(w, i); if (m) m.popup({ window: w.win }); });
  C('tab:common', ['int'], ['ui', 'overlay'], (c, id) => { const w = senderWindow(c); const t = tabById(w, id); if (t) w.toggleCommon(t); });
  C('tab:pin', ['int'], ['ui', 'overlay'], (c, id) => { const w = senderWindow(c); const t = tabById(w, id); if (t) w.togglePin(t); });
  // A tab dropped on the common bar or the pinned area: add it there (never takes it off).
  C('tab:to', ['int', 'string'], ['ui'], (c, id, where) => {
    const w = senderWindow(c); const t = tabById(w, id);
    if (!t) return;
    const url = require('./workspaces').pageUrlOf(t.url);
    if (where === 'common') { if (ctx.findCommon(url) >= 0) w.sendUi('toast', { text: 'Already on the common bar.' }); else w.toggleCommon(t); }
    else if (where === 'pin') { if (ctx.findPin(w.currentWs || '', url) >= 0) w.sendUi('toast', { text: 'Already pinned here.' }); else w.togglePin(t); }
  });
  C('pinned:unpin', ['string', 'int'], ['ui', 'overlay', 'settings'], (c, id, i) => ctx.unpinSite(id, i));
  C('pinned:open', ['string', 'int'], UI, (c, id, i) => { const w = senderWindow(c); w.closeOverlay(); w.openPinned(id, i); });
  C('pinned:menu', ['string', 'int'], ['ui'], (c, id, i) => { const w = senderWindow(c); const m = require('./menus').pinnedMenu(w, id, i); if (m) m.popup({ window: w.win }); });
  C('bm:open', ['string', 'bool?'], ['ui'], (c, id, inNew) => {
    const w = senderWindow(c);
    const b = ctx.bookmarks.data.items.find(x => x.id === id);
    if (b) { if (inNew) w.newTab(b.url, { activate: false }); else w.navigateActive(b.url); }
  });
  C('bm:menu', ['string'], ['ui'], (c, id) => { const w = senderWindow(c); const m = require('./menus').bookmarkMenu(w, id); if (m) m.popup({ window: w.win }); });
  C('bm:other', ['object?'], ['ui'], (c, anchor) => senderWindow(c).openBookmarksPanel(anchor, 'other'));
  C('bm:folder', ['string', 'object?'], ['ui'], (c, id, anchor) => senderWindow(c).openBookmarksPanel(anchor, id));
  C('menu:app', [], ['ui'], c => { const w = senderWindow(c); require('./menus').appMenu(w).popup({ window: w.win }); });
  C('menu:split', [], ['ui'], c => { const w = senderWindow(c); const m = require('./menus').splitMenu(w); if (m) m.popup({ window: w.win }); });
  C('menu:shield', [], ['ui'], c => { const w = senderWindow(c); require('./menus').shieldMenu(w, w.active).popup({ window: w.win }); });
  C('ui:reveal', ['string', 'bool'], ['ui'], (c, what, on) => {
    const w = senderWindow(c);
    if (what !== 'tabs' && what !== 'toolbar') return;
    const linked = ctx.settings.data.tabBarHidden && (ctx.settings.data.tabPosition !== 'top' || ctx.settings.data.hideToolbarWithTabs);
    if ((w.focus || linked) && on) w.reveal = { tabs: true, toolbar: true };
    else if (linked && !on) w.reveal = { tabs: false, toolbar: false };
    else w.reveal[what] = on;
    if (!on && w.focus) w.reveal = { tabs: false, toolbar: false };
    w.relayout();
  });
  C('win:control', ['string'], ['ui'], (c, what) => {
    const w = senderWindow(c);
    if (what === 'minimize') w.win.minimize();
    else if (what === 'maximize') { if (w.win.isMaximized()) w.win.unmaximize(); else w.win.maximize(); }
    else if (what === 'close') w.win.close();
    else if (what === 'fullscreen-exit') w.win.setFullScreen(false);
    return w.win.isMaximized();
  });
  C('ext:toolbar', [], ['ui'], c => ctx.ext ? ctx.ext.toolbarState(senderWindow(c)) : { ready: false, actions: [] });
  C('ext:click', ['string', 'object'], ['ui'], (c, id, rect) => ctx.ext && ctx.ext.click(senderWindow(c), id, rect));
  C('ext:actionMenu', ['string', 'object'], ['ui'], (c, id, rect) => ctx.ext && ctx.ext.contextMenu(senderWindow(c), id, rect));
  C('ext:puzzle', [], ['ui'], c => ctx.ext && ctx.ext.puzzleMenu(senderWindow(c)));
  C('zoom:panel', ['object?'], ['ui'], (c, rect) => senderWindow(c).openZoomPanel(rect || undefined));
  C('zoom:act', ['string', 'num?'], ['ui', 'overlay'], async (c, action, value) => {
    const w = senderWindow(c);
    const t = w.active;
    const v = action === 'setType' ? (value === 1 ? 'text' : 'full') : value;
    return ctx.zoomAct(w, t, action, v);
  });
  C('ui:vwidth', ['int'], ['ui'], (c, px) => { ctx.settings.set('verticalWidth', Math.max(160, Math.min(400, px))); ctx.broadcast(); });
  C('find:query', ['string', 'bool', 'bool'], ['ui'], (c, text, forward, findNext) => {
    const t = senderWindow(c).active;
    if (!t || !t.view || !t.view.webContents || t.view.webContents.isDestroyed()) return;
    if (!text) { t.view.webContents.stopFindInPage('clearSelection'); return; }
    t.view.webContents.findInPage(text, { forward, findNext });
  });
  C('find:close', [], ['ui'], c => senderWindow(c).closeFind());

  // Overlay
  C('overlay:close', [], ['overlay'], c => senderWindow(c).closeOverlay());
  C('overlay:refresh', [], ['overlay'], c => senderWindow(c).overviewData());
  C('overlay:activate', ['int', 'int'], ['overlay'], (c, winId, tabId) => {
    const me = senderWindow(c);
    const w = ctx.windows.find(x => x.id === winId);
    const t = w && w.tabs.find(x => x.id === tabId);
    me.closeOverlay();
    if (!t) return;
    if (w.currentWs && !w.visibleOrder().includes(t.id)) w.currentWs = w.tabWorkspace(t);
    w.activate(t);
    w.win.focus();
  });
  C('overlay:closeTab', ['int', 'int'], ['overlay'], async (c, winId, tabId) => {
    const w = ctx.windows.find(x => x.id === winId);
    const t = w && w.tabs.find(x => x.id === tabId);
    if (t) w.closeTab(t);
    const me = senderWindow(c);
    return me && !me.win.isDestroyed() ? me.overviewData() : null;
  });
  C('overlay:moveTab', ['int', 'int', 'string'], ['overlay'], async (c, winId, tabId, wsId) => {
    const w = ctx.windows.find(x => x.id === winId);
    const t = w && w.tabs.find(x => x.id === tabId);
    if (t) { t.wsOverride = wsId; w.pushState(); ctx.saveSessionSoon(); }
    return senderWindow(c).overviewData();
  });
  C('overlay:region', ['object?'], ['overlay'], (c, rect) => {
    const ok = rect && [rect.x, rect.y, rect.width, rect.height].every(n => typeof n === 'number' && Number.isFinite(n));
    senderWindow(c).finishRegion(ok ? rect : null);
  });
  C('overlay:prompt', ['object?'], ['overlay'], (c, r) => {
    const w = senderWindow(c);
    w.closeOverlay();
    if (!r || typeof r.value !== 'string' || !r.value.trim()) return;
    if (r.action === 'ws:create') {
      const nw = ctx.createWorkspace(r.value);
      const cb = w._onWorkspaceCreated; w._onWorkspaceCreated = null;
      if (cb) cb(nw.id);
    } else if (r.action === 'app:install' && typeof r.id === 'string') {
      const t = w.tabs.find(x => String(x.id) === r.id);
      if (t) require('./webapps').create(ctx, w, t, r.value.trim().slice(0, 60)).catch(e => w.sendUi('toast', { text: `Could not install: ${e.message}` }));
    } else if (r.action === 'profile:create') {
      const name = r.value.replace(/[^\w .-]/g, '').trim().slice(0, 40);
      if (name) { ctx.launchProfile(name); ctx.profileShortcut(name); }
    } else if (r.action === 'ws:rename' && typeof r.id === 'string') {
      const x = ctx.ws.data.workspaces.find(k => k.id === r.id);
      if (x) { x.name = r.value.trim().slice(0, 40); ctx.ws.save(); ctx.broadcast(); }
    }
  });
  C('overlay:open', ['string'], ['overlay'], (c, text) => {
    const w = senderWindow(c);
    w.closeOverlay();
    const url = policy.normalizeInput(text, ctx.settings.data.searchEngine);
    if (url) w.newTab(url);
  });
  C('overlay:history', ['string'], ['overlay'], (c, q) => queryHistory(q, 8));
  // Ferna Tabs list fallback: "Go to <address>" or "Search the web for <text>".
  C('overlay:web', ['string', 'string', 'bool'], ['overlay'], (c, kind, text, inNew) => {
    const w = senderWindow(c);
    const t = String(text).trim().slice(0, 2000);
    if (!t) return false;
    const url = kind === 'go' ? policy.normalizeInput(t, ctx.settings.data.searchEngine) : ctx.searchUrl(t);
    if (!url) return false;
    w.closeOverlay();
    if (inNew) w.newTab(url); else w.navigateActive(url);
    return true;
  });
  C('overlay:bookmarks', ['string'], ['overlay'], (c, q) => {
    const s = q.toLowerCase();
    return ctx.bookmarks.data.items.filter(b => b.url && (!s || b.title.toLowerCase().includes(s) || b.url.toLowerCase().includes(s))).slice(0, 8);
  });

  // New tab page
  C('newtab:data', [], ['newtab'], c => {
    const w = senderWindow(c);
    const cur = ctx.ws.data.workspaces.find(x => x.id === w.currentWs);
    return {
      common: ctx.ws.data.common, workspace: cur ? { name: cur.name, color: cur.color, pinned: cur.pinned } : null,
      engine: policy.SEARCH_ENGINES[ctx.settings.data.searchEngine].name, private: w.private,
      recent: w.private ? [] : queryHistory('', 8),
      theme: ctx.ext ? ctx.ext.themeState() : null,
    };
  });

  // Settings
  C('settings:get', [], ['settings', 'newtab', 'assistant'], () => ctx.settings.data);
  const SETTABLE = {
    tabPosition: v => ['top', 'left', 'right'].includes(v), tabBarHidden: v => typeof v === 'boolean',
    bookmarksBarHidden: v => typeof v === 'boolean', verticalCollapsed: v => typeof v === 'boolean',
    verticalWidth: v => Number.isInteger(v) && v >= 160 && v <= 400, searchEngine: v => v in policy.SEARCH_ENGINES,
    restoreSession: v => typeof v === 'boolean', theme: v => ['system', 'light', 'dark'].includes(v),
    accent: v => /^#[0-9a-f]{6}$/i.test(v), httpsFirst: v => typeof v === 'boolean',
    httpsExceptions: v => Array.isArray(v) && v.every(x => typeof x === 'string'),
    dohMode: v => ['secure', 'automatic', 'off'].includes(v), dohProvider: v => v in policy.DOH_PROVIDERS,
    blocker: v => typeof v === 'boolean', blockerAllow: v => Array.isArray(v) && v.every(x => typeof x === 'string'),
    historyDays: v => Number.isInteger(v) && v >= 1 && v <= 3650,
    pdfDefault: v => typeof v === 'boolean',
    bookmarkFolder: v => typeof v === 'string' && v.length <= 80,
    hideToolbarWithTabs: v => typeof v === 'boolean',
    wsShowNames: v => typeof v === 'boolean',
    stripFavoritesOnly: v => typeof v === 'boolean',
    selectionMenu: v => typeof v === 'boolean', popupBlocker: v => typeof v === 'boolean',
    safeBrowsing: v => typeof v === 'boolean',
    autoUpdate: v => typeof v === 'boolean',
    blockThirdPartyCookies: v => typeof v === 'boolean', enhancedSecurity: v => typeof v === 'boolean', gpc: v => typeof v === 'boolean',
    fingerprintProtection: v => typeof v === 'boolean', stripTracking: v => typeof v === 'boolean', webrtcProtection: v => typeof v === 'boolean',
    lookalikeWarnings: v => typeof v === 'boolean', passwordWarnings: v => typeof v === 'boolean', defenderScan: v => typeof v === 'boolean', extensionGuard: v => typeof v === 'boolean',
    cosmeticFiltering: v => typeof v === 'boolean', listScriptlets: v => typeof v === 'boolean', youtubeAds: v => typeof v === 'boolean',
    zoomPrefs: v => v && typeof v === 'object' && ['site', 'tab'].includes(v.mode) && ['full', 'text'].includes(v.defaultType) &&
      [v.defaultFull, v.defaultText, v.defaultNonText, v.step, v.autofitMin, v.autofitMax, v.minFont].every(n => Number.isFinite(n)) &&
      Array.isArray(v.levels) && v.levels.length > 1 && v.levels.length <= 40 && v.levels.every(n => Number.isFinite(n) && n >= 25 && n <= 500) &&
      ['levels', 'fixed'].includes(v.stepMode),
    bookmarkBackupDays: v => Number.isInteger(v) && v >= 0 && v <= 30, bookmarkBackupKeep: v => Number.isInteger(v) && v >= 1 && v <= 365,
    sleepingTabs: v => typeof v === 'boolean', sleepAfterMinutes: v => Number.isInteger(v) && v >= 5 && v <= 1440,
    autoPip: v => typeof v === 'boolean', linkPreview: v => typeof v === 'boolean',
    passwordManager: v => typeof v === 'boolean', passwordLeakCheck: v => typeof v === 'boolean',
    autofillAddresses: v => typeof v === 'boolean', autofillCards: v => typeof v === 'boolean',
    passwordNever: v => Array.isArray(v) && v.length <= 2000 && v.every(x => typeof x === 'string'),
    assistant: v => v && typeof v === 'object' && ['ollama', 'openai-compatible', 'anthropic', 'openai'].includes(v.provider) && typeof (v.model || '') === 'string' && typeof (v.endpoint || '') === 'string' &&
      Array.isArray(v.skills || []) && (v.skills || []).length <= 100 && (v.skills || []).every(k => k && typeof k.name === 'string' && typeof k.prompt === 'string' && k.name.length <= 40 && k.prompt.length <= 4000),
    translateTo: v => typeof v === 'string' && /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(v), translateAsked: v => typeof v === 'boolean', translateService: v => ['', 'google', 'ai'].includes(v),
    spellLangs: v => Array.isArray(v) && v.length <= 10 && v.every(x => typeof x === 'string' && x.length <= 12),
    readerRate: v => Number.isFinite(v) && v >= 0.5 && v <= 2.5, readerVoice: v => typeof v === 'string' && v.length <= 200,
    workspaceThemes: v => typeof v === 'boolean', adaptiveTheme: v => typeof v === 'boolean', highContrastToolbar: v => typeof v === 'boolean',
    themeSchedule: v => v && typeof v === 'object' && typeof v.on === 'boolean' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.dark) && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.light),
    splitRatio: v => Number.isFinite(v) && v >= 0.2 && v <= 0.8, sideWidth: v => Number.isInteger(v) && v >= 300 && v <= 560,
  };
  ctx.SETTABLE = SETTABLE;
  // Other internal pages may change only their own settings.
  const PAGE_KEYS = { passwords: ['passwordManager', 'autofillAddresses', 'autofillCards', 'passwordLeakCheck'], assistant: ['assistant', 'translateTo', 'sideWidth', 'translateService'] };
  C('settings:set', ['string', 'any'], ['settings', 'passwords', 'assistant'], (c, key, value) => {
    if (c.host !== 'settings' && !(PAGE_KEYS[c.host] || []).includes(key)) throw new Error('Not allowed from this page');
    if (ctx.policyLocked && ctx.policyLocked(key)) throw new Error('This setting is managed by your organisation');
    if (ctx.examWin && ['theme', 'accent', 'themeSchedule', 'workspaceThemes', 'adaptiveTheme', 'highContrastToolbar'].includes(key)) throw new Error('Themes are locked during an exam');
    if (!(key in SETTABLE) || !SETTABLE[key](value)) throw new Error('Invalid setting');
    if (key === 'zoomPrefs') value = { ...zoom.DEFAULTS, ...value, levels: [...new Set(value.levels.map(zoom.clamp))].sort((a, b) => a - b), autofitOnLoad: !!value.autofitOnLoad, subdomainsSeparate: !!value.subdomainsSeparate };
    ctx.setSetting(key, value);
    return ctx.settings.data;
  });
  C('shortcuts:get', [], ['settings'], () => ctx.shortcuts.describe());
  C('shortcuts:set', ['string', 'array'], ['settings'], (c, cmd, keys) => {
    if (!(cmd in SHORTCUT_DEFAULTS)) throw new Error('Unknown command');
    for (const k of keys) {
      const clash = ctx.shortcuts.conflict(cmd, k);
      if (clash) return { ok: false, clash };
    }
    ctx.settings.data.shortcuts[cmd] = keys.slice(0, 3);
    ctx.settings.save();
    ctx.shortcuts.setOverrides(ctx.settings.data.shortcuts);
    return { ok: true, list: ctx.shortcuts.describe() };
  });
  C('shortcuts:reset', [], ['settings'], () => {
    ctx.settings.set('shortcuts', {});
    ctx.shortcuts.setOverrides({});
    return ctx.shortcuts.describe();
  });
  C('ws:get', [], ['settings'], () => ctx.ws.data);
  C('ws:save', ['object'], ['settings'], (c, data) => {
    const clean = ws.importFernaTabs(data);
    // Keep ids stable: importFernaTabs preserves them.
    ctx.ws.data.workspaces = clean.workspaces;
    ctx.ws.data.common = clean.common;
    ctx.ws.data.allPinned = clean.allPinned;
    ctx.ws.save(); ctx.broadcast();
    return ctx.ws.data;
  });
  C('ws:import', ['object'], ['settings'], (c, data) => {
    const imp = ws.importFernaTabs(data);
    const have = new Set(ctx.ws.data.workspaces.map(w => w.id));
    for (const w of imp.workspaces) { if (have.has(w.id)) w.id = ws.newWorkspace(w.name).id; ctx.ws.data.workspaces.push(w); }
    for (const c2 of imp.common) if (ctx.ws.data.common.length < 20 && !ctx.ws.data.common.some(x => x.folder === c2.folder)) ctx.ws.data.common.push(c2);
    for (const p2 of imp.allPinned) if (!ctx.ws.data.allPinned.some(x => x.url === p2.url)) ctx.ws.data.allPinned.push({ ...p2, folder: p2.folder || ws.folderOf(p2.url) });
    ctx.ws.save(); ctx.broadcast();
    return { workspaces: imp.workspaces.length, common: imp.common.length, data: ctx.ws.data };
  });
  C('zoom:sites', [], ['settings'], () => ctx.settings.data.zoomSites);
  C('zoom:clearSite', ['string?'], ['settings'], (c, key) => {
    if (key) delete ctx.settings.data.zoomSites[key]; else ctx.settings.data.zoomSites = {};
    ctx.settings.save();
    ctx.windows.forEach(w => w.tabs.forEach(t => applyZoom(w, t)));
    return ctx.settings.data.zoomSites;
  });
  C('theme:get', [], ['settings', 'extensions'], () => ctx.ext ? ctx.ext.themeState() : null);
  C('theme:reset', [], ['settings', 'extensions'], () => { if (ctx.ext) ctx.ext.resetTheme(); return null; });
  // Extensions page
  const extWin = c => senderWindow(c);
  C('ext:list', [], ['extensions'], () => ctx.ext ? ctx.ext.list() : []);
  C('ext:enable', ['string', 'bool'], ['extensions'], (c, id, on) => ctx.ext.setEnabled(id, on));
  C('ext:pin', ['string', 'bool'], ['extensions'], (c, id, on) => { ctx.ext.setPinned(id, on); return true; });
  C('ext:remove', ['string'], ['extensions'], async (c, id) => {
    const r = await dialog.showMessageBox(extWin(c).win, { type: 'question', buttons: ['Cancel', 'Remove'], defaultId: 1, cancelId: 0, noLink: true, message: 'Remove this extension?', detail: 'Its data in Ferna Sundaree is deleted.' });
    if (r.response !== 1) return false;
    await ctx.ext.uninstall(id);
    return true;
  });
  C('ext:installFile', ['string'], ['extensions'], async (c, kind) => {
    const w = extWin(c);
    const r = kind === 'folder'
      ? await dialog.showOpenDialog(w.win, { title: 'Load unpacked extension', properties: ['openDirectory'] })
      : await dialog.showOpenDialog(w.win, { title: 'Install extension or theme', properties: ['openFile'], filters: [{ name: 'Chrome extensions and themes', extensions: ['crx', 'zip'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    try { return await ctx.ext.installFromPath(r.filePaths[0], { win: w.win }); } catch (e) { return { error: e.message }; }
  });
  C('ext:open', ['string'], ['extensions'], (c, url) => {
    if (/^(chrome-extension|https):\/\//.test(url)) extWin(c).newTab(url, { forceWeb: true });
    return true;
  });
  C('perm:list', [], ['settings'], () => ctx.settings.data.permissions);
  C('perm:revoke', ['string'], ['settings'], (c, key) => { delete ctx.settings.data.permissions[key]; ctx.settings.save(); return ctx.settings.data.permissions; });
  C('privacy:clear', ['object'], ['settings', 'history'], async (c, what) => {
    const since = Number.isFinite(what.since) ? what.since : 0;
    if (what.history) { ctx.history.data.entries = ctx.history.data.entries.filter(e => e.ts < since); ctx.history.flush(); }
    if (what.downloads) ctx.downloads = ctx.downloads.filter(d => d.state === 'progressing');
    const storages = [];
    if (what.cookies) storages.push('cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'filesystem', 'websql', 'shadercache');
    if (storages.length) await ctx.webSession.clearStorageData({ storages });
    if (what.cache) await ctx.webSession.clearCache();
    if (what.cookies || what.cache) await ctx.webSession.clearAuthCache();
    return true;
  });
  C('about:get', [], ['settings'], () => ({
    version: VERSION, electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node,
    v8: process.versions.v8, platform: `${process.platform} ${process.getSystemVersion()}`, dataDir: DATA_DIR,
    encryption: canEncrypt(), sandbox: true, blocker: { status: ctx.blocker.status, updated: ctx.blocker.updated },
    pdfReader: fs.existsSync(PDF_VIEWER), rejectedIpc: ipc.rejected.length, widevine: ctx.widevine, profile: ctx.profile,
    features: {
      tabs: 'Ferna Tabs 1.15.0 rules, built into the tab strip (workspaces, common bar, pinned sites, list at pointer)',
      screenshots: 'Ferna Screenshots 1.0.0 editor, history and settings; capture by the browser',
      pdf: ctx.hasPdfReader ? 'Ferna PDF Reader 1.6.0 (with the 1.6.2 large-file annotation fix)' : 'not installed (Chromium viewer)',
    },
  }));
  // Profiles, installed apps, spell-check languages, workspace logins (0.5).
  C('profiles:list', [], ['settings'], () => ({ current: ctx.profile, list: ctx.listProfiles() }));
  C('profiles:open', ['string'], ['settings'], (c, n) => ctx.policyAllows('ProfilesAllowed') && ctx.launchProfile(n));
  C('profiles:create', ['string', 'bool'], ['settings'], (c, n, shortcut) => { if (!ctx.policyAllows('ProfilesAllowed')) return false; const ok = ctx.launchProfile(n); if (ok && shortcut) ctx.profileShortcut(n); return ok; });
  C('profiles:shortcut', ['string'], ['settings'], (c, n) => ctx.profileShortcut(n));
  C('apps:list', [], ['settings'], () => require('./webapps').list(ctx));
  C('apps:uninstall', ['string'], ['settings'], (c, id) => require('./webapps').uninstall(ctx, id));
  C('apps:open', ['string'], ['settings'], (c, url) => !!ctx.openAppWindow(url));
  C('spell:langs', [], ['settings'], () => { let a = []; try { a = ctx.webSession.availableSpellCheckerLanguages || []; } catch { /* none */ } return { available: a, current: ctx.settings.data.spellLangs || [] }; });
  C('spell:set', ['array'], ['settings'], (c, langs) => { const v = langs.filter(x => typeof x === 'string').slice(0, 10); ctx.settings.set('spellLangs', v); ctx.applySpellLangs(); return true; });
  C('ws:separate', ['string', 'bool'], ['settings'], (c, id, on) => ctx.setWorkspaceSeparate(id, on));
  C('ws:clear-logins', ['string'], ['settings'], async (c, id) => { await ctx.clearContainer(id); return true; });
  C('default-browser', [], ['settings'], () => {
    if (process.platform === 'win32') shell.openExternal('ms-settings:defaultapps');
    else if (process.platform === 'linux') return require('./linuxdesk').makeDefault();
    return true;
  });
  C('blocker:refresh', [], ['settings'], async () => { await ctx.blocker.refresh(); return { status: ctx.blocker.status, updated: ctx.blocker.updated }; });

  // History page
  function queryHistory(q, limit) {
    const s = q.toLowerCase();
    const out = [];
    const seen = new Set();
    const e = ctx.history.data.entries;
    for (let i = e.length - 1; i >= 0 && out.length < limit; i--) {
      const h = e[i];
      if (s && !h.url.toLowerCase().includes(s) && !(h.title || '').toLowerCase().includes(s)) continue;
      if (limit <= 20 && seen.has(h.url)) continue;
      seen.add(h.url);
      out.push(h);
    }
    return out;
  }
  C('history:query', ['string', 'int'], ['history'], (c, q, limit) => queryHistory(q, Math.min(limit, 5000)));
  C('history:remove', ['string', 'num'], ['history'], (c, url, ts) => {
    ctx.history.data.entries = ctx.history.data.entries.filter(e => !(e.url === url && e.ts === ts));
    ctx.history.save();
    return true;
  });

  // Downloads page
  C('downloads:list', [], ['downloads'], () => ctx.downloads.map(publicDownload));
  C('downloads:act', ['int', 'string'], ['downloads'], (c, id, action) => {
    const d = ctx.downloads.find(x => x.id === id);
    if (!d) return false;
    if (action === 'open' && d.state === 'completed') shell.openPath(d.path);
    else if (action === 'show') shell.showItemInFolder(d.path);
    else if (action === 'cancel' && d.item) d.item.cancel();
    else if (action === 'pause' && d.item) d.item.pause();
    else if (action === 'resume' && d.item && d.item.canResume()) d.item.resume();
    else if (action === 'remove') ctx.downloads = ctx.downloads.filter(x => x !== d || x.state === 'progressing');
    notifyDownloads();
    return true;
  });
  C('downloads:folder', [], ['downloads'], () => shell.openPath(ctx.downloadsDir()));

  // Bookmarks page
  C('bm:list', [], ['bookmarks'], () => ctx.bookmarks.data.items);
  C('bm:update', ['string', 'object'], ['bookmarks'], (c, id, patch) => ctx.updateBookmark(id, patch));
  C('bm:delete', ['string'], ['bookmarks'], (c, id) => { ctx.deleteBookmark(id); return true; });
  C('bm:add', ['object'], ['bookmarks'], (c, b) => {
    if (typeof b.url !== 'string' || !/^(https?|file):/i.test(b.url)) throw new Error('Invalid address');
    BM.addBookmark(ctx.bookmarks.data.items, { parent: typeof b.folder === 'string' ? b.folder : 'other', url: b.url, title: b.title });
    bmSaved();
    return ctx.bookmarks.data.items;
  });
  // Bookmarks popup (Ease Bookmarks style) and manager: the whole tree and single operations.
  C('bm:tree', [], ['overlay', 'bookmarks', 'settings'], () => ({ items: bmItems(), roots: BM.ROOTS, defaultFolder: ctx.defaultBookmarkFolder() }));
  C('bm:op', ['string', 'object'], ['overlay', 'bookmarks'], (c, op, a) => ctx.bookmarkOp(op, a));
  C('bm:go', ['string', 'string'], ['overlay', 'bookmarks'], (c, url, how) => {
    if (!BM.okUrl(url)) return false;
    const w = senderWindow(c) || ctx.lastFocused || ctx.windows[0];
    if (!w) return false;
    if (how !== 'background') w.closeOverlay();
    if (how === 'current') w.navigateActive(url); else w.newTab(url, { activate: how !== 'background' });
    return true;
  });
  C('eq:panel', ['object?'], ['ui'], (c, anchor) => senderWindow(c).openEqPanel(anchor));
  C('eq:set', ['object'], ['overlay', 'settings'], async (c, patch) => {
    const cfg = ctx.pageFx.setEq(patch);
    const w = senderWindow(c);
    const t = w && w.active;
    // Turning it on reaches the page you are looking at even before it plays anything.
    if (t && t.kind === 'web' && t.view && cfg.enabled && !t.eqInjected) { t.eqInjected = true; await ctx.pageFx.EQ.apply(t.view.webContents, cfg).catch(() => null); }
    return { cfg, status: t ? await ctx.pageFx.eqStatus(t) : null };
  });
  C('eq:preset-save', ['string', 'array'], ['overlay', 'settings'], (c, name, gains) => {
    const EQ = require('./pagefx/eq');
    const list = EQ.cleanUserPresets(ctx.settings.data.eqPresets);
    const n = name.trim().slice(0, 40);
    if (!n || gains.length !== EQ.BANDS.length) return null;
    const hit = list.find(p => p.name.toLowerCase() === n.toLowerCase());
    if (hit) hit.gains = gains; else list.push({ name: n, gains });
    const saved = EQ.cleanUserPresets(list);
    ctx.settings.set('eqPresets', saved);
    ctx.pageFx.setEq({ preset: 'custom', auto: false, enabled: true, gains: saved.find(p => p.name.toLowerCase() === n.toLowerCase()).gains, customName: n });
    return { user: saved, cfg: ctx.pageFx.eqCfg() };
  });
  C('eq:preset-delete', ['string'], ['overlay', 'settings'], (c, id) => {
    const EQ = require('./pagefx/eq');
    const saved = EQ.cleanUserPresets(ctx.settings.data.eqPresets).filter(p => p.id !== id);
    ctx.settings.set('eqPresets', saved);
    return { user: saved };
  });
  C('parental:answer', ['string'], ['overlay'], (c, pw) => { const ok = ctx.parentalAnswer(pw); if (ok) senderWindow(c).closeOverlay(); return ok; });
  C('parental:cancel', [], ['overlay'], c => { const r = ctx._parentalWaiter; ctx._parentalWaiter = null; if (r) r(false); senderWindow(c).closeOverlay(); return true; });
  C('eq:status', [], ['overlay'], async c => { const w = senderWindow(c); const t = w && w.active; const st = t ? await ctx.pageFx.eqStatus(t) : null; if (st) w.pushState(); return { cfg: ctx.pageFx.eqCfg(), status: st }; });
  C('bm:manage', [], ['overlay'], c => { const w = senderWindow(c); w.closeOverlay(); w.openInternal('ferna://bookmarks/'); });
  C('bm:panel', ['object?'], ['ui', 'overlay'], (c, anchor) => senderWindow(c).openBookmarksPanel(anchor));
  C('bm:import', ['text'], ['bookmarks'], (c, html) => importBookmarksHtml(html));
  C('bm:export', [], ['bookmarks'], () => exportBookmarksHtml());
  // Split view, link preview, media controls, task manager (0.5).
  C('split:ratio', ['num'], ['ui'], (c, r) => senderWindow(c).setSplitRatio(r));
  C('split:act', ['string'], ['ui', 'overlay'], (c, a) => { const w = senderWindow(c); if (a === 'exit') w.exitSplit(); else if (a === 'swap') w.swapSplit(); else if (a === 'toggle') w.run('splitView'); });
  C('split:with', ['int', 'int?'], ['ui', 'overlay'], (c, id, other) => { const w = senderWindow(c); const a = tabById(w, id); const b = other ? tabById(w, other) : null; if (a) w.splitWith(a, b); });
  C('peek:open-as', ['string'], ['overlay'], (c, how) => senderWindow(c).peekOpenAs(how));
  C('media:panel', ['object?'], ['ui'], (c, a) => senderWindow(c).openMediaPanel(a));
  C('media:list', [], ['overlay'], c => senderWindow(c).mediaList());
  C('media:act', ['int', 'int', 'string'], ['overlay'], (c, w, t, a) => senderWindow(c).mediaAct(w, t, a));
  C('tasks:list', [], ['tasks'], () => taskList());
  C('tasks:act', ['int', 'int', 'string'], ['tasks'], (c, winId, tabId, a) => {
    const w = ctx.windows.find(x => x.id === winId);
    const t = w && tabById(w, tabId);
    if (!t) return false;
    if (a === 'sleep') { if (t.id === w.activeId) return false; return w.sleepTab(t); }
    if (a === 'close') { w.closeTab(t); return true; }
    if (a === 'go') { w.activate(t); w.win.focus(); return true; }
    if (a === 'end' && t.view && !t.view.webContents.isDestroyed()) { t.view.webContents.forcefullyCrashRenderer(); return true; }
    return false;
  });
  // Bookmark manager (0.5): bulk operations, link check, duplicates, imports, backups.
  C('bm:manager', [], ['bookmarks'], () => ctx.bmSvc.data());
  C('bm:bulk', ['string', 'object'], ['bookmarks', 'overlay'], (c, op, a) => ctx.bmSvc.bulk(op, a));
  C('bm:check', ['array?'], ['bookmarks'], (c, ids) => { ctx.bmSvc.runCheck(ids && ids.length ? ids : null); return ctx.bmSvc.checkState(); });
  C('bm:check-cancel', [], ['bookmarks'], () => ctx.bmSvc.cancelCheck());
  C('bm:export-sel', ['array?', 'string'], ['bookmarks'], (c, ids, fmt) => ctx.bmSvc.exportSel(ids, fmt === 'json' ? 'json' : 'html'));
  C('bm:import-any', ['text'], ['bookmarks'], (c, text) => { try { return { ok: true, ...ctx.bmSvc.importAny(text) }; } catch (e) { return { ok: false, error: e.message }; } });
  C('bm:backup-now', [], ['bookmarks', 'settings'], () => ({ name: ctx.bmSvc.backupNow(), backups: ctx.bmSvc.listBackups() }));
  C('bm:backup-restore', ['string', 'string'], ['bookmarks'], (c, name, mode) => { try { return ctx.bmSvc.restoreBackup(name, mode === 'replace' ? 'replace' : 'merge'); } catch (e) { return { ok: false, error: e.message }; } });
  C('bm:backup-folder', [], ['bookmarks', 'settings'], () => { fs.mkdirSync(ctx.bmSvc.backupDir, { recursive: true }); shell.openPath(ctx.bmSvc.backupDir); return true; });
  C('bm:backup-settings', ['int', 'int'], ['bookmarks'], (c, days, keep) => {
    if (!ctx.SETTABLE.bookmarkBackupDays(days) || !ctx.SETTABLE.bookmarkBackupKeep(keep)) throw new Error('Invalid');
    ctx.settings.set('bookmarkBackupDays', days); ctx.settings.set('bookmarkBackupKeep', keep); return true;
  });
  C('bm:reading-add', ['string', 'string?'], ['ui', 'overlay'], (c, url, title) => ctx.bmSvc.addToReadingList(url, title || url));

  // Interstitial / error pages
  C('inter:proceed', ['string'], ['interstitial'], (c, httpUrl) => {
    let u;
    try { u = new URL(httpUrl); } catch { return false; }
    if (u.protocol !== 'http:') return false;
    const ex = ctx.settings.data.httpsExceptions;
    if (!ex.includes(u.hostname)) { ex.push(u.hostname); ctx.settings.save(); }
    const w = senderWindow(c);
    const t = senderTab(c);
    if (t) w.navigate(t, httpUrl);
    return true;
  });
  C('inter:lookalike-ok', ['string'], ['interstitial'], (c, url) => {
    if (!/^https?:/i.test(url)) return false;
    ctx.lookalikeAllowed.add(ws.hostOf(url));
    const w = senderWindow(c); const t = senderTab(c);
    if (t) w.navigate(t, url);
    return true;
  });
  // "Visit this unsafe site": allowed for this host until the browser restarts.
  C('inter:unsafe', ['string'], ['interstitial'], (c, url) => {
    if (!/^https?:/i.test(url) || !ctx.safety.allow(url)) return false;
    const w = senderWindow(c);
    const t = senderTab(c);
    if (t) w.navigate(t, url);
    return true;
  });
  // Your own filters and extra lists (Settings → My filters).
  C('filters:get', [], ['settings'], () => ({ custom: ctx.settings.data.customFilters || '', lists: ctx.settings.data.filterLists || [], rules: String(ctx.settings.data.customFilters || '').split(/\r?\n/).filter(l => l.trim() && !/^\s*!/.test(l)).length, status: ctx.blocker.status, updated: ctx.blocker.updated }));
  C('filters:save', ['text'], ['settings'], (c, text) => {
    const t = String(text).slice(0, 512 * 1024);
    ctx.settings.set('customFilters', t);
    const rules = ctx.blocker.setCustom(t);
    for (const w of ctx.windows) for (const tab of w.tabs) if (tab.kind === 'web' && tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed()) ctx.pageFx.cosmetics(w, tab, tab.view.webContents);
    return { rules };
  });
  C('filters:lists', ['array'], ['settings'], async (c, urls) => {
    const clean = [...new Set(urls.map(String).map(u => u.trim()).filter(u => /^https:\/\/[^\s]+$/i.test(u) && u.length < 500))].slice(0, 20);
    ctx.settings.set('filterLists', clean);
    ctx.blocker.setExtraLists(clean);
    let error = null;
    await ctx.blocker.refresh().catch(e => { error = String(e && e.message || e); });
    return { lists: clean, status: ctx.blocker.status, updated: ctx.blocker.updated, error };
  });
  C('page:pick', ['object?'], ['ui'], (c, at) => { const w = senderWindow(c); if (w.active) ctx.pageFx.pickElement(w, w.active, at); });
  C('update:status', [], ['settings', 'ui'], () => ({ ...ctx.updater.state, current: VERSION, kind: require('./updater').installKind(), auto: ctx.settings.data.autoUpdate !== false }));
  C('update:check', [], ['settings'], async () => { await ctx.updater.check(); return { ...ctx.updater.state, current: VERSION, kind: require('./updater').installKind() }; });
  C('update:download', [], ['settings'], async () => { await ctx.updater.download().catch(() => {}); return { ...ctx.updater.state, current: VERSION }; });
  C('update:install', [], ['settings', 'ui'], () => ctx.installUpdate());
  ctx.installUpdate = () => {
    const kind = require('./updater').installKind();
    if ((kind === 'portable' || kind === 'tar') && ctx.updater.state.file) {
      const dest = uniquePath(ctx.downloadsDir(), path.basename(ctx.updater.state.file));
      fs.copyFileSync(ctx.updater.state.file, dest);
      shell.showItemInFolder(dest);
      return { portable: dest };
    }
    saveSession(true);
    return { cmd: ctx.updater.install({ app, shell }) };
  };
  C('safety:status', [], ['settings'], () => ({ status: ctx.safety.status, updated: ctx.safety.updated, counts: ctx.safety.counts }));
  C('safety:refresh', [], ['settings'], async () => { await ctx.safety.refresh().catch(() => {}); return { status: ctx.safety.status, updated: ctx.safety.updated, counts: ctx.safety.counts }; });
  C('inter:go', ['string'], ['interstitial'], (c, url) => {
    const w = senderWindow(c);
    const t = senderTab(c);
    if (!t) return false;
    if (url === 'back') w.navigate(t, t.lastGoodUrl && t.lastGoodUrl !== t.url ? t.lastGoodUrl : NEWTAB);
    else if (/^(https?|file):/i.test(url)) w.navigate(t, url);
    return true;
  });

  // Ferna Screenshots (the extension's own editor, history and settings pages)
  const MODE_OF = { 'Visible area': 'visible', Element: 'element', Region: 'region' };
  C('shot:meta', ['string'], ['shots'], (c, id) => {
    const s = ctx.shots.get(id);
    if (!s) return null;
    const sz = s.image.getSize();
    const cssW = s.meta.cssWidth || sz.width;
    return {
      url: s.meta.url, title: s.meta.title, time: s.meta.time, mode: s.meta.mode || MODE_OF[s.meta.type] || 'full',
      scale: sz.width / cssW, cssW, cssH: Math.round(sz.height / (sz.width / cssW)), truncated: !!s.meta.truncated,
      width: sz.width, height: sz.height, src: `ferna://shots/_shot/${id}.png`,
    };
  });
  C('shots:storage', ['string', 'any'], ['shots'], (c, op, arg) => {
    const d = ctx.shotsStore.data;
    if (op === 'set' && arg && typeof arg === 'object') { Object.assign(d, arg); ctx.shotsStore.save(); return true; }
    if (op === 'get') {
      if (arg === null) return { ...d };
      const keys = typeof arg === 'string' ? [arg] : Array.isArray(arg) ? arg : Object.keys(arg || {});
      const out = {};
      for (const k of keys) if (k in d) out[k] = d[k]; else if (arg && typeof arg === 'object' && !Array.isArray(arg)) out[k] = arg[k];
      return out;
    }
    return false;
  });
  C('shots:open', ['string'], ['shots'], (c, url) => {
    const w = senderWindow(c);
    if (/^ferna:\/\/(shots|settings)\//.test(url) || /^https?:/.test(url)) w.newTab(url, { index: w.tabs.indexOf(senderTab(c)) + 1 });
    return true;
  });
  C('shots:commands', [], ['shots'], () => ctx.shortcuts.describe().filter(d => /^shot/.test(d.cmd)).map(d => ({
    name: d.cmd, description: d.label, shortcut: (d.keys || [])[0] || '',
  })));
  const savedShots = new Map();
  C('shots:download', ['string', 'bytes', 'bool'], ['shots'], async (c, rel, bytes, saveAs) => {
    // rel may contain one sub-folder ("Ferna Screenshots/x.png"); never leave Downloads.
    const parts = rel.replace(/\\/g, '/').split('/').map(p => p.replace(/[<>:"|?*\u0000-\u001f]+/g, '_').trim()).filter(p => p && p !== '.' && p !== '..');
    const name = parts.pop() || 'screenshot.png';
    if (!/\.(png|jpe?g|pdf)$/i.test(name)) throw new Error('Unsupported file type');
    const dir = path.join(ctx.downloadsDir(), ...parts.slice(0, 3));
    fs.mkdirSync(dir, { recursive: true });
    let file = uniquePath(dir, name);
    if (saveAs) {
      const r = await dialog.showSaveDialog(senderWindow(c).win, { defaultPath: file });
      if (r.canceled || !r.filePath) return null;
      file = r.filePath;
    }
    fs.writeFileSync(file, Buffer.from(bytes));
    const id = savedShots.size + 1;
    savedShots.set(id, file);
    return { id, path: file };
  });
  C('shots:reveal', ['int'], ['shots'], (c, id) => { const f = savedShots.get(id); if (f) shell.showItemInFolder(f); return true; });
  C('shots:quickDone', ['string'], ['shots'], (c, text) => {
    const w = senderWindow(c);
    const t = senderTab(c);
    w.sendUi('toast', { text: text.slice(0, 200) });
    if (t) w.closeTab(t);
    return true;
  });

  // Ferna PDF Reader bridge (active only when its source is installed in src/features/pdf-reader)
  C('pdf:read', ['string'], ['pdf'], async (c, url) => {
    if (/^file:/i.test(url)) {
      const { fileURLToPath } = require('url');
      return new Uint8Array(fs.readFileSync(fileURLToPath(url)));
    }
    if (!/^https?:/i.test(url)) throw new Error('Unsupported address');
    const w = senderWindow(c);
    const res = await w.session.fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  });
  C('pdf:storage', ['string', 'string', 'any'], ['pdf'], (c, areaName, op, arg) => {
    if (areaName !== 'sync' && areaName !== 'local') throw new Error('Unknown storage area');
    const a = ctx.pdfStore.data[areaName];
    const keys = arg === null || arg === undefined ? null : typeof arg === 'string' ? [arg] : Array.isArray(arg) ? arg : Object.keys(arg);
    if (op === 'get') {
      if (!keys) return { ...a };
      const out = {};
      for (const k of keys) if (k in a) out[k] = a[k]; else if (arg && typeof arg === 'object' && !Array.isArray(arg)) out[k] = arg[k];
      return out;
    }
    if (op === 'set') Object.assign(a, arg || {});
    else if (op === 'remove') (keys || []).forEach(k => delete a[k]);
    else if (op === 'clear') ctx.pdfStore.data[areaName] = {};
    ctx.pdfStore.save();
    return true;
  });
  // The browser plays the "Ferna PDF save helper": same protocol, no separate install.
  const helper = new Map(); // webContents id → { path, chunks }
  const pdfPath = p => {
    if (typeof p !== 'string' || !path.isAbsolute(p) || !/\.pdf$/i.test(p)) throw new Error('Only PDF files can be read or written');
    return path.normalize(p);
  };
  C('pdf:helper', ['object'], ['pdf'], async (c, msg) => {
    const id = c.wc.id;
    switch (msg.cmd) {
      case 'ping': return { ok: true, version: VERSION, host: 'Ferna Sundaree' };
      case 'begin': {
        const p = pdfPath(msg.path);
        if (!msg.create && !fs.existsSync(p)) throw new Error('The file no longer exists');
        helper.set(id, { path: p, chunks: [], size: 0 });
        return { ok: true };
      }
      case 'chunk': {
        const h = helper.get(id);
        if (!h || typeof msg.data !== 'string') throw new Error('No save in progress');
        const b = Buffer.from(msg.data, 'base64');
        h.chunks.push(b); h.size += b.length;
        if (h.size > 2 * 1024 * 1024 * 1024) throw new Error('File too large');
        return { ok: true };
      }
      case 'commit': {
        const h = helper.get(id);
        helper.delete(id);
        if (!h) throw new Error('No save in progress');
        const data = Buffer.concat(h.chunks);
        if (Number.isFinite(msg.size) && msg.size !== data.length) throw new Error('Incomplete data');
        require('./store').atomicWrite(h.path, data);
        return { ok: true, path: h.path, size: data.length };
      }
      case 'abort': helper.delete(id); return { ok: true };
      case 'read': {
        const p = pdfPath(msg.path);
        const st = fs.statSync(p);
        const off = Math.max(0, Number(msg.offset) || 0);
        const len = Math.max(0, Math.min(Number(msg.length) || 524288, 8 * 1024 * 1024, st.size - off));
        const fd = fs.openSync(p, 'r');
        try {
          const buf = Buffer.alloc(len);
          fs.readSync(fd, buf, 0, len, off);
          return { ok: true, size: st.size, data: buf.toString('base64') };
        } finally { fs.closeSync(fd); }
      }
      case 'pickSave': {
        const r = await dialog.showSaveDialog(senderWindow(c).win, { defaultPath: path.join(ctx.downloadsDir(), path.basename(String(msg.name || 'document.pdf'))), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
        return { ok: true, path: r.canceled ? null : r.filePath };
      }
      case 'pickOpen': {
        const r = await dialog.showOpenDialog(senderWindow(c).win, { properties: ['openFile'], filters: [{ name: 'PDF', extensions: ['pdf'] }] });
        return { ok: true, path: r.canceled ? null : r.filePaths[0] };
      }
      default: throw new Error('Unknown helper command');
    }
  });
  C('pdf:download', ['string', 'bytes', 'bool', 'bool'], ['pdf'], async (c, rel, bytes, overwrite, saveAs) => {
    const parts = rel.replace(/\\/g, '/').split('/').map(p => p.replace(/[<>:"|?*\u0000-\u001f]+/g, '_').trim()).filter(p => p && p !== '.' && p !== '..');
    let name = parts.pop() || 'document.pdf';
    if (!/\.pdf$/i.test(name)) name += '.pdf';
    const dir = path.join(ctx.downloadsDir(), ...parts.slice(0, 3));
    fs.mkdirSync(dir, { recursive: true });
    let file = overwrite ? path.join(dir, name) : uniquePath(dir, name);
    if (saveAs) {
      const r = await dialog.showSaveDialog(senderWindow(c).win, { defaultPath: file, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (r.canceled || !r.filePath) return null;
      file = r.filePath;
    }
    require('./store').atomicWrite(file, Buffer.from(bytes));
    return file;
  });
  C('pdf:save', ['string', 'bytes'], ['pdf'], (c, url, bytes) => {
    if (!/^file:/i.test(url)) throw new Error('Only local files can be overwritten');
    const { fileURLToPath } = require('url');
    const file = fileURLToPath(url);
    if (!/\.pdf$/i.test(file)) throw new Error('Not a PDF file');
    require('./store').atomicWrite(file, Buffer.from(bytes));
    return file;
  });
  C('pdf:saveAs', ['string', 'bytes'], ['pdf'], async (c, name, bytes) => {
    const w = senderWindow(c);
    const r = await dialog.showSaveDialog(w.win, { defaultPath: path.join(ctx.downloadsDir(), path.basename(name).replace(/[\\/:*?"<>|]+/g, '_')), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, Buffer.from(bytes));
    return r.filePath;
  });
}

// ---------- startup ----------

function urlsFromArgv(argv) {
  const args = argv.slice(1).filter(a => !a.startsWith('-') && !/\.fernaexam$/i.test(a));
  if (!app.isPackaged) args.shift(); // the app folder given to electron
  return args.map(a => {
    if (/^(https?|file|ferna):/i.test(a)) return a;
    try { if (fs.existsSync(a)) return require('url').pathToFileURL(path.resolve(a)).toString(); } catch { /* ignore */ }
    return null;
  }).filter(Boolean);
}

ctx.openAppWindow = (url, name) => {
  let origin = '';
  try { origin = new URL(url).origin; } catch { return null; }
  if (!/^https?:/.test(origin)) return null;
  const known = require('./webapps').list(ctx).find(a => a.origin === origin);
  return ctx.newWindow({ url, app: { url, origin, name: name || (known && known.name) || new URL(url).hostname } });
};
ctx.sameApp = (origin, url) => {
  try {
    const a = new URL(origin).hostname, b = new URL(url).hostname;
    const tld = require('tldts-experimental');
    return a === b || (tld.getDomain(a) && tld.getDomain(a) === tld.getDomain(b));
  } catch { return false; }
};
ctx.openInBrowser = url => {
  const w = [ctx.lastFocused, ...ctx.windows].find(x => x && !x.appMode && !x.private && !x.win.isDestroyed());
  if (!w) return ctx.newWindow({ url });
  w.newTab(url);
  if (w.win.isMinimized()) w.win.restore();
  w.win.focus();
  return w;
};
const appArg = argv => { const a = argv.find(x => x.startsWith('--app=')); return a ? a.slice(6) : null; };

const examArg = argv => { const a = argv.find(x => x.startsWith('--exam=')); return a ? a.slice(7) : argv.find(x => /\.fernaexam$/i.test(x) && !x.startsWith('-')) || null; };
app.on('second-instance', (e, argv) => {
  // During an exam nothing else opens.
  if (ctx.examWin && !ctx.examWin.win.isDestroyed()) { ctx.examWin.win.focus(); return; }
  if (examArg(argv)) { const r = ctx.startExamFile(examArg(argv)); if (r.ok) return; }
  if (appArg(argv)) { const w = ctx.openAppWindow(appArg(argv)); if (w) return; }
  const urls = urlsFromArgv(argv);
  const w = ctx.lastFocused || ctx.windows[0];
  if (!w) { ctx.newWindow({ url: urls[0] }); return; }
  if (urls.length) urls.forEach(u => w.newTab(u)); else ctx.newWindow({});
  if (w.win.isMinimized()) w.win.restore();
  w.win.focus();
});

app.on('web-contents-created', (e, wc) => {
  // Defence in depth for anything not created by FernaWindow.
  wc.on('will-attach-webview', ev => ev.preventDefault());
  // WebRTC: only the public interface (no local or VPN-hidden addresses) for web pages.
  setImmediate(() => { if (!wc.isDestroyed() && ctx.uiSession && wc.session !== ctx.uiSession) privacy.protectContents(wc, ctx.settings.data); });
});

app.on('window-all-closed', () => app.quit());

app.whenReady().then(async () => {
  initStores();
  nativeTheme.themeSource = ctx.settings.data.theme;
  configureDns();

  ctx.webSession = session.defaultSession;
  hardenSession(ctx.webSession);
  ctx.uiSession = session.fromPartition('persist:ferna-ui');
  installProtocol(ctx.uiSession);
  const pageHost = wc => { try { return new URL(wc.getURL()).host; } catch { return ''; } };
  ctx.uiSession.setPermissionRequestHandler((wc, p, cb, details) => {
    const host = pageHost(wc);
    cb(p === 'clipboard-sanitized-write' || (host === 'pdf' && (p === 'fileSystem' || p === 'clipboard-read')));
  });
  ctx.uiSession.setPermissionCheckHandler((wc, p) => p === 'clipboard-sanitized-write' || (wc && pageHost(wc) === 'pdf' && p === 'fileSystem'));
  const PDF_NET = /^(https:\/\/(api\.anthropic\.com|api\.openai\.com|huggingface\.co|[a-z0-9-]+\.hf\.co|[a-z0-9.-]+\.huggingface\.co|raw\.githubusercontent\.com)\/|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/)/i;
  ctx.uiSession.webRequest.onBeforeRequest((d, cb) => {
    if (/^(ferna|data|blob):/.test(d.url) || d.resourceType === 'image') return cb({});
    let fromPdf = false;
    try { fromPdf = !!d.webContents && pageHost(d.webContents) === 'pdf'; } catch { /* gone */ }
    cb({ cancel: !(fromPdf && PDF_NET.test(d.url)) });
  });

  ipc.install();
  registerCommands();
  require('./grouppolicy').install(ctx, POLICY, ctx.SETTABLE);
  ipc.command('policy:get', [], ['settings'], () => ctx.policyList());
  ctx.bmSvc = require('./bmservice').create(ctx, { dataDir: DATA_DIR, saved: bmSaved });
  require('./ctxtheme').install(ctx);
  require('./exam').install(ctx, { dataDir: DATA_DIR });
  ctx.exam.register(ipc.command);
  require('./parental').install(ctx, { dataDir: DATA_DIR });
  ctx.parental.register(ipc.command);
  require('./profiles').install(ctx, { hardenSession });
  ctx.passwords = require('./passwords').create(ctx, { dataDir: DATA_DIR });
  ctx.passwords.register(ipc.command);
  ctx.assistant = require('./assistant').create(ctx, { dataDir: DATA_DIR });
  ctx.assistant.register(ipc.command);
  ctx.toggleAssistant = win => ctx.assistant.toggle(win);
  ctx.askAssistant = (win, req) => ctx.assistant.ask(win, { ...req, tabId: win.active ? win.active.id : null });
  require('./translate').install(ctx);
  ctx.sync = require('./sync').create(ctx, { dataDir: DATA_DIR });
  ctx.sync.register(ipc.command);
  ctx.installApp = (win, tab) => require('./webapps').install(ctx, win, tab);
  // Sleeping tabs: unload tabs not used for a while (they reload when you open them).
  setInterval(() => { for (const w of ctx.windows) if (!w.win.isDestroyed()) w.sleepIdleTabs(); }, 60000).unref?.();

  const { ExtensionManager } = require('./extensions');
  ctx.ext = new ExtensionManager(ctx, DATA_DIR);
  try { await ctx.ext.init(); } catch (e) { console.error('Extensions unavailable:', e); }

  ctx.pageFx = pagefx.create(ctx);
  // Streaming edition (castLabs Electron): Widevine for Netflix, Disney+, Prime Video, Spotify.
  const { components } = require('electron');
  ctx.widevineBuild = !!(components && typeof components.whenReady === 'function');
  ctx.widevine = ctx.widevineBuild ? 'starting' : 'not in this edition';
  if (ctx.widevineBuild) components.whenReady().then(() => { ctx.widevine = 'ready'; }).catch(e => { ctx.widevine = `unavailable (${e && e.message || e})`; });
  // Automatic updates, checked against Ferna's own signing key.
  const { Updater } = require('./updater');
  ctx.updater = new Updater(ctx, {
    publicKey: require('./update-key'), currentVersion: VERSION,
    releasesUrl: (process.env.FERNA_TEST && process.env.FERNA_UPDATE_URL) || undefined,
    allowAnyHost: !!(process.env.FERNA_TEST && process.env.FERNA_UPDATE_URL),
    ...(process.env.FERNA_TEST ? { mirrors: [] } : {}),
  });
  ctx.updater.on(st => {
    if (st.status === 'available' && ctx.settings.data.autoUpdate !== false && !ctx.updaterAutoStarted) {
      ctx.updaterAutoStarted = true;
      const kind = require('./updater').installKind();
      if (['setup', 'msi', 'appimage', 'deb', 'rpm'].includes(kind)) ctx.updater.download(kind).catch(() => {});
    }
    if (st.status === 'ready' && !ctx.updaterToldReady) {
      ctx.updaterToldReady = true;
      const w = ctx.lastFocused || ctx.windows[0];
      if (w) w.sendUi('toast', { text: `Ferna Sundaree ${st.available.version} is ready. Menu → Restart to update.` });
    }
    ctx.broadcast();
  });
  if (!process.env.FERNA_TEST && app.isPackaged) ctx.updater.start();
  const { Safety } = require('./safety');
  ctx.safety = new Safety(DATA_DIR);
  ctx.safety.init().then(() => ctx.broadcast()).catch(() => {});
  ctx.blocker = new Blocker(DATA_DIR);
  ctx.blocker.setExtraLists(ctx.settings.data.filterLists);
  ctx.blocker.init().then(() => { ctx.blocker.setCustom(ctx.settings.data.customFilters); ctx.broadcast(); }).catch(() => {});

  nativeTheme.on('updated', () => ctx.broadcast());

  const urls = urlsFromArgv(process.argv);
  const saved = ctx.sessionStore.data.windows || [];
  if (examArg(process.argv) && ctx.startExamFile(examArg(process.argv)).ok) {
    // Started from an exam file: only the exam window.
  } else if (appArg(process.argv) && ctx.openAppWindow(appArg(process.argv))) {
    // Started from an installed app's shortcut: only that app's window.
  } else if (ctx.settings.data.restoreSession && saved.length && !process.env.FERNA_NO_RESTORE) {
    saved.forEach((s, i) => {
      const w = ctx.newWindow({ restore: s });
      if (i === saved.length - 1) urls.forEach(u => w.newTab(u));
    });
  } else {
    const w = ctx.newWindow({ url: urls[0] });
    urls.slice(1).forEach(u => w.newTab(u));
  }
  if (process.env.FERNA_TEST) { global.__ferna = ctx; ctx._menus = require('./menus'); ctx._crx = require('./crx'); ctx._ipc = ipc; ctx._ws = ws; }
}).catch(e => {
  console.error('Ferna Sundaree could not start:', e);
  try { dialog.showErrorBox('Ferna Sundaree could not start', String(e && e.stack || e)); } catch { /* headless */ }
  app.exit(1);
});

module.exports = { ctx };
