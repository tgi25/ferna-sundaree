// Smooth text selection (v1.4).
//
// 1. prepareTextContent(): pdf.js text items → clean "runs". Glyph-by-glyph items (LaTeX kerning, Word/
//    LibreOffice Sinhala output) are merged into words and lines, spaces are rebuilt from real gaps,
//    Sinhala text is repaired (visual order, joiners, unmapped glyphs) and Latin ligatures are expanded.
// 2. alignWordsToInk(): the rendered page is scanned along each line to find the real word gaps, so
//    every word gets its own exactly positioned span (no drift inside long lines).
// 3. TextSelection: our own pointer-driven selection — the caret goes to the nearest character even
//    when the pointer is between lines or words, selection snaps to whole words once it leaves the
//    first word (Alt = character precision), double-click = word, triple-click = line, auto-scroll.
// 4. The selection is painted as one rounded band per line (Xodo style) instead of per-span boxes.
import { fixSinhala, detectVisualOrder, SI_RE } from './sinhala.js';
import { svgEl, f } from './util.js';

const WS = /^\s*$/;
const LIGA = /[ﬀ-ﬆ]/g;

// ====================================================================== 1. text preparation
// tc: pdf.js text content (ideally with includeMarkedContent). actual: [{tag, actual}] from ActualTextSource.
export function prepareTextContent(tc, actual = null) {
  const styles = tc.styles || {};
  let all = tc.items;
  if (actual?.some((a) => a.actual != null)) {
    const begins = all.filter((it) => it.type === 'beginMarkedContent' || it.type === 'beginMarkedContentProps').length;
    if (begins === actual.length) all = applyActualText(all, actual);
    else console.warn(`ActualText: ${actual.length} marked-content sections vs ${begins} from pdf.js — ignored`);
  }
  // text inside a /FernaOCR marked-content section (Ferna's own OCR layer): spacing is exact
  let depth = 0, ocrDepth = -1;
  for (const it of all) {
    if (it.type === 'beginMarkedContent' || it.type === 'beginMarkedContentProps') { depth++; if (it.tag === 'FernaOCR' && ocrDepth < 0) ocrDepth = depth; }
    else if (it.type === 'endMarkedContent') { if (depth === ocrDepth) ocrDepth = -1; depth--; }
    else if (ocrDepth > 0 && typeof it.str === 'string') it._ocr = true;
  }
  const src = all.filter((it) => typeof it.str === 'string');
  const joined = src.map((i) => i.str).join('');
  const siMode = SI_RE.test(joined) ? detectVisualOrder(joined) : null;

  // pieces with geometry along their baseline direction
  const pieces = [];
  for (const it of src) {
    if (!it.str.length) continue;
    const [a, b, c, d, e, g] = it.transform;
    const size = Math.hypot(c, d) || Math.hypot(a, b) || it.height || 1;
    const sc = Math.hypot(a, b) || size;
    const ux = a / sc, uy = b / sc;
    const st = styles[it.fontName] || {};
    pieces.push({
      it, str: it.str, size, ux, uy, e, g,
      s: e * ux + g * uy,                 // position along the baseline
      p: -e * uy + g * ux,                // baseline offset across
      w: st.vertical ? 0 : it.width || 0, fam: st.fontFamily || '', vertical: !!st.vertical, eol: it.hasEOL,
      loose: !!it._at || (!it.width && it.str.trim().length > 0 && it.str.trim().length <= 3)
    });
  }

  // group consecutive pieces into runs (same direction, baseline, size class and font family)
  const runs = [];
  let R = null;
  for (const P of pieces) {
    if (P.vertical) { R = null; runs.push({ pieces: [P], vertical: true }); continue; }
    const fits = R && !R.vertical && Math.abs(P.ux - R.ux) < 0.02 && Math.abs(P.uy - R.uy) < 0.02 &&
      Math.abs(P.p - R.p) < 0.3 * Math.min(P.size, R.size) &&
      P.size / R.size < 1.3 && R.size / P.size < 1.3 && P.fam === R.fam &&
      P.s > R.s0 - 0.6 * R.size && P.s < R.s1 + (P.loose || R.loose ? 2.5 : 1.1) * Math.max(P.size, R.size);
    if (!fits) {
      if (WS.test(P.str)) { if (R) R.eolAfter ||= P.eol; continue; }
      R = { pieces: [], ux: P.ux, uy: P.uy, p: P.p, size: P.size, s0: P.s, s1: P.s + P.w, fam: P.fam };
      runs.push(R);
    }
    R.pieces.push(P);
    // glyph widths of cluster-by-cluster text are unreliable: allow wider gaps inside the line
    R.loose = !!P.loose;
    R.s0 = Math.min(R.s0, P.s);
    R.s1 = Math.max(R.s1, P.s + (P.w || 0.5 * P.size * P.str.length));
    if (P.eol) R.eolAfter = true;
  }

  const items = [];
  for (let k = 0; k < runs.length; k++) {
    const run = runs[k];
    const rid = k;
    if (run.vertical) { const P = run.pieces[0]; items.push({ ...P.it, str: clean(P.str, siMode) }); continue; }
    // left-to-right order; pieces at (almost) the same position keep their content order
    const ps = [];
    for (const P of run.pieces) {
      if (WS.test(P.str)) continue;
      let j = ps.length - 1;
      while (j >= 0 && P.s < ps[j].s - 0.15 * P.size) j--;
      ps.splice(j + 1, 0, P);
    }
    if (!ps.length) continue;
    // zero-width pieces (some Sinhala PDFs): they end where the next piece begins
    for (let i = 0; i < ps.length; i++) {
      const P = ps[i];
      P.end = P.s + P.w;
      if (P.w <= 0.01) {
        const nx = ps.slice(i + 1).find((Q) => Q.s > P.s + 0.01);
        P.end = nx ? Math.min(nx.s, P.s + 0.7 * P.size * P.str.length) : P.s + 0.5 * P.size * P.str.trim().length;
      }
    }
    // Word spaces: pdf.js reports them as space items (or inside strings); trust those. Only when a run
    // has none, a visible gap counts as a space (glyph widths in some PDFs are unreliable).
    const spaces = run.pieces.filter((P) => WS.test(P.str)).map((P) => P.s + Math.max(P.w, 0) / 2);
    const gapMin = (spaces.length ? 0.7 : 0.15);
    let str = '', end = -Infinity, prevS = -Infinity;
    for (const P of ps) {
      const gap = P.s - end;
      if (str && !/\s$/.test(str) && !/^\s/.test(P.str) &&
          (P.it._ocr || gap > gapMin * P.size || spaces.some((c) => c > prevS + 0.05 * P.size && c < P.s + 0.05 * P.size && c > end - 0.3 * P.size))) str += ' ';   // OCR layer: one item per word
      str += P.str;
      end = Math.max(end, P.end);
      prevS = P.s;
    }
    str = clean(str, siMode).replace(/\s+/g, ' ').trim();
    if (!str) continue;
    const first = ps[0], it = first.it;
    const width = Math.max(end - first.s, 0.1);
    items.push({
      str, dir: 'ltr', width, height: Math.max(...ps.map((P) => P.size)),
      transform: [...it.transform.slice(0, 4), first.e, first.g], fontName: it.fontName,
      hasEOL: false, _run: { ux: run.ux, uy: run.uy, size: run.size }, _rid: rid, _ocr: !!it._ocr,
      // glyph-cluster pieces (kept for re-spacing from the rendered page)
      _parts: ps.length >= 3 ? ps.map((P) => ({ s: P.s - first.s, str: P.str })) : null, _si: siMode
    });
  }
  // line ends and separators between runs on the same line
  for (let k = 0; k < items.length; k++) {
    const A = items[k], B = items[k + 1];
    if (!A._run) { A.hasEOL = true; continue; }
    const sameLine = B && B._run && Math.abs(B._run.ux - A._run.ux) < 0.02 &&
      Math.abs((-B.transform[4] * A._run.uy + B.transform[5] * A._run.ux) - (-A.transform[4] * A._run.uy + A.transform[5] * A._run.ux)) < 0.4 * A._run.size;
    if (sameLine) { if (!/\s$/.test(A.str)) A.str += ' '; }
    else A.hasEOL = true;
  }
  return { items, styles, lang: tc.lang, siMode };
}

