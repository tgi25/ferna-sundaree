// Ferna Screenshots — editor: annotate, crop, stamp and save a capture.
// The canvas only covers the visible part of the viewport, so very tall full-page captures stay fast.

import { getSettings } from './lib/settings.js';
import { getCapture, getDoc, putDoc } from './lib/db.js';
import { sceneLayout, drawScene, analyzeCorners, objectBounds, moveObject, norm, renderFull } from './lib/compose.js';
import { exportBlob } from './lib/export.js';
import { buildFilename, formatTime, MODE_NAMES } from './lib/util.js';

await (window.__fernaReady || null); // Ferna Sundaree: capture handed over by the browser
const $ = (id) => document.getElementById(id);
const capId = new URLSearchParams(location.search).get('id');
let settings = await getSettings();
const rec = capId ? await getCapture(capId) : null;
if (!rec) {
  document.querySelector('main').innerHTML = '<p style="padding:40px;font-size:15px">This screenshot is no longer in the history. ' +
    '<a href="history.html">Open the history</a></p>';
  throw new Error('capture not found');
}
const img = await createImageBitmap(rec.blob);
const meta = rec;
const S = meta.scale || 1;
document.title = `${meta.title || 'Screenshot'} — Ferna Screenshots`;

const saved = await getDoc(capId);
let doc = saved || { objects: [], crop: null, stamp: { ...settings.stamp } };
doc.stamp = { ...settings.stamp, ...doc.stamp };

const vp = $('viewport'), spacer = $('spacer'), canvas = $('view');
const ctx = canvas.getContext('2d');
const scratch = new OffscreenCanvas(4, 4).getContext('2d');
const cache = new Map();

let tool = 'select', color = '#e11d48', sizeLevel = 3, fill = false;
let zoom = 1, ox0 = 24, oy0 = 24;
let layout = null;
let cornerMemo = { key: '', corner: 'br' };
let selectedId = null, live = null, drag = null, cropDraft = null, textBox = null;
let undoStack = [], redoStack = [];
let panKey = false;

const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ------------------------------------------------------------------ layout & drawing
function cornerFn(c, w, h) {
  const key = `${c.x},${c.y},${c.w},${c.h},${Math.round(w)},${Math.round(h)}`;
  if (cornerMemo.key !== key) cornerMemo = { key, corner: analyzeCorners(img, c, w, h) };
  return cornerMemo.corner;
}

function relayout() {
  layout = tool === 'crop'
    ? sceneLayout(scratch, img.width, img.height, null, meta, { enabled: false })
    : sceneLayout(scratch, img.width, img.height, doc.crop, meta, doc.stamp, cornerFn);
  updateSpacer();
  const names = { tl: 'top-left', tr: 'top-right', bl: 'bottom-left', br: 'bottom-right' };
  $('stInfo').textContent = !doc.stamp.enabled ? 'The stamp is off.' :
    layout.corner && doc.stamp.corner === 'auto' ? `Placed in the ${names[layout.corner]} corner, where the picture is quietest.` :
    doc.stamp.placement !== 'corner' ? 'The stamp is drawn on its own strip, so it covers nothing.' : '';
}

function updateSpacer() {
  const cw = vp.clientWidth, ch = vp.clientHeight;
  const W = layout.outW * zoom, H = layout.outH * zoom;
  ox0 = Math.max(24, (cw - W) / 2);
  oy0 = Math.max(24, (ch - H) / 2);
  spacer.style.width = Math.max(cw, W + 2 * ox0) + 'px';
  spacer.style.height = Math.max(ch, H + 2 * oy0) + 'px';
}

let rafPending = false;
function render() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; paint(); });
}

