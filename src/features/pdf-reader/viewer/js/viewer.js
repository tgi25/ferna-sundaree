// Core page viewer: layout (per-page fit width / fit page / fixed zoom), rotation, lazy rendering.
import { TextLayer } from '../../lib/pdfjs/pdf.min.mjs';
import { el, svgEl, Emitter, clamp, CSS_UNITS, debounce } from './util.js';
import { prepareTextContent, alignWordsToInk } from './textsel.js';

const PAGE_GAP = 12;          // vertical gap between pages (px)
const SIDE_MARGIN = 12;       // left/right margin around a page (px)
const MAX_CANVAS_PIXELS = 24e6;
const KEEP_RENDERED = 12;     // pages kept in memory around the current page
// Background pre-rendering: once the pages on screen are drawn, the next pages in the direction
// you are reading are drawn while the reader is idle, so turning pages is instant even in large
// documents. Bounded by a pixel budget so huge pages or high zoom do not use too much memory.
const PRERENDER_AHEAD = 8;    // pages ahead of the current one
const PRERENDER_BEHIND = 2;   // pages behind it
const PRERENDER_PIXELS = 80e6; // canvas pixels kept for pre-rendered pages (≈ 320 MB at most)
const PREFETCH_PAGES = 24;     // pages whose data is loaded ahead (cheap: no drawing)
export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6.4];

