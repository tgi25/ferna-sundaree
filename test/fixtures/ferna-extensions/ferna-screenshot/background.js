// Ferna Screenshot — service worker: commands, menus, capture + stitching, quick save.

import { getSettings } from './lib/settings.js';
import { putCapture, prune, newId } from './lib/db.js';
import { exportBlob } from './lib/export.js';
import { buildFilename } from './lib/util.js';

const busy = new Map();          // tabId -> mode
const CAPTURE_GAP = 560;         // Chrome allows 2 captureVisibleTab calls per second
let lastGrab = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ menus & commands
function createMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'fs-root', title: 'Ferna Screenshot', contexts: ['page', 'selection', 'link', 'image', 'frame'] });
    const items = [['visible', 'Capture visible area'], ['full', 'Capture entire page'], ['region', 'Select a region…'], ['element', 'Select an element…']];
    for (const [id, title] of items) chrome.contextMenus.create({ id: 'fs-' + id, parentId: 'fs-root', title, contexts: ['page', 'selection', 'link', 'image', 'frame'] });
    chrome.contextMenus.create({ id: 'fs-sep', parentId: 'fs-root', type: 'separator', contexts: ['page', 'selection', 'link', 'image', 'frame'] });
    chrome.contextMenus.create({ id: 'fs-history', parentId: 'fs-root', title: 'Open screenshot history', contexts: ['page', 'selection', 'link', 'image', 'frame'] });
  });
}
chrome.runtime.onInstalled.addListener(createMenus);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const id = String(info.menuItemId).replace(/^fs-/, '');
  if (id === 'history') { chrome.tabs.create({ url: chrome.runtime.getURL('history.html') }); return; }
  if (tab) start(id, tab);
});

chrome.commands.onCommand.addListener((cmd, tab) => {
  const mode = { 'capture-visible': 'visible', 'capture-full': 'full', 'capture-region': 'region', 'capture-element': 'element' }[cmd];
  if (!mode) return;
  if (tab) start(mode, tab);
  else chrome.tabs.query({ active: true, currentWindow: true }, ([t]) => t && start(mode, t));
});

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (!m || !m.type) return;
  if (m.type === 'capture') {
    chrome.tabs.get(m.tabId).then((tab) => start(m.mode, tab, { delay: m.delay }));
    reply({ ok: true });
  } else if (m.type === 'fs:area' && sender.tab) {
    captureArea(sender.tab, m.rect, m.mode);
    reply({ ok: true });
  } else if (m.type === 'fs:cancel' && sender.tab) {
    busy.delete(sender.tab.id); badge(sender.tab.id, '');
    reply({ ok: true });
  }
});

chrome.tabs.onUpdated.addListener((tabId, ch) => { if (ch.status === 'loading' && busy.get(tabId) && ['region', 'element'].includes(busy.get(tabId))) busy.delete(tabId); });
chrome.tabs.onRemoved.addListener((tabId) => busy.delete(tabId));

// ------------------------------------------------------------------ helpers
function badge(tabId, text, color = '#2563eb') {
  chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
}

function notify(message) {
  chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title: 'Ferna Screenshot', message, priority: 1 });
}

async function inject(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ['content/agent.js', 'content/select.js'] });
    return true;
  } catch (e) { return false; }
}

const send = (tabId, msg) => chrome.tabs.sendMessage(tabId, msg, { frameId: 0 });

