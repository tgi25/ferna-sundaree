// Ferna PDF Reader — application wiring.
import { getDocument, GlobalWorkerOptions } from '../../lib/pdfjs/pdf.min.mjs';
import { $, $$, el, icon, toast, debounce, fileNameFromUrl, clamp } from './util.js';
import { Viewer, ZOOM_STEPS } from './viewer.js';
import { AnnotationStore } from './store.js';
import { Tools, PALETTE, DEFAULT_PROPS } from './tools.js';
import { renderPageAnnotations, renderSelection } from './annots.js';
import { fetchPdf, importAnnotations, exportPdf } from './pdfio.js';
import { Search } from './search.js';
import { Sidebar } from './sidebar.js';
import { showMenu, hidePopover, popoverKind, showPopover, swatchBtn, showDialog } from './ui.js';
import { loadSettings, saveSettings, loadViewState, saveViewState } from './settings.js';
import { ensureWritable } from './handles.js';
import { helperAvailable, writeWithHelper, fileUrlToPath, saveToDownloads, canDownloadSilently, helperPick, readWithHelper, pathToFileUrl } from './saver.js';
import { IS_FIREFOX, BROWSER_NAME, FROM_STORE, HELPER_URL } from './platform.js';
import { DocText } from './doctext.js';
import { TextSelection } from './textsel.js';
import { ActualTextSource } from './actualtext.js';
import { RefPopup } from './refpopup.js';
import { AIEngine } from './ai/engine.js';
import { AIFeatures } from './ai/features.js';
import { AIPanel } from './ai/panel.js';
import { detectHeadings, refineWithAI, bookmarkEditor, toTree } from './bookmarks.js';
import { openMergeDialog } from './merge.js';

const LIB = new URL('../../lib/pdfjs/', import.meta.url).href;
GlobalWorkerOptions.workerSrc = LIB + 'pdf.worker.min.mjs';

const TOOL_NAMES = {
  select: 'Select', hand: 'Hand', highlight: 'Highlight', underline: 'Underline', strikeout: 'Strike-out', squiggly: 'Squiggly',
  pen: 'Pen', marker: 'Marker', areahl: 'Area highlight', eraser: 'Eraser', freetext: 'Text box', note: 'Sticky note',
  rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', arrow: 'Arrow'
};
const TOOL_ICONS = {
  select: 'cursor', hand: 'hand', highlight: 'highlight', underline: 'underline', strikeout: 'strike', squiggly: 'squiggly',
  pen: 'pen', marker: 'marker', areahl: 'areahl', eraser: 'eraser', freetext: 'text', note: 'note', rect: 'rect', ellipse: 'ellipse', line: 'line', arrow: 'arrow'
};

const state = {
  settings: null,
  doc: null,            // pdf.js document
  baseBytes: null,      // bytes shown by pdf.js (imported annotations stripped)
  originalBytes: null,
  encrypted: false,     // true when the file could not be decrypted for editing (read-only)
  encryption: null,     // password protection applied when saving: {userPassword, algorithm, ownerOnly, permissions}
  fileName: 'document.pdf',
  fileUrl: null,
  fileHandle: null,
  viewKey: null
};

const container = $('#viewerContainer');
const viewer = new Viewer(container, $("#viewer"));
window.__fernaViewer = viewer; // read by the browser's tests (pre-render status)
const store = new AnnotationStore();
viewer.history = store;
let tools, search, sidebar, doctext, refPopup, engine, aiPanel;

// ============================================================ boot
(async function boot() {
  state.settings = await loadSettings();
  viewer.settings = state.settings;
  document.body.classList.toggle('native-sel', !state.settings.smoothSelect);
  if (state.settings.toolProps) {
    try { for (const [k, v] of Object.entries(state.settings.toolProps)) if (DEFAULT_PROPS[k]) state.settings.toolProps[k] = { ...DEFAULT_PROPS[k], ...v }; } catch { /* ignore */ }
  }
  tools = new Tools({ viewer, store, settings: state.settings });
  tools.textSel = new TextSelection(viewer, state.settings);
  viewer.actualText = new ActualTextSource(() => state.baseBytes);
  if (state.settings.toolProps) tools.props = { ...tools.props, ...state.settings.toolProps };
  search = new Search(viewer);
  sidebar = new Sidebar({ viewer, store, tools });
  // v1.3: text model, reference popups, AI
  doctext = new DocText(viewer);
  refPopup = new RefPopup({ viewer, doctext, settings: state.settings, saveSettings });
  viewer.onInternalLink = (dest, e, link, pv) => (state.settings.refPopups ? refPopup.showForDest(dest, e, link, pv) : viewer.goToDest(dest, { remember: true }));
  tools.onTextClick = (target, x, y) => refPopup.tryText(target, x, y);
  engine = new AIEngine(state.settings);
  const features = new AIFeatures({ engine, doctext, viewer, getTitle: docTitle, settings: state.settings });
  aiPanel = new AIPanel({ engine, features, viewer, settings: state.settings, saveSettings, download: downloadBytes, getTitle: docTitle });
  tools.onAskAI = (text) => aiPanel.askAboutSelection(text);
  sidebar.onAutoBookmark = () => autoBookmark();
  sidebar.onAddBookmark = () => addBookmark();
  sidebar.onEditBookmarks = () => editBookmarks();
  sidebar.onBookmarkEdit = (ev) => bookmarkEdit(ev);
  viewer.on('history', (n) => { $('#backChip').hidden = !n; });
  $('#backChip').onclick = () => viewer.goBack();
  wireViewer();
  wireToolbar();
  wirePalette();
  wireFind();
  wireKeys();
  wireDrop();
  wirePinch();
  updateStylusBtn();
  setHLock(state.settings.hLock, false);
  updateLockUI();

  // handle for debugging from the DevTools console
  window.fernaPdf = { viewer, store, tools, search, sidebar, state, save, buildPdf, openBytes, openFileObject, setPassword, doctext, refPopup, engine, aiPanel, autoBookmark };

  const fileParam = getFileParam();
  if (window.top !== window) { showWelcome('For your safety, Ferna PDF Reader does not open documents inside other web pages.'); return; }
  if (fileParam) openUrl(fileParam);
  else showWelcome();
})();

function getFileParam() {
  const s = location.search;
  const i = s.indexOf('file=');
  if (i < 0) return null;
  let v = s.slice(i + 5);
  if (/^(https?|file|ftp)%3A/i.test(v)) { try { v = decodeURIComponent(v); } catch { /* ignore */ } }
  return v + (location.hash && !v.includes('#') ? location.hash : '');
}

function showWelcome(msg) {
  $('#welcome').hidden = false;
  const card = $('.welcome-card');
  card.querySelector('.err')?.remove();
  if (msg) card.insertBefore(el('p', { class: 'err', style: 'color:var(--danger);font-weight:600', text: msg }), card.querySelector('p'));
}

function setLoading(on, text = 'Loading…', p = null) {
  $('#loading').hidden = !on;
  $('#loadingText').textContent = text;
  $('#loadingBar').parentElement.hidden = p == null;
  if (p != null) $('#loadingBar').style.width = Math.round(p * 100) + '%';
}

// ============================================================ opening documents
async function openUrl(url) {
  state.fileUrl = url.split('#')[0];
  state.fileName = fileNameFromUrl(state.fileUrl);
  state.fileHandle = null;
  state.webCopy = false;
  state.localPath = /^file:/i.test(state.fileUrl) ? fileUrlToPath(state.fileUrl) : null;
  if (state.localPath) helperAvailable(true); // start the save helper early so Ctrl+S is instant
  state.viewKey = state.fileUrl;
  setLoading(true, 'Downloading…', 0);
  try {
    const bytes = await fetchPdf(state.fileUrl, (p) => setLoading(true, 'Downloading…', p));
    await openBytes(bytes, url);
  } catch (e) {
    console.error(e);
    setLoading(false);
    showWelcome('Could not open the PDF: ' + (e.message || e));
  }
}

async function openFileObject(file, handle = null) {
  state.fileUrl = null;
  state.fileName = file.name || 'document.pdf';
  state.fileHandle = handle;
  state.localPath = null;
  state.webCopy = false;
  state.viewKey = 'local:' + file.name + ':' + file.size;
  setLoading(true, 'Opening…');
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await openBytes(bytes);
    history.replaceState(null, '', location.pathname);
  } catch (e) {
    console.error(e);
    setLoading(false);
    showWelcome('Could not open the PDF: ' + (e.message || e));
  }
}

