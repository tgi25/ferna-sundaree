// v1.5: OCR for scanned PDFs (English and Sinhala), fully on the user's computer.
// Tesseract (tesseract.js 7 + tesseract.js-core 6, LSTM models) runs in a Web Worker from the extension
// package; nothing is downloaded. Recognised words are written into the PDF as invisible text (render mode 3)
// exactly over the scanned words, so the page can be selected, searched, copied, highlighted and used by the AI
// — in Ferna and in any other PDF reader.
import Tesseract from '../../lib/tesseract/tesseract.esm.min.js';

const BASE = new URL('../../lib/', import.meta.url).href;
const L = () => PDFLib;

// fontkit (UMD build, sets window.fontkit) is only loaded when an OCR text layer is written
let fontkitP = null;
function loadFontkit() {
  if (window.fontkit) return Promise.resolve(window.fontkit);
  fontkitP ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = BASE + 'fontkit/fontkit.umd.min.js';
    s.onload = () => (window.fontkit ? res(window.fontkit) : rej(new Error('fontkit did not load')));
    s.onerror = () => rej(new Error('fontkit did not load'));
    document.head.append(s);
  });
  return fontkitP;
}

export const OCR_LANGS = [
  { id: 'eng', label: 'English' },
  { id: 'sin', label: 'සිංහල (Sinhala)' },
  { id: 'sin+eng', label: 'Sinhala + English' }
];

let simdOK = null;
function hasSimd() {
  if (simdOK == null) {
    try {
      simdOK = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
    } catch { simdOK = false; }
  }
  return simdOK;
}

export class OcrEngine {
  constructor() { this.worker = null; this.langs = null; this.onProgress = null; }

  async ensure(langs) {
    if (this.worker && this.langs === langs) return this.worker;
    await this.terminate();
    this.worker = await Tesseract.createWorker(langs.split('+'), Tesseract.OEM.LSTM_ONLY, {
      workerPath: BASE + 'tesseract/worker.min.js',
      corePath: BASE + (hasSimd() ? 'tesseract/tesseract-core-simd-lstm.js' : 'tesseract/tesseract-core-lstm.js'),
      langPath: BASE + 'tesseract/lang',
      gzip: true,
      cacheMethod: 'none',
      workerBlobURL: false,
      logger: (m) => this.onProgress?.(m)
    });
    await this.worker.setParameters({ preserve_interword_spaces: '1', user_defined_dpi: '300' });
    this.langs = langs;
    return this.worker;
  }

  async terminate() {
    const w = this.worker;
    this.worker = null; this.langs = null;
    if (w) { try { await w.terminate(); } catch { /* ignore */ } }
  }

  // Render one pdf.js page at ~300 dpi and recognise it → { words: [{text, x0,y0,x1,y1, base, conf}], w, h, viewport }
  async recognizePage(page, langs) {
    const worker = await this.ensure(langs);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = Math.max(1.5, Math.min(300 / 72, 4200 / Math.max(vp1.width, vp1.height)));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d', { willReadFrequently: true }), canvas, viewport, background: '#fff' }).promise;
    const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true });
    canvas.width = canvas.height = 0;
    const words = [];
    for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const ln of p.lines || []) {
      const lw = [];
      for (const w of ln.words || []) {
        const text = (w.text || '').trim();
        if (!text || w.confidence < 25) continue;
        lw.push({ text, ...w.bbox, base: ln.baseline, conf: w.confidence });
      }
      lw.forEach((w, i) => { w.space = i < lw.length - 1; });        // a real space between words of a line
      words.push(...lw);
    }
    return { words, viewport, text: data.text || '' };
  }
}