export class PageView {
  constructor(viewer, index, w, h, x0, y0, baseRot) {
    this.viewer = viewer;
    this.index = index;
    this.rawW = w; this.rawH = h; this.x0 = x0; this.y0 = y0;
    this.baseRot = baseRot; this.userRot = 0;
    this.scale = 1; this.dispW = 0; this.dispH = 0;
    this.pdfPage = null;
    this.renderedKey = '';
    this.renderTask = null;
    this.textLayer = null;
    this.textDiv = null;
    this.linksDone = false;

    this.div = el('div', { class: 'page', 'data-page': index + 1 });
    this.canvasWrapper = el('div', { class: 'canvasWrapper' });
    this.placeholder = el('div', { class: 'loadingIcon', text: '' });
    this.div.append(this.canvasWrapper, this.placeholder);

    const mkSpace = (cls, withSvg) => {
      const s = el('div', { class: 'space ' + cls });
      let g = null;
      if (withSvg) {
        const svg = svgEl('svg', { preserveAspectRatio: 'none' });
        g = svgEl('g');
        svg.append(g);
        s.append(svg);
        s._svg = svg;
      }
      this.div.append(s);
      return [s, g];
    };
    [this.hlSpace, this.hlGroup] = mkSpace('hlLayer', true);
    [this.findSpace, this.findGroup] = mkSpace('findLayer', true);
    [this.tselSpace, this.tselGroup] = mkSpace('tselLayer', true);
    [this.annSpace, this.annGroup] = mkSpace('annLayer', true);
    [this.linkSpace] = mkSpace('linkLayer', false);
    [this.htmlLayer] = mkSpace('htmlLayer', false);
    [this.selSpace, this.selGroup] = mkSpace('selLayer', true);
    this.spaces = [this.hlSpace, this.findSpace, this.tselSpace, this.annSpace, this.linkSpace, this.htmlLayer, this.selSpace];
    this.linkSpace.style.zIndex = 4;
    this._updateSpaceGeometry();

    // hover badge with quick rotate + page menu
    const badge = el('div', { class: 'page-badge' });
    const b1 = el('button', { title: 'Rotate this page left', 'data-act': 'rotl' });
    const b2 = el('button', { title: 'Rotate this page right', 'data-act': 'rotr' });
    const b3 = el('button', { title: 'Page options', 'data-act': 'menu' });
    b1.innerHTML = '<svg><use href="#i-rotl"/></svg>';
    b2.innerHTML = '<svg><use href="#i-rotr"/></svg>';
    b3.innerHTML = '<svg><use href="#i-more"/></svg>';
    badge.append(b1, b2, b3);
    this.div.append(badge);
    badge.addEventListener('pointerdown', (e) => e.stopPropagation());
    badge.addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (!act) return;
      e.stopPropagation();
      if (act === 'rotl') viewer.rotatePage(index, -90);
      else if (act === 'rotr') viewer.rotatePage(index, 90);
      else viewer.emit('pagemenu', { index, x: e.clientX, y: e.clientY });
    });
  }

  get rotation() { return (this.baseRot + this.userRot + 720) % 360; }

  _updateSpaceGeometry() {
    for (const s of this.spaces) {
      s.style.width = `calc(var(--scale-factor) * ${this.rawW}px)`;
      s.style.height = `calc(var(--scale-factor) * ${this.rawH}px)`;
      s.setAttribute('data-main-rotation', this.rotation);
      if (s._svg) {
        s._svg.setAttribute('viewBox', `0 0 ${this.rawW} ${this.rawH}`);
        s._svg.firstChild.setAttribute('transform', `matrix(1 0 0 -1 ${-this.x0} ${this.y0 + this.rawH})`);
      }
    }
  }

  setSize(w, h, x0, y0, baseRot) {
    this.rawW = w; this.rawH = h; this.x0 = x0; this.y0 = y0; this.baseRot = baseRot;
    this._updateSpaceGeometry();
  }

  // Width/height (pt) as displayed with current rotation
  get dispWpt() { return this.rotation % 180 ? this.rawH : this.rawW; }
  get dispHpt() { return this.rotation % 180 ? this.rawW : this.rawH; }

  // ---- coordinate conversion ----
  // client (screen) → PDF user space
  clientToPdf(cx, cy) {
    const r = this.div.getBoundingClientRect();
    return this.localToPdf(cx - r.left, cy - r.top);
  }
  localToPdf(x, y) {
    const s = this.scale, w = this.rawW * s, h = this.rawH * s;
    let u, v;
    switch (this.rotation) {
      case 90: u = y; v = h - x; break;
      case 180: u = w - x; v = h - y; break;
      case 270: u = w - y; v = x; break;
      default: u = x; v = y;
    }
    return [this.x0 + u / s, this.y0 + this.rawH - v / s];
  }
  pdfToLocal(X, Y) {
    const s = this.scale, w = this.rawW * s, h = this.rawH * s;
    const u = (X - this.x0) * s, v = (this.y0 + this.rawH - Y) * s;
    switch (this.rotation) {
      case 90: return [h - v, u];
      case 180: return [w - u, h - v];
      case 270: return [v, w - u];
      default: return [u, v];
    }
  }
  pdfToClient(X, Y) {
    const r = this.div.getBoundingClientRect();
    const [x, y] = this.pdfToLocal(X, Y);
    return [x + r.left, y + r.top];
  }

  layout(scale) {
    this.scale = scale;
    this.dispW = Math.round(this.dispWpt * scale);
    this.dispH = Math.round(this.dispHpt * scale);
    this.div.style.width = this.dispW + 'px';
    this.div.style.height = this.dispH + 'px';
    this.div.style.setProperty('--scale-factor', scale);
    for (const s of this.spaces) s.setAttribute('data-main-rotation', this.rotation);
    if (this.textLayer && this.pdfPage) {
      try { this.textLayer.update({ viewport: this.pdfPage.getViewport({ scale, rotation: this.rotation }) }); } catch { /* ignore */ }
    }
  }

  cancelRender() {
    if (this.renderTask) { try { this.renderTask.cancel(); } catch { /* ignore */ } this.renderTask = null; }
  }

  releaseCanvas() {
    this.cancelRender();
    for (const c of this.canvasWrapper.querySelectorAll('canvas')) { c.width = c.height = 0; c.remove(); }
    this.renderedKey = '';
  }

  async ensurePage() {
    if (!this.pdfPage) this.pdfPage = await this.viewer.pdf.getPage(this.index + 1);
    return this.pdfPage;
  }

  async render() {
    const key = `${this.scale.toFixed(4)}|${this.rotation}`;
    if (this.renderedKey === key) return;
    const page = await this.ensurePage();
    this.cancelRender();
    const vp = page.getViewport({ scale: this.scale, rotation: this.rotation });
    const dpr = window.devicePixelRatio || 1;
    let sx = dpr, sy = dpr;
    const px = vp.width * vp.height * dpr * dpr;
    if (px > MAX_CANVAS_PIXELS) { const k = Math.sqrt(MAX_CANVAS_PIXELS / (vp.width * vp.height)); sx = sy = k; }
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width * sx);
    canvas.height = Math.floor(vp.height * sy);
    const ctx = canvas.getContext('2d', { alpha: false });
    const task = page.render({
      canvasContext: ctx, canvas, viewport: vp,
      transform: sx !== 1 || sy !== 1 ? [sx, 0, 0, sy, 0, 0] : null,
      background: '#ffffff'
    });
    this.renderTask = task;
    try {
      await task.promise;
    } catch (e) {
      if (e?.name !== 'RenderingCancelledException') console.warn('render failed', e);
      canvas.width = canvas.height = 0;
      return;
    } finally {
      if (this.renderTask === task) this.renderTask = null;
    }
    for (const c of this.canvasWrapper.querySelectorAll('canvas')) { c.width = c.height = 0; c.remove(); }
    this.canvasWrapper.append(canvas);
    this.placeholder.remove();
    this.renderedKey = key;

    if (!this.textLayer) await (this._tlBuild ||= this._buildTextLayer(page, { canvas, viewport: vp, sx, sy }));
    if (!this.linksDone) this._buildLinks(page);
    this.viewer.emit('pagerendered', this);
  }

  // Cleaned text runs of this page (merged glyph runs, repaired Sinhala) — shared by search, AI, bookmarks.
  textRuns() {
    return (this._runs ||= (async () => {
      const p = await this.ensurePage();
      const tc = await p.getTextContent({ disableNormalization: true, includeMarkedContent: true });
      // /Span <</ActualText …>> sections (LibreOffice / Word complex scripts): read the real text
      let actual = null;
      if (this.viewer.actualText && tc.items.some((it) => it.type === 'beginMarkedContentProps' && it.tag === 'Span')) {
        actual = await this.viewer.actualText.forPage(this.index);
      }
      return prepareTextContent(tc, actual);
    })().catch((e) => { console.warn('text', e); return { items: [], styles: {} }; }));
  }

  async _buildTextLayer(page, ink) {
    const div = el('div', { class: 'textLayer' });
    let tc = await this.textRuns();
    // exact word positions from the rendered page (only while the canvas is fresh)
    if (ink?.canvas?.width && this.viewer.settings?.smoothSelect !== false) {
      try { tc = alignWordsToInk(tc, ink); } catch (e) { console.warn('ink alignment', e); }
    }
    const tl = new TextLayer({
      textContentSource: { items: tc.items, styles: tc.styles, lang: tc.lang },
      container: div,
      viewport: page.getViewport({ scale: this.scale, rotation: this.rotation })
    });
    this.textDiv = div;
    this.textLayer = tl;
    this.div.insertBefore(div, this.annSpace);
    try { await tl.render(); } catch { return; }
    this.eocDiv = el('div', { class: 'endOfContent' });
    div.append(this.eocDiv);
    this.viewer.emit('textlayer', this);
  }

  async _buildLinks(page) {
    this.linksDone = true;
    let annots = [];
    try { annots = await page.getAnnotations({ intent: 'display' }); } catch { return; }
    for (const a of annots) {
      if (a.subtype !== 'Link' || !a.rect) continue;
      if (!a.url && !a.dest && !a.unsafeUrl) continue;
      const [x1, y1, x2, y2] = a.rect;
      const link = el('a', { class: 'pdf-link', title: a.url || '' });
      Object.assign(link.style, {
        position: 'absolute', pointerEvents: 'auto', cursor: 'pointer',
        left: `calc(var(--scale-factor) * ${x1 - this.x0}px)`,
        top: `calc(var(--scale-factor) * ${this.y0 + this.rawH - y2}px)`,
        width: `calc(var(--scale-factor) * ${x2 - x1}px)`,
        height: `calc(var(--scale-factor) * ${y2 - y1}px)`
      });
      if (a.url) { link.href = a.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
      else if (a.dest) {
        link.dataset.internal = '1';
        link.addEventListener('click', (e) => {
          e.preventDefault();
          if (this.viewer.onInternalLink && !(e.ctrlKey || e.metaKey)) this.viewer.onInternalLink(a.dest, e, link, this);
          else this.viewer.goToDest(a.dest, { remember: true });
        });
      }
      this.linkSpace.append(link);
    }
  }
}

