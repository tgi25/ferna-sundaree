// v1.5: Merge PDF files.
// The current document (with its annotations, rotations and bookmarks) and any number of PDFs from disk are
// joined in the order shown, optionally with page ranges. Each part gets a top-level bookmark; the parts' own
// bookmarks are kept underneath it. The result opens as a new, unsaved document.
import { getDocument } from '../../lib/pdfjs/pdf.min.mjs';
import { el, icon, toast } from './util.js';
import { importAnnotations, exportPdf } from './pdfio.js';

const LIB = new URL('../../lib/pdfjs/', import.meta.url).href;
const L = () => PDFLib;

// "1-3, 5, 8-" → zero-based indices (in the order written); empty → all pages
export function parseRange(text, n) {
  const t = (text || '').trim();
  if (!t || /^all$/i.test(t)) return [...Array(n).keys()];
  const out = [];
  for (const part of t.split(/[,;]\s*|\s+/).filter(Boolean)) {
    const m = part.match(/^(\d+)?\s*[-–]\s*(\d+)?$/);
    let a, b;
    if (m) { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : n; }
    else if (/^\d+$/.test(part)) { a = b = +part; }
    else throw new Error(`"${part}" is not a page or range`);
    if (a < 1 || b > n || a > b) throw new Error(`pages ${part} are outside 1–${n}`);
    for (let i = a; i <= b; i++) out.push(i - 1);
  }
  return out;
}

// Bookmarks of a PDF as a flat list [{title, page, y, level}]
async function outlineOf(bytes) {
  let pdf;
  try {
    pdf = await getDocument({ data: bytes.slice(), cMapUrl: LIB + 'cmaps/', cMapPacked: true, standardFontDataUrl: LIB + 'standard_fonts/', wasmUrl: LIB + 'wasm/', iccUrl: LIB + 'iccs/', isEvalSupported: false }).promise;
    const outline = await pdf.getOutline();
    const list = [];
    const walk = async (items, level) => {
      for (const it of items || []) {
        let page = null, y = null;
        try {
          const ex = typeof it.dest === 'string' ? await pdf.getDestination(it.dest) : it.dest;
          if (Array.isArray(ex)) {
            page = typeof ex[0] === 'object' && ex[0] ? await pdf.getPageIndex(ex[0]) : Number(ex[0]);
            const k = ex[1]?.name;
            y = k === 'XYZ' ? ex[3] : (k === 'FitH' || k === 'FitBH') ? ex[2] : k === 'FitR' ? ex[5] : null;
          }
        } catch { /* unresolved */ }
        if (page != null && (it.title || '').trim()) list.push({ title: it.title.trim(), page, y: y ?? null, level });
        await walk(it.items, level + 1);
      }
    };
    await walk(outline, 1);
    return list;
  } catch { return []; } finally { try { await pdf?.destroy(); } catch { /* ignore */ } }
}

// parts: [{ bytes (plain PDF, annotations included), name, pages: [indices], outline: [...] }]
export async function mergePdfs(parts, { bookmarkParts = true } = {}) {
  const { PDFDocument } = L();
  const out = await PDFDocument.create();
  const outline = [];
  for (const p of parts) {
    const src = await PDFDocument.load(p.bytes, { updateMetadata: false, ignoreEncryption: false });
    const first = out.getPageCount();
    const copied = await out.copyPages(src, p.pages);
    copied.forEach((pg) => out.addPage(pg));
    // keep the part's own bookmarks that point into the copied pages
    const where = new Map(p.pages.map((pi, k) => [pi, first + k]));
    const own = (p.outline || []).filter((c) => where.has(c.page)).map((c) => ({ ...c, page: where.get(c.page), level: c.level + (bookmarkParts ? 1 : 0) }));
    if (bookmarkParts) outline.push({ title: p.name.replace(/\.pdf$/i, ''), page: first, y: null, level: 1 });
    outline.push(...own);
  }
  out.setProducer('Ferna PDF Reader');
  const bytes = await out.save({ useObjectStreams: false });
  return outline.length ? exportPdf(bytes, [], [], { outline }) : bytes;
}

