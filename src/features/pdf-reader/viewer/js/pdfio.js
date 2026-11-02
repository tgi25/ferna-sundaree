// Loading PDFs, importing their editable annotations, and writing annotations back as standard PDF annotations.
/* global PDFLib */
import { IS_FIREFOX } from './platform.js';
import { helperAvailable, readWithHelper, fileUrlToPath } from './saver.js';
import { uid, hexToRgb, rgbToHex, smoothQuad, f } from './util.js';
import { orientedCorners, markupStrokes, bbox, normRect, arrowHead, MARKUP_TYPES } from './annots.js';

const L = () => PDFLib;

// ------------------------------------------------------------------ fetching
function readFileUrl(url, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('GET', url);
    x.responseType = 'arraybuffer';
    x.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    x.onload = () => (x.status === 0 || x.status === 200) && x.response ? resolve(new Uint8Array(x.response)) : reject(new Error('Could not read the local file.'));
    x.onerror = () => reject(new Error('Could not read the local file. Enable "Allow access to file URLs" for Ferna PDF Reader on the extension’s Details page.'));
    x.send();
  });
}

export async function fetchPdf(url, onProgress) {
  if (url.startsWith('file:')) {
    // Firefox never lets extensions read file:// URLs: go straight to the save helper there
    if (!IS_FIREFOX) {
      try { return await readFileUrl(url, onProgress); } catch (e) { if (!(await helperAvailable())) throw e; }
    }
    if (await helperAvailable()) return readWithHelper(fileUrlToPath(url), onProgress);
    throw new Error(IS_FIREFOX
      ? 'Firefox does not let extensions read files from your disk. Install the Ferna save helper once (Ferna-PDF-Save-Helper zip → Install-Save-Helper.bat, then restart Firefox), or open the file with Ferna’s Open button.'
      : 'Could not read the local file. Enable "Allow access to file URLs" for Ferna PDF Reader on the extension’s Details page.');
  }
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`The server answered ${res.status} ${res.statusText}`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress?.(got / total);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// ------------------------------------------------------------------ import
const IMPORTABLE = new Set(['/Highlight', '/Underline', '/StrikeOut', '/Squiggly', '/Ink', '/Square', '/Circle', '/Line', '/FreeText', '/Text']);
const TYPE_FROM = { '/Highlight': 'highlight', '/Underline': 'underline', '/StrikeOut': 'strikeout', '/Squiggly': 'squiggly', '/Ink': 'ink', '/Square': 'rect', '/Circle': 'ellipse', '/Line': 'line', '/FreeText': 'freetext', '/Text': 'note' };
const MAX_IMPORT_BYTES = Infinity; // Ferna Sundaree: 1.6.2 fix, no size limit

function num(o) { return o && typeof o.asNumber === 'function' ? o.asNumber() : (typeof o?.value === 'function' ? o.value() : Number(o)); }
function nums(arr) {
  if (!arr || typeof arr.size !== 'function') return null;
  const out = [];
  for (let i = 0; i < arr.size(); i++) out.push(num(arr.lookup(i)));
  return out;
}
function text(o) {
  if (!o) return '';
  try { return o.decodeText ? o.decodeText() : String(o); } catch { return ''; }
}
function colorFrom(arr) {
  const c = nums(arr);
  if (!c || !c.length) return null;
  if (c.length === 1) return rgbToHex([c[0], c[0], c[0]]);
  if (c.length === 3) return rgbToHex(c);
  if (c.length === 4) { const k = c[3]; return rgbToHex([(1 - c[0]) * (1 - k), (1 - c[1]) * (1 - k), (1 - c[2]) * (1 - k)]); }
  return null;
}

// Reads /Encrypt of an encrypted file without decrypting it.
async function readEncryptInfo(bytes) {
  const { PDFDocument, PDFName, PDFDict } = L();
  try {
    const d = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    const enc = d.context.lookup(d.context.trailerInfo.Encrypt);
    if (!(enc instanceof PDFDict)) return {};
    const g = (k) => enc.lookup(PDFName.of(k));
    return { P: num(g('P')), R: num(g('R')), V: num(g('V')) };
  } catch { return {}; }
}

// PDF permission bits → pdf-lib permission object
function permissionsFromP(P) {
  if (P == null || Number.isNaN(P)) return undefined;
  const b = (bit) => (P & (1 << (bit - 1))) !== 0;
  return {
    printing: b(3) ? (b(12) ? 'highResolution' : 'lowResolution') : false,
    modifying: b(4), copying: b(5), annotating: b(6),
    fillingForms: b(9), contentAccessibility: b(10), documentAssembly: b(11)
  };
}
// undefined when nothing is actually restricted
function restrictive(p) {
  if (!p) return undefined;
  const all = p.printing === 'highResolution' && p.modifying && p.copying && p.annotating && p.fillingForms && p.contentAccessibility && p.documentAssembly;
  return all ? undefined : p;
}
const ALL_PERMISSIONS = { printing: 'highResolution', modifying: true, copying: true, annotating: true, fillingForms: true, contentAccessibility: true, documentAssembly: true };

const isEncryptedError = (e) => /encrypt/i.test(String(e?.message || e)) || e?.constructor?.name === 'EncryptedPDFError';

// Returns {bytes (decrypted, imported annotations stripped), annotations, stripped, encryption, encrypted?, cancelled?}
// askPassword(retry:boolean) → Promise<string|null>
export async function importAnnotations(bytes, askPassword) {
  const { PDFDocument, PDFName, PDFDict, PDFRef } = L();
  if (bytes.length > MAX_IMPORT_BYTES) return { bytes, annotations: [], stripped: false, note: 'large' };
  let doc;
  let encryption = null;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
  } catch (e) {
    if (!isEncryptedError(e)) return { bytes, annotations: [], stripped: false, error: e };
    // Password-protected or permission-restricted: try the empty password first, then ask.
    const info = await readEncryptInfo(bytes);
    let pw = '';
    for (let attempt = 0; ; attempt++) {
      try {
        doc = await PDFDocument.load(bytes, { password: pw, updateMetadata: false, throwOnInvalidObject: false });
        break;
      } catch (e2) {
        if (!/password/i.test(String(e2?.message))) return { bytes, annotations: [], stripped: false, encrypted: true, error: e2 };
        pw = await askPassword(attempt > 0);
        if (pw == null) return { bytes, annotations: [], cancelled: true, encrypted: true };
      }
    }
    const perms = restrictive(permissionsFromP(info.P));
    encryption = pw === '' && !perms ? null : {
      userPassword: pw,
      ownerOnly: pw === '',
      algorithm: (info.R || 0) >= 5 ? 'AES-256' : 'AES-128',
      permissions: perms
    };
  }
  const annotations = [];
  const N = (s) => PDFName.of(s);
  const pages = doc.getPages();
  let removed = 0;
  pages.forEach((page, pi) => {
    const annotsArr = page.node.Annots();
    if (!annotsArr) return;
    const toRemove = [];
    for (let i = 0; i < annotsArr.size(); i++) {
      const ref = annotsArr.get(i);
      const dict = doc.context.lookup(ref);
      if (!(dict instanceof PDFDict)) continue;
      const st = dict.get(N('Subtype'))?.toString();
      if (!IMPORTABLE.has(st)) continue;
      const flags = num(dict.lookup(N('F'))) || 0;
      if (flags & 2) continue; // hidden
      if (st === '/FreeText' && dict.get(N('IT'))?.toString() === '/FreeTextCallout') continue;
      try {
        const a = parseAnnot(dict, st, pi, N);
        if (!a) continue;
        annotations.push(a);
        toRemove.push(ref);
        const popup = dict.get(N('Popup'));
        if (popup instanceof PDFRef) toRemove.push(popup);
      } catch (e) { console.warn('annotation import skipped', e); }
    }
    for (const ref of toRemove) {
      if (ref instanceof PDFRef) { page.node.removeAnnot(ref); removed++; }
    }
  });
  if (!removed && !encryption) return { bytes, annotations: [], stripped: false, encryption };
  // Encrypted input is always re-saved decrypted (in memory only) so the viewer and the writer can use it.
  const out = await doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
  return { bytes: out, annotations, stripped: removed > 0, encryption };
}