export class Viewer extends Emitter {
  constructor(container, viewerDiv) {
    super();
    this.container = container;
    this.viewerDiv = viewerDiv;
    this.pdf = null;
    this.pages = [];
    this.zoomMode = 'width';   // 'width' | 'page' | number (1 = 100 %)
    this.current = 0;
    this._renderQueueBusy = false;
    this._scrollRaf = 0;

    this._dir = 1;             // reading direction: 1 down, -1 up
    this._lastTop = 0;
    this._lastScrollAt = 0;
    container.addEventListener('scroll', () => {
      const t = container.scrollTop;
      if (t !== this._lastTop) { this._dir = t > this._lastTop ? 1 : -1; this._lastTop = t; }
      this._lastScrollAt = performance.now();
      if (this._scrollRaf) return;
      this._scrollRaf = requestAnimationFrame(() => { this._scrollRaf = 0; this._onScroll(); });
    }, { passive: true });

    this._ro = new ResizeObserver(debounce(() => {
      if (!this.pages.length) return;
      if (this.zoomMode === 'width' || this.zoomMode === 'page') this.layout();
    }, 60));
    this._ro.observe(container);
  }

  async setDocument(pdf) {
    this.close();
    this.pdf = pdf;
    const first = await pdf.getPage(1);
    const dims = (p) => {
      const [x0, y0, x1, y1] = p.view;
      return [x1 - x0, y1 - y0, x0, y0, p.rotate || 0];
    };
    const d1 = dims(first);
    for (let i = 0; i < pdf.numPages; i++) {
      const pv = new PageView(this, i, ...d1);
      this.pages.push(pv);
      this.viewerDiv.append(pv.div);
    }
    this.pages[0].pdfPage = first;
    this.layout({ keepAnchor: false });
    this.container.scrollTop = 0;
    this._onScroll();
    // fetch the real size of every page in the background (mixed portrait / landscape documents)
    this._sizesReady = (async () => {
      let changed = false;
      const relayout = debounce(() => this.layout(), 50);
      for (let i = 1; i < pdf.numPages; i++) {
        if (this.pdf !== pdf) return;
        const p = await pdf.getPage(i + 1);
        const pv = this.pages[i];
        if (!pv) return;
        pv.pdfPage = p;
        const d = dims(p);
        if (d[0] !== pv.rawW || d[1] !== pv.rawH || d[2] !== pv.x0 || d[3] !== pv.y0 || d[4] !== pv.baseRot) {
          pv.setSize(...d);
          changed = true;
          relayout();
        }
      }
      if (changed) relayout();
    })();
  }

