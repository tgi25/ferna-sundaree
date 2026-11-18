// Ferna Zoom — zoom logic shared by the background worker and the pages (from Ferna Sundaree).
// Full zoom (the browser's zoom) or text-only zoom, per site or per tab, zoom levels or fixed
// steps, AutoFit (fit to width) and a minimum font size, in the style of Zoom Page WE.

export const DEFAULTS = {
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

export const MIN = 25;
export const MAX = 500;
export const clamp = v => Math.max(MIN, Math.min(MAX, Math.round(v)));

export function siteKey(url, prefs) {
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
export function nextLevel(cur, dir, prefs, small = false) {
  if (small) return clamp(cur + (dir === 'in' ? 1 : -1) * (prefs.smallStep || 2));
  if (prefs.stepMode === 'fixed') return clamp(cur + (dir === 'in' ? 1 : -1) * (prefs.step || 10));
  const levels = [...new Set(prefs.levels.map(clamp))].sort((a, b) => a - b);
  if (dir === 'in') return levels.find(l => l > cur + 0.5) || levels[levels.length - 1];
  return [...levels].reverse().find(l => l < cur - 0.5) || levels[0];
}

/** Default state for a page. */
export function defaultState(prefs) {
  return { type: prefs.defaultType, full: prefs.defaultFull, text: prefs.defaultText, nonText: prefs.defaultNonText, minFont: prefs.minFont };
}

/** What to apply to the page: browser/CSS full factor and the text factor. */
export function effective(state, prefs) {
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
export function displayLevel(state) { return state.type === 'text' ? state.text : state.full; }

export function autofitLevel(m, currentLevel, prefs) {
  const contentCss = Math.max(m.right - m.left, 1);
  const widthCss = m.sw > m.vw + 2 ? m.sw : contentCss;
  const target = currentLevel * ((m.vw - 32) / widthCss);
  return Math.max(prefs.autofitMin, Math.min(prefs.autofitMax, clamp(target)));
}


export const FONTS = [0, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24];

/** Stored preferences, checked and completed with the defaults. */
export function cleanPrefs(p) {
  p = { ...DEFAULTS, ...(p && typeof p === 'object' ? p : {}) };
  const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : d);
  p.mode = p.mode === 'tab' ? 'tab' : 'site';
  p.defaultType = p.defaultType === 'text' ? 'text' : 'full';
  p.defaultFull = num(p.defaultFull, MIN, MAX, 100);
  p.defaultText = num(p.defaultText, MIN, MAX, 100);
  p.defaultNonText = num(p.defaultNonText, MIN, MAX, 100);
  p.levels = (Array.isArray(p.levels) ? p.levels : DEFAULTS.levels).map(Number).filter(Number.isFinite).map(clamp);
  if (!p.levels.length) p.levels = DEFAULTS.levels.slice();
  p.stepMode = p.stepMode === 'fixed' ? 'fixed' : 'levels';
  p.step = num(p.step, 1, 100, 10);
  p.smallStep = num(p.smallStep, 1, 20, 2);
  p.autofitMin = num(p.autofitMin, MIN, MAX, 50);
  p.autofitMax = num(p.autofitMax, MIN, MAX, 200);
  p.autofitOnLoad = !!p.autofitOnLoad;
  p.minFont = num(p.minFont, 0, 40, 0);
  p.lineSpacing = Math.max(0.8, Math.min(2, Number(p.lineSpacing) || 1));
  p.subdomainsSeparate = !!p.subdomainsSeparate;
  p.badge = p.badge !== false;
  p.wheel = !!p.wheel;
  p.canvasFallback = p.canvasFallback !== false;
  return p;
}