async function openBytes(bytes, urlWithHash = '') {
  if (store.dirty && !confirm('Discard unsaved annotations in the current document?')) { setLoading(false); return; }
  setLoading(true, 'Reading annotations…');
  state.originalBytes = bytes;
  const imp = await importAnnotations(bytes, (retry) => { setLoading(false); return askPassword(retry); });
  if (imp.cancelled) { setLoading(false); showWelcome('The document is password-protected.'); return; }
  state.encrypted = !!imp.encrypted && !imp.encryption;
  state.encryption = imp.encryption || null;
  state.baseBytes = imp.bytes;
  updateLockUI();
  setLoading(true, 'Rendering…');
  if (state.doc) { try { await state.doc.destroy(); } catch { /* ignore */ } }
  const task = getDocument({
    data: state.baseBytes.slice(),
    cMapUrl: LIB + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: LIB + 'standard_fonts/',
    wasmUrl: LIB + 'wasm/',
    iccUrl: LIB + 'iccs/',
    isEvalSupported: false,
    enableXfa: false
  });
  task.onPassword = (update, reason) => {
    setLoading(false);
    askPassword(reason === 2).then((pw) => {
      if (pw == null) { task.destroy(); showWelcome('The document is password-protected.'); return; }
      setLoading(true, 'Rendering…');
      update(pw);
    });
  };
  const pdf = await task.promise;
  state.doc = pdf;
  $('#welcome').hidden = true;
  tools.setTool('select');
  store.reset(imp.annotations);
  doctext.reset();
  viewer.actualText.reset();
  refPopup.close();
  state.outline = null;
  state.outlineList = null;
  viewer.backStack = [];
  $('#backChip').hidden = true;
  aiPanel.chat = [];
  search.reset();
  await viewer.setDocument(pdf);
  renderAllAnnotations();
  await sidebar.setDocument(pdf);
  loadOutlineList(pdf);
  suggestOcr(pdf);
  $('#pageCount').textContent = '/ ' + pdf.numPages;
  $('#docTitle').textContent = state.fileName;
  document.title = state.fileName + ' – Ferna PDF Reader';
  setLoading(false);
  updatePageUI();
  updateZoomUI();
  updateUndoUI();

  let meta = null;
  try { meta = await pdf.getMetadata(); } catch { /* ignore */ }
  const title = meta?.info?.Title;
  if (title && title.trim().length > 2 && !/^(untitled|microsoft word|document\d*)\b/i.test(title.trim())) document.title = title + ' – Ferna PDF Reader';

  // initial position: #page=N in the URL, otherwise the last position
  const hashPage = /[#&]page=(\d+)/.exec(urlWithHash || '')?.[1];
  const vs = state.settings.rememberPosition ? await loadViewState(state.viewKey) : null;
  const zoom = vs?.zoom ?? state.settings.defaultZoom;
  if (zoom !== viewer.zoomMode) viewer.setZoom(zoom, { keepAnchor: false });
  if (hashPage) viewer.goToPage(Number(hashPage));
  else if (vs?.page > 1 && vs.page <= pdf.numPages) {
    await viewer._sizesReady;
    viewer.goToPage(vs.page);
  }
  if (state.encrypted) toast('This PDF uses an encryption Ferna cannot rewrite: you can read and annotate it, but not save it.', 5000);
  else if (state.encryption && !state.encryption.ownerOnly) toast('Password-protected PDF — it stays protected with the same password when you save.', 4000);
  container.focus({ preventScroll: true });
}

// Firefox + save helper: the helper's own Open window gives the real path, so Save can overwrite the file.
async function openLocalPath(path) {
  if (store.dirty && !confirm('Discard unsaved annotations in the current document?')) return;
  state.fileUrl = pathToFileUrl(path);
  state.fileName = path.split(/[\\/]/).pop();
  state.fileHandle = null;
  state.webCopy = false;
  state.localPath = path;
  state.viewKey = state.fileUrl;
  setLoading(true, 'Opening…', 0);
  try {
    const bytes = await readWithHelper(path, (p) => setLoading(true, 'Opening…', p));
    store.markSaved?.();
    await openBytes(bytes);
    history.replaceState(null, '', location.pathname + '?file=' + encodeURIComponent(state.fileUrl));
  } catch (e) {
    console.error(e);
    setLoading(false);
    showWelcome('Could not open the PDF: ' + (e.message || e));
  }
}

async function pickFile() {
  if (!window.showOpenFilePicker && (await helperAvailable())) {
    try {
      const path = await helperPick('open');
      if (path) await openLocalPath(path);
    } catch (e) { toast('Could not open file: ' + e.message, 5000); }
    return;
  }
  if (window.showOpenFilePicker) {
    try {
      const [h] = await window.showOpenFilePicker({ types: [{ description: 'PDF documents', accept: { 'application/pdf': ['.pdf'] } }] });
      const file = await h.getFile();
      await openFileObject(file, h);
    } catch (e) { if (e.name !== 'AbortError') toast('Could not open file: ' + e.message); }
    return;
  }
  $('#fileInput').click();
}
$('#fileInput').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) openFileObject(f); e.target.value = ''; });

function wireDrop() {
  let depth = 0;
  container.addEventListener('dragenter', (e) => { if ([...e.dataTransfer.types].includes('Files')) { depth++; container.classList.add('drop-target'); e.preventDefault(); } });
  container.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  container.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; container.classList.remove('drop-target'); } });
  container.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    container.classList.remove('drop-target');
    const item = [...e.dataTransfer.items].find((i) => i.kind === 'file');
    if (!item) return;
    let handle = null;
    try { handle = item.getAsFileSystemHandle ? await item.getAsFileSystemHandle() : null; } catch { /* ignore */ }
    const file = handle?.getFile ? await handle.getFile() : item.getAsFile();
    if (!file || !/pdf$/i.test(file.type || file.name)) { toast('Please drop a PDF file.'); return; }
    openFileObject(file, handle?.kind === 'file' ? handle : null);
  });
}

// ============================================================ saving / printing
async function buildPdf({ encrypt = true } = {}) {
  const rotations = viewer.pages.map((pv) => (pv.userRot ? pv.rotation : null));
  return exportPdf(state.baseBytes, store.all(), rotations, { encryption: encrypt ? state.encryption : null, outline: state.outline });
}

async function writeHandle(handle, bytes) {
  if (!(await ensureWritable(handle))) throw Object.assign(new Error('Permission to write the file was denied.'), { name: 'NotAllowedError' });
  const w = await handle.createWritable();
  await w.write(bytes);
  await w.close();
}

const isLocalFileUrl = () => /^file:/i.test(state.fileUrl || '');
const baseName = (p) => p.split(/[\\/]/).pop();

// Shown when a local file can't be overwritten silently because the save helper isn't installed.
async function helperMissingDialog() {
  const body = el('div', {}, [
    el('p', { text: 'Browsers do not let an extension write to files on your disk by itself. To save straight over the original file, without any Save window, install the small Ferna save helper once:' }),
    el('ol', { style: 'margin:6px 0 10px 18px;padding:0;line-height:1.6' }, [
      el('li', { html: IS_FIREFOX ? `Download <b>Ferna-PDF-Save-Helper</b> from <a href="${HELPER_URL}" target="_blank" rel="noopener">the Ferna PDF Reader website</a> and unzip it to any folder.` : FROM_STORE ? `Download <b>Ferna-PDF-Save-Helper</b> from <a href="${HELPER_URL}" target="_blank" rel="noopener">the Ferna Software website</a> and unzip it to any folder.` : 'Open the extension folder, then the <b>save-helper</b> folder.' }),
      el('li', { html: 'Double-click <b>Install-Save-Helper.bat</b> (no administrator rights needed).' }),
      el('li', { text: 'Restart the browser. From then on Save (Ctrl+S) overwrites the file directly.' })
    ]),
    el('p', { class: 'muted small', text: 'For now you can use Save As to choose where to save.' })
  ]);
  const r = await showDialog('One-time setup for direct saving', body, [{ label: 'Close' }, { label: 'Save As…', primary: true, value: 'saveas' }]);
  return r === 'saveas';
}

// Save: overwrite the document's own file with no dialog. Save As: always choose a new file/location.
async function save(saveAs = false) {
  if (!state.doc) return;
  if (state.encrypted) { toast('This PDF’s encryption cannot be rewritten, so it cannot be saved.'); return; }

  // Save As → picker (needs a fresh user gesture, so it is opened before the PDF is built)
  let pickHandle = null;
  if (saveAs) {
    if (!window.showSaveFilePicker) { await saveAsWithoutPicker(); return; }
    try {
      pickHandle = await window.showSaveFilePicker({
        suggestedName: state.fileName, id: 'ferna-save-as',
        types: [{ description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } }]
      });
    } catch (e) { if (e.name !== 'AbortError') toast('Could not save: ' + e.message, 4000); return; }
  } else if (state.fileHandle) {
    // opened with the Open button / drag-and-drop: we already hold the file
    try { if (!(await ensureWritable(state.fileHandle))) { toast('Permission to write the file was denied.'); return; } } catch (e) { toast(e.message); return; }
  } else if (state.localPath && !(await helperAvailable())) {
    // local file but no helper: web copies in Downloads can still be overwritten through the downloads API
    if (!(state.webCopy && canDownloadSilently())) {
      if (await helperMissingDialog()) save(true);
      return;
    }
  }

  const bytes = await buildOrToast();
  if (!bytes) return;
  const prot = state.encryption && !state.encryption.ownerOnly ? ' (password-protected)' : '';
  try {
    if (pickHandle) {
      setLoading(true, 'Saving…');
      await writeHandle(pickHandle, bytes);
      state.fileHandle = pickHandle;
      state.localPath = null; state.webCopy = false;
      state.fileName = pickHandle.name;
      $('#docTitle').textContent = state.fileName;
      toast('Saved as ' + pickHandle.name + prot);
    } else if (state.fileHandle) {
      setLoading(true, 'Saving…');
      await writeHandle(state.fileHandle, bytes);
      toast('Saved — ' + state.fileName + prot);
    } else if (state.localPath && !state.webCopy && (await helperAvailable())) {
      setLoading(true, 'Saving…', 0);
      await writeWithHelper(state.localPath, bytes, (p) => setLoading(true, 'Saving…', p));
      toast('Saved — ' + state.localPath + prot, 3000);
    } else if (canDownloadSilently()) {
      // web PDF: first save creates a copy in Downloads, later saves overwrite that copy
      setLoading(true, 'Saving…');
      const rel = state.webCopy && state.localPath ? baseName(state.localPath) : state.fileName;
      const path = await saveToDownloads(bytes, rel, !!state.webCopy);
      const first = !state.webCopy;
      state.localPath = path; state.webCopy = true;
      state.fileName = baseName(path);
      $('#docTitle').textContent = state.fileName;
      toast((first ? 'Saved to ' : 'Saved — ') + path + prot, 3500);
    } else {
      downloadBytes(bytes, state.fileName);
    }
    store.markSaved();
  } catch (e) {
    console.error(e);
    toast('Could not save: ' + e.message, 6000);
  } finally {
    setLoading(false);
  }
}

