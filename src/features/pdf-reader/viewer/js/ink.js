// Low-latency live ink (Xodo-like). Draws on a desynchronized canvas laid over the page while the
// stroke is in progress, using every coalesced pointer sample and quadratic curves through midpoints.
// Predicted samples are drawn on a second canvas that is cleared on every event.
import { simplify } from './util.js';

let generation = 0;
const liveCanvas = () => document.getElementById('inkLive');
const predCanvas = () => document.getElementById('inkPredict');

function prepCanvas(c, pv, opts) {
  const dpr = window.devicePixelRatio || 1;
  const w = pv.dispW, h = pv.dispH;
  c.style.width = w + 'px';
  c.style.height = h + 'px';
  const W = Math.round(w * dpr), H = Math.round(h * dpr);
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  c.style.opacity = opts.opacity ?? 1;
  c.style.mixBlendMode = opts.marker ? 'multiply' : 'normal';
  pv.div.append(c);
  let ctx = c._ctx;
  if (!ctx) {
    try { ctx = c.getContext('2d', { desynchronized: true, alpha: true }); } catch { ctx = null; }
    if (!ctx) ctx = c.getContext('2d');
    c._ctx = ctx;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = opts.color;
  ctx.fillStyle = opts.color;
  ctx.lineWidth = Math.max(0.5, opts.width * pv.scale);
  ctx.lineCap = opts.marker ? 'butt' : 'round';
  ctx.lineJoin = 'round';
  return ctx;
}

export class InkStroke {
  constructor(pv, opts) {
    generation++;
    this.pv = pv;
    this.opts = opts;           // {color, width (pt), opacity, marker}
    this.pts = [];              // local display px
    this.ctx = prepCanvas(liveCanvas(), pv, opts);
    this.pctx = prepCanvas(predCanvas(), pv, opts);
    this.rect = pv.div.getBoundingClientRect();
    this.lastMid = null;
  }

  _local(e) { return [e.clientX - this.rect.left, e.clientY - this.rect.top]; }

  begin(e) {
    const p = this._local(e);
    this.pts.push(p);
    const ctx = this.ctx;
    // draw a dot so a tap is visible immediately
    if (!this.opts.marker) {
      ctx.beginPath();
      ctx.arc(p[0], p[1], ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    this.lastMid = p;
  }

  // e: a pointer event (pointermove / pointerrawupdate)
  move(e) {
    const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    const samples = list.length ? list : [e];
    const ctx = this.ctx;
    for (const s of samples) {
      const p = this._local(s);
      const last = this.pts[this.pts.length - 1];
      if (last && Math.abs(p[0] - last[0]) < 0.35 && Math.abs(p[1] - last[1]) < 0.35) continue;
      this.pts.push(p);
      const n = this.pts.length;
      if (n < 2) continue;
      const c = this.pts[n - 2];
      const mid = [(c[0] + p[0]) / 2, (c[1] + p[1]) / 2];
      ctx.beginPath();
      ctx.moveTo(this.lastMid[0], this.lastMid[1]);
      ctx.quadraticCurveTo(c[0], c[1], mid[0], mid[1]);
      ctx.stroke();
      this.lastMid = mid;
    }
    // prediction (reduces perceived latency)
    const pc = this.pctx;
    pc.clearRect(0, 0, this.pv.dispW, this.pv.dispH);
    const pred = e.getPredictedEvents ? e.getPredictedEvents() : [];
    if (pred.length && this.pts.length) {
      pc.beginPath();
      pc.moveTo(this.lastMid[0], this.lastMid[1]);
      const last = this.pts[this.pts.length - 1];
      pc.lineTo(last[0], last[1]);
      for (const s of pred.slice(0, 3)) { const p = this._local(s); pc.lineTo(p[0], p[1]); }
      pc.stroke();
    }
  }

  // Returns a PDF-space path (flat array) or null.
  end() {
    const ctx = this.ctx;
    const n = this.pts.length;
    if (n >= 2) {
      const last = this.pts[n - 1];
      ctx.beginPath();
      ctx.moveTo(this.lastMid[0], this.lastMid[1]);
      ctx.lineTo(last[0], last[1]);
      ctx.stroke();
    }
    this.pctx.clearRect(0, 0, this.pv.dispW, this.pv.dispH);
    if (!n) return null;
    const flat = [];
    for (const [x, y] of this.pts) { const P = this.pv.localToPdf(x, y); flat.push(P[0], P[1]); }
    // light simplification: tolerance ≈ 0.25 screen px, never more than 0.3 pt
    const eps = Math.min(0.3, 0.25 / this.pv.scale);
    return simplify(flat, eps);
  }

  // Clear after the stroke has been committed to the SVG layer (next frame, to avoid a flash).
  clear() {
    const c = liveCanvas(), p = predCanvas();
    const g = generation;
    requestAnimationFrame(() => {
      if (g !== generation) return; // a new stroke already started
      c._ctx?.clearRect(0, 0, c.width, c.height);
      p._ctx?.clearRect(0, 0, p.width, p.height);
      c.remove(); p.remove();
      document.getElementById('app').append(c, p);
    });
  }
}
