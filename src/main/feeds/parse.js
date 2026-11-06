'use strict';
// Feed and page parsing without a DOM (it runs in the background process): RSS 2.0, RSS 1.0
// (RDF), Atom and JSON Feed; OPML import/export; feed discovery in HTML; a scraping fallback for
// sites without a feed (article links and their titles); and page metadata (title, description,
// date, image). Everything returned is plain text or http(s) URLs.

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', reg: '®', trade: '™', middot: '·', bull: '•' };
function decode(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; } catch { return ''; } }
    return ENT[e.toLowerCase()] !== undefined ? ENT[e.toLowerCase()] : m;
  });
}
const unCdata = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
/** HTML → plain text (scripts, styles and tags removed; paragraphs kept as line breaks). */
function htmlToText(html) {
  return decode(String(html || '')
    .replace(/<(script|style|noscript|template|svg|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|br|tr|blockquote|section|article)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t ]+/g, ' ').replace(/\n\s*/g, '\n').replace(/\n{2,}/g, '\n').trim();
}
function safeUrl(u, base) {
  try { const x = new URL(decode(String(u || '').trim()), base || undefined); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; }
}
function attr(tag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? decode(m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4]) : '';
}
/** Inner XML of the first <tag> (namespaced names like dc:date work), or ''. */
function child(xml, tag) {
  const t = tag.replace(':', '\\:');
  const m = new RegExp(`<${t}(\\s[^>]*)?(?:/>|>([\\s\\S]*?)</${t}\\s*>)`, 'i').exec(xml);
  return m ? (m[2] || '') : '';
}
function childTag(xml, tag) { const m = new RegExp(`<${tag.replace(':', '\\:')}(\\s[^>]*)?/?>`, 'i').exec(xml); return m ? m[0] : ''; }
function blocks(xml, tag) {
  const out = [], re = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}\\s*>`, 'gi');
  let m; while ((m = re.exec(xml)) && out.length < 500) out.push(m[0]);
  return out;
}
const textOf = s => htmlToText(unCdata(s));
function dateOf(s) { const t = Date.parse(String(s || '').trim()); return Number.isFinite(t) ? t : 0; }

/** Parse a feed document (XML or JSON Feed). Returns { title, link, items: [{ id, title, link, text, html, date, author, image, categories }] } or throws. */
function parseFeed(body, feedUrl) {
  const src = String(body || '').replace(/^﻿/, '').trim();
  if (src.startsWith('{')) {
    const j = JSON.parse(src);
    if (!Array.isArray(j.items)) throw new Error('not a JSON Feed');
    return {
      title: String(j.title || ''), link: safeUrl(j.home_page_url, feedUrl),
      items: j.items.slice(0, 300).map(it => ({ id: String(it.id || it.url || ''), title: String(it.title || '').trim(), link: safeUrl(it.url || it.external_url, feedUrl), html: String(it.content_html || ''), text: String(it.content_text || it.summary || '') || htmlToText(it.content_html || ''), date: dateOf(it.date_published || it.date_modified), author: String((it.authors && it.authors[0] && it.authors[0].name) || (it.author && it.author.name) || ''), image: safeUrl(it.image || it.banner_image, feedUrl), categories: Array.isArray(it.tags) ? it.tags.map(String).slice(0, 10) : [] })),
    };
  }
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(src)) throw new Error('not a feed (no <rss>, <feed> or <rdf:RDF>)');
  const isAtom = /<feed[\s>]/i.test(src) && !/<rss[\s>]/i.test(src);
  if (isAtom) {
    const head = src.split(/<entry[\s>]/i)[0];
    const altLink = h => { const links = (h.match(/<link\b[^>]*>/gi) || []); const alt = links.find(l => !/rel=/i.test(l) || /rel=["']?alternate/i.test(l)) || links[0] || ''; return attr(alt, 'href'); };
    return {
      title: textOf(child(head, 'title')), link: safeUrl(altLink(head), feedUrl),
      items: blocks(src, 'entry').map(e => {
        const html = unCdata(child(e, 'content') || child(e, 'summary'));
        const media = childTag(e, 'media:thumbnail') || childTag(e, 'media:content');
        return { id: textOf(child(e, 'id')), title: textOf(child(e, 'title')), link: safeUrl(altLink(e), feedUrl), html, text: htmlToText(html), date: dateOf(child(e, 'published') || child(e, 'updated')), author: textOf(child(child(e, 'author'), 'name')), image: safeUrl(attr(media, 'url'), feedUrl), categories: (e.match(/<category\b[^>]*>/gi) || []).map(c => attr(c, 'term') || attr(c, 'label')).filter(Boolean).slice(0, 10) };
      }),
    };
  }
  const chan = child(src, 'channel') || src;
  const head = chan.split(/<item[\s>]/i)[0];
  return {
    title: textOf(child(head, 'title')), link: safeUrl(textOf(child(head, 'link')), feedUrl),
    items: blocks(src, 'item').map(e => {
      const html = unCdata(child(e, 'content:encoded') || child(e, 'description'));
      const enc = childTag(e, 'enclosure'), media = childTag(e, 'media:thumbnail') || childTag(e, 'media:content');
      const img = /image\//i.test(attr(enc, 'type')) ? attr(enc, 'url') : attr(media, 'url') || ((/<img[^>]+src=["']([^"']+)/i.exec(html) || [])[1] || '');
      const link = textOf(child(e, 'link')) || attr(childTag(e, 'link'), 'href') || (/^https?:/i.test(textOf(child(e, 'guid'))) ? textOf(child(e, 'guid')) : '');
      return { id: textOf(child(e, 'guid')) || link, title: textOf(child(e, 'title')), link: safeUrl(link, feedUrl), html, text: htmlToText(html), date: dateOf(child(e, 'pubDate') || child(e, 'dc:date') || child(e, 'published')), author: textOf(child(e, 'dc:creator') || child(e, 'author')), image: safeUrl(img, feedUrl), categories: blocks(e, 'category').map(c => textOf(c.replace(/^<category[^>]*>|<\/category>$/gi, ''))).filter(Boolean).slice(0, 10) };
    }),
  };
}

/** Feeds a page announces: <link rel="alternate" type="application/rss+xml|atom+xml|feed+json">. */
function discoverFeeds(html, pageUrl) {
  const out = [];
  for (const tag of String(html || '').match(/<link\b[^>]*>/gi) || []) {
    if (!/rel\s*=\s*["']?[^"'>]*alternate/i.test(tag)) continue;
    const type = attr(tag, 'type').toLowerCase();
    if (!/(rss|atom|feed)\+(xml|json)|application\/feed\+json|text\/xml/.test(type)) continue;
    const url = safeUrl(attr(tag, 'href'), pageUrl);
    if (url && !out.some(f => f.url === url)) out.push({ url, title: attr(tag, 'title') || '', type });
  }
  return out.slice(0, 12);
}

/** Title, description, date, image and canonical address of an HTML page (meta and Open Graph tags). */
function pageMeta(html, pageUrl) {
  const metas = String(html || '').match(/<meta\b[^>]*>/gi) || [];
  const meta = (...names) => { for (const n of names) { const t = metas.find(m => new RegExp(`(?:property|name|itemprop)\\s*=\\s*["']${n.replace(':', '\\:')}["']`, 'i').test(m)); if (t) return attr(t, 'content'); } return ''; };
  const canon = (String(html).match(/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i) || [''])[0];
  return {
    title: (meta('og:title', 'twitter:title') || textOf(child(String(html), 'title'))).trim(),
    description: meta('og:description', 'description', 'twitter:description').trim(),
    date: dateOf(meta('article:published_time', 'datePublished', 'date', 'pubdate', 'og:updated_time')),
    image: safeUrl(meta('og:image', 'twitter:image'), pageUrl),
    url: safeUrl(attr(canon, 'href'), pageUrl) || pageUrl,
    site: meta('og:site_name'),
  };
}