// Save As where the browser has no File System Access API (Firefox):
// the save helper's Windows Save As window, else the browser's own download Save As window.
async function saveAsWithoutPicker() {
  const prot = state.encryption && !state.encryption.ownerOnly ? ' (password-protected)' : '';
  if (await helperAvailable()) {
    let path;
    try { path = await helperPick('save', state.fileName); } catch (e) { toast('Could not save: ' + e.message, 5000); return; }
    if (!path) return;
    const bytes = await buildOrToast();
    if (!bytes) return;
    try {
      setLoading(true, 'Saving…', 0);
      await writeWithHelper(path, bytes, (p) => setLoading(true, 'Saving…', p), { create: true });
      state.localPath = path; state.webCopy = false; state.fileHandle = null;
      state.fileName = baseName(path);
      $('#docTitle').textContent = state.fileName;
      store.markSaved();
      toast('Saved as ' + path + prot, 3500);
    } catch (e) { toast('Could not save: ' + e.message, 6000); } finally { setLoading(false); }
    return;
  }
  const bytes = await buildOrToast();
  if (!bytes) return;
  if (!canDownloadSilently()) { downloadBytes(bytes, state.fileName); store.markSaved(); return; }
  try {
    const path = await saveToDownloads(bytes, state.fileName, false, true);
    if (!path) return;
    // later Saves overwrite this file when it is in the Downloads folder (without the helper, the browser only writes there)
    state.localPath = path; state.webCopy = true; state.fileHandle = null;
    state.fileName = baseName(path);
    $('#docTitle').textContent = state.fileName;
    store.markSaved();
    toast('Saved as ' + path + prot, 3500);
  } catch (e) { toast('Could not save: ' + e.message, 6000); }
}

async function buildOrToast() {
  try {
    setLoading(true, 'Saving…');
    return await buildPdf();
  } catch (e) {
    console.error(e);
    toast('Could not create the PDF: ' + e.message, 5000);
    return null;
  } finally { setLoading(false); }
}

function downloadBytes(bytes, name, type = 'application/pdf') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function printDoc() {
  if (!state.doc) return;
  let bytes;
  try { setLoading(true, 'Preparing to print…'); bytes = state.encrypted ? state.originalBytes : await buildPdf({ encrypt: false }); } catch (e) { toast('Could not prepare the document: ' + e.message); return; } finally { setLoading(false); }
  // Firefox shows PDFs in iframes with its own (cross-origin) viewer, which cannot be printed from here:
  // print rendered page images from a same-origin frame instead.
  if (IS_FIREFOX) { await printAsImages(bytes); return; }
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const frame = el('iframe', { style: 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0', src: url });
  document.body.append(frame);
  frame.addEventListener('load', () => {
    setTimeout(() => {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch { window.open(url, '_blank'); }
    }, 300);
  });
  setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 10 * 60 * 1000);
}

async function printAsImages(bytes) {
  const urls = [];
  let pdf;
  try {
    setLoading(true, 'Preparing to print…', 0);
    pdf = await getDocument({ data: bytes.slice(), cMapUrl: LIB + 'cmaps/', cMapPacked: true, standardFontDataUrl: LIB + 'standard_fonts/', wasmUrl: LIB + 'wasm/', iccUrl: LIB + 'iccs/', isEvalSupported: false }).promise;
    const sizes = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const vp1 = page.getViewport({ scale: 1 });
      const scale = Math.min(2, 4000 / Math.max(vp1.width, vp1.height));   // about 144 dpi
      const vp = page.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      await page.render({ canvasContext: c.getContext('2d'), canvas: c, viewport: vp, intent: 'print', background: '#ffffff' }).promise;
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
      urls.push(URL.createObjectURL(blob));
      sizes.push([vp1.width, vp1.height]);
      c.width = c.height = 0;
      page.cleanup();
      setLoading(true, 'Preparing to print…', i / pdf.numPages);
    }
    const frame = el('iframe', { style: 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0' });
    document.body.append(frame);
    const d = frame.contentDocument;
    const st = d.createElement('style');
    st.textContent = '@page{margin:0}html,body{margin:0;padding:0}div{break-after:page;display:flex;align-items:center;justify-content:center;width:100vw;height:100vh;overflow:hidden}div:last-child{break-after:auto}img{max-width:100%;max-height:100%}';
    d.head.append(st);
    for (const u of urls) { const box = d.createElement('div'); const im = d.createElement('img'); im.src = u; box.append(im); d.body.append(box); }
    await Promise.all([...d.images].map((im) => im.decode().catch(() => {})));
    setLoading(false);
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => { frame.remove(); urls.forEach((u) => URL.revokeObjectURL(u)); }, 10 * 60 * 1000);
  } catch (e) {
    console.error(e);
    toast('Could not prepare the document for printing: ' + e.message, 5000);
    urls.forEach((u) => URL.revokeObjectURL(u));
  } finally {
    setLoading(false);
    pdf?.destroy();
  }
}

window.addEventListener('beforeunload', (e) => {
  if (store.dirty) { e.preventDefault(); e.returnValue = ''; }
});

// ============================================================ viewer ↔ annotations
function renderAnnots(i) {
  const pv = viewer.pages[i];
  if (pv) renderPageAnnotations(pv, store.forPage(i), tools.selectedId, tools.editingId);
}
function renderAllAnnotations() { viewer.pages.forEach((_, i) => renderAnnots(i)); }

function wireViewer() {
  store.on('change', ({ pages }) => { pages.forEach(renderAnnots); updateUndoUI(); });
  store.on('reset', () => { renderAllAnnotations(); updateUndoUI(); });
  store.on('dirty', (d) => $('#btnSave').classList.toggle('dirty', d));
  viewer.on('annotations-dirty', (i) => renderAnnots(i));
  let lastSel = null;
  const onSelect = (id) => {
    for (const aid of [lastSel, id]) {
      const a = aid && store.get(aid);
      if (a) renderSelection(viewer.pages[a.page], id === aid ? a : null);
    }
    if (lastSel && !store.get(lastSel)) viewer.pages.forEach((pv) => renderSelection(pv, null));
    lastSel = id;
  };
  tools.on('select', onSelect);
  tools.on('requesttool', (t) => setTool(t));
  tools.on('propchange', debounce(() => { state.settings.toolProps = tools.props; saveSettings(state.settings, ['toolProps']); }, 500));

  viewer.on('pagechange', () => { updatePageUI(); persistView(); });
  viewer.on('zoom', () => { updateZoomUI(); persistView(); });
  viewer.on('layout', updateZoomUI);
  viewer.on('pagemenu', ({ index, x, y }) => pageMenu(index, { x, y }));
  viewer.on('rotate', () => { if (sidebar.isOpen) { /* thumbs updated by sidebar */ } });

  container.addEventListener('contextmenu', (e) => {
    const pv = viewer.pageFromEvent(e);
    if (!pv) return;
    if (window.getSelection()?.toString()) return; // keep the native menu for copying text
    e.preventDefault();
    pageMenu(pv.index, { x: e.clientX, y: e.clientY }, pv.clientToPdf(e.clientX, e.clientY));
  });

  container.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey) || !state.doc) return;
    e.preventDefault();
    const r = container.getBoundingClientRect();
    const atX = e.clientX - r.left, atY = e.clientY - r.top;
    // smooth zoom for touchpads (small deltas), stepwise for mouse wheels
    if (Math.abs(e.deltaY) < 40 && !Number.isInteger(e.deltaY)) {
      viewer.zoomTo(clamp(viewer.currentZoom * Math.exp(-e.deltaY * 0.01), 0.1, 10), atX, atY);
    } else viewer.zoomBy(e.deltaY < 0 ? 1 : -1, atX, atY);
  }, { passive: false });
}

const persistView = debounce(() => {
  if (!state.viewKey || !state.settings.rememberPosition) return;
  saveViewState(state.viewKey, { page: viewer.current + 1, zoom: viewer.zoomMode });
}, 800);

