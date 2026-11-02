import { SI_RE, SI_STOP, siStem } from './sinhala.js';

// Document text model shared by reference popups, Auto-Bookmark and the AI features.
// Turns pdf.js text items into lines (with font size and position), paragraphs and retrieval chunks.

const norm = (s) => s.replace(/\s+/g, ' ').trim();

export class DocText {
  constructor(viewer) {
    this.viewer = viewer;
    this.lineCache = new Map();
    this._furniture = null;
  }

  reset() { this.lineCache.clear(); this._furniture = null; this._chunks = null; this._lang = null; }

  get numPages() { return this.viewer.pages.length; }

  // Lines of one page: [{text, size, x, x2, y, top, bottom, page}] top-to-bottom (PDF units)
  async pageLines(i) {
    if (this.lineCache.has(i)) return this.lineCache.get(i);
    const pv = this.viewer.pages[i];
    const tc = await pv.textRuns();   // merged glyph runs, repaired Sinhala
    const items = [];
    for (const it of tc.items) {
      if (typeof it.str !== 'string' || !it.str.length) continue;
      const [a, b, c, d, e, f] = it.transform;
      const size = Math.hypot(c, d) || Math.abs(d) || it.height || 10;
      const horizontal = Math.abs(b) < 0.01 * Math.abs(a || 1);
      items.push({ str: it.str, size, x: e, y: f, w: it.width || 0, horizontal, eol: it.hasEOL });
    }
    // group horizontal items into lines by baseline, then order each line left to right
    const hz = items.filter((t) => t.horizontal && t.str.trim()).sort((p, q) => q.y - p.y);
    const groups = [];
    for (const t of hz) {
      const G = groups[groups.length - 1];
      if (G && Math.abs(G.y - t.y) < Math.min(G.size, t.size) * 0.45) { G.items.push(t); G.size = Math.max(G.size, t.size); }
      else groups.push({ y: t.y, size: t.size, items: [t] });
    }
    const lines = [];
    for (const G of groups) {
      G.items.sort((p, q) => p.x - q.x);
      // split a group into separate lines where there is a wide horizontal gap (two-column layouts)
      let L = null;
      for (const t of G.items) {
        const gap = L ? t.x - L.x2 : 0;
        if (L && gap < t.size * 3) {
          const needSpace = gap > t.size * 0.18 && !L.text.endsWith(' ') && !t.str.startsWith(' ');
          L.text += (needSpace ? ' ' : '') + t.str;
          L.x2 = Math.max(L.x2, t.x + t.w);
          L.size = Math.max(L.size, t.size);
          L.chars += t.str.length;
          L.sizeWeighted += t.size * t.str.length;
        } else {
          L = { text: t.str, x: t.x, x2: t.x + t.w, y: G.y, size: t.size, chars: t.str.length, sizeWeighted: t.size * t.str.length, page: i };
          lines.push(L);
        }
      }
    }
    // two-column pages: read the left column first, then the right one
    const pvW = pv.rawW, midX = pv.x0 + pvW / 2;
    const left = lines.filter((l) => l.x2 <= midX + 5), right = lines.filter((l) => l.x >= midX - 5);
    if (left.length > 8 && right.length > 8 && left.length + right.length >= lines.length * 0.8) {
      const full = lines.filter((l) => !left.includes(l) && !right.includes(l));
      const topFull = full.filter((l) => l.y > Math.max(...left.map((x) => x.y), ...right.map((x) => x.y)));
      const rest = full.filter((l) => !topFull.includes(l));
      lines.splice(0, lines.length, ...topFull, ...left, ...right, ...rest);
    }
    for (const L of lines) {
      L.text = norm(L.text);
      L.avgSize = L.sizeWeighted / Math.max(1, L.chars);
      L.top = L.y + L.size * 0.8;
      L.bottom = L.y - L.size * 0.25;
    }
    // vertical text (rotated items) becomes separate lines at the end
    for (const t of items.filter((t) => !t.horizontal && t.str.trim())) {
      lines.push({ text: norm(t.str), x: t.x, x2: t.x + t.size, y: t.y, size: t.size, avgSize: t.size, top: t.y + t.w, bottom: t.y, chars: t.str.length, page: i, vertical: true });
    }
    const out = lines.filter((l) => l.text);
    this.lineCache.set(i, out);
    return out;
  }

