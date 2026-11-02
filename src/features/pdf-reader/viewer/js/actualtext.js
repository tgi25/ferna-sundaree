// /ActualText support (v1.4).
//
// PDF writers such as LibreOffice and MS Word store complex-script clusters (Sinhala, Tamil, Devanagari …)
// as glyphs wrapped in  /Span <</ActualText (…)>> BDC … EMC  — the real Unicode text is only in the
// ActualText. pdf.js ignores it, so its text for such PDFs is garbled. This module scans a page's
// content streams (and the Form XObjects they draw) and lists every marked-content start in the same
// order as pdf.js reports them, with the ActualText when there is one.
/* global PDFLib */

export class ActualTextSource {
  constructor(getBytes) {
    this.getBytes = getBytes;
    this.doc = null;
    this._loading = null;
    this.cache = new Map();
  }

  reset() { this.doc = null; this._loading = null; this.cache.clear(); }

  async _doc() {
    if (this.doc) return this.doc;
    this._loading ||= (async () => {
      const bytes = this.getBytes();
      if (!bytes || typeof PDFLib === 'undefined') return null;
      return PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    })().catch(() => null);
    this.doc = await this._loading;
    return this.doc;
  }

  // → [{tag, actual}] in content order, or null
  async forPage(index) {
    if (this.cache.has(index)) return this.cache.get(index);
    let out = null;
    try {
      const doc = await this._doc();
      if (doc) {
        const L = PDFLib;
        const node = doc.getPage(index).node;
        const res = node.Resources();
        const contents = node.Contents();
        const streams = [];
        if (contents instanceof L.PDFArray) for (let i = 0; i < contents.size(); i++) streams.push(contents.lookup(i));
        else if (contents) streams.push(contents);
        const parts = streams.map((s) => decodeStream(s)).filter(Boolean);
        const total = new Uint8Array(parts.reduce((a, p) => a + p.length + 1, 0));
        let o = 0;
        for (const p of parts) { total.set(p, o); o += p.length; total[o++] = 10; }
        out = [];
        scan(total, res, doc, out, 0);
      }
    } catch (e) { console.warn('ActualText scan failed', e); out = null; }
    this.cache.set(index, out);
    return out;
  }
}

function decodeStream(s) {
  const L = PDFLib;
  try {
    if (s instanceof L.PDFRawStream) return L.decodePDFRawStream(s).decode();
    if (s?.getContents) return s.getContents();
  } catch { /* unsupported filter */ }
  return null;
}

// ---------------------------------------------------------------- content stream lexer
const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);

