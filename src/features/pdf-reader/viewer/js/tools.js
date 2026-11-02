import { trimRange } from './textsel.js';
// Pointer input: annotation tools, text-selection popup, annotation editing and Xodo-style stylus mode.
import { Emitter, uid, clamp, el, svgEl, f, icon } from './util.js';
import { InkStroke } from './ink.js';
import {
  hitTest, bbox, translated, upFromRotation, orientedCorners, normRect, freeTextElement, placeBox,
  touchesCircle, MARKUP_TYPES, TYPE_LABEL, arrowHead
} from './annots.js';
import { showPopover, hidePopover, popBtn, swatchBtn, editComment, popoverKind } from './ui.js';

export const PALETTE = ['#ffd400', '#7ed957', '#5ce1e6', '#ff66c4', '#ff914d', '#e5322d', '#1f6feb', '#16a34a', '#8b5cf6', '#1a1a1a'];
export const HL_COLORS = ['#ffd400', '#7ed957', '#5ce1e6', '#ff66c4', '#ff914d'];

export const DEFAULT_PROPS = {
  highlight: { color: '#ffd400', opacity: 1 },
  underline: { color: '#1f6feb', opacity: 1 },
  strikeout: { color: '#e5322d', opacity: 1 },
  squiggly: { color: '#16a34a', opacity: 1 },
  pen: { color: '#e5322d', width: 1.5, opacity: 1 },
  marker: { color: '#ffd400', width: 12, opacity: 1 },
  areahl: { color: '#ffd400', opacity: 1 },
  eraser: { width: 16 },
  freetext: { color: '#1a1a1a', fontSize: 12, opacity: 1 },
  note: { color: '#ffd400', opacity: 1 },
  rect: { color: '#e5322d', width: 1.5, opacity: 1, fill: false },
  ellipse: { color: '#e5322d', width: 1.5, opacity: 1, fill: false },
  line: { color: '#e5322d', width: 1.5, opacity: 1 },
  arrow: { color: '#e5322d', width: 1.5, opacity: 1 }
};

const DRAW_TOOLS = new Set(['pen', 'marker', 'areahl', 'rect', 'ellipse', 'line', 'arrow']);
const PLACE_TOOLS = new Set(['freetext', 'note']);
const ONE_SHOT = new Set(['rect', 'ellipse', 'line', 'arrow', 'freetext', 'note']);
const useRaw = 'onpointerrawupdate' in window;

