'use strict';
// Page features injected into web pages from the browser process, each in its own isolated
// world (no page access to their code, no channel back to the browser):
//   selection menu (7784), equalizer (7786), YouTube ad handling (7787), cosmetic ad hiding
//   (CSS inserted by the browser), Picture-in-Picture (on request).

const path = require('path');
const selection = require('./selection');
const eq = require('./eq');
const pip = require('./pip');
const yt = require('./youtube');
const picker = require('./picker');
const password = require('./password');
const reader = require('./reader');

const DOM_TOKENS = `(() => {
  const classes = new Set(), ids = new Set(), hrefs = new Set();
  const all = document.querySelectorAll('[class],[id],a[href]');
  for (let i = 0; i < all.length && i < 6000; i++) {
    const e = all[i];
    if (e.id) ids.add(e.id);
    if (e.classList) for (const c of e.classList) classes.add(c);
    if (e.tagName === 'A' && e.href) hrefs.add(e.href);
  }
  return { classes: [...classes].slice(0, 4000), ids: [...ids].slice(0, 2000), hrefs: [...hrefs].slice(0, 1000) };
})()`;
const COSMETIC_WORLD = 7788;

function create(ctx) {
  const policy = require('../policy');
  const host = u => { try { return new URL(u).hostname; } catch { return ''; } };
  const isWeb = tab => tab && tab.kind === 'web' && /^https?:/i.test(tab.url || '');
  const live = tab => tab && tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed() ? tab.view.webContents : null;
  const testYt = process.env.FERNA_TEST_YT_HOST || '';
  const S = () => ctx.settings.data;

  /** Ad blocking applies on this page (blocker on and the site not allowed). */
  function blockingOn(tab) {
    return !!S().blocker && !S().blockerAllow.includes(host(tab.url));
  }

  async function cosmetics(win, tab, wc) {
    const b = ctx.blocker;
    if (!b) return;
    const url = tab.url;
    const hostname = host(url);
    // List rules need ad blocking and cosmetic filtering on; your own rules (and element hides
    // made with the picker) apply unless you turned blocking off for this site.
    const lists = !!b.engine && blockingOn(tab) && S().cosmeticFiltering !== false;
    const mine = !!b.custom && !S().blockerAllow.includes(hostname);
    if (!lists && !mine) return;
    let domain = hostname;
    try { domain = require('tldts-experimental').getDomain(hostname) || hostname; } catch { /* keep host */ }
    try {
      const dom = await wc.executeJavaScriptInIsolatedWorld(COSMETIC_WORLD, [{ code: DOM_TOKENS }]);
      const ask = engine => engine.getCosmeticsFilters({
        url, hostname, domain, classes: dom.classes, ids: dom.ids, hrefs: dom.hrefs,
        getBaseRules: true, getInjectionRules: false, getExtendedRules: false, getRulesFromDOM: true, getRulesFromHostname: true,
      });
      const parts = [lists ? ask(b.engine) : null, mine ? ask(b.custom) : null].filter(Boolean);
      if (wc.isDestroyed() || tab.url !== url) return;
      const styles = parts.map(r => r.styles || '').join('\n').trim();
      if (tab.cosmeticKey) { wc.removeInsertedCSS(tab.cosmeticKey).catch(() => {}); tab.cosmeticKey = null; }
      if (styles) tab.cosmeticKey = await wc.insertCSS(styles, { cssOrigin: 'user' });
      // Scriptlets (uBlock-style +js rules) are not run here: they run once, when each page
      // starts, from src/preload/scriptlets.js (see scriptletsFor). Running them late, after the
      // page's own code, broke pages such as Facebook on their first load.
    } catch { /* page navigated away or engine without cosmetic filters */ }
  }

  /**
   * Scriptlets for a frame that is starting (asked by src/preload/scriptlets.js, before any of
   * the page's own code runs). Same rules as cosmetics(): list rules need ad blocking and
   * cosmetic filtering on; your own rules apply unless blocking is off for the site.
   */
  function scriptletsFor(url) {
    const b = ctx.blocker;
    if (!b || !/^https?:/i.test(url || '')) return [];
    const hostname = host(url);
    const allowed = S().blockerAllow.includes(hostname);
    const lists = !!b.engine && !!S().blocker && !allowed && S().cosmeticFiltering !== false;
    const mine = !!b.custom && !allowed;
    if (!lists && !mine) return [];
    let domain = hostname;
    try { domain = require('tldts-experimental').getDomain(hostname) || hostname; } catch { /* keep host */ }
    const out = [];
    for (const engine of [lists ? b.engine : null, mine ? b.custom : null]) {
      if (!engine) continue;
      try {
        const r = engine.getCosmeticsFilters({ url, hostname, domain, getBaseRules: false, getInjectionRules: true, getExtendedRules: false, getRulesFromDOM: false, getRulesFromHostname: true });
        for (const sc of r.scripts || []) if (typeof sc === 'string' && out.length < 40) out.push(sc);
      } catch { /* engine without cosmetic filters */ }
    }
    return out;
  }

  /** Element picker: choose something on the page to hide on this site from now on. */
  async function pickElement(win, tab, at) {
    const wc = live(tab);
    if (!wc || !isWeb(tab)) return;
    let sel = null;
    try { sel = await wc.executeJavaScriptInIsolatedWorld(picker.WORLD, [{ code: picker.script(at) }], true); } catch { sel = null; }
    if (!sel || typeof sel !== 'string' || /[{}\n\r]|##|^\s*$/.test(sel) || sel.length > 1000) return;
    const hostname = host(tab.url).replace(/^www\./, '');
    const rule = `${hostname}##${sel.trim()}`;
    const text = String(S().customFilters || '');
    if (!text.split(/\r?\n/).includes(rule)) ctx.settings.set('customFilters', `${text.replace(/\s*$/, '')}${text.trim() ? '\n' : ''}${rule}\n`);
    ctx.blocker.setCustom(ctx.settings.data.customFilters);
    await cosmetics(win, tab, wc);
    win.sendUi('toast', { text: `Hidden on ${hostname}. Undo in Settings → My filters.` });
  }

  async function domReady(win, tab) {
    const wc = live(tab);
    if (!wc || !isWeb(tab)) return;
    const eng = policy.SEARCH_ENGINES[S().searchEngine] || policy.SEARCH_ENGINES.google;
    selection.apply(wc, { on: S().selectionMenu !== false, engine: eng.name, search: eng.search }).catch(() => {});
    if (S().passwordWarnings !== false) {
      const u = tab.url;
      const local = /^(localhost|127\.|\[::1\])/.test(host(u));
      password.apply(wc, { on: true, insecure: /^http:/i.test(u) && !local, firstVisit: !ctx.visitedBefore(u), host: host(u) }).catch(() => {});
    }
    if (blockingOn(tab) && S().youtubeAds !== false && yt.isYouTubeHost(host(tab.url), testYt)) {
      wc.executeJavaScriptInIsolatedWorld(yt.WORLD, [{ code: yt.WATCH }]).catch(() => {});
    }
    if (eqCfg().enabled) eq.apply(wc, eqCfg()).catch(() => {});
    if (ctx.passwords && !win.private) ctx.passwords.attach(win, tab);
    cosmetics(win, tab, wc);
    // A second pass (styles only) once late content (ads load late) is in.
    setTimeout(() => { if (live(tab) === wc && !wc.isDestroyed()) cosmetics(win, tab, wc); }, 2500);
  }

  function mediaStarted(win, tab) {
    const wc = live(tab);
    if (wc && eqCfg().enabled) eq.apply(wc, eqCfg()).catch(() => {});
  }

  async function togglePip(win, tab) {
    const wc = live(tab);
    if (!wc) return;
    const r = await pip.toggle(wc);
    if (r === 'entered') tab.pipOn = true;
    else if (r === 'exited') tab.pipOn = false;
    else if (r === 'none') win.sendUi('toast', { text: 'No video on this page to show in Picture-in-Picture.' });
    else win.sendUi('toast', { text: 'This video could not be shown in Picture-in-Picture.' });
    win.pushState();
  }

  // ---------- equalizer ----------
  function eqCfg() { return eq.clean(S().equalizer); }
  function setEq(patch) {
    const base = { ...eqCfg() };
    if (patch.preset && patch.preset !== 'custom') delete base.customName;
    if (patch.gains && !patch.customName && patch.preset === 'custom') delete base.customName;
    const next = eq.clean({ ...base, ...patch });
    ctx.settings.set('equalizer', next);
    for (const w of ctx.windows) for (const t of w.tabs) {
      const wc = live(t);
      // Enable only where media has played; turning off reaches every page that has it.
      if (wc && isWeb(t) && (t.hasMedia || t.hasVideo || t.eqInjected)) { t.eqInjected = true; eq.apply(wc, next).catch(() => {}); }
    }
    ctx.broadcast();
    return next;
  }
  function eqDisplay(tab) {
    const c = eqCfg();
    if (!c.enabled) return { enabled: false, label: 'Off' };
    const label = c.auto ? `Auto${tab && tab.eqGenre ? ` (${eq.PRESETS[tab.eqGenre] ? eq.PRESETS[tab.eqGenre].label : tab.eqGenre})` : ''}` : c.preset === 'custom' ? (c.customName || 'Custom') : (eq.PRESETS[c.preset] || eq.PRESETS.flat).label;
    return { enabled: true, label };
  }
  async function eqStatus(tab) {
    const wc = live(tab);
    if (!wc || !isWeb(tab)) return null;
    const s = await eq.status(wc).catch(() => null);
    if (s && s.applied && tab.eqGenre !== s.applied) { tab.eqGenre = s.applied; }
    return s;
  }

  // ---------- reading mode and read aloud ----------
  function readerPrefs() {
    const r = S().reader || {};
    return { size: r.size || 20, font: r.font || 'serif', width: r.width || 700, theme: r.theme || (ctx.isDark() ? 'dark' : 'light'), rate: S().readerRate || 1, voice: S().readerVoice || '' };
  }
  async function runReader(win, tab, extra) {
    const wc = live(tab);
    if (!wc || !isWeb(tab)) return;
    const gen = (tab.readerGen = (tab.readerGen || 0) + 1);
    let r;
    try { r = await wc.executeJavaScriptInIsolatedWorld(reader.WORLD, [{ code: reader.OPEN({ ...readerPrefs(), ...extra }) }], true); } catch { return; }
    for (let guard = 0; guard < 500 && r; guard++) {
      if (tab.readerGen !== gen || live(tab) !== wc) return;
      if (r.type === 'none') { win.sendUi('toast', { text: 'No article found on this page for reading mode.' }); tab.readerOn = false; win.pushState(); return; }
      if (r.type === 'close') { tab.readerOn = false; tab.speaking = false; win.pushState(); return; }
      if (r.type === 'state') { tab.speaking = !!r.speaking; if (!extra.speakText) tab.readerOn = true; win.pushState(); }
      if (r.type === 'pref') {
        if (r.rate) ctx.settings.set('readerRate', r.rate);
        if (typeof r.voice === 'string') ctx.settings.set('readerVoice', r.voice.slice(0, 200));
        const cur = { ...(S().reader || {}) };
        for (const k of ['size', 'font', 'width', 'theme']) if (r[k] !== undefined) cur[k] = r[k];
        ctx.settings.set('reader', cur);
      }
      try { r = await wc.executeJavaScriptInIsolatedWorld(reader.WORLD, [{ code: reader.WAIT }], true); } catch { return; }
    }
  }
  function openReader(win, tab) {
    if (!tab.readerOn) { tab.readerOn = true; win.pushState(); }
    else { tab.readerOn = false; win.pushState(); }
    return runReader(win, tab, { toggle: true });
  }
  function readAloud(win, tab, text) {
    if (text && String(text).trim()) return runReader(win, tab, { speakText: String(text).slice(0, 20000) });
    tab.readerOn = true; win.pushState();
    return runReader(win, tab, { speak: true });
  }
  /** The page's main text for the assistant and translation: { title, text, url, ... }. */
  async function extract(tab) {
    const wc = live(tab);
    if (!wc || !isWeb(tab)) return null;
    try { return await wc.executeJavaScriptInIsolatedWorld(reader.WORLD + 10, [{ code: reader.EXTRACT() }]); } catch { return null; }
  }

  return { domReady, mediaStarted, pip: togglePip, eqCfg, setEq, eqDisplay, eqStatus, cosmetics, scriptletsFor, pickElement, EQ: eq, reader: openReader, readAloud, extract };
}

/** Register or remove the YouTube document-start preload on a session. */
function setYouTubeShield(ses, on) {
  const id = 'ferna-yt-shield';
  try {
    if (typeof ses.getPreloadScripts === 'function' && ses.getPreloadScripts().some(p => p.id === id)) {
      if (on) return;
      ses.unregisterPreloadScript(id);
      return;
    }
    if (on) ses.registerPreloadScript({ id, type: 'frame', filePath: path.join(__dirname, '..', '..', 'preload', 'yt-shield.js') });
  } catch { /* older Electron: skip */ }
}

module.exports = { create, setYouTubeShield };
