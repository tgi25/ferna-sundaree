// Ferna Zoom — background service worker.
// Keeps each site's (or each tab's) zoom, applies it when pages load, follows Ctrl+wheel and the
// browser's own zoom, and answers the pop-up and the keyboard shortcuts.
import * as Z from './zoomcore.js';

const web = url => /^(https?|file):/i.test(url || '');
const expected = new Map(); // tabId → zoom factor we set (to tell our changes from yours)

async function prefs() { const { prefs: p } = await chrome.storage.sync.get('prefs'); return Z.cleanPrefs(p); }
async function sites() { const { sites: s } = await chrome.storage.local.get('sites'); return s && typeof s === 'object' ? s : {}; }
async function tabStates() { const { tabs } = await chrome.storage.session.get('tabs'); return tabs && typeof tabs === 'object' ? tabs : {}; }

const same = (a, b) => a.type === b.type && a.full === b.full && a.text === b.text && a.nonText === b.nonText && (a.minFont || 0) === (b.minFont || 0);

/** The zoom state of a tab: the tab's own (per-tab mode, or AutoFit on load), else its site's, else the default. */
async function stateFor(tab, P) {
  P = P || await prefs();
  const def = Z.defaultState(P);
  if (!tab || !web(tab.url)) return def;
  const ts = (await tabStates())[tab.id];
  if (P.mode === 'tab' || tab.incognito) return ts ? { ...def, ...ts } : def;
  const key = Z.siteKey(tab.url, P);
  const s = (await sites())[key];
  if (s) return { ...def, ...s };
  return ts ? { ...def, ...ts } : def;
}

async function setBadge(tabId, st, P) {
  try {
    const show = P.badge && st && !same(st, Z.defaultState(P));
    await chrome.action.setBadgeText({ tabId, text: show ? String(Z.displayLevel(st)) : '' });
    if (show) await chrome.action.setBadgeBackgroundColor({ tabId, color: st.type === 'text' ? '#7c3aed' : '#047857' });
    await chrome.action.setTitle({ tabId, title: `Ferna Zoom: ${st.type === 'text' ? 'text' : 'full'} ${Z.displayLevel(st)}%${st.minFont ? `, minimum font ${st.minFont}px` : ''}` });
  } catch { /* tab gone */ }
}

/** Put a tab's zoom into effect: the browser's zoom (or CSS zoom per tab) and the text zoom.
 *  Calls for one tab run one after another, and nothing is changed that is already right, so the
 *  browser fires no zoom events of its own for them (some browsers, e.g. Brave, fire extra events
 *  when the zoom settings are set again; answering those made the page flicker). */
const chains = new Map();   // tabId → promise of the apply in progress
const ours = new Map();     // tabId → { until, all, factors }: zoom events that are our own changes
const sentTo = new Map();   // tabId → last message sent to the page
// Tabs whose page draws its text as pictures (Google Docs, Sheets): text zoom becomes page zoom.
const canvasTabs = new Set();
/** What to put into effect for a tab (text zoom on a canvas page zooms the whole page). */
function effectiveFor(tab, st, P) {
  const e = Z.effective(st, P);
  if (tab.incognito) e.useCss = true; // private windows share nothing with other tabs
  if (st.type === 'text' && canvasTabs.has(tab.id) && P.canvasFallback) {
    e.pageFactor = Z.clamp(st.text) / 100; e.textFactor = 1; e.canvas = true;
  }
  return e;
}
function apply(tab, st, P) {
  if (!tab || !web(tab.url)) return Promise.resolve();
  const prev = chains.get(tab.id) || Promise.resolve();
  const run = prev.catch(() => {}).then(() => applyNow(tab, st, P));
  chains.set(tab.id, run);
  run.finally(() => { if (chains.get(tab.id) === run) chains.delete(tab.id); });
  return run;
}
async function applyNow(tab, st, P) {
  P = P || await prefs();
  st = st || await stateFor(tab, P);
  const e = effectiveFor(tab, st, P);
  const browserFactor = e.useCss ? 1 : e.pageFactor;
  expected.set(tab.id, browserFactor);
  try {
    const zs = await chrome.tabs.getZoomSettings(tab.id);
    if (zs.mode !== 'automatic' || zs.scope !== 'per-tab') {
      // Changing the zoom settings may report passing zoom levels: ignore all events briefly.
      ours.set(tab.id, { until: Date.now() + 1000, all: true, factors: [browserFactor] });
      await chrome.tabs.setZoomSettings(tab.id, { mode: 'automatic', scope: 'per-tab' });
    }
    const cur = await chrome.tabs.getZoom(tab.id);
    if (Math.abs(cur - browserFactor) > 0.001) {
      const o = ours.get(tab.id);
      const keep = o && o.until > Date.now() ? o : { all: false, factors: [] };
      ours.set(tab.id, { until: Date.now() + 1500, all: keep.all, factors: [...keep.factors, cur, browserFactor].slice(-8) });
      await chrome.tabs.setZoom(tab.id, browserFactor);
    }
  } catch { /* pages the browser does not let extensions zoom */ }
  const msg = { t: 'apply', e: { css: e.useCss ? e.pageFactor : 1, textFactor: e.textFactor, minFont: e.minFont, lineSpacing: e.lineSpacing, wheelText: P.wheel && st.type === 'text' } };
  const key = `${tab.url}|${JSON.stringify(msg.e)}`;
  if (sentTo.get(tab.id) !== key) {
    sentTo.set(tab.id, key);
    chrome.tabs.sendMessage(tab.id, msg).catch(() => { sentTo.delete(tab.id); });
  }
  setBadge(tab.id, st, P);
}