function pageMenu(index, at, pdfPoint = null) {
  hidePopover();
  const items = [
    { title: `Page ${index + 1}` },
    { icon: 'rotr', label: 'Rotate page right', kb: 'R', action: () => viewer.rotatePage(index, 90) },
    { icon: 'rotl', label: 'Rotate page left', kb: 'Shift+R', action: () => viewer.rotatePage(index, -90) },
    { icon: 'rotr', label: 'Rotate page 180°', action: () => viewer.rotatePage(index, 180) }
  ];
  const pv = viewer.pages[index];
  if (pv.userRot) items.push({ icon: 'undo', label: 'Reset page rotation', action: () => viewer.rotatePage(index, -pv.userRot) });
  items.push('-',
    { icon: 'rotr', label: 'Rotate all pages right', action: () => viewer.rotateAll(90) },
    { icon: 'rotl', label: 'Rotate all pages left', action: () => viewer.rotateAll(-90) },
    '-',
    { icon: 'fitw', label: 'Fit width', kb: 'W', action: () => viewer.setZoom('width') },
    { icon: 'fitp', label: 'Fit page', kb: 'P', action: () => viewer.setZoom('page') });
  if (pdfPoint) {
    items.push('-', { icon: 'note', label: 'Add sticky note here', action: () => addNoteAt(index, pdfPoint) });
  }
  showMenu(items, at, { kind: 'menu' });
}

function addNoteAt(page, [X, Y]) {
  const p = tools.propsFor('note');
  const a = { id: 'n' + Date.now().toString(36), page, type: 'note', color: p.color, rect: [X - 10, Y - 10, X + 10, Y + 10], contents: '', author: tools.author };
  store.add(a);
  tools._editComment(a, true);
}

// ============================================================ toolbar
function updatePageUI() {
  if (document.activeElement !== $('#pageInput')) $('#pageInput').value = viewer.current + 1;
  $('#btnPrev').disabled = viewer.current <= 0;
  $('#btnNext').disabled = viewer.current >= viewer.pages.length - 1;
}

function updateZoomUI() {
  const m = viewer.zoomMode;
  const pct = Math.round(viewer.currentZoom * 100) + '%';
  if (document.activeElement !== $('#zoomInput')) $('#zoomInput').value = m === 'width' ? 'Fit width' : m === 'page' ? 'Fit page' : pct;
  $('#zoomInput').title = `Current page at ${pct} — type a percentage and press Enter`;
  $('#btnFitWidth').classList.toggle('on', m === 'width');
  $('#btnFitPage').classList.toggle('on', m === 'page');
}

function updateUndoUI() {
  $('#btnUndo').disabled = !store.canUndo();
  $('#btnRedo').disabled = !store.canRedo();
}

function updateStylusBtn() {
  $('#btnStylus').classList.toggle('on', !!state.settings.stylusDraws);
  $('#btnStylus').title = state.settings.stylusDraws
    ? 'Stylus always draws (Xodo mode) — ON. Click to turn off.'
    : 'Stylus always draws (Xodo mode) — OFF. Click to turn on.';
}

// ---------------------------------------------------------------- horizontal lock
function setHLock(on, persist = true) {
  state.settings.hLock = !!on;
  container.classList.toggle('hlock', !!on);
  $('#btnHLock').classList.toggle('on', !!on);
  $('#btnHLock').title = on ? 'Horizontal lock ON — pages cannot move sideways (L). Click to unlock.' : 'Lock horizontal movement when zoomed in (L)';
  if (persist) saveSettings(state.settings, ['hLock']);
}

// ---------------------------------------------------------------- passwords
function askPassword(retry) {
  const input = el('input', { type: 'password', style: 'width:100%;margin-top:6px', autocomplete: 'off' });
  const body = el('div', {}, [
    el('p', { text: retry ? 'Incorrect password. Please try again.' : 'This PDF is protected. Enter its password to open it.', style: retry ? 'color:var(--danger)' : '' }),
    input
  ]);
  setTimeout(() => input.focus(), 30);
  const p = showDialog('Password required', body, [{ label: 'Cancel' }, { label: 'Open', primary: true, value: 'ok' }]);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); body.closest('.dialog').querySelector('.btn.primary').click(); } e.stopPropagation(); });
  return p.then((r) => (r === 'ok' ? input.value : null));
}

function updateLockUI() {
  const b = $('#btnPassword');
  if (!b) return;
  const on = !!(state.encryption && !state.encryption.ownerOnly);
  b.querySelector('use').setAttribute('href', on ? '#i-lock' : '#i-unlock');
  b.classList.toggle('on', on);
  b.title = on ? `Password-protected (${state.encryption.algorithm || 'AES-256'}) — change or remove the password` : 'Add a password to this PDF';
}

// Apply a new password (or null to remove it), then save over the file.
async function setPassword(pw, algorithm = 'AES-256') {
  const perms = state.encryption?.permissions; // restrictions set by the document's author are kept
  if (pw == null) state.encryption = perms ? { ownerOnly: true, permissions: perms, algorithm: state.encryption.algorithm } : null;
  else state.encryption = { userPassword: pw, algorithm, permissions: perms };
  store.touch();
  updateLockUI();
}

async function passwordDialog() {
  if (!state.doc) return;
  if (state.encrypted) { toast('This PDF\u2019s encryption cannot be rewritten by Ferna.'); return; }
  const protectedNow = !!(state.encryption && !state.encryption.ownerOnly);
  if (protectedNow) {
    const r = await showDialog('Password protection', el('div', {}, [
      el('p', { text: `This PDF is protected with a password (${state.encryption.algorithm || 'AES-256'} encryption).` }),
      el('p', { class: 'muted small', text: 'Removing the password lets anyone open the file. Changes are written to the file straight away.' })
    ]), [{ label: 'Cancel' }, { label: 'Remove password', value: 'remove' }, { label: 'Change password…', primary: true, value: 'change' }]);
    if (r === 'remove') { await setPassword(null); await save(false); return; }
    if (r !== 'change') return;
  }
  const p1 = el('input', { type: 'password', autocomplete: 'new-password', style: 'width:100%' });
  const p2 = el('input', { type: 'password', autocomplete: 'new-password', style: 'width:100%' });
  const show = el('input', { type: 'checkbox' });
  show.onchange = () => { p1.type = p2.type = show.checked ? 'text' : 'password'; };
  const alg = el('select', {}, [
    el('option', { value: 'AES-256', text: 'AES-256 (recommended — Acrobat X and all current readers)' }),
    el('option', { value: 'AES-128', text: 'AES-128 (compatible with older readers, Acrobat 7+)' })
  ]);
  const err = el('p', { style: 'color:var(--danger);min-height:1em;margin:6px 0 0', text: '' });
  const body = el('div', { style: 'display:flex;flex-direction:column;gap:8px' }, [
    el('label', {}, ['New password', p1]),
    el('label', {}, ['Confirm password', p2]),
    el('label', { class: 'chk' }, [show, ' Show password']),
    el('label', {}, ['Encryption ', alg]),
    el('p', { class: 'muted small', text: 'Keep the password safe: an encrypted PDF cannot be opened without it, and it cannot be recovered.' }),
    err
  ]);
  setTimeout(() => p1.focus(), 30);
  for (const i of [p1, p2]) i.addEventListener('keydown', (e) => e.stopPropagation());
  for (;;) {
    const r = await showDialog(protectedNow ? 'Change password' : 'Add a password', body, [{ label: 'Cancel' }, { label: 'Protect & save', primary: true, value: 'ok' }]);
    if (r !== 'ok') return;
    if (!p1.value) { err.textContent = 'Please enter a password.'; continue; }
    if (p1.value !== p2.value) { err.textContent = 'The passwords do not match.'; continue; }
    break;
  }
  await setPassword(p1.value, alg.value);
  await save(false);
}

