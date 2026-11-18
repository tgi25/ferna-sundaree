// Ferna Feeds (Chrome extension) — the feed engine, from Ferna Sundaree's feed reader.
//  • Subscriptions (RSS, Atom, JSON Feed; or "follow this page" for sites without a feed), OPML
//    import/export, discovery of the feeds a page announces (the RSS icon in the address bar).
//  • An alarm every few minutes fetches the feeds that are due (lib/worker.js), with backoff on
//    errors and the site's Retry-After respected.
//  • Every new item gets a stream (Local, Global, Research & Academia, Tech & AI), topic tags, a
//    2–3 sentence summary, a TF-IDF vector and a story cluster (the same story from several
//    sources becomes one coverage card); relevance to your interests, to what you read and to
//    your rules decides the order, and low-relevance items can be hidden.
//  • A daily digest (a notification), offline copies of saved articles.
// Everything is kept in this browser profile (IndexedDB); nothing is sent anywhere except the
// requests to the feeds and pages you follow.

import * as P from './parse.js';
import * as N from './nlp.js';
import * as W from './worker.js';

const MAX_ITEMS = 4000;
const KEEP_DAYS = 45;
const DEFAULT_INTERVAL = 30; // minutes

/** Starter packs: well-known feeds by stream (you choose which to add). */
export const STARTERS = {
  local: [
    ['Ada Derana', 'https://www.adaderana.lk/rss.php'], ['EconomyNext', 'https://economynext.com/feed/'],
    ['Daily News', 'https://www.dailynews.lk/feed/'], ['The Island', 'https://island.lk/feed/'],
    ['Sunday Observer', 'https://www.sundayobserver.lk/feed/'], ['Dinamina (සිංහල)', 'https://www.dinamina.lk/feed/'],
    ['BBC Sinhala (සිංහල)', 'https://feeds.bbci.co.uk/sinhala/rss.xml'],
  ],
  global: [
    ['BBC News – World', 'https://feeds.bbci.co.uk/news/world/rss.xml'], ['Al Jazeera', 'https://www.aljazeera.com/xml/rss/all.xml'],
    ['The Guardian – World', 'https://www.theguardian.com/world/rss'], ['NPR – World', 'https://feeds.npr.org/1004/rss.xml'],
  ],
  research: [
    ['arXiv – Machine Learning', 'https://rss.arxiv.org/rss/cs.LG'], ['arXiv – Computation and Language (NLP)', 'https://rss.arxiv.org/rss/cs.CL'],
    ['arXiv – Neural and Evolutionary Computing', 'https://rss.arxiv.org/rss/cs.NE'], ['arXiv – Artificial Intelligence', 'https://rss.arxiv.org/rss/cs.AI'],
    ['Nature', 'https://www.nature.com/nature.rss'], ['ScienceDaily – Artificial Intelligence', 'https://www.sciencedaily.com/rss/computers_math/artificial_intelligence.xml'],
  ],
  tech: [
    ['MIT Technology Review', 'https://www.technologyreview.com/feed/'], ['Ars Technica', 'https://feeds.arstechnica.com/arstechnica/index'],
    ['The Verge', 'https://www.theverge.com/rss/index.xml'], ['Google – AI', 'https://blog.google/technology/ai/rss/'],
    ['Hugging Face blog', 'https://huggingface.co/blog/feed.xml'], ['Hacker News – front page', 'https://hnrss.org/frontpage'],
  ],
};