// Replace the glyph text inside /ActualText sections by the ActualText (outermost section wins).
function applyActualText(items, actual) {
  const out = [], stack = [];
  let k = 0, orphan = '';
  // text of a section whose glyphs produced no text item (e.g. a glyph mapped to a tab) joins the next item
  const emit = (it) => { if (orphan) { it = { ...it, str: orphan + it.str }; orphan = ''; } out.push(it); };
  const flush = (ctx) => { const syn = synth(ctx.group, ctx.actual); if (syn) emit(syn); else orphan += ctx.actual; };
  for (const it of items) {
    if (it.type === 'beginMarkedContent' || it.type === 'beginMarkedContentProps') {
      const a = actual[k++];
      const inside = stack.some((c) => c.actual != null);
      stack.push({ actual: inside ? null : a?.actual ?? null, group: [] });
      continue;
    }
    if (it.type === 'endMarkedContent') {
      const ctx = stack.pop();
      if (ctx && ctx.actual != null) flush(ctx);
      continue;
    }
    if (typeof it.str !== 'string') continue;
    const ctx = stack.find((c) => c.actual != null);
    if (ctx) ctx.group.push(it); else if (it.str.trim() || !orphan) emit(it);
  }
  for (const ctx of stack) if (ctx.actual != null) flush(ctx);
  return out;
}

function synth(group, text) {
  let g = group.filter((it) => it.transform);
  if (!g.length) return null;
  // spaces that pdf.js adds between glyphs carry misleading positions — use the glyphs themselves
  const ink = g.filter((it) => it.str.trim());
  if (ink.length) g = ink;
  const first = g[0];
  const [a, b, , , e, f0] = first.transform;
  const sc = Math.hypot(a, b) || 1, ux = a / sc, uy = b / sc;
  let smin = Infinity, smax = -Infinity;
  for (const it of g) {
    const s = it.transform[4] * ux + it.transform[5] * uy;
    smin = Math.min(smin, s); smax = Math.max(smax, s + (it.width || 0));
  }
  const s0 = e * ux + f0 * uy;
  return {
    ...first, str: text, width: Math.max(0, smax - smin), hasEOL: g.some((it) => it.hasEOL), _at: true,
    transform: [...first.transform.slice(0, 4), e + (smin - s0) * ux, f0 + (smin - s0) * uy]
  };
}

function clean(s, siMode) {
  if (LIGA.test(s)) s = s.replace(LIGA, (c) => c.normalize('NFKC'));
  if (siMode && SI_RE.test(s)) s = fixSinhala(s, siMode);
  else s = s.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F�]/g, '');
  return s;
}