function paint() {
  const cw = vp.clientWidth, ch = vp.clientHeight, dpr = devicePixelRatio || 1;
  const sl = vp.scrollLeft, st = vp.scrollTop;
  const w = Math.round(cw * dpr), h = Math.round(ch * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px'; }
  canvas.style.transform = `translate(${sl}px, ${st}px)`;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  // page shadow
  ctx.save();
  ctx.shadowColor = 'rgba(15,23,42,.28)'; ctx.shadowBlur = 18 * dpr; ctx.shadowOffsetY = 3 * dpr;
  ctx.fillStyle = '#fff';
  ctx.fillRect(dpr * (ox0 - sl), dpr * (oy0 - st), dpr * layout.outW * zoom, dpr * layout.outH * zoom);
  ctx.restore();

  const z = zoom * dpr;
  ctx.setTransform(z, 0, 0, z, dpr * (ox0 - sl), dpr * (oy0 - st));
  ctx.imageSmoothingEnabled = z < 1.9;
  ctx.imageSmoothingQuality = 'high';
  const visible = { x: (sl - ox0) / zoom, y: (st - oy0) / zoom, w: cw / zoom, h: ch / zoom };
  const objs = live && live.type !== 'cropdraft' ? [...doc.objects, live] : doc.objects;
  drawScene(ctx, img, objs, layout, { visible, cache });

  const toOut = (r) => ({ x: r.x - layout.crop.x + layout.ox, y: r.y - layout.crop.y + layout.oy, w: r.w, h: r.h });
  // selection
  const sel = doc.objects.find((o) => o.id === selectedId);
  if (sel && tool === 'select') {
    const b = toOut(pad(objectBounds(scratch, sel), 4 / zoom));
    ctx.save(); ctx.setLineDash([5 / zoom, 4 / zoom]); ctx.lineWidth = 1.5 / zoom; ctx.strokeStyle = '#2563eb';
    ctx.strokeRect(b.x, b.y, b.w, b.h); ctx.restore();
  }
  // crop overlay
  if (tool === 'crop') {
    const c = cropDraft ? norm(cropDraft) : doc.crop;
    ctx.save();
    ctx.fillStyle = 'rgba(15,23,42,.55)';
    ctx.beginPath(); ctx.rect(0, 0, layout.outW, layout.outH);
    if (c) ctx.rect(c.x + c.w, c.y, -c.w, c.h); // reverse winding = hole
    ctx.fill('evenodd');
    if (c) {
      ctx.lineWidth = 2 / zoom; ctx.strokeStyle = '#fff'; ctx.setLineDash([6 / zoom, 4 / zoom]); ctx.strokeRect(c.x, c.y, c.w, c.h);
      const label = `${Math.round(c.w / S)} × ${Math.round(c.h / S)}`;
      ctx.setLineDash([]); ctx.font = `600 ${12 / zoom}px system-ui`; ctx.fillStyle = '#2563eb';
      const tw = ctx.measureText(label).width + 12 / zoom;
      ctx.fillRect(c.x, Math.max(0, c.y - 22 / zoom), tw, 20 / zoom);
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(label, c.x + 6 / zoom, Math.max(0, c.y - 22 / zoom) + 10 / zoom);
    }
    ctx.restore();
  }
}
const pad = (r, p) => ({ x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p });

// ------------------------------------------------------------------ zoom
function fitZoom() { return clamp(Math.min((vp.clientWidth - 48) / layout.outW, 1 / S), 0.03, 8); }
function setZoom(z, ax, ay) {
  z = clamp(z, 0.03, 8);
  const r = vp.getBoundingClientRect();
  if (ax == null) { ax = r.left + vp.clientWidth / 2; ay = r.top + vp.clientHeight / 2; }
  const X = (ax - r.left + vp.scrollLeft - ox0) / zoom, Y = (ay - r.top + vp.scrollTop - oy0) / zoom;
  zoom = z;
  updateSpacer();
  vp.scrollLeft = X * zoom + ox0 - (ax - r.left);
  vp.scrollTop = Y * zoom + oy0 - (ay - r.top);
  $('zpct').textContent = Math.round(zoom * S * 100) + '%';
  render();
}
$('zin').onclick = () => setZoom(zoom * 1.25);
$('zout').onclick = () => setZoom(zoom / 1.25);
$('zfit').onclick = () => setZoom(fitZoom());
$('zpct').onclick = () => setZoom(1 / S);
vp.addEventListener('wheel', (e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  setZoom(zoom * Math.exp(-e.deltaY * 0.0022), e.clientX, e.clientY);
}, { passive: false });
vp.addEventListener('scroll', render);
new ResizeObserver(() => { updateSpacer(); render(); }).observe(vp);

// ------------------------------------------------------------------ state helpers
function snapshot() { return JSON.stringify(doc); }
function pushUndo(snap) {
  undoStack.push(snap || snapshot());
  if (undoStack.length > 150) undoStack.shift();
  redoStack = [];
  syncButtons();
}
function restore(json) { doc = JSON.parse(json); selectedId = null; syncStampUI(); relayout(); render(); persist(); syncButtons(); }
function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); }
let persistT = 0;
function persist() { clearTimeout(persistT); persistT = setTimeout(() => putDoc(capId, doc).catch(() => {}), 400); }
function syncButtons() {
  $('undo').disabled = !undoStack.length; $('redo').disabled = !redoStack.length;
  $('del').disabled = !selectedId;
  $('resetCrop') && ($('resetCrop').style.display = doc.crop ? '' : 'none');
}

