// Sidebar: page thumbnails, document outline and annotation list.
import { el, $, $$, icon } from './util.js';
import { TYPE_LABEL } from './annots.js';

const THUMB_W = 150;

export class Sidebar {
  constructor({ viewer, store, tools }) {
    this.viewer = viewer;
    this.store = store;
    this.tools = tools;
    this.root = $('#sidebar');
    this.tab = 'thumbs';
    this.thumbs = [];
    this.io = null;

    for (const b of $$('.sb-tab', this.root)) b.addEventListener('click', () => this.show(b.dataset.tab));
    viewer.on('pagechange', (i) => this._markCurrent(i));
    viewer.on('layout', () => this.thumbs.forEach((_, i) => this._sizeThumb(i)));
    viewer.on('rotate', (info) => {
      const idxs = info.all ? this.thumbs.map((_, i) => i) : [info.index];
      for (const i of idxs) { const t = this.thumbs[i]; if (t) { t.done = false; this._sizeThumb(i); if (t.visible) this._renderThumb(i); } }
    });
    store.on('change', () => { if (this.tab === 'annots' && this.isOpen) this.renderAnnotList(); });
    store.on('reset', () => { if (this.tab === 'annots' && this.isOpen) this.renderAnnotList(); });
  }

  get isOpen() { return !this.root.hidden; }

  toggle(force) {
    const open = force ?? !this.isOpen;
    this.root.hidden = !open;
    if (open) this.show(this.tab);
    this.viewer.layout();
  }

  show(tab) {
    this.tab = tab;
    for (const b of $$('.sb-tab', this.root)) b.classList.toggle('active', b.dataset.tab === tab);
    $('#thumbs').hidden = tab !== 'thumbs';
    $('#outline').hidden = tab !== 'outline';
    $('#annotList').hidden = tab !== 'annots';
    if (tab === 'annots') this.renderAnnotList();
    if (tab === 'thumbs') this._markCurrent(this.viewer.current, true);
  }

