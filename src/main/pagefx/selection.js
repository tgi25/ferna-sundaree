'use strict';
// Text selection menu (SelectON style): when text is selected on a page, a small bar appears
// next to the selection with Copy, Search the web and, for an address, Open.
//
// Runs in an isolated world (no page access to its code), drawn in a closed shadow root.
// It has no channel to the browser: Copy uses the page's own copy command, Search and Open
// use window.open, which the browser turns into a new tab like any link.

const WORLD = 7784;

const SCRIPT = String.raw`(() => {
  if (window.__fernaSel) return;
  const S = { on: true, engine: 'Google', search: 'https://www.google.com/search?q=%s' };
  let host = null, root = null, bar = null, shownFor = '';

  function build() {
    host = document.createElement('ferna-selection-menu');
    host.style.cssText = 'all:initial;position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;';
    root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = '<style>' +
      ':host{all:initial}' +
      '.bar{position:absolute;display:flex;gap:2px;padding:3px;border-radius:9px;background:#1f2937;color:#f9fafb;' +
      'box-shadow:0 6px 20px rgba(0,0,0,.28);font:12.5px/1 "Segoe UI",system-ui,sans-serif;white-space:nowrap;' +
      'opacity:0;transform:translateY(3px);transition:opacity .12s,transform .12s;user-select:none}' +
      '.bar.on{opacity:1;transform:none}' +
      'button{all:unset;display:flex;align-items:center;gap:5px;padding:6px 8px;border-radius:6px;cursor:pointer;color:inherit}' +
      'button:hover,button:focus-visible{background:rgba(255,255,255,.14)}' +
      'svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}' +
      '.sep{width:1px;margin:4px 1px;background:rgba(255,255,255,.18)}' +
      '</style><div class="bar" role="toolbar" aria-label="Selection"></div>';
    bar = root.querySelector('.bar');
    // Keep the page selection when the bar is pressed.
    bar.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); }, true);
    bar.addEventListener('click', onClick, true);
  }

  const ICON = {
    copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>',
    open: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  };

  function selectedText() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return '';
    const a = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
    if (a && a.closest && a.closest('input,textarea,[contenteditable=""],[contenteditable="true"]')) return '';
    return sel.toString().trim();
  }
  function asAddress(t) {
    if (/\s/.test(t) || t.length > 2000) return '';
    if (/^https?:\/\/\S+$/i.test(t)) return t;
    if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}(\/\S*)?$/i.test(t)) return 'https://' + t;
    return '';
  }

  function show() {
    if (!S.on) return hide();
    const text = selectedText();
    if (!text) return hide();
    const sel = window.getSelection();
    const rects = sel.getRangeAt(0).getClientRects();
    const r = rects.length ? rects[rects.length - 1] : sel.getRangeAt(0).getBoundingClientRect();
    if (!r || (!r.width && !r.height)) return hide();
    if (!host) build();
    if (!host.isConnected) (document.body || document.documentElement).appendChild(host);
    const addr = asAddress(text);
    bar.innerHTML =
      '<button data-a="copy" title="Copy">' + ICON.copy + '<span>Copy</span></button><span class="sep"></span>' +
      '<button data-a="search" title="Search ' + S.engine.replace(/[<&"]/g, '') + ' in a new tab">' + ICON.search + '<span>Search</span></button>' +
      (addr ? '<span class="sep"></span><button data-a="open" title="Open in a new tab">' + ICON.open + '<span>Open</span></button>' : '') +
      '<span class="sep"></span><button data-a="translate" title="Translate"><span>Translate</span></button>' +
      '<button data-a="speak" title="Read aloud"><span>🔊</span></button>' +
      '<button data-a="ask" title="Ask the AI assistant"><span>✨ Ask</span></button>';
    bar.classList.remove('on');
    const sx = window.scrollX, sy = window.scrollY;
    const bw = bar.offsetWidth || 180, bh = bar.offsetHeight || 32;
    let x = r.right + sx - bw / 2, y = r.bottom + sy + 8;
    if (r.bottom + bh + 12 > innerHeight) y = r.top + sy - bh - 8;
    x = Math.max(sx + 6, Math.min(x, sx + document.documentElement.clientWidth - bw - 6));
    bar.style.left = x + 'px';
    bar.style.top = Math.max(sy + 4, y) + 'px';
    shownFor = text;
    requestAnimationFrame(() => bar.classList.add('on'));
  }
  function hide() {
    shownFor = '';
    if (bar) bar.classList.remove('on');
    if (host && host.isConnected) host.remove();
  }

  function onClick(e) {
    if (!e.isTrusted) return;
    const b = e.target.closest && e.target.closest('button');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const text = shownFor || selectedText();
    if (b.dataset.a === 'copy') {
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      if (!ok && navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    } else if (b.dataset.a === 'search') {
      window.open(S.search.replace('%s', encodeURIComponent(text.slice(0, 500))), '_blank', 'noopener');
    } else if (b.dataset.a === 'translate' || b.dataset.a === 'speak' || b.dataset.a === 'ask') {
      // Handed to the browser, which checks that you just clicked (see window.js).
      window.open('https://ferna-action.invalid/' + b.dataset.a + '?t=' + encodeURIComponent(text.slice(0, 5000)), '_blank');
    } else if (b.dataset.a === 'open') {
      const u = asAddress(text);
      if (u) window.open(u, '_blank', 'noopener');
    }
    hide();
  }

  let timer = 0;
  const later = () => { clearTimeout(timer); timer = setTimeout(show, 10); };
  document.addEventListener('mouseup', e => { if (host && e.composedPath().includes(host)) return; if (e.isTrusted && e.button === 0) later(); }, true);
  document.addEventListener('keyup', e => { if (e.isTrusted && (e.shiftKey || (e.ctrlKey && e.key.toLowerCase() === 'a'))) later(); }, true);
  document.addEventListener('mousedown', e => { if (host && e.composedPath().includes(host)) return; hide(); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' || !e.shiftKey) hide(); }, true);
  document.addEventListener('selectionchange', () => { if (shownFor && !selectedText()) hide(); });
  window.addEventListener('scroll', () => { if (shownFor) hide(); }, { passive: true, capture: true });
  window.addEventListener('blur', hide);

  window.__fernaSel = { config(c) { Object.assign(S, c); if (!S.on) hide(); } };
})();`;

/** Inject (once per document) and configure. */
async function apply(wc, { on, engine, search }) {
  if (!wc || wc.isDestroyed()) return;
  await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: SCRIPT }]);
  await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: `window.__fernaSel.config(${JSON.stringify({ on: !!on, engine, search })})` }]);
}

module.exports = { WORLD, SCRIPT, apply };
