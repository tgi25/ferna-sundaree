// Ferna Screenshots — scene composition shared by the editor and the background worker.
// Works with CanvasRenderingContext2D and OffscreenCanvasRenderingContext2D (no DOM needed).
//
// Coordinate spaces
//   image space  : pixels of the original stitched capture (annotations live here)
//   output space : pixels of the exported picture = cropped image + optional stamp strip

import { formatTime, MODE_NAMES, middleEllipsis, endEllipsis } from './util.js';

export const FONT = 'system-ui, "Segoe UI", Roboto, "Noto Sans", "Nirmala UI", "Iskoola Pota", Arial, sans-serif';

const THEMES = {
  dark: { bg: 'rgba(15,23,42,0.86)', solid: '#0f172a', border: 'rgba(255,255,255,0.10)',
          title: '#ffffff', url: '#93c5fd', time: '#e2e8f0', note: '#fde68a', brand: '#94a3b8' },
  light: { bg: 'rgba(255,255,255,0.92)', solid: '#f8fafc', border: 'rgba(15,23,42,0.18)',
           title: '#0f172a', url: '#1d4ed8', time: '#334155', note: '#92400e', brand: '#64748b' }
};

export function stampLines(meta, st) {
  const L = [];
  if (st.title && meta.title) L.push({ k: 'title', t: meta.title });
  if (st.url && meta.url) L.push({ k: 'url', t: meta.url });
  const bits = [];
  if (st.time) bits.push(formatTime(meta.ts, st.timeFormat));
  if (st.details) bits.push(`${MODE_NAMES[meta.mode] || 'Capture'} · ${meta.cssW}×${meta.cssH} px`);
  if (bits.length) L.push({ k: 'time', t: bits.join('   ·   ') });
  if (st.note && st.note.trim()) L.push({ k: 'note', t: st.note.trim() });
  if (st.brand) L.push({ k: 'brand', t: 'Captured with Ferna Screenshots' });
  return L;
}

// Measure the stamp. strip=true → it spans the full output width.
export function measureStamp(ctx, meta, st, outW, strip) {
  const lines = stampLines(meta, st);
  if (!lines.length) return null;
  const u = Math.max(0.5, (meta.scale || 1) * (st.size || 1));
  const fs = 12.5 * u, pad = 9 * u, gap = 2.5 * u;
  const maxText = strip ? Math.max(40, outW - 2 * pad - 2 * u)
                        : Math.max(150 * u, Math.min(outW * 0.62 - 2 * pad, 720 * u));
  const out = [];
  let w = 0, h = pad;
  for (const ln of lines) {
    const size = ln.k === 'title' ? fs * 1.06 : ln.k === 'brand' ? fs * 0.86 : fs;
    const font = `${ln.k === 'title' ? '600 ' : ''}${size.toFixed(2)}px ${FONT}`;
    ctx.font = font;
    const fits = (t) => ctx.measureText(t).width <= maxText;
    const text = ln.k === 'url' ? middleEllipsis(ln.t, fits) : endEllipsis(ln.t.replace(/\s+/g, ' '), fits);
    const tw = ctx.measureText(text).width;
    const lh = size * 1.32;
    out.push({ k: ln.k, text, font, y: h + size * 1.02, lh });
    w = Math.max(w, tw);
    h += lh + gap;
  }
  h = h - gap + pad * 0.85;
  return { w: strip ? outW : Math.ceil(w + 2 * pad), h: Math.ceil(h), pad, u, lines: out, radius: 7 * u, strip: !!strip, theme: st.theme };
}

