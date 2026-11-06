'use strict';
// Background part of the feed reader (runs in the utility process of listworker.js, so the
// browser never waits for it): fetches the feeds that are due — politely: a few at a time, one
// request per site at a time with a pause between, conditional requests (ETag / Last-Modified),
// size and time limits — parses them, follows pages without a feed, and analyses every new item:
// summary, topic tags, stream, TF-IDF vector and story cluster.

const crypto = require('crypto');
const P = require('./parse');
const N = require('./nlp');

const MAX_BYTES = 5 * 1024 * 1024;
const PER_HOST_GAP = 1500;
const hostOf = u => { try { return new URL(u).hostname; } catch { return ''; } };
const idOf = (feedId, key) => crypto.createHash('sha1').update(`${feedId}\n${key}`).digest('hex').slice(0, 16);

async function getText(fetch, url, { etag, lastModified, ua, timeout = 25000 } = {}) {
  const headers = { accept: 'application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.8, */*;q=0.5' };
  if (ua) headers['user-agent'] = ua;
  if (etag) headers['if-none-match'] = etag;
  if (lastModified) headers['if-modified-since'] = lastModified;
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeout), redirect: 'follow' });
  if (r.status === 304) return { notModified: true };
  if (r.status === 429 || r.status === 503) { const ra = Number(r.headers.get('retry-after')) || 0; const e = new Error(`HTTP ${r.status}`); e.retryAfter = ra; throw e; }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const len = Number(r.headers.get('content-length') || 0);
  if (len > MAX_BYTES) throw new Error('too large');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('too large');
  const type = r.headers.get('content-type') || '';
  const cs = (/charset=([\w-]+)/i.exec(type) || [])[1] || (/^<\?xml[^>]*encoding=["']([\w-]+)/i.exec(buf.slice(0, 200).toString('latin1')) || [])[1] || 'utf-8';
  let text;
  try { text = new TextDecoder(cs.toLowerCase()).decode(buf); } catch { text = buf.toString('utf8'); }
  return { text, type, etag: r.headers.get('etag') || '', lastModified: r.headers.get('last-modified') || '', url: r.url || url };
}

/** Main text of an article page: <article>, else <main>, else the largest run of paragraphs. */
function articleText(html) {
  const h = String(html || '');
  const pick = (/<article\b[\s\S]*?<\/article>/i.exec(h) || /<main\b[\s\S]*?<\/main>/i.exec(h) || [''])[0];
  if (pick && P.htmlToText(pick).length > 400) return P.htmlToText(pick);
  const paras = (h.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) || []).map(P.htmlToText).filter(t => t.length > 60);
  return paras.join('\n');
}

async function fetchFeed(fetch, f, ua) {
  if (f.type === 'scrape') {
    const page = await getText(fetch, f.url, { ua, etag: f.etag, lastModified: f.lastModified });
    if (page.notModified) return { notModified: true };
    const meta = P.pageMeta(page.text, page.url);
    const seen = new Set(f.seen || []);
    const fresh = P.scrapeLinks(page.text, page.url).filter(l => !seen.has(l.link)).slice(0, 8);
    const items = [];
    for (const l of fresh) {
      let text = '', date = 0, image = '', title = l.title;
      try {
        await new Promise(r => setTimeout(r, PER_HOST_GAP));
        const a = await getText(fetch, l.link, { ua, timeout: 20000 });
        const m = P.pageMeta(a.text, l.link);
        text = articleText(a.text) || m.description; date = m.date; image = m.image; title = m.title || title;
      } catch { /* keep the link and its headline */ }
      items.push({ id: l.link, title, link: l.link, text, date, image, author: '', categories: [] });
    }
    return { title: meta.site || meta.title, link: page.url, items, etag: page.etag, lastModified: page.lastModified, allLinks: P.scrapeLinks(page.text, page.url).map(l => l.link) };
  }
  const r = await getText(fetch, f.url, { ua, etag: f.etag, lastModified: f.lastModified });
  if (r.notModified) return { notModified: true };
  let feed;
  try { feed = P.parseFeed(r.text, r.url); } catch (e) {
    // A web page given instead of a feed: use the feed it announces.
    const found = /html/i.test(r.type) || /<html/i.test(r.text.slice(0, 2000)) ? P.discoverFeeds(r.text, r.url) : [];
    if (found.length) { const r2 = await getText(fetch, found[0].url, { ua }); feed = P.parseFeed(r2.text, r2.url); feed.movedTo = found[0].url; }
    else throw e;
  }
  return { ...feed, etag: r.etag, lastModified: r.lastModified };
}

