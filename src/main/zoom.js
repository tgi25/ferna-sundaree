'use strict';
// Zoom in the style of Zoom Page WE: full zoom or text-only zoom, per site or per tab,
// zoom levels or fixed steps, AutoFit (fit to width), and a minimum font size.
//
// Full zoom uses Chromium's zoom (per-site mode) or CSS zoom (per-tab mode, because
// Chromium shares its zoom between tabs of the same site). Text zoom and the minimum
// font size are applied by a small script in an isolated world: page scripts cannot
// see or change it, and it follows content that loads later.

const ISOLATED_WORLD = 7782;

const DEFAULTS = {
  mode: 'site',                 // 'site' | 'tab'
  defaultType: 'full',          // 'full' | 'text'
  defaultFull: 100,
  defaultText: 100,
  defaultNonText: 100,
  levels: [30, 50, 67, 80, 90, 100, 110, 120, 133, 150, 170, 200, 240, 300, 400, 500],
  stepMode: 'levels',           // 'levels' | 'fixed'
  step: 10,
  smallStep: 2,
  autofitMin: 50,
  autofitMax: 200,
  autofitOnLoad: false,
  minFont: 0,                   // px, 0 = off
  lineSpacing: 1,               // line-height factor used by text zoom
  subdomainsSeparate: false,
};

const MIN = 25;
const MAX = 500;
const clamp = v => Math.max(MIN, Math.min(MAX, Math.round(v)));

function siteKey(url, prefs) {
  let u;
  try { u = new URL(url); } catch { return ''; }
  if (!/^(https?|file):$/.test(u.protocol)) return '';
  if (u.protocol === 'file:') return 'file://';
  const h = u.hostname.toLowerCase();
  if (prefs.subdomainsSeparate || /^[\d.]+$/.test(h) || h.includes(':') || h.startsWith('[') || !h.includes('.')) return u.port ? `${h}:${u.port}` : h;
  const parts = h.split('.');
  // keep e.g. "ac.lk", "co.uk" style second-level suffixes together with the name
  if (parts.length > 2 && parts[parts.length - 2].length <= 3 && parts[parts.length - 1].length === 2) return parts.slice(-3).join('.');
  return parts.length > 2 ? parts.slice(-2).join('.') : h;
}

/** Next zoom level in a direction ('in' | 'out'), by level list or fixed step. */
function nextLevel(cur, dir, prefs, small = false) {
  if (small) return clamp(cur + (dir === 'in' ? 1 : -1) * (prefs.smallStep || 2));
  if (prefs.stepMode === 'fixed') return clamp(cur + (dir === 'in' ? 1 : -1) * (prefs.step || 10));
  const levels = [...new Set(prefs.levels.map(clamp))].sort((a, b) => a - b);
  if (dir === 'in') return levels.find(l => l > cur + 0.5) || levels[levels.length - 1];
  return [...levels].reverse().find(l => l < cur - 0.5) || levels[0];
}

/** Default state for a page. */
function defaultState(prefs) {
  return { type: prefs.defaultType, full: prefs.defaultFull, text: prefs.defaultText, nonText: prefs.defaultNonText, minFont: prefs.minFont };
}

/** What to apply to the page: browser/CSS full factor and the text factor. */
function effective(state, prefs) {
  const pageLevel = state.type === 'text' ? state.nonText : state.full;
  const textFactor = state.type === 'text' ? state.text / state.nonText : 1;
  return {
    pageFactor: clamp(pageLevel) / 100,
    textFactor: Math.round(textFactor * 1000) / 1000,
    minFont: Math.max(0, Math.min(40, state.minFont || 0)),
    lineSpacing: prefs.lineSpacing || 1,
    useCss: prefs.mode === 'tab',
  };
}

/** Level shown on the badge. */
function displayLevel(state) { return state.type === 'text' ? state.text : state.full; }