function scan(buf, res, doc, out, depth) {
  const stack = [];
  const n = buf.length;
  let i = 0;
  const L = PDFLib;
  const lookupRes = (cat, name) => {
    try {
      const d = res?.lookup(L.PDFName.of(cat));
      return d ? d.lookup(L.PDFName.of(name)) : null;
    } catch { return null; }
  };
  const readValue = () => {                 // returns a JS value, or {op} for operators
    while (i < n) {
      const c = buf[i];
      if (WS.has(c)) { i++; continue; }
      if (c === 37) { while (i < n && buf[i] !== 10 && buf[i] !== 13) i++; continue; }  // % comment
      break;
    }
    if (i >= n) return undefined;
    const c = buf[i];
    if (c === 40) return { str: readLiteral() };
    if (c === 60) {
      if (buf[i + 1] === 60) {                // << dict >>
        i += 2;
        const d = {};
        for (;;) {
          while (i < n && WS.has(buf[i])) i++;
          if (buf[i] === 62 && buf[i + 1] === 62) { i += 2; return { dict: d }; }
          const k = readValue();
          if (k === undefined) return { dict: d };
          if (!k || k.name === undefined) continue;
          d[k.name] = readValue();
        }
      }
      i++;
      let hex = '';
      while (i < n && buf[i] !== 62) { const ch = buf[i++]; if (!WS.has(ch)) hex += String.fromCharCode(ch); }
      i++;
      if (hex.length % 2) hex += '0';
      const b = new Uint8Array(hex.length / 2);
      for (let k = 0; k < b.length; k++) b[k] = parseInt(hex.substr(k * 2, 2), 16);
      return { str: b };
    }
    if (c === 91) {                            // [ array ]
      i++;
      const arr = [];
      for (;;) {
        while (i < n && WS.has(buf[i])) i++;
        if (buf[i] === 93 || i >= n) { i++; return { arr }; }
        const v = readValue();
        if (v === undefined) return { arr };
        arr.push(v);
      }
    }
    if (c === 47) {                            // /Name
      i++;
      let s = '';
      while (i < n && !WS.has(buf[i]) && !DELIM.has(buf[i])) {
        if (buf[i] === 35 && i + 2 < n) { s += String.fromCharCode(parseInt(String.fromCharCode(buf[i + 1], buf[i + 2]), 16)); i += 3; }
        else s += String.fromCharCode(buf[i++]);
      }
      return { name: s };
    }
    if (c === 41 || c === 62 || c === 93 || c === 123 || c === 125) { i++; return { op: String.fromCharCode(c) }; }
    let s = '';
    while (i < n && !WS.has(buf[i]) && !DELIM.has(buf[i])) s += String.fromCharCode(buf[i++]);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return { num: Number(s) };
    return { op: s };
  };
  const readLiteral = () => {
    i++;
    const bytes = [];
    let depthP = 1;
    while (i < n) {
      let c = buf[i++];
      if (c === 92) {                          // backslash escape
        const e = buf[i++];
        if (e === 110) bytes.push(10); else if (e === 114) bytes.push(13); else if (e === 116) bytes.push(9);
        else if (e === 98) bytes.push(8); else if (e === 102) bytes.push(12);
        else if (e === 13) { if (buf[i] === 10) i++; }
        else if (e === 10) { /* line continuation */ }
        else if (e >= 48 && e <= 55) {
          let v = e - 48;
          for (let k = 0; k < 2 && buf[i] >= 48 && buf[i] <= 55; k++) v = v * 8 + (buf[i++] - 48);
          bytes.push(v & 255);
        } else bytes.push(e);
        continue;
      }
      if (c === 40) depthP++;
      else if (c === 41 && --depthP === 0) break;
      bytes.push(c);
    }
    return Uint8Array.from(bytes);
  };

  for (;;) {
    const v = readValue();
    if (v === undefined) break;
    if (v.op === undefined) { stack.push(v); if (stack.length > 64) stack.shift(); continue; }
    const op = v.op;
    if (op === 'BI') {                          // inline image: skip to EI
      while (i < n) {
        if (buf[i] === 73 && buf[i + 1] === 68 && WS.has(buf[i + 2]) && (i === 0 || WS.has(buf[i - 1]))) { i += 3; break; }
        i++;
      }
      while (i < n) {
        if (buf[i] === 69 && buf[i + 1] === 73 && WS.has(buf[i - 1]) && (i + 2 >= n || WS.has(buf[i + 2]))) { i += 2; break; }
        i++;
      }
    } else if (op === 'BMC') {
      out.push({ tag: stack[stack.length - 1]?.name ?? null, actual: null });
    } else if (op === 'BDC') {
      const props = stack[stack.length - 1], tag = stack[stack.length - 2]?.name ?? null;
      let actual = null;
      if (props?.dict) actual = props.dict.ActualText?.str ? decodePdfString(props.dict.ActualText.str) : null;
      else if (props?.name) {
        const pd = lookupRes('Properties', props.name);
        const at = pd?.lookup?.(L.PDFName.of('ActualText'));
        if (at?.decodeText) actual = at.decodeText();
      }
      out.push({ tag, actual });
    } else if (op === 'Do' && depth < 6) {
      const name = stack[stack.length - 1]?.name;
      const xo = name && lookupRes('XObject', name);
      try {
        if (xo && xo.dict?.lookup(L.PDFName.of('Subtype'))?.asString?.() === '/Form') {
          const sub = decodeStream(xo);
          const fres = xo.dict.lookup(L.PDFName.of('Resources')) || res;
          if (sub) scan(sub, fres, doc, out, depth + 1);
        }
      } catch { /* ignore broken form */ }
    }
    stack.length = 0;
  }
}

function decodePdfString(b) {
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    let s = '';
    for (let k = 2; k + 1 < b.length; k += 2) s += String.fromCharCode((b[k] << 8) | b[k + 1]);
    return s;
  }
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder().decode(b.subarray(3));
  let s = '';
  for (const c of b) s += String.fromCharCode(c);
  return s;
}