/**
 * msg: { feeds: [{ id, url, type, category, etag, lastModified, seen, known }], recent: [{ id, title, summary, vec, cluster, date }], ua }
 * → { ok, results: [{ feedId, ok, error?, retryAfter?, notModified?, title, link, etag, lastModified, movedTo?, seen?, items: [...] }] }
 */
async function run(msg, fetch) {
  const feeds = (msg.feeds || []).slice(0, 40);
  const recent = (msg.recent || []).filter(r => r && r.vec);
  const results = new Array(feeds.length);
  // One request per site at a time, with a pause between them: a chain of promises per site.
  const chains = new Map();
  const viaHost = (host, fn) => {
    const prev = chains.get(host) || Promise.resolve(0);
    const run = prev.then(async lastEnd => { const wait = lastEnd + PER_HOST_GAP - Date.now(); if (lastEnd && wait > 0) await new Promise(r => setTimeout(r, wait)); try { await fn(); } finally { /* end time below */ } return Date.now(); });
    chains.set(host, run.catch(() => Date.now()));
    return run;
  };
  let next = 0;
  async function one(i) { const f = feeds[i]; await viaHost(hostOf(f.url), () => fetchOne(i)).catch(() => {}); }
  async function fetchOne(i) {
    const f = feeds[i];
    try {
      const got = await fetchFeed(fetch, f, msg.ua);
      if (got.notModified) results[i] = { feedId: f.id, ok: true, notModified: true, items: [] };
      else {
        const known = new Set(f.known || []);
        const items = [];
        for (const it of (got.items || []).slice(0, 100)) {
          if (!it.title && !it.text) continue;
          const key = it.id || it.link || it.title;
          const id = idOf(f.id, key);
          if (known.has(id)) continue;
          items.push({ id, feedId: f.id, title: (it.title || it.text.slice(0, 90)).replace(/\s+/g, ' ').trim().slice(0, 300), link: it.link, text: String(it.text || '').slice(0, 12000), image: it.image || '', author: String(it.author || '').slice(0, 120), date: it.date || 0, srcTags: it.categories || [] });
        }
        results[i] = { feedId: f.id, ok: true, title: got.title, link: got.link, etag: got.etag, lastModified: got.lastModified, movedTo: got.movedTo, seen: got.allLinks, items };
      }
    } catch (e) {
      results[i] = { feedId: f.id, ok: false, error: String(e && e.message || e).slice(0, 200), retryAfter: e && e.retryAfter, items: [] };
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, feeds.length) }, async () => { while (next < feeds.length) await one(next++); }));

  // Analyse the new items together with recent ones (word weights from all of them).
  const fresh = results.flatMap(r => (r && r.items) || []);
  const now = Date.now();
  const idf = N.makeIdf([...recent.map(r => N.tokens(`${r.title} ${r.summary || ''}`)), ...fresh.map(it => N.tokens(`${it.title} ${it.text.slice(0, 3000)}`))]);
  const catOf = new Map(feeds.map(f => [f.id, f.category || 'global']));
  for (const it of fresh) {
    it.added = now;
    if (!it.date || it.date > now + 3600e3) it.date = now;
    it.summary = N.summarize(it.title, it.text, 3, idf);
    it.tags = N.topicTags(it);
    it.category = N.itemCategory(catOf.get(it.feedId), it);
    it.vec = N.vectorize(it.title, it.text, idf);
  }
  fresh.sort((a, b) => a.date - b.date);
  N.assignClusters(fresh, recent);
  return { ok: true, results };
}

module.exports = { run, getText, articleText, fetchFeed };