// ------------------------------------------------------------------ tools & style
function setTool(t) {
  if (textBox) commitText();
  const was = tool;
  tool = t;
  for (const b of document.querySelectorAll('.tool[data-tool]')) b.classList.toggle('on', b.dataset.tool === t);
  if (t !== 'select') selectedId = null;
  cropDraft = null;
  vp.style.cursor = t === 'select' ? 'default' : t === 'text' ? 'text' : 'crosshair';
  if (was === 'crop' || t === 'crop') { relayout(); }
  syncButtons(); render();
}
for (const b of document.querySelectorAll('.tool[data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool));

function setColor(c) {
  color = c;
  for (const s of document.querySelectorAll('.sw[data-c]')) s.classList.toggle('on', s.dataset.c.toLowerCase() === c.toLowerCase());
  $('customColor').parentElement.classList.toggle('on', ![...document.querySelectorAll('.sw[data-c]')].some((s) => s.dataset.c.toLowerCase() === c.toLowerCase()));
  applyToSelected((o) => { o.color = c; });
}
for (const s of document.querySelectorAll('.sw[data-c]')) s.addEventListener('click', () => setColor(s.dataset.c));
$('customColor').addEventListener('input', (e) => setColor(e.target.value));
$('size').addEventListener('input', (e) => { sizeLevel = Number(e.target.value); applyToSelected(styleSize); });
$('fill').addEventListener('change', (e) => { fill = e.target.checked; applyToSelected((o) => { if (o.type === 'rect') o.fill = fill; }); });

const widthFor = (type) => type === 'marker' ? (6 + sizeLevel * 3) * S : (1 + sizeLevel) * 0.9 * S;
function styleSize(o) {
  if (o.type === 'text') o.size = (10 + sizeLevel * 3) * S;
  else if (o.type === 'step') o.r = (8 + sizeLevel * 1.6) * S;
  else if (o.type === 'blur') o.block = (4 + sizeLevel * 1.5) * S;
  else o.width = widthFor(o.type);
}
function applyToSelected(fn) {
  const o = doc.objects.find((x) => x.id === selectedId);
  if (!o) return;
  pushUndo(); fn(o); persist(); render();
}
function deleteSelected() {
  if (!selectedId) return;
  pushUndo();
  doc.objects = doc.objects.filter((o) => o.id !== selectedId);
  selectedId = null; persist(); syncButtons(); render();
}

// ------------------------------------------------------------------ pointer → image coordinates
function toImage(e) {
  const r = vp.getBoundingClientRect();
  const X = (e.clientX - r.left + vp.scrollLeft - ox0) / zoom, Y = (e.clientY - r.top + vp.scrollTop - oy0) / zoom;
  return { x: X - layout.ox + layout.crop.x, y: Y - layout.oy + layout.crop.y };
}

function distSeg(p, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy || 1;
  const t = clamp(((p.x - x1) * dx + (p.y - y1) * dy) / l, 0, 1);
  return Math.hypot(p.x - (x1 + t * dx), p.y - (y1 + t * dy));
}
function hit(p) {
  const tol = 6 / zoom;
  for (let i = doc.objects.length - 1; i >= 0; i--) {
    const o = doc.objects[i];
    if (o.type === 'line' || o.type === 'arrow') { if (distSeg(p, o.x1, o.y1, o.x2, o.y2) <= tol + o.width) return o; continue; }
    if (o.type === 'pen' || o.type === 'marker') {
      for (let j = 1; j < o.points.length; j++) if (distSeg(p, ...o.points[j - 1], ...o.points[j]) <= tol + o.width / 2) return o;
      continue;
    }
    if (o.type === 'ellipse' || (o.type === 'rect' && !o.fill)) {
      const r = norm(o), inner = pad(r, -(tol + o.width)), outer = pad(r, tol + o.width);
      const inO = p.x >= outer.x && p.x <= outer.x + outer.w && p.y >= outer.y && p.y <= outer.y + outer.h;
      const inI = inner.w > 0 && inner.h > 0 && p.x >= inner.x && p.x <= inner.x + inner.w && p.y >= inner.y && p.y <= inner.y + inner.h;
      if (inO && !inI) return o;
      continue;
    }
    const b = pad(objectBounds(scratch, o), tol);
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return o;
  }
  return null;
}

// ------------------------------------------------------------------ pointer handling
vp.addEventListener('pointerdown', (e) => {
  if (e.target !== canvas && e.target !== spacer && e.target !== vp) return;
  if (textBox) { commitText(); return; }
  vp.focus({ preventScroll: true });
  if (e.button === 1 || panKey) {
    e.preventDefault();
    drag = { kind: 'pan', x: e.clientX, y: e.clientY, sl: vp.scrollLeft, st: vp.scrollTop };
    vp.setPointerCapture(e.pointerId); return;
  }
  if (e.button !== 0) return;
  const p = toImage(e);
  vp.setPointerCapture(e.pointerId);
  const base = { id: uid(), color };
  switch (tool) {
    case 'select': {
      const o = hit(p);
      selectedId = o ? o.id : null;
      if (o && o.type === 'text' && e.detail === 2) { editText(o); break; }
      if (o) drag = { kind: 'move', last: p, snap: snapshot(), moved: false };
      syncButtons(); render(); break;
    }
    case 'crop': cropDraft = { x: p.x, y: p.y, w: 0, h: 0 }; drag = { kind: 'crop', start: p }; render(); break;
    case 'rect': case 'ellipse': case 'blur':
      live = { ...base, type: tool, x: p.x, y: p.y, w: 0, h: 0, fill: tool === 'rect' && fill }; styleSize(live);
      drag = { kind: 'shape', start: p }; break;
    case 'line': case 'arrow':
      live = { ...base, type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y }; styleSize(live);
      drag = { kind: 'shape', start: p }; break;
    case 'pen': case 'marker':
      live = { ...base, type: tool, points: [[p.x, p.y]] }; styleSize(live);
      drag = { kind: 'shape', start: p }; break;
    case 'text': {
      const o = hit(p);
      if (o && o.type === 'text') editText(o); else newText(p);
      break;
    }
    case 'step': {
      const n = 1 + doc.objects.reduce((m, o) => (o.type === 'step' ? Math.max(m, o.n) : m), 0);
      const o = { ...base, type: 'step', x: p.x, y: p.y, n }; styleSize(o);
      pushUndo(); doc.objects.push(o); persist(); render(); break;
    }
  }
});

vp.addEventListener('pointermove', (e) => {
  if (!drag) {
    if (tool === 'select') { const o = hit(toImage(e)); vp.style.cursor = o ? 'move' : 'default'; }
    return;
  }
  if (drag.kind === 'pan') { vp.scrollLeft = drag.sl - (e.clientX - drag.x); vp.scrollTop = drag.st - (e.clientY - drag.y); return; }
  const p = toImage(e);
  if (drag.kind === 'move') {
    const o = doc.objects.find((x) => x.id === selectedId);
    if (o) { moveObject(o, p.x - drag.last.x, p.y - drag.last.y); drag.last = p; drag.moved = true; render(); }
    return;
  }
  if (drag.kind === 'crop') {
    const x = clamp(p.x, 0, img.width), y = clamp(p.y, 0, img.height);
    cropDraft = { x: drag.start.x, y: drag.start.y, w: x - drag.start.x, h: y - drag.start.y };
    render(); return;
  }
  if (!live) return;
  const s = drag.start;
  if ('x1' in live) {
    let x2 = p.x, y2 = p.y;
    if (e.shiftKey) { // snap to 45°
      const a = Math.round(Math.atan2(y2 - s.y, x2 - s.x) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(x2 - s.x, y2 - s.y);
      x2 = s.x + len * Math.cos(a); y2 = s.y + len * Math.sin(a);
    }
    live.x2 = x2; live.y2 = y2;
  } else if (live.points) {
    const last = live.points[live.points.length - 1];
    if (Math.hypot(p.x - last[0], p.y - last[1]) > 1.2 / zoom) live.points.push([p.x, p.y]);
  } else {
    let w = p.x - s.x, h = p.y - s.y;
    if (e.shiftKey) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
    live.w = w; live.h = h;
  }
  render();
});

function endDrag() {
  if (!drag) return;
  const d = drag; drag = null;
  if (d.kind === 'move' && d.moved) { pushUndo(d.snap); persist(); }
  if (d.kind === 'crop') {
    const c = cropDraft && norm(cropDraft);
    cropDraft = null;
    if (c && c.w >= 8 && c.h >= 8) {
      pushUndo();
      const x = Math.round(clamp(c.x, 0, img.width)), y = Math.round(clamp(c.y, 0, img.height));
      doc.crop = { x, y, w: Math.round(Math.min(img.width - x, c.w)), h: Math.round(Math.min(img.height - y, c.h)) };
      persist();
      setTool('select');
      setZoom(fitZoom());
    } else render();
    return;
  }
  if (d.kind === 'shape' && live) {
    const o = live; live = null;
    const b = objectBounds(scratch, o);
    const big = o.points ? o.points.length > 1 || true : Math.max(b.w, b.h) >= 3 / zoom;
    if (big) { pushUndo(); doc.objects.push(o); persist(); }
    render();
  }
  syncButtons();
}
vp.addEventListener('pointerup', endDrag);
vp.addEventListener('pointercancel', endDrag);

// ------------------------------------------------------------------ text
function newText(p) {
  const o = { id: uid(), type: 'text', x: p.x, y: p.y, text: '', color };
  styleSize(o);
  openTextBox(o, true);
}
function editText(o) { openTextBox(o, false); }
function openTextBox(o, isNew) {
  if (textBox) commitText();
  const ta = document.createElement('textarea');
  ta.className = 'textedit';
  ta.value = o.text;
  const left = ox0 + (o.x - layout.crop.x + layout.ox) * zoom, top = oy0 + (o.y - layout.crop.y + layout.oy) * zoom;
  Object.assign(ta.style, { left: left + 'px', top: top + 'px', fontSize: o.size * zoom + 'px', color: o.color });
  const fit = () => { ta.style.height = 'auto'; ta.style.width = 'auto'; ta.style.height = ta.scrollHeight + 'px'; ta.style.width = Math.max(60, ta.scrollWidth + 8) + 'px'; };
  ta.addEventListener('input', fit);
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { textBox.cancel = true; commitText(); }
    else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); }
  });
  ta.addEventListener('blur', () => setTimeout(() => textBox && textBox.ta === ta && commitText(), 0));
  spacer.appendChild(ta);
  textBox = { ta, o, isNew, snap: snapshot() };
  if (!isNew) { o._hidden = true; doc.objects = doc.objects.filter((x) => x !== o); render(); }
  fit();
  setTimeout(() => { ta.focus(); ta.select(); }, 0);
}
function commitText() {
  if (!textBox) return;
  const { ta, o, isNew, snap, cancel } = textBox;
  textBox = null;
  ta.remove();
  delete o._hidden;
  const text = ta.value.replace(/\s+$/, '');
  if (cancel) { if (!isNew) doc.objects.push(o); }
  else if (text) { o.text = text; pushUndo(snap); doc.objects.push(o); persist(); }
  else if (!isNew) { pushUndo(snap); persist(); } // emptied → deleted
  render();
}