// Add an invisible text layer to the given pages of `bytes`.
// results: Map(pageIndex → { words, viewport }) — viewport is the pdf.js viewport the image was rendered with.
export async function addTextLayer(bytes, results) {
  const { PDFDocument, pushGraphicsState, popGraphicsState, beginText, endText, setFontAndSize, setTextRenderingMode,
    TextRenderingMode, setTextMatrix, showText, setCharacterSqueeze, beginMarkedContent, endMarkedContent } = L();
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  doc.registerFontkit(await loadFontkit());
  const fontBytes = await (await fetch(BASE + 'fonts/NotoSansSinhala-Regular.ttf')).arrayBuffer();
  const font = await doc.embedFont(fontBytes, { subset: false });   // 155 KB; fontkit's subsetter fails on this font
  const pages = doc.getPages();
  const supported = new Set(font.getCharacterSet());
  const { PDFHexString } = L();
  // Invisible text needs no shaping: encode character by character (logical Unicode order, so copying gives
  // the right text, and it avoids fontkit's Indic shaper, which fails on some Sinhala sequences).
  // direct character → glyph mapping (the full, non-subset font's ToUnicode covers every glyph in its cmap)
  const fk = font.embedder?.font;
  const cw = new Map(), ch = new Map();
  const unit = (c) => {
    if (!ch.has(c)) {
      let hex = '', w = 0;
      try {
        if (fk?.glyphForCodePoint) {
          const g = fk.glyphForCodePoint(c.codePointAt(0));
          if (g && g.id) { hex = g.id.toString(16).padStart(4, '0'); w = g.advanceWidth / fk.unitsPerEm; }
        } else { hex = font.encodeText(c).toString().slice(1, -1); w = font.widthOfTextAtSize(c, 1); }
      } catch { /* not in the font */ }
      ch.set(c, hex); cw.set(c, w);
    }
    return ch.get(c);
  };
  const encode = (t) => { let hex = '', w = 0; for (const c of t) { const h = unit(c); if (h) { hex += h; w += cw.get(c); } } return { hex, w }; };
  for (const [index, { words, viewport }] of results) {
    const page = pages[index];
    if (!page || !words.length) continue;
    page.node.normalize?.();
    const fontKey = page.node.newFontDictionary(font.name, font.ref);
    // tagged /FernaOCR so Ferna knows the spaces in it are exact (there is no ink to measure)
    const ops = [beginMarkedContent('FernaOCR'), pushGraphicsState(), beginText(), setTextRenderingMode(TextRenderingMode.Invisible)];
    for (const w of words) {
      const text = [...w.text].filter((ch) => supported.has(ch.codePointAt(0))).join('');
      if (!text) continue;
      // baseline of the word in image pixels (line baseline, interpolated), then into PDF user space
      const b = w.base;
      const yAt = (x) => (b && b.x1 !== b.x0 ? b.y0 + (b.y1 - b.y0) * (x - b.x0) / (b.x1 - b.x0) : w.y1);
      let by0 = yAt(w.x0), by1 = yAt(w.x1);
      if (!(by0 > w.y0 && by0 <= w.y1 + 4)) by0 = w.y1;
      if (!(by1 > w.y0 && by1 <= w.y1 + 4)) by1 = w.y1;
      const p0 = viewport.convertToPdfPoint(w.x0, by0), p1 = viewport.convertToPdfPoint(w.x1, by1);
      const hpx = Math.max(4, Math.min(by0, by1) - w.y0);                 // ascender height above the baseline
      const pTop = viewport.convertToPdfPoint(w.x0, by0 - hpx);
      const dx = p1[0] - p0[0], dy = p1[1] - p0[1], len = Math.hypot(dx, dy);
      const ux = pTop[0] - p0[0], uy = pTop[1] - p0[1], asc = Math.hypot(ux, uy);
      if (len < 0.5 || asc < 0.5) continue;
      const size = asc / 0.75;                                              // cap height ≈ 0.75 em
      const enc = encode(text);
      if (!enc.hex) continue;
      const natural = enc.w * size;
      if (w.space) enc.hex += unit(' ');                            // explicit space → clean words when copying
      const squeeze = natural > 0 ? Math.max(1, Math.min(1000, (len / natural) * 100)) : 100;
      ops.push(
        setFontAndSize(fontKey, size),
        setCharacterSqueeze(squeeze),
        setTextMatrix(dx / len, dy / len, ux / asc, uy / asc, p0[0], p0[1]),
        showText(PDFHexString.of(enc.hex))
      );
    }
    ops.push(endText(), popGraphicsState(), endMarkedContent());
    page.pushOperators(...ops);
  }
  return doc.save({ useObjectStreams: false });
}

// Pages that have (almost) no text of their own — the ones that need OCR.
export async function pagesWithoutText(pdf, onProgress) {
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    const chars = tc.items.reduce((n, it) => n + (it.str || '').replace(/\s+/g, '').length, 0);
    if (chars < 12) out.push(i - 1);
    onProgress?.(i / pdf.numPages);
  }
  return out;
}