/** Save a new state for a tab (and, per site, for every open tab of that site). */
async function save(tab, st, P, { temporary = false } = {}) {
  if (P.mode === 'tab' || tab.incognito || temporary) {
    const t = await tabStates(); t[tab.id] = st; await chrome.storage.session.set({ tabs: t });
    return [tab];
  }
  const key = Z.siteKey(tab.url, P);
  const s = await sites();
  if (same(st, Z.defaultState(P))) delete s[key]; else s[key] = { ...st, at: Date.now() };
  await chrome.storage.local.set({ sites: s });
  const t = await tabStates(); if (t[tab.id]) { delete t[tab.id]; await chrome.storage.session.set({ tabs: t }); }
  const all = await chrome.tabs.query({});
  return all.filter(x => !x.incognito && web(x.url) && Z.siteKey(x.url, P) === key);
}

/** The pop-up's data for a tab. */
async function panel(tab) {
  const P = await prefs();
  if (!tab || !web(tab.url)) return { web: false };
  const st = await stateFor(tab, P);
  return {
    web: true, state: st, level: Z.displayLevel(st), levels: [...new Set(P.levels.map(Z.clamp))].sort((a, b) => a - b),
    site: P.mode === 'tab' || tab.incognito ? null : Z.siteKey(tab.url, P), mode: tab.incognito ? 'tab' : P.mode, fonts: Z.FONTS,
    isDefault: same(st, Z.defaultState(P)),
    canvas: st.type === 'text' && canvasTabs.has(tab.id) && P.canvasFallback,
  };
}

/** in, out, inSmall, outSmall, set, reset, type, setType, autofit, minFont, fontReset, setDefault */
async function act(tab, action, value, opts = {}) {
  if (!tab || !web(tab.url)) return { web: false };
  const P = await prefs();
  const st = { ...await stateFor(tab, P) };
  const k = st.type === 'text' ? 'text' : 'full';
  switch (action) {
    case 'in': case 'out': st[k] = Z.nextLevel(st[k], action, P); break;
    case 'inSmall': st[k] = Z.nextLevel(st[k], 'in', P, true); break;
    case 'outSmall': st[k] = Z.nextLevel(st[k], 'out', P, true); break;
    case 'set': if (Number.isFinite(value)) st[k] = Z.clamp(value); break;
    case 'reset': Object.assign(st, { type: P.defaultType, full: P.defaultFull, text: P.defaultText, nonText: P.defaultNonText }); break;
    case 'type': st.type = st.type === 'text' ? 'full' : 'text'; break;
    case 'setType': if (value === 'text' || value === 'full') st.type = value; break;
    case 'minFont': if (Number.isFinite(value)) st.minFont = Math.max(0, Math.min(40, Math.round(value))); break;
    case 'fontReset': st.minFont = P.minFont; break;
    case 'autofit': {
      let m = null;
      try { m = await chrome.tabs.sendMessage(tab.id, { t: 'measure' }, { frameId: 0 }); } catch { m = null; }
      if (!m) return { ...(await panel(tab)), error: 'This page cannot be measured.' };
      st.type = 'full';
      st.full = Z.autofitLevel(m, Z.effective(st, P).pageFactor * 100, P);
      break;
    }
    case 'setDefault': {
      const { prefs: raw } = await chrome.storage.sync.get('prefs');
      await chrome.storage.sync.set({ prefs: { ...(raw || {}), defaultType: st.type, defaultFull: st.full, defaultText: st.text, minFont: st.minFont || 0 } });
      return { ...(await panel(tab)), note: `Default zoom set to ${st.type === 'text' ? 'text' : 'full'} ${Z.displayLevel(st)}%.` };
    }
    default: return panel(tab);
  }
  const targets = await save(tab, st, P, opts);
  await Promise.all(targets.map(t => apply(t, null, P)));
  return panel(tab);
}