export class Tools extends Emitter {
  constructor({ viewer, store, settings }) {
    super();
    this.viewer = viewer;
    this.store = store;
    this.settings = settings;
    this.tool = 'select';
    this.props = JSON.parse(JSON.stringify(DEFAULT_PROPS));
    this.selectedId = null;
    this.editing = null;     // {a, isNew, elm, pv}
    this.g = null;           // active gesture
    this.penDown = false;
    this.lastPen = 0;
    this._hoverRaf = 0;

    const c = viewer.container;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    if (useRaw) c.addEventListener('pointerrawupdate', (e) => { if (this.g?.type === 'ink' && e.pointerId === this.g.pointerId) this.g.stroke.move(e); });
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', (e) => this.onCancel(e));
    // pointer released outside the document area
    window.addEventListener('pointerup', (e) => { if (this.g && e.pointerId === this.g.pointerId) this.onUp(e); });
    c.addEventListener('pointerleave', (e) => { if (e.pointerType === 'pen' && !this.g) c.classList.remove('pen-hover'); });
    c.addEventListener('touchstart', (e) => {
      // palm rejection + stop the browser from panning while the stylus writes
      if (this.penDown || performance.now() - this.lastPen < 350 || c.classList.contains('pen-hover')) e.preventDefault();
    }, { passive: false });
    c.addEventListener('touchmove', (e) => { if (this.penDown || this.g?.isPen) e.preventDefault(); }, { passive: false });
    c.addEventListener('contextmenu', (e) => { if (this.g || performance.now() - this.lastPen < 400) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
    c.addEventListener('dblclick', (e) => this.onDblClick(e));
    // our own text selection: stop the browser from starting its native one
    c.addEventListener('mousedown', (e) => { if (this._blockMouseDown) { this._blockMouseDown = false; e.preventDefault(); } }, true);
    c.addEventListener('scroll', () => { if (popoverKind() === 'selection' || popoverKind() === 'annot') hidePopover(); }, { passive: true });

    store.on('change', ({ pages }) => {
      if (this.selectedId && !store.get(this.selectedId)) this.select(null);
    });
  }

  // ---------------------------------------------------------------- tool state
  setTool(tool) {
    if (this.editing) this.commitFreeText();
    this.tool = tool;
    this.select(null);
    const v = this.viewer.viewerDiv;
    v.classList.remove('mode-draw', 'mode-eraser', 'mode-hand', 'mode-place', 'mode-markup');
    if (DRAW_TOOLS.has(tool)) v.classList.add('mode-draw');
    else if (tool === 'eraser') v.classList.add('mode-eraser');
    else if (tool === 'hand') v.classList.add('mode-hand');
    else if (PLACE_TOOLS.has(tool)) v.classList.add('mode-place');
    else if (MARKUP_TYPES.has(tool)) v.classList.add('mode-markup');
    // A markup tool with text already selected applies immediately (select → click Highlight)
    if (MARKUP_TYPES.has(tool) && this.selectionInfo()) this.createMarkupFromSelection(tool);
    this.emit('toolchange', tool);
  }

  propsFor(tool) { return this.props[tool] || {}; }
  setProp(tool, key, val) {
    this.props[tool] = { ...this.props[tool], [key]: val };
    this.emit('propchange', { tool, key, val });
  }

  get author() { return this.settings.author || ''; }

  penActiveRecently() { return this.penDown || performance.now() - this.lastPen < 350; }

  _actionFor(e, isPen, penEraser, pv = null, X = 0, Y = 0) {
    if (penEraser) return 'eraser';
    if (isPen && this.settings.stylusDraws && (this.tool === 'select' || this.tool === 'hand')) {
      // a pen on a text box or sticky note selects / moves it (Xodo does the same); elsewhere it writes
      const hit = pv && hitTest(this.store.forPage(pv.index), X, Y, 6 / pv.scale);
      if (hit && (hit.type === 'freetext' || hit.type === 'note')) return 'select';
      return 'pen';
    }
    return this.tool;
  }

  // ---------------------------------------------------------------- pointer down
  onDown(e) {
    const isPen = e.pointerType === 'pen';
    const penEraser = isPen && (e.button === 5 || (e.buttons & 32) === 32);
    if (!isPen && e.button !== 0) return;
    if (isPen && e.button !== 0 && !penEraser) return;
    if (this.g) return;
    if (e.pointerType === 'touch' && this.penActiveRecently()) { e.preventDefault(); return; }
    if (e.target.closest('.ft.editing, .page-badge')) return;
    if (e.target.closest('a.pdf-link') && !(isPen && this.settings.stylusDraws) && !DRAW_TOOLS.has(this.tool)) return;
    if (isPen) { this.penDown = true; this.lastPen = performance.now(); this.viewer.container.classList.add('pen-active'); }
    if (this.editing) { this.commitFreeText(); if (this.tool === 'freetext') return; }

    const pv = this.viewer.pageFromEvent(e);
    if (!pv) { if (!isPen) this.select(null); return; }
    const [X, Y] = pv.clientToPdf(e.clientX, e.clientY);
    const action = this._actionFor(e, isPen, penEraser, pv, X, Y);
    const base = { pv, pointerId: e.pointerId, isPen, x: e.clientX, y: e.clientY, start: [X, Y], cur: [X, Y], moved: false };
    const capture = () => { try { this.viewer.container.setPointerCapture(e.pointerId); } catch { /* ignore */ } };
    const tol = (e.pointerType === 'touch' ? 12 : 5) / pv.scale;

    switch (action) {
      case 'select': {
        const list = this.store.forPage(pv.index);
        const hit = hitTest(list, X, Y, tol);
        if (hit && (hit.id === this.selectedId || !MARKUP_TYPES.has(hit.type))) {
          e.preventDefault();
          capture();
          window.getSelection()?.removeAllRanges();
          this.g = { ...base, type: 'move', id: hit.id, before: JSON.parse(JSON.stringify(hit)), wasSelected: hit.id === this.selectedId };
        } else if (this.textSel?.begin(e, pv)) {
          this._blockMouseDown = true;
          capture();
          this.g = { ...base, type: 'textsel', hit };
        } else if (hit) {
          this.g = { ...base, type: 'click', hit };
        } else {
          this.g = { ...base, type: 'click-empty' };
        }
        break;
      }
      case 'hand':
        e.preventDefault(); capture();
        this.g = { ...base, type: 'pan', st: this.viewer.container.scrollTop, sl: this.viewer.container.scrollLeft };
        this.viewer.viewerDiv.classList.add('grabbing');
        break;
      case 'highlight': case 'underline': case 'strikeout': case 'squiggly':
        this.select(null);
        if (this.textSel?.begin(e, pv)) {
          this._blockMouseDown = true;
          capture();
          this.g = { ...base, type: 'textsel', markup: action };
        } else this.g = { ...base, type: 'markup', markup: action };
        break;
      case 'pen': case 'marker': {
        e.preventDefault(); capture();
        this.select(null);
        window.getSelection()?.removeAllRanges();
        const tool = action;
        const p = this.propsFor(tool);
        const stroke = new InkStroke(pv, { color: p.color, width: p.width, opacity: p.opacity, marker: tool === 'marker' });
        stroke.begin(e);
        this.g = { ...base, type: 'ink', tool, stroke };
        break;
      }
      case 'areahl':
        e.preventDefault(); capture();
        this.select(null);
        window.getSelection()?.removeAllRanges();
        this.g = { ...base, type: 'area' };
        break;
      case 'eraser':
        e.preventDefault(); capture();
        this.select(null);
        this.g = { ...base, type: 'erase', ids: new Set() };
        this._eraseAt(e);
        break;
      case 'rect': case 'ellipse': case 'line': case 'arrow':
        e.preventDefault(); capture();
        this.select(null);
        this.g = { ...base, type: 'shape', shape: action };
        break;
      case 'freetext': {
        const hit = hitTest(this.store.forPage(pv.index), X, Y, tol);
        e.preventDefault();
        capture();
        if (hit && hit.type === 'freetext') {
          // drag = move the text box, click = edit its text
          this.g = { ...base, type: 'move', id: hit.id, before: JSON.parse(JSON.stringify(hit)), wasSelected: hit.id === this.selectedId, editOnClick: true };
          break;
        }
        this.g = { ...base, type: 'place-text' };
        break;
      }
      case 'note':
        e.preventDefault(); capture();
        this.g = { ...base, type: 'place-note' };
        break;
    }
  }

  // ---------------------------------------------------------------- pointer move
  onMove(e) {
    const c = this.viewer.container;
    if (e.pointerType === 'pen' && !e.buttons) {
      c.classList.add('pen-hover');
      clearTimeout(this._penHoverT);
      this._penHoverT = setTimeout(() => c.classList.remove('pen-hover'), 1500);
    }
    const g = this.g;
    if (!g || e.pointerId !== g.pointerId) {
      if (!g && e.pointerType === 'mouse' && this.tool === 'select') this._hover(e);
      return;
    }
    if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 3) g.moved = true;
    const pv = g.pv;
    const [X, Y] = pv.clientToPdf(e.clientX, e.clientY);
    g.cur = [X, Y];
    switch (g.type) {
      case 'ink':
        if (!useRaw) g.stroke.move(e);
        break;
      case 'textsel':
        this.textSel.move(e);
        break;
      case 'move': {
        if (!g.moved) break;
        this.viewer.viewerDiv.classList.add('dragging-annot');
        const dx = X - g.start[0], dy = Y - g.start[1];
        this.store.preview(g.id, translated(g.before, dx, dy));
        this.selectedId = g.id;
        break;
      }
      case 'pan':
        c.scrollTop = g.st - (e.clientY - g.y);
        if (!c.classList.contains('hlock')) c.scrollLeft = g.sl - (e.clientX - g.x);
        break;
      case 'area': {
        const p = this.propsFor('areahl');
        if (g.moved) this._preview(pv, { type: 'rect', rect: [...g.start, X, Y], color: p.color, width: 0, fill: true, fillOpacity: 0.4 });
        break;
      }
      case 'erase':
        this._eraseAt(e);
        break;
      case 'shape':
        this._preview(pv, this._shapeGeom(g, e.shiftKey));
        break;
      case 'place-text':
        if (g.moved) this._preview(pv, { type: 'rect', rect: [...g.start, X, Y], color: '#1f6feb', width: 1 / pv.scale, dashed: true });
        break;
      case 'markup': {
        // area highlight (scanned pages / images) when no text is being selected
        const sel = window.getSelection();
        if (g.moved && (!sel || sel.isCollapsed)) {
          const p = this.propsFor(g.markup);
          this._preview(pv, { type: 'rect', rect: [...g.start, X, Y], color: p.color, width: 0, fill: true, fillOpacity: 0.35 });
        } else this._clearPreview(pv);
        break;
      }
    }
  }

  // ---------------------------------------------------------------- pointer up
  onUp(e) {
    const g = this.g;
    if (e.pointerType === 'pen') {
      this.penDown = false; this.lastPen = performance.now();
      setTimeout(() => this.viewer.container.classList.remove('pen-active'), 400);
    }
    if (!g || e.pointerId !== g.pointerId) {
      if (!g) this._maybeSelectionPopup(e);
      return;
    }
    this.g = null;
    try { this.viewer.container.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    const pv = g.pv;
    const page = pv.index;
    switch (g.type) {
      case 'ink': {
        const path = g.stroke.end();
        if (path && path.length) {
          const p = this.propsFor(g.tool);
          this.store.add({ id: uid(), page, type: g.tool === 'marker' ? 'marker' : 'ink', color: p.color, width: p.width, opacity: p.opacity, paths: [path], author: this.author });
        }
        g.stroke.clear();
        break;
      }
      case 'move':
        this.viewer.viewerDiv.classList.remove('dragging-annot');
        if (g.moved) { this.store.commitUpdate(g.id, g.before); this.select(g.id, false); }
        else {
          const a = this.store.get(g.id);
          if (a?.type === 'freetext' && (g.editOnClick || (g.wasSelected && !g.isPen))) this.startEditFreeText(a);
          else this._clickAnnotation(a);
        }
        break;
      case 'click':
        setTimeout(() => {
          const sel = window.getSelection();
          if (!sel || sel.isCollapsed) this._clickAnnotation(g.hit);
          else { this.select(null); this._maybeSelectionPopup(e); }
        }, 0);
        break;
      case 'click-empty':
        this.select(null);
        this._maybeSelectionPopup(e);
        break;
      case 'textsel': {
        const r = this.textSel.end();
        if (g.markup) {
          const info = this.selectionInfo();
          if (info) this.createMarkupFromSelection(g.markup, null, info);
          break;
        }
        const sel = window.getSelection();
        if (g.hit && !r.moved && r.gran === 'char' && (!sel || sel.isCollapsed)) this._clickAnnotation(g.hit);
        else { this.select(null); this._maybeSelectionPopup(e); }
        break;
      }
      case 'pan':
        this.viewer.viewerDiv.classList.remove('grabbing');
        break;
      case 'erase':
        if (g.ids.size) this.store.removeMany([...g.ids]);
        break;
      case 'area': {
        this._clearPreview(pv);
        const r = normRect([...g.start, ...g.cur]);
        if ((r[2] - r[0]) * pv.scale < 4 || (r[3] - r[1]) * pv.scale < 4) break;
        const p = this.propsFor('areahl');
        this.store.add({ id: uid(), page, type: 'highlight', area: true, color: p.color, opacity: p.opacity, rects: [r], upright: upFromRotation(pv.baseRot), author: this.author });
        break;
      }
      case 'shape': {
        this._clearPreview(pv);
        const s = this._shapeGeom(g, e.shiftKey);
        const [x1, y1, x2, y2] = s.rect || s.line;
        if (Math.hypot((x2 - x1) * pv.scale, (y2 - y1) * pv.scale) < 4) break;
        this.store.add({ id: uid(), page, author: this.author, ...s, dashed: undefined });
        this._afterOneShot();
        break;
      }
      case 'place-text': {
        this._clearPreview(pv);
        const p = this.propsFor('freetext');
        const up = upFromRotation(pv.baseRot);
        let rect;
        const [X, Y] = g.cur;
        if (g.moved && Math.abs(X - g.start[0]) * pv.scale > 12) rect = normRect([...g.start, X, Y]);
        else {
          // default box: 200 pt wide in reading direction, clamped to the page
          const rt = [up[1], -up[0]];
          const w = 200, h = p.fontSize * 1.3;
          const x0 = g.start[0], y0 = g.start[1];
          rect = normRect([x0, y0, x0 + rt[0] * w - up[0] * h, y0 + rt[1] * w - up[1] * h]);
          rect._auto = true;
        }
        const a = { id: uid(), page, type: 'freetext', color: p.color, opacity: p.opacity, fontSize: p.fontSize, rect: [...rect], text: '', upright: up, author: this.author };
        this.startEditFreeText(a, true, !!rect._auto);
        break;
      }
      case 'place-note': {
        const [X, Y] = g.start;
        const p = this.propsFor('note');
        const a = { id: uid(), page, type: 'note', color: p.color, opacity: 1, rect: [X - 10, Y - 10, X + 10, Y + 10], contents: '', author: this.author };
        this.store.add(a);
        this._afterOneShot();
        this._editComment(a, true);
        break;
      }
      case 'markup': {
        this._clearPreview(pv);
        const info = this.selectionInfo();
        if (info) this.createMarkupFromSelection(g.markup, null, info);
        else if (g.moved) {
          const [X, Y] = g.cur;
          const r = normRect([...g.start, X, Y]);
          if ((r[2] - r[0]) * pv.scale > 4 && (r[3] - r[1]) * pv.scale > 4) {
            const p = this.propsFor(g.markup);
            this.store.add({ id: uid(), page, type: g.markup, color: p.color, opacity: p.opacity, rects: [r], upright: upFromRotation(pv.baseRot), author: this.author });
          }
        }
        break;
      }
    }
  }

  onCancel(e) {
    const g = this.g;
    if (!g || e.pointerId !== g.pointerId) return;
    if (g.type === 'textsel') { this.textSel.end(); this.g = null; return; }
    if (g.type === 'ink') {
      // Browser took over (e.g. started scrolling). Keep what was drawn.
      this.onUp(e);
      return;
    }
    if (g.type === 'move') this.store.preview(g.id, g.before);
    this._clearPreview(g.pv);
    this.viewer.viewerDiv.classList.remove('dragging-annot', 'grabbing');
    this.g = null;
    this.penDown = false;
  }

  // Abandon the current gesture without committing (e.g. a second finger starts a pinch).
  abortGesture() {
    const g = this.g;
    if (!g) return;
    this.g = null;
    if (g.type === 'ink') { g.stroke.end(); g.stroke.clear(); }
    if (g.type === 'move') this.store.preview(g.id, g.before);
    if (g.type === 'erase') for (const n of g.pv.div.parentElement.querySelectorAll('[data-id]')) n.style.display = '';
    this._clearPreview(g.pv);
    this.viewer.viewerDiv.classList.remove('dragging-annot', 'grabbing');
  }

  onDblClick(e) {
    if (this.tool !== 'select' && this.tool !== 'freetext') return;
    const pv = this.viewer.pageAtClient(e.clientX, e.clientY) || this.viewer.pageFromEvent(e);
    if (!pv) return;
    const [X, Y] = pv.clientToPdf(e.clientX, e.clientY);
    const hit = hitTest(this.store.forPage(pv.index), X, Y, 5 / pv.scale);
    if (hit?.type === 'freetext') { e.preventDefault(); hidePopover(); this.startEditFreeText(hit); }
  }

  _afterOneShot() {
    if (!this.settings.stickyTools && ONE_SHOT.has(this.tool)) this.emit('requesttool', 'select');
  }

  _hover(e) {
    if (this._hoverRaf) return;
    const { clientX, clientY, target } = e;
    this._hoverRaf = requestAnimationFrame(() => {
      this._hoverRaf = 0;
      const pvEl = target.closest?.('.page');
      for (const d of this.viewer.viewerDiv.querySelectorAll('.over-annot, .over-selected')) if (d !== pvEl) d.classList.remove('over-annot', 'over-selected');
      if (!pvEl) return;
      const pv = this.viewer.pages[Number(pvEl.dataset.page) - 1];
      if (!pv) return;
      const [X, Y] = pv.clientToPdf(clientX, clientY);
      const hit = hitTest(this.store.forPage(pv.index), X, Y, 5 / pv.scale);
      pvEl.classList.toggle('over-selected', !!hit && hit.id === this.selectedId);
      pvEl.classList.toggle('over-annot', !!hit && hit.id !== this.selectedId);
    });
  }

  // ---------------------------------------------------------------- eraser
  _eraseAt(e) {
    const g = this.g;
    const samples = e.getCoalescedEvents?.().length ? e.getCoalescedEvents() : [e];
    const pvs = new Set();
    for (const s of samples) {
      const pv = this.viewer.pageAtClient(s.clientX, s.clientY) || g.pv;
      const [X, Y] = pv.clientToPdf(s.clientX, s.clientY);
      const r = (this.propsFor('eraser').width / 2) / pv.scale;
      for (const a of this.store.forPage(pv.index)) {
        if (g.ids.has(a.id)) continue;
        if (touchesCircle(a, X, Y, r)) {
          g.ids.add(a.id);
          pvs.add(pv);
          for (const n of pv.div.querySelectorAll(`[data-id="${a.id}"], [data-id="${a.id}-c"]`)) n.style.display = 'none';
        }
      }
    }
  }

  // ---------------------------------------------------------------- previews
  _shapeGeom(g, shift) {
    const p = this.propsFor(g.shape);
    let [x1, y1] = g.start, [x2, y2] = g.cur;
    if (shift) {
      if (g.shape === 'line' || g.shape === 'arrow') {
        const ang = Math.round(Math.atan2(y2 - y1, x2 - x1) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(x2 - x1, y2 - y1);
        x2 = x1 + len * Math.cos(ang); y2 = y1 + len * Math.sin(ang);
      } else {
        const d = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
        x2 = x1 + Math.sign(x2 - x1 || 1) * d; y2 = y1 + Math.sign(y2 - y1 || 1) * d;
      }
    }
    const base = { type: g.shape, color: p.color, width: p.width, opacity: p.opacity };
    if (g.shape === 'line' || g.shape === 'arrow') return { ...base, line: [x1, y1, x2, y2] };
    return { ...base, rect: normRect([x1, y1, x2, y2]), fill: !!p.fill };
  }

  _clearPreview(pv) { pv?.selGroup.querySelector('.preview')?.remove(); }

  _preview(pv, s) {
    this._clearPreview(pv);
    const g = svgEl('g', { class: 'preview', stroke: s.color, 'stroke-width': s.width, fill: 'none', 'stroke-linecap': 'round', 'stroke-opacity': s.opacity ?? 1 });
    if (s.dashed) g.setAttribute('stroke-dasharray', `${4 / pv.scale} ${3 / pv.scale}`);
    if (s.type === 'rect' || s.type === 'ellipse') {
      const [x1, y1, x2, y2] = normRect(s.rect);
      const fill = s.fill ? s.color : 'none';
      const fo = s.fillOpacity ?? 0.35;
      if (s.type === 'rect') g.append(svgEl('rect', { x: x1, y: y1, width: x2 - x1, height: y2 - y1, fill, 'fill-opacity': fo }));
      else g.append(svgEl('ellipse', { cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, rx: (x2 - x1) / 2, ry: (y2 - y1) / 2, fill, 'fill-opacity': fo }));
    } else {
      const [x1, y1, x2, y2] = s.line;
      g.append(svgEl('line', { x1, y1, x2, y2 }));
      if (s.type === 'arrow') g.append(svgEl('polyline', { points: arrowHead(s).flat().join(' ') }));
    }
    pv.selGroup.append(g);
  }

  // ---------------------------------------------------------------- selection of annotations
  select(id, popup = false) {
    const prev = this.selectedId;
    this.selectedId = id;
    if (prev !== id) this.emit('select', id);
    if (id && popup) this.showAnnotPopup(this.store.get(id));
    else if (!id && popoverKind() === 'annot') hidePopover();
  }

  _clickAnnotation(a) {
    if (!a) return;
    if (a.type === 'note') { this.select(a.id); this._editComment(a); return; }
    this.select(a.id, true);
  }

  annotClientRect(a) {
    const pv = this.viewer.pages[a.page];
    const [x1, y1, x2, y2] = bbox(a);
    const p1 = pv.pdfToClient(x1, y1), p2 = pv.pdfToClient(x2, y2);
    const l = Math.min(p1[0], p2[0]), t = Math.min(p1[1], p2[1]);
    return new DOMRect(l, t, Math.abs(p2[0] - p1[0]), Math.abs(p2[1] - p1[1]));
  }

  showAnnotPopup(a) {
    if (!a) return;
    const row1 = el('div', { class: 'pop-row' });
    const colors = a.type === 'highlight' || a.type === 'marker' ? HL_COLORS : PALETTE.slice(0, 8);
    for (const c of colors) row1.append(swatchBtn(c, 'Colour', (col) => { this.store.update(a.id, { color: col }); this.showAnnotPopup(this.store.get(a.id)); }, (a.color || '').toLowerCase() === c));
    const box = el('div', {}, [row1]);

    const row2 = el('div', { class: 'pop-row' });
    if (MARKUP_TYPES.has(a.type) && !a.area) {
      for (const [t, ic] of [['highlight', 'highlight'], ['underline', 'underline'], ['strikeout', 'strike'], ['squiggly', 'squiggly']]) {
        row2.append(popBtn(ic, 'Change to ' + TYPE_LABEL[t], () => {
          const col = t === a.type ? a.color : this.propsFor(t).color;
          this.store.update(a.id, { type: t, color: col });
          this.showAnnotPopup(this.store.get(a.id));
        }, a.type === t ? 'active' : ''));
      }
      row2.append(el('span', { class: 'pop-sep' }));
    }
    if (a.width != null && a.type !== 'freetext') {
      const r = el('input', { type: 'range', min: 0.5, max: a.type === 'marker' ? 30 : 16, step: 0.5, value: a.width, title: 'Thickness', style: 'width:90px' });
      r.addEventListener('change', () => this.store.update(a.id, { width: Number(r.value) }));
      r.addEventListener('pointerdown', (e) => e.stopPropagation());
      row2.append(el('span', { class: 'muted small', text: 'Size', style: 'margin:0 4px' }), r, el('span', { class: 'pop-sep' }));
    }
    if (a.type === 'freetext') {
      row2.append(popBtn('text', 'Edit text', () => { hidePopover(); this.startEditFreeText(a); }));
      row2.append(popBtn('minus', 'Smaller text', () => this.store.update(a.id, { fontSize: Math.max(4, (a.fontSize || 12) - 1) })));
      row2.append(popBtn('plus', 'Larger text', () => this.store.update(a.id, { fontSize: (a.fontSize || 12) + 1 })));
    }
    if (a.type !== 'freetext') row2.append(popBtn('comment', a.contents ? 'Edit comment' : 'Add comment', () => this._editComment(a)));
    if (a.text && MARKUP_TYPES.has(a.type)) row2.append(popBtn('copy', 'Copy text', () => { navigator.clipboard?.writeText(a.text); hidePopover(); }));
    row2.append(popBtn('trash', 'Delete (Del)', () => { hidePopover(); this.store.remove(a.id); }, 'danger'));
    box.append(row2);
    showPopover(box, this.annotClientRect(a), { place: 'above', kind: 'annot' });
  }

  async _editComment(a, isNew = false) {
    const rect = this.annotClientRect(a);
    const meta = [a.author, a.modified ? new Date(a.modified).toLocaleString() : ''].filter(Boolean).join(' · ');
    const res = await editComment({
      title: a.type === 'note' ? 'Note' : 'Comment on ' + (TYPE_LABEL[a.type] || 'annotation').toLowerCase(),
      text: a.contents || '', meta, anchor: rect, allowDelete: true
    });
    const cur = this.store.get(a.id);
    if (!cur) return;
    if (!res) { if (isNew && !cur.contents) this.store.remove(a.id); return; }
    if (res.remove) {
      if (a.type === 'note') this.store.remove(a.id); else this.store.update(a.id, { contents: '' });
      return;
    }
    if (res.text !== (cur.contents || '')) this.store.update(a.id, { contents: res.text });
    else if (isNew && !res.text && res.implicit) this.store.remove(a.id);
  }

  deleteSelected() {
    if (!this.selectedId) return false;
    const id = this.selectedId;
    this.select(null);
    hidePopover();
    this.store.remove(id);
    return true;
  }

  // ---------------------------------------------------------------- text selection → markup
  selectionInfo() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    let range = sel.getRangeAt(0);
    const anc = range.commonAncestorContainer;
    const node = anc.nodeType === 1 ? anc : anc.parentElement;
    if (!node || !this.viewer.viewerDiv.contains(node)) return null;
    range = trimRange(range, this.viewer.viewerDiv);   // marks cover visible characters only
    const text = range.toString().trim();
    if (!text) return null;
    const byPage = new Map();
    for (const r of range.getClientRects()) {
      if (r.width < 1.5 || r.height < 2) continue;
      const pv = this.viewer.pageAtClient(r.left + r.width / 2, r.top + r.height / 2);
      if (!pv) continue;
      const a = pv.clientToPdf(r.left, r.top), b = pv.clientToPdf(r.right, r.bottom);
      const pr = normRect([a[0], a[1], b[0], b[1]]);
      if (!byPage.has(pv.index)) byPage.set(pv.index, { pv, rects: [] });
      byPage.get(pv.index).rects.push(pr);
    }
    if (!byPage.size) return null;
    const up = upFromSpan(range.startContainer);
    // line bands from the selection engine (uniform height, one per line, like the on-screen selection)
    const bands = this.textSel?.enabled ? this.textSel.selectionRects() : null;
    for (const [i, v] of byPage) {
      const b = bands?.get(i);
      if (b?.rects.length) { v.up = b.up; v.rects = b.rects; }
      else { v.up = up; v.rects = mergeLineRects(v.rects, up); }
    }
    return { text: text.replace(/[ \t]*\n[ \t]*/g, '\n'), byPage, rect: range.getBoundingClientRect() };
  }

  createMarkupFromSelection(type, color = null, info = this.selectionInfo()) {
    if (!info) return [];
    const p = this.propsFor(type);
    const created = [];
    for (const [page, { rects, up }] of info.byPage) {
      if (!rects.length) continue;
      const a = {
        id: uid(), page, type, color: color || p.color, opacity: p.opacity ?? 1,
        rects, upright: up, text: info.text.slice(0, 2000), author: this.author
      };
      this.store.add(a);
      created.push(a);
    }
    window.getSelection()?.removeAllRanges();
    hidePopover();
    return created;
  }

  _maybeSelectionPopup(e) {
    if (this.tool !== 'select' && this.tool !== 'hand') return;
    const { clientX, clientY } = e;
    // pointer capture retargets the event to the container: find what is really under the pointer
    const target = document.elementFromPoint(clientX, clientY) || e.target;
    const isPen = e.pointerType === 'pen';
    setTimeout(() => {
      const info = this.selectionInfo();
      if (!info) {
        if (popoverKind() === 'selection') hidePopover();
        // a plain click on text: maybe a "Figure 3" / "Table 2" / "Eq. (4)" reference
        if (!isPen && this.tool === 'select') this.onTextClick?.(target, clientX, clientY);
        return;
      }
      if (this.settings.selectionPopup) this.showSelectionPopup(info);
    }, 10);
  }

  showSelectionPopup(info) {
    const row = el('div', { class: 'pop-row' });
    for (const c of HL_COLORS) row.append(swatchBtn(c, 'Highlight', (col) => this.createMarkupFromSelection('highlight', col)));
    row.append(el('span', { class: 'pop-sep' }));
    row.append(popBtn('underline', 'Underline', () => this.createMarkupFromSelection('underline')));
    row.append(popBtn('strike', 'Strike out', () => this.createMarkupFromSelection('strikeout')));
    row.append(popBtn('squiggly', 'Squiggly', () => this.createMarkupFromSelection('squiggly')));
    row.append(el('span', { class: 'pop-sep' }));
    row.append(popBtn('comment', 'Highlight and comment', () => {
      const [a] = this.createMarkupFromSelection('highlight');
      if (a) this._editComment(a);
    }));
    row.append(popBtn('copy', 'Copy', () => {
      navigator.clipboard?.writeText(info.text).catch(() => document.execCommand('copy'));
      hidePopover();
    }));
    if (this.onAskAI) row.append(el('span', { class: 'pop-sep' }), popBtn('sparkle', 'Ask AI about this passage', () => { hidePopover(); this.onAskAI(info.text); }, '', 'Ask AI'));
    showPopover(row, info.rect, { place: 'above', kind: 'selection' });
  }

  // ---------------------------------------------------------------- free text editing
  startEditFreeText(a, isNew = false, autoWidth = false) {
    if (this.editing) this.commitFreeText();
    const pv = this.viewer.pages[a.page];
    hidePopover();
    this.select(null);
    this.editing = { a: JSON.parse(JSON.stringify(a)), isNew, pv, autoWidth };
    this.viewer.emit('annotations-dirty', a.page); // re-render without the static element
    const d = freeTextElement(pv, a);
    d.classList.add('editing');
    d.dataset.id = a.id;
    try { d.contentEditable = 'plaintext-only'; } catch { d.contentEditable = 'true'; }   // older Firefox: no plaintext-only
    d.spellcheck = false;
    pv.htmlLayer.querySelector(`[data-id="${a.id}"]`)?.remove();
    pv.htmlLayer.append(d);
    this.editing.elm = d;
    d.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); this.commitFreeText({ select: true }); }
    });
    d.addEventListener('pointerdown', (e) => e.stopPropagation());
    d.addEventListener('blur', () => setTimeout(() => {
      if (this.editing?.elm === d && !this.editing.barBusy && !this.editing.bar?.contains(document.activeElement)) this.commitFreeText();
    }, 50));
    this._ftBar(pv, d);
    requestAnimationFrame(() => {
      d.focus();
      const r = document.createRange();
      r.selectNodeContents(d);
      r.collapse(false);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    });
  }

  // Small bar above a text box being edited: drag handle (move), delete, done.
  _ftBar(pv, d) {
    const ed = this.editing;
    const btn = (ic, tip) => { const b = el('button', { class: 'ft-btn', title: tip, type: 'button' }); b.append(icon(ic)); return b; };
    const grip = btn('hand', 'Drag to move the text box');
    grip.classList.add('ft-grip');
    const del = btn('trash', 'Delete this text');
    const ok = btn('check', 'Done (Esc)');
    const bar = el('div', { class: 'ft-bar' }, [grip, del, ok]);
    ed.bar = bar;
    pv.htmlLayer.append(bar);
    const place = () => {
      const L = pv.htmlLayer.getBoundingClientRect(), r = d.getBoundingClientRect();
      bar.style.left = Math.max(0, r.left - L.left) + 'px';
      bar.style.top = Math.max(0, r.top - L.top - 30) + 'px';
    };
    ed.placeBar = place;
    requestAnimationFrame(place);
    for (const b of [grip, del, ok]) b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); });
    grip.addEventListener('pointerdown', (e) => {
      ed.barBusy = true;
      grip.setPointerCapture(e.pointerId);
      const s0 = pv.clientToPdf(e.clientX, e.clientY), r0 = [...ed.a.rect];
      const move = (ev) => {
        const c = pv.clientToPdf(ev.clientX, ev.clientY), dx = c[0] - s0[0], dy = c[1] - s0[1];
        ed.a.rect = [r0[0] + dx, r0[1] + dy, r0[2] + dx, r0[3] + dy];
        placeBox(pv, d, ed.a.rect, ed.a.upright);
        place();
      };
      const up = () => {
        grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
        ed.barBusy = false; d.focus();
      };
      grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
    });
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.editing !== ed) return;
      this.editing = null; d.remove(); bar.remove();
      if (ed.isNew) this.viewer.emit('annotations-dirty', ed.a.page); else this.store.remove(ed.a.id);
    });
    ok.addEventListener('click', (e) => { e.stopPropagation(); if (this.editing === ed) this.commitFreeText({ select: true }); });
    d.addEventListener('input', () => place());
  }

  commitFreeText({ select = false } = {}) {
    const ed = this.editing;
    if (!ed) return;
    this.editing = null;
    ed.bar?.remove();
    const { a, isNew, pv, elm } = ed;
    const text = (elm.innerText || '').replace(/\n+$/, '');
    let w = null;
    if (ed.autoWidth && text) {
      elm.style.width = 'max-content';
      elm.style.maxWidth = `calc(var(--scale-factor) * 200px)`;
      w = elm.offsetWidth / pv.scale + 2;
    }
    const hPt = elm.offsetHeight / pv.scale;
    elm.remove();
    const up = a.upright || [0, 1];
    const c = orientedCorners(normRect(a.rect), up);
    const along = w ?? c.along;
    const across = Math.max(hPt, (a.fontSize || 12) * 1.2);
    const rt = c.rt;
    const ul = c.ul;
    const lr = [ul[0] + rt[0] * along - up[0] * across, ul[1] + rt[1] * along - up[1] * across];
    const rect = normRect([ul[0], ul[1], lr[0], lr[1]]);
    const orig = isNew ? null : this.store.get(a.id);
    if (isNew) {
      if (text.trim()) { this.store.add({ ...a, text, rect }); this._afterOneShot(); }
      else this.viewer.emit('annotations-dirty', a.page);
    } else {
      if (!text.trim()) this.store.remove(a.id);
      else if (text !== orig?.text || rect.some((v, i) => Math.abs(v - (orig?.rect[i] ?? v)) > 0.01)) this.store.update(a.id, { text, rect });
      else this.viewer.emit('annotations-dirty', a.page);
    }
    // Esc / Done: keep the box selected, so it can be moved with the mouse or removed with Delete
    if (select && text.trim()) setTimeout(() => this.select(a.id, true), 0);
  }

  get editingId() { return this.editing?.a.id || null; }
}