  // Called when a new document is opened.
  async setDocument(pdf) {
    this.pdf = pdf;
    this.io?.disconnect();
    const box = $('#thumbs');
    box.replaceChildren();
    this.thumbs = [];
    this.io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        const i = Number(en.target.dataset.i);
        const t = this.thumbs[i];
        t.visible = en.isIntersecting;
        if (en.isIntersecting && !t.done) this._renderThumb(i);
      }
    }, { root: $('.sb-body', this.root), rootMargin: '200px' });
    for (let i = 0; i < pdf.numPages; i++) {
      const c = el('canvas', { class: 'tcanvas' });
      const wrap = el('div', { class: 'thumb', 'data-i': i }, [c, el('span', { text: String(i + 1) })]);
      wrap.addEventListener('click', () => this.viewer.scrollToPage(i));
      box.append(wrap);
      this.thumbs.push({ wrap, canvas: c, done: false, visible: false });
      this._sizeThumb(i);
      this.io.observe(wrap);
    }
    this._markCurrent(0);
    // outline
    let outline = null;
    try { outline = await pdf.getOutline(); } catch { /* ignore */ }
    this.renderOutline(outline, false);
  }

  // outline: pdf.js outline items, or a tree made from the editable flat list (items with .goto / .idx)
  renderOutline(outline, generated) {
    const ol = $('#outline');
    ol.replaceChildren();
    const hb = (ic, label, tip, fn) => { const b = el('button', { class: 'btn', title: tip, onclick: fn }); b.append(icon(ic), el('span', { text: label })); return b; };
    ol.append(el('div', { class: 'ol-head' }, [
      hb('plus', 'Add', 'Add a bookmark at the current position (Ctrl+D)', () => this.onAddBookmark?.()),
      hb('pen', 'Edit', 'Rename, reorder, indent or remove bookmarks', () => this.onEditBookmarks?.()),
      hb('bmark', outline?.length ? 'Auto' : 'Auto-Bookmark', 'Generate bookmarks automatically', () => this.onAutoBookmark?.())
    ]));
    if (generated) ol.append(el('div', { class: 'ol-note', text: 'Bookmarks changed — Save to write them into the PDF.' }));
    if (!outline || !outline.length) ol.append(el('div', { class: 'empty', text: 'This document has no bookmarks yet. Use Add (Ctrl+D) to bookmark the current position, or Auto-Bookmark to create them.' }));
    else ol.append(this._outlineTree(outline));
  }

  _sizeThumb(i) {
    const pv = this.viewer.pages[i];
    const t = this.thumbs[i];
    if (!pv || !t) return;
    const w = pv.dispWpt >= pv.dispHpt ? THUMB_W : Math.round(THUMB_W * 0.8);
    t.canvas.style.width = w + 'px';
    t.canvas.style.height = Math.round(w * pv.dispHpt / pv.dispWpt) + 'px';
  }

  async _renderThumb(i) {
    const t = this.thumbs[i];
    const pv = this.viewer.pages[i];
    if (!t || !pv || t.busy) return;
    t.busy = true;
    try {
      const page = await pv.ensurePage();
      const cssW = parseFloat(t.canvas.style.width) || THUMB_W;
      const scale = cssW / pv.dispWpt;
      const dpr = window.devicePixelRatio || 1;
      const vp = page.getViewport({ scale: scale * dpr, rotation: pv.rotation });
      t.canvas.width = Math.round(vp.width);
      t.canvas.height = Math.round(vp.height);
      await page.render({ canvasContext: t.canvas.getContext('2d'), canvas: t.canvas, viewport: vp, background: '#fff' }).promise;
      t.done = true;
    } catch { /* cancelled */ } finally { t.busy = false; }
  }

  _markCurrent(i, scroll = false) {
    for (const t of this.thumbs) t.wrap.classList.remove('current');
    const t = this.thumbs[i];
    if (!t) return;
    t.wrap.classList.add('current');
    if (this.isOpen && this.tab === 'thumbs') {
      const body = $('.sb-body', this.root);
      const r = t.wrap.getBoundingClientRect(), br = body.getBoundingClientRect();
      if (scroll || r.top < br.top || r.bottom > br.bottom) t.wrap.scrollIntoView({ block: 'nearest' });
    }
  }

  _outlineTree(items) {
    const box = el('div');
    for (const it of items) {
      const label = el('span', { class: 'ol-label', text: it.title || '(untitled)' });
      const row = el('div', { class: 'ol-item', title: it.title }, [label]);
      if (it.idx != null && this.onBookmarkEdit) {
        const act = (ic, tip, fn) => { const b = el('button', { class: 'ol-act', title: tip }); b.append(icon(ic)); b.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); return b; };
        const rename = () => {
          const inp = el('input', { type: 'text', class: 'ol-rename', value: it.title || '' });
          let finished = false;
          const done = (ok) => {
            if (finished || !inp.isConnected) return;
            finished = true;
            const v = inp.value.trim();
            inp.replaceWith(label);
            if (ok && v && v !== it.title) this.onBookmarkEdit({ action: 'rename', idx: it.idx, title: v });
          };
          inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
          inp.addEventListener('blur', () => done(true));
          inp.addEventListener('click', (e) => e.stopPropagation());
          label.replaceWith(inp); inp.focus(); inp.select();
        };
        row.append(el('span', { class: 'ol-acts' }, [
          act('pen', 'Rename', rename),
          act('trash', 'Delete bookmark', () => this.onBookmarkEdit({ action: 'delete', idx: it.idx }))
        ]));
        row.addEventListener('dblclick', (e) => { e.preventDefault(); rename(); });
      }
      if (it.bold) row.style.fontWeight = '600';
      if (it.italic) row.style.fontStyle = 'italic';
      row.addEventListener('click', () => {
        if (it.goto) this.viewer.goToResolved(it.goto);
        else if (it.dest) this.viewer.goToDest(it.dest);
        else if (it.url) window.open(it.url, '_blank', 'noopener');
      });
      box.append(row);
      if (it.items?.length) {
        const ch = el('div', { class: 'ol-children' }, [this._outlineTree(it.items)]);
        box.append(ch);
      }
    }
    return box;
  }

  renderAnnotList() {
    const box = $('#annotList');
    box.replaceChildren();
    const list = this.store.all().sort((a, b) => a.page - b.page || (b.rects?.[0]?.[3] ?? b.rect?.[3] ?? 0) - (a.rects?.[0]?.[3] ?? a.rect?.[3] ?? 0));
    if (!list.length) { box.append(el('div', { class: 'empty', text: 'No annotations yet. Select text or use a stylus to start.' })); return; }
    for (const a of list) {
      const snippet = a.contents || a.text || '';
      const item = el('div', { class: 'an-item' }, [
        el('span', { class: 'swatch', style: `background:${a.color}` }),
        el('div', { style: 'min-width:0;flex:1' }, [
          el('div', { class: 'an-meta', text: `${(a.area ? TYPE_LABEL.area : TYPE_LABEL[a.type]) || a.type} · page ${a.page + 1}${a.author ? ' · ' + a.author : ''}` }),
          snippet ? el('div', { class: 'an-text', text: snippet }) : null
        ])
      ]);
      item.addEventListener('click', () => {
        const pv = this.viewer.pages[a.page];
        const b = a.rects?.[0] || a.rect || a.line || (a.paths?.[0] ? [a.paths[0][0], a.paths[0][1], a.paths[0][0], a.paths[0][1]] : null);
        if (b) this.viewer.scrollToPoint(a.page, Math.min(b[0], b[2]), Math.max(b[1], b[3]), { center: true });
        else this.viewer.scrollToPage(a.page);
        setTimeout(() => this.tools.select(a.id, true), 80);
        void pv;
      });
      box.append(item);
    }
  }
}
