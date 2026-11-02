// Inline reference popups: show the target of a cross-reference (figure, table, equation, citation,
// section) in a floating card instead of jumping away.
import { el, icon, toast, clamp } from './util.js';

const PATTERNS = [
  { kind: 'figure', re: /\b(Fig(?:ure)?s?\.?)\s*~?(\d+(?:\.\d+)*)[a-z]?/gi, label: 'Figure' },
  { kind: 'table', re: /\b(Tables?|Tab\.)\s*~?(\d+(?:\.\d+)*)/gi, label: 'Table' },
  { kind: 'equation', re: /\b(Eqs?\.?|Equations?)\s*~?\(?(\d+(?:\.\d+)*)\)?/gi, label: 'Equation' },
  { kind: 'algorithm', re: /\b(Algorithms?|Alg\.)\s*~?(\d+(?:\.\d+)*)/gi, label: 'Algorithm' },
  { kind: 'section', re: /(\bSections?|\bSec\.|§)\s*~?(\d+(?:\.\d+)*)/gi, label: 'Section' },
  { kind: 'equation', re: /(?<![\w)])\((\d{1,3}(?:\.\d{1,3})?)\)/g, label: 'Equation', bare: true }
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class RefPopup {
  constructor({ viewer, doctext, settings, saveSettings }) {
    this.viewer = viewer;
    this.doctext = doctext;
    this.settings = settings;
    this.saveSettings = saveSettings || (() => {});
    this.card = null;
    this.zoom = settings.refPopupZoom || 1;
    this._saveTimer = 0;
    document.addEventListener('pointerdown', (e) => {
      if (this.card && !this.card.contains(e.target) && !e.target.closest?.('a.pdf-link')) this.close();
    }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.card) { e.stopPropagation(); this.close(); } }, true);
  }

  close() { this.card?.remove(); this.card = null; }

  // ------------------------------------------------------------------ internal links
  async showForDest(dest, event, linkEl, pv) {
    const d = await this.viewer.resolveDest(dest);
    if (!d) return;
    const txt = this._linkText(linkEl, pv, 90) || '';
    let title = `Page ${d.index + 1}`, target = { index: d.index, x: d.x, y: d.y, mode: 'dest' };
    let m;
    for (const p of PATTERNS) {
      if (p.bare) continue;
      p.re.lastIndex = 0;
      const all = [...txt.matchAll(p.re)];
      const last = all[all.length - 1];
      if (last && last.index + last[0].length >= txt.length - 2) { m = { kind: p.kind, num: last[2], label: p.label }; break; }
    }
    if (m) {
      title = `${m.label} ${m.num}`;
      // prefer the caption / equation number on the destination page so figures show above their caption
      const hit = await this.findTarget(m.kind, m.num, d.index, null, d.index, d.y);
      if (hit) target = { ...hit, x: d.x };
    } else if (/^\[?\d+(,\s*\d+)*\]?$/.test((txt.split(/\s/).pop() || '').replace(/[.,;:)]+$/, ''))) title = 'Reference ' + txt.split(/\s/).pop().replace(/[.,;:)]+$/, '');
    else if (txt) title = txt.length > 40 ? '…' + txt.slice(-40) : txt;
    this._open({ ...target, title }, linkEl.getBoundingClientRect());
  }

  // Text under a link, plus `extend` px of text to its left (to catch "Figure" in "Figure 3")
  _linkText(linkEl, pv, extend = 0) {
    const r0 = linkEl.getBoundingClientRect();
    const r = { left: r0.left - extend, right: r0.right, top: r0.top, bottom: r0.bottom };
    const spans = pv.textDiv ? [...pv.textDiv.querySelectorAll('span')] : [];
    let t = '';
    for (const s of spans) {
      const b = s.getBoundingClientRect();
      if (b.right > r.left + 1 && b.left < r.right - 1 && b.bottom > r.top + 1 && b.top < r.bottom - 1) {
        // take only the characters inside the link box (approximate by width share)
        const txt = s.textContent;
        const a = clamp(Math.round((r.left - b.left) / b.width * txt.length), 0, txt.length);
        const z = clamp(Math.round((r.right - b.left) / b.width * txt.length), 0, txt.length);
        t += txt.slice(a, z);
      }
    }
    return t.replace(/\s+/g, ' ').trim();
  }

  // ------------------------------------------------------------------ plain-text references
  // Called for a simple click on the text layer. Returns true when a reference was recognised.
  tryText(target, clientX, clientY) {
    if (!this.settings.refPopups) return false;
    const span = target.closest?.('.textLayer span');
    if (!span) return false;
    let pos = document.caretRangeFromPoint?.(clientX, clientY);
    if (!pos && document.caretPositionFromPoint) {     // Firefox
      const cp = document.caretPositionFromPoint(clientX, clientY);
      if (cp) { pos = document.createRange(); pos.setStart(cp.offsetNode, cp.offset); }
    }
    const prev = span.previousElementSibling?.tagName === 'SPAN' ? span.previousElementSibling.textContent : '';
    const next = span.nextElementSibling?.tagName === 'SPAN' ? span.nextElementSibling.textContent : '';
    const own = span.textContent;
    const offset = pos && span.contains(pos.startContainer) ? pos.startOffset : Math.round(own.length / 2);
    const text = prev + own + next;
    const idx = prev.length + offset;
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      let m;
      while ((m = p.re.exec(text))) {
        if (idx >= m.index && idx <= m.index + m[0].length) {
          const num = p.bare ? m[1] : m[2];
          const pageEl = span.closest('.page');
          const fromPage = Number(pageEl?.dataset.page || 1) - 1;
          this._findAndOpen(p.kind, num, `${p.label} ${num}`, span.getBoundingClientRect(), fromPage, clientY, p.bare);
          return true;
        }
      }
    }
    return false;
  }

  async _findAndOpen(kind, num, title, anchor, fromPage, clientY, quiet = false) {
    this._open({ loading: true, title }, anchor);
    const card = this.card;
    const hit = await this.findTarget(kind, num, fromPage, clientY);
    if (this.card !== card) return; // closed or replaced meanwhile
    if (!hit) { this.close(); if (!quiet) toast(`Couldn't find ${title} in this document.`); return; }
    this._open({ ...hit, title }, anchor);
  }

  // Look for the caption / label of a figure, table, equation, algorithm or section.
  // onlyPage/nearY: restrict the search to one page and prefer the match nearest to nearY
  async findTarget(kind, num, fromPage, clientY, onlyPage = null, nearY = null) {
    const n = this.viewer.pages.length;
    const N = esc(num);
    const strong = {
      figure: new RegExp(`^(Figure|Fig\\.?)\\s*${N}[a-z]?\\s*[:.|—–-]`, 'i'),
      table: new RegExp(`^(Table|Tab\\.?)\\s*${N}\\s*[:.|—–-]`, 'i'),
      algorithm: new RegExp(`^(Algorithm|Alg\\.?)\\s*${N}\\b`, 'i'),
      section: new RegExp(`^(Section\\s*)?${N}\\.?\\s+[A-Z]`),
      equation: new RegExp(`\\(\\s*${N}\\s*\\)\\s*$`)
    }[kind];
    const weak = {
      figure: new RegExp(`^(Figure|Fig\\.?)\\s*${N}[a-z]?\\b`, 'i'),
      table: new RegExp(`^(Table|Tab\\.?)\\s*${N}\\b`, 'i'),
      algorithm: null, section: null,
      equation: new RegExp(`\\(\\s*${N}\\s*\\)`)
    }[kind];
    const clickPv = this.viewer.pages[fromPage];
    const clickY = clickPv && clientY != null ? clickPv.clientToPdf(0, clientY)[1] : null;
    if (onlyPage != null) {
      const lines = await this.doctext.pageLines(onlyPage);
      const found = lines.filter((l) => (strong.test(l.text) && (kind !== 'equation' || l.text.length < 140)) || (weak && weak.test(l.text)));
      if (!found.length) return null;
      const best = nearY == null ? found[0] : found.reduce((a, b) => (Math.abs(b.y - nearY) < Math.abs(a.y - nearY) ? b : a));
      if (nearY != null && Math.abs(best.y - nearY) > 400) return null;
      return { index: onlyPage, y: best.top, bottom: best.bottom, mode: kind, line: best };
    }
    let weakHit = null;
    const order = [];
    for (let k = 0; k < n; k++) order.push((fromPage + k) % n);
    for (const i of order) {
      const lines = await this.doctext.pageLines(i);
      for (const l of lines) {
        if (i === fromPage && clickY != null && Math.abs(l.y - clickY) < l.size * 1.2) continue; // the line clicked
        const t = l.text;
        if (kind === 'equation') {
          // equation numbers sit at the right end of a short line
          if (strong.test(t) && t.length < 140) return { index: i, y: l.top, bottom: l.bottom, mode: 'equation', line: l };
          continue;
        }
        if (strong.test(t)) return { index: i, y: l.top, bottom: l.bottom, mode: kind, line: l };
        if (!weakHit && weak && weak.test(t)) weakHit = { index: i, y: l.top, bottom: l.bottom, mode: kind, line: l };
      }
    }
    return weakHit;
  }

  // ------------------------------------------------------------------ the card
  // Defaults come from Settings (size + zoom). The mouse can still resize the card from any edge,
  // zoom with Ctrl/⌘ + wheel (or a touchpad pinch) around the pointer, and the pin button makes the
  // current size and zoom the new default.
  static ZMIN = 0.4;
  static ZMAX = 4;
  _defaults() {
    const s = this.settings;
    return {
      w: clamp(Number(s.refPopupW) || 600, 280, 4000),
      h: clamp(Number(s.refPopupH) || 360, 160, 4000),
      z: clamp(Number(s.refPopupZoom) || 1, RefPopup.ZMIN, RefPopup.ZMAX)
    };
  }

  _open(target, anchor) {
    this.close();
    const d = this._defaults();
    this.zoom = d.z;
    const card = el('div', { class: 'refcard' });
    const title = el('div', { class: 'rc-title', text: target.title || '' });
    const sub = el('span', { class: 'rc-sub', text: target.index != null ? `page ${target.index + 1}` : '' });
    const btn = (ic, tip, fn) => { const b = el('button', { class: 'tb small', title: tip }); b.append(icon(ic)); b.onclick = (e) => { e.stopPropagation(); fn(); }; return b; };
    const head = el('div', { class: 'rc-head' }, [el('div', { class: 'rc-titles' }, [title, sub])]);
    const body = el('div', { class: 'rc-body' });
    card.append(head, body);
    if (target.loading) {
      body.append(el('div', { class: 'rc-loading' }, [el('div', { class: 'spinner' }), el('span', { text: `Looking for ${target.title}…` })]));
    } else {
      const zl = el('span', { class: 'rc-zoom', title: 'Zoom (Ctrl + wheel or pinch over the popup). Click to reset to your default.' });
      card._zoomLabel = zl;
      zl.onclick = (e) => { e.stopPropagation(); this._zoomTo(card, target, this._defaults().z); };
      head.append(
        btn('minus', 'Zoom out (Ctrl + wheel)', () => this._zoomTo(card, target, this.zoom / 1.25)),
        zl,
        btn('plus', 'Zoom in (Ctrl + wheel)', () => this._zoomTo(card, target, this.zoom * 1.25)),
        btn('pin', 'Use this size and zoom as the default for popups', () => this._pinDefaults(card)),
        btn('arrowright', `Go to page ${target.index + 1} (Ctrl+click a link to jump directly)`, () => {
          this.viewer.pushHistory();
          this.viewer.goToResolved({ index: target.index, x: target.x ?? null, y: target.y ?? null });
          this.close();
        })
      );
      this._updateZoomLabel(card);
      body.addEventListener('wheel', (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;              // plain wheel scrolls inside the popup
        e.preventDefault(); e.stopPropagation();
        const f = Math.exp(-clamp(e.deltaY, -120, 120) * (e.deltaMode === 1 ? 0.05 : 0.0022));
        this._zoomTo(card, target, this.zoom * f, e.clientX, e.clientY);
      }, { passive: false });
    }
    head.append(btn('close', 'Close (Esc)', () => this.close()));
    for (const g of ['e', 'w', 's', 'se', 'sw']) card.append(el('div', { class: 'rc-grip ' + g }));
    document.body.append(card);
    this.card = card;
    // place below (or above) the reference, using the default size from Settings
    const w = Math.min(d.w, window.innerWidth - 24), h = Math.min(d.h, window.innerHeight - 70);
    card.style.width = w + 'px';
    card.style.height = h + 'px';
    let x = anchor.left + anchor.width / 2 - w / 2;
    let y = anchor.bottom + 8;
    if (y + h > window.innerHeight - 8) y = anchor.top - h - 8;
    card.style.left = clamp(x, 8, window.innerWidth - w - 8) + 'px';
    card.style.top = clamp(y, 54, window.innerHeight - h - 8) + 'px';
    this._draggable(card, head);
    this._resizable(card, target);
    if (!target.loading) this._render(card, target);
  }

  _updateZoomLabel(card) { if (card._zoomLabel) card._zoomLabel.textContent = Math.round(this.zoom * 100) + '%'; }

  // Smooth zoom: stretch the current rendering at once (keeping the point under the pointer still),
  // then re-render sharply when the wheel stops.
  _zoomTo(card, target, z, clientX, clientY) {
    z = clamp(z, RefPopup.ZMIN, RefPopup.ZMAX);
    if (Math.abs(z - this.zoom) < 1e-4 || this.card !== card) return;
    this.zoom = z;
    this._updateZoomLabel(card);
    const body = card.querySelector('.rc-body');
    const wrap = body.querySelector('.rc-page');
    if (!wrap || !card._base) { this._render(card, target); return; }
    const br = body.getBoundingClientRect();
    const px = clientX ?? br.left + br.width / 2, py = clientY ?? br.top + br.height / 2;
    const r0 = wrap.getBoundingClientRect();
    const u = (px - r0.left) / r0.width, v = (py - r0.top) / r0.height;
    const k = z / card._base.zoom;
    const W = card._base.w * k, H = card._base.h * k;
    wrap.classList.add('scaling');
    wrap.style.width = W + 'px'; wrap.style.height = H + 'px';
    const cv = wrap.querySelector('canvas'); cv.style.width = W + 'px'; cv.style.height = H + 'px';
    for (const o of wrap.querySelectorAll('.rc-mark, .rc-arrow')) o.style.visibility = 'hidden';
    const r1 = wrap.getBoundingClientRect();
    body.scrollLeft += r1.left + u * r1.width - px;
    body.scrollTop += r1.top + v * r1.height - py;
    clearTimeout(card._zoomTimer);
    card._zoomTimer = setTimeout(() => this._render(card, target, { u, v, px: px - br.left, py: py - br.top }), 180);
    this._remember(card);
  }

  _pinDefaults(card) {
    this.settings.refPopupW = Math.round(card.offsetWidth);
    this.settings.refPopupH = Math.round(card.offsetHeight);
    this.settings.refPopupZoom = Math.round(this.zoom * 100) / 100;
    this.saveSettings(this.settings, ['refPopupW', 'refPopupH', 'refPopupZoom']);
    toast(`Default popup set: ${this.settings.refPopupW} × ${this.settings.refPopupH} px, ${Math.round(this.zoom * 100)}%`);
  }

  // "Remember my last popup size and zoom" (Settings): mouse changes become the new default.
  _remember(card) {
    if (!this.settings.refPopupRemember) return;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this.settings.refPopupW = Math.round(card.offsetWidth);
      this.settings.refPopupH = Math.round(card.offsetHeight);
      this.settings.refPopupZoom = Math.round(this.zoom * 100) / 100;
      this.saveSettings(this.settings, ['refPopupW', 'refPopupH', 'refPopupZoom']);
    }, 600);
  }

  // Resize from the left, right and bottom edges and both bottom corners.
  _resizable(card, target) {
    for (const g of card.querySelectorAll('.rc-grip')) {
      g.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        const dir = g.classList[1];
        const sx = e.clientX, sy = e.clientY;
        const L = card.offsetLeft, T = card.offsetTop, W = card.offsetWidth, H = card.offsetHeight;
        const body = card.querySelector('.rc-body');
        const keep = this._viewCenter(body);
        g.setPointerCapture(e.pointerId);
        const move = (ev) => {
          const dx = ev.clientX - sx, dy = ev.clientY - sy;
          if (dir.includes('e')) card.style.width = clamp(W + dx, 280, window.innerWidth - L - 4) + 'px';
          if (dir.includes('w')) {
            const nw = clamp(W - dx, 280, L + W - 4);
            card.style.width = nw + 'px'; card.style.left = L + W - nw + 'px';
          }
          if (dir.includes('s')) card.style.height = clamp(H + dy, 160, window.innerHeight - T - 4) + 'px';
        };
        const up = () => {
          g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up);
          if (card.offsetWidth !== W || card.offsetHeight !== H) {
            if (card.offsetWidth !== W && !target.loading) this._render(card, target, keep);
            this._remember(card);
          }
        };
        g.addEventListener('pointermove', move);
        g.addEventListener('pointerup', up);
        g.addEventListener('pointercancel', up);
      });
    }
  }

  _draggable(card, handle) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, .rc-zoom')) return;
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY, l = card.offsetLeft, t = card.offsetTop;
      const move = (ev) => { card.style.left = l + ev.clientX - sx + 'px'; card.style.top = t + ev.clientY - sy + 'px'; };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  // The page point at the centre of the popup, so a re-render can keep the same view.
  _viewCenter(body) {
    const wrap = body.querySelector('.rc-page');
    if (!wrap) return null;
    const br = body.getBoundingClientRect(), r = wrap.getBoundingClientRect();
    return { u: (br.left + br.width / 2 - r.left) / r.width, v: (br.top + br.height / 2 - r.top) / r.height, center: true };
  }

  async _render(card, target, keep = null) {
    const pv = this.viewer.pages[target.index];
    const body = card.querySelector('.rc-body');
    const page = await pv.ensurePage();
    const innerW = body.clientWidth - 2;
    card._w = card.clientWidth;
    const cssScale = innerW / pv.dispWpt * this.zoom;
    const dpr = window.devicePixelRatio || 1;
    const vp = page.getViewport({ scale: cssScale, rotation: pv.rotation });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width * dpr);
    canvas.height = Math.floor(vp.height * dpr);
    canvas.style.width = vp.width + 'px';
    canvas.style.height = vp.height + 'px';
    const wrap = el('div', { class: 'rc-page', style: `width:${vp.width}px;height:${vp.height}px` });
    wrap.append(canvas);
    try {
      await page.render({ canvasContext: canvas.getContext('2d'), canvas, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null, background: '#fff' }).promise;
    } catch { return; }
    if (this.card !== card) return;
    card._base = { zoom: this.zoom, w: vp.width, h: vp.height };
    // position of the target inside the rendered page
    const X = target.x ?? pv.x0;
    const hasY = target.y != null;
    const [lx, ly] = hasY ? vp.convertToViewportPoint(X, target.y) : [0, 0];
    const [, lyb] = target.bottom != null ? vp.convertToViewportPoint(X, target.bottom) : [0, ly];
    if (target.line && hasY) {
      const [ax, ay] = vp.convertToViewportPoint(target.line.x, target.line.top);
      const [bx, by] = vp.convertToViewportPoint(target.line.x2, target.line.bottom);
      wrap.append(el('div', { class: 'rc-mark', style: `left:${Math.min(ax, bx) - 3}px;top:${Math.min(ay, by) - 2}px;width:${Math.abs(bx - ax) + 6}px;height:${Math.abs(by - ay) + 4}px` }));
    } else if (hasY) {
      wrap.append(el('div', { class: 'rc-arrow', style: `top:${ly - 6}px` }));
    }
    body.replaceChildren(wrap);
    if (keep) {                                            // zoom / resize: keep the same point in view
      const bw = body.clientWidth, bh2 = body.clientHeight;
      const px = keep.center ? bw / 2 : keep.px, py = keep.center ? bh2 / 2 : keep.py;
      body.scrollLeft = Math.max(0, wrap.offsetLeft + keep.u * vp.width - px);
      body.scrollTop = Math.max(0, keep.v * vp.height - py);
      return;
    }
    const bh = body.clientHeight;
    let top = 0;
    if (hasY) {
      if (target.mode === 'figure') top = Math.max(lyb, ly) - bh + 36;          // caption under the figure
      else if (target.mode === 'equation') top = ly - bh / 2;
      else top = Math.min(ly, lyb) - 14;                                          // tables, sections, links
    }
    body.scrollTop = Math.max(0, top);
    body.scrollLeft = Math.max(0, lx - 20) * (this.zoom > 1 ? 1 : 0);
  }
}