function parseAnnot(dict, st, page, N) {
  const type0 = TYPE_FROM[st];
  const g = (k) => dict.lookup(N(k));
  const a = {
    id: text(g('NM')) || uid(),
    page,
    type: type0,
    color: colorFrom(g('C')) || '#ffd400',
    opacity: g('CA') ? num(g('CA')) : 1,
    contents: text(g('Contents')),
    author: text(g('T'))
  };
  const bs = g('BS');
  const w = bs ? num(bs.lookup(N('W'))) : NaN;
  const border = nums(g('Border'));
  a.width = Number.isFinite(w) ? w : (border && border.length >= 3 ? border[2] : 1);
  const rect = nums(g('Rect'));
  const fernaType = g('FernaType')?.toString();
  const fernaText = g('FernaText');
  if (fernaText) a.text = text(fernaText);

  if (MARKUP_TYPES.has(type0)) {
    const q = nums(g('QuadPoints'));
    if (!q || q.length < 8) return null;
    a.rects = [];
    let up = null;
    for (let i = 0; i + 7 < q.length; i += 8) {
      const xs = [q[i], q[i + 2], q[i + 4], q[i + 6]], ys = [q[i + 1], q[i + 3], q[i + 5], q[i + 7]];
      a.rects.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
      if (!up) {
        // vector from lower-left (x3,y3) to upper-left (x1,y1)
        const dx = q[i] - q[i + 4], dy = q[i + 1] - q[i + 5];
        up = Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dy) || 1];
      }
    }
    a.upright = up || [0, 1];
    if (fernaType === '/area') a.area = true;
    delete a.width;
  } else if (type0 === 'ink') {
    const inkList = g('InkList');
    if (!inkList) return null;
    a.paths = [];
    for (let i = 0; i < inkList.size(); i++) { const p = nums(inkList.lookup(i)); if (p && p.length >= 2) a.paths.push(p); }
    if (!a.paths.length) return null;
    if (fernaType === '/marker') a.type = 'marker';
  } else if (type0 === 'rect' || type0 === 'ellipse') {
    if (!rect) return null;
    a.rect = normRect(rect);
    const ic = g('IC');
    a.fill = !!(ic && nums(ic)?.length);
  } else if (type0 === 'line') {
    const l = nums(g('L'));
    if (!l || l.length < 4) return null;
    a.line = l.slice(0, 4);
    const le = g('LE');
    if (le && le.size && le.size() >= 2) {
      const end = le.lookup(1)?.toString();
      const start = le.lookup(0)?.toString();
      if (/Arrow/.test(end || '')) a.type = 'arrow';
      else if (/Arrow/.test(start || '')) { a.type = 'arrow'; a.line = [l[2], l[3], l[0], l[1]]; }
    }
  } else if (type0 === 'freetext') {
    if (!rect) return null;
    a.rect = normRect(rect);
    a.text = a.contents;
    a.contents = '';
    const da = text(g('DA'));
    const fs = /([\d.]+)\s+Tf/.exec(da);
    a.fontSize = fs ? Number(fs[1]) || 12 : 12;
    const rg = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(da);
    const gray = /([\d.]+)\s+g(\s|$)/.exec(da);
    a.color = rg ? rgbToHex([+rg[1], +rg[2], +rg[3]]) : gray ? rgbToHex([+gray[1], +gray[1], +gray[1]]) : '#000000';
    const up = nums(g('FernaUp'));
    a.upright = up && up.length === 2 ? up : [0, 1];
    delete a.width;
  } else if (type0 === 'note') {
    if (!rect) return null;
    a.rect = normRect(rect);
    delete a.width;
  }
  return a;
}