function wireToolbar() {
  $('#btnSaveAs').onclick = () => save(true);
  $('#btnPassword').onclick = () => passwordDialog();
  $('#btnHLock').onclick = () => setHLock(!state.settings.hLock);
  $('#btnSidebar').onclick = () => sidebar.toggle();
  $('#btnOpen').onclick = pickFile;
  $('#welcomeOpen').onclick = pickFile;
  $('#btnSave').onclick = () => save(false);
  $('#btnPrev').onclick = () => viewer.scrollToPage(viewer.current - 1);
  $('#btnNext').onclick = () => viewer.scrollToPage(viewer.current + 1);
  $('#pageInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const n = parseInt(e.target.value, 10); if (n) viewer.goToPage(n); container.focus(); }
    e.stopPropagation();
  });
  $('#pageInput').addEventListener('focus', (e) => e.target.select());
  $('#pageInput').addEventListener('blur', updatePageUI);
  $('#btnZoomIn').onclick = () => viewer.zoomBy(1);
  $('#btnZoomOut').onclick = () => viewer.zoomBy(-1);
  $('#btnFitWidth').onclick = () => viewer.setZoom('width');
  $('#btnFitPage').onclick = () => viewer.setZoom('page');
  $('#zoomInput').addEventListener('focus', (e) => { e.target.value = Math.round(viewer.currentZoom * 100) + '%'; e.target.select(); });
  $('#zoomInput').addEventListener('blur', updateZoomUI);
  $('#zoomInput').addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key !== 'Enter') return;
    const v = e.target.value.trim().toLowerCase();
    if (v.startsWith('fit w') || v === 'width') viewer.setZoom('width');
    else if (v.startsWith('fit p') || v === 'page') viewer.setZoom('page');
    else { const n = parseFloat(v); if (n > 0) viewer.setZoom(n / 100); }
    container.focus();
  });
  $('#btnZoomMenu').onclick = (e) => {
    const r = $('.zoom-box').getBoundingClientRect();
    showMenu([
      { icon: 'fitw', label: 'Fit width (each page)', kb: 'W', action: () => viewer.setZoom('width') },
      { icon: 'fitp', label: 'Fit page', kb: 'P', action: () => viewer.setZoom('page') },
      { label: 'Actual size (100%)', kb: 'Ctrl+1', action: () => viewer.setZoom(1) },
      '-',
      ...[0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map((z) => ({ label: Math.round(z * 100) + '%', action: () => viewer.setZoom(z) }))
    ], new DOMRect(r.left, r.top, r.width, r.height), { kind: 'menu' });
    e.stopPropagation();
  };
  $('#btnRotL').onclick = () => viewer.rotatePage(viewer.current, -90);
  $('#btnRotR').onclick = () => viewer.rotatePage(viewer.current, 90);
  $('#btnUndo').onclick = () => undo();
  $('#btnRedo').onclick = () => redo();
  $('#btnSearch').onclick = () => openFind();
  $('#btnStylus').onclick = () => {
    state.settings.stylusDraws = !state.settings.stylusDraws;
    saveSettings(state.settings, ['stylusDraws']);
    updateStylusBtn();
    toast(state.settings.stylusDraws ? 'Stylus mode on — your pen writes without choosing a tool.' : 'Stylus mode off — the pen behaves like a mouse.');
  };
  $('#btnAnnotate').onclick = () => togglePalette();
  $('#btnAI').onclick = () => aiPanel.toggle();
  $('#btnAutoBookmark').onclick = () => autoBookmark();
  $('#btnMore').onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu([
      { icon: 'open', label: 'Open…', kb: 'Ctrl+O', action: pickFile },
      { icon: 'save', label: 'Save', kb: 'Ctrl+S', action: () => save(false) },
      { icon: 'save', label: 'Save as…', kb: 'Ctrl+Shift+S', action: () => save(true) },
      { icon: 'lock', label: 'Password…', action: passwordDialog },
      { icon: 'merge', label: 'Merge PDF files…', action: () => mergeDialog() },
      { icon: 'scan', label: 'Recognise text (OCR)…', action: () => ocrDialog() },
      { icon: 'plus', label: 'Add bookmark here (Ctrl+D)', action: () => addBookmark() },
      { icon: 'bmark', label: 'Auto-Bookmark…', action: () => autoBookmark() },
      { icon: 'sparkle', label: 'AI assistant', kb: 'I', action: () => aiPanel.toggle(true) },
      { icon: 'download', label: 'Download original PDF', action: () => state.originalBytes && downloadBytes(state.originalBytes, state.fileName) },
      { icon: 'print', label: 'Print (with annotations)', kb: 'Ctrl+P', action: printDoc },
      '-',
      { icon: 'rotr', label: 'Rotate all pages right', action: () => viewer.rotateAll(90) },
      { icon: 'rotl', label: 'Rotate all pages left', action: () => viewer.rotateAll(-90) },
      '-',
      { icon: 'gear', label: 'Settings', action: openSettings },
      { icon: 'keyboard', label: 'Keyboard shortcuts', kb: '?', action: showShortcuts }
    ], new DOMRect(r.right - 230, r.top, 230, r.height), { kind: 'menu' });
    e.stopPropagation();
  };
}

function undo() { tools.select(null); hidePopover(); if (store.undo()) updateUndoUI(); }
function redo() { tools.select(null); hidePopover(); if (store.redo()) updateUndoUI(); }

// ============================================================ palette + tool pill
function wirePalette() {
  for (const b of $$('#palette .tool')) b.addEventListener('click', () => chooseTool(b.dataset.tool));
  $('#palClose').onclick = () => togglePalette(false);
  $('#pillTool').onclick = () => togglePalette(true);
  $('#pillDone').onclick = () => { setTool('select'); togglePalette(false); };
  $('#pillColor').onclick = (e) => {
    const t = propTool();
    const row = el('div', { class: 'pop-row' });
    for (const c of PALETTE) row.append(swatchBtn(c, c, (col) => { tools.setProp(t, 'color', col); refreshProps(); hidePopover(); }, tools.propsFor(t).color === c));
    showPopover(row, e.currentTarget.getBoundingClientRect(), { place: 'above', kind: 'pill' });
    e.stopPropagation();
  };
  // props
  const sw = $('#palSwatches');
  for (const c of PALETTE) {
    const b = el('button', { class: 'swatch', style: `background:${c}`, title: c, 'data-c': c });
    b.onclick = () => { tools.setProp(propTool(), 'color', c); refreshProps(); };
    sw.append(b);
  }
  const custom = el('label', { class: 'swatch custom', title: 'Custom colour' });
  const ci = el('input', { type: 'color' });
  ci.oninput = () => { tools.setProp(propTool(), 'color', ci.value); refreshProps(); };
  custom.append(ci);
  sw.append(custom);
  $('#palWidth').oninput = (e) => { tools.setProp(propTool(), 'width', Number(e.target.value)); refreshProps(); };
  $('#palOpacity').oninput = (e) => { tools.setProp(propTool(), 'opacity', Number(e.target.value) / 100); refreshProps(); };
  $('#palFont').oninput = (e) => { tools.setProp(propTool(), 'fontSize', Number(e.target.value)); refreshProps(); };
  $('#palFill').onchange = (e) => { tools.setProp(propTool(), 'fill', e.target.checked); };
  tools.on('toolchange', () => { refreshPaletteTools(); refreshPill(); refreshProps(); });
  refreshPaletteTools();
  refreshProps();
}

// Which tool's properties the palette edits: in Select/Hand mode these are the stylus pen's.
function propTool() { return tools.tool === 'select' || tools.tool === 'hand' ? 'pen' : tools.tool; }

function chooseTool(t) {
  setTool(t);
  if (t !== 'select' && state.settings.hidePaletteOnSelect) togglePalette(false);
}

function setTool(t) {
  if (tools.tool !== t) tools.setTool(t);
  refreshPill();
}

function togglePalette(force) {
  const p = $('#palette');
  const open = force ?? p.hidden;
  p.hidden = !open;
  $('#btnAnnotate').classList.toggle('on', open);
  refreshPill();
  if (open) refreshProps();
}

function refreshPaletteTools() {
  for (const b of $$('#palette .tool')) b.classList.toggle('active', b.dataset.tool === tools.tool);
}

function refreshPill() {
  const t = tools.tool;
  const show = t !== 'select' && $('#palette').hidden;
  $('#toolPill').hidden = !show;
  if (!show) return;
  $('#pillTool').querySelector('svg').replaceWith(icon(TOOL_ICONS[t]));
  $('#pillName').textContent = TOOL_NAMES[t];
  const c = tools.propsFor(t).color;
  $('#pillColor').hidden = !c;
  $('#pillSwatch').style.background = c || 'transparent';
}

function refreshProps() {
  const t = propTool();
  const p = tools.propsFor(t);
  const has = (k) => p[k] !== undefined;
  $('.pal-props .prop-row .prop-lbl').textContent = (t === 'pen' && propTool() !== tools.tool) ? 'Stylus' : 'Colour';
  $('#palSwatches').parentElement.hidden = !has('color');
  for (const b of $$('#palSwatches .swatch[data-c]')) b.classList.toggle('active', (p.color || '').toLowerCase() === b.dataset.c);
  $('#rowWidth').hidden = !has('width');
  if (has('width')) {
    const max = t === 'marker' ? 40 : t === 'eraser' ? 60 : 16;
    $('#palWidth').max = max;
    $('#palWidth').value = p.width;
    $('#palWidthVal').textContent = t === 'eraser' ? p.width + 'px' : p.width + 'pt';
  }
  $('#rowOpacity').hidden = !has('opacity') || t === 'note';
  if (has('opacity')) { $('#palOpacity').value = Math.round(p.opacity * 100); $('#palOpacityVal').textContent = Math.round(p.opacity * 100) + '%'; }
  $('#rowFont').hidden = !has('fontSize');
  if (has('fontSize')) { $('#palFont').value = p.fontSize; $('#palFontVal').textContent = p.fontSize + 'pt'; }
  $('#rowFill').hidden = !has('fill');
  if (has('fill')) $('#palFill').checked = !!p.fill;
  if (!$('#toolPill').hidden && p.color) $('#pillSwatch').style.background = p.color;
}

// ============================================================ find bar
function openFind() {
  $('#findbar').hidden = false;
  const i = $('#findInput');
  const sel = window.getSelection()?.toString();
  if (sel && sel.length < 100) i.value = sel;
  i.focus();
  i.select();
  if (i.value) runFind();
}
function closeFind() { $('#findbar').hidden = true; search.clear(); $('#findCount').textContent = ''; container.focus(); }
const runFind = debounce(() => {
  const q = $('#findInput').value;
  $('#findCount').textContent = q ? 'Searching…' : '';
  search.find(q, { caseSensitive: $('#findCase').checked }, (n, done) => {
    $('#findCount').textContent = n ? `${search.cur + 1} of ${n}${done ? '' : '+'}` : (done ? 'No matches' : 'Searching…');
  });
}, 200);
function wireFind() {
  $('#findInput').addEventListener('input', runFind);
  $('#findCase').addEventListener('change', runFind);
  const upd = () => { if (search.matches.length) $('#findCount').textContent = `${search.cur + 1} of ${search.matches.length}`; };
  $('#findInput').addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.shiftKey ? search.prev() : search.next(); upd(); }
    if (e.key === 'Escape') closeFind();
  });
  $('#findNext').onclick = () => { search.next(); upd(); };
  $('#findPrev').onclick = () => { search.prev(); upd(); };
  $('#findClose').onclick = closeFind;
}