  close() {
    for (const pv of this.pages) pv.releaseCanvas();
    this.pages = [];
    this.viewerDiv.replaceChildren();
    this.pdf = null;
    this.current = 0;
  }

  get availW() { return Math.max(100, this.container.clientWidth - 2 * SIDE_MARGIN); }
  get availH() { return Math.max(100, this.container.clientHeight - 2 * PAGE_GAP); }

  scaleFor(pv, mode = this.zoomMode) {
    if (mode === 'width') return this.availW / pv.dispWpt;
    if (mode === 'page') return Math.min(this.availW / pv.dispWpt, this.availH / pv.dispHpt);
    return mode * CSS_UNITS;
  }

  // Effective zoom (1 = 100 %) of the current page.
  get currentZoom() {
    const pv = this.pages[this.current];
    return pv ? pv.scale / CSS_UNITS : 1;
  }

  // Remember which point of which page is at a viewport position, re-layout, then restore.
  _anchor(atX, atY) {
    const c = this.container;
    const y = c.scrollTop + (atY ?? 0);
    const x = c.scrollLeft + (atX ?? c.clientWidth / 2);
    let idx = this.current;
    for (let i = 0; i < this.pages.length; i++) {
      const pv = this.pages[i];
      if (pv.div.offsetTop + pv.dispH + PAGE_GAP > y) { idx = i; break; }
    }
    const pv = this.pages[idx];
    if (!pv) return null;
    return {
      idx,
      fy: (y - pv.div.offsetTop) / Math.max(1, pv.dispH),
      fx: (x - pv.div.offsetLeft) / Math.max(1, pv.dispW),
      atX: atX ?? c.clientWidth / 2, atY: atY ?? 0
    };
  }

