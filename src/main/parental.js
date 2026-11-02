'use strict';
// Parental controls: content filtering protected by a parent's password.
//   • Blocks adult sites (optionally gambling, social media, and your own list) on every page and
//     every resource, in normal and private windows and in every profile on this Windows account.
//   • Forces SafeSearch on Google, Bing, DuckDuckGo, Yahoo, Brave Search and Startpage, and
//     YouTube's Restricted Mode.
//   • While on: private windows, Tor windows, installing extensions and changing the filter need
//     the parent's password; a blocked page offers "Ask a parent" to allow that one site.
//   • Lists: StevenBlack's unified hosts category lists (porn, gambling, social), refreshed weekly,
//     plus a built-in list and name patterns so it works before the first download.
// The settings live beside the profiles (not inside one), so a new profile is filtered too.
// A determined user with Windows administrator rights can still remove any browser filter: for
// stronger protection also use Microsoft Family Safety or the Group Policy setting.

const fs = require('fs');
const path = require('path');
const secret = require('./secret');

const LISTS = {
  adult: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/porn-only/hosts',
  gambling: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/gambling-only/hosts',
  social: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/social-only/hosts',
};
const BUILTIN = {
  adult: ['pornhub.com', 'xvideos.com', 'xnxx.com', 'xhamster.com', 'redtube.com', 'youporn.com', 'onlyfans.com', 'chaturbate.com', 'stripchat.com', 'spankbang.com', 'brazzers.com', 'livejasmin.com', 'eporner.com', 'tube8.com', 'beeg.com', 'rule34.xxx', 'nhentai.net', 'hentaihaven.xxx', 'fapello.com', 'motherless.com'],
  gambling: ['bet365.com', 'betway.com', '1xbet.com', 'pokerstars.com', 'stake.com', 'draftkings.com', 'fanduel.com', 'williamhill.com', 'paddypower.com', '888casino.com', 'bovada.lv', 'betfair.com'],
  social: ['facebook.com', 'instagram.com', 'tiktok.com', 'x.com', 'twitter.com', 'snapchat.com', 'reddit.com', 'discord.com', 'tumblr.com', 'threads.net'],
};
// Whole-word name patterns (between dots or hyphens) for adult sites not on a list yet.
const ADULT_NAME = /(^|[.-])(porn|porno|xxx|hentai|nsfw|xvideo|xvideos|sexcam|camgirls?|milf|nude|nudes|erotic|fetish)([.-]|$)/i;
const DEFAULT_CFG = { enabled: false, password: null, categories: { adult: true, gambling: false, social: false }, safeSearch: true, allow: [], block: [], updated: 0, blockedCount: 0 };

function parseHosts(text) {
  const out = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*(?:0\.0\.0\.0|127\.0\.0\.1)\s+([a-z0-9.-]+)\s*(?:#.*)?$/i.exec(line);
    if (m && m[1] !== 'localhost' && m[1].includes('.')) out.add(m[1].toLowerCase().replace(/^www\./, ''));
  }
  return out;
}
/** Matches the host or any parent domain in the set. */
function inSet(set, host) {
  host = String(host || '').toLowerCase().replace(/\.$/, '');
  for (let h = host; h && h.includes('.'); h = h.slice(h.indexOf('.') + 1)) if (set.has(h)) return h;
  return null;
}

/** SafeSearch: the address with safe search switched on, or null if it is fine as it is. */
function safeSearchUrl(u) {
  let x;
  try { x = new URL(u); } catch { return null; }
  const h = x.hostname.toLowerCase();
  const set = (k, v) => { if (x.searchParams.get(k) === v) return null; x.searchParams.set(k, v); return x.href; };
  if (/(^|\.)google\.[a-z.]+$/.test(h) && /^\/(search|images|webhp|$)/.test(x.pathname) && x.searchParams.has('q')) return set('safe', 'active');
  if (/(^|\.)bing\.com$/.test(h) && /^\/(search|images|videos)/.test(x.pathname)) return set('adlt', 'strict');
  if (/(^|\.)duckduckgo\.com$/.test(h) && x.searchParams.has('q')) return set('kp', '1');
  if (/(^|\.)search\.yahoo\.com$/.test(h)) return set('vm', 'r');
  if (h === 'search.brave.com' && x.pathname.startsWith('/search')) return set('safesearch', 'strict');
  if (/(^|\.)startpage\.com$/.test(h) && x.pathname.startsWith('/do/search')) return set('qadf', 'heavy');
  return null;
}

