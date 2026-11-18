// Ferna Zoom — the part that runs in web pages (an isolated world: page scripts cannot see it).
// Text-only zoom and the minimum font size change each element's font size from its original
// value (so zooms never compound and 100 % restores the page exactly); in per-tab mode the full
// zoom is a CSS zoom on the page, because the browser's zoom is shared by a site's tabs.
(() => {
if (window.__fernaZoom) return;
window.__fernaZoom = true;

  // ---- text zoom engine ----
  // Each element's original font size (and pixel line height) is measured once, with its parent
  // set back to its own original size, then the element gets size × factor as an !important
  // inline style. Pages that keep changing (web apps such as Gmail) are followed: new elements,
  // elements whose class or style the page changes, style sheets that arrive after the content,
  // and open or closed shadow roots.
  let orig = new WeakMap(); // element → { fs, lh }
  const touched = new Set();
  let factor = 1, minFont = 0, spacing = 1, active = false;
  let observer = null, raf = 0, sheetTimer = 0;
  const pending = new Set(), restyle = new Set(), roots = new Set();
  const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','HEAD','META','LINK','TITLE','SVG','svg','PATH','path','BR','IMG','VIDEO','CANVAS','IFRAME','OBJECT','EMBED','INPUT','SELECT','OPTION','PICTURE','SOURCE','AUDIO']);
  const hasText = el => { for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) return true; return false; };
  const shadowOf = el => { try { return (chrome.dom && chrome.dom.openOrClosedShadowRoot) ? chrome.dom.openOrClosedShadowRoot(el) : el.shadowRoot; } catch { return el.shadowRoot; } };
  const parentOf = el => el.parentElement || (el.parentNode && el.parentNode.host) || null;

  function clear(el) {
    if (!touched.has(el)) return;
    el.style.removeProperty('font-size'); el.style.removeProperty('line-height');
    touched.delete(el);
  }
  function want(el) {
    const o = orig.get(el);
    if (!o) return null;
    let size = o.fs * factor;
    if (minFont && size < minFont && hasText(el)) size = minFont;
    if (Math.abs(size - o.fs) < 0.01) return null;
    return { fs: size.toFixed(2) + 'px', lh: o.lh ? (o.lh * (size / o.fs) * spacing).toFixed(2) + 'px' : '' };
  }
  // Whether an inline property already holds our value (the browser writes 24.00px back as 24px).
  const holds = (st, prop, v) => st.getPropertyPriority(prop) === 'important' && Math.abs(parseFloat(st.getPropertyValue(prop)) - parseFloat(v)) < 0.01;
  function apply(el) {
    const w = want(el);
    if (!w) { clear(el); return; }
    const st = el.style;
    if (!holds(st, 'font-size', w.fs)) st.setProperty('font-size', w.fs, 'important');
    if (w.lh && !holds(st, 'line-height', w.lh)) st.setProperty('line-height', w.lh, 'important');
    touched.add(el);
  }
  /** Elements of a subtree, going into shadow roots (which are watched as well). */
  function elements(root, out = [], depth = 0) {
    if (!root || out.length >= 80000 || depth > 30) return out;
    if (root.nodeType === 1 && SKIP.has(root.tagName)) return out;
    const start = root.nodeType === 11 ? root : root;
    if (root.nodeType === 1) out.push(root);
    const w = document.createTreeWalker(start, NodeFilter.SHOW_ELEMENT, { acceptNode: n => SKIP.has(n.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const hosts = [];
    if (root.nodeType === 1 && shadowOf(root)) hosts.push(root);
    while (w.nextNode() && out.length < 80000) { const n = w.currentNode; out.push(n); if (shadowOf(n)) hosts.push(n); }
    for (const h of hosts) { const sr = shadowOf(h); if (sr) { observeRoot(sr); elements(sr, out, depth + 1).length; } }
    return out;
  }
  /** Measure the originals of these elements (all unmeasured or to be re-measured), then zoom them. */
  function measure(els) {
    if (!els.length) return;
    const set = new Set(els);
    // Parents outside the set that are zoomed: put them back to their original size while reading.
    const saved = [];
    for (const e of els) {
      const p = parentOf(e);
      if (p && !set.has(p) && touched.has(p) && !saved.some(x => x[0] === p)) { saved.push([p, p.style.getPropertyValue('font-size')]); p.style.setProperty('font-size', orig.get(p).fs + 'px', 'important'); }
    }
    for (const e of els) clear(e);
    for (const e of els) {
      const cs = getComputedStyle(e);
      const l = cs.lineHeight;
      orig.set(e, { fs: parseFloat(cs.fontSize) || 16, lh: l.endsWith('px') ? parseFloat(l) : null });
    }
    for (const [p, v] of saved) p.style.setProperty('font-size', v, 'important');
    for (const e of els) apply(e);
  }
  function full() {
    orig = new WeakMap();
    for (const e of [...touched]) if (e.isConnected) clear(e); else touched.delete(e);
    measure(elements(document.body || document.documentElement));
  }
  function flush() {
    raf = 0;
    if (!active) { pending.clear(); restyle.clear(); return; }
    const fresh = [];
    for (const r of pending) if (r.isConnected) for (const e of elements(r)) if (!orig.has(e)) fresh.push(e);
    pending.clear();
    // Elements whose class or style the page changed: measure again (only if our size was lost or
    // their own size may have changed).
    const again = [];
    for (const e of restyle) if (e.isConnected && orig.has(e)) again.push(e);
    restyle.clear();
    measure([...new Set([...fresh, ...again])]);
  }
  const later = () => { if (!raf) raf = requestAnimationFrame(flush); };
  // Style sheets added or changed after the content (web apps load theirs late): measure again,
  // at most every 1.5 s.
  let lastFull = 0;
  function sheetsChanged() {
    clearTimeout(sheetTimer);
    const wait = Math.max(350, lastFull + 1500 - Date.now());
    sheetTimer = setTimeout(() => { if (active) { lastFull = Date.now(); full(); } }, wait);
  }
  function onMutations(ms) {
    for (const m of ms) {
      if (m.type === 'childList') {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.id === 'ferna-zoom-css') continue;
          if (n.tagName === 'STYLE' || (n.tagName === 'LINK' && /stylesheet/i.test(n.rel))) {
            sheetsChanged();
            if (n.tagName === 'LINK') n.addEventListener('load', sheetsChanged, { once: true });
          } else pending.add(n);
        }
        if (m.target.nodeType === 1 && m.target.tagName === 'STYLE' && m.target.id !== 'ferna-zoom-css') sheetsChanged();
      } else if (m.type === 'characterData') {
        const p = m.target.parentNode;
        if (p && p.tagName === 'STYLE' && p.id !== 'ferna-zoom-css') sheetsChanged();
      } else if (m.type === 'attributes') {
        const el = m.target;
        if (!orig.has(el)) continue;
        if (m.attributeName === 'style') {
          // Our own change, or still as we set it: nothing to do.
          const w = want(el), st = el.style;
          if (w ? holds(st, 'font-size', w.fs) : !touched.has(el) || !st.getPropertyValue('font-size')) continue;
        }
        restyle.add(el);
      }
    }
    if (pending.size || restyle.size) later();
  }
  function observeRoot(root) {
    if (!observer || roots.has(root)) return;
    roots.add(root);
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style'] });
  }
  function watch(on) {
    if (on && !observer) {
      observer = new MutationObserver(onMutations);
      roots.clear();
      observeRoot(document.documentElement);
    } else if (!on && observer) { observer.disconnect(); observer = null; roots.clear(); }
  }
  let applied = '';
  const textZoom = (f, m, s) => {
    // Same settings as last time: nothing to do (repeating the full pass makes the page re-lay out).
    const sig = `${f}|${m}|${s || 1}`;
    if (sig === applied) return;
    applied = sig;
    factor = f; minFont = m; spacing = s || 1;
    const was = active;
    active = Math.abs(factor - 1) > 0.001 || minFont > 0;
    if (!document.documentElement) return;
    if (!active) { for (const e of [...touched]) if (e.isConnected) clear(e); touched.clear(); watch(false); return; }
    watch(true);
    // Just switched on (the page may have changed unseen meanwhile): measure everything afresh.
    if (!was || !orig.has(document.body || document.documentElement)) { lastFull = Date.now(); full(); }
    else { for (const e of elements(document.body || document.documentElement)) if (orig.has(e)) apply(e); else pending.add(e); later(); }
  };

  // Pages that draw their text as pictures (Google Docs and Sheets draw the document on a canvas):
  // text zoom cannot reach that text, so the background zooms the whole page there instead.
  function canvasText() {
    if (window.top !== window || !document.body) return false;
    if (document.querySelector('.kix-canvas-tile-content, .kix-appview-editor canvas, #waffle-grid-container canvas, .waffle-canvas, .grid-container canvas')) return true;
    const vw = innerWidth, vh = innerHeight;
    for (const c of document.getElementsByTagName('canvas')) {
      const r = c.getBoundingClientRect();
      const w = Math.min(r.right, vw) - Math.max(r.left, 0), h = Math.min(r.bottom, vh) - Math.max(r.top, 0);
      if (w > 0 && h > 0 && w * h >= vw * vh * 0.5 && /docs\.google\.com$/.test(location.hostname)) return true;
    }
    return false;
  }
  let canvasSent = false;
  function checkCanvas() {
    if (canvasSent || window.top !== window) return;
    if (canvasText()) { canvasSent = true; chrome.runtime.sendMessage({ t: 'canvasText' }).catch(() => {}); }
  }
  if (window.top === window) for (const ms of [800, 2500, 6000]) setTimeout(checkCanvas, ms);

function measurePage() {
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
}

// Per-tab mode: full zoom as CSS zoom on the top page.
let cssStyle = null;
function cssZoom(f) {
  if (window.top !== window) return;
  if (Math.abs(f - 1) < 0.001) { if (cssStyle) { cssStyle.remove(); cssStyle = null; } return; }
  if (!cssStyle) { cssStyle = document.createElement('style'); cssStyle.id = 'ferna-zoom-css'; }
  const css = `html { zoom: ${f} !important; }`;
  if (cssStyle.textContent !== css) cssStyle.textContent = css;
  if (!cssStyle.isConnected) (document.head || document.documentElement).appendChild(cssStyle);
}

let last = null;
let pendingGo = null;
function applyZoom(e) {
  last = e;
  if (pendingGo) { document.removeEventListener('DOMContentLoaded', pendingGo); pendingGo = null; }
  const go = () => { cssZoom(e.css || 1); textZoom(e.textFactor, e.minFont, e.lineSpacing); };
  if (document.body) go(); else { pendingGo = go; document.addEventListener('DOMContentLoaded', go, { once: true }); }
}

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'apply') {
    applyZoom(m.e); reply(true);
    // Text zoom asked for on a page known to draw its text: remind the background (it may have restarted).
    if (canvasSent && Math.abs((m.e.textFactor || 1) - 1) > 0.001) chrome.runtime.sendMessage({ t: 'canvasText' }).catch(() => {});
  }
  else if (m.t === 'measure') { if (window.top === window) { reply(measurePage()); } }
});
// Ctrl + mouse wheel in text-zoom mode zooms the text (when turned on in the settings).
window.addEventListener('wheel', ev => {
  if (!ev.ctrlKey || !last || !last.wheelText) return;
  ev.preventDefault();
  ev.stopImmediatePropagation();
  chrome.runtime.sendMessage({ t: 'act', action: (ev.deltaY < 0 ? 'in' : 'out') + (ev.shiftKey ? 'Small' : '') }).catch(() => {});
}, { passive: false, capture: true });

// Ask for this page's zoom as soon as the page starts.
chrome.runtime.sendMessage({ t: 'hello', top: window.top === window }).then(e => { if (e) applyZoom(e); }).catch(() => {});
})();