async function grab(windowId) {
  const wait = CAPTURE_GAP - (Date.now() - lastGrab);
  if (wait > 0) await sleep(wait);
  let url;
  for (let attempt = 0; ; attempt++) {
    try { url = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' }); break; }
    catch (e) {
      if (attempt < 3 && /MAX_CAPTURE|quota|per second/i.test(String(e.message || e))) { await sleep(1000); continue; }
      throw e;
    }
  }
  lastGrab = Date.now();
  return createImageBitmap(await (await fetch(url)).blob());
}

async function ensureActive(tab) {
  const t = await chrome.tabs.get(tab.id);
  if (!t.active) throw new Error('The tab was switched away during capture. Keep the tab in front until the capture finishes.');
  return t;
}

// ------------------------------------------------------------------ entry point
async function start(mode, tab, opts = {}) {
  const b = busy.get(tab.id);
  if (b && b !== 'region' && b !== 'element') return;   // a stitched capture is running
  const st = await getSettings();
  const delay = opts.delay != null ? opts.delay : st.delay;
  busy.set(tab.id, mode);
  try {
    const ok = await inject(tab.id);
    if (!ok) {
      // browser pages, the Web Store and the PDF viewer can't be scripted: fall back to what's on screen
      if (mode !== 'visible') notify('This page cannot be scrolled by extensions (browser page, Web Store or PDF viewer), so only the visible area was captured.');
      await countdown(tab.id, delay);
      await captureVisible(tab, null);
      return;
    }
    if (mode === 'region' || mode === 'element') {
      await send(tab.id, { fsSelect: mode });
      return; // continues in captureArea() when the page sends fs:area
    }
    await countdown(tab.id, (mode === 'visible' || mode === 'full') ? delay : 0);
    if (mode === 'visible') {
      let v = null;
      try { v = await send(tab.id, { fsCmd: 'measure' }); } catch {}
      await captureVisible(tab, v);
    } else await captureArea(tab, null, 'full');
  } catch (e) {
    fail(tab.id, e);
  } finally {
    if (mode !== 'region' && mode !== 'element') busy.delete(tab.id);
  }
}

function fail(tabId, e) {
  console.error(e);
  busy.delete(tabId);
  badge(tabId, '!', '#dc2626');
  setTimeout(() => badge(tabId, ''), 4000);
  notify('Capture failed: ' + (e && e.message || e));
}

async function countdown(tabId, seconds) {
  for (let s = Math.round(seconds || 0); s > 0; s--) { badge(tabId, String(s), '#f59e0b'); await sleep(1000); }
  badge(tabId, '');
}

// ------------------------------------------------------------------ visible area
async function captureVisible(tab, v) {
  tab = await ensureActive(tab);
  badge(tab.id, '…');
  const bmp = await grab(tab.windowId);
  let cw = bmp.width, ch = bmp.height, s = 1;
  if (v && v.innerW) {
    s = bmp.width / v.innerW;                         // device pixels per CSS px
    cw = Math.min(bmp.width, Math.round(v.vw * s));   // drop the scrollbars
    ch = Math.min(bmp.height, Math.round(v.vh * s));
  }
  const st = await getSettings();
  const k = st.resolution === 'css' ? 1 / s : 1;
  const cv = new OffscreenCanvas(Math.round(cw * k), Math.round(ch * k));
  const ctx = cv.getContext('2d'); ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, cw, ch, 0, 0, cv.width, cv.height);
  await finish(tab, cv, {
    mode: 'visible', scale: s * k, cssW: Math.round(cw / s), cssH: Math.round(ch / s),
    scrollX: v ? v.scrollX : 0, scrollY: v ? v.scrollY : 0
  });
}

// ------------------------------------------------------------------ stitched area / full page
function steps(start, len, view) {
  const out = [];
  const step = Math.max(50, view);
  for (let p = start; p < start + len; p += step) out.push(Math.round(p));
  if (!out.length) out.push(Math.round(start));
  return out;
}