// ------------------------------------------------------------------ keyboard
const TOOL_KEYS = { v: 'select', c: 'crop', r: 'rect', o: 'ellipse', a: 'arrow', l: 'line', p: 'pen', h: 'marker', t: 'text', n: 'step', b: 'blur' };
window.addEventListener('keydown', (e) => {
  const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save('png'); return; }
  if (inField) return;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (mod && e.key.toLowerCase() === 'c') { if (!String(getSelection())) { e.preventDefault(); copy(); } return; }
  if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom(zoom * 1.25); return; }
  if (mod && e.key === '-') { e.preventDefault(); setZoom(zoom / 1.25); return; }
  if (mod && e.key === '0') { e.preventDefault(); setZoom(fitZoom()); return; }
  if (mod || e.altKey) return;
  if (e.key === ' ') { e.preventDefault(); if (!panKey) { panKey = true; vp.classList.add('pan'); } return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); return; }
  if (e.key === 'Escape') { live = null; drag = null; cropDraft = null; if (tool === 'crop') setTool('select'); selectedId = null; syncButtons(); render(); return; }
  if (e.key === '0') { setZoom(fitZoom()); return; }
  if (selectedId && e.key.startsWith('Arrow')) {
    e.preventDefault();
    const step = (e.shiftKey ? 10 : 1) * S;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    applyToSelected((o) => moveObject(o, d[0], d[1])); return;
  }
  const t = TOOL_KEYS[e.key.toLowerCase()];
  if (t) setTool(t);
});
window.addEventListener('keyup', (e) => { if (e.key === ' ') { panKey = false; vp.classList.remove('pan'); } });

