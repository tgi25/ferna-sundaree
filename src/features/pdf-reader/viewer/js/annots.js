// Geometry, on-screen rendering and hit-testing of annotations.
import { svgEl, el, quadPathD, distToSegment, f } from './util.js';

export const MARKUP_TYPES = new Set(['highlight', 'underline', 'strikeout', 'squiggly']);
export const SHAPE_TYPES = new Set(['rect', 'ellipse', 'line', 'arrow']);
export const TYPE_LABEL = {
  highlight: 'Highlight', underline: 'Underline', strikeout: 'Strike-out', squiggly: 'Squiggly',
  ink: 'Pen', marker: 'Marker', rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', arrow: 'Arrow',
  freetext: 'Text box', note: 'Note', area: 'Area highlight'
};

// "Up" direction of upright text in PDF space for a page with intrinsic /Rotate r0.
export function upFromRotation(r0) {
  switch (((r0 % 360) + 360) % 360) {
    case 90: return [-1, 0];
    case 180: return [0, -1];
    case 270: return [1, 0];
    default: return [0, 1];
  }
}
const rightOf = ([ux, uy]) => [uy, -ux];

// Corner points of an axis-aligned rect, ordered relative to text direction.
export function orientedCorners(r, up = [0, 1]) {
  const [x1, y1, x2, y2] = r;
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
  const rt = rightOf(up);
  const along = Math.abs(rt[0]) ? w : h;      // extent along reading direction
  const across = Math.abs(up[1]) ? h : w;     // extent along "up"
  const P = (a, b) => [cx + rt[0] * a + up[0] * b, cy + rt[1] * a + up[1] * b];
  return {
    ul: P(-along / 2, across / 2), ur: P(along / 2, across / 2),
    ll: P(-along / 2, -across / 2), lr: P(along / 2, -across / 2),
    along, across, up, rt
  };
}

// Geometry of markup decorations (shared by screen + PDF writer).
export function markupStrokes(a) {
  const up = a.upright || [0, 1];
  const out = [];
  for (const r of a.rects) {
    const c = orientedCorners(r, up);
    const h = c.across;
    const lw = Math.max(0.6, h * 0.075);
    const off = (t) => [[c.ll[0] + up[0] * h * t, c.ll[1] + up[1] * h * t], [c.lr[0] + up[0] * h * t, c.lr[1] + up[1] * h * t]];
    if (a.type === 'underline') out.push({ kind: 'line', pts: off(0.06), width: lw });
    else if (a.type === 'strikeout') out.push({ kind: 'line', pts: off(0.48), width: lw });
    else if (a.type === 'squiggly') {
      const amp = h * 0.055, period = Math.max(2, h * 0.28);
      const [p0, p1] = off(0.07);
      const n = Math.max(2, Math.round(c.along / (period / 2)));
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const s = (i % 2 ? 1 : -1) * amp;
        pts.push(p0[0] + (p1[0] - p0[0]) * t + up[0] * s, p0[1] + (p1[1] - p0[1]) * t + up[1] * s);
      }
      out.push({ kind: 'poly', pts, width: Math.max(0.5, h * 0.055) });
    }
  }
  return out;
}

export function bbox(a) {
  let xs = [], ys = [];
  const add = (x, y) => { xs.push(x); ys.push(y); };
  if (a.rects) for (const r of a.rects) { add(r[0], r[1]); add(r[2], r[3]); }
  if (a.paths) for (const p of a.paths) for (let i = 0; i < p.length; i += 2) add(p[i], p[i + 1]);
  if (a.rect) { add(a.rect[0], a.rect[1]); add(a.rect[2], a.rect[3]); }
  if (a.line) { add(a.line[0], a.line[1]); add(a.line[2], a.line[3]); }
  if (!xs.length) return [0, 0, 0, 0];
  const pad = (a.width || 0) / 2 + (a.type === 'arrow' ? arrowSize(a) : 0);
  return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
}

export const arrowSize = (a) => Math.max(6, (a.width || 1) * 3.5);
export function arrowHead(a) {
  const [x1, y1, x2, y2] = a.line;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const s = arrowSize(a), spread = Math.PI / 7;
  return [
    [x2 - s * Math.cos(ang - spread), y2 - s * Math.sin(ang - spread)],
    [x2, y2],
    [x2 - s * Math.cos(ang + spread), y2 - s * Math.sin(ang + spread)]
  ];
}