  // Physical rows of a page (grouped by baseline only, not split into columns) — for tables of contents.
  async rowLines(i) {
    const pv = this.viewer.pages[i];
    const tc = await pv.textRuns();
    const its = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const [a, b, c, d, e, f] = it.transform;
      if (Math.abs(b) > 0.01 * Math.abs(a || 1)) continue;
      its.push({ str: it.str, x: e, x2: e + (it.width || 0), y: f, size: Math.hypot(c, d) || it.height || 10 });
    }
    its.sort((p, q) => q.y - p.y);
    const rows = [];
    for (const t of its) {
      const R = rows[rows.length - 1];
      if (R && Math.abs(R.y - t.y) < Math.min(R.size, t.size) * 0.45) { R.items.push(t); R.size = Math.max(R.size, t.size); } else rows.push({ y: t.y, size: t.size, items: [t] });
    }
    return rows.map((R) => {
      R.items.sort((p, q) => p.x - q.x);
      return { text: norm(R.items.map((t) => t.str).join(' ')), x: R.items[0].x, x2: Math.max(...R.items.map((t) => t.x2)), y: R.y, top: R.y + R.size * 0.8, size: R.size, page: i };
    });
  }

  // Running headers/footers and page numbers: text repeated at the same height on many pages.
  async furniture() {
    if (this._furniture) return this._furniture;
    const n = this.numPages;
    const sample = [];
    const step = Math.max(1, Math.floor(n / 40));
    for (let i = 0; i < n; i += step) sample.push(i);
    const counts = new Map();
    for (const i of sample) {
      const lines = await this.pageLines(i);
      const seen = new Set();
      const pv = this.viewer.pages[i];
      for (const l of lines) {
        if (!this._inMargin(l, pv)) continue;
        const key = Math.round(l.y / 4) + '|' + l.text.replace(/\d+/g, '#').toLowerCase().slice(0, 60);
        if (!seen.has(key)) { seen.add(key); counts.set(key, (counts.get(key) || 0) + 1); }
      }
    }
    const min = Math.max(3, Math.ceil(sample.length * 0.3));
    this._furniture = new Set([...counts].filter(([, c]) => c >= min).map(([k]) => k));
    return this._furniture;
  }

  // running headers/footers live in the top or bottom 12 % of the page
  _inMargin(l, pv) {
    if (!pv) return true;
    const rel = (l.y - pv.y0) / pv.rawH;
    return rel > 0.88 || rel < 0.12;
  }

  isFurniture(l, set) {
    if (!this._inMargin(l, this.viewer.pages[l.page])) return false;
    if (/^\s*(page\s*)?\d{1,4}(\s*(of|\/)\s*\d+)?\s*$/i.test(l.text)) return true;
    return set.has(Math.round(l.y / 4) + '|' + l.text.replace(/\d+/g, '#').toLowerCase().slice(0, 60));
  }

  // Plain text of a page (furniture removed, paragraphs joined, hyphenation repaired)
  async pageText(i) {
    const f = await this.furniture();
    const lines = (await this.pageLines(i)).filter((l) => !this.isFurniture(l, f));
    let out = '';
    let prev = null;
    for (const l of lines) {
      if (prev) {
        const gap = prev.bottom - l.top;
        const para = gap > l.size * 0.9 || Math.abs(prev.size - l.size) > 1.5;
        if (/[A-Za-z]-$/.test(out) && !para) out = out.slice(0, -1);
        else out += para ? '\n\n' : ' ';
      }
      out += l.text;
      prev = l;
    }
    return out.replace(/[ \t]+/g, ' ').trim();
  }

  async rangeText(from, to, onProgress) {
    const parts = [];
    for (let i = from; i <= to; i++) {
      parts.push({ page: i, text: await this.pageText(i) });
      onProgress?.((i - from + 1) / (to - from + 1));
    }
    return parts;
  }

  // Split pages into chunks of about maxChars, each remembering the pages it covers.
  static chunk(parts, maxChars) {
    const chunks = [];
    let cur = { text: '', pages: new Set() };
    const push = () => { if (cur.text.trim()) chunks.push({ text: cur.text.trim(), pages: [...cur.pages].sort((a, b) => a - b) }); cur = { text: '', pages: new Set() }; };
    for (const { page, text } of parts) {
      for (const para of text.split(/\n\n+/)) {
        let p = para.trim();
        if (!p) continue;
        while (p.length > maxChars) { // very long paragraph
          const cut = p.lastIndexOf('. ', maxChars) > maxChars * 0.5 ? p.lastIndexOf('. ', maxChars) + 1 : maxChars;
          if (cur.text) push();
          cur.text = p.slice(0, cut); cur.pages.add(page); push();
          p = p.slice(cut).trim();
        }
        if (cur.text.length + p.length + 2 > maxChars && cur.text) push();
        cur.text += (cur.text ? '\n\n' : '') + `[p. ${page + 1}] ` + p;
        cur.pages.add(page);
      }
    }
    push();
    return chunks;
  }

  // Retrieval chunks for Q&A (built once per document)
  async retrievalIndex(onProgress) {
    if (this._chunks) return this._chunks;
    const parts = await this.rangeText(0, this.numPages - 1, onProgress);
    const chunks = DocText.chunk(parts, 1100);
    this._chunks = new BM25(chunks);
    return this._chunks;
  }
}