// ------------------------------------------------------------------ stamp panel
const SB = { stEnabled: 'enabled', stTitle: 'title', stUrl: 'url', stTime: 'time', stDetails: 'details' };
function syncStampUI() {
  const s = doc.stamp;
  for (const [id, k] of Object.entries(SB)) $(id).checked = !!s[k];
  $('stPlace').value = s.placement === 'corner' ? `corner:${s.corner}` : s.placement;
  $('stTimeFmt').value = s.timeFormat; $('stTheme').value = s.theme; $('stSize').value = s.size; $('stNote').value = s.note || '';
  for (const id of ['stPlace', 'stTitle', 'stUrl', 'stTime', 'stDetails', 'stTimeFmt', 'stTheme', 'stSize', 'stNote']) $(id).disabled = !s.enabled;
}
function stampChange(fn, snap) { pushUndo(snap); fn(doc.stamp); syncStampUI(); relayout(); render(); persist(); }
for (const [id, k] of Object.entries(SB)) $(id).addEventListener('change', (e) => stampChange((s) => { s[k] = e.target.checked; }));
$('stPlace').addEventListener('change', (e) => stampChange((s) => { const [p, c] = e.target.value.split(':'); s.placement = p; if (c) s.corner = c; }));
$('stTimeFmt').addEventListener('change', (e) => stampChange((s) => { s.timeFormat = e.target.value; }));
$('stTheme').addEventListener('change', (e) => stampChange((s) => { s.theme = e.target.value; }));
let sizeSnap = null;
$('stSize').addEventListener('pointerdown', () => { sizeSnap = snapshot(); });
$('stSize').addEventListener('input', (e) => { doc.stamp.size = Number(e.target.value); relayout(); render(); });
$('stSize').addEventListener('change', () => { pushUndo(sizeSnap || undefined); sizeSnap = null; persist(); });
let noteSnap = null;
$('stNote').addEventListener('focus', () => { noteSnap = snapshot(); });
$('stNote').addEventListener('input', (e) => { doc.stamp.note = e.target.value; relayout(); render(); });
$('stNote').addEventListener('change', () => { pushUndo(noteSnap || undefined); noteSnap = snapshot(); persist(); });

