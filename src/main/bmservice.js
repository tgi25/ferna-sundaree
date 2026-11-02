'use strict';
// Bookmark manager services in the browser process: bulk operations with undo, link checking,
// duplicates, imports from every major browser, exports of a selection, the reading list,
// read status, and automatic JSON backups.

const fs = require('fs');
const path = require('path');
const BM = require('./bookmarks');
const T = require('./bmtools');

function create(ctx, { dataDir, saved }) {
  const items = () => ctx.bookmarks.data.items;
  const set = list => { ctx.bookmarks.data.items = list; };
  const undo = new Map(); // token → { removed, at }
  const backupDir = path.join(dataDir, 'bookmark-backups');
  const check = { running: false, done: 0, total: 0, dead: 0, errors: 0, cancel: false };

  function keepUndo(removed) {
    const token = `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    undo.set(token, { removed, at: Date.now() });
    for (const [k, v] of undo) if (undo.size > 10 || Date.now() - v.at > 10 * 60 * 1000) undo.delete(k);
    return token;
  }

  function data() {
    const list = items();
    const dupes = T.duplicates(list);
    return {
      items: list, roots: BM.ROOTS, tags: T.allTags(list), domains: T.domains(list).slice(0, 300),
      dupes, check: { ...check }, backups: listBackups(), settings: { keep: keepCount(), days: everyDays() },
    };
  }

  /** One bulk operation; returns { ok, count, token?, data }. */
  function bulk(op, a = {}) {
    const ids = Array.isArray(a.ids) ? a.ids.filter(x => typeof x === 'string').slice(0, 100000) : [];
    let count = 0, token;
    if (op === 'delete') {
      const r = T.bulkRemove(items(), ids);
      set(r.items);
      count = r.removed.filter(x => !BM.isFolder(x.n)).length;
      token = keepUndo(r.removed);
      return finish({ count, folders: r.removed.length - count, token });
    }
    if (op === 'undo') {
      const u = undo.get(a.token);
      if (!u) return finish({ ok: false });
      set(T.restore(items(), u.removed));
      undo.delete(a.token);
      return finish({ count: u.removed.length });
    }
    if (op === 'move') return finish({ count: T.bulkMove(items(), ids, String(a.parent || '')) });
    if (op === 'tag') return finish({ count: T.bulkTag(items(), ids, a.add || [], a.remove || []) });
    if (op === 'read') {
      for (const n of items()) if (ids.includes(n.id) && !BM.isFolder(n)) { if (a.read) n.visited = n.visited || Date.now(); else delete n.visited; count++; }
      return finish({ count });
    }
    if (op === 'renameTag') {
      const from = T.cleanTag(a.from).toLowerCase(), to = T.cleanTag(a.to);
      for (const n of items()) if ((n.tags || []).some(t => t.toLowerCase() === from)) {
        n.tags = n.tags.filter(t => t.toLowerCase() !== from);
        if (to && !n.tags.some(t => t.toLowerCase() === to.toLowerCase())) n.tags.push(to);
        if (!n.tags.length) delete n.tags;
        count++;
      }
      return finish({ count });
    }
    if (op === 'merge') {
      const groups = T.duplicates(items()).filter(g => !a.keys || a.keys.includes(g.key));
      const r = T.mergeDuplicates(items(), groups, a.keep || {});
      set(r.items);
      return finish({ count: r.merged, removedCount: r.removed.length, token: keepUndo(r.removed) });
    }
    if (op === 'purgeDead') {
      const dead = items().filter(n => n.check && n.check.s === 'dead').map(n => n.id);
      const r = T.bulkRemove(items(), dead);
      set(r.items);
      return finish({ count: r.removed.length, token: keepUndo(r.removed) });
    }
    return { ok: false };
  }
  function finish(r) { saved(); return { ok: r.ok !== false, ...r, data: data() }; }

  // ---------- link checker ----------
  async function probe(url) {
    const ses = ctx.webSession;
    const one = async method => {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 12000);
      try {
        const res = await ses.fetch(url, { method, redirect: 'follow', credentials: 'omit', signal: ac.signal, headers: method === 'GET' ? { range: 'bytes=0-0' } : {}, bypassCustomProtocolHandlers: true });
        try { if (res.body && res.body.cancel) res.body.cancel(); } catch { /* ignore */ }
        return { code: res.status };
      } catch (e) { return { error: String(e && (e.message || e)) }; } finally { clearTimeout(t); }
    };
    let r = await one('HEAD');
    if (r.error || [400, 403, 404, 405, 501].includes(r.code)) { const g = await one('GET'); if (!g.error || r.error) r = g; }
    return r;
  }

  async function runCheck(ids) {
    if (check.running) return { ...check };
    const targets = items().filter(n => !BM.isFolder(n) && /^https?:/i.test(n.url || '') && (!ids || ids.includes(n.id)));
    Object.assign(check, { running: true, done: 0, total: targets.length, dead: 0, errors: 0, cancel: false });
    ctx.broadcastBookmarks();
    let i = 0;
    const worker = async () => {
      while (!check.cancel && i < targets.length) {
        const n = targets[i++];
        const r = ctx.testProbe ? await ctx.testProbe(n.url) : await probe(n.url);
        const s = T.classify(r);
        n.check = { s, code: r.code || 0, err: r.error ? String(r.error).slice(0, 80) : undefined, at: Date.now() };
        if (s === 'dead') check.dead++;
        if (s === 'error') check.errors++;
        check.done++;
        if (check.done % 10 === 0) ctx.broadcastBookmarks();
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, targets.length || 1) }, worker));
    check.running = false;
    saved();
    ctx.broadcastBookmarks();
    return { ...check };
  }

  // ---------- exports / imports ----------
  function exportSel(ids, format) {
    const sel = Array.isArray(ids) && ids.length ? ids : null;
    return format === 'json' ? T.exportJson(items(), sel) : T.exportHtml(items(), sel);
  }
  function importAny(text) {
    const r = T.importAny(items(), text);
    saved();
    return r;
  }

  // ---------- reading list and read status ----------
  function addToReadingList(url, title) {
    if (!BM.okUrl(url)) return false;
    if (BM.children(items(), 'reading').some(n => n.url === url)) return true;
    BM.addBookmark(items(), { parent: 'reading', url, title });
    saved();
    return true;
  }
  let visitTimer = null;
  function markVisited(url) {
    if (!/^https?:/i.test(url || '')) return;
    const k = T.normalizeUrl(url);
    let hit = false;
    for (const n of items()) if (n.url && (n.url === url || T.normalizeUrl(n.url) === k)) { n.visited = Date.now(); hit = true; }
    if (hit && !visitTimer) visitTimer = setTimeout(() => { visitTimer = null; ctx.bookmarks.save(); }, 4000);
  }

  // ---------- backups ----------
  const keepCount = () => Math.max(1, Math.min(365, Number(ctx.settings.data.bookmarkBackupKeep) || 14));
  const everyDays = () => Math.max(0, Math.min(30, Number(ctx.settings.data.bookmarkBackupDays ?? 1)));
  function listBackups() {
    try {
      return fs.readdirSync(backupDir).filter(f => /^bookmarks-[\w-]+\.json$/.test(f)).sort().reverse()
        .map(f => { const st = fs.statSync(path.join(backupDir, f)); return { name: f, size: st.size, at: st.mtimeMs }; });
    } catch { return []; }
  }
  function backupNow(label) {
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
    const name = `bookmarks-${stamp}${label ? `-${label}` : ''}.json`;
    fs.writeFileSync(path.join(backupDir, name), T.exportJson(items(), null));
    const all = listBackups().filter(b => !/-before-restore\.json$/.test(b.name));
    for (const b of all.slice(keepCount())) { try { fs.unlinkSync(path.join(backupDir, b.name)); } catch { /* ignore */ } }
    ctx.settings.set('bookmarkLastBackup', Date.now());
    return name;
  }
  function autoBackup() {
    const days = everyDays();
    if (!days || !items().length) return null;
    if (Date.now() - (ctx.settings.data.bookmarkLastBackup || 0) < days * 86400000 - 60000) return null;
    try { return backupNow(); } catch { return null; }
  }
  function restoreBackup(name, mode) {
    if (!/^bookmarks-[\w-]+\.json$/.test(name)) return { ok: false };
    const obj = JSON.parse(fs.readFileSync(path.join(backupDir, name), 'utf8'));
    backupNow('before-restore');
    let added;
    if (mode === 'replace') { set([]); added = T.importFernaJson(items(), obj); } else added = T.importFernaJson(items(), obj);
    saved();
    return { ok: true, added };
  }
  setTimeout(autoBackup, 15000).unref?.();
  setInterval(autoBackup, 3600000).unref?.();

  return {
    data, bulk, runCheck, cancelCheck: () => { check.cancel = true; return true; }, checkState: () => ({ ...check }),
    exportSel, importAny, addToReadingList, markVisited, backupNow, autoBackup, listBackups, restoreBackup, backupDir,
  };
}

module.exports = { create };