/** How the feed pages look and behave (Manage → Display, and the Aa button). */
export const VIEW_DEFAULTS = {
  fontSize: 15, fontFamily: 'system', readWidth: 760, density: 'cards', images: true,
  openMode: 'reader', buttonOpens: 'panel', markRead: 'scroll', cluster: true, keepUnreadSaved: false,
  // Reports of one story: grouped across streams ('all'), within a stream ('stream') or not ('off').
  clusterMode: 'all',
  // Read items leave the list when you change the view ('leave'), at once ('now') or not until the
  // page is opened again ('never'). Opening a story marks its reports in other streams read too (readStory).
  hideRead: 'leave', readStory: false,
  // The list: newest first, read items out of the way (the History button shows them).
  listSort: 'new', unreadOnly: true,
  // Today's digest: its own text size and zoom.
  digestFont: 17, digestZoom: 100,
};
const VIEW_RULES = {
  fontSize: v => Number.isInteger(v) && v >= 11 && v <= 26,
  fontFamily: v => ['system', 'serif', 'sans', 'sinhala', 'mono', 'wide'].includes(v),
  readWidth: v => Number.isInteger(v) && v >= 480 && v <= 1600,
  density: v => ['cards', 'compact', 'titles'].includes(v),
  images: v => typeof v === 'boolean',
  openMode: v => ['reader', 'reader-tab', 'tab', 'background'].includes(v),
  buttonOpens: v => ['panel', 'tab'].includes(v),
  markRead: v => ['scroll', 'hover', 'open'].includes(v),
  cluster: v => typeof v === 'boolean',
  clusterMode: v => ['all', 'stream', 'off'].includes(v),
  hideRead: v => ['leave', 'now', 'never'].includes(v),
  readStory: v => typeof v === 'boolean',
  listSort: v => ['smart', 'new', 'old'].includes(v),
  unreadOnly: v => typeof v === 'boolean',
  digestFont: v => Number.isInteger(v) && v >= 12 && v <= 30,
  digestZoom: v => Number.isInteger(v) && v >= 50 && v <= 200,
};
/** One address, however it is written: https or http, www or not, a trailing slash or not. */
export function canon(url) {
  try {
    const u = new URL(url);
    return `${u.hostname.toLowerCase().replace(/^www\./, '')}${u.port ? `:${u.port}` : ''}${u.pathname.replace(/\/+$/, '') || ''}${u.search}`;
  } catch { return String(url || ''); }
}

