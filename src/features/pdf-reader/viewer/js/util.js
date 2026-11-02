// Small shared helpers.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const uid = () => 'a' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const SVGNS = 'http://www.w3.org/2000/svg';
export const CSS_UNITS = 96 / 72; // 100 % zoom = physical size on screen

// Static markup → nodes (parsed inertly: no scripts run, no handlers are attached)
export function parseHtml(html) {
  return [...new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body.childNodes];
}

export function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.append(...parseHtml(v));
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) if (c != null) e.append(c);
  return e;
}

export function svgEl(tag, attrs = {}) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  return e;
}

export function icon(name) {
  const s = document.createElementNS(SVGNS, 'svg');
  const u = document.createElementNS(SVGNS, 'use');
  u.setAttribute('href', '#i-' + name);
  s.append(u);
  return s;
}

// ---- colours -------------------------------------------------------------
export function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export function rgbToHex(rgb) {
  return '#' + rgb.map((v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
}

// ---- simple event emitter ---------------------------------------------------
export class Emitter {
  constructor() { this._h = new Map(); }
  on(type, fn) { (this._h.get(type) || this._h.set(type, new Set()).get(type)).add(fn); return () => this.off(type, fn); }
  off(type, fn) { this._h.get(type)?.delete(fn); }
  emit(type, data) { this._h.get(type)?.forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); }
}

// ---- toast -----------------------------------------------------------------
let toastTimer = 0;
export function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

export function debounce(fn, ms) {
  let t = 0;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}

// ---- geometry -----------------------------------------------------------------
export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Ramer–Douglas–Peucker on a flat [x0,y0,x1,y1,...] array.
export function simplify(flat, eps) {
  const n = flat.length / 2;
  if (n <= 2) return flat.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(flat[2 * i], flat[2 * i + 1], flat[2 * a], flat[2 * a + 1], flat[2 * b], flat[2 * b + 1]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(flat[2 * i], flat[2 * i + 1]);
  return out;
}

// Smooth path through points using quadratic segments between midpoints.
// Returns list of segments usable both for SVG and PDF (converted to cubic there).
// Output: { start:[x,y], segs:[[cx,cy,x,y], ...] }  (quadratic Béziers)
export function smoothQuad(flat) {
  const n = flat.length / 2;
  if (n === 0) return { start: [0, 0], segs: [] };
  const P = (i) => [flat[2 * i], flat[2 * i + 1]];
  if (n === 1) return { start: P(0), segs: [[...P(0), ...P(0)]] };
  if (n === 2) { const a = P(0), b = P(1); return { start: a, segs: [[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, ...b]] }; }
  const segs = [];
  const start = P(0);
  let prevMid = start;
  for (let i = 1; i < n - 1; i++) {
    const c = P(i), nx = P(i + 1);
    const mid = [(c[0] + nx[0]) / 2, (c[1] + nx[1]) / 2];
    segs.push([c[0], c[1], mid[0], mid[1]]);
    prevMid = mid;
  }
  const last = P(n - 1);
  segs.push([(prevMid[0] + last[0]) / 2, (prevMid[1] + last[1]) / 2, last[0], last[1]]);
  return { start, segs };
}

export function quadPathD(flat) {
  const { start, segs } = smoothQuad(flat);
  let d = `M${f(start[0])} ${f(start[1])}`;
  if (flat.length === 2) d += `l0.001 0`; // dot
  for (const s of segs) d += `Q${f(s[0])} ${f(s[1])} ${f(s[2])} ${f(s[3])}`;
  return d;
}
export const f = (v) => (Math.round(v * 100) / 100).toString();

export function fileNameFromUrl(url) {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
    if (last) return /\.pdf$/i.test(last) ? last : last + '.pdf';
  } catch { /* ignore */ }
  return 'document.pdf';
}

export function formatDate(ts) {
  try { return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return ''; }
}