// ====================================================================== 2. ink alignment
// canvas: the page canvas just rendered with `viewport` (pdf.js) and pixel scale sx/sy.
export function alignWordsToInk(tc, { canvas, viewport, sx = 1, sy = 1 }) {
  let data, W, H;
  try {
    W = canvas.width; H = canvas.height;
    if (!W || !H) return tc;
    // about 2 pixels per point is plenty to see word gaps; read a smaller copy of big canvases
    const k = Math.min(1, 2.2 / (viewport.scale * Math.min(sx, sy)));
    if (k < 0.95) {
      const c2 = document.createElement('canvas');
      c2.width = Math.max(1, Math.round(W * k)); c2.height = Math.max(1, Math.round(H * k));
      const x2 = c2.getContext('2d', { willReadFrequently: true });
      x2.drawImage(canvas, 0, 0, c2.width, c2.height);
      W = c2.width; H = c2.height; sx *= W / canvas.width; sy *= H / canvas.height;
      data = x2.getImageData(0, 0, W, H).data;
    } else {
      if (W * H > 16e6) return tc;
      data = canvas.getContext('2d').getImageData(0, 0, W, H).data;
    }
  } catch { return tc; }
  const [m0, m1, m2, m3, m4, m5] = viewport.transform;
  const T = [m0 * sx, m1 * sy, m2 * sx, m3 * sy, m4 * sx, m5 * sy];
  const pxPerUnit = viewport.scale * Math.min(sx, sy);
  const gray = new Uint8Array(W * H);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = (77 * data[j] + 150 * data[j + 1] + 29 * data[j + 2]) >> 8;
  const lum = (X, Y) => {
    const px = (T[0] * X + T[2] * Y + T[4] + 0.5) | 0, py = (T[1] * X + T[3] * Y + T[5] + 0.5) | 0;
    return px < 0 || py < 0 || px >= W || py >= H ? 255 : gray[py * W + px];
  };
  const out = [];
  for (const it of tc.items) {
    if (it._ocr) { out.push(it); continue; }          // OCR layer: words and spaces are exact already
    if (it._parts && pxPerUnit >= 0.8) {
      const avg = it._parts.reduce((a, p) => a + p.str.length, 0) / it._parts.length;
      if (avg <= 3.5) {
        const r = respaceByInk(it, lum, pxPerUnit);
        if (r) { out.push(...r); continue; }
      }
    }
    const words = it._run && it.str.trim().split(/\s+/);
    if (!words || words.length < 2 || pxPerUnit < 0.8) { out.push(it); continue; }
    const split = splitByInk(it, words, lum, pxPerUnit);
    if (split) out.push(...split); else out.push(it);
  }
  return { ...tc, items: out };
}

// Ink profile along a run's baseline: gaps (sample units) between firstInk and lastInk.
function inkProfile(it, lum, ppu) {
  const { ux, uy, size } = it._run;
  const nx = -uy, ny = ux;                              // "up" across the baseline
  const [, , , , e, g] = it.transform;
  const L = it.width;
  const nA = Math.ceil(L * ppu);
  if (nA < 8 || nA > 8000) return null;
  const nC = Math.max(4, Math.min(40, Math.ceil(0.9 * size * ppu)));
  const col = new Float32Array(nA);
  let bg = 0, dark = 255;
  for (let i = 0; i < nA; i++) {
    const t = (i + 0.5) / ppu;
    let mn = 255;
    for (let j = 0; j < nC; j++) {
      const v = -0.18 * size + (j + 0.5) * (0.9 * size) / nC;
      const l = lum(e + ux * t + nx * v, g + uy * t + ny * v);
      if (l < mn) mn = l;
      if (l > bg) bg = l;
    }
    col[i] = mn;
    if (mn < dark) dark = mn;
  }
  if (bg < 150 || bg - dark < 70) return null;          // dark background or no clear text
  const thr = bg - 0.45 * (bg - dark);
  const ink = Array.from(col, (v) => v < thr);
  const firstInk = ink.indexOf(true), lastInk = ink.lastIndexOf(true);
  if (firstInk < 0 || firstInk / ppu > 0.8 * size || (nA - 1 - lastInk) / ppu > 1.2 * size) return null;
  const gaps = [];
  for (let i = firstInk; i <= lastInk; i++) {
    if (ink[i]) continue;
    let j = i;
    while (j <= lastInk && !ink[j]) j++;
    gaps.push({ a: i, b: j, w: (j - i) / ppu });
    i = j;
  }
  return { gaps, firstInk, lastInk, size, L, e, g, ux, uy };
}

// Cluster-by-cluster PDFs (LibreOffice/Word Sinhala): decide word spaces from the ink between clusters.
function respaceByInk(it, lum, ppu) {
  const pr = inkProfile(it, lum, ppu);
  if (!pr) return null;
  const { gaps, size, L, e, g, ux, uy } = pr;
  const parts = it._parts;
  const wordGaps = gaps.filter((G) => G.w >= 0.2 * size).map((G) => [G.a / ppu, G.b / ppu]);
  const words = [];
  let cur = { s: parts[0].s, raw: parts[0].str };
  for (let i = 1; i < parts.length; i++) {
    const A = parts[i - 1], B = parts[i];
    // spaces at the edges of these pieces are guesses by pdf.js; the ink decides
    const space = wordGaps.some(([a, b]) => a >= A.s + 0.05 * size && b <= B.s + 0.25 * size && b >= B.s - 0.6 * size);
    if (space) { words.push(cur); cur = { s: B.s, raw: B.str.trimStart() }; } else cur.raw = cur.raw.trimEnd() + B.str.trimStart();
  }
  words.push(cur);
  const res = [];
  const trail = /\s$/.test(it.str) ? ' ' : '';
  for (let i = 0; i < words.length; i++) {
    const w = clean(words[i].raw, it._si).replace(/\s+/g, ' ').trim();
    if (!w) continue;
    const s0 = words[i].s, s1 = i + 1 < words.length ? words[i + 1].s : L;
    res.push({ ...it, str: w + (i + 1 < words.length ? ' ' : trail), width: Math.max(0.1, s1 - s0),
      transform: [...it.transform.slice(0, 4), e + ux * s0, g + uy * s0], hasEOL: i + 1 === words.length ? it.hasEOL : false, _parts: null });
  }
  return res.length ? res : null;
}