// ---------- storage: two records in IndexedDB, kept in memory while the worker runs ----------
const DB = 'ferna-feeds', VER = 1;
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => { r.result.createObjectStore('kv'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function dbGet(key) { const d = await db(); return new Promise((res, rej) => { const q = d.transaction('kv').objectStore('kv').get(key); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
async function dbPut(key, val) { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(val, key); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
/** A record with save(): written soon after a change, and at once when flush() is awaited. */
function record(key, data) {
  let timer = null;
  const o = {
    data,
    save() { clearTimeout(timer); timer = setTimeout(() => o.flush(), 250); },
    flush() { clearTimeout(timer); timer = null; return dbPut(key, o.data).catch(() => {}); },
  };
  return o;
}

export async function create(host) {
  const st0 = await dbGet('state');
  const it0 = await dbGet('items');
  const store = record('state', {
    feeds: [], channels: [], interests: '', rules: '', learned: {}, digests: [],
    ...(st0 || {}),
    settings: { interval: DEFAULT_INTERVAL, hideLow: false, threshold: 0.1, aiSummaries: false, digestHour: 6, ...VIEW_DEFAULTS, ...((st0 && st0.settings) || {}) },
  });
  const itemsStore = record('items', { items: (it0 && Array.isArray(it0.items)) ? it0.items : [] });
  const S = () => store.data.settings;
  let polling = null;
  let rules = N.compileRules(store.data.rules);
  let interestVec = N.interestVector(store.data.interests);
  const items = () => itemsStore.data.items;
  const feedById = id => store.data.feeds.find(f => f.id === id);

  // ---------- notify the feed pages and the toolbar ----------
  let notifyTimer = null;
  // quiet: only counts changed (read while scrolling); the pages update their numbers, not their lists.
  function notify({ quiet = false } = {}) {
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => {
      host.broadcast({ what: 'feeds', quiet, counts: quiet ? counts() : undefined });
      host.badge(unreadCount());
    }, 150);
  }
  function unreadCount() { let n = 0; for (const it of items()) if (!it.read && !it.hidden) n++; return n; }

  // ---------- scoring ----------
  function clusterSizes() { const m = new Map(); for (const it of items()) m.set(it.cluster || it.id, (m.get(it.cluster || it.id) || 0) + 1); return m; }
  function rescore(list = items()) {
    const sizes = clusterSizes(), now = Date.now();
    for (const it of list) {
      const r = N.relevance(it, { interests: interestVec, learned: store.data.learned, rules, clusterSize: sizes.get(it.cluster || it.id) || 1, now });
      it.score = r.score;
      it.ruleHidden = r.hidden;
      it.hidden = r.hidden || (S().hideLow && !it.saved && r.score < S().threshold && (interestVec && Object.keys(interestVec).length > 0));
    }
  }

  // ---------- subscriptions ----------
  const newId = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  /** Subscribe to a feed (or follow a page without one). Checks it first; returns the feed. */
  const findFeed = url => { const k = canon(url); return store.data.feeds.find(f => canon(f.url) === k || (f.requested && canon(f.requested) === k)); };
  const inFlight = new Map(); // canonical address → the subscription being checked
  /** Subscribe; the same address asked for twice (at once or later) gives the one feed. */
  function subscribe(url, o = {}) {
    url = P.safeUrl(url);
    if (!url) return Promise.reject(new Error('Only http(s) addresses can be followed.'));
    const existing = findFeed(url);
    if (existing) return Promise.resolve(Object.assign(existing, { existed: true }));
    const k = canon(url);
    if (inFlight.has(k)) return inFlight.get(k);
    const p = subscribeNew(url, o).finally(() => inFlight.delete(k));
    inFlight.set(k, p);
    return p;
  }
  async function subscribeNew(url, { type = 'rss', title = '', category = '' } = {}) {
    const requested = url;
    let feedTitle = title, cat = category, site = '';
    if (type === 'rss') {
      const r = await W.getText(netFetch, url, {});
      let parsed;
      try { parsed = P.parseFeed(r.text, r.url); } catch {
        const found = P.discoverFeeds(r.text, r.url);
        if (!found.length) { const e = new Error('No feed found at this address. You can follow the page instead.'); e.code = 'NOFEED'; throw e; }
        const f2 = await subscribe(found[0].url, { type: 'rss', title: title || found[0].title, category });
        if (!f2.requested) { f2.requested = requested; store.save(); }
        return f2;
      }
      // The address may redirect to a feed you already follow.
      const again = findFeed(url) || (r.url && findFeed(r.url));
      if (again) return Object.assign(again, { existed: true });
      feedTitle = feedTitle || parsed.title || new URL(url).hostname;
      site = parsed.link || '';
      cat = cat || N.feedCategory(url, `${feedTitle} ${site}`, parsed.items.slice(0, 10).map(i => `${i.title} ${i.text.slice(0, 200)}`).join(' '));
    } else {
      feedTitle = feedTitle || new URL(url).hostname;
      site = url;
      cat = cat || N.feedCategory(url, feedTitle);
    }
    const dup = findFeed(url);
    if (dup) return Object.assign(dup, { existed: true });
    const f = { id: newId(), url, type: type === 'scrape' ? 'scrape' : 'rss', title: String(feedTitle).slice(0, 200), site, category: N.CATEGORIES.includes(cat) ? cat : 'global', added: Date.now(), nextFetch: 0, errors: 0, lastError: '', etag: '', lastModified: '', seen: [] };
    store.data.feeds.push(f);
    await store.flush();
    poll({ only: [f.id] }).catch(() => {});
    notify();
    return f;
  }
  function unsubscribe(ids) {
    const set = new Set([].concat(ids));
    const before = store.data.feeds.length;
    store.data.feeds = store.data.feeds.filter(f => !set.has(f.id));
    itemsStore.data.items = items().filter(it => !set.has(it.feedId) || it.saved);
    for (const c of store.data.channels) c.feeds = (c.feeds || []).filter(x => !set.has(x));
    store.save(); itemsStore.save(); notify();
    return before - store.data.feeds.length;
  }
  /** Remove the duplicates an earlier version could make (same address twice): keep the oldest. */
  function dedupeFeeds() {
    const seen = new Map();
    const drop = [];
    for (const f of store.data.feeds) { const k = canon(f.url); if (seen.has(k)) { drop.push(f); for (const it of items()) if (it.feedId === f.id) it.feedId = seen.get(k).id; } else seen.set(k, f); }
    if (!drop.length) return 0;
    store.data.feeds = store.data.feeds.filter(f => !drop.includes(f));
    // The same article fetched twice under two copies: keep one.
    const links = new Set();
    itemsStore.data.items = items().filter(it => { if (!it.link) return true; const k = `${it.feedId}|${it.link}`; if (links.has(k) && !it.saved) return false; links.add(k); return true; });
    store.save(); itemsStore.save();
    return drop.length;
  }
  dedupeFeeds();
  function updateFeed(id, patch) {
    const f = feedById(id);
    if (!f) return null;
    if (typeof patch.title === 'string') f.title = patch.title.slice(0, 200);
    if (N.CATEGORIES.includes(patch.category)) { f.category = patch.category; for (const it of items()) if (it.feedId === id) it.category = N.itemCategory(f.category, it); }
    if (patch.interval === null || (Number.isInteger(patch.interval) && patch.interval >= 5 && patch.interval <= 1440)) f.interval = patch.interval || undefined;
    if (typeof patch.paused === 'boolean') f.paused = patch.paused;
    store.save(); itemsStore.save(); notify();
    return f;
  }

  // ---------- polling ----------
  const netFetch = (u, o) => fetch(u, { ...o, credentials: 'omit', cache: 'no-store' });
  function due(now = Date.now()) {
    return store.data.feeds.filter(f => !f.paused && (f.nextFetch || 0) <= now);
  }
  /** Fetch the feeds that are due (or the ones given). */
  async function poll({ only = null, force = false } = {}) {
    // One poll at a time; a request made meanwhile runs right after it (with what is then due).
    if (polling) return polling.then(() => poll({ only, force }));
    const list = only ? store.data.feeds.filter(f => only.includes(f.id)) : force ? store.data.feeds.filter(f => !f.paused) : due();
    if (!list.length) return { fetched: 0, added: 0 };
    polling = (async () => {
      const now = Date.now();
      const knownByFeed = new Map();
      for (const it of items()) { if (!knownByFeed.has(it.feedId)) knownByFeed.set(it.feedId, []); knownByFeed.get(it.feedId).push(it.id); }
      const recent = items().filter(it => now - (it.date || it.added) < 72 * 3600e3).slice(-1500).map(it => ({ id: it.id, title: it.title, summary: it.summary, vec: it.vec, cluster: it.cluster, date: it.date, added: it.added }));
      const job = { recent, feeds: list.slice(0, 40).map(f => ({ id: f.id, url: f.url, type: f.type, category: f.category, etag: f.etag, lastModified: f.lastModified, seen: (f.seen || []).slice(-300), known: (knownByFeed.get(f.id) || []).slice(-600) })) };
      let res;
      try { res = await W.run(job, netFetch); } catch (e) { return { fetched: 0, added: 0, error: String(e.message || e) }; }
      let added = 0;
      const linkSeen = new Set(items().map(it => it.link).filter(Boolean));
      const fresh = [];
      for (const r of res.results || []) {
        if (!r) continue;
        const f = feedById(r.feedId);
        if (!f) continue;
        const interval = (f.interval || S().interval || DEFAULT_INTERVAL) * 60e3;
        f.lastFetch = Date.now();
        if (!r.ok) {
          f.errors = (f.errors || 0) + 1; f.lastError = r.error || 'error';
          f.nextFetch = Date.now() + Math.max((r.retryAfter || 0) * 1000, Math.min(interval * 2 ** Math.min(f.errors, 6), 24 * 3600e3));
          continue;
        }
        f.errors = 0; f.lastError = '';
        f.nextFetch = Date.now() + interval;
        if (r.notModified) continue;
        if (r.etag) f.etag = r.etag; if (r.lastModified) f.lastModified = r.lastModified;
        if (r.title && (!f.title || f.title === new URL(f.url).hostname)) f.title = String(r.title).slice(0, 200);
        if (r.link && !f.site) f.site = r.link;
        if (r.movedTo) f.url = r.movedTo;
        if (f.type === 'scrape' && Array.isArray(r.seen)) f.seen = [...new Set([...(f.seen || []), ...r.seen])].slice(-500);
        for (const it of r.items || []) {
          if (it.link && linkSeen.has(it.link)) continue; // the same article from another of your feeds
          if (it.link) linkSeen.add(it.link);
          it.read = false; it.saved = false;
          fresh.push(it);
          added++;
        }
      }
      if (fresh.length) {
        itemsStore.data.items.push(...fresh);
        prune();
        rescore();
        await itemsStore.flush();
      }
      await store.flush();
      maybeDigest();
      notify();
      return { fetched: list.length, added };
    })().finally(() => { polling = null; });
    return polling;
  }
  function prune() {
    const cutoff = Date.now() - KEEP_DAYS * 86400e3;
    let list = items().filter(it => it.saved || (it.added || it.date) >= cutoff);
    if (list.length > MAX_ITEMS) {
      const keep = list.filter(it => it.saved);
      const rest = list.filter(it => !it.saved).sort((a, b) => (b.date || b.added) - (a.date || a.added)).slice(0, Math.max(0, MAX_ITEMS - keep.length));
      list = [...keep, ...rest];
    }
    itemsStore.data.items = list;
  }
  /** The alarm: fetch what is due, or make the digest. */
  async function tick() { if (due().length) await poll().catch(() => {}); else maybeDigest(); }

  // ---------- reading list views ----------
  /** Coverage cards: items grouped by story, best first. */
  function list(q = {}) {
    const { category = 'all', channel = '', search = '', unreadOnly = false, saved = false, showHidden = false, feedId = '', sort = 'smart', history = false } = q;
    const limit = Math.max(1, Math.min(4000, Number(q.limit) || 200));
    // Items read while you look at this list stay in it (Display → "Hide read items").
    const keep = new Set(Array.isArray(q.keep) ? q.keep.filter(x => typeof x === 'string').slice(0, 4000) : []);
    let pool = items();
    // Reading history: what you have read, the latest read first.
    if (history) pool = pool.filter(it => it.read);
    if (saved) pool = pool.filter(it => it.saved);
    if (feedId) pool = pool.filter(it => it.feedId === feedId);
    if (category && category !== 'all' && !saved && !channel) pool = pool.filter(it => it.category === category);
    if (channel) {
      const ch = store.data.channels.find(c => c.id === channel);
      if (ch) { const rs = N.compileRules(ch.keywords); pool = pool.filter(it => (ch.feeds || []).includes(it.feedId) || rs.some(r => r.sign > 0 && r.re.test(`${it.title} ${it.summary}`))); }
    }
    const hiddenCount = pool.filter(it => it.hidden).length;
    if (!showHidden) pool = pool.filter(it => !it.hidden);
    if (search) {
      const terms = N.tokens(search);
      const raw = String(search).toLowerCase();
      pool = pool.filter(it => { const s = `${it.title} ${it.summary} ${it.text}`.toLowerCase(); return s.includes(raw) || (terms.length && terms.every(t => N.tokens(s).includes(t))); });
    }
    const groups = new Map();
    const mode = S().clusterMode || (S().cluster === false ? 'off' : 'all');
    const together = mode !== 'off' && S().cluster !== false && !feedId;
    for (const it of pool) { const k = !together ? it.id : mode === 'stream' ? `${it.cluster || it.id}|${it.category}` : it.cluster || it.id; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); }
    const unreadItems = pool.filter(it => !it.read).length;
    let cards = [...groups.values()].map(g => {
      // The lead story: the best-scoring report, then the fullest; the others are "also reported by".
      const lead = g.slice().sort((a, b) => (b.score || 0) - (a.score || 0) || (b.text || '').length - (a.text || '').length)[0];
      g.sort((a, b) => (a === lead ? -1 : b === lead ? 1 : (b.date || 0) - (a.date || 0)));
      const date = Math.max(...g.map(x => x.date || x.added || 0));
      return {
        id: lead.id, cluster: lead.cluster || lead.id, title: lead.title, link: lead.link, summary: lead.aiSummary || lead.summary, ai: !!lead.aiSummary,
        image: (g.find(x => x.image) || {}).image || '', tags: lead.tags || [], category: lead.category, score: Math.max(...g.map(x => x.score || 0)), date,
        read: g.every(x => x.read), unread: g.filter(x => !x.read).length, saved: g.some(x => x.saved), hidden: g.every(x => x.hidden),
        feedId: lead.feedId, feed: (feedById(lead.feedId) || {}).title || '',
        sources: g.map(x => ({ id: x.id, feedId: x.feedId, feed: (feedById(x.feedId) || {}).title || '', title: x.title, link: x.link, date: x.date, read: x.read })),
      };
    });
    if (history) {
      const at = new Map(pool.map(it => [it.id, it.readAt || 0]));
      for (const c of cards) c.readAt = Math.max(...c.sources.map(x => at.get(x.id) || 0));
      cards.sort((a, b) => b.readAt - a.readAt || b.date - a.date);
      return { cards: cards.slice(0, limit), total: cards.length, hiddenCount, counts: counts(), history: true, unreadItems };
    }
    if (unreadOnly) cards = cards.filter(c => !c.read || c.sources.some(x => keep.has(x.id)));
    if (sort === 'new') cards.sort((a, b) => b.date - a.date);
    else if (sort === 'old') cards.sort((a, b) => a.date - b.date);
    else cards.sort((a, b) => (b.score + Math.min(0.2, (b.sources.length - 1) * 0.05)) - (a.score + Math.min(0.2, (a.sources.length - 1) * 0.05)) || b.date - a.date);
    return { cards: cards.slice(0, limit), total: cards.length, hiddenCount, counts: counts(), unreadItems };
  }
  /** The items you opened most recently (the "Recently opened" strip). */
  function recent(n = 5) {
    return items().filter(it => it.openedAt).sort((a, b) => b.openedAt - a.openedAt).slice(0, Math.max(1, Math.min(20, n)))
      .map(it => ({ id: it.id, title: it.title, feed: (feedById(it.feedId) || {}).title || '', openedAt: it.openedAt, category: it.category }));
  }
  /** Unread items per stream, per channel and per feed (the numbers in the side list). */
  function counts() {
    const c = { all: 0, local: 0, global: 0, research: 0, tech: 0, saved: 0, feeds: {}, channels: {} };
    const chans = store.data.channels.map(ch => ({ id: ch.id, feeds: new Set(ch.feeds || []), rs: N.compileRules(ch.keywords).filter(r => r.sign > 0) }));
    for (const it of items()) {
      if (it.saved) c.saved++;
      if (it.hidden || it.read) continue;
      c.all++; c[it.category] = (c[it.category] || 0) + 1;
      c.feeds[it.feedId] = (c.feeds[it.feedId] || 0) + 1;
      for (const ch of chans) if (ch.feeds.has(it.feedId) || ch.rs.some(r => r.re.test(`${it.title} ${it.summary}`))) c.channels[ch.id] = (c.channels[ch.id] || 0) + 1;
    }
    return c;
  }
  function item(id) { return items().find(it => it.id === id) || null; }
  function setRead(ids, read = true, { quiet = false } = {}) {
    const set = new Set(ids);
    let n = 0;
    const now = Date.now();
    for (const it of items()) if (set.has(it.id) && it.read !== read) { it.read = read; it.readAt = read ? now : 0; n++; }
    if (n) { itemsStore.save(); notify({ quiet }); }
    return counts();
  }
  /** Mark read: a stream, a feed, a channel, and/or what is older than a time. */
  function markAllRead(category = 'all', { feedId = '', channel = '', olderThan = 0, ids = null } = {}) {
    let pool = items();
    if (feedId) pool = pool.filter(it => it.feedId === feedId);
    if (category && category !== 'all') pool = pool.filter(it => it.category === category);
    if (channel) { const ch = store.data.channels.find(c => c.id === channel); if (ch) { const rs = N.compileRules(ch.keywords); pool = pool.filter(it => (ch.feeds || []).includes(it.feedId) || rs.some(r => r.sign > 0 && r.re.test(`${it.title} ${it.summary}`))); } }
    if (olderThan) pool = pool.filter(it => (it.date || it.added || 0) < olderThan);
    if (ids) { const set = new Set(ids); pool = pool.filter(it => set.has(it.id)); }
    let n = 0;
    const now = Date.now();
    lastMarked = [];
    for (const it of pool) if (!it.read) { it.read = true; it.readAt = now; n++; lastMarked.push(it.id); }
    itemsStore.save(); notify();
    return n;
  }
  /** Undo the last "Mark all read" (or "older than"). */
  let lastMarked = [];
  function unmarkLast() {
    const ids = lastMarked; lastMarked = [];
    if (!ids.length) return 0;
    setRead(ids, false);
    return ids.length;
  }
  /** You opened an item: it is read, and your reading profile learns from it. */
  function opened(id) {
    const it = item(id);
    if (!it) return null;
    const now = Date.now();
    if (!it.read) { it.read = true; store.data.learned = N.learn(store.data.learned, it.vec, 0.12); store.save(); }
    it.readAt = now; // opened again: back to the top of the history
    it.openedAt = now;
    // The other reports of the story in other streams: only when you asked for that.
    if (S().readStory) for (const x of items()) if (x.cluster && x.cluster === it.cluster && !x.read) { x.read = true; x.readAt = now; }
    // Only numbers change: the open pages update their counts and leave their lists alone.
    itemsStore.save(); notify({ quiet: true });
    return it;
  }
  function setSaved(id, saved) {
    const it = item(id);
    if (!it) return null;
    it.saved = !!saved;
    if (saved) { store.data.learned = N.learn(store.data.learned, it.vec, 0.2); store.save(); }
    itemsStore.save(); notify();
    return it;
  }

  // ---------- digest ----------
  const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  /** Today's key takeaways: top research, breaking stories covered by several sources, best per stream. */
  function buildDigest() {
    const now = Date.now();
    const recentCards = cat => list({ category: cat, limit: 400 }).cards.filter(c => now - c.date < 36 * 3600e3);
    const all = recentCards('all');
    const research = recentCards('research').slice(0, 5);
    const breaking = all.filter(c => c.sources.length >= 2 && c.category !== 'research').sort((a, b) => b.sources.length - a.sources.length || b.score - a.score).slice(0, 5);
    const used = new Set([...research, ...breaking].map(c => c.cluster));
    const streams = {};
    for (const cat of ['local', 'global', 'tech']) streams[cat] = recentCards(cat).filter(c => !used.has(c.cluster)).slice(0, 3);
    return { day: dayKey(), made: now, research, breaking, streams, unread: unreadCount(), takeaways: '' };
  }
  function maybeDigest() {
    const today = dayKey();
    const d0 = store.data.digests[0];
    if (d0 && d0.day === today) return;
    if (new Date().getHours() < (S().digestHour ?? 6) || !items().length) return;
    const d = buildDigest();
    if (!d.research.length && !d.breaking.length && !Object.values(d.streams).some(x => x.length)) return;
    store.data.digests.unshift(d);
    store.data.digests = store.data.digests.slice(0, 14);
    store.save();
    host.digestReady(d);
  }

  // ---------- AI summaries: the Ferna Sundaree browser has them (with your own AI model) ----------
  async function aiSummary() { throw new Error('AI summaries are part of the Ferna Sundaree browser. The summary shown is made on your computer.'); }
  async function aiTakeaways() { return ''; }

  // ---------- reader ----------
  /** The article's page, for the reader view (made readable in the feed page itself). */
  async function articleHtml(id) {
    const it = item(id);
    if (!it || !it.link) throw new Error('This item has no web address.');
    const r = await W.getText(netFetch, it.link, { timeout: 25000 });
    return { url: r.url || it.link, html: String(r.text || '').slice(0, 3 * 1024 * 1024) };
  }
  function storeFullText(id, text) { const it = item(id); if (it && typeof text === 'string') { it.fullText = text.slice(0, 60000); if (!it.summary || it.summary.length < 80) it.summary = N.summarize(it.title, text, 3); itemsStore.save(); } }

  // ---------- discovery: the page script reports the feeds a page announces ----------
  const isSubscribed = url => store.data.feeds.some(f => f.url === url);

  // ---------- OPML ----------
  function exportOpml() { return P.buildOpml(store.data.feeds.filter(f => f.type === 'rss').map(f => ({ url: f.url, title: f.title, site: f.site, category: N.CAT_LABEL[f.category] || f.category }))); }
  async function importOpml(text) {
    const list = P.parseOpml(text);
    const catOf = c => { const s = String(c || '').toLowerCase(); return /local|sri lanka|lanka/.test(s) ? 'local' : /research|academ|science|paper/.test(s) ? 'research' : /tech|ai\b|computing/.test(s) ? 'tech' : /global|world|international|news/.test(s) ? 'global' : ''; };
    let added = 0;
    for (const o of list) {
      if (isSubscribed(o.url)) continue;
      store.data.feeds.push({ id: newId(), url: o.url, type: 'rss', title: o.title || new URL(o.url).hostname, site: o.site || '', category: catOf(o.category) || N.feedCategory(o.url, o.title), added: Date.now(), nextFetch: 0, errors: 0, lastError: '', etag: '', lastModified: '', seen: [] });
      added++;
    }
    await store.flush(); notify();
    if (added) poll().catch(() => {});
    return { found: list.length, added };
  }

  // ---------- everything: feeds, channels, interests, filters and settings (a .json file) ----------
  function exportAll() {
    return {
      format: 'ferna-feeds', version: 1, exported: new Date().toISOString(),
      feeds: store.data.feeds.map(f => ({ id: f.id, url: f.url, type: f.type, title: f.title, site: f.site, category: f.category, paused: !!f.paused, interval: f.interval || null })),
      channels: store.data.channels, interests: store.data.interests, rules: store.data.rules, settings: { ...VIEW_DEFAULTS, ...S() },
    };
  }
  async function importAll(data, { replaceSettings = true } = {}) {
    if (!data || data.format !== 'ferna-feeds' || !Array.isArray(data.feeds)) throw new Error('This is not a Ferna Feeds export.');
    let added = 0;
    const idMap = new Map();
    for (const f of data.feeds.slice(0, 2000)) {
      const url = P.safeUrl(f && f.url);
      if (!url) continue;
      const have = findFeed(url);
      if (have) { idMap.set(f.id, have.id); continue; }
      const nf = { id: newId(), url, type: f.type === 'scrape' ? 'scrape' : 'rss', title: String(f.title || new URL(url).hostname).slice(0, 200), site: P.safeUrl(f.site) || '', category: N.CATEGORIES.includes(f.category) ? f.category : N.feedCategory(url, f.title), paused: !!f.paused, interval: Number.isInteger(f.interval) ? f.interval : undefined, added: Date.now(), nextFetch: 0, errors: 0, lastError: '', etag: '', lastModified: '', seen: [] };
      store.data.feeds.push(nf); idMap.set(f.id, nf.id); added++;
    }
    const p = {};
    if (replaceSettings) {
      if (typeof data.interests === 'string') p.interests = data.interests;
      if (typeof data.rules === 'string') p.rules = data.rules;
      if (data.settings && typeof data.settings === 'object') Object.assign(p, data.settings);
      if (Array.isArray(data.channels)) {
        const mine = new Map(store.data.channels.map(c => [c.name, c]));
        for (const c of data.channels) mine.set(String(c.name || 'Channel'), { ...c, feeds: (c.feeds || []).map(x => idMap.get(x) || x) });
        p.channels = [...mine.values()];
      }
    }
    store.save();
    setPrefs(p);
    await store.flush();
    if (added) poll().catch(() => {});
    return { found: data.feeds.length, added };
  }

  // ---------- settings ----------
  function setPrefs(p) {
    if (typeof p.interests === 'string') { store.data.interests = p.interests.slice(0, 4000); interestVec = N.interestVector(store.data.interests); }
    if (typeof p.rules === 'string') { store.data.rules = p.rules.slice(0, 8000); rules = N.compileRules(store.data.rules); }
    const s = S();
    if ([15, 30, 60, 180, 360].includes(p.interval)) s.interval = p.interval;
    if (typeof p.hideLow === 'boolean') s.hideLow = p.hideLow;
    if (typeof p.threshold === 'number' && p.threshold >= 0 && p.threshold <= 0.6) s.threshold = p.threshold;
    if (typeof p.aiSummaries === 'boolean') s.aiSummaries = p.aiSummaries;
    if (Number.isInteger(p.digestHour) && p.digestHour >= 0 && p.digestHour <= 23) s.digestHour = p.digestHour;
    if (Array.isArray(p.channels)) store.data.channels = p.channels.slice(0, 30).map(c => ({ id: String(c.id || newId()).slice(0, 40), name: String(c.name || 'Channel').slice(0, 60), keywords: String(c.keywords || '').slice(0, 4000), feeds: Array.isArray(c.feeds) ? c.feeds.filter(x => typeof x === 'string').slice(0, 200) : [] }));
    if (p.forgetLearned) store.data.learned = {};
    for (const [k, ok] of Object.entries(VIEW_RULES)) if (k in p && ok(p[k])) s[k] = p[k];
    rescore(); store.save(); itemsStore.save(); notify();
    return prefs();
  }
  function prefs() {
    return { interests: store.data.interests, rules: store.data.rules, channels: store.data.channels, settings: { ...VIEW_DEFAULTS, ...S() }, learnedTerms: Object.entries(store.data.learned).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k]) => k.replace(/_/g, ' ')), aiReady: false };
  }
  function feedsInfo() {
    const counts = new Map(), unread = new Map();
    for (const it of items()) { counts.set(it.feedId, (counts.get(it.feedId) || 0) + 1); if (!it.read && !it.hidden) unread.set(it.feedId, (unread.get(it.feedId) || 0) + 1); }
    return store.data.feeds.map(f => ({ id: f.id, url: f.url, type: f.type, title: f.title, site: f.site, category: f.category, lastFetch: f.lastFetch || 0, nextFetch: f.nextFetch || 0, errors: f.errors || 0, lastError: f.lastError || '', items: counts.get(f.id) || 0, unread: unread.get(f.id) || 0, interval: f.interval || null, paused: !!f.paused }));
  }
  function clearHistory() { itemsStore.data.items = items().filter(it => it.saved); store.data.learned = {}; store.data.digests = []; store.save(); itemsStore.save(); notify(); }

  async function flush() { await Promise.all([store.flush(), itemsStore.flush()]); }

  return {
    STARTERS, VIEW_DEFAULTS, canon, counts, recent, unmarkLast, exportAll, importAll, dedupeFeeds, subscribe, unsubscribe, updateFeed, poll, list, item, setRead, markAllRead, opened, setSaved,
    buildDigest, maybeDigest, digests: () => store.data.digests, aiSummary, aiTakeaways, articleHtml, storeFullText,
    isSubscribed, exportOpml, importOpml, setPrefs, prefs, feedsInfo, unreadCount, clearHistory,
    rescore, store, itemsStore, tick, flush, findFeed,
  };
}