// The isolated-world script. It records each element's original font size before
// changing anything (reading new subtrees with their parent temporarily unscaled),
// so repeated zooms never compound, and restores pages exactly at 100 %.
const TEXT_ZOOM_SCRIPT = `(() => {
  if (window.__fernaTZ) return;
  const orig = new WeakMap(), lh = new WeakMap();
  const touched = new Set();
  let factor = 1, minFont = 0, spacing = 1, observer = null, pending = new Set(), raf = 0;
  const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','HEAD','META','LINK','TITLE','SVG','svg','PATH','path','BR','IMG','VIDEO','CANVAS','IFRAME','OBJECT','EMBED','INPUT','SELECT','OPTION']);
  const hasText = el => { for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) return true; return false; };
  function record(el) {
    if (orig.has(el)) return;
    const cs = getComputedStyle(el);
    orig.set(el, parseFloat(cs.fontSize) || 16);
    const l = cs.lineHeight;
    lh.set(el, l.endsWith('px') ? parseFloat(l) : null);
  }
  function apply(el) {
    const o = orig.get(el);
    if (o === undefined) return;
    let size = o * factor;
    if (minFont && hasText(el) && size < minFont) size = minFont;
    if (Math.abs(size - o) < 0.01) {
      if (touched.has(el)) { el.style.removeProperty('font-size'); el.style.removeProperty('line-height'); touched.delete(el); }
      return;
    }
    el.style.setProperty('font-size', size.toFixed(2) + 'px', 'important');
    const l = lh.get(el);
    if (l) el.style.setProperty('line-height', (l * (size / o) * spacing).toFixed(2) + 'px', 'important');
    touched.add(el);
  }
  function elements(root) {
    const out = [];
    if (root.nodeType !== 1 || SKIP.has(root.tagName)) return out;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, { acceptNode: n => SKIP.has(n.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    out.push(root);
    while (w.nextNode() && out.length < 60000) out.push(w.currentNode);
    return out;
  }
  function addSubtree(root) {
    const els = elements(root).filter(e => !orig.has(e));
    if (!els.length) return;
    // Read originals with the parent's own size temporarily restored, so values are unscaled.
    const p = root.parentElement;
    let saved = null;
    if (p && touched.has(p)) { saved = p.style.getPropertyValue('font-size'); p.style.setProperty('font-size', orig.get(p) + 'px', 'important'); }
    for (const e of els) { if (touched.has(e)) { e.style.removeProperty('font-size'); e.style.removeProperty('line-height'); touched.delete(e); } }
    els.forEach(record);
    if (saved !== null) p.style.setProperty('font-size', saved, 'important');
    els.forEach(apply);
  }
  function flush() {
    raf = 0;
    const roots = [...pending]; pending.clear();
    for (const r of roots) if (r.isConnected) addSubtree(r);
  }
  function watch(on) {
    if (on && !observer) {
      observer = new MutationObserver(ms => {
        for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) pending.add(n);
        if (pending.size && !raf) raf = requestAnimationFrame(flush);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    } else if (!on && observer) { observer.disconnect(); observer = null; }
  }
  window.__fernaTZ = (f, m, s) => {
    factor = f; minFont = m; spacing = s || 1;
    const active = Math.abs(factor - 1) > 0.001 || minFont > 0;
    if (!document.documentElement) return;
    if (!active) { for (const e of [...touched]) { if (e.isConnected) { e.style.removeProperty('font-size'); e.style.removeProperty('line-height'); } } touched.clear(); watch(false); return; }
    const all = elements(document.body || document.documentElement);
    for (const e of all) if (touched.has(e)) { e.style.removeProperty('font-size'); e.style.removeProperty('line-height'); touched.delete(e); }
    all.forEach(record);
    all.forEach(apply);
    watch(true);
  };
})()`;

// AutoFit: width of the page's real content (text, media and boxes with a background),
// so narrow fixed-width sites are zoomed up and over-wide ones down.
const MEASURE_SCRIPT = `(() => {
  const vw = document.documentElement.clientWidth || innerWidth;
  let left = Infinity, right = -Infinity, n = 0;
  const els = document.body ? document.body.getElementsByTagName('*') : [];
  for (let i = 0; i < els.length && n < 8000; i++) {
    const el = els[i];
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.width >= vw * 0.995) continue;
    const media = /^(IMG|VIDEO|CANVAS|SVG|svg|IFRAME|PICTURE)$/.test(el.tagName);
    let text = false;
    for (const c of el.childNodes) if (c.nodeType === 3 && c.nodeValue.trim()) { text = true; break; }
    if (!media && !text) continue;
    n++;
    left = Math.min(left, r.left + scrollX);
    right = Math.max(right, r.right + scrollX);
  }
  const sw = document.documentElement.scrollWidth;
  return { vw, left: isFinite(left) ? left : 0, right: isFinite(right) ? right : vw, sw };
})()`;

function autofitLevel(m, currentLevel, prefs) {
  const contentCss = Math.max(m.right - m.left, 1);
  const widthCss = m.sw > m.vw + 2 ? m.sw : contentCss;
  const target = currentLevel * ((m.vw - 32) / widthCss);
  return Math.max(prefs.autofitMin, Math.min(prefs.autofitMax, clamp(target)));
}

module.exports = { DEFAULTS, ISOLATED_WORLD, TEXT_ZOOM_SCRIPT, MEASURE_SCRIPT, siteKey, nextLevel, defaultState, effective, displayLevel, autofitLevel, clamp };