// Pick the visually quietest corner for the stamp (lowest edge energy + variance).
export function analyzeCorners(img, c, bw, bh) {
  try {
    const S = Math.min(1, 520 / c.w, 5000 / c.h);
    const sw = Math.max(1, Math.round(c.w * S)), sh = Math.max(1, Math.round(c.h * S));
    const cv = new OffscreenCanvas(sw, sh);
    const x = cv.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, c.x, c.y, c.w, c.h, 0, 0, sw, sh);
    const rw = Math.min(sw, Math.max(2, Math.round(bw * S))), rh = Math.min(sh, Math.max(2, Math.round(bh * S)));
    const order = ['br', 'tr', 'bl', 'tl'];
    let best = 'br', bestScore = Infinity;
    order.forEach((cn, i) => {
      const rx = cn[1] === 'r' ? sw - rw : 0, ry = cn[0] === 'b' ? sh - rh : 0;
      const d = x.getImageData(rx, ry, rw, rh).data;
      let sum = 0, sum2 = 0, grad = 0, n = 0;
      const L = new Float32Array(rw * rh);
      for (let p = 0, q = 0; p < d.length; p += 4, q++) {
        const l = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
        L[q] = l; sum += l; sum2 += l * l; n++;
      }
      for (let yy = 0; yy < rh - 1; yy++) for (let xx = 0; xx < rw - 1; xx++) {
        const q = yy * rw + xx;
        grad += Math.abs(L[q] - L[q + 1]) + Math.abs(L[q] - L[q + rw]);
      }
      const mean = sum / n, sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
      const g = grad / Math.max(1, (rw - 1) * (rh - 1));
      const score = (g + 0.35 * sd) * (1 + 0.05 * i);
      if (score < bestScore) { bestScore = score; best = cn; }
    });
    return best;
  } catch { return 'br'; }
}

export function sceneLayout(ctx, imgW, imgH, crop, meta, st, cornerFn) {
  const c = crop ? { ...crop } : { x: 0, y: 0, w: imgW, h: imgH };
  const L = { ox: 0, oy: 0, outW: c.w, outH: c.h, crop: c, box: null, sx: 0, sy: 0, corner: null };
  if (!st || !st.enabled) return L;
  const strip = st.placement === 'footer' || st.placement === 'header';
  const box = measureStamp(ctx, meta, st, c.w, strip);
  if (!box) return L;
  L.box = box;
  if (st.placement === 'footer') { L.sy = c.h; L.outH = c.h + box.h; }
  else if (st.placement === 'header') { L.oy = box.h; L.outH = c.h + box.h; }
  else {
    const m = Math.round(12 * box.u);
    const corner = st.corner === 'auto' ? (cornerFn ? cornerFn(c, box.w + 2 * m, box.h + 2 * m) : 'br') : st.corner;
    L.corner = corner;
    L.sx = corner[1] === 'r' ? Math.max(0, c.w - box.w - m) : Math.min(m, Math.max(0, c.w - box.w));
    L.sy = corner[0] === 'b' ? Math.max(0, c.h - box.h - m) : Math.min(m, Math.max(0, c.h - box.h));
  }
  return L;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export function drawStamp(ctx, L) {
  const b = L.box; if (!b) return;
  const T = THEMES[b.theme] || THEMES.dark;
  ctx.save();
  ctx.translate(L.sx, L.sy);
  if (b.strip) {
    ctx.fillStyle = T.solid; ctx.fillRect(0, 0, b.w, b.h);
    ctx.fillStyle = T.border; ctx.fillRect(0, L.oy ? b.h - Math.max(1, b.u) : 0, b.w, Math.max(1, b.u));
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 6 * b.u; ctx.shadowOffsetY = 1.5 * b.u;
    ctx.fillStyle = T.bg; roundRect(ctx, 0, 0, b.w, b.h, b.radius); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = Math.max(1, b.u * 0.8); ctx.strokeStyle = T.border; ctx.stroke();
  }
  ctx.textBaseline = 'alphabetic';
  for (const ln of b.lines) {
    ctx.font = ln.font; ctx.fillStyle = T[ln.k] || T.time;
    ctx.fillText(ln.text, b.pad, ln.y);
  }
  ctx.restore();
}

// ---------- annotations (image space) ----------

function arrowHead(ctx, x1, y1, x2, y2, size) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - size * Math.cos(a - 0.45), y2 - size * Math.sin(a - 0.45));
  ctx.lineTo(x2 - size * 0.72 * Math.cos(a), y2 - size * 0.72 * Math.sin(a));
  ctx.lineTo(x2 - size * Math.cos(a + 0.45), y2 - size * Math.sin(a + 0.45));
  ctx.closePath(); ctx.fill();
}