function install(ctx, { dataDir }) {
  const base = ctx.profilesDir && !process.env.FERNA_SUNDAREE_DATA ? path.dirname(ctx.profilesDir) : dataDir;
  const file = path.join(base, 'parental.json');
  const listFile = path.join(base, 'parental-lists.json');
  let cfg = { ...DEFAULT_CFG };
  try { cfg = { ...DEFAULT_CFG, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* first run */ }
  let allowSet = new Set(cfg.allow), blockSet = new Set(cfg.block);
  const save = () => { allowSet = new Set(cfg.allow); blockSet = new Set(cfg.block); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(cfg, null, 2)); };
  const sets = { adult: new Set(BUILTIN.adult), gambling: new Set(BUILTIN.gambling), social: new Set(BUILTIN.social) };
  const loadLists = () => {
    try {
      const L = JSON.parse(fs.readFileSync(listFile, 'utf8'));
      for (const k of Object.keys(sets)) if (Array.isArray(L[k])) sets[k] = new Set([...BUILTIN[k], ...L[k]]);
    } catch { /* not downloaded yet */ }
  };
  loadLists();
  const hits = new Map(); // webContents id → { url, why }
  const allowSession = new Set();
  let status = 'built-in lists';

  async function refresh(force) {
    if (!cfg.enabled) return;
    if (!force && Date.now() - (cfg.updated || 0) < 7 * 86400000 && fs.existsSync(listFile)) return;
    const out = {};
    for (const [k, url] of Object.entries(LISTS)) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (r.ok) out[k] = [...parseHosts(await r.text())];
      } catch { /* keep the old copy */ }
    }
    if (Object.keys(out).length) {
      let old = {};
      try { old = JSON.parse(fs.readFileSync(listFile, 'utf8')); } catch { /* none */ }
      fs.writeFileSync(listFile, JSON.stringify({ ...old, ...out }));
      cfg.updated = Date.now(); save(); loadLists();
      status = `lists updated ${new Date(cfg.updated).toLocaleDateString()}`;
    }
  }

  /** Why a URL is blocked ('adult' | 'gambling' | 'social' | 'yours'), or null. */
  function check(u) {
    if (!cfg.enabled) return null;
    let host;
    try { const x = new URL(u); if (!/^https?:$/.test(x.protocol)) return null; host = x.hostname.toLowerCase(); } catch { return null; }
    if (inSet(allowSet, host) || allowSession.has(host.replace(/^www\./, ''))) return null;
    if (inSet(blockSet, host)) return 'yours';
    for (const k of ['adult', 'gambling', 'social']) if (cfg.categories[k] && inSet(sets[k], host)) return k;
    if (cfg.categories.adult && ADULT_NAME.test(host)) return 'adult';
    return null;
  }

  ctx.parental = {
    on: () => !!cfg.enabled,
    check,
    safeSearchUrl: u => (cfg.enabled && cfg.safeSearch ? safeSearchUrl(u) : null),
    youtubeRestrict: host => cfg.enabled && cfg.safeSearch && /(^|\.)(youtube\.com|youtube-nocookie\.com|youtubei\.googleapis\.com|youtube\.googleapis\.com)$/.test(host),
    hits,
    record(wcId, url, why) { hits.set(wcId, { url, why }); cfg.blockedCount = (cfg.blockedCount || 0) + 1; },
    verify: pw => secret.verify(pw, cfg.password),
    register,
  };

  function publicCfg() {
    return { enabled: cfg.enabled, hasPassword: !!cfg.password, categories: cfg.categories, safeSearch: cfg.safeSearch, allow: cfg.allow, block: cfg.block, status, blockedCount: cfg.blockedCount || 0, counts: Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, v.size])) };
  }
  const cleanHosts = list => [...new Set((Array.isArray(list) ? list : String(list || '').split(/[\s,]+/)).map(h => String(h).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')).filter(h => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)))].slice(0, 1000);

  function register(C) {
    const P = ['parental'];
    C('parental:get', [], P, () => publicCfg());
    // First set-up: choose the password. Afterwards every change needs it.
    C('parental:setup', ['string', 'object'], P, (c, pw, opts) => {
      if (cfg.password) return { ok: false, error: 'Parental controls are already set up. Enter the password to change them.' };
      if (pw.length < 6) return { ok: false, error: 'Use at least 6 characters for the parent password.' };
      cfg.password = secret.hash(pw);
      cfg.enabled = true;
      cfg.categories = { adult: true, gambling: !!opts.gambling, social: !!opts.social };
      cfg.safeSearch = opts.safeSearch !== false;
      save(); refresh(true).catch(() => {});
      ctx.broadcast();
      return { ok: true, cfg: publicCfg() };
    });
    C('parental:change', ['string', 'object'], P, (c, pw, patch) => {
      if (!secret.verify(pw, cfg.password)) return { ok: false, error: 'Wrong password.' };
      if (typeof patch.enabled === 'boolean') cfg.enabled = patch.enabled;
      if (patch.categories) cfg.categories = { adult: patch.categories.adult !== false, gambling: !!patch.categories.gambling, social: !!patch.categories.social };
      if (typeof patch.safeSearch === 'boolean') cfg.safeSearch = patch.safeSearch;
      if (patch.allow !== undefined) cfg.allow = cleanHosts(patch.allow);
      if (patch.block !== undefined) cfg.block = cleanHosts(patch.block);
      if (typeof patch.newPassword === 'string') { if (patch.newPassword.length < 6) return { ok: false, error: 'Use at least 6 characters.' }; cfg.password = secret.hash(patch.newPassword); }
      save(); if (cfg.enabled) refresh(false).catch(() => {});
      ctx.broadcast();
      return { ok: true, cfg: publicCfg() };
    });
    C('parental:refresh', ['string'], P, async (c, pw) => { if (!secret.verify(pw, cfg.password)) return { ok: false, error: 'Wrong password.' }; await refresh(true); return { ok: true, cfg: publicCfg() }; });
    // From the block page: a parent allows this site (always, or until restart).
    C('parental:allow', ['string', 'string', 'bool'], ['interstitial'], (c, url, pw, always) => {
      if (!secret.verify(pw, cfg.password)) return false;
      let host;
      try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return false; }
      if (always) { cfg.allow = cleanHosts([...cfg.allow, host]); save(); } else allowSession.add(host);
      const w = ctx.windowFor(c.wc);
      const t = w && w.tabs.find(x => x.view && x.view.webContents === c.wc);
      if (t) setImmediate(() => w.navigate(t, url));
      return true;
    });
  }

  // Features that would get around the filter ask for the password.
  ctx.parentalGate = async (win, what) => {
    if (!cfg.enabled) return true;
    win.openOverlay('parentpw', { what });
    return new Promise(res => { ctx._parentalWaiter = res; });
  };
  // A wrong password keeps the prompt open; only a right one (or Cancel) answers the waiting feature.
  ctx.parentalAnswer = pw => {
    const ok = secret.verify(pw, cfg.password);
    if (ok) { const r = ctx._parentalWaiter; ctx._parentalWaiter = null; if (r) r(true); }
    return ok;
  };

  setTimeout(() => refresh(false).catch(() => {}), 20000).unref?.();
  setInterval(() => refresh(false).catch(() => {}), 12 * 3600000).unref?.();
}

module.exports = { install, parseHosts, inSet, safeSearchUrl, ADULT_NAME, LISTS };