// Text "up" direction in PDF space, from the rotation pdf.js gave the text-layer span.
function upFromSpan(node) {
  const span = (node.nodeType === 1 ? node : node.parentElement)?.closest?.('.textLayer span');
  const m = /rotate\((-?[\d.]+)deg\)/.exec(span?.style.transform || '');
  const ang = m ? ((Math.round(Number(m[1]) / 90) * 90) % 360 + 360) % 360 : 0;
  // span angle is clockwise in (y-down) page space; convert to PDF (y-up)
  return { 0: [0, 1], 90: [1, 0], 180: [0, -1], 270: [-1, 0] }[ang];
}

// Merge per-glyph-run rectangles into one rectangle per line.
function mergeLineRects(rects, up) {
  const vertical = Math.abs(up[0]) > 0; // lines run along the y axis
  const A = (r) => vertical ? [r[1], r[3]] : [r[0], r[2]];   // along-line extent
  const C = (r) => vertical ? [r[0], r[2]] : [r[1], r[3]];   // across-line extent
  const sorted = rects.slice().sort((p, q) => {
    const cp = C(p), cq = C(q);
    const mp = (cp[0] + cp[1]) / 2, mq = (cq[0] + cq[1]) / 2;
    return Math.abs(mp - mq) > 1 ? (mq - mp) * (vertical ? -1 : 1) : A(p)[0] - A(q)[0];
  });
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last) {
      const cl = C(last), cr = C(r);
      const hl = cl[1] - cl[0], hr = cr[1] - cr[0];
      const overlap = Math.min(cl[1], cr[1]) - Math.max(cl[0], cr[0]);
      const al = A(last), ar = A(r);
      const gap = ar[0] - al[1];
      if (overlap > 0.5 * Math.min(hl, hr) && gap < Math.max(hl, hr) * 0.9 && ar[1] > al[0] - Math.max(hl, hr)) {
        out[out.length - 1] = [Math.min(last[0], r[0]), Math.min(last[1], r[1]), Math.max(last[2], r[2]), Math.max(last[3], r[3])];
        continue;
      }
    }
    out.push(r);
  }
  return out;
}
