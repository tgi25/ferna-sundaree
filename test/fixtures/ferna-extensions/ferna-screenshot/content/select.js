// Ferna Screenshot — on-page pickers.
//  • Region: drag a rectangle; it lives in page coordinates, so you can scroll (wheel, or drag
//    to the window edge to auto-scroll) and resize it far beyond the visible screen.
//  • Element: hover to highlight an element, ↑/↓ to walk parents/children, click to capture.
(() => {
  if (window.__fernaShotSelect) return;
  window.__fernaShotSelect = true;

  let active = null;

  chrome.runtime.onMessage.addListener((m, s, reply) => {
    if (!m || !m.fsSelect) return;
    if (active) active.destroy(false);
    active = m.fsSelect === 'element' ? elementPicker() : regionPicker();
    reply({ ok: true });
  });

  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .layer { position: fixed; inset: 0; cursor: crosshair; font: 13px/1.35 system-ui, "Segoe UI", Roboto, sans-serif; }
  .shade { position: fixed; inset: 0; background: rgba(15, 23, 42, .42); }
  .sel { position: fixed; outline: 2px solid #3b82f6; box-shadow: 0 0 0 100000px rgba(15, 23, 42, .42); cursor: move; }
  .sel.drawing { cursor: crosshair; }
  .h { position: absolute; width: 12px; height: 12px; background: #fff; border: 2px solid #2563eb; border-radius: 3px; }
  .h[data-h=n]  { top: -7px; left: calc(50% - 6px); cursor: ns-resize; }
  .h[data-h=s]  { bottom: -7px; left: calc(50% - 6px); cursor: ns-resize; }
  .h[data-h=w]  { left: -7px; top: calc(50% - 6px); cursor: ew-resize; }
  .h[data-h=e]  { right: -7px; top: calc(50% - 6px); cursor: ew-resize; }
  .h[data-h=nw] { left: -7px; top: -7px; cursor: nwse-resize; }
  .h[data-h=ne] { right: -7px; top: -7px; cursor: nesw-resize; }
  .h[data-h=sw] { left: -7px; bottom: -7px; cursor: nesw-resize; }
  .h[data-h=se] { right: -7px; bottom: -7px; cursor: nwse-resize; }
  .size { position: fixed; background: #2563eb; color: #fff; font-weight: 600; font-size: 12px; padding: 3px 8px; border-radius: 6px; pointer-events: none; white-space: nowrap; }
  .hint { position: fixed; left: 50%; top: 14px; transform: translateX(-50%); background: #0f172aF0; color: #e2e8f0; padding: 9px 14px; border-radius: 12px; box-shadow: 0 8px 28px rgba(0,0,0,.35); pointer-events: none; white-space: nowrap; max-width: 94vw; overflow: hidden; text-overflow: ellipsis; }
  .hint b { color: #fff; }
  .hint kbd { font: 600 11px system-ui; background: #334155; color: #fff; border-radius: 4px; padding: 1px 5px; }
  .bar { position: fixed; display: flex; gap: 6px; align-items: center; background: #0f172a; padding: 6px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.4); cursor: default; }
  .bar button { all: unset; font: 600 13px system-ui, "Segoe UI", sans-serif; color: #e2e8f0; padding: 7px 12px; border-radius: 8px; cursor: pointer; white-space: nowrap; }
  .bar button:hover { background: #1e293b; }
  .bar button.primary { background: #2563eb; color: #fff; }
  .bar button.primary:hover { background: #1d4ed8; }
  .bar .dim { color: #94a3b8; font: 500 12px system-ui; padding: 0 6px; white-space: nowrap; }
  .hl { position: fixed; outline: 2px solid #f97316; background: rgba(249,115,22,.14); pointer-events: none; transition: all .05s; }
  .tag { position: fixed; background: #f97316; color: #fff; font: 600 12px system-ui; padding: 3px 8px; border-radius: 6px; pointer-events: none; white-space: nowrap; }
  `;

  function makeHost(pointer) {
    const h = document.createElement('ferna-shot-ui');
    h.style.cssText = `all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:${pointer ? 'auto' : 'none'};`;
    const root = h.attachShadow({ mode: 'closed' });
    const st = document.createElement('style'); st.textContent = CSS; root.appendChild(st);
    (document.body || document.documentElement).appendChild(h);
    return { h, root };
  }
  const el = (tag, cls, parent, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; if (parent) parent.appendChild(e); return e; };
  const docW = () => Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0);
  const docH = () => Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0);
  const vw = () => document.documentElement.clientWidth || innerWidth;
  const vh = () => document.documentElement.clientHeight || innerHeight;

  // ------------------------------------------------------------------ region
  function regionPicker() {
    const { h, root } = makeHost(true);
    const layer = el('div', 'layer', root);
    const shade = el('div', 'shade', layer);
    const sel = el('div', 'sel', layer); sel.style.display = 'none';
    for (const d of ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se']) { const k = el('div', 'h', sel); k.dataset.h = d; }
    const size = el('div', 'size', layer); size.style.display = 'none';
    const hint = el('div', 'hint', layer,
      '<b>Drag to select.</b> Scroll, or drag to the window edge, to go beyond the screen. ' +
      '<kbd>Enter</kbd> capture · <kbd>Esc</kbd> cancel');
    const bar = el('div', 'bar', layer); bar.style.display = 'none';
    const dims = el('span', 'dim', bar);
    const bFull = el('button', '', bar, 'Full width');
    const bCancel = el('button', '', bar, 'Cancel');
    const bOk = el('button', 'primary', bar, 'Capture');

    let r = null;            // selection in page coordinates {x,y,w,h} (w/h may be negative while drawing)
    let drag = null;         // {kind, handle, sx, sy, r0}
    let last = { x: 0, y: 0 };
    let auto = 0;

    const pageX = (cx) => cx + window.scrollX, pageY = (cy) => cy + window.scrollY;
    const normR = (q) => ({ x: Math.min(q.x, q.x + q.w), y: Math.min(q.y, q.y + q.h), w: Math.abs(q.w), h: Math.abs(q.h) });
    const clamp = (q) => {
      const n = normR(q), W = Math.max(docW(), vw()), H = Math.max(docH(), vh());
      const x = Math.max(0, n.x), y = Math.max(0, n.y);
      return { x, y, w: Math.min(W, n.x + n.w) - x, h: Math.min(H, n.y + n.h) - y };
    };

    function render() {
      if (!r) { sel.style.display = 'none'; size.style.display = 'none'; shade.style.display = ''; bar.style.display = 'none'; return; }
      const n = normR(r);
      shade.style.display = 'none';
      sel.style.display = '';
      sel.classList.toggle('drawing', !!(drag && drag.kind === 'new'));
      const L = n.x - window.scrollX, T = n.y - window.scrollY;
      Object.assign(sel.style, { left: L + 'px', top: T + 'px', width: n.w + 'px', height: n.h + 'px' });
      for (const k of sel.querySelectorAll('.h')) k.style.display = drag && drag.kind === 'new' ? 'none' : '';
      const label = `${Math.round(n.w)} × ${Math.round(n.h)}` + (n.h > vh() || n.w > vw() ? '  (extends beyond screen)' : '');
      size.textContent = label; dims.textContent = label;
      size.style.display = drag ? '' : 'none';
      size.style.left = Math.min(Math.max(4, L), vw() - 260) + 'px';
      size.style.top = (T > 30 ? T - 26 : Math.max(4, T + 6)) + 'px';
      if (!drag && n.w >= 4 && n.h >= 4) {
        bar.style.display = 'flex';
        const bw = bar.offsetWidth || 360, bh = bar.offsetHeight || 40;
        let bx = L + n.w - bw, by = T + n.h + 8;
        if (by + bh > vh() - 6) by = Math.min(vh() - bh - 8, Math.max(8, T + n.h - bh - 8));
        if (by < 8) by = 8;
        bx = Math.min(Math.max(8, bx), vw() - bw - 8);
        bar.style.left = bx + 'px'; bar.style.top = by + 'px';
      } else bar.style.display = 'none';
      hint.style.display = drag ? 'none' : '';
      const mode = r ? 'sel' : 'new';
      if (hint.dataset.m !== mode) {
        hint.dataset.m = mode;
        hint.innerHTML = r
          ? '<b>Adjust:</b> drag a handle or the box; scroll to reach parts off the screen. <kbd>Enter</kbd> capture · <kbd>Esc</kbd> cancel'
          : '<b>Drag to select.</b> Scroll, or drag to the window edge, to go beyond the screen. <kbd>Enter</kbd> capture · <kbd>Esc</kbd> cancel';
      }
    }

    function update() {
      if (!drag) return;
      const px = pageX(last.x), py = pageY(last.y);
      const dx = px - drag.sx, dy = py - drag.sy, r0 = drag.r0;
      if (drag.kind === 'new') r = { x: drag.sx, y: drag.sy, w: dx, h: dy };
      else if (drag.kind === 'move') {
        r = { ...r0, x: Math.max(0, Math.min(docW() - r0.w, r0.x + dx)), y: Math.max(0, Math.min(Math.max(docH(), vh()) - r0.h, r0.y + dy)) };
      } else {
        let { x, y, w, h: hh } = r0; const k = drag.handle;
        if (k.includes('w')) { x = r0.x + dx; w = r0.w - dx; }
        if (k.includes('e')) { w = r0.w + dx; }
        if (k.includes('n')) { y = r0.y + dy; hh = r0.h - dy; }
        if (k.includes('s')) { hh = r0.h + dy; }
        r = { x, y, w, h: hh };
      }
      render();
    }

    function autoScroll() {
      auto = 0;
      if (!drag) return;
      const edge = 36;
      let sx = 0, sy = 0;
      if (last.y < edge) sy = -Math.ceil((edge - last.y) * 0.9);
      else if (last.y > vh() - edge) sy = Math.ceil((last.y - (vh() - edge)) * 0.9);
      if (last.x < edge) sx = -Math.ceil((edge - last.x) * 0.9);
      else if (last.x > vw() - edge) sx = Math.ceil((last.x - (vw() - edge)) * 0.9);
      if (sx || sy) { window.scrollBy(sx, sy); update(); }
      auto = requestAnimationFrame(autoScroll);
    }

    layer.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || bar.contains(e.composedPath()[0])) return;
      e.preventDefault(); e.stopPropagation();
      last = { x: e.clientX, y: e.clientY };
      const t = e.composedPath()[0];
      const px = pageX(e.clientX), py = pageY(e.clientY);
      if (r && t.classList && t.classList.contains('h')) drag = { kind: 'resize', handle: t.dataset.h, sx: px, sy: py, r0: normR(r) };
      else if (r && t === sel) drag = { kind: 'move', sx: px, sy: py, r0: normR(r) };
      else { drag = { kind: 'new', sx: px, sy: py, r0: null }; r = null; }
      if (!auto) auto = requestAnimationFrame(autoScroll);
      render();
    }, true);

    const onMove = (e) => { if (!drag) return; e.preventDefault(); last = { x: e.clientX, y: e.clientY }; update(); };
    const onUp = (e) => {
      if (!drag) return;
      e.preventDefault();
      const wasNew = drag.kind === 'new';
      drag = null; cancelAnimationFrame(auto); auto = 0;
      if (r) { const n = clamp(r); r = n.w >= 4 && n.h >= 4 ? n : (wasNew ? null : r); }
      render();
    };
    const onScroll = () => render();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); destroy(true); }
      else if (e.key === 'Enter' && r && !drag) { e.preventDefault(); e.stopPropagation(); capture(); }
    };
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    window.addEventListener('keydown', onKey, true);
    sel.addEventListener('dblclick', (e) => { e.preventDefault(); capture(); });

    bFull.addEventListener('click', () => { if (!r) return; r = { ...normR(r), x: 0, w: Math.max(docW(), vw()) }; r = clamp(r); render(); });
    bCancel.addEventListener('click', () => destroy(true));
    bOk.addEventListener('click', () => capture());

    function capture() {
      if (!r) return;
      const n = clamp(r);
      destroy(false);
      // let the page repaint without the overlay before the first screenshot
      requestAnimationFrame(() => requestAnimationFrame(() =>
        chrome.runtime.sendMessage({ type: 'fs:area', mode: 'region', rect: { x: Math.round(n.x), y: Math.round(n.y), w: Math.round(n.w), h: Math.round(n.h) } })));
    }

    function destroy(notify) {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('keydown', onKey, true);
      cancelAnimationFrame(auto);
      h.remove();
      if (active && active.destroy === destroy) active = null;
      if (notify) chrome.runtime.sendMessage({ type: 'fs:cancel' });
    }

    render();
    return { destroy };
  }

  // ------------------------------------------------------------------ element
  function elementPicker() {
    const { h, root } = makeHost(false);
    const layer = el('div', 'layer', root); layer.style.pointerEvents = 'none';
    const hl = el('div', 'hl', layer);
    const tag = el('div', 'tag', layer);
    el('div', 'hint', layer, '<b>Click an element to capture it.</b> <kbd>↑</kbd> parent · <kbd>↓</kbd> child · <kbd>Esc</kbd> cancel');
    let cur = null, stack = [];
    let lastPt = null;

    function show() {
      if (!cur) { hl.style.display = tag.style.display = 'none'; return; }
      const r = cur.getBoundingClientRect();
      hl.style.display = tag.style.display = '';
      Object.assign(hl.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
      const name = cur.tagName.toLowerCase() + (cur.id ? '#' + cur.id : '') +
        (typeof cur.className === 'string' && cur.className.trim() ? '.' + cur.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
      tag.textContent = `${name.slice(0, 60)}  ${Math.round(r.width)} × ${Math.round(r.height)}`;
      tag.style.left = Math.max(4, Math.min(r.left, vw() - 300)) + 'px';
      tag.style.top = (r.top > 28 ? r.top - 26 : Math.min(vh() - 26, Math.max(4, r.top + 4))) + 'px';
    }
    function pick(x, y) {
      const t = document.elementFromPoint(x, y);
      if (t && t !== h && t !== document.documentElement) { if (t !== cur) { cur = t; stack = []; } }
      show();
    }
    const block = (e) => { e.preventDefault(); e.stopImmediatePropagation(); };
    const onMove = (e) => { lastPt = [e.clientX, e.clientY]; pick(e.clientX, e.clientY); };
    const onClick = (e) => { block(e); if (e.type === 'click' && e.button === 0) capture(); };
    const onKey = (e) => {
      if (e.key === 'Escape') { block(e); destroy(true); }
      else if (e.key === 'Enter') { block(e); capture(); }
      else if (e.key === 'ArrowUp' && cur && cur.parentElement && cur.parentElement !== document.documentElement) { block(e); stack.push(cur); cur = cur.parentElement; show(); }
      else if (e.key === 'ArrowDown' && stack.length) { block(e); cur = stack.pop(); show(); }
    };
    const onScroll = () => show();
    const evs = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'click', 'auxclick', 'dblclick', 'contextmenu'];
    window.addEventListener('mousemove', onMove, true);
    for (const ev of evs) window.addEventListener(ev, onClick, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);

    function capture() {
      if (!cur) return;
      const r = cur.getBoundingClientRect();
      const rect = { x: Math.max(0, Math.round(r.left + window.scrollX)), y: Math.max(0, Math.round(r.top + window.scrollY)), w: Math.round(r.width), h: Math.round(r.height) };
      destroy(false);
      if (rect.w < 2 || rect.h < 2) { chrome.runtime.sendMessage({ type: 'fs:cancel' }); return; }
      requestAnimationFrame(() => requestAnimationFrame(() => chrome.runtime.sendMessage({ type: 'fs:area', mode: 'element', rect })));
    }
    function destroy(notify) {
      window.removeEventListener('mousemove', onMove, true);
      for (const ev of evs) window.removeEventListener(ev, onClick, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      h.remove();
      if (active && active.destroy === destroy) active = null;
      if (notify) chrome.runtime.sendMessage({ type: 'fs:cancel' });
    }
    if (lastPt) pick(...lastPt); else show();
    return { destroy };
  }
})();