// ============================================================ keyboard
function isTyping(e) {
  const t = e.target;
  return t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
}

function wireKeys() {
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (mod) {
      const lk = k.toLowerCase();
      if (lk === 's') { e.preventDefault(); save(e.shiftKey); return; }
      if (lk === 'o') { e.preventDefault(); pickFile(); return; }
      if (lk === 'p') { e.preventDefault(); printDoc(); return; }
      if (lk === 'f') { e.preventDefault(); openFind(); return; }
      if (lk === 'd' && !e.shiftKey && state.doc) { e.preventDefault(); addBookmark(); return; }
      if (isTyping(e)) return;
      if (lk === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (lk === 'y' || (lk === 'z' && e.shiftKey)) { e.preventDefault(); redo(); return; }
      if (k === '=' || k === '+') { e.preventDefault(); viewer.zoomBy(1); return; }
      if (k === '-') { e.preventDefault(); viewer.zoomBy(-1); return; }
      if (k === '0') { e.preventDefault(); viewer.setZoom('width'); return; }
      if (k === '1') { e.preventDefault(); viewer.setZoom(1); return; }
      return;
    }
    if (isTyping(e)) return;
    if (k === 'Escape') {
      if (popoverKind()) { hidePopover(); return; }
      if (tools.editing) { tools.commitFreeText(); return; }
      if (tools.selectedId) { tools.select(null); return; }
      if (tools.tool !== 'select') { setTool('select'); return; }
      if (!$('#palette').hidden) { togglePalette(false); return; }
      if (!$('#findbar').hidden) { closeFind(); return; }
      window.getSelection()?.removeAllRanges();
      return;
    }
    if ((k === 'Delete' || k === 'Backspace') && tools.deleteSelected()) { e.preventDefault(); return; }
    if (e.altKey && k === 'ArrowLeft') { if (viewer.goBack()) e.preventDefault(); return; }
    if (e.altKey) return;
    const toolKeys = { v: 'select', h: 'hand', 1: 'highlight', 2: 'underline', 3: 'strikeout', 4: 'squiggly', 5: 'pen', 6: 'marker', 7: 'areahl', e: 'eraser', t: 'freetext', n: 'note' };
    const lk = k.length === 1 ? k.toLowerCase() : k;
    if (toolKeys[lk] && !e.shiftKey) { chooseTool(toolKeys[lk]); e.preventDefault(); return; }
    if (lk === 'r') { viewer.rotatePage(viewer.current, e.shiftKey ? -90 : 90); return; }
    if (lk === 'w') { viewer.setZoom('width'); return; }
    if (lk === 'p') { viewer.setZoom('page'); return; }
    if (lk === 'a') { togglePalette(); return; }
    if (lk === 'i') { aiPanel.toggle(); return; }
    if (lk === 'l') { setHLock(!state.settings.hLock); return; }
    if (k === 'F4') { e.preventDefault(); sidebar.toggle(); return; }
    if (k === '?') { showShortcuts(); return; }
    const noHScroll = container.scrollWidth <= container.clientWidth + 2;
    if ((k === 'ArrowRight' && noHScroll) || (k === 'n' && e.shiftKey)) { viewer.scrollToPage(viewer.current + 1); e.preventDefault(); return; }
    if (k === 'ArrowLeft' && noHScroll) { viewer.scrollToPage(viewer.current - 1); e.preventDefault(); return; }
    if (k === 'Home' && document.activeElement !== container) { viewer.scrollToPage(0); return; }
    if (k === 'End' && document.activeElement !== container) { viewer.scrollToPage(viewer.pages.length - 1); }
  });
}

// ============================================================ touch pinch-zoom & two-finger pan
function wirePinch() {
  let pinch = null;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const mid = (t) => [(t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2];
  container.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2 || tools.penActiveRecently() || !state.doc) return;
    tools.abortGesture();
    const [cx, cy] = mid(e.touches);
    pinch = { d0: dist(e.touches), cx, cy, lx: cx, ly: cy, z0: viewer.currentZoom, k: 1 };
    const vr = viewer.viewerDiv.getBoundingClientRect();
    viewer.viewerDiv.style.transformOrigin = `${cx - vr.left}px ${cy - vr.top}px`;
  }, { passive: true });
  container.addEventListener('touchmove', (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const [cx, cy] = mid(e.touches);
    if (!state.settings.hLock) container.scrollLeft -= cx - pinch.lx;
    container.scrollTop -= cy - pinch.ly;
    pinch.lx = cx; pinch.ly = cy;
    pinch.k = clamp(dist(e.touches) / pinch.d0, 0.2, 6);
    viewer.viewerDiv.style.transform = Math.abs(pinch.k - 1) > 0.03 ? `scale(${pinch.k})` : '';
  }, { passive: false });
  const end = (e) => {
    if (!pinch || e.touches.length >= 2) return;
    const p = pinch; pinch = null;
    viewer.viewerDiv.style.transform = '';
    if (Math.abs(p.k - 1) > 0.03) {
      const r = container.getBoundingClientRect();
      viewer.zoomTo(clamp(p.z0 * p.k, 0.1, 10), p.lx - r.left, p.ly - r.top);
    }
  };
  container.addEventListener('touchend', end);
  container.addEventListener('touchcancel', end);
}

// ============================================================ dialogs
async function openSettings() {
  const s = state.settings;
  const chk = (key) => { const i = el('input', { type: 'checkbox' }); i.checked = !!s[key]; i.dataset.key = key; return i; };
  const row = (title, desc, control) => el('div', { class: 'set-row' }, [el('div', {}, [el('div', { text: title }), desc ? el('div', { class: 'desc', text: desc }) : null]), control]);
  const zoomSel = el('select', {}, [
    el('option', { value: 'width', text: 'Fit width (each page)' }),
    el('option', { value: 'page', text: 'Fit page' }),
    el('option', { value: '1', text: '100%' }),
    el('option', { value: '1.25', text: '125%' }),
    el('option', { value: '1.5', text: '150%' })
  ]);
  zoomSel.value = String(s.defaultZoom);
  const author = el('input', { type: 'text', value: s.author || '', placeholder: 'Your name', style: 'width:160px' });
  // v1.5: reference popup defaults
  const num = (v, min, max) => el('input', { type: 'number', value: String(v), min: String(min), max: String(max), step: '10', style: 'width:76px' });
  const popW = num(s.refPopupW ?? 600, 280, 4000), popH = num(s.refPopupH ?? 360, 160, 4000);
  const popSize = el('div', { style: 'display:flex;align-items:center;gap:6px;white-space:nowrap' }, [popW, el('span', { text: '×' }), popH, el('span', { class: 'desc', text: 'px' })]);
  const popZoom = el('select', {}, [50, 75, 90, 100, 110, 125, 150, 175, 200, 250, 300].map((p) => el('option', { value: String(p / 100), text: p === 100 ? '100% (fit width)' : p + '%' })));
  const curZ = Number(s.refPopupZoom ?? 1);
  if (![...popZoom.options].some((o) => Math.abs(Number(o.value) - curZ) < 1e-6)) popZoom.prepend(el('option', { value: String(curZ), text: Math.round(curZ * 100) + '% (custom)' }));
  popZoom.value = [...popZoom.options].find((o) => Math.abs(Number(o.value) - curZ) < 1e-6).value;
  let autoOpen = null;
  if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
    const { autoOpen: ao = true } = await chrome.storage.sync.get('autoOpen');
    autoOpen = el('input', { type: 'checkbox' }); autoOpen.checked = ao;
  }
  const body = el('div', {}, [
    row('Stylus always draws (Xodo mode)', 'A pen/stylus writes ink in Select mode without choosing the Pen tool. The pen’s eraser end erases.', chk('stylusDraws')),
    row('Quick-annotate popup on text selection', 'Highlight, underline, strike or comment right after selecting text.', chk('selectionPopup')),
    row('Smooth text selection', 'Ferna’s own selection: follows the nearest character even between lines, draws one clean band per line. Turn off to use the browser’s selection.', chk('smoothSelect')),
    row('Select whole words when dragging', 'Once the selection leaves the first word it grows word by word. Hold Alt for single characters. Double-click = word, triple-click = line.', chk('wordSelect')),
    row('Hide the annotation panel when a tool is chosen', 'The panel gets out of the way; a small pill at the bottom shows the active tool.', chk('hidePaletteOnSelect')),
    row('Keep shape, text and note tools active', 'Otherwise they return to Select after one use.', chk('stickyTools')),
    row('Default zoom', null, zoomSel),
    row('Remember last page and zoom per document', null, chk('rememberPosition')),
    row('Pre-render upcoming pages', 'While you read, the next pages are drawn in the background so turning pages is instant, even in large PDFs. Uses more memory; turn off on low-memory computers.', chk('prerender')),
    row('Show cross-references as popups', 'Figure, table, equation and citation references open a preview card instead of jumping away. Ctrl+click a link to jump.', chk('refPopups')),
    row('Popup size (width × height)', 'Default size of reference, figure and table popups. You can still resize a popup from its edges with the mouse.', popSize),
    row('Popup zoom', 'Default zoom inside the popup. Ctrl + wheel (or a touchpad pinch) over a popup zooms on the fly.', popZoom),
    row('Remember my last popup size and zoom', 'When on, the size and zoom you set with the mouse become the new default. The 📌 button in a popup saves them once.', chk('refPopupRemember')),
    autoOpen ? row(`Open PDFs in ${BROWSER_NAME} with Ferna automatically`, 'Turn off to use the browser’s built-in PDF viewer.', autoOpen) : null,
    row('Author name for annotations', null, author),
    row('Direct-save helper', FROM_STORE ? 'Lets Save overwrite PDFs opened from your disk without a Save window. Install: download Ferna-PDF-Save-Helper from tgi25.github.io/ferna-software/ferna-pdf-reader \u2192 Install-Save-Helper.bat.' : IS_FIREFOX ? 'Lets Firefox open PDFs from your disk and Save overwrite them without a Save window. Install: download Ferna-PDF-Save-Helper from tgi25.github.io/ferna-software/ferna-pdf-reader \u2192 Install-Save-Helper.bat.' : 'Lets Save overwrite PDFs opened from your disk without a Save window. Install: save-helper \u2192 Install-Save-Helper.bat in the extension folder.', el('b', { text: (await helperAvailable(true)) ? 'Installed \u2713' : 'Not installed', style: 'white-space:nowrap' }))
  ]);
  const res = await showDialog('Settings', body, [{ label: 'Cancel' }, { label: 'Save', primary: true, value: 'save' }]);
  if (res !== 'save') return;
  for (const i of body.querySelectorAll('input[type=checkbox][data-key]')) s[i.dataset.key] = i.checked;
  s.defaultZoom = zoomSel.value === 'width' || zoomSel.value === 'page' ? zoomSel.value : Number(zoomSel.value);
  s.author = author.value.trim();
  s.refPopupW = Math.round(clamp(Number(popW.value) || 600, 280, 4000));
  s.refPopupH = Math.round(clamp(Number(popH.value) || 360, 160, 4000));
  s.refPopupZoom = Number(popZoom.value) || 1;
  await saveSettings(s);
  if (autoOpen) chrome.storage.sync.set({ autoOpen: autoOpen.checked });
  updateStylusBtn();
  document.body.classList.toggle('native-sel', !s.smoothSelect);
  tools.textSel?.paint();
  toast('Settings saved');
}