// ------------------------------------------------------------------ export
const K = 0.5522847498;

function rgbOps(hex, stroke) {
  const [r, g, b] = hexToRgb(hex || '#000000');
  return `${f(r)} ${f(g)} ${f(b)} ${stroke ? 'RG' : 'rg'}`;
}

function inkPathOps(flat) {
  const { start, segs } = smoothQuad(flat);
  let s = `${f(start[0])} ${f(start[1])} m\n`;
  if (flat.length === 2) return s + `${f(start[0] + 0.01)} ${f(start[1])} l\n`;
  let p0 = start;
  for (const [cx, cy, x, y] of segs) {
    // quadratic → cubic
    const c1x = p0[0] + (2 / 3) * (cx - p0[0]), c1y = p0[1] + (2 / 3) * (cy - p0[1]);
    const c2x = x + (2 / 3) * (cx - x), c2y = y + (2 / 3) * (cy - y);
    s += `${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(x)} ${f(y)} c\n`;
    p0 = [x, y];
  }
  return s;
}

function ellipseOps(x1, y1, x2, y2) {
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = (x2 - x1) / 2, ry = (y2 - y1) / 2;
  const ox = rx * K, oy = ry * K;
  return `${f(cx - rx)} ${f(cy)} m\n` +
    `${f(cx - rx)} ${f(cy + oy)} ${f(cx - ox)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)} c\n` +
    `${f(cx + ox)} ${f(cy + ry)} ${f(cx + rx)} ${f(cy + oy)} ${f(cx + rx)} ${f(cy)} c\n` +
    `${f(cx + rx)} ${f(cy - oy)} ${f(cx + ox)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)} c\n` +
    `${f(cx - ox)} ${f(cy - ry)} ${f(cx - rx)} ${f(cy - oy)} ${f(cx - rx)} ${f(cy)} c\n`;
}