  _restore(a) {
    if (!a) return;
    const pv = this.pages[a.idx];
    const c = this.container;
    c.scrollTop = pv.div.offsetTop + a.fy * pv.dispH - a.atY;
    c.scrollLeft = pv.div.offsetLeft + a.fx * pv.dispW - a.atX;
  }

  layout({ keepAnchor = true, atX, atY } = {}) {
    if (!this.pages.length) return;
    const anchor = keepAnchor ? this._anchor(atX, atY) : null;
    for (const pv of this.pages) pv.layout(this.scaleFor(pv));
    this._restore(anchor);
    this.emit('layout');
    this._onScroll(true);
  }

  setZoom(mode, opts = {}) {
    if (typeof mode === 'number') mode = clamp(mode, 0.1, 10);
    this.zoomMode = mode;
    this.layout(opts);
    this.emit('zoom', mode);
  }

  zoomBy(dir, atX, atY) {
    const z = this.currentZoom;
    let next;
    if (dir > 0) next = ZOOM_STEPS.find((s) => s > z + 0.001) ?? ZOOM_STEPS.at(-1);
    else next = [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001) ?? ZOOM_STEPS[0];
    this.setZoom(next, { atX, atY });
  }

  zoomTo(z, atX, atY) { this.setZoom(z, { atX, atY }); }

  rotatePage(index, delta, record = true) {
    const pv = this.pages[index];
    if (!pv) return;
    const doIt = (d) => {
      pv.userRot = (pv.userRot + d + 360) % 360;
      this.layout();
      this.emit('rotate', { index });
      this.renderVisible();
    };
    if (record && this.history) this.history.pushCustom({ redo: () => doIt(delta), undo: () => doIt(-delta) });
    else doIt(delta);
  }

  rotateAll(delta) {
    const apply = (d) => {
      for (const pv of this.pages) pv.userRot = (pv.userRot + d + 360) % 360;
      this.layout();
      this.emit('rotate', { all: true });
      this.renderVisible();
    };
    if (this.history) this.history.pushCustom({ redo: () => apply(delta), undo: () => apply(-delta) });
    else apply(delta);
  }

  scrollToPage(index, { offsetY = 0, smooth = false } = {}) {
    const pv = this.pages[clamp(index, 0, this.pages.length - 1)];
    if (!pv) return;
    this.container.scrollTo({ top: pv.div.offsetTop - PAGE_GAP + offsetY, behavior: smooth ? 'smooth' : 'auto' });
  }

  // Scroll so that PDF point (X,Y) of a page is near the top-left.
  scrollToPoint(index, X, Y, { center = false } = {}) {
    const pv = this.pages[index];
    if (!pv) return;
    const [x, y] = pv.pdfToLocal(X, Y);
    const c = this.container;
    const top = pv.div.offsetTop + y - (center ? c.clientHeight / 2 : 40);
    c.scrollTop = top;
    const left = pv.div.offsetLeft + x - (center ? c.clientWidth / 2 : 40);
    if (pv.dispW > c.clientWidth) c.scrollLeft = left;
  }