function splitByInk(it, words, lum, ppu) {
  const pr = inkProfile(it, lum, ppu);
  if (!pr) return null;
  const { gaps, lastInk, size, L, e, g, ux, uy } = pr;
  const k = words.length - 1;
  const cand = gaps.filter((G) => G.w >= 0.09 * size).sort((x, y) => y.w - x.w);
  if (cand.length < k) return null;
  const chosen = cand.slice(0, k);
  if (cand.length > k && !(chosen[k - 1].w >= 1.3 * cand[k].w && chosen[k - 1].w >= 0.14 * size)) return null;
  chosen.sort((x, y) => x.a - y.a);
  // plausibility: ink length per character should be similar for all words
  const starts = [0, ...chosen.map((G) => G.b / ppu)];
  const ends = [...chosen.map((G) => G.a / ppu), lastInk / ppu];
  const per = words.map((w, i) => (ends[i] - starts[i] + 0.3 * size) / Math.max(1, graphemeCount(w)));
  const pl = per.filter((_, i) => graphemeCount(words[i]) >= 2);
  if (pl.length >= 2 && Math.max(...pl) / Math.min(...pl) > 4) return null;
  const trail = /\s$/.test(it.str) ? ' ' : '';
  const res = [];
  for (let i = 0; i <= k; i++) {
    const s0 = i === 0 ? 0 : starts[i];
    const s1 = i === k ? L : starts[i + 1];
    res.push({
      ...it, str: words[i] + (i < k ? ' ' : trail), width: Math.max(0.1, s1 - s0),
      transform: [...it.transform.slice(0, 4), e + ux * s0, g + uy * s0], hasEOL: i === k ? it.hasEOL : false
    });
  }
  return res;
}

let _gseg = null, _wseg = null;
const gseg = () => (_gseg ||= new Intl.Segmenter(undefined, { granularity: 'grapheme' }));
const wseg = () => (_wseg ||= new Intl.Segmenter(undefined, { granularity: 'word' }));
function graphemeCount(s) { let n = 0; for (const _ of gseg().segment(s)) n++; return n; }

// Text "up" vector (PDF space) of a text-layer span, from the rotation pdf.js gave it.
export function upOfSpan(span) {
  const m = /rotate\((-?[\d.]+)deg\)/.exec(span?.style.transform || '');
  const ang = m ? ((Math.round(Number(m[1]) / 90) * 90) % 360 + 360) % 360 : 0;
  return { 0: [0, 1], 90: [1, 0], 180: [0, -1], 270: [-1, 0] }[ang];
}

// ---------------------------------------------------------------------- whitespace-trimmed ranges
// Selections and markups cover visible characters only: leading/trailing spaces are dropped
// (like a word processor). Works across the text nodes of the text layers.
const WSC = /[\s ​‌‍﻿]/;
function textNodes(root) {
  return document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('.textLayer') && !n.parentElement.closest('.endOfContent') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP)
  });
}
function toText(node, offset, root, forward) {
  // normalise a boundary that sits in an element to a text node position
  if (node.nodeType === 3) return { node, offset };
  const tw = textNodes(root);
  const ref = node.childNodes[offset] || null;
  if (forward) {
    tw.currentNode = ref || node;
    let n = ref && ref.nodeType === 3 ? ref : tw.nextNode();
    if (ref && ref.nodeType !== 3 && ref.firstChild) { tw.currentNode = ref; n = tw.nextNode(); }
    return n ? { node: n, offset: 0 } : null;
  }
  tw.currentNode = ref || node;
  const n = tw.previousNode();
  return n ? { node: n, offset: n.data.length } : null;
}
export function trimRange(range, root) {
  if (!range || range.collapsed) return range;
  root ||= range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentNode;
  let a = toText(range.startContainer, range.startOffset, root, true);
  let b = toText(range.endContainer, range.endOffset, root, false);
  if (!a || !b) return range;
  const before = (p, q) => (p.node === q.node ? p.offset < q.offset : !!(p.node.compareDocumentPosition(q.node) & Node.DOCUMENT_POSITION_FOLLOWING));
  const tw = textNodes(root);
  // forward over leading whitespace
  for (;;) {
    if (!before(a, b)) return range;
    if (a.offset < a.node.data.length) { if (WSC.test(a.node.data[a.offset])) { a.offset++; continue; } break; }
    tw.currentNode = a.node; const n = tw.nextNode(); if (!n) return range; a = { node: n, offset: 0 };
  }
  // backward over trailing whitespace
  for (;;) {
    if (!before(a, b)) return range;
    if (b.offset > 0) { if (WSC.test(b.node.data[b.offset - 1])) { b.offset--; continue; } break; }
    tw.currentNode = b.node; const n = tw.previousNode(); if (!n) return range; b = { node: n, offset: n.data.length };
  }
  const r = document.createRange();
  r.setStart(a.node, a.offset); r.setEnd(b.node, b.offset);
  return r;
}