function wrapLines(font, str, size, maxW) {
  const out = [];
  for (const para of str.split('\n')) {
    if (!para) { out.push(''); continue; }
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const cand = line + w;
      if (line && safeWidth(font, cand.trimEnd(), size) > maxW) {
        out.push(line.trimEnd());
        line = w.trimStart();
        // very long word: hard-break
        while (safeWidth(font, line, size) > maxW && line.length > 1) {
          let k = line.length - 1;
          while (k > 1 && safeWidth(font, line.slice(0, k), size) > maxW) k--;
          out.push(line.slice(0, k));
          line = line.slice(k);
        }
      } else line = cand;
    }
    out.push(line.trimEnd());
  }
  return out;
}
function sanitize(font, s) {
  try { font.encodeText(s); return s; } catch {
    return Array.from(s).map((ch) => { try { font.encodeText(ch); return ch; } catch { return '?'; } }).join('');
  }
}
function safeWidth(font, s, size) { try { return font.widthOfTextAtSize(sanitize(font, s), size); } catch { return s.length * size * 0.5; } }

// encryption: null | {userPassword, ownerPassword?, algorithm, permissions?, ownerOnly?}
export async function exportPdf(baseBytes, annotations, rotations, { encryption = null, outline = null } = {}) {
  const { PDFDocument, PDFName, PDFHexString, PDFString, degrees, StandardFonts } = L();
  const doc = await PDFDocument.load(baseBytes, { updateMetadata: false });
  const ctx = doc.context;
  const pages = doc.getPages();
  let helv = null;

  rotations.forEach((r, i) => { if (r != null && pages[i]) pages[i].setRotation(degrees(r)); });

  for (const a of annotations) {
    const page = pages[a.page];
    if (!page) continue;
    const op = a.opacity ?? 1;
    const [cr, cg, cb] = hexToRgb(a.color || '#000000');
    const rect = bbox(a);
    const pad = 1;
    const R = [rect[0] - pad, rect[1] - pad, rect[2] + pad, rect[3] + pad];
    const dict = {
      Type: 'Annot',
      Rect: R.map((v) => +f(v)),
      C: [cr, cg, cb].map((v) => +f(v)),
      CA: +f(op),
      F: 4,
      NM: PDFHexString.fromText(a.id),
      M: PDFString.fromDate(new Date(a.modified || Date.now())),
      P: page.ref
    };
    if (a.contents) dict.Contents = PDFHexString.fromText(a.contents);
    if (a.author) dict.T = PDFHexString.fromText(a.author);
    let ops = '';
    const res = { ExtGState: { GS0: { Type: 'ExtGState', CA: +f(op), ca: +f(op) } } };

    switch (a.type) {
      case 'highlight': case 'underline': case 'strikeout': case 'squiggly': {
        dict.Subtype = { highlight: 'Highlight', underline: 'Underline', strikeout: 'StrikeOut', squiggly: 'Squiggly' }[a.type];
        const q = [];
        for (const r of a.rects) {
          const c = orientedCorners(r, a.upright || [0, 1]);
          q.push(...c.ul, ...c.ur, ...c.ll, ...c.lr);
        }
        dict.QuadPoints = q.map((v) => +f(v));
        if (a.text) dict.FernaText = PDFHexString.fromText(a.text);
        if (a.area) dict.FernaType = 'area';
        if (a.type === 'highlight') {
          res.ExtGState.GS0.BM = 'Multiply';
          ops = `/GS0 gs\n${rgbOps(a.color)}\n`;
          for (const r of a.rects) { const [x1, y1, x2, y2] = normRect(r); ops += `${f(x1)} ${f(y1)} ${f(x2 - x1)} ${f(y2 - y1)} re f\n`; }
        } else {
          ops = `/GS0 gs\n${rgbOps(a.color, true)}\n0 J 1 j\n`;
          for (const s of markupStrokes(a)) {
            ops += `${f(s.width)} w\n`;
            if (s.kind === 'line') ops += `${f(s.pts[0][0])} ${f(s.pts[0][1])} m ${f(s.pts[1][0])} ${f(s.pts[1][1])} l S\n`;
            else { ops += `${f(s.pts[0])} ${f(s.pts[1])} m\n`; for (let i = 2; i < s.pts.length; i += 2) ops += `${f(s.pts[i])} ${f(s.pts[i + 1])} l\n`; ops += 'S\n'; }
          }
        }
        break;
      }
      case 'ink': case 'marker': {
        dict.Subtype = 'Ink';
        dict.InkList = a.paths.map((p) => p.map((v) => +f(v)));
        dict.BS = { Type: 'Border', W: +f(a.width || 1), S: 'S' };
        if (a.type === 'marker') { dict.FernaType = 'marker'; res.ExtGState.GS0.BM = 'Multiply'; }
        ops = `/GS0 gs\n${rgbOps(a.color, true)}\n${f(a.width || 1)} w\n${a.type === 'marker' ? '0 J' : '1 J'} 1 j\n`;
        for (const p of a.paths) ops += inkPathOps(p) + 'S\n';
        break;
      }
      case 'rect': case 'ellipse': {
        dict.Subtype = a.type === 'rect' ? 'Square' : 'Circle';
        const w = a.width || 1;
        dict.BS = { Type: 'Border', W: +f(w), S: 'S' };
        const [x1, y1, x2, y2] = normRect(a.rect);
        dict.Rect = [x1, y1, x2, y2].map((v) => +f(v));
        if (a.fill) { dict.IC = [cr, cg, cb].map((v) => +f(v)); res.ExtGState.GS0.ca = +f(op * 0.35); }
        const ix1 = x1 + w / 2, iy1 = y1 + w / 2, ix2 = x2 - w / 2, iy2 = y2 - w / 2;
        ops = `/GS0 gs\n${rgbOps(a.color, true)}\n${a.fill ? rgbOps(a.color) + '\n' : ''}${f(w)} w\n`;
        ops += a.type === 'rect' ? `${f(ix1)} ${f(iy1)} ${f(ix2 - ix1)} ${f(iy2 - iy1)} re\n` : ellipseOps(ix1, iy1, ix2, iy2);
        ops += a.fill ? 'B\n' : 'S\n';
        break;
      }
      case 'line': case 'arrow': {
        dict.Subtype = 'Line';
        dict.L = a.line.map((v) => +f(v));
        dict.BS = { Type: 'Border', W: +f(a.width || 1), S: 'S' };
        if (a.type === 'arrow') dict.LE = ['None', 'OpenArrow'];
        const [x1, y1, x2, y2] = a.line;
        ops = `/GS0 gs\n${rgbOps(a.color, true)}\n${f(a.width || 1)} w 1 J 1 j\n${f(x1)} ${f(y1)} m ${f(x2)} ${f(y2)} l S\n`;
        if (a.type === 'arrow') {
          const h = arrowHead(a);
          ops += `${f(h[0][0])} ${f(h[0][1])} m ${f(h[1][0])} ${f(h[1][1])} l ${f(h[2][0])} ${f(h[2][1])} l S\n`;
        }
        break;
      }
      case 'freetext': {
        dict.Subtype = 'FreeText';
        helv ||= doc.embedStandardFont(StandardFonts.Helvetica);
        const fs = a.fontSize || 12;
        const [x1, y1, x2, y2] = normRect(a.rect);
        dict.Rect = [x1, y1, x2, y2].map((v) => +f(v));
        dict.Contents = PDFHexString.fromText(a.text || '');
        dict.DA = PDFString.of(`/Helv ${f(fs)} Tf ${rgbOps(a.color)}`);
        dict.BS = { Type: 'Border', W: 0 };
        delete dict.C;
        const up = a.upright || [0, 1];
        if (up[0] !== 0 || up[1] !== 1) dict.FernaUp = up;
        const c = orientedCorners([x1, y1, x2, y2], up);
        const lines = wrapLines(helv, a.text || '', fs, c.along + 0.5);
        res.Font = { Helv: helv.ref };
        ops = `/GS0 gs\nq\n${f(c.rt[0])} ${f(c.rt[1])} ${f(up[0])} ${f(up[1])} ${f(c.ul[0])} ${f(c.ul[1])} cm\nBT\n/Helv ${f(fs)} Tf\n${rgbOps(a.color)}\n`;
        lines.forEach((ln, i) => {
          const y = -(0.1 * fs + 0.77 * fs) - i * 1.2 * fs;
          ops += `1 0 0 1 0 ${f(y)} Tm\n${helv.encodeText(sanitize(helv, ln)).toString()} Tj\n`;
        });
        ops += 'ET\nQ\n';
        break;
      }
      case 'note': {
        dict.Subtype = 'Text';
        dict.Name = 'Comment';
        dict.Open = false;
        const [x1, y1] = normRect(a.rect);
        const s = 20;
        dict.Rect = [x1, y1, x1 + s, y1 + s].map((v) => +f(v));
        ops = `${rgbOps(a.color)}\n0.25 0.25 0.25 RG 1 w\n${f(x1 + 1)} ${f(y1 + 1)} ${s - 2} ${s - 2} re B\n` +
          `${f(x1 + 5)} ${f(y1 + 13)} m ${f(x1 + 15)} ${f(y1 + 13)} l S\n${f(x1 + 5)} ${f(y1 + 9)} m ${f(x1 + 12)} ${f(y1 + 9)} l S\n`;
        delete dict.CA;
        break;
      }
      default: continue;
    }
    const apDict = { Type: 'XObject', Subtype: 'Form', BBox: dict.Rect, Resources: res };
    const ap = ctx.flateStream(ops, apDict);
    dict.AP = { N: ctx.register(ap) };
    const ref = ctx.register(ctx.obj(dict));
    page.node.addAnnot(ref);
  }
  if (outline) writeOutline(doc, pages, outline);
  if (encryption) {
    // A random owner password keeps the author's restrictions in force; otherwise the open password is also the owner password.
    const owner = encryption.ownerPassword || (encryption.permissions || encryption.ownerOnly ? randomPassword() : encryption.userPassword);
    doc.encrypt({
      userPassword: encryption.ownerOnly ? '' : encryption.userPassword,
      ownerPassword: owner,
      permissions: encryption.permissions || ALL_PERMISSIONS,
      algorithm: encryption.algorithm || 'AES-256'
    });
  }
  return doc.save({ useObjectStreams: false });
}