  // Resolve a PDF destination to {index, x, y} (x/y in PDF user space, null when the destination has none).
  async resolveDest(dest) {
    const explicit = typeof dest === 'string' ? await this.pdf.getDestination(dest) : dest;
    if (!Array.isArray(explicit)) return null;
    const ref = explicit[0];
    const index = typeof ref === 'object' && ref ? await this.pdf.getPageIndex(ref) : Number(ref);
    if (!(index >= 0 && index < this.pages.length)) return null;
    const kind = explicit[1]?.name;
    let x = null, y = null;
    if (kind === 'XYZ') { x = explicit[2]; y = explicit[3]; }
    else if (kind === 'FitH' || kind === 'FitBH') y = explicit[2];
    else if (kind === 'FitR') { x = explicit[2]; y = explicit[5]; }
    return { index, x, y };
  }

  async goToDest(dest, { remember = false } = {}) {
    try {
      const d = await this.resolveDest(dest);
      if (!d) return;
      if (remember) this.pushHistory();
      this.goToResolved(d);
    } catch (e) { console.warn('bad destination', e); }
  }

  goToResolved({ index, x, y }) {
    const pv = this.pages[index];
    if (y != null) this.scrollToPoint(index, x ?? pv.x0, y);
    else this.scrollToPage(index);
  }

  // "Back" after following a link
  pushHistory() {
    const c = this.container;
    this.backStack = this.backStack || [];
    this.backStack.push({ top: c.scrollTop, left: c.scrollLeft, page: this.current });
    if (this.backStack.length > 50) this.backStack.shift();
    this.emit('history', this.backStack.length);
  }
  goBack() {
    const b = this.backStack?.pop();
    if (!b) return false;
    this.container.scrollTop = b.top;
    this.container.scrollLeft = b.left;
    this.emit('history', this.backStack.length);
    return true;
  }

  goToPage(n) { this.scrollToPage(n - 1); }

