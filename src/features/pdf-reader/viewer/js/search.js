// Find in document.
import { svgEl, f } from './util.js';

export class Search {
  constructor(viewer) {
    this.viewer = viewer;
    this.cache = new Map();   // page index → {text, items:[{start,end,item}]}
    this.matches = [];
    this.cur = -1;
    this.token = 0;
    this.query = '';
  }

  reset() { this.cache.clear(); this.clear(); }

  async pageText(i) {
    if (this.cache.has(i)) return this.cache.get(i);
    const pv = this.viewer.pages[i];
    const tc = await pv.textRuns();   // cleaned runs (merged glyphs, repaired Sinhala)
    let text = '';
    const items = [];
    for (const it of tc.items) {
      if (typeof it.str !== 'string') continue;
      const start = text.length;
      text += it.str;
      items.push({ start, end: text.length, it });
      if (it.hasEOL) text += ' ';
    }
    const v = { text, items };
    this.cache.set(i, v);
    return v;
  }

  clear() {
    this.token++;
    this.matches = [];
    this.cur = -1;
    for (const pv of this.viewer.pages) pv.findGroup.replaceChildren();
  }

  // Runs the search progressively; onUpdate(count, done) is called as results arrive.
  async find(query, { caseSensitive = false } = {}, onUpdate) {
    this.clear();
    this.query = query;
    const token = this.token;
    if (!query.trim()) { onUpdate?.(0, true); return; }
    const norm = (s) => (caseSensitive ? s : s.toLowerCase());
    const q = fold(query.normalize('NFC').trim().replace(/\s+/g, ' '), norm).hay;
    const startPage = this.viewer.current;
    const n = this.viewer.pages.length;
    let firstJumped = false;
    for (let k = 0; k < n; k++) {
      const i = (startPage + k) % n;
      const { text, items } = await this.pageText(i);
      if (token !== this.token) return;
      const { hay, map } = fold(text, norm);
      let from = 0;
      const pageMatches = [];
      for (;;) {
        const at = hay.indexOf(q, from);
        if (at < 0) break;
        const s0 = map[at], s1 = map[at + q.length - 1] + 1;
        pageMatches.push({ page: i, start: s0, end: s1, rects: this._rects(items, s0, s1) });
        from = at + Math.max(1, q.length);
      }
      if (pageMatches.length) {
        this.matches.push(...pageMatches);
        this.matches.sort((a, b) => a.page - b.page || a.start - b.start);
        this._draw(i);
        if (!firstJumped) { firstJumped = true; this.go(this.matches.indexOf(pageMatches[0])); }
      }
      if (k % 10 === 9 || k === n - 1) onUpdate?.(this.matches.length, k === n - 1);
    }
    if (!this.matches.length) onUpdate?.(0, true);
  }

  _rects(items, s, e) {
    const out = [];
    for (const { start, end, it } of items) {
      if (end <= s || start >= e) continue;
      const len = Math.max(1, it.str.length);
      const i0 = Math.max(0, s - start) / len, i1 = Math.min(len, e - start) / len;
      const [a, b, c, d, x, y] = it.transform;
      const la = Math.hypot(a, b) || 1;
      const dir = [a / la, b / la];
      const fh = Math.hypot(c, d) || it.height || 10;
      const up = [-dir[1], dir[0]];
      const w = it.width || la * len * 0.5;
      const p0 = [x + dir[0] * w * i0, y + dir[1] * w * i0];
      const p1 = [x + dir[0] * w * i1, y + dir[1] * w * i1];
      const pts = [
        [p0[0] - up[0] * fh * 0.25, p0[1] - up[1] * fh * 0.25], [p1[0] - up[0] * fh * 0.25, p1[1] - up[1] * fh * 0.25],
        [p0[0] + up[0] * fh * 0.9, p0[1] + up[1] * fh * 0.9], [p1[0] + up[0] * fh * 0.9, p1[1] + up[1] * fh * 0.9]
      ];
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      out.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
    }
    return out;
  }

  _draw(page) {
    const pv = this.viewer.pages[page];
    pv.findGroup.replaceChildren();
    this.matches.forEach((m, idx) => {
      if (m.page !== page) return;
      for (const [x1, y1, x2, y2] of m.rects) {
        pv.findGroup.append(svgEl('rect', { class: 'fm' + (idx === this.cur ? ' cur' : ''), x: f(x1), y: f(y1), width: f(x2 - x1), height: f(y2 - y1), rx: 1 }));
      }
    });
  }

  go(idx) {
    if (!this.matches.length) return;
    const prev = this.matches[this.cur];
    this.cur = (idx + this.matches.length) % this.matches.length;
    const m = this.matches[this.cur];
    if (prev && prev.page !== m.page) this._draw(prev.page);
    this._draw(m.page);
    const r = m.rects[0];
    if (r) this.viewer.scrollToPoint(m.page, r[0], r[3], { center: true });
  }

  next() { this.go(this.cur + 1); }
  prev() { this.go(this.cur - 1); }
}

// Matching form: joiners removed (Sinhala ZWJ/ZWNJ), whitespace unified, NFC; map[i] = index in the original text.
function fold(text, norm) {
  let hay = '';
  const map = [];
  const src = text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\u200D' || c === '\u200C') continue;
    const o = /\s/.test(c) ? ' ' : norm(c);
    for (let k = 0; k < o.length; k++) { hay += o[k]; map.push(i); }
  }
  return { hay, map };
}