// ---------------------------------------------------------------------- dialog
// current: null or { name, pages, getBytes: () => Promise<Uint8Array>, outline: [...] }
export function openMergeDialog({ current, askPassword, onDone, setLoading }) {
  const items = [];
  if (current) items.push({ name: current.name, n: current.pages, range: '', current: true, getBytes: current.getBytes, outline: current.outline || [] });
  const back = el('div', { class: 'dialog-backdrop' });
  const box = el('div', { class: 'dialog bm-dialog merge-dialog', role: 'dialog' });
  const rows = el('div', { class: 'bm-rows merge-rows' });
  const total = el('span', { class: 'muted small' });
  const bmChk = el('input', { type: 'checkbox', checked: true });
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  const mergeBtn = el('button', { class: 'btn primary', text: 'Merge' });

  const draw = () => {
    rows.replaceChildren();
    let pages = 0, bad = false;
    items.forEach((it, i) => {
      const b = (ic, tip, fn, dis) => { const x = el('button', { class: 'tb small', title: tip, disabled: dis || null }); x.append(icon(ic)); x.onclick = fn; return x; };
      const range = el('input', { type: 'text', class: 'merge-range', value: it.range, placeholder: `all (${it.n})`, title: 'Pages to include, e.g. 1-3, 5, 8-' });
      const err = el('div', { class: 'merge-err' });
      const check = () => {
        try { it.sel = parseRange(range.value, it.n); err.textContent = ''; range.classList.remove('bad'); } catch (e) { it.sel = null; err.textContent = e.message; range.classList.add('bad'); }
      };
      range.addEventListener('input', () => { it.range = range.value; check(); summary(); });
      range.addEventListener('keydown', (e) => e.stopPropagation());
      check();
      rows.append(el('div', { class: 'merge-item' }, [
        el('div', { class: 'bm-row' }, [
          el('span', { class: 'merge-num', text: String(i + 1) }),
          el('span', { class: 'merge-name', text: it.name, title: it.name }),
          it.current ? el('span', { class: 'merge-tag', text: 'open now' }) : null,
          range,
          b('up', 'Move up', () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; draw(); }, i === 0),
          b('down', 'Move down', () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; draw(); }, i === items.length - 1),
          b('trash', 'Remove from the list', () => { items.splice(i, 1); draw(); })
        ]),
        err
      ]));
    });
    if (!items.length) rows.append(el('div', { class: 'empty', text: 'Add the PDF files you want to join, or drop them here.' }));
    function summary() {
      pages = 0; bad = false;
      for (const it of items) { if (it.sel) pages += it.sel.length; else bad = true; }
      total.textContent = items.length ? `${items.length} file${items.length === 1 ? '' : 's'} · ${pages} page${pages === 1 ? '' : 's'}` : '';
      mergeBtn.disabled = bad || items.length < 1 || pages < 1 || (items.length < 2 && !items[0]?.range);
    }
    summary();
  };

  const addFiles = async (files) => {
    for (const f of files) {
      if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { toast(`${f.name} is not a PDF`); continue; }
      try {
        setLoading?.(true, `Reading ${f.name}…`);
        const raw = new Uint8Array(await f.arrayBuffer());
        const imp = await importAnnotations(raw, (retry) => { setLoading?.(false); return askPassword(retry, f.name); });
        if (imp.cancelled) continue;
        if (imp.error && !imp.bytes) throw imp.error;
        // a plain, decrypted copy with the file's annotations put back
        const plain = imp.encryption || imp.stripped ? await exportPdf(imp.bytes, imp.annotations || [], [], {}) : imp.bytes;
        const doc = await L().PDFDocument.load(plain, { updateMetadata: false });
        items.push({ name: f.name, n: doc.getPageCount(), range: '', bytes: plain, outline: await outlineOf(plain) });
      } catch (e) {
        toast(`Could not read ${f.name}: ${e.message}`, 5000);
      } finally { setLoading?.(false); }
    }
    draw();
  };

  const picker = el('input', { type: 'file', accept: 'application/pdf,.pdf', multiple: true, style: 'display:none' });
  picker.addEventListener('change', () => { addFiles([...picker.files]); picker.value = ''; });
  const addBtn = el('button', { class: 'btn', onclick: () => picker.click() });
  addBtn.append(icon('plus'), el('span', { text: ' Add PDF files…' }));
  rows.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); rows.classList.add('drop'); });
  rows.addEventListener('dragleave', () => rows.classList.remove('drop'));
  rows.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); rows.classList.remove('drop'); addFiles([...e.dataTransfer.files]); });

  mergeBtn.onclick = async () => {
    try {
      mergeBtn.disabled = true;
      setLoading?.(true, 'Merging…');
      const parts = [];
      for (const it of items) {
        const bytes = it.current ? await it.getBytes() : it.bytes;
        parts.push({ bytes, name: it.name, pages: it.sel, outline: it.outline });
      }
      const merged = await mergePdfs(parts, { bookmarkParts: bmChk.checked && items.length > 1 });
      setLoading?.(false);
      close();
      const base = items[0].name.replace(/\.pdf$/i, '');
      await onDone(merged, items.length > 1 ? `${base} (merged).pdf` : `${base} (pages).pdf`);
    } catch (e) {
      setLoading?.(false);
      mergeBtn.disabled = false;
      toast('Merge failed: ' + e.message, 6000);
    }
  };

  box.append(
    el('h2', { text: 'Merge PDF files' }),
    el('p', { class: 'muted small', text: 'Files are joined from top to bottom. Leave Pages empty for the whole file, or type pages such as 1-3, 5, 8-. The open document keeps its annotations and bookmarks.' }),
    rows,
    el('div', { class: 'bm-foot' }, [addBtn, el('label', { class: 'small merge-opt' }, [bmChk, el('span', { text: ' Add a bookmark for each file' })]), total]),
    picker,
    el('div', { class: 'actions' }, [el('button', { class: 'btn', text: 'Cancel', onclick: close }), mergeBtn])
  );
  back.append(box);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  document.body.append(back);
  draw();
  if (!current) picker.click();
}