// ====================================================================== 3. selection engine
export class TextSelection {
  constructor(viewer, settings) {
    this.viewer = viewer;
    this.settings = settings;
    this.models = new WeakMap();     // PageView → line model
    this.drag = null;
    this.clicks = { n: 0, t: 0, x: 0, y: 0 };
    this._painted = new Set();
    this._raf = 0;
    document.addEventListener('selectionchange', () => this._onSelectionChange());
    viewer.on('textlayer', (pv) => this.models.delete(pv));
    this._nativeHelpers();
  }

  get enabled() { return this.settings.smoothSelect !== false; }

  // ---------------------------------------------------------------- page model
  model(pv) {
    let m = this.models.get(pv);
    if (m && m.div === pv.textDiv && m.scale === pv.scale && m.rot === pv.rotation) return m;
    m = { div: pv.textDiv, scale: pv.scale, rot: pv.rotation, lines: [], byNode: new Map() };
    this.models.set(pv, m);
    if (!pv.textDiv) return m;
    const pr = pv.div.getBoundingClientRect();
    const items = [];
    for (const span of pv.textDiv.querySelectorAll('span')) {
      const node = span.firstChild;
      if (!node || node.nodeType !== 3 || !node.data.length || span.classList.contains('markedContent')) continue;
      const r = span.getBoundingClientRect();
      if (r.width < 0.3 && r.height < 0.3) continue;
      const up = upOfSpan(span), rt = [up[1], -up[0]];
      const a = pv.localToPdf(r.left - pr.left, r.top - pr.top), b = pv.localToPdf(r.right - pr.left, r.bottom - pr.top);
      const ua = a[0] * rt[0] + a[1] * rt[1], ub = b[0] * rt[0] + b[1] * rt[1];
      const va = a[0] * up[0] + a[1] * up[1], vb = b[0] * up[0] + b[1] * up[1];
      const it = { span, node, up, rt, u0: Math.min(ua, ub), u1: Math.max(ua, ub), v0: Math.min(va, vb), v1: Math.max(va, vb) };
      items.push(it);
      m.byNode.set(node, it);
    }
    // group into lines: same direction, vertical overlap, no column-sized gap
    items.sort((p, q) => (q.v0 + q.v1) - (p.v0 + p.v1));
    const open = [];
    for (const it of items) {
      const h = it.v1 - it.v0;
      let line = null;
      for (let i = open.length - 1; i >= 0 && i >= open.length - 12; i--) {
        const L = open[i];
        if (L.up !== it.up && (L.up[0] !== it.up[0] || L.up[1] !== it.up[1])) continue;
        const ov = Math.min(L.v1, it.v1) - Math.max(L.v0, it.v0);
        const lh = L.v1 - L.v0;
        if (ov < 0.5 * Math.min(h, lh)) continue;
        const gap = Math.max(it.u0 - L.u1, L.u0 - it.u1);
        if (gap > 2.5 * Math.max(h, lh)) continue;
        line = L; break;
      }
      if (!line) { line = { items: [], up: it.up, rt: it.rt, u0: it.u0, u1: it.u1, v0: it.v0, v1: it.v1 }; open.push(line); }
      line.items.push(it);
      line.u0 = Math.min(line.u0, it.u0); line.u1 = Math.max(line.u1, it.u1);
      // keep the band of the main text (ignore tall/short outliers once the line has content)
      line.v0 = Math.min(line.v0, it.v0); line.v1 = Math.max(line.v1, it.v1);
      it.line = line;
    }
    for (const L of open) L.items.sort((p, q) => p.u0 - q.u0);
    m.lines = open;
    return m;
  }

  // character boundaries of one span, along its line
  _bounds(it, pv) {
    if (it.b && it.bScale === pv.scale) return it.b;
    const text = it.node.data;
    const offs = [];
    for (const s of gseg().segment(text)) offs.push(s.index);
    offs.push(text.length);
    const us = [];
    const r = document.createRange();
    const pr = pv.div.getBoundingClientRect();
    for (let i = 0; i < offs.length - 1; i++) {
      r.setStart(it.node, offs[i]); r.setEnd(it.node, offs[i + 1]);
      const c = r.getBoundingClientRect();
      const a = pv.localToPdf(c.left - pr.left, c.top - pr.top), b = pv.localToPdf(c.right - pr.left, c.bottom - pr.top);
      const ua = a[0] * it.rt[0] + a[1] * it.rt[1], ub = b[0] * it.rt[0] + b[1] * it.rt[1];
      us.push([Math.min(ua, ub), Math.max(ua, ub)]);
    }
    const pos = [];                   // caret position (u) before each boundary
    for (let i = 0; i < offs.length; i++) {
      let u = i < us.length ? us[i][0] : us[us.length - 1]?.[1] ?? it.u1;
      if (i > 0 && u < pos[i - 1]) u = pos[i - 1];
      pos.push(u);
    }
    it.b = { offs, pos }; it.bScale = pv.scale;
    return it.b;
  }

