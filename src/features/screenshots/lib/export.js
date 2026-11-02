// Ferna Screenshots — turn a capture + edits into a PNG / JPEG / PDF blob.

import { renderFull } from './compose.js';
import { buildPdf } from './pdf.js';

const A4 = { w: 595.28, h: 841.89 };
const MAX_PT = 14400; // PDF page size limit (200 in)

export async function exportBlob(img, doc, meta, settings, format, cache) {
  const { canvas, layout } = renderFull(img, doc, meta, cache);
  if (format === 'jpg') {
    return { blob: await canvas.convertToBlob({ type: 'image/jpeg', quality: settings.jpegQuality || 0.92 }), ext: 'jpg' };
  }
  if (format === 'pdf') return { blob: await toPdf(canvas, layout, meta, settings), ext: 'pdf' };
  return { blob: await canvas.convertToBlob({ type: 'image/png' }), ext: 'png' };
}

async function toPdf(canvas, L, meta, settings) {
  const W = canvas.width, H = canvas.height;
  let pageW, pxPerPt, pageH;
  if (settings.pdfPage === 'single') {
    pageW = Math.min(MAX_PT, (W / (meta.scale || 1)) * 0.75);
    pxPerPt = W / pageW;
    pageH = Math.min(MAX_PT, H / pxPerPt);
  } else {
    pageW = A4.w; pxPerPt = W / pageW; pageH = A4.h;
  }
  const sliceH = Math.max(1, Math.floor(pageH * pxPerPt));
  const pages = [];
  for (let y = 0; y < H; y += sliceH) {
    const h = Math.min(sliceH, H - y);
    const cv = new OffscreenCanvas(W, h);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, h);
    ctx.drawImage(canvas, 0, y, W, h, 0, 0, W, h);
    const jpeg = new Uint8Array(await (await cv.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer());
    const ph = settings.pdfPage === 'single' ? h / pxPerPt : pageH;
    pages.push({ jpeg, imgW: W, imgH: h, pageW, pageH: ph, drawW: pageW, drawH: h / pxPerPt });
  }
  // clickable page address over the stamp's URL line (first page only)
  let link = null;
  const b = L.box;
  const urlLine = b && b.lines.find((l) => l.k === 'url');
  if (urlLine && meta.url && /^https?:/i.test(meta.url)) {
    const top = L.sy + urlLine.y - urlLine.lh * 0.85;
    if (top + urlLine.lh <= sliceH) {
      link = { url: meta.url, x: (L.sx + b.pad) / pxPerPt, y: top / pxPerPt, w: (b.w - 2 * b.pad) / pxPerPt, h: urlLine.lh / pxPerPt };
    }
  }
  return buildPdf(pages, { title: meta.title || 'Screenshot', subject: meta.url, ts: meta.ts, link });
}