export function norm(o) { // rectangle with positive w/h
  const x = Math.min(o.x, o.x + o.w), y = Math.min(o.y, o.y + o.h);
  return { x, y, w: Math.abs(o.w), h: Math.abs(o.h) };
}

function pathPoints(ctx, pts) {
  ctx.beginPath();
  if (!pts.length) return;
  ctx.moveTo(pts[0][0], pts[0][1]);
  if (pts.length < 3) { for (const p of pts) ctx.lineTo(p[0], p[1]); if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.01, pts[0][1]); return; }
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const l = pts[pts.length - 1]; ctx.lineTo(l[0], l[1]);
}

function pixelate(ctx, o, img, cache) {
  const r = norm(o);
  const x = Math.max(0, Math.floor(r.x)), y = Math.max(0, Math.floor(r.y));
  const w = Math.min(img.width - x, Math.ceil(r.w)), h = Math.min(img.height - y, Math.ceil(r.h));
  if (w < 1 || h < 1) return;
  const b = Math.max(2, o.block || 10);
  const sw = Math.max(1, Math.ceil(w / b)), sh = Math.max(1, Math.ceil(h / b));
  const key = `${x},${y},${w},${h},${b}`;
  let e = cache && cache.get(o.id);
  if (!e || e.key !== key) {
    const cv = new OffscreenCanvas(sw, sh);
    const c2 = cv.getContext('2d');
    c2.imageSmoothingQuality = 'high';
    c2.drawImage(img, x, y, w, h, 0, 0, sw, sh);
    e = { key, cv };
    if (cache) cache.set(o.id, e);
  }
  ctx.save(); ctx.imageSmoothingEnabled = false;
  ctx.drawImage(e.cv, 0, 0, sw, sh, x, y, w, h);
  ctx.restore();
}

export function textMetrics(ctx, o) {
  ctx.font = `600 ${o.size}px ${FONT}`;
  const lines = String(o.text).split('\n');
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width), o.size * 0.5);
  return { lines, w, h: lines.length * o.size * 1.25 };
}

