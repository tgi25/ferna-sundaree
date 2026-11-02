'use strict';
// Screenshot capture (built-in Ferna Screenshots). Works from outside the page:
// visible area via capturePage, whole page via Chromium's DevTools protocol in one
// shot (no scroll-and-stitch), and an element picker that runs in an isolated world.

const { nativeImage } = require('electron');

const MAX_CSS_HEIGHT = 30000;
const MAX_SIDE_PX = 32000;
const ISOLATED_WORLD = 7781;

async function captureVisible(wc) {
  const img = await wc.capturePage();
  return img;
}

async function pageMetrics(wc) {
  return wc.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD, [{
    code: `({ scrollX: scrollX, scrollY: scrollY, dpr: devicePixelRatio,
       w: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0),
       h: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0),
       vw: innerWidth, vh: innerHeight })`,
  }]);
}

/** Whole page as one image. Falls back to the visible area if DevTools holds the debugger. */
async function captureFull(wc, opts = {}) {
  const maxCss = opts.maxHeight || MAX_CSS_HEIGHT;
  const dbg = wc.debugger;
  let attachedHere = false;
  try {
    if (!dbg.isAttached()) { dbg.attach('1.3'); attachedHere = true; }
  } catch {
    return { image: await captureVisible(wc), partial: true };
  }
  try {
    const m = await dbg.sendCommand('Page.getLayoutMetrics');
    const size = m.cssContentSize || m.contentSize;
    const vp = m.cssLayoutViewport || m.layoutViewport;
    const width = Math.max(1, Math.ceil(Math.max(size.width, vp.clientWidth)));
    const height = Math.max(1, Math.ceil(Math.min(Math.max(size.height, vp.clientHeight), maxCss)));
    const dpr = (await pageMetrics(wc).catch(() => ({ dpr: 1 }))).dpr || 1;
    // Keep within the canvas limits used by the editor.
    // 'css' resolution: one image pixel per CSS pixel; otherwise device pixels (sharp on HiDPI).
    const base = opts.cssPixels ? 1 / dpr : 1;
    const scale = Math.min(base, MAX_SIDE_PX / (height * dpr), MAX_SIDE_PX / (width * dpr));
    const shot = await dbg.sendCommand('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true, fromSurface: true,
      clip: { x: 0, y: 0, width, height, scale },
    });
    return { image: nativeImage.createFromBuffer(Buffer.from(shot.data, 'base64')), partial: height < Math.ceil(size.height), downscaled: scale < base - 1e-6, cssWidth: width, cssHeight: height };
  } finally {
    if (attachedHere) { try { dbg.detach(); } catch { /* already gone */ } }
  }
}

/** Crop a full-page image to a CSS-pixel rectangle. */
function cropCss(image, rect, cssWidth) {
  const s = image.getSize();
  const k = cssWidth ? s.width / cssWidth : 1;
  const x = Math.max(0, Math.round(rect.x * k));
  const y = Math.max(0, Math.round(rect.y * k));
  const w = Math.max(1, Math.min(s.width - x, Math.round(rect.width * k)));
  const h = Math.max(1, Math.min(s.height - y, Math.round(rect.height * k)));
  return image.crop({ x, y, width: w, height: h });
}

// Element picker: a highlight inside a closed shadow root, driven from an isolated
// world so page scripts cannot see or alter the picker's code or variables.
const PICKER = `new Promise(resolve => {
  const host = document.createElement('ferna-picker');
  const root = host.attachShadow({ mode: 'closed' });
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #2563eb;background:rgba(37,99,235,.15);border-radius:3px;transition:all .05s';
  const tip = document.createElement('div');
  tip.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483647;font:13px system-ui;background:#1e293b;color:#fff;padding:6px 12px;border-radius:6px;pointer-events:none';
  tip.textContent = 'Click an element to capture it \\u00b7 \\u2191/\\u2193 parent/child \\u00b7 Esc cancels';
  root.append(box, tip);
  document.documentElement.appendChild(host);
  let cur = null;
  const show = el => { cur = el; const r = el.getBoundingClientRect(); Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' }); };
  const move = e => { const el = document.elementFromPoint(e.clientX, e.clientY); if (el && el !== host) show(el); };
  const done = val => { removeEventListener('mousemove', move, true); removeEventListener('click', click, true); removeEventListener('keydown', key, true); host.remove(); resolve(val); };
  const click = e => { e.preventDefault(); e.stopImmediatePropagation(); if (!cur) return; const r = cur.getBoundingClientRect(); done({ x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }); };
  const key = e => { if (e.key === 'Escape') { e.preventDefault(); done(null); } else if (e.key === 'ArrowUp' && cur && cur.parentElement) { e.preventDefault(); show(cur.parentElement); } else if (e.key === 'ArrowDown' && cur && cur.firstElementChild) { e.preventDefault(); show(cur.firstElementChild); } };
  addEventListener('mousemove', move, true); addEventListener('click', click, true); addEventListener('keydown', key, true);
})`;

async function pickElement(wc) {
  return wc.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD, [{ code: PICKER }], true);
}

module.exports = { captureVisible, captureFull, cropCss, pickElement, pageMetrics };