function showShortcuts() {
  const rows = [
    ['Ctrl + S', 'Save (overwrite this file)'], ['Ctrl + Shift + S', 'Save As (new name or location)'], ['Ctrl + O', 'Open'], ['Ctrl + P', 'Print with annotations'], ['Ctrl + F', 'Find'], ['I', 'AI assistant panel'], ['Alt + ←', 'Back after following a link'],
    ['Ctrl + Z / Ctrl + Y', 'Undo / Redo'], ['Ctrl + wheel, Ctrl + + / −', 'Zoom'], ['Ctrl + 0 / W', 'Fit width'], ['P', 'Fit page'], ['Ctrl + 1', '100 %'],
    ['R / Shift + R', 'Rotate current page right / left'], ['A', 'Show / hide annotation tools'], ['V / H', 'Select / Hand'],
    ['1 2 3 4', 'Highlight, Underline, Strike-out, Squiggly'], ['5 / 6 / 7', 'Pen / Marker / Area highlight'], ['L', 'Horizontal lock on/off'], ['E', 'Eraser'], ['T / N', 'Text box / Sticky note'],
    ['Double / triple click', 'Select word / line (Alt + drag: single characters)'], ['Delete', 'Delete selected annotation'], ['Esc', 'Close popup → stop tool → deselect'], ['F4', 'Sidebar'], ['← / →', 'Previous / next page'],
    ['Right-click a page', 'Page menu (rotate, fit, add note)'], ['Stylus', 'Writes anytime (Xodo mode); eraser end erases']
  ];
  const grid = el('div', { class: 'shortcuts' });
  for (const [k, d] of rows) grid.append(el('kbd', { text: k, style: 'justify-self:start' }), el('span', { text: d }));
  showDialog('Keyboard shortcuts', grid);
}

void ZOOM_STEPS;


// ============================================================ v1.3: Auto-Bookmark
function docTitle() { return (document.title || state.fileName || 'document').replace(/ – Ferna PDF Reader$/, ''); }

async function aiUsable() {
  if (engine.isReady()) return true;
  if (engine.provider === 'webllm') return engine.isModelCached();
  return true;
}

async function autoBookmark(useAI = null) {
  if (!state.doc) return;
  let result;
  try {
    setLoading(true, 'Analysing the page layout…', 0);
    result = await detectHeadings(doctext, (p) => setLoading(true, 'Analysing the page layout…', p));
  } catch (e) {
    setLoading(false);
    toast('Could not analyse the document: ' + e.message, 5000);
    return;
  }
  let items = result.items;
  let usedAI = false;
  // a printed table of contents is what people expect — the AI step is only used when asked for
  if (useAI === null) useAI = result.source === 'toc' ? false : await aiUsable();
  if (useAI && items.length) {
    setLoading(false);
    const ok = await aiPanel._ensure();
    if (ok) {
      try {
        setLoading(true, 'AI is reviewing the headings…');
        items = await refineWithAI(engine, items, docTitle(), (t) => setLoading(true, t));
        usedAI = true;
      } catch (e) {
        toast('AI step failed, showing layout-based bookmarks: ' + e.message, 5000);
      }
    }
  }
  setLoading(false);
  bookmarkEditor({
    items, viewer, usedAI, aiAvailable: true, source: result.source,
    onRegenerate: (ai) => autoBookmark(ai),
    onApply: (list) => {
      applyBookmarks(list);
      toast(`${state.outline.length} bookmarks ready — Save to write them into the PDF.`, 4000);
    }
  });
}

// ============================================================ v1.5: OCR (scanned PDFs)
let ocrMod = null;
const loadOcr = async () => (ocrMod ||= await import('./ocr.js'));

// A scanned document (no text on its first pages): offer OCR once.
async function suggestOcr(pdf) {
  document.querySelector('.ocr-banner')?.remove();
  try {
    const n = Math.min(3, pdf.numPages);
    for (let i = 1; i <= n; i++) {
      const tc = await (await pdf.getPage(i)).getTextContent();
      if (tc.items.reduce((k, it) => k + (it.str || '').replace(/\s+/g, '').length, 0) >= 12) return;
    }
    if (state.doc !== pdf) return;
    const bar = el('div', { class: 'ocr-banner' }, [
      el('span', { text: 'This looks like a scanned document — its text cannot be selected or searched yet.' }),
      el('button', { class: 'btn primary', text: 'Recognise text (OCR)', onclick: () => { bar.remove(); ocrDialog(); } }),
      el('button', { class: 'tb small', title: 'Close', onclick: () => bar.remove() }, [icon('close')])
    ]);
    document.body.append(bar);
  } catch { /* ignore */ }
}

async function ocrDialog() {
  if (!state.doc) return;
  const pdf = state.doc;
  const ocr = await loadOcr();
  const lang = el('select', {}, ocr.OCR_LANGS.map((l) => el('option', { value: l.id, text: l.label })));
  lang.value = state.settings.ocrLang || 'eng';
  const radio = (v, label, checked) => {
    const r = el('input', { type: 'radio', name: 'ocrpages', value: v });
    r.checked = !!checked;
    const sp = el('span', { text: label });
    return { r, sp, row: el('label', { class: 'ocr-opt' }, [r, sp]) };
  };
  const auto = radio('auto', 'Pages without text (checking…)', true);
  const cur = radio('current', `Current page (${viewer.current + 1})`);
  const all = radio('all', `All ${pdf.numPages} pages`);
  const rng = radio('range', 'Pages:');
  const rangeIn = el('input', { type: 'text', placeholder: 'e.g. 1-5, 8', style: 'width:140px;margin-left:6px' });
  rangeIn.addEventListener('focus', () => { rng.r.checked = true; });
  rangeIn.addEventListener('keydown', (e) => e.stopPropagation());
  rng.row.append(rangeIn);
  const warn = el('div', { class: 'muted small', style: 'margin-top:6px' });
  const body = el('div', {}, [
    el('p', { class: 'muted small', text: 'Ferna reads the scanned pages and adds an invisible text layer over them, so you can select, search, copy, highlight and use the AI. It runs on your computer — nothing is uploaded. It takes a few seconds per page.' }),
    el('div', { class: 'set-row' }, [el('div', { text: 'Language of the document' }), lang]),
    el('div', { class: 'ocr-pages' }, [auto.row, cur.row, all.row, rng.row]),
    warn
  ]);
  let textless = null;
  ocr.pagesWithoutText(pdf).then((list) => {
    textless = list;
    auto.sp.textContent = list.length ? `Pages without text (${list.length} of ${pdf.numPages})` : 'Pages without text (none found)';
    if (!list.length) { auto.r.disabled = true; cur.r.checked = true; }
  }).catch(() => {});
  all.r.addEventListener('change', () => { warn.textContent = 'Pages that already have text will get a second, duplicate text layer.'; });
  for (const o of [auto, cur, rng]) o.r.addEventListener('change', () => { warn.textContent = ''; });
  const res = await showDialog('Recognise text (OCR)', body, [{ label: 'Cancel' }, { label: 'Recognise text', primary: true, value: 'go' }]);
  if (res !== 'go' || state.doc !== pdf) return;
  let pages;
  if (auto.r.checked) pages = textless ?? await ocr.pagesWithoutText(pdf);
  else if (cur.r.checked) pages = [viewer.current];
  else if (all.r.checked) pages = [...Array(pdf.numPages).keys()];
  else {
    try { pages = (await import('./merge.js')).parseRange(rangeIn.value, pdf.numPages); } catch (e) { toast(e.message, 4000); return; }
  }
  if (!pages.length) { toast('No pages to recognise.'); return; }
  state.settings.ocrLang = lang.value;
  saveSettings(state.settings, ['ocrLang']);
  runOcr(pdf, pages, lang.value);
}

