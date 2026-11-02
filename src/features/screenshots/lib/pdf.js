// Ferna Screenshots — minimal PDF writer: one JPEG image per page (DCTDecode), no dependencies.

const enc = new TextEncoder();

function pdfString(s) {
  s = String(s || '');
  if (/^[\x20-\x7e]*$/.test(s)) return '(' + s.replace(/[\\()]/g, (m) => '\\' + m) + ')';
  let hex = 'FEFF';
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    const units = cp > 0xffff ? [0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff)] : [cp];
    for (const u of units) hex += u.toString(16).padStart(4, '0').toUpperCase();
  }
  return '<' + hex + '>';
}

function pdfDate(ts) {
  const d = new Date(ts), p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset(), a = Math.abs(off);
  return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}` +
    `${off >= 0 ? '+' : '-'}${p(Math.floor(a / 60))}'${p(a % 60)}'`;
}

const num = (n) => (Math.round(n * 100) / 100).toString();

/**
 * pages: [{ jpeg: Uint8Array, imgW, imgH, pageW, pageH, drawW, drawH }]  (sizes of page in points)
 * info:  { title, subject, ts, link }  link = {url, x, y, w, h} on page 1 (points, top-left origin)
 */
export function buildPdf(pages, info = {}) {
  const chunks = [];
  let len = 0;
  const offsets = [];
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); len += b.length; };
  const obj = (n, body) => { offsets[n] = len; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };

  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // binary marker

  const n = pages.length;
  // object numbering: 1 catalog, 2 pages, 3 info, then page / content / image (/ link) per page
  const ids = []; let next = 4;
  pages.forEach((p, i) => {
    const hasLink = i === 0 && info.link && info.link.url;
    ids.push({ page: next++, cont: next++, img: next++, annot: hasLink ? next++ : 0 });
  });
  const pageObj = (i) => ids[i].page, contObj = (i) => ids[i].cont, imgObj = (i) => ids[i].img, annotObj = (i) => ids[i].annot;

  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] >>`));
  obj(3, () => push(`<< /Title ${pdfString(info.title)} /Subject ${pdfString(info.subject)} /Creator (Ferna Screenshots) ` +
    `/Producer (Ferna Screenshots) /CreationDate (${pdfDate(info.ts || Date.now())}) >>`));

  pages.forEach((p, i) => {
    const link = i === 0 && info.link && info.link.url ? info.link : null;
    obj(pageObj(i), () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(p.pageW)} ${num(p.pageH)}] ` +
      `/Resources << /XObject << /Im0 ${imgObj(i)} 0 R >> >> /Contents ${contObj(i)} 0 R` +
      (link ? ` /Annots [${annotObj(i)} 0 R]` : '') + ' >>'));
    const content = `q ${num(p.drawW)} 0 0 ${num(p.drawH)} 0 ${num(p.pageH - p.drawH)} cm /Im0 Do Q`;
    obj(contObj(i), () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    obj(imgObj(i), () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.imgW} /Height ${p.imgH} /ColorSpace /DeviceRGB ` +
        `/BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
      push(p.jpeg); push('\nendstream');
    });
    if (link) {
      const y1 = p.pageH - link.y, y0 = y1 - link.h;
      obj(annotObj(i), () => push(`<< /Type /Annot /Subtype /Link /Border [0 0 0] /Rect [${num(link.x)} ${num(y0)} ${num(link.x + link.w)} ${num(y1)}] ` +
        `/A << /S /URI /URI ${pdfString(encodeURI(decodeURISafe(link.url)))} >> >>`));
    }
  });

  const maxObj = next - 1;
  const xref = len;
  let x = `xref\n0 ${maxObj + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= maxObj; i++) {
    x += offsets[i] === undefined ? '0000000000 65535 f \n' : String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  push(x);
  push(`trailer\n<< /Size ${maxObj + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}

function decodeURISafe(u) { try { return decodeURI(u); } catch { return u; } }
