'use strict';
// Bookmark manager tools that work on many bookmarks at once. Pure functions on the flat
// bookmark array of bookmarks.js (nodes keep their order; folders are nodes with type 'folder').
//   bulk delete with undo, bulk move, bulk tags, export of a selection (JSON / HTML),
//   duplicate detection and merging, imports from Chrome / Edge / Brave (Bookmarks JSON),
//   Firefox (backup JSON) and Ferna (JSON), and the filter used by the manager.
// Extra fields a bookmark may carry: tags: string[], visited: ms, check: { s, code, at }.

const BM = require('./bookmarks');

const MAX_TAGS = 30;
const cleanTag = t => String(t || '').trim().replace(/\s+/g, ' ').replace(/^#/, '').slice(0, 40);

/** Ids plus everything inside any selected folder. */
function expand(items, ids) {
  const out = new Set();
  for (const id of ids) for (const x of BM.subtree(items, id)) out.add(x);
  return out;
}

/**
 * Delete many nodes. Returns { items, removed } where removed keeps each node with its index
 * so restore() can put everything back exactly where it was.
 */
function bulkRemove(items, ids) {
  const gone = expand(items, ids);
  const removed = [];
  const kept = [];
  items.forEach((n, i) => { if (gone.has(n.id)) removed.push({ i, n }); else kept.push(n); });
  return { items: kept, removed };
}

/** Undo of bulkRemove: re-insert at the original positions (skipping ids that came back). */
function restore(items, removed) {
  const out = items.slice();
  const have = new Set(out.map(n => n.id));
  for (const { i, n } of [...removed].sort((a, b) => a.i - b.i)) {
    if (have.has(n.id)) continue;
    out.splice(Math.min(i, out.length), 0, n);
    have.add(n.id);
  }
  return BM.repair(out);
}

/** Move many nodes into one folder, keeping their relative order. Folders never go into themselves. */
function bulkMove(items, ids, parent) {
  if (!(parent in BM.ROOTS) && !BM.isFolder(BM.byId(items, parent))) return 0;
  let moved = 0;
  const order = items.filter(n => ids.includes(n.id)).map(n => n.id);
  for (const id of order) {
    const n = BM.byId(items, id);
    if (!n || n.folder === parent) continue;
    // Skip a node whose ancestor is also being moved: it travels with its folder.
    let anc = n.folder, inside = false;
    for (let g = 0; g < 64 && anc && !(anc in BM.ROOTS); g++) { if (order.includes(anc)) { inside = true; break; } const p = BM.byId(items, anc); anc = p ? p.folder : null; }
    if (inside) continue;
    if (BM.move(items, id, parent)) moved++;
  }
  return moved;
}

/** Add and/or remove tags on many bookmarks. Returns the number changed. */
function bulkTag(items, ids, add = [], remove = []) {
  const plus = [...new Set(add.map(cleanTag).filter(Boolean))];
  const minus = new Set(remove.map(t => cleanTag(t).toLowerCase()));
  let n = 0;
  for (const node of items) {
    if (!ids.includes(node.id) || BM.isFolder(node)) continue;
    const before = JSON.stringify(node.tags || []);
    let tags = (node.tags || []).filter(t => !minus.has(t.toLowerCase()));
    for (const t of plus) if (!tags.some(x => x.toLowerCase() === t.toLowerCase())) tags.push(t);
    tags = tags.slice(0, MAX_TAGS);
    if (tags.length) node.tags = tags; else delete node.tags;
    if (JSON.stringify(node.tags || []) !== before) n++;
  }
  return n;
}

function allTags(items) {
  const m = new Map();
  for (const n of items) for (const t of n.tags || []) { const k = t.toLowerCase(); const e = m.get(k) || { tag: t, count: 0 }; e.count++; m.set(k, e); }
  return [...m.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** A selection plus the folders above it, so an export keeps where things were. */
function withAncestors(items, ids) {
  const keep = expand(items, ids);
  for (const id of [...keep]) {
    let n = BM.byId(items, id);
    for (let g = 0; g < 64 && n && !(n.folder in BM.ROOTS); g++) { keep.add(n.folder); n = BM.byId(items, n.folder); }
  }
  return items.filter(n => keep.has(n.id));
}

function exportJson(items, ids) {
  const list = ids ? withAncestors(items, ids) : items;
  const pick = n => BM.isFolder(n)
    ? { id: n.id, type: 'folder', title: n.title, folder: n.folder, ts: n.ts }
    : { id: n.id, url: n.url, title: n.title, folder: n.folder, ts: n.ts, ...(n.tags ? { tags: n.tags } : {}), ...(n.visited ? { visited: n.visited } : {}) };
  return JSON.stringify({ format: 'ferna-bookmarks', version: 1, exported: new Date().toISOString(), roots: BM.ROOTS, items: list.map(pick) }, null, 2);
}

function exportHtml(items, ids) {
  return BM.exportHtml(ids ? withAncestors(items, ids) : items);
}

// ---------- duplicates ----------

/** Same page: scheme, "www.", trailing slash, default ports, empty fragments and case of the host ignored. */
function normalizeUrl(u) {
  try {
    const x = new URL(u);
    if (!/^https?:$/.test(x.protocol)) return u;
    let host = x.hostname.toLowerCase().replace(/^www\./, '');
    const port = x.port && !['80', '443'].includes(x.port) ? `:${x.port}` : '';
    let p = x.pathname.replace(/\/+$/, '') || '';
    const params = [...x.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
    const q = params.length ? `?${params.map(([k, v]) => `${k}=${v}`).join('&')}` : '';
    const h = x.hash && x.hash !== '#' ? x.hash : '';
    return `${host}${port}${p}${q}${h}`;
  } catch { return u; }
}

/** Groups of bookmarks that point to the same page: [{ key, ids: [...] }] (oldest first). */
function duplicates(items) {
  const m = new Map();
  for (const n of items) {
    if (BM.isFolder(n) || !n.url) continue;
    const k = normalizeUrl(n.url);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(n);
  }
  return [...m.entries()].filter(([, v]) => v.length > 1)
    .map(([key, v]) => ({ key, ids: v.sort((a, b) => (a.ts || 0) - (b.ts || 0)).map(n => n.id) }));
}

/**
 * Merge each group into one bookmark: keeps `keep` (default the oldest), gives it the union
 * of tags and the latest visit, removes the others. Returns { items, removed, merged }.
 */
function mergeDuplicates(items, groups, keepIds = {}) {
  const drop = [];
  let merged = 0;
  for (const g of groups) {
    const nodes = g.ids.map(id => BM.byId(items, id)).filter(Boolean);
    if (nodes.length < 2) continue;
    const keep = nodes.find(n => n.id === keepIds[g.key]) || nodes[0];
    const tags = [];
    for (const n of nodes) for (const t of n.tags || []) if (!tags.some(x => x.toLowerCase() === t.toLowerCase())) tags.push(t);
    if (tags.length) keep.tags = tags.slice(0, MAX_TAGS);
    const visited = Math.max(0, ...nodes.map(n => n.visited || 0));
    if (visited) keep.visited = visited;
    for (const n of nodes) if (n !== keep) drop.push(n.id);
    merged++;
  }
  const r = bulkRemove(items, drop);
  return { items: r.items, removed: r.removed, merged };
}

// ---------- filtering (the manager's search and side filters) ----------

/**
 * f: { q, folder (id, searched with sub-folders), tags: [..] (all must match), domain,
 *      from, to (ms, added), read: 'read'|'unread', status: 'dead'|'error'|'unchecked', dupes: Set }
 */
function filter(items, f = {}) {
  const terms = String(f.q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const inFolder = f.folder ? BM.subtree(items, f.folder) : null;
  const want = (f.tags || []).map(t => t.toLowerCase());
  const dom = String(f.domain || '').toLowerCase().replace(/^www\./, '');
  return items.filter(n => {
    if (BM.isFolder(n)) return false;
    if (inFolder && !inFolder.has(n.id) && n.folder !== f.folder) return false;
    if (terms.length) {
      const hay = `${n.title || ''} ${n.url || ''} ${(n.tags || []).join(' ')}`.toLowerCase();
      if (!terms.every(t => hay.includes(t))) return false;
    }
    if (want.length && !want.every(t => (n.tags || []).some(x => x.toLowerCase() === t))) return false;
    if (dom) { let h = ''; try { h = new URL(n.url).hostname.toLowerCase().replace(/^www\./, ''); } catch { /* none */ } if (h !== dom && !h.endsWith(`.${dom}`)) return false; }
    if (f.from && (n.ts || 0) < f.from) return false;
    if (f.to && (n.ts || 0) > f.to) return false;
    if (f.read === 'read' && !n.visited) return false;
    if (f.read === 'unread' && n.visited) return false;
    if (f.status === 'dead' && !(n.check && n.check.s === 'dead')) return false;
    if (f.status === 'error' && !(n.check && n.check.s === 'error')) return false;
    if (f.status === 'unchecked' && n.check) return false;
    if (f.dupes && !f.dupes.has(n.id)) return false;
    return true;
  });
}

function domains(items) {
  const m = new Map();
  for (const n of items) { if (!n.url) continue; let h = ''; try { h = new URL(n.url).hostname.replace(/^www\./, ''); } catch { continue; } if (h) m.set(h, (m.get(h) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([domain, count]) => ({ domain, count }));
}

// ---------- imports ----------

/** Chrome, Edge, Brave, Vivaldi, Opera: the "Bookmarks" JSON file in the browser profile. */
function importChromeJson(items, obj) {
  const roots = obj && obj.roots;
  if (!roots || typeof roots !== 'object') throw new Error('Not a Chromium bookmarks file');
  let added = 0;
  const walk = (node, parent) => {
    for (const c of node.children || []) {
      if (c.type === 'folder') {
        const existing = BM.children(items, parent).find(n => BM.isFolder(n) && n.title === c.name);
        const f = existing || BM.addFolder(items, { parent, title: c.name });
        walk(c, f.id);
      } else if (c.type === 'url' && BM.okUrl(c.url) && !/^ferna:/i.test(c.url)) {
        if (BM.children(items, parent).some(n => n.url === c.url)) continue;
        const b = BM.addBookmark(items, { parent, url: c.url, title: c.name || c.url });
        // date_added is microseconds since 1601-01-01.
        const t = Number(c.date_added);
        if (b && t > 0) b.ts = Math.round(t / 1000 - 11644473600000);
        if (b) added++;
      }
    }
  };
  if (roots.bookmark_bar) walk(roots.bookmark_bar, 'bar');
  for (const k of ['other', 'synced']) if (roots[k]) walk(roots[k], 'other');
  return added;
}

/** Firefox: Bookmarks → Manage bookmarks → Import and Backup → Backup… (.json). */
function importFirefoxJson(items, obj) {
  if (!obj || obj.type !== 'text/x-moz-place-container') throw new Error('Not a Firefox bookmarks backup');
  let added = 0;
  const rootFor = c => c.root === 'toolbarFolder' ? 'bar' : null;
  const walk = (node, parent) => {
    for (const c of node.children || []) {
      if (c.type === 'text/x-moz-place-container') {
        const r = rootFor(c);
        if (r) { walk(c, r); continue; }
        if (c.root === 'menuFolder' || c.root === 'unfiledBookmarksFolder' || c.root === 'mobileFolder') { walk(c, 'other'); continue; }
        if (c.root === 'tagsFolder') continue;
        const existing = BM.children(items, parent).find(n => BM.isFolder(n) && n.title === c.title);
        const f = existing || BM.addFolder(items, { parent, title: c.title || 'Folder' });
        walk(c, f.id);
      } else if (c.type === 'text/x-moz-place' && BM.okUrl(c.uri) && !/^(place|ferna):/i.test(c.uri)) {
        if (BM.children(items, parent).some(n => n.url === c.uri)) continue;
        const b = BM.addBookmark(items, { parent, url: c.uri, title: c.title || c.uri });
        if (b && c.dateAdded) b.ts = Math.round(Number(c.dateAdded) / 1000);
        if (b && c.tags) b.tags = String(c.tags).split(',').map(cleanTag).filter(Boolean).slice(0, MAX_TAGS);
        if (b) added++;
      }
    }
  };
  walk(obj, 'other');
  return added;
}

/** Ferna's own JSON (exports and backups). Keeps folders, tags and visits; ids are renewed. */
function importFernaJson(items, obj) {
  if (!obj || obj.format !== 'ferna-bookmarks' || !Array.isArray(obj.items)) throw new Error('Not a Ferna bookmarks file');
  const map = { bar: 'bar', other: 'other', reading: 'reading' };
  let added = 0;
  for (const n of obj.items) {
    if (!n || typeof n.id !== 'string') continue;
    const parent = map[n.folder] || 'other';
    if (n.type === 'folder') {
      const existing = BM.children(items, parent).find(x => BM.isFolder(x) && x.title === n.title);
      map[n.id] = (existing || BM.addFolder(items, { parent, title: n.title })).id;
    } else if (BM.okUrl(n.url) && !/^ferna:/i.test(n.url)) {
      if (BM.children(items, parent).some(x => x.url === n.url)) continue;
      const b = BM.addBookmark(items, { parent, url: n.url, title: n.title });
      if (!b) continue;
      if (Number.isFinite(n.ts)) b.ts = n.ts;
      if (Array.isArray(n.tags)) b.tags = n.tags.map(cleanTag).filter(Boolean).slice(0, MAX_TAGS);
      if (Number.isFinite(n.visited)) b.visited = n.visited;
      added++;
    }
  }
  return added;
}

/** Any supported file: HTML (Chrome, Edge, Firefox, Safari, Brave exports) or one of the JSON formats. */
function importAny(items, text) {
  const t = String(text || '').trim();
  if (t.startsWith('{')) {
    let obj;
    try { obj = JSON.parse(t); } catch { throw new Error('This JSON file could not be read'); }
    if (obj.format === 'ferna-bookmarks') return { added: importFernaJson(items, obj), kind: 'Ferna' };
    if (obj.roots) return { added: importChromeJson(items, obj), kind: 'Chrome / Edge / Brave' };
    if (obj.type === 'text/x-moz-place-container') return { added: importFirefoxJson(items, obj), kind: 'Firefox' };
    throw new Error('Unknown bookmarks JSON');
  }
  if (/<dl|<a\s/i.test(t)) return { added: BM.importHtml(items, t), kind: 'HTML' };
  throw new Error('Not a bookmarks file');
}

/** Classify a link check result. */
function classify(res) {
  if (!res) return 'error';
  if (res.error) return /NAME_NOT_RESOLVED|ENOTFOUND|NAME_RESOLUTION_FAILED|ADDRESS_UNREACHABLE|EAI_AGAIN/i.test(res.error) ? 'dead' : 'error';
  const c = res.code;
  if (c >= 200 && c < 400) return 'ok';
  if (c === 404 || c === 410) return 'dead';
  if (c === 401 || c === 403 || c === 405 || c === 429) return 'ok'; // there, just not for robots
  return 'error';
}

module.exports = {
  expand, bulkRemove, restore, bulkMove, bulkTag, allTags, cleanTag, withAncestors, exportJson, exportHtml,
  normalizeUrl, duplicates, mergeDuplicates, filter, domains,
  importChromeJson, importFirefoxJson, importFernaJson, importAny, classify,
};
