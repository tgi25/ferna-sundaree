'use strict';
// Ferna Tabs 1.16 rules for the tabs list at the pointer, free of the page so they can be tested:
//   • rank()      — one ranked list of tabs and bookmarks for what you type: initials and gaps
//                   ("lec3" finds "Lecture 3"), a bonus where words start, a nudge for tabs used
//                   recently, open tabs a little ahead of bookmarks
//   • duplicates() — tabs showing the same page (query string and #part ignored)
//   • forgotten()  — tabs untouched for some days, oldest first
//   • parkedLabel() — "Parked 12 Nov"
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TabsMatch = api;
}(typeof self !== 'undefined' ? self : this, () => {
  const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const isWordStart = (t, i) => i === 0 || /[\s\-_/.:?#=&()[\]|,·–—]/.test(t[i - 1]) || (/[a-z]/.test(t[i - 1]) && /[0-9]/.test(t[i])) || (/[0-9]/.test(t[i - 1]) && /[a-z]/.test(t[i]));

  /**
   * How well text matches q (0 = not at all). Every character of q must appear in order.
   * Whole-word and word-start hits score most; long gaps score least.
   */
  function score(q, text) {
    q = norm(q).replace(/\s+/g, ' ').trim();
    const t = norm(text);
    if (!q || !t) return 0;
    // Plain substring: best when it starts a word.
    const at = t.indexOf(q);
    if (at >= 0) return 100 + (isWordStart(t, at) ? 40 : 0) + (at === 0 ? 20 : 0) - Math.min(20, at / 4) + Math.min(10, q.length);
    // Every word of q found (in any order): good.
    const words = q.split(' ').filter(Boolean);
    if (words.length > 1 && words.every(w => t.includes(w))) return 80 + words.filter(w => { const i = t.indexOf(w); return isWordStart(t, i); }).length * 5;
    // Characters in order (initials and gaps): "lec3" → "Lecture 3".
    const qs = q.replace(/ /g, '');
    let ti = 0, s = 0, run = 0, prev = -2;
    for (const ch of qs) {
      let found = -1;
      // Prefer the next character at a word start, then any.
      for (let k = ti; k < t.length; k++) if (t[k] === ch && isWordStart(t, k)) { found = k; break; }
      const plain = t.indexOf(ch, ti);
      if (found < 0 || (plain >= 0 && plain === prev + 1)) found = plain;
      if (found < 0) return 0;
      run = found === prev + 1 ? run + 1 : 0;
      s += 4 + (isWordStart(t, found) ? 6 : 0) + run * 3 - Math.min(4, (found - ti) / 8);
      prev = found; ti = found + 1;
    }
    return Math.max(1, Math.min(79, s));
  }

  /**
   * One ranked list for the query. tabs: [{ id, title, url, lastActive }], bookmarks:
   * [{ title, url }]. Returns [{ kind: 'tab'|'bm', item, score }], best first. Bookmarks of a
   * page already open are left out.
   */
  function rank(q, tabs, bookmarks = [], now = Date.now()) {
    const out = [];
    const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
    for (const t of tabs || []) {
      const s = Math.max(score(q, t.title), score(q, host(t.url)) * 0.9, score(q, t.url) * 0.6);
      if (!s) continue;
      const age = now - (t.lastActive || 0);
      const recent = age < 3600e3 ? 8 : age < 86400e3 ? 4 : 0; // a nudge for tabs used recently
      out.push({ kind: 'tab', item: t, score: s + recent });
    }
    const open = new Set((tabs || []).map(t => t.url));
    for (const b of bookmarks || []) {
      if (!b || !b.url || open.has(b.url)) continue;
      const s = Math.max(score(q, b.title), score(q, host(b.url)) * 0.9, score(q, b.url) * 0.6);
      if (s) out.push({ kind: 'bm', item: b, score: s - 6 });
    }
    return out.sort((a, b) => b.score - a.score);
  }

  /** The page a tab shows, for duplicates: no query string, no #part, no trailing slash. */
  function pageKey(url) {
    try { const u = new URL(url); if (!/^(https?|file):$/.test(u.protocol)) return ''; return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`.toLowerCase(); } catch { return ''; }
  }

  /**
   * Groups of tabs showing the same page: [{ key, keep, close: [tabs] }]. The tab in use (or the
   * most recently used) is kept.
   */
  function duplicates(tabs, activeId) {
    const by = new Map();
    for (const t of tabs || []) { const k = pageKey(t.url); if (!k) continue; if (!by.has(k)) by.set(k, []); by.get(k).push(t); }
    const out = [];
    for (const [key, list] of by) {
      if (list.length < 2) continue;
      const keep = list.find(t => t.id === activeId) || [...list].sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0))[0];
      out.push({ key, keep, close: list.filter(t => t !== keep) });
    }
    return out;
  }

  /** Tabs not used for `days` days (never the one in use), oldest first. */
  function forgotten(tabs, days, activeId, now = Date.now()) {
    const limit = now - days * 86400e3;
    return (tabs || []).filter(t => t.id !== activeId && t.lastActive && t.lastActive < limit).sort((a, b) => a.lastActive - b.lastActive);
  }

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function parkedLabel(ts) { const d = new Date(ts); return `Parked ${d.getDate()} ${MONTHS[d.getMonth()]}`; }

  // Settings of the list itself (its size, rows, font …), with their limits.
  const LIST_DEFAULTS = { width: 380, height: 520, rows: 'normal', font: '', fontSize: 13, icons: 16, position: 'pointer', pageRow: true, extensions: true, common: true, closed: true, offers: true, hints: true, forgetDays: 7 };
  const FONTS = ['', 'Segoe UI', 'Arial', 'Verdana', 'Tahoma', 'Calibri', 'Georgia', 'Cambria', 'Consolas', 'Iskoola Pota', 'Noto Sans Sinhala', 'Nirmala UI'];
  function cleanListSettings(v) {
    const o = { ...LIST_DEFAULTS };
    if (!v || typeof v !== 'object') return o;
    const n = (x, lo, hi, d) => (Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d);
    o.width = n(v.width, 300, 900, o.width);
    o.height = n(v.height, 280, 1000, o.height);
    o.rows = ['compact', 'normal', 'large'].includes(v.rows) ? v.rows : o.rows;
    o.font = FONTS.includes(v.font) ? v.font : '';
    o.fontSize = n(v.fontSize, 10, 22, o.fontSize);
    o.icons = [14, 16, 20, 24].includes(v.icons) ? v.icons : o.icons;
    o.position = ['pointer', 'center'].includes(v.position) ? v.position : o.position;
    for (const k of ['pageRow', 'extensions', 'common', 'closed', 'offers', 'hints']) if (typeof v[k] === 'boolean') o[k] = v[k];
    o.forgetDays = [1, 3, 7, 14, 30].includes(v.forgetDays) ? v.forgetDays : o.forgetDays;
    return o;
  }

  return { score, rank, pageKey, duplicates, forgotten, parkedLabel, LIST_DEFAULTS, FONTS, cleanListSettings };
}));