// ---------------------------------------------------------------------- BM25 retrieval
const STOP = new Set('a an and are as at be been but by can could did do does for from had has have how i if in into is it its of on or our so such that the their them then there these they this those to was we were what when where which who why will with would you your about also any each more most other some than very may might not no nor only own same too just should shall'.split(' '));
// Words for retrieval. Letters, marks and digits (\p{M} keeps Sinhala vowel signs inside the word);
// Latin accents are folded; Sinhala words are stemmed lightly and function words dropped.
export const tokenize = (s) => {
  const out = [];
  const t = s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').normalize('NFC').replace(/[\u200C\u200D]/g, '');
  for (let w of t.match(/[\p{L}\p{M}\p{N}]+/gu) || []) {
    if (SI_RE.test(w)) {
      if (SI_STOP.has(w)) continue;
      w = siStem(w);
      if (w.length >= 2) out.push(w);
    } else if (w.length > 1 && !STOP.has(w)) out.push(w);
  }
  return out;
};

export class BM25 {
  constructor(docs, k1 = 1.4, b = 0.75) {
    this.docs = docs;
    this.k1 = k1; this.b = b;
    this.tf = docs.map((d) => { const m = new Map(); for (const w of tokenize(d.text)) m.set(w, (m.get(w) || 0) + 1); return m; });
    this.len = this.tf.map((m) => [...m.values()].reduce((a, c) => a + c, 0));
    this.avg = this.len.reduce((a, c) => a + c, 0) / Math.max(1, docs.length);
    this.df = new Map();
    for (const m of this.tf) for (const w of m.keys()) this.df.set(w, (this.df.get(w) || 0) + 1);
  }
  search(query, k = 4, boostPages = null) {
    const q = [...new Set(tokenize(query))];
    const N = this.docs.length;
    const scores = this.tf.map((m, i) => {
      let s = 0;
      for (const w of q) {
        const f = m.get(w);
        if (!f) continue;
        const idf = Math.log(1 + (N - this.df.get(w) + 0.5) / (this.df.get(w) + 0.5));
        s += idf * (f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + this.b * this.len[i] / this.avg));
      }
      if (boostPages && this.docs[i].pages.some((p) => boostPages.has(p))) s = s * 1.3 + 0.5;
      return { i, s };
    });
    return scores.filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, k).map((x) => ({ ...this.docs[x.i], score: x.s }));
  }
}