// ------------------------------------------------------------------ info panel
function fillInfo() {
  const rows = [
    ['Title', meta.title || '—'],
    ['Address', meta.url || '—'],
    ['Captured', formatTime(meta.ts, 'local')],
    ['Type', MODE_NAMES[meta.mode] || meta.mode],
    ['Size', `${meta.cssW} × ${meta.cssH} CSS px`],
    ['Image', `${meta.width} × ${meta.height} px` + (meta.downscaled ? ' (reduced to fit the browser’s image limit)' : '')]
  ];
  const dl = $('info'); dl.innerHTML = '';
  for (const [k, v] of rows) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    dl.append(dt, dd);
  }
  const b = document.createElement('button');
  b.className = 'btn small'; b.id = 'resetCrop'; b.textContent = 'Remove crop';
  b.onclick = () => { pushUndo(); doc.crop = null; persist(); relayout(); setZoom(fitZoom()); syncButtons(); };
  $('openPage').before(b);
}
$('openPage').onclick = () => meta.url && chrome.tabs.create({ url: meta.url });
$('toHistory').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('history.html') });
$('undo').onclick = undo; $('redo').onclick = redo; $('del').onclick = deleteSelected;

// ------------------------------------------------------------------ output
let toastT = 0;
function toast(html, ms = 3500) {
  const t = $('toast'); t.innerHTML = html; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
  return t;
}