// Replace the document outline (bookmarks) with a flat list [{title, page, y, level}].
function writeOutline(doc, pages, list) {
  const { PDFName, PDFHexString, PDFNumber } = L();
  const ctx = doc.context;
  const catalog = doc.catalog;
  if (!list.length) { catalog.delete(PDFName.of('Outlines')); return; }
  const root = { ref: ctx.nextRef(), children: [], parent: null };
  const stack = [{ level: 0, node: root }];
  for (const c of list) {
    if (!pages[c.page]) continue;
    while (stack.length > 1 && stack[stack.length - 1].level >= c.level) stack.pop();
    const node = { ref: ctx.nextRef(), children: [], parent: stack[stack.length - 1].node, c };
    node.parent.children.push(node);
    stack.push({ level: c.level, node });
  }
  const build = (n, depth = 1) => {
    n.children.forEach((ch, i) => {
      const page = pages[ch.c.page];
      const top = ch.c.y != null ? ch.c.y + 4 : page.getHeight();
      const dict = {
        Title: PDFHexString.fromText(ch.c.title),
        Parent: n.ref,
        Dest: [page.ref, 'XYZ', null, +top.toFixed(2), null]
      };
      if (i > 0) dict.Prev = n.children[i - 1].ref;
      if (i < n.children.length - 1) dict.Next = n.children[i + 1].ref;
      if (ch.children.length) {
        dict.First = ch.children[0].ref;
        dict.Last = ch.children[ch.children.length - 1].ref;
        dict.Count = depth === 1 ? ch.children.length : -ch.children.length; // top level open, deeper levels closed
      }
      ctx.assign(ch.ref, ctx.obj(dict));
      build(ch, depth + 1);
    });
  };
  build(root);
  const rootDict = { Type: 'Outlines', Count: root.children.length + root.children.reduce((a, ch) => a + ch.children.length, 0) };
  if (root.children.length) { rootDict.First = root.children[0].ref; rootDict.Last = root.children[root.children.length - 1].ref; }
  ctx.assign(root.ref, ctx.obj(rootDict));
  catalog.set(PDFName.of('Outlines'), root.ref);
  catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
  void PDFNumber;
}

function randomPassword() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