export function normRect(r) {
  return [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
}

// Translate an annotation by dx,dy (PDF units) — returns changed fields.
export function translated(a, dx, dy) {
  const o = {};
  if (a.rects) o.rects = a.rects.map((r) => [r[0] + dx, r[1] + dy, r[2] + dx, r[3] + dy]);
  if (a.paths) o.paths = a.paths.map((p) => p.map((v, i) => v + (i % 2 ? dy : dx)));
  if (a.rect) o.rect = [a.rect[0] + dx, a.rect[1] + dy, a.rect[2] + dx, a.rect[3] + dy];
  if (a.line) o.line = [a.line[0] + dx, a.line[1] + dy, a.line[2] + dx, a.line[3] + dy];
  return o;
}

// ---- hit testing (PDF units) -------------------------------------------------
export function hitTest(list, X, Y, tol) {
  for (let i = list.length - 1; i >= 0; i--) {
    const a = list[i];
    if (hits(a, X, Y, tol)) return a;
  }
  return null;
}

function inRect(r, X, Y, pad = 0) {
  const [x1, y1, x2, y2] = normRect(r);
  return X >= x1 - pad && X <= x2 + pad && Y >= y1 - pad && Y <= y2 + pad;
}

export function hits(a, X, Y, tol) {
  const w = (a.width || 1) / 2 + tol;
  switch (a.type) {
    case 'highlight': case 'underline': case 'strikeout': case 'squiggly':
      return a.rects.some((r) => inRect(r, X, Y, tol * 0.3));
    case 'ink': case 'marker':
      for (const p of a.paths) {
        if (p.length === 2 && Math.hypot(p[0] - X, p[1] - Y) <= w) return true;
        for (let i = 0; i + 3 < p.length; i += 2) if (distToSegment(X, Y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= w) return true;
      }
      return false;
    case 'rect': {
      if (a.fill) return inRect(a.rect, X, Y, tol);
      const [x1, y1, x2, y2] = normRect(a.rect);
      return inRect(a.rect, X, Y, w) && !(X > x1 + w && X < x2 - w && Y > y1 + w && Y < y2 - w);
    }
    case 'ellipse': {
      const [x1, y1, x2, y2] = normRect(a.rect);
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = (x2 - x1) / 2, ry = (y2 - y1) / 2;
      if (rx < 0.5 || ry < 0.5) return inRect(a.rect, X, Y, w);
      const d = Math.hypot((X - cx) / rx, (Y - cy) / ry);
      if (a.fill) return d <= 1 + w / Math.min(rx, ry);
      return Math.abs(d - 1) * Math.min(rx, ry) <= w;
    }
    case 'line': case 'arrow': {
      const [x1, y1, x2, y2] = a.line;
      return distToSegment(X, Y, x1, y1, x2, y2) <= w + 1;
    }
    case 'freetext': case 'note':
      return inRect(a.rect, X, Y, tol * 0.5);
  }
  return false;
}

// Does a circle (eraser) touch an annotation?
export function touchesCircle(a, X, Y, r) { return hits(a, X, Y, r); }

// ---- rendering ---------------------------------------------------------------
// Each page view owns: hlSvg (multiply-blended), annSvg, htmlLayer, selSvg.
// All svgs use viewBox = page box in PDF units with a y-flip group.

export function renderPageAnnotations(pv, list, selectedId, editingId) {
  const hl = pv.hlGroup, an = pv.annGroup, html = pv.htmlLayer;
  hl.replaceChildren();
  an.replaceChildren();
  // keep an actively edited free-text element
  for (const child of Array.from(html.children)) if (child.dataset.id !== editingId) child.remove();

  for (const a of list) {
    const op = a.opacity ?? 1;
    const color = a.color || '#000000';
    switch (a.type) {
      case 'highlight': {
        const g = svgEl('g', { 'data-id': a.id, fill: color, 'fill-opacity': op });
        for (const r of a.rects) {
          const [x1, y1, x2, y2] = normRect(r);
          g.append(svgEl('rect', { x: f(x1), y: f(y1), width: f(x2 - x1), height: f(y2 - y1) }));
        }
        hl.append(g);
        break;
      }
      case 'underline': case 'strikeout': case 'squiggly': {
        const g = svgEl('g', { 'data-id': a.id, stroke: color, 'stroke-opacity': op, fill: 'none', 'stroke-linecap': 'butt' });
        for (const s of markupStrokes(a)) {
          if (s.kind === 'line') g.append(svgEl('line', { x1: f(s.pts[0][0]), y1: f(s.pts[0][1]), x2: f(s.pts[1][0]), y2: f(s.pts[1][1]), 'stroke-width': f(s.width) }));
          else g.append(svgEl('polyline', { points: s.pts.map(f).join(' '), 'stroke-width': f(s.width), 'stroke-linejoin': 'round' }));
        }
        an.append(g);
        break;
      }
      case 'ink': case 'marker': {
        const g = svgEl('g', {
          'data-id': a.id, stroke: color, 'stroke-opacity': op, fill: 'none',
          'stroke-width': a.width, 'stroke-linecap': a.type === 'marker' ? 'butt' : 'round', 'stroke-linejoin': 'round'
        });
        for (const p of a.paths) g.append(svgEl('path', { d: quadPathD(p) }));
        (a.type === 'marker' ? hl : an).append(g);
        break;
      }
      case 'rect': case 'ellipse': {
        const [x1, y1, x2, y2] = normRect(a.rect);
        const w = a.width || 1;
        const attrs = {
          'data-id': a.id, stroke: color, 'stroke-width': w, 'stroke-opacity': op,
          fill: a.fill ? color : 'none', 'fill-opacity': a.fill ? op * 0.35 : null
        };
        const e = a.type === 'rect'
          ? svgEl('rect', { ...attrs, x: f(x1 + w / 2), y: f(y1 + w / 2), width: f(Math.max(0, x2 - x1 - w)), height: f(Math.max(0, y2 - y1 - w)) })
          : svgEl('ellipse', { ...attrs, cx: f((x1 + x2) / 2), cy: f((y1 + y2) / 2), rx: f(Math.max(0, (x2 - x1 - w) / 2)), ry: f(Math.max(0, (y2 - y1 - w) / 2)) });
        an.append(e);
        break;
      }
      case 'line': case 'arrow': {
        const g = svgEl('g', { 'data-id': a.id, stroke: color, 'stroke-width': a.width || 1, 'stroke-opacity': op, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
        const [x1, y1, x2, y2] = a.line;
        g.append(svgEl('line', { x1: f(x1), y1: f(y1), x2: f(x2), y2: f(y2) }));
        if (a.type === 'arrow') g.append(svgEl('polyline', { points: arrowHead(a).flat().map(f).join(' ') }));
        an.append(g);
        break;
      }
      case 'freetext': {
        if (a.id === editingId) break;
        html.append(freeTextElement(pv, a));
        break;
      }
      case 'note': {
        html.append(noteElement(pv, a));
        break;
      }
    }
    // small comment marker for annotations carrying a comment
    if (a.contents && a.type !== 'note' && a.type !== 'freetext') {
      const b = bbox(a);
      html.append(commentBadge(pv, a, b));
    }
  }
  renderSelection(pv, list.find((x) => x.id === selectedId));
}

export function renderSelection(pv, a) {
  pv.selGroup.replaceChildren();
  if (!a) return;
  const [x1, y1, x2, y2] = bbox(a);
  const pad = 2;
  pv.selGroup.append(svgEl('rect', { class: 'selbox', x: f(x1 - pad), y: f(y1 - pad), width: f(x2 - x1 + 2 * pad), height: f(y2 - y1 + 2 * pad) }));
}

// Position an element in page space from a PDF-space rect, with its local "up" aligned to upright text.
export function placeBox(pv, elm, rect, up = [0, 1]) {
  const c = orientedCorners(normRect(rect), up);
  const u = (X) => X - pv.x0, v = (Y) => pv.y0 + pv.rawH - Y; // PDF → unscaled space coords (pt, y down)
  const angle = { '0,1': 0, '-1,0': -90, '0,-1': 180, '1,0': 90 }[up.join(',')] || 0;
  elm.style.left = `calc(var(--scale-factor) * ${f(u(c.ul[0]))}px)`;
  elm.style.top = `calc(var(--scale-factor) * ${f(v(c.ul[1]))}px)`;
  elm.style.width = `calc(var(--scale-factor) * ${f(c.along)}px)`;
  elm.style.minHeight = `calc(var(--scale-factor) * ${f(c.across)}px)`;
  elm.style.transform = angle ? `rotate(${angle}deg)` : '';
}

export function freeTextElement(pv, a) {
  const d = el('div', { class: 'ft', 'data-id': a.id });
  placeBox(pv, d, a.rect, a.upright);
  d.style.fontSize = `calc(var(--scale-factor) * ${a.fontSize || 12}px)`;
  d.style.color = a.color || '#000';
  d.style.opacity = a.opacity ?? 1;
  d.textContent = a.text || '';
  return d;
}

function noteElement(pv, a) {
  const d = el('div', { class: 'note-icon', 'data-id': a.id });
  const [x1, , , y2] = normRect(a.rect);
  d.style.left = `calc(var(--scale-factor) * ${f(x1 - pv.x0)}px)`;
  d.style.top = `calc(var(--scale-factor) * ${f(pv.y0 + pv.rawH - y2)}px)`;
  d.style.width = d.style.height = `calc(var(--scale-factor) * 20px)`;
  const svg = svgEl('svg', { viewBox: '0 0 24 24' });
  svg.append(svgEl('path', { d: 'M4 3h16a1 1 0 0 1 1 1v12l-5 5H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', fill: a.color || '#ffd400' }), svgEl('path', { d: 'M16 21v-5h5M7 8h10M7 12h7' }));
  d.append(svg);
  return d;
}

function commentBadge(pv, a, b) {
  const d = el('div', { class: 'note-icon', 'data-id': a.id + '-c' });
  d.style.left = `calc(var(--scale-factor) * ${f(b[2] - pv.x0 + 1)}px)`;
  d.style.top = `calc(var(--scale-factor) * ${f(pv.y0 + pv.rawH - b[3] - 9)}px)`;
  d.style.width = d.style.height = `calc(var(--scale-factor) * 10px)`;
  const svg = svgEl('svg', { viewBox: '0 0 24 24' });
  svg.append(svgEl('path', { d: 'M3 4h18v13H9l-6 5z', fill: a.color || '#ffd400' }));
  d.append(svg);
  return d;
}