// ---------- events ----------
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  // The browser's per-tab zoom resets when a tab navigates: put ours back.
  if (info.status === 'loading' && web(tab.url)) {
    if (info.url) canvasTabs.delete(tabId); // a new page: it reports again if it draws its text
    sentTo.delete(tabId); apply(tab);
  }
  if (info.status === 'complete' && web(tab.url)) {
    const P = await prefs();
    if (!P.autofitOnLoad || P.mode !== 'site') return;
    const key = Z.siteKey(tab.url, P);
    if (key && !(await sites())[key]) act(tab, 'autofit', null, { temporary: true });
  }
});
chrome.tabs.onRemoved.addListener(async tabId => {
  expected.delete(tabId); ours.delete(tabId); canvasTabs.delete(tabId); sentTo.delete(tabId); chains.delete(tabId);
  const t = await tabStates(); if (t[tabId]) { delete t[tabId]; chrome.storage.session.set({ tabs: t }); }
});
// You zoomed with Ctrl + wheel, Ctrl +/− or the browser's menu: remember it like a Ferna Zoom change.
chrome.tabs.onZoomChange.addListener(async ({ tabId, newZoomFactor, zoomSettings }) => {
  const exp = expected.get(tabId);
  if (exp !== undefined && Math.abs(newZoomFactor - exp) < 0.005) return;
  // Our own change still settling, or an apply in progress: not yours.
  const o = ours.get(tabId);
  if (o && o.until > Date.now() && (o.all || o.factors.some(f => Math.abs(f - newZoomFactor) < 0.005))) return;
  if (chains.has(tabId)) return;
  if (zoomSettings && zoomSettings.scope && zoomSettings.scope !== 'per-tab') return;
  let tab; try { tab = await chrome.tabs.get(tabId); } catch { return; }
  if (!web(tab.url)) return;
  const P = await prefs();
  const st = { ...await stateFor(tab, P) };
  const level = Z.clamp(newZoomFactor * 100);
  if (st.type === 'text' && canvasTabs.has(tabId) && P.canvasFallback) { if (st.text === level) return; st.text = level; }
  else if (st.type === 'text') { if (st.nonText === level) return; st.nonText = level; }
  else { if (st.full === level) return; st.full = level; }
  expected.set(tabId, newZoomFactor);
  const targets = await save(tab, st, P);
  await Promise.all(targets.filter(t => t.id !== tabId).map(t => apply(t, null, P)));
  setBadge(tabId, st, P);
});

chrome.commands.onCommand.addListener(async (cmd, tab) => {
  tab = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  const map = { 'zoom-in': 'in', 'zoom-out': 'out', 'zoom-reset': 'reset', 'zoom-autofit': 'autofit', 'zoom-type': 'type' };
  if (map[cmd]) act(tab, map[cmd]);
});

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  (async () => {
    if (m.t === 'hello') {
      const tab = sender.tab;
      if (!tab || !web(tab.url)) return null;
      const P = await prefs();
      const st = await stateFor(tab, P);
      const e = effectiveFor(tab, st, P);
      if (sender.frameId === 0) setBadge(tab.id, st, P);
      return { css: e.useCss ? e.pageFactor : 1, textFactor: e.textFactor, minFont: e.minFont, lineSpacing: e.lineSpacing, wheelText: P.wheel && st.type === 'text' };
    }
    const tab = m.tabId ? await chrome.tabs.get(m.tabId).catch(() => null) : sender.tab;
    if (m.t === 'canvasText') {
      const t = sender.tab;
      if (!t || sender.frameId !== 0 || canvasTabs.has(t.id)) return true;
      canvasTabs.add(t.id);
      const P = await prefs();
      const st = await stateFor(t, P);
      if (st.type === 'text' && P.canvasFallback) apply(t, st, P);
      return true;
    }
    if (m.t === 'panel') return panel(tab);
    if (m.t === 'act') return act(tab, m.action, m.value);
    if (m.t === 'reapply') { const P = await prefs(); for (const t of await chrome.tabs.query({})) if (web(t.url)) apply(t, null, P); return true; }
    return null;
  })().then(reply, () => reply(null));
  return true;
});

// Settings changed (options page): every tab follows.
chrome.storage.onChanged.addListener(async (ch, area) => {
  if (area === 'sync' && ch.prefs) { const P = await prefs(); for (const t of await chrome.tabs.query({})) if (web(t.url)) apply(t, null, P); }
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('options.html#welcome') });
  // Tabs open before installation get the page script now.
  for (const t of await chrome.tabs.query({})) {
    if (!/^https?:/i.test(t.url || '')) continue;
    chrome.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, files: ['content.js'] }).catch(() => {});
  }
});
