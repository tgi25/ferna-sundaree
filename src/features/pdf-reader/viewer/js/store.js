// Annotation model + undo/redo.
//
// Every annotation lives in PDF user space of its (unrotated) page:
// {
//   id, page (0-based), type, color: '#rrggbb', opacity (0..1), width (pt),
//   rects:   [[x1,y1,x2,y2], ...]           highlight / underline / strikeout / squiggly
//   paths:   [[x,y,x,y,...], ...]           ink (pen / marker)
//   rect:    [x1,y1,x2,y2]                  rect / ellipse / freetext / note
//   line:    [x1,y1,x2,y2]                  line / arrow
//   fill:    bool                           rect / ellipse
//   text, fontSize                          freetext
//   contents                                comment text for any annotation
//   upright: [ux,uy]                        text "up" direction for markups (PDF space)
//   author, created, modified
// }

import { Emitter } from './util.js';

const clone = (o) => JSON.parse(JSON.stringify(o));

export class AnnotationStore extends Emitter {
  constructor() {
    super();
    this.items = new Map();
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
  }

  reset(list = []) {
    this.items.clear();
    for (const a of list) this.items.set(a.id, a);
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.emit('reset');
    this.emit('dirty', false);
  }

  get(id) { return this.items.get(id); }
  all() { return Array.from(this.items.values()); }
  forPage(page) { return this.all().filter((a) => a.page === page); }

  _apply(op, dir) {
    // op: {kind:'add'|'remove'|'update', before, after}
    const pages = new Set();
    const put = (a) => { this.items.set(a.id, clone(a)); pages.add(a.page); };
    const del = (a) => { this.items.delete(a.id); pages.add(a.page); };
    const list = op.batch || [op];
    for (const o of (dir > 0 ? list : [...list].reverse())) {
      if (o.kind === 'add') dir > 0 ? put(o.after) : del(o.after);
      else if (o.kind === 'remove') dir > 0 ? del(o.before) : put(o.before);
      else if (o.kind === 'update') { if (dir > 0) { del(o.before); put(o.after); } else { del(o.after); put(o.before); } }
    }
    this._changed(pages);
  }

  _changed(pages) {
    if (!this.dirty) { this.dirty = true; this.emit('dirty', true); }
    this.emit('change', { pages: Array.from(pages) });
  }

  _push(op) {
    this.undoStack.push(op);
    if (this.undoStack.length > 300) this.undoStack.shift();
    this.redoStack = [];
    this._apply(op, +1);
  }

  add(a) {
    const now = Date.now();
    a.created ??= now;
    a.modified = now;
    this._push({ kind: 'add', after: clone(a) });
    return a;
  }

  remove(id) {
    const a = this.items.get(id);
    if (a) this._push({ kind: 'remove', before: clone(a) });
  }

  removeMany(ids) {
    const batch = ids.map((id) => this.items.get(id)).filter(Boolean).map((a) => ({ kind: 'remove', before: clone(a) }));
    if (batch.length) this._push({ batch });
  }

  update(id, changes) {
    const a = this.items.get(id);
    if (!a) return;
    const after = { ...clone(a), ...clone(changes), modified: Date.now() };
    this._push({ kind: 'update', before: clone(a), after });
  }

  // Replace without recording (used while dragging); call commitUpdate afterwards.
  preview(id, changes) {
    const a = this.items.get(id);
    if (!a) return;
    Object.assign(a, changes);
    this.emit('change', { pages: [a.page], preview: true });
  }
  commitUpdate(id, before) {
    const a = this.items.get(id);
    if (!a) return;
    a.modified = Date.now();
    this.undoStack.push({ kind: 'update', before: clone(before), after: clone(a) });
    this.redoStack = [];
    this._changed(new Set([a.page]));
  }

  // Page rotation is recorded in the same history so Ctrl+Z works for it too.
  pushCustom(op) { this.undoStack.push(op); this.redoStack = []; op.redo(); this._changed(new Set()); }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  undo() {
    const op = this.undoStack.pop();
    if (!op) return false;
    this.redoStack.push(op);
    if (op.undo) { op.undo(); this._changed(new Set()); } else this._apply(op, -1);
    return true;
  }

  redo() {
    const op = this.redoStack.pop();
    if (!op) return false;
    this.undoStack.push(op);
    if (op.redo) { op.redo(); this._changed(new Set()); } else this._apply(op, +1);
    return true;
  }

  // Mark the document as changed without an undoable edit (e.g. password change).
  touch() { this._changed(new Set()); }

  markSaved() { this.dirty = false; this.emit('dirty', false); }
}