async function save(format) {
  if (textBox) commitText();
  settings = await getSettings();
  const btns = ['savePng', 'saveJpg', 'savePdf'].map($);
  btns.forEach((b) => (b.disabled = true));
  try {
    const { blob, ext } = await exportBlob(img, doc, meta, settings, format, cache);
    const url = URL.createObjectURL(blob);
    const filename = buildFilename(settings.filePattern, meta, ext, settings.folder);
    const dl = await chrome.downloads.download({ url, filename, saveAs: !!settings.saveAs, conflictAction: 'uniquify' });
    const kb = blob.size > 1048576 ? (blob.size / 1048576).toFixed(1) + ' MB' : Math.round(blob.size / 1024) + ' KB';
    const t = toast(`Saved ${ext.toUpperCase()} (${kb}) → Downloads/${escapeHtml(filename)}<a id="showDl">Show in folder</a>`, 6000);
    t.querySelector('#showDl').onclick = () => chrome.downloads.show(dl);
    const onCh = (d) => { if (d.id === dl && d.state && d.state.current !== 'in_progress') { URL.revokeObjectURL(url); chrome.downloads.onChanged.removeListener(onCh); } };
    chrome.downloads.onChanged.addListener(onCh);
  } catch (e) {
    toast('Could not save: ' + escapeHtml(e.message || String(e)), 6000);
  } finally { btns.forEach((b) => (b.disabled = false)); }
}

async function copy() {
  if (textBox) commitText();
  try {
    const blobP = renderFull(img, doc, meta, cache).canvas.convertToBlob({ type: 'image/png' });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobP })]);
    toast('Image copied to the clipboard — paste it into a chat, e-mail or document.');
  } catch (e) { toast('Copy failed: ' + escapeHtml(e.message || String(e)), 5000); }
}
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

$('savePng').onclick = () => save('png');
$('saveJpg').onclick = () => save('jpg');
$('savePdf').onclick = () => save('pdf');
$('copy').onclick = copy;

// ------------------------------------------------------------------ start
fillInfo();
syncStampUI();
setColor(color);
setTool('select');
relayout();
zoom = fitZoom();
$('zpct').textContent = Math.round(zoom * S * 100) + '%';
updateSpacer();
syncButtons();
render();
window.__fernaEditor = { get doc() { return doc; }, img, meta, save, setTool, get layout() { return layout; } };