/**
 * Scraping fallback for pages without a feed: the page's article links. Keeps same-site links
 * whose address looks like an article (dated or long, hyphenated paths) and whose link text reads
 * like a headline; drops navigation, tags, authors, log-in and share links.
 */
function scrapeLinks(html, pageUrl) {
  let host;
  try { host = new URL(pageUrl).hostname.replace(/^www\./, ''); } catch { return []; }
  const body = String(html || '').replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ').replace(/<(nav|footer|header)\b[\s\S]*?<\/\1>/gi, ' ');
  const out = [], seen = new Set();
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(body)) && out.length < 60) {
    const url = safeUrl(attr(m[1], 'href'), pageUrl);
    if (!url) continue;
    let u; try { u = new URL(url); } catch { continue; }
    if (u.hostname.replace(/^www\./, '') !== host) continue;
    const p = u.pathname;
    if (p === '/' || /\/(tag|tags|category|categories|author|authors|page|search|login|signin|register|subscribe|about|contact|privacy|terms|feed|rss)(\/|$)/i.test(p)) continue;
    if (/\.(jpg|jpeg|png|gif|pdf|zip|mp3|mp4)$/i.test(p)) continue;
    const looksArticle = /\/\d{4}\/\d{1,2}\//.test(p) || /\d{5,}/.test(p) || (p.split('/').pop() || '').split('-').length >= 4 || p.split('/').filter(Boolean).length >= 3;
    const title = htmlToText(m[2]).replace(/\s+/g, ' ').trim();
    if (!looksArticle || title.length < 25 || title.length > 220) continue;
    const key = u.origin + u.pathname;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ link: u.href.split('#')[0], title });
  }
  return out;
}

// ---------- OPML ----------
function parseOpml(xml) {
  const out = [];
  let cat = '';
  const re = /<outline\b([^>]*?)(\/?)>|<\/outline>/gi;
  const stack = [];
  let m;
  while ((m = re.exec(String(xml || '')))) {
    if (m[0].startsWith('</')) { stack.pop(); cat = stack.filter(Boolean).pop() || ''; continue; }
    const a = m[1];
    const url = safeUrl(attr(a, 'xmlUrl'));
    const title = attr(a, 'title') || attr(a, 'text');
    if (url) out.push({ url, title, category: attr(a, 'category') || cat, site: safeUrl(attr(a, 'htmlUrl')) });
    else if (!m[2]) { stack.push(title); cat = title; }
  }
  return out.slice(0, 2000);
}
const xmlEsc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function buildOpml(feeds, title = 'Ferna Sundaree feeds') {
  const byCat = new Map();
  for (const f of feeds) { const c = f.category || 'Other'; if (!byCat.has(c)) byCat.set(c, []); byCat.get(c).push(f); }
  let body = '';
  for (const [c, list] of byCat) {
    body += `    <outline text="${xmlEsc(c)}" title="${xmlEsc(c)}">\n`;
    for (const f of list) body += `      <outline type="rss" text="${xmlEsc(f.title || f.url)}" title="${xmlEsc(f.title || f.url)}" xmlUrl="${xmlEsc(f.url)}"${f.site ? ` htmlUrl="${xmlEsc(f.site)}"` : ''}/>\n`;
    body += '    </outline>\n';
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>${xmlEsc(title)}</title><dateCreated>${new Date().toUTCString()}</dateCreated></head>\n  <body>\n${body}  </body>\n</opml>\n`;
}

module.exports = { parseFeed, discoverFeeds, pageMeta, scrapeLinks, parseOpml, buildOpml, htmlToText, decode, safeUrl };