async function runOcr(pdf, pages, langs) {
  const ocr = await loadOcr();
  const engine = new ocr.OcrEngine();
  let cancelled = false;
  const bar = el('div', { class: 'ocr-bar-fill' });
  const label = el('div', { text: 'Starting the OCR engine…' });
  const back = el('div', { class: 'dialog-backdrop' });
  const box = el('div', { class: 'dialog', role: 'dialog' }, [
    el('h2', { text: 'Recognising text…' }), label, el('div', { class: 'ocr-bar' }, [bar]),
    el('div', { class: 'actions' }, [el('button', { class: 'btn', text: 'Cancel', onclick: () => { cancelled = true; label.textContent = 'Stopping…'; } })])
  ]);
  back.append(box); document.body.append(back);
  const results = new Map();
  let k = 0, words = 0;
  engine.onProgress = (m) => {
    if (m.status === 'recognizing text') bar.style.width = Math.round(((k + (m.progress || 0)) / pages.length) * 100) + '%';
  };
  try {
    for (k = 0; k < pages.length && !cancelled; k++) {
      label.textContent = `Page ${pages[k] + 1} (${k + 1} of ${pages.length})…`;
      const page = await pdf.getPage(pages[k] + 1);
      const r = await engine.recognizePage(page, langs);
      results.set(pages[k], r);
      words += r.words.length;
      if (state.doc !== pdf) { cancelled = true; break; }
    }
  } catch (e) {
    console.error(e);
    toast('OCR failed: ' + e.message, 6000);
  } finally {
    engine.terminate();
    back.remove();
  }
  if (state.doc !== pdf || !results.size) return;
  if (!words) { toast('No text was found on the selected pages.', 4000); return; }
  try {
    setLoading(true, 'Adding the text layer…');
    const bytes = await buildPdf({ encrypt: false });
    const out = await ocr.addTextLayer(bytes, results);
    const enc = state.encryption, page = viewer.current;
    store.markSaved();
    await openBytes(out);
    state.encryption = enc; updateLockUI();
    store.touch();
    viewer.scrollToPage(page);
    toast(`Text recognised on ${results.size} page${results.size === 1 ? '' : 's'}${cancelled ? ' (stopped early)' : ''} — Save to keep it in the PDF.`, 5000);
  } catch (e) {
    setLoading(false);
    console.error(e);
    toast('Could not add the text layer: ' + e.message, 6000);
  }
}

// ============================================================ v1.5: merge PDF files
function mergeDialog() {
  openMergeDialog({
    current: state.doc ? {
      name: state.fileName || 'document.pdf', pages: state.doc.numPages,
      getBytes: () => buildPdf({ encrypt: false }),
      outline: bookmarkList().filter((c) => c.page != null)
    } : null,
    askPassword: (retry) => askPassword(retry),
    setLoading,
    onDone: async (bytes, name) => {
      if (store.dirty && !confirm('The merged file includes your unsaved changes, but the original document has not been saved. Open the merged file anyway?')) {
        Promise.resolve().then(() => saveToDownloads(bytes, name)).catch(() => {});
        toast('Merged file saved to Downloads.');
        return;
      }
      store.markSaved();
      await openFileObject(new File([bytes], name, { type: 'application/pdf' }));
      store.touch();
      toast(`Merged ${state.doc?.numPages || ''} pages — use Save As to keep the file.`, 5000);
    }
  });
}

// ============================================================ v1.5: manual bookmarks
// The outline is kept as a flat list [{title, page, y, level}] (pdf.js outline flattened once per document).
// Editing it sets state.outline, which Save writes into the PDF.
async function loadOutlineList(pdf) {
  try {
    const outline = await pdf.getOutline();
    if (state.doc !== pdf) return;
    if (!outline?.length) { state.outlineList = []; return; }
    const list = [];
    const walk = async (items, level) => {
      for (const it of items) {
        const c = { title: (it.title || '').trim() || '(untitled)', level: Math.min(level, 8), page: null, y: null, bold: !!it.bold, italic: !!it.italic };
        if (it.dest) { try { const d = await viewer.resolveDest(it.dest); if (d) { c.page = d.index; c.y = d.y; } } catch { /* unresolved */ } }
        else if (it.url) c.url = it.url;
        list.push(c);
        if (it.items?.length) await walk(it.items, level + 1);
      }
    };
    await walk(outline, 1);
    if (state.doc !== pdf) return;
    state.outlineList = list;
    if (!state.outline) sidebar.renderOutline(toTree(list), false);
  } catch (e) { console.warn('outline', e); state.outlineList = []; }
}

function bookmarkList() {
  return (state.outline || state.outlineList || []).map((c) => ({ ...c }));
}

function applyBookmarks(list) {
  state.outline = list.filter((c) => (c.title || '').trim() && (c.page != null || c.url))
    .map((c) => ({ title: c.title.trim(), page: c.page, y: c.y ?? null, level: Math.max(1, c.level || 1), ...(c.url ? { url: c.url } : {}) }));
  sidebar.toggle(true);
  sidebar.show('outline');
  sidebar.renderOutline(toTree(state.outline), true);
  store.touch();
}

// Position at the top of the visible area: {page, y, title} (title = first text line there, if any)
async function viewTopPosition() {
  const p = viewer.current;
  const pv = viewer.pages[p];
  const cr = container.getBoundingClientRect(), pr = pv.div.getBoundingClientRect();
  let y = null;
  if (pr.top < cr.top + 8) y = pv.clientToPdf(pr.left + pr.width / 2, cr.top + 8)[1];
  let title = '';
  try {
    const lines = await doctext.pageLines(p);
    const cand = lines.filter((l) => (l.text || '').trim().length > 1 && (y == null || l.top <= y + 2)).sort((a, b) => b.top - a.top)[0];
    if (cand) { title = cand.text.trim().replace(/\s+/g, ' '); if (title.length > 80) title = title.slice(0, 77).trimEnd() + '…'; y = cand.top; }
  } catch { /* no text layer */ }
  return { page: p, y, title: title || `Page ${p + 1}` };
}

async function addBookmark() {
  if (!state.doc) return;
  if (state.outlineList == null) await loadOutlineList(state.doc);
  const pos = await viewTopPosition();
  const input = el('input', { type: 'text', value: pos.title, style: 'width:100%' });
  const level = el('select', {}, [1, 2, 3, 4].map((n) => el('option', { value: String(n), text: n === 1 ? 'Top level' : `Level ${n}` })));
  const list = bookmarkList();
  // keep document order: after the last bookmark that comes before this position
  const key = (c) => [c.page ?? -1, -(c.y ?? 1e9)];
  const before = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]);
  let at = list.length;
  for (let i = 0; i < list.length; i++) if (list[i].page != null && !before(key(list[i]), key(pos))) { at = i; break; }
  level.value = String(list[at - 1]?.level || 1);
  const body = el('div', {}, [
    el('p', { class: 'muted small', text: `Bookmark on page ${pos.page + 1}, at the current scroll position.` }),
    el('label', { class: 'small', text: 'Title' }), input,
    el('div', { style: 'margin-top:10px;display:flex;align-items:center;gap:8px' }, [el('label', { class: 'small', text: 'Level' }), level])
  ]);
  input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); body.closest('.dialog').querySelector('.btn.primary').click(); } });
  setTimeout(() => { input.focus(); input.select(); }, 30);
  const res = await showDialog('Add bookmark', body, [{ label: 'Cancel' }, { label: 'Add bookmark', primary: true, value: 'add' }]);
  if (res !== 'add' || !input.value.trim()) return;
  list.splice(at, 0, { title: input.value.trim(), page: pos.page, y: pos.y, level: Number(level.value) });
  applyBookmarks(list);
  toast('Bookmark added — Save to write it into the PDF.');
}

async function editBookmarks() {
  if (!state.doc) return;
  if (state.outlineList == null) await loadOutlineList(state.doc);
  bookmarkEditor({
    items: bookmarkList().map((c, i) => ({ ...c, id: i, page: c.page ?? 0 })), viewer, source: 'manual', title: 'Edit bookmarks',
    onApply: (list) => { applyBookmarks(list); toast('Bookmarks updated — Save to write them into the PDF.'); }
  });
}

function bookmarkEdit({ action, idx, title }) {
  const list = bookmarkList();
  if (!list[idx]) return;
  if (action === 'rename') list[idx].title = title;
  if (action === 'delete') {
    // children move up one level with their parent gone
    const lv = list[idx].level;
    for (let j = idx + 1; j < list.length && list[j].level > lv; j++) list[j].level--;
    list.splice(idx, 1);
  }
  applyBookmarks(list);
}
