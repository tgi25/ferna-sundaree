'use strict';
// Safety check: runs the guard (src/main/guard.js) on pages and on text you select, keeps the
// result per tab, warns before you type into a fake bank or payment page, and runs the side
// panel ferna://check/ (fact-check bubble and "check a message").
const { dialog, session } = require('electron');
const G = require('./guard');

const WORLD = 7796;

function create(ctx) {
  const S = () => ctx.settings.data;
  const cache = new Map(); // query → { at, cov }
  let ses = null;
  const checkSession = () => {
    if (ses) return ses;
    // In memory, no cookies or sign-ins: the search engine sees a headline, never who you are.
    ses = session.fromPartition('ferna-check');
    ses.webRequest.onBeforeSendHeaders((d, cb) => { const h = { ...d.requestHeaders }; delete h.Cookie; delete h.Referer; cb({ requestHeaders: h }); });
    return ses;
  };
  const fetchText = async url => {
    const r = await checkSession().fetch(url, { credentials: 'omit', redirect: 'follow', headers: { Accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.5' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const t = await r.text();
    return t.slice(0, 3 * 1024 * 1024);
  };
  const trusted = () => (S().checkTrusted || []);

  async function coverage(headline, selfHost) {
    const key = `${G.queryFor(headline)}|${G.registrable(selfHost || '')}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 15 * 60 * 1000) return hit.cov;
    const cov = await G.coverage(headline, { fetchText, selfHost });
    cache.set(key, { at: Date.now(), cov });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return cov;
  }

  // ---------- pages ----------
  async function scanTab(win, tab, { again = false } = {}) {
    if (S().safetyCheck === false || win.private && S().safetyCheckPrivate === false) return;
    const wc = tab.view && tab.view.webContents;
    if (!wc || wc.isDestroyed() || !/^https?:/.test(wc.getURL())) return;
    const gen = tab.checkGen = (tab.checkGen || 0) + 1;
    let facts;
    try { facts = await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: G.PROBE }]); } catch { return; }
    if (!facts || gen !== tab.checkGen || wc.isDestroyed()) return;
    const r = G.analyzePage(facts, { trusted: trusted() });
    const prev = tab.check;
    tab.check = { url: facts.url, host: r.host, article: r.article, headline: String(facts.headline || facts.title || '').slice(0, 300), claim: r.claim, scam: r.scam, danger: r.danger, insecure: !!r.insecure, cov: prev && prev.url === facts.url ? prev.cov : null };
    if (tab.id === win.activeId) win.pushState();
    if (win.side && win.side.kind === 'check') refreshPanel(win);
    // A fake bank or payment page: stop before anything is typed.
    if (r.danger && !(prev && prev.url === facts.url && prev.danger)) warnDanger(win, tab, r);
    else if (r.scam.length && !(prev && prev.url === facts.url && prev.scam.length)) win.sendUi('toast', { text: `Careful: this page reads like a scam (${r.scam[0].toLowerCase()}).`, action: 'Why?', cmd: 'check:toggle-panel', ms: 9000 });
    // Fact-check bubble: other coverage of a news article, if you turned on the automatic search.
    if (r.article && S().factCheckAuto && !win.private && !(tab.check.cov)) {
      coverage(tab.check.headline, r.host).then(cov => {
        if (!tab.check || tab.check.url !== facts.url) return;
        tab.check.cov = { reliable: cov.reliable, results: cov.results.length, factChecks: cov.factChecks.length, line: G.summaryLine(cov, r.claim) };
        if (tab.id === win.activeId) win.pushState();
        if (cov.factChecks.length) win.sendUi('toast', { text: 'Fact-checkers have written about this story.', action: 'Show', cmd: 'check:toggle-panel', ms: 9000 });
      }).catch(() => {});
    }
    // Sign-in forms often appear a moment after the page loads (single-page apps).
    if (!again && !r.danger) setTimeout(() => { if (gen === tab.checkGen) scanTab(win, tab, { again: true }).catch(() => {}); }, 2500);
  }

  async function warnDanger(win, tab, r) {
    if (win.win.isDestroyed()) return;
    const d = r.danger;
    const res = await api.showDialog(win.win, {
      type: 'warning', title: 'This may be a fake site',
      message: `This page looks like ${d.org}, but it is not ${d.org}'s website.`,
      detail: `You are on ${r.host}. ${d.org}'s official website is ${d.official}.\n\nThe page asks for your ${d.asks.join(', ')}. Fake sites copy a bank's look to steal these. Your bank will never ask for your PIN or one-time code on a page you reached from an SMS, WhatsApp or email link.${r.scam.length ? `\n\nIt also uses scam wording: ${r.scam.filter(x => !/^It also/.test(x)).join('; ').toLowerCase()}.` : ''}`,
      buttons: ['Leave this page', `Go to ${d.official}`, 'I trust this site'], defaultId: 0, cancelId: 0, noLink: true,
    });
    const wc = tab.view && tab.view.webContents;
    if (!wc || wc.isDestroyed()) return;
    if (res.response === 0) { if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); else win.navigate(tab, 'ferna://newtab/'); }
    else if (res.response === 1) win.navigate(tab, `https://www.${d.official}/`);
    else trust(r.host);
  }
  function trust(host) {
    const dom = G.registrable(host);
    if (!dom) return;
    const list = trusted().filter(x => x !== dom);
    list.unshift(dom);
    ctx.settings.set('checkTrusted', list.slice(0, 200));
    for (const w of ctx.windows) for (const t of w.tabs) if (t.check && G.registrable(t.check.host) === dom) { t.check.danger = null; t.check.scam = []; w.pushState(); }
  }

  /** A message you pasted or selected (SMS, WhatsApp, a social-media post). */
  function checkMessage(text) {
    text = String(text || '').slice(0, 20000);
    // In a short message even one pattern is worth pointing out.
    const scam = G.scamHits(text);
    const claim = G.scanClaim(text, {});
    // Links in the message: who they claim to be vs where they go.
    const links = [];
    const lookalike = require('./lookalike');
    for (const m of text.matchAll(/\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"']*)?)/gi)) {
      let u;
      try { u = new URL(/^https?:/i.test(m[1]) ? m[1] : `http://${m[1]}`); } catch { continue; }
      if (links.some(l => l.host === u.hostname)) continue;
      const host = u.hostname.toLowerCase();
      const named = G.ORGS.filter(([, re]) => re.test(text)).map(([name, , domains]) => ({ name, domains }));
      const wrong = named.find(o => !o.domains.some(d => host === d || host.endsWith(`.${d}`)));
      const right = named.find(o => o.domains.some(d => host === d || host.endsWith(`.${d}`)));
      const look = lookalike.check(host, new Set(), []);
      const shortener = /^(bit\.ly|tinyurl\.com|t\.co|goo\.gl|is\.gd|cutt\.ly|rb\.gy|shorturl\.at|tiny\.cc|ow\.ly|s\.id|t\.ly)$/.test(host);
      const notes = [];
      if (look) notes.push(`Looks like ${look.suggest} but is a different site`);
      if (wrong && !right) notes.push(`The message names ${wrong.name}, but this link is not ${wrong.name}'s website (${wrong.domains[0]})`);
      if (shortener) notes.push('A shortened link hides where it goes');
      if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) notes.push('A bare number address instead of a name');
      if (ctx.safety && ctx.safety.check(u.href)) notes.push('On a list of phishing or malware sites');
      links.push({ url: u.href.slice(0, 300), host, bad: notes.length > 0, notes, official: !!right && !notes.length });
      if (links.length >= 10) break;
    }
    const bad = links.some(l => l.bad);
    const level = bad || scam.length >= 2 ? 'danger' : scam.length || claim.length ? 'warn' : 'ok';
    return { scam, claim, links, level };
  }

  // ---------- side panel ----------
  function panelState(win) {
    const t = win.active;
    const c = t && t.check;
    return { tab: t ? { id: t.id, url: t.url, title: t.title } : null, check: c || null, pending: win.checkText || '', auto: !!S().factCheckAuto, private: !!win.private };
  }
  function refreshPanel(win) {
    if (!win.side || win.side.kind !== 'check') return;
    try { win.side.view.webContents.send('refresh', { what: 'check' }); } catch { /* gone */ }
  }
  function togglePanel(win, force) {
    if (win.side && win.side.kind === 'check' && force !== true) { closePanel(win); return null; }
    if (win.side && win.side.kind === 'check') { refreshPanel(win); return win.side.view; }
    if (win.side) { const v = win.side.view; win.side = null; if (!win.win.isDestroyed()) win.win.contentView.removeChildView(v); }
    let view = win.checkCache;
    if (!view || view.webContents.isDestroyed()) { view = win.makeInternalView('ferna://check/?panel=1', { transparent: false }); win.checkCache = view; }
    else refreshPanel({ side: { kind: 'check', view } });
    win.side = { view, kind: 'check' };
    win.win.contentView.addChildView(view);
    if (win.overlay.getVisible()) win.win.contentView.addChildView(win.overlay);
    win.relayout(); win.pushState();
    return view;
  }
  function closePanel(win) {
    if (!win.side || win.side.kind !== 'check') return;
    const v = win.side.view;
    win.side = null;
    if (!win.win.isDestroyed()) win.win.contentView.removeChildView(v);
    win.relayout(); win.pushState();
  }
  function checkSelection(win, text) {
    win.checkText = String(text || '').slice(0, 5000);
    togglePanel(win, true);
    refreshPanel(win);
  }

  const api = { scanTab, coverage, checkMessage, trust, panelState, refreshPanel, togglePanel, closePanel, checkSelection, WORLD, showDialog: (w, o) => dialog.showMessageBox(w, o) };
  return api;
}

module.exports = { create };