  _onScroll(force) {
    if (!this.pages.length) return;
    const c = this.container;
    const top = c.scrollTop, bottom = top + c.clientHeight;
    const probe = top + c.clientHeight * 0.3;
    // binary search for first page whose bottom is below `top`
    let lo = 0, hi = this.pages.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const pv = this.pages[mid];
      if (pv.div.offsetTop + pv.dispH < top) lo = mid + 1; else hi = mid;
    }
    const visible = [];
    let cur = lo;
    for (let i = lo; i < this.pages.length; i++) {
      const pv = this.pages[i];
      if (pv.div.offsetTop > bottom) break;
      visible.push(i);
      if (pv.div.offsetTop <= probe) cur = i;
    }
    this.visible = visible;
    // A background page being drawn gives way to pages that came on screen, or that you left behind.
    const bg = this._bgPage;
    if (bg && (visible.some((i) => this.pages[i] && !this._isDrawn(this.pages[i])) || !this._prerenderOrder().includes(bg.index))) bg.cancelRender();
    if (cur !== this.current || force) {
      const changed = cur !== this.current;
      this.current = cur;
      if (changed) this.emit('pagechange', cur);
    }
    this.renderVisible();
  }

  renderVisible() {
    if (this._renderQueueBusy) this._again = true; // the running pass starts over when it ends
    clearTimeout(this._renderTimer);
    this._renderTimer = setTimeout(() => this._pump(), 30);
  }

  /** Wait until the reader is idle (not scrolling, browser idle), at most ~0.5 s. */
  _idle() {
    return new Promise((resolve) => {
      const go = () => {
        if (performance.now() - this._lastScrollAt < 150) { setTimeout(go, 120); return; }
        if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: 500 });
        else setTimeout(resolve, 16);
      };
      go();
    });
  }

  /** Pages to draw in the background, nearest first, ahead of the current page before behind it. */
  _prerenderOrder() {
    const out = [], n = this.pages.length, c = this.current, dir = this._dir || 1;
    for (let d = 1; d <= Math.max(PRERENDER_AHEAD, PRERENDER_BEHIND); d++) {
      if (d <= PRERENDER_AHEAD) { const i = c + dir * d; if (i >= 0 && i < n) out.push(i); }
      if (d <= PRERENDER_BEHIND) { const i = c - dir * d; if (i >= 0 && i < n) out.push(i); }
    }
    return out;
  }

  _isDrawn(pv) { return pv.renderedKey === `${pv.scale.toFixed(4)}|${pv.rotation}`; }

  async _pump() {
    if (this._renderQueueBusy || !this.pages.length) return;
    this._renderQueueBusy = true;
    this._again = false;
    const docAtStart = this.pdf;
    try {
      // 1. The pages on screen, then their neighbours: right away.
      while (true) {
        const vis = this.visible || [];
        const want = [...vis];
        if (vis.length) {
          const a = vis[0] - 1, b = vis[vis.length - 1] + 1;
          if (b < this.pages.length) want.push(b);
          if (a >= 0) want.push(a);
        }
        const next = want.map((i) => this.pages[i]).find((pv) => pv && !this._isDrawn(pv));
        if (!next) break;
        await next.render();
      }
      this._release();
      // 2. Upcoming pages, while you read: one at a time when idle; anything that comes on
      //    screen meanwhile goes first (the loop starts over).
      if (this.settings?.prerender !== false) {
        let budget = PRERENDER_PIXELS;
        for (const i of this._prerenderOrder()) {
          const pv = this.pages[i];
          if (!pv) continue;
          if (!this._isDrawn(pv)) {
            await this._idle();
            if (this.pdf !== docAtStart || !this.pages.length) return;
            const vis = this.visible || [];
            if (this._again || vis.some((v) => this.pages[v] && !this._isDrawn(this.pages[v]))) { this._again = true; return; }
            if (!this._prerenderOrder().includes(i)) continue; // you moved on: skip it
            this._bgPage = pv;
            await pv.render();
            this._bgPage = null;
          }
          const c = pv.canvasWrapper.querySelector('canvas');
          budget -= c ? c.width * c.height : 0;
          if (budget <= 0) break;
        }
        this._release();
        // Page data (not drawing) further ahead, so even far jumps start sooner.
        const c = this.current, dir = this._dir || 1;
        for (let d = 1; d <= PREFETCH_PAGES; d++) {
          const i = c + dir * d;
          if (i < 0 || i >= this.pages.length) break;
          if (!this.pages[i].pdfPage) { await this._idle(); if (this.pdf !== docAtStart || this._again) return; try { await this.pages[i].ensurePage(); } catch { break; } }
        }
      }
    } finally {
      this._bgPage = null;
      this._renderQueueBusy = false;
      if (this._again) { this._again = false; this.renderVisible(); }
    }
  }

  /** Free canvases far from where you are (the pages pre-rendered ahead are kept). */
  _release() {
    const keep = new Set(this.visible || []);
    for (let d = 0; keep.size < KEEP_RENDERED && d < this.pages.length; d++) {
      if (this.current - d >= 0) keep.add(this.current - d);
      if (this.current + d < this.pages.length) keep.add(this.current + d);
    }
    if (this.settings?.prerender !== false) for (const i of this._prerenderOrder()) keep.add(i);
    for (const pv of this.pages) if (!keep.has(pv.index) && pv.renderedKey && pv !== this._bgPage) pv.releaseCanvas();
  }

  /** Pre-rendered pages and memory, for the status of the reader (and tests). */
  prerenderStatus() {
    let drawn = 0, pixels = 0;
    for (const pv of this.pages) { if (this._isDrawn(pv)) { drawn++; const c = pv.canvasWrapper.querySelector('canvas'); pixels += c ? c.width * c.height : 0; } }
    return { current: this.current, dir: this._dir, drawn, pixels, ahead: this._prerenderOrder().filter((i) => this._isDrawn(this.pages[i])).length };
  }

  pageFromEvent(e) {
    const d = e.target.closest?.('.page');
    if (!d) return null;
    return this.pages[Number(d.dataset.page) - 1] || null;
  }

  pageAtClient(x, y) {
    for (const i of this.visible || []) {
      const pv = this.pages[i];
      const r = pv.div.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return pv;
    }
    return null;
  }
}