  // Caret nearest to a PDF point. Returns {pv, it, node, offset, near}
  caretAt(pv, X, Y) {
    const m = this.model(pv);
    let best = null, bd = Infinity;
    for (const L of m.lines) {
      const u = X * L.rt[0] + Y * L.rt[1], v = X * L.up[0] + Y * L.up[1];
      const dv = v > L.v1 ? v - L.v1 : v < L.v0 ? L.v0 - v : 0;
      const du = u > L.u1 ? u - L.u1 : u < L.u0 ? L.u0 - u : 0;
      const d = dv + 0.3 * du;
      if (d < bd) { bd = d; best = { L, u, dv, du }; }
    }
    if (!best) return null;
    const { L, u, dv, du } = best;
    const h = L.v1 - L.v0;
    const near = dv <= 0.45 * h && du <= 1.2 * h;
    const items = L.items;
    let it, offset;
    if (u <= items[0].u0) { it = items[0]; offset = 0; }
    else if (u >= items[items.length - 1].u1) { it = items[items.length - 1]; offset = it.node.data.length; }
    else {
      let i = items.findIndex((x) => u >= x.u0 && u <= x.u1);
      if (i < 0) {
        // in a gap between two spans: nearest edge
        const j = items.findIndex((x) => x.u0 > u);
        const A = items[j - 1], B = items[j];
        if (u - A.u1 <= B.u0 - u) { it = A; offset = A.node.data.length; } else { it = B; offset = 0; }
      } else {
        it = items[i];
        const { offs, pos } = this._bounds(it, pv);
        let k = 0;
        while (k < offs.length - 1 && u > (pos[k] + pos[k + 1]) / 2) k++;
        offset = offs[k];
      }
    }
    // a caret after a trailing space belongs at the start of the next word
    return { pv, it, node: it.node, offset, near, line: L };
  }

  // Word around a caret, possibly spanning several spans of the same line
  wordAt(c) {
    const text = c.node.data;
    const at = Math.min(c.offset, Math.max(0, text.length - 1));
    let seg = null;
    for (const s of wseg().segment(text)) {
      if (at >= s.index && at < s.index + s.segment.length) { seg = s; break; }
    }
    if (!seg) return { start: c, end: c };
    // caret right after a word, on a space → take the word before it
    if (!seg.isWordLike && c.offset > 0 && c.offset === seg.index) {
      for (const s of wseg().segment(text)) if (s.index + s.segment.length === c.offset && s.isWordLike) { seg = s; break; }
    }
    let start = { node: c.node, offset: seg.index, it: c.it }, end = { node: c.node, offset: seg.index + seg.segment.length, it: c.it };
    if (seg.isWordLike) {
      // join with neighbouring spans when the word continues without a space (split glyph runs)
      const L = c.it.line, items = L?.items || [];
      let i = items.indexOf(c.it);
      while (start.offset === 0 && i > 0) {
        const P = items[i - 1], t = P.node.data;
        if (/\s$/.test(t) || c.it.u0 - P.u1 > 0.2 * (L.v1 - L.v0)) break;
        const last = [...wseg().segment(t)].pop();
        if (!last?.isWordLike) break;
        start = { node: P.node, offset: last.index, it: P };
        if (last.index > 0) break;
        i--;
      }
      i = items.indexOf(c.it);
      while (end.offset === end.node.data.length && i < items.length - 1) {
        const N = items[i + 1], t = N.node.data;
        if (/\s$/.test(end.node.data) || N.u0 - items[i].u1 > 0.2 * (L.v1 - L.v0)) break;
        const firstSeg = wseg().segment(t)[Symbol.iterator]().next().value;
        if (!firstSeg?.isWordLike) break;
        end = { node: N.node, offset: firstSeg.segment.length, it: N };
        if (firstSeg.segment.length < t.length) break;
        i++;
      }
    }
    return { start, end };
  }

  lineAt(c) {
    const items = c.it.line.items;
    const a = items[0], b = items[items.length - 1];
    return { start: { node: a.node, offset: 0, it: a }, end: { node: b.node, offset: b.node.data.replace(/\s+$/, '').length, it: b } };
  }

  // ---------------------------------------------------------------- pointer gesture (called by Tools)
  begin(e, pv) {
    if (!this.enabled || e.pointerType === 'touch' || !pv.textDiv) return false;
    const [X, Y] = pv.clientToPdf(e.clientX, e.clientY);
    const c = this.caretAt(pv, X, Y);
    if (!c || !c.near) return false;
    const now = performance.now(), k = this.clicks;
    k.n = now - k.t < 450 && Math.hypot(e.clientX - k.x, e.clientY - k.y) < 6 ? (k.n % 3) + 1 : 1;
    k.t = now; k.x = e.clientX; k.y = e.clientY;
    const gran = k.n === 1 ? 'char' : k.n === 2 ? 'word' : 'line';
    const sel = window.getSelection();
    let anchor = c;
    if (e.shiftKey && gran === 'char' && sel.rangeCount && !sel.isCollapsed && this.viewer.viewerDiv.contains(sel.anchorNode)) {
      anchor = { node: sel.anchorNode, offset: sel.anchorOffset, it: this._itemOf(sel.anchorNode) };
    }
    this.drag = { pv, anchor, gran, moved: false, x: e.clientX, y: e.clientY, last: [e.clientX, e.clientY], word: null };
    if (gran !== 'char' || anchor !== c) this._apply(c, e.altKey, true);
    else sel.removeAllRanges();
    if (document.activeElement?.matches?.('input, textarea, select')) document.activeElement.blur();
    return true;
  }