export function drawObject(ctx, o, img, cache) {
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = o.color; ctx.fillStyle = o.color; ctx.lineWidth = o.width || 3;
  switch (o.type) {
    case 'rect': { const r = norm(o); if (o.fill) { ctx.globalAlpha = 0.28; ctx.fillRect(r.x, r.y, r.w, r.h); ctx.globalAlpha = 1; } ctx.strokeRect(r.x, r.y, r.w, r.h); break; }
    case 'ellipse': { const r = norm(o); ctx.beginPath(); ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2); ctx.stroke(); break; }
    case 'line': ctx.beginPath(); ctx.moveTo(o.x1, o.y1); ctx.lineTo(o.x2, o.y2); ctx.stroke(); break;
    case 'arrow': {
      const head = Math.max(10, o.width * 4.2);
      const a = Math.atan2(o.y2 - o.y1, o.x2 - o.x1);
      const len = Math.hypot(o.x2 - o.x1, o.y2 - o.y1);
      const back = Math.min(len, head * 0.7);
      ctx.beginPath(); ctx.moveTo(o.x1, o.y1);
      ctx.lineTo(o.x2 - back * Math.cos(a), o.y2 - back * Math.sin(a)); ctx.stroke();
      arrowHead(ctx, o.x1, o.y1, o.x2, o.y2, head); break;
    }
    case 'pen': pathPoints(ctx, o.points); ctx.stroke(); break;
    case 'marker':
      ctx.globalAlpha = 0.38; ctx.globalCompositeOperation = 'multiply'; ctx.lineCap = 'square';
      pathPoints(ctx, o.points); ctx.stroke(); break;
    case 'blur': pixelate(ctx, o, img, cache); break;
    case 'text': {
      const m = textMetrics(ctx, o);
      ctx.textBaseline = 'top';
      ctx.lineWidth = Math.max(2, o.size / 5.5);
      ctx.strokeStyle = isLight(o.color) ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.92)';
      m.lines.forEach((l, i) => { ctx.strokeText(l, o.x, o.y + i * o.size * 1.25); ctx.fillText(l, o.x, o.y + i * o.size * 1.25); });
      break;
    }
    case 'step': {
      ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = Math.max(1.5, o.r / 7); ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.fillStyle = isLight(o.color) ? '#111' : '#fff';
      ctx.font = `700 ${o.r * 1.15}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(o.n), o.x, o.y + o.r * 0.05); break;
    }
  }
  ctx.restore();
}

export function isLight(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || '');
  if (!m) return false;
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 170;
}

export function objectBounds(ctx, o) {
  switch (o.type) {
    case 'rect': case 'ellipse': case 'blur': return norm(o);
    case 'line': case 'arrow': return { x: Math.min(o.x1, o.x2), y: Math.min(o.y1, o.y2), w: Math.abs(o.x2 - o.x1), h: Math.abs(o.y2 - o.y1) };
    case 'pen': case 'marker': {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of o.points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    case 'text': { const m = textMetrics(ctx, o); return { x: o.x, y: o.y, w: m.w, h: m.h }; }
    case 'step': return { x: o.x - o.r, y: o.y - o.r, w: 2 * o.r, h: 2 * o.r };
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}

export function moveObject(o, dx, dy) {
  if ('x1' in o) { o.x1 += dx; o.y1 += dy; o.x2 += dx; o.y2 += dy; }
  else if (o.points) o.points = o.points.map(([x, y]) => [x + dx, y + dy]);
  else { o.x += dx; o.y += dy; }
}

// Draw the whole scene in output space. opts.visible = {x,y,w,h} (output space) limits work.
export function drawScene(ctx, img, objects, L, opts = {}) {
  const c = L.crop;
  let vx0 = 0, vy0 = 0, vx1 = L.outW, vy1 = L.outH;
  if (opts.visible) { vx0 = opts.visible.x; vy0 = opts.visible.y; vx1 = vx0 + opts.visible.w; vy1 = vy0 + opts.visible.h; }
  // image part (only the visible sub-rectangle)
  const ix0 = Math.max(L.ox, vx0), iy0 = Math.max(L.oy, vy0);
  const ix1 = Math.min(L.ox + c.w, vx1), iy1 = Math.min(L.oy + c.h, vy1);
  if (ix1 > ix0 && iy1 > iy0) {
    const sx = Math.floor(ix0 - L.ox + c.x), sy = Math.floor(iy0 - L.oy + c.y);
    const ex = Math.ceil(ix1 - L.ox + c.x), ey = Math.ceil(iy1 - L.oy + c.y);
    ctx.drawImage(img, sx, sy, ex - sx, ey - sy, sx - c.x + L.ox, sy - c.y + L.oy, ex - sx, ey - sy);
  }
  ctx.save();
  ctx.beginPath(); ctx.rect(L.ox, L.oy, c.w, c.h); ctx.clip();
  ctx.translate(L.ox - c.x, L.oy - c.y);
  for (const o of objects) drawObject(ctx, o, img, opts.cache);
  ctx.restore();
  drawStamp(ctx, L);
}

// Render the final picture at full resolution.
export function renderFull(img, doc, meta, cache) {
  const scratch = new OffscreenCanvas(4, 4).getContext('2d');
  const L = sceneLayout(scratch, img.width, img.height, doc.crop, meta, doc.stamp,
    (c, w, h) => analyzeCorners(img, c, w, h));
  const cv = new OffscreenCanvas(Math.max(1, Math.round(L.outW)), Math.max(1, Math.round(L.outH)));
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
  drawScene(ctx, img, doc.objects || [], L, { cache });
  return { canvas: cv, layout: L };
}