async function captureArea(tab, rect, mode) {
  const st = await getSettings();
  busy.set(tab.id, mode);
  let prepared = false;
  try {
    tab = await ensureActive(tab);
    badge(tab.id, '0%');
    const prep = await send(tab.id, { fsCmd: 'prepare', full: !rect, hideFixed: st.hideFixed });
    if (!prep || prep.error) throw new Error(prep && prep.error || 'The page did not answer.');
    prepared = true;
    let A;
    if (rect) {
      const x = Math.max(0, rect.x), y = Math.max(0, rect.y);
      A = { x, y, w: Math.max(1, Math.min(rect.w, Math.max(prep.docW, prep.vw) - x)), h: Math.max(1, Math.min(rect.h, Math.max(prep.docH, prep.vh) - y)) };
    } else {
      A = { x: 0, y: 0, w: Math.max(prep.vw, Math.min(prep.docW, prep.vw * 4)), h: Math.min(prep.docH, st.maxHeight) };
      if (prep.docW <= prep.vw + 2) A.w = prep.vw;
    }
    const xs = steps(A.x, A.w, prep.vw), ys = steps(A.y, A.h, prep.vh);
    const total = xs.length * ys.length;
    let canvas = null, ctx = null, s = 1, k = 1, n = 0, downscaled = false;

    for (const y of ys) {
      for (const x of xs) {
        const v = await send(tab.id, { fsCmd: 'scroll', x, y, delay: st.scrollDelay, hideFixed: st.hideFixed && n > 0 });
        if (!v || v.error) throw new Error(v && v.error || 'Scrolling failed.');
        await ensureActive(tab);
        const bmp = await grab(tab.windowId);
        if (!canvas) {
          s = bmp.width / v.innerW;
          const base = st.resolution === 'css' ? 1 / s : 1;
          const W = A.w * s * base, H = A.h * s * base;
          const lim = Math.min(1, 32000 / W, 32000 / H, Math.sqrt(220e6 / (W * H)));
          downscaled = lim < 0.999;
          k = base * lim;
          canvas = new OffscreenCanvas(Math.max(1, Math.round(A.w * s * k)), Math.max(1, Math.round(A.h * s * k)));
          ctx = canvas.getContext('2d');
          ctx.imageSmoothingQuality = 'high';
          ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        drawTile(ctx, bmp, v, A, s, k);
        bmp.close();
        n++;
        badge(tab.id, Math.min(99, Math.round((n / total) * 100)) + '%');
      }
    }
    await send(tab.id, { fsCmd: 'restore' }).catch(() => {});
    prepared = false;
    await finish(tab, canvas, {
      mode: rect ? mode : 'full', scale: s * k, cssW: Math.round(A.w), cssH: Math.round(A.h),
      area: A, downscaled, truncated: !rect && prep.docH > st.maxHeight, container: !!prep.container
    });
  } catch (e) {
    fail(tab.id, e);
  } finally {
    if (prepared) await send(tab.id, { fsCmd: 'restore' }).catch(() => {});
    busy.delete(tab.id);
  }
}

function drawTile(ctx, bmp, v, A, s, k) {
  const ix0 = Math.max(A.x, v.scrollX), iy0 = Math.max(A.y, v.scrollY);
  const ix1 = Math.min(A.x + A.w, v.scrollX + v.vw), iy1 = Math.min(A.y + A.h, v.scrollY + v.vh);
  if (ix1 <= ix0 || iy1 <= iy0) return;
  const sx0 = Math.round((ix0 - v.scrollX + v.viewLeft) * s), sy0 = Math.round((iy0 - v.scrollY + v.viewTop) * s);
  const sx1 = Math.min(bmp.width, Math.round((ix1 - v.scrollX + v.viewLeft) * s)), sy1 = Math.min(bmp.height, Math.round((iy1 - v.scrollY + v.viewTop) * s));
  const dx0 = Math.round((ix0 - A.x) * s * k), dy0 = Math.round((iy0 - A.y) * s * k);
  const dx1 = Math.round((ix1 - A.x) * s * k), dy1 = Math.round((iy1 - A.y) * s * k);
  if (sx1 <= sx0 || sy1 <= sy0) return;
  ctx.drawImage(bmp, sx0, sy0, sx1 - sx0, sy1 - sy0, dx0, dy0, dx1 - dx0, dy1 - dy0);
}

// ------------------------------------------------------------------ finishing
async function finish(tab, canvas, info) {
  const st = await getSettings();
  badge(tab.id, '✓', '#16a34a');
  setTimeout(() => badge(tab.id, ''), 2500);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const tw = Math.min(360, canvas.width), th = Math.max(1, Math.round(canvas.height * (tw / canvas.width)));
  const thc = new OffscreenCanvas(tw, Math.min(th, 1200));
  const tctx = thc.getContext('2d'); tctx.imageSmoothingQuality = 'high';
  tctx.drawImage(canvas, 0, 0, canvas.width, Math.min(canvas.height, (1200 / tw) * canvas.width), 0, 0, tw, Math.min(th, 1200));
  const thumb = await thc.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
  const rec = {
    id: newId(), ts: Date.now(), url: tab.url || '', title: tab.title || '', width: canvas.width, height: canvas.height,
    blob, thumb, ...info
  };
  await putCapture(rec);
  prune(st.historyLimit).catch(() => {});

  if (st.afterCapture === 'save') {
    try {
      await quickSave(rec, st);
      send(tab.id, { fsCmd: 'toast', text: 'Screenshot saved to Downloads/' + (st.folder || '') }).catch(() => {});
    } catch (e) { fail(tab.id, e); }
  } else {
    chrome.tabs.create({ url: chrome.runtime.getURL('editor.html?id=' + rec.id), index: tab.index + 1, openerTabId: tab.id });
  }
  if (info.truncated) notify(`The page is very long; the first ${st.maxHeight.toLocaleString()} px were captured (change this in Settings).`);
}

async function quickSave(rec, st) {
  const img = await createImageBitmap(rec.blob);
  const doc = { objects: [], crop: null, stamp: st.stamp };
  const { blob, ext } = await exportBlob(img, doc, rec, st, st.quickFormat, null);
  const url = await blobToDataUrl(blob);
  await chrome.downloads.download({ url, filename: buildFilename(st.filePattern, rec, ext, st.folder), saveAs: !!st.saveAs, conflictAction: 'uniquify' });
}

async function blobToDataUrl(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return `data:${blob.type};base64,${btoa(s)}`;
}

// test hook (used by the automated tests only; harmless otherwise)
globalThis.__fernaShots = { start, captureArea };