  move(e) {
    const d = this.drag;
    if (!d) return;
    d.last = [e.clientX, e.clientY];
    d.alt = e.altKey;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3) return;
    d.moved = true;
    this._update();
    this._autoscroll();
  }

  end() {
    const d = this.drag;
    this.drag = null;
    cancelAnimationFrame(this._scrollRaf); this._scrollRaf = 0;
    return d ? { moved: d.moved, gran: d.gran } : { moved: false, gran: 'char' };
  }

  get active() { return !!this.drag; }

  _update() {
    const d = this.drag;
    const [cx, cy] = d.last;
    const pv = this._pageNear(cx, cy);
    if (!pv) return;
    const [X, Y] = pv.clientToPdf(cx, cy);
    const c = this.caretAt(pv, X, Y);
    if (c) this._apply(c, d.alt);
  }

  _pageNear(cx, cy) {
    const v = this.viewer;
    let pv = v.pageAtClient(cx, cy);
    if (pv?.textDiv) return pv;
    let best = null, bd = Infinity;
    for (const i of v.visible || []) {
      const p = v.pages[i];
      if (!p.textDiv) continue;
      const r = p.div.getBoundingClientRect();
      const d = (cy < r.top ? r.top - cy : cy > r.bottom ? cy - r.bottom : 0) + 0.2 * (cx < r.left ? r.left - cx : cx > r.right ? cx - r.right : 0);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  _itemOf(node) {
    for (const pv of this.viewer.pages) { const it = this.models.get(pv)?.byNode.get(node); if (it) return it; }
    return null;
  }

  _apply(focus, alt, initial = false) {
    const d = this.drag;
    let a = d.anchor, fc = focus;
    const forward = cmpPos(a, fc) <= 0;
    if (d.gran === 'line' && a.it) {
      const la = this.lineAt(a), lf = this.lineAt(fc);
      a = forward ? la.start : la.end; fc = forward ? lf.end : lf.start;
    } else if (a.it && (d.gran === 'word' || (this.settings.wordSelect !== false && !alt))) {
      // a drag that starts in the space between words anchors exactly there (not on the previous word)
      if (!d.word) {
        const t = a.node.data || '';
        const onSpace = d.gran !== 'word' && (a.offset >= t.length || WSC.test(t[a.offset]));
        d.word = onSpace ? { start: a, end: a } : this.wordAt(a);
      }
      const wa = d.word;
      const inside = cmpPos(wa.start, fc) <= 0 && cmpPos(fc, wa.end) <= 0;
      if (d.gran === 'word' || !inside) {
        const wf = this.wordAt(fc);
        a = forward ? wa.start : wa.end; fc = forward ? wf.end : wf.start;
        if (initial && d.gran === 'word') { a = wa.start; fc = wa.end; }
      }
    }
    // no leading/trailing spaces: the selection wraps the first and last visible character
    try {
      const fwd = cmpPos(a, fc) <= 0;
      const r = document.createRange();
      if (fwd) { r.setStart(a.node, a.offset); r.setEnd(fc.node, fc.offset); } else { r.setStart(fc.node, fc.offset); r.setEnd(a.node, a.offset); }
      const t = trimRange(r, this.viewer.viewerDiv);
      if (t !== r) {
        if (fwd) { a = { node: t.startContainer, offset: t.startOffset }; fc = { node: t.endContainer, offset: t.endOffset }; }
        else { a = { node: t.endContainer, offset: t.endOffset }; fc = { node: t.startContainer, offset: t.startOffset }; }
      }
    } catch { /* keep untrimmed */ }
    try { window.getSelection().setBaseAndExtent(a.node, a.offset, fc.node, fc.offset); } catch { /* node gone */ }
  }

  _autoscroll() {
    if (this._scrollRaf) return;
    const step = () => {
      this._scrollRaf = 0;
      const d = this.drag;
      if (!d) return;
      const c = this.viewer.container, r = c.getBoundingClientRect();
      const [x, y] = d.last, M = 28;
      let dy = 0, dx = 0;
      if (y < r.top + M) dy = -Math.min(40, (r.top + M - y) * 0.6);
      else if (y > r.bottom - M) dy = Math.min(40, (y - r.bottom + M) * 0.6);
      if (!c.classList.contains('hlock')) {
        if (x < r.left + M) dx = -Math.min(40, (r.left + M - x) * 0.6);
        else if (x > r.right - M) dx = Math.min(40, (x - r.right + M) * 0.6);
      }
      if (!dx && !dy) return;
      c.scrollTop += dy; c.scrollLeft += dx;
      this._update();
      this._scrollRaf = requestAnimationFrame(step);
    };
    this._scrollRaf = requestAnimationFrame(step);
  }

  // ---------------------------------------------------------------- 4. painter
  _onSelectionChange() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.paint(); });
    this._moveEndOfContent();
  }

  // Per page: merged line bands of the current selection, in PDF space → Map(index → {pv, rects, up})
  selectionRects() {
    const sel = window.getSelection();
    const out = new Map();
    if (!sel.rangeCount || sel.isCollapsed) return out;
    let range = sel.getRangeAt(0);
    if (!this.viewer.viewerDiv.contains(range.commonAncestorContainer)) return out;
    range = trimRange(range, this.viewer.viewerDiv);
    for (const pv of this.viewer.pages) {
      if (!pv.textDiv || !range.intersectsNode(pv.textDiv)) continue;
      const res = this._pageRects(pv, range);
      if (res.rects.length) out.set(pv.index, res);
    }
    return out;
  }

  _pageRects(pv, range) {
    const m = this.model(pv);
    const pr = pv.div.getBoundingClientRect();
    const segs = new Map();   // line → [[u0,u1]]
    const r2 = document.createRange();
    let up = null;
    for (const [node, it] of m.byNode) {
      if (!range.intersectsNode(node)) continue;
      r2.selectNodeContents(node);
      if (range.compareBoundaryPoints(Range.START_TO_START, r2) > 0) r2.setStart(range.startContainer, range.startOffset);
      if (range.compareBoundaryPoints(Range.END_TO_END, r2) < 0) r2.setEnd(range.endContainer, range.endOffset);
      if (r2.collapsed) continue;
      if (r2.startContainer === node && r2.endContainer === node) {
        let s0 = r2.startOffset, s1 = r2.endOffset;
        const t = node.data;
        while (s0 < s1 && WSC.test(t[s0])) s0++;
        while (s1 > s0 && WSC.test(t[s1 - 1])) s1--;
        if (s0 >= s1) continue;                     // only spaces: nothing visible to mark
        r2.setStart(node, s0); r2.setEnd(node, s1);
      }
      // a selected trailing space alone is not worth painting unless the line continues
      const c = r2.getBoundingClientRect();
      if (c.width < 0.3 && c.height < 0.3) continue;
      const a = pv.localToPdf(c.left - pr.left, c.top - pr.top), b = pv.localToPdf(c.right - pr.left, c.bottom - pr.top);
      const ua = a[0] * it.rt[0] + a[1] * it.rt[1], ub = b[0] * it.rt[0] + b[1] * it.rt[1];
      if (!segs.has(it.line)) segs.set(it.line, []);
      segs.get(it.line).push([Math.min(ua, ub), Math.max(ua, ub)]);
      up ||= it.up;
    }
    const rects = [];
    for (const [L, list] of segs) {
      list.sort((p, q) => p[0] - q[0]);
      const h = L.v1 - L.v0;
      const merged = [];
      for (const s of list) {
        const last = merged[merged.length - 1];
        if (last && s[0] - last[1] < 1.2 * h) last[1] = Math.max(last[1], s[1]);
        else merged.push([...s]);
      }
      const pad = 0.04 * h;
      for (const [u0, u1] of merged) {
        const P = (u, v) => [u * L.rt[0] + v * L.up[0], u * L.rt[1] + v * L.up[1]];
        const p1 = P(u0 - pad, L.v0 - pad), p2 = P(u1 + pad, L.v1 + pad);
        rects.push([Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1]), Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1])]);
      }
    }
    return { pv, rects, up: up || [0, 1] };
  }

  paint() {
    for (const pv of this._painted) pv.tselGroup?.replaceChildren();
    this._painted.clear();
    if (!this.enabled) return;
    for (const { pv, rects } of this.selectionRects().values()) {
      if (!pv.tselGroup) continue;
      const r = Math.max(0.8, 2 / pv.scale);
      for (const [x1, y1, x2, y2] of rects) {
        pv.tselGroup.append(svgEl('rect', { x: f(x1), y: f(y1), width: f(x2 - x1), height: f(y2 - y1), rx: f(r), ry: f(r) }));
      }
      this._painted.add(pv);
    }
  }

  // ---------------------------------------------------------------- native selection helpers
  // (pdf.js TextLayerBuilder technique: keeps a native drag – touch, keyboard – from jumping to the
  //  end of the page when the pointer is between spans.)
  _nativeHelpers() {
    let down = false;
    const reset = () => {
      for (const pv of this.viewer.pages) {
        const eoc = pv.eocDiv;
        if (!eoc || !pv.textDiv) continue;
        if (eoc.parentNode !== pv.textDiv || eoc.nextSibling) pv.textDiv.append(eoc);
        eoc.style.width = eoc.style.height = '';
        pv.textDiv.classList.remove('selecting');
      }
    };
    document.addEventListener('pointerdown', () => { down = true; });
    document.addEventListener('pointerup', () => { down = false; reset(); });
    window.addEventListener('blur', () => { down = false; reset(); });
    document.addEventListener('keyup', () => { if (!down) reset(); });
    this._resetEoc = reset;
  }

  _moveEndOfContent() {
    if (this.drag) return;           // our own engine does not need it
    const sel = document.getSelection();
    if (!sel.rangeCount) { this._resetEoc(); return; }
    const range = sel.getRangeAt(0);
    for (const pv of this.viewer.pages) {
      if (!pv.textDiv) continue;
      if (range.intersectsNode(pv.textDiv)) pv.textDiv.classList.add('selecting');
      else pv.textDiv.classList.remove('selecting');
    }
    const prev = this._prevRange;
    const modifyStart = prev && (range.compareBoundaryPoints(Range.END_TO_END, prev) === 0 || range.compareBoundaryPoints(Range.START_TO_END, prev) === 0);
    let anchor = modifyStart ? range.startContainer : range.endContainer;
    if (anchor.nodeType === Node.TEXT_NODE) anchor = anchor.parentNode;
    if (!modifyStart && range.endOffset === 0) {
      try {
        do {
          while (!anchor.previousSibling) anchor = anchor.parentNode;
          anchor = anchor.previousSibling;
        } while (!anchor.childNodes.length);
      } catch { /* reached the top */ }
    }
    const layer = anchor?.parentElement?.closest?.('.textLayer');
    const pv = layer && this.viewer.pages.find((p) => p.textDiv === layer);
    if (pv?.eocDiv && anchor.parentElement) {
      pv.eocDiv.style.width = layer.style.width;
      pv.eocDiv.style.height = layer.style.height;
      anchor.parentElement.insertBefore(pv.eocDiv, modifyStart ? anchor : anchor.nextSibling);
    }
    this._prevRange = range.cloneRange();
  }
}

function cmpPos(a, b) {
  if (a.node === b.node) return a.offset - b.offset;
  const p = a.node.compareDocumentPosition(b.node);
  return p & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

// Text of each run after ink-based word spacing, keyed by run id (used by Auto-Bookmark for titles).
export function inkRunTexts(tc, ink) {
  const out = new Map();
  const al = alignWordsToInk(tc, ink);
  for (const it of al.items) if (it._rid != null) out.set(it._rid, (out.get(it._rid) || '') + it.str);
  return out;
}

// Copy the spacing of `source` onto `text` when both have the same characters apart from spaces.
export function respaceLike(text, source) {
  const strip = (x) => x.replace(/\s+/g, '');
  if (strip(text) !== strip(source)) return text;
  return source.replace(/\s+/g, ' ').trim();
}
