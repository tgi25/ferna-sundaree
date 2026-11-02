'use strict';
// Context-aware themes: the browser's colours follow what you are doing.
//   • Workspace themes: each workspace gets its own colours (from its colour, or ones you pick),
//     so you can tell Work from Study at a glance.
//   • Adaptive colour: outside a workspace, the bars take the main colour of the site you are on
//     (taken from a small capture of the top of the page).
//   • Scheduled dark / light mode at the times you choose.
// In Secure Exam Mode all of this is off: the exam window uses the plain neutral look.

const { nativeTheme } = require('electron');

const hex = c => /^#[0-9a-f]{6}$/i.test(c || '') ? c.toLowerCase() : null;
const toRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const toHex = rgb => `#${rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, t) => toHex(toRgb(a).map((v, i) => v * (1 - t) + toRgb(b)[i] * t));

/** Bar colours from one accent colour, for light or dark mode. */
function palette(accent, dark) {
  accent = hex(accent);
  if (!accent) return null;
  return dark
    ? { accent: mix(accent, '#ffffff', 0.15), frame: mix(accent, '#0b1222', 0.78), toolbar: mix(accent, '#0f172a', 0.86) }
    : { accent, frame: mix(accent, '#ffffff', 0.8), toolbar: mix(accent, '#ffffff', 0.91) };
}

/** Dominant saturated colour of a BGRA bitmap (null for grey pages). */
function dominant(bitmap, width, height) {
  const buckets = new Map();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const b = bitmap[i], g = bitmap[i + 1], r = bitmap[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const v = max / 255, s = max ? (max - min) / max : 0;
    if (s < 0.35 || v < 0.2 || v > 0.97) continue;
    let h;
    if (max === r) h = ((g - b) / (max - min)) % 6; else if (max === g) h = (b - r) / (max - min) + 2; else h = (r - g) / (max - min) + 4;
    const k = Math.round(((h * 60 + 360) % 360) / 20);
    const e = buckets.get(k) || { n: 0, r: 0, g: 0, b: 0 };
    const w = s * v;
    e.n += w; e.r += r * w; e.g += g * w; e.b += b * w;
    buckets.set(k, e);
  }
  let best = null;
  for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
  if (!best || best.n < width * height * 0.04) return null;
  return toHex([best.r / best.n, best.g / best.n, best.b / best.n]);
}

function install(ctx) {
  ctx.ctxTheme = win => {
    if (win.exam) return null;
    const s = ctx.settings.data;
    const dark = ctx.isDark();
    if (win.currentWs && s.workspaceThemes !== false) {
      const w = ctx.ws.data.workspaces.find(x => x.id === win.currentWs);
      if (w) {
        const t = w.theme || {};
        const p = palette(t.accent || w.color, dark);
        if (p) return { ...p, ...(hex(t.frame) && !dark ? { frame: t.frame } : {}), ...(hex(t.toolbar) && !dark ? { toolbar: t.toolbar } : {}), source: 'workspace', name: w.name };
      }
    }
    const tab = win.active;
    if (s.adaptiveTheme && tab && tab.dominant && !win.private) { const p = palette(tab.dominant, dark); if (p) return { ...p, source: 'page' }; }
    return null;
  };

  /** Sample the top of the active page for its main colour (adaptive colour). */
  ctx.sampleTabColour = async (win, tab) => {
    if (!ctx.settings.data.adaptiveTheme || !tab || tab.kind !== 'web' || !tab.view || tab.view.webContents.isDestroyed() || win.exam) return;
    try {
      const b = tab.view.getBounds();
      const img = await tab.view.webContents.capturePage({ x: 0, y: 0, width: Math.max(1, b.width), height: Math.min(160, Math.max(1, b.height)) });
      if (img.isEmpty()) return;
      const small = img.resize({ width: 64 });
      const { width, height } = small.getSize();
      const c = dominant(small.toBitmap(), width, height);
      if (c !== tab.dominant) { tab.dominant = c; win.pushState(); }
    } catch { /* page gone */ }
  };

  // Scheduled dark / light mode.
  const minutes = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
  const tick = () => {
    const sc = ctx.settings.data.themeSchedule;
    if (!sc || !sc.on) return;
    const now = new Date(); const n = now.getHours() * 60 + now.getMinutes();
    const d = minutes(sc.dark), l = minutes(sc.light);
    const isDark = d > l ? (n >= d || n < l) : (n >= d && n < l);
    const want = isDark ? 'dark' : 'light';
    if (nativeTheme.themeSource !== want) { nativeTheme.themeSource = want; ctx.broadcast(); }
  };
  ctx.applyThemeSchedule = () => {
    const sc = ctx.settings.data.themeSchedule;
    if (sc && sc.on) tick(); else nativeTheme.themeSource = ctx.settings.data.theme || 'system';
  };
  setInterval(tick, 60000).unref?.();
  tick();
}

module.exports = { install, palette, dominant, mix };
