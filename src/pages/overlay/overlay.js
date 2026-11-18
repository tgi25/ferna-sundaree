// Ferna Sundaree — overlay: Tab Overview, Ferna Tabs list at the pointer,
// command palette, screen-sharing picker and small prompts.
'use strict';

const { icon, esc, faviconHtml, wsIconHtml, hostOf, $ } = FK;
const api = window.ferna;
const root = $('#root');
let mode = null;
let data = null;
let keyHandler = null;

function close() { api.cmd('overlay:close'); }

api.on('overlay', msg => {
  if (msg.update && msg.mode === 'peek' && mode === 'peek') { updatePeek(msg.data); return; }
  mode = msg.mode;
  data = msg.data;
  keyHandler = null;
  root.innerHTML = '';
  if (!mode) return;
  ({ overview: openOverview, pointer: openPointer, palette: openPalette, prompt: openPrompt, zoom: openZoom, bookmarks: openBookmarks, peek: openPeek, media: openMedia, pwsave: openPwSave, share: openShare, exampw: openExamPw, parentpw: openParentPw })[mode](data);
});
api.on('state', s => { if (mode === 'pointer') { data = { ...data, ...s }; if (!pt.bmv) renderPointer(); } });

document.addEventListener('keydown', e => {
  if (keyHandler && keyHandler(e) === true) return;
  if (e.key === 'Escape') { e.preventDefault(); close(); }
});

// =====================================================================
// Tab Overview — every open page as a live thumbnail, grouped by workspace
// =====================================================================
let ov = { filter: 'all', q: '', sel: 0, flat: [] };

function openOverview(d) {
  ov = { filter: d.currentWs || 'all', q: '', sel: 0, flat: [] };
  root.innerHTML = `<div class="backdrop" data-bg="1"></div>
    <div class="ov">
      <div class="ov-head">
        <h1>Tab Overview</h1>
        <div class="ov-search">${icon('search')}<input id="ov-q" placeholder="Filter by title or address" aria-label="Filter tabs"></div>
        <div class="ov-filters" id="ov-filters"></div>
        <div class="ov-hint"><kbd>↑↓←→</kbd> move · <kbd>Enter</kbd> open · <kbd>Del</kbd> close · <kbd>Alt+1…9</kbd> workspace · <kbd>Esc</kbd></div>
      </div>
      <div class="ov-body" id="ov-body"></div>
    </div>`;
  const q = $('#ov-q');
  q.focus();
  q.addEventListener('input', () => { ov.q = q.value.toLowerCase(); ov.sel = 0; renderOverview(); });
  root.querySelector('[data-bg]').onclick = close;
  $('#ov-body').addEventListener('click', e => { if (e.target.id === 'ov-body') close(); });
  keyHandler = overviewKeys;
  renderOverview();
}

function overviewGroups() {
  const d = data;
  const match = t => !ov.q || (t.title || '').toLowerCase().includes(ov.q) || (t.url || '').toLowerCase().includes(ov.q);
  const tabs = d.tabs.filter(match);
  const groups = [];
  const wsList = [...d.workspaces, { id: null, name: 'No workspace', color: '#64748b' }];
  for (const w of wsList) {
    if (ov.filter !== 'all' && ov.filter !== w.id) continue;
    const items = tabs.filter(t => (t.ws || null) === w.id);
    if (items.length || (ov.filter === w.id)) groups.push({ ws: w, items });
  }
  return groups;
}

function renderOverview() {
  const d = data;
  const filters = [{ id: 'all', name: 'All', color: '#94a3b8' }, ...d.workspaces];
  $('#ov-filters').innerHTML = filters.map((w, i) => `<button class="ov-filter${ov.filter === w.id ? ' on' : ''}" data-f="${esc(w.id)}" title="Alt+${i}" style="--c:${esc(w.color)}"><span class="dot"></span>${esc(w.name)}</button>`).join('');
  const groups = overviewGroups();
  ov.flat = groups.flatMap(g => g.items);
  ov.sel = Math.max(0, Math.min(ov.sel, ov.flat.length - 1));
  const body = $('#ov-body');
  if (!ov.flat.length) {
    body.innerHTML = `<div class="ov-empty">${ov.q ? 'No open page matches your filter.' : 'No open pages in this workspace.'}</div>`;
    return;
  }
  let k = 0;
  body.innerHTML = groups.map(g => `
    <section class="ov-group">
      <h2 data-drop="${esc(g.ws.id || 'none')}" style="--c:${esc(g.ws.color)}"><span class="dot"></span>${esc(g.ws.name)} <span class="n">${g.items.length}</span></h2>
      <div class="ov-grid">${g.items.map(t => {
        const i = k++;
        return `<div class="card${i === ov.sel ? ' sel' : ''}${t.active && t.windowId === d.currentWindow ? ' cur' : ''}" draggable="true" data-i="${i}" title="${esc(t.title)}\n${esc(t.url)}">
          <div class="thumb" style="${t.thumb ? `background-image:url('${t.thumb}')` : ''}">${t.thumb ? '' : `<span class="big">${faviconHtml(t.url, t.favicon)}</span>`}</div>
          <div class="meta">${faviconHtml(t.url, t.favicon)}<div class="t"><div>${esc(t.title || t.url)}</div><div class="h">${esc(hostOf(t.url) || t.url)}${t.windowId !== d.currentWindow ? ' · other window' : ''}</div></div></div>
          <button class="x" data-x="${i}" title="Close (Delete)">${icon('close')}</button>
        </div>`;
      }).join('')}</div>
    </section>`).join('');
  const s = body.querySelector('.card.sel');
  if (s) s.scrollIntoView({ block: 'nearest' });
}

async function overviewClose(i) {
  const t = ov.flat[i];
  if (!t) return;
  const fresh = await api.cmd('overlay:closeTab', t.windowId, t.id);
  if (fresh) { data = fresh; renderOverview(); }
}

function overviewOpen(i) {
  const t = ov.flat[i];
  if (t) api.cmd('overlay:activate', t.windowId, t.id);
}

root.addEventListener('click', e => {
  if (mode !== 'overview') return;
  const f = e.target.closest('[data-f]');
  if (f) { ov.filter = f.dataset.f === 'null' ? null : f.dataset.f; ov.sel = 0; renderOverview(); return; }
  const x = e.target.closest('[data-x]');
  if (x) { e.stopPropagation(); overviewClose(Number(x.dataset.x)); return; }
  const c = e.target.closest('.card');
  if (c) overviewOpen(Number(c.dataset.i));
});
root.addEventListener('auxclick', e => { if (mode === 'overview' && e.button === 1) { const c = e.target.closest('.card'); if (c) overviewClose(Number(c.dataset.i)); } });
let ovDrag = null;
root.addEventListener('dragstart', e => { const c = e.target.closest('.card'); if (c && mode === 'overview') { ovDrag = Number(c.dataset.i); c.classList.add('dragging'); e.dataTransfer.setData('text/plain', 'tab'); } });
root.addEventListener('dragend', () => { ovDrag = null; root.querySelectorAll('.dragging,.drop').forEach(n => n.classList.remove('dragging', 'drop')); });
root.addEventListener('dragover', e => { const h = e.target.closest('[data-drop]'); if (h && ovDrag !== null) { e.preventDefault(); root.querySelectorAll('.drop').forEach(n => n.classList.remove('drop')); h.classList.add('drop'); } });
root.addEventListener('drop', async e => {
  const h = e.target.closest('[data-drop]');
  if (!h || ovDrag === null) return;
  e.preventDefault();
  const t = ov.flat[ovDrag];
  data = await api.cmd('overlay:moveTab', t.windowId, t.id, h.dataset.drop);
  renderOverview();
});

function gridColumns() {
  const cards = root.querySelectorAll('.card');
  if (cards.length < 2) return 1;
  const top = cards[0].getBoundingClientRect().top;
  let n = 0;
  for (const c of cards) { if (Math.abs(c.getBoundingClientRect().top - top) < 4) n++; else break; }
  return Math.max(1, n);
}

function wsShortcut(e, apply) {
  if (e.altKey && !e.ctrlKey && /^Digit[0-9]$/.test(e.code)) {
    const n = Number(e.code.slice(5));
    const list = data.workspaces;
    if (e.shiftKey) return false;
    e.preventDefault();
    apply(n === 0 ? 'all' : (list[n - 1] ? list[n - 1].id : undefined));
    return true;
  }
  return false;
}

function overviewKeys(e) {
  const n = ov.flat.length;
  if (wsShortcut(e, id => { if (id !== undefined) { ov.filter = id; ov.sel = 0; renderOverview(); } })) return true;
  if (e.ctrlKey && e.key === 'Tab') {
    e.preventDefault();
    const order = ['all', ...data.workspaces.map(w => w.id)];
    ov.filter = order[(order.indexOf(ov.filter) + (e.shiftKey ? -1 : 1) + order.length) % order.length];
    ov.sel = 0; renderOverview(); return true;
  }
  const cols = gridColumns();
  const move = d => { e.preventDefault(); ov.sel = Math.max(0, Math.min(n - 1, ov.sel + d)); renderOverview(); return true; };
  if (e.key === 'ArrowRight') return move(1);
  if (e.key === 'ArrowLeft' && e.target.value === '') return move(-1);
  if (e.key === 'ArrowDown') return move(cols);
  if (e.key === 'ArrowUp') return move(-cols);
  if (e.key === 'Enter') { e.preventDefault(); overviewOpen(ov.sel); return true; }
  if (e.key === 'Delete') { e.preventDefault(); overviewClose(ov.sel); return true; }
  return false;
}

// =====================================================================
// Ferna Tabs list at the pointer
// =====================================================================
let pt = { q: '', sel: 0, rows: [] };

/** The page controls at the top of the list, shown while Ctrl+Shift+H hides the address bar. */
function pageRowHtml(d) {
  if (!d.layout || d.layout.toolbar || !d.layout.hiddenByKey || d.focus || !d.nav) return '';
  const n = d.nav;
  return `<div class="pop-page" role="group" aria-label="This page">
    <button class="pp" data-pp="back" title="Back"${n.canBack ? '' : ' disabled'}>${icon('back')}</button>
    ${n.canForward ? `<button class="pp" data-pp="forward" title="Forward">${icon('forward')}</button>` : ''}
    <button class="pp" data-pp="reload" title="${n.loading ? 'Stop' : 'Reload'}">${icon(n.loading ? 'close' : 'reload')}</button>
    <button class="pp-url" data-pp="edit" title="Edit the address (Ctrl+L)">${icon(n.secure ? 'lock' : 'globe')}<span>${esc(n.url || 'New tab')}</span></button>
    <button class="pp${n.bookmarked ? ' on' : ''}" data-pp="bookmark" title="${n.bookmarked ? 'Remove bookmark' : 'Bookmark this page'}">${icon('star')}</button>
    <button class="pp" data-pp="more" title="More: split view, picture in picture, passwords, downloads, the menu">${icon('menu')}</button>
  </div>
  <div class="pop-tools" role="group" aria-label="Page tools">${PAGE_TOOLS.map(([k, ic, title]) => {
    const web = !!n.url && !n.internal && /^https?:/.test(n.url);
    const dis = { copy: !n.url || n.url === 'ferna://newtab/', reader: !web, translate: !web, zoom: !!n.internal || !n.url, shield: !/^https?:/.test(n.url || '') }[k];
    const on = { reader: !!n.reader, assistant: d.side === 'assistant' }[k];
    return `<button class="pp${on ? ' on' : ''}" data-pp="${k}" title="${esc(title)}"${dis ? ' disabled' : ''}>${icon(ic)}</button>`;
  }).join('')}</div>`;
}
const PAGE_TOOLS = [
  ['copy', 'copy', 'Copy this address'], ['clear', 'close', 'Clear the address and type a new one'],
  ['reader', 'reader', 'Reading mode'], ['translate', 'translate', 'Translate this page'],
  ['zoom', 'zoom', 'Zoom'], ['shield', 'shield', 'Tracker and ad blocking'],
  ['bookmarks', 'bookmarks', 'Bookmarks'], ['assistant', 'sparkle', 'AI assistant'], ['overview', 'grid', 'Tab Overview'],
];
function editPointerAddress() {
  const q = $('#pt-q');
  if (!q || !data || !data.nav) return;
  pt.editUrl = true;
  q.value = data.nav.url || '';
  q.dispatchEvent(new Event('input'));
  q.focus(); q.select();
  q.placeholder = 'Type an address or search, Enter to go';
}

function listPrefs(d) { return (d && d.settings && d.settings.tabsList) || TabsMatch.cleanListSettings(null); }

/** Size, position and look of the list from its settings (Ferna Tabs 1.16 settings panel). */
function placePointer(d) {
  const pop = $('#pop');
  if (!pop) return;
  const tl = listPrefs(d);
  const W = innerWidth, H = innerHeight;
  const center = d.center || tl.position === 'center';
  const pw = Math.min(Math.max(tl.width, center && d.center ? Math.max(tl.width, 520) : tl.width), W - 16);
  const ph = Math.min(tl.height, H - 16);
  const x = center ? Math.max(8, (W - pw) / 2) : Math.max(8, Math.min(d.x - 24, W - pw - 8));
  const y = center ? Math.max(8, Math.min(80, H - ph - 8)) : Math.max(8, Math.min(d.y - 12, H - ph - 8));
  Object.assign(pop.style, { left: `${x}px`, top: `${y}px`, width: `${pw}px`, maxHeight: `${ph}px`, height: pt.view === 'settings' ? `${ph}px` : '' });
  pop.style.setProperty('--pt-row', `${{ compact: 26, normal: 34, large: 44 }[tl.rows]}px`);
  pop.style.setProperty('--pt-fs', `${tl.fontSize}px`);
  pop.style.setProperty('--pt-ic', `${tl.icons}px`);
  pop.style.setProperty('--pt-font', tl.font ? `"${tl.font}", system-ui, sans-serif` : 'inherit');
  pop.classList.toggle('no-hints', !tl.hints);
}

function openPointer(d) {
  pt = { q: '', raw: '', sel: 0, rows: [], bm: [], bmv: null, editUrl: false, view: 'list', review: null, wsMenu: false, drag: null, dismissed: pt.dismissed || false };
  const tl = listPrefs(d);
  root.innerHTML = `<div class="backdrop clear" data-bg="1"></div>
    <div class="pop" id="pop" role="dialog" aria-label="Open tabs">
      ${tl.pageRow ? pageRowHtml(d) : ''}
      ${tl.extensions ? '<div class="pop-ext" id="pt-ext" role="group" aria-label="Extensions pinned to Ferna Tabs" hidden></div>' : ''}
      <div class="pop-search">${icon('search')}<input id="pt-q" placeholder="Filter tabs and bookmarks, or type to search the web" aria-label="Filter tabs and bookmarks or search"><button class="pop-bm" id="pt-bm" title="Bookmarks (Alt+B)" aria-pressed="false">${icon('bookmarks')}</button><button class="pop-bm" id="pt-set" title="Settings of this list: size, rows, font" aria-pressed="false">${icon('settings')}</button></div>
      <div class="pop-ws" id="pt-ws"></div>
      <div class="pop-wsmenu" id="pt-wsmenu" role="menu" hidden></div>
      <div class="pop-common" id="pt-common"></div>
      <div class="pop-offer" id="pt-offer" hidden></div>
      <div class="pop-list" id="pt-list" role="listbox"></div>
      <div class="pop-foot" id="pt-foot"></div>
    </div>`;
  placePointer(d);
  root.querySelector('[data-bg]').onclick = close;
  const q = $('#pt-q');
  q.focus();
  $('#pt-bm').onclick = () => togglePointerBookmarks();
  $('#pt-set').onclick = () => togglePointerSettings();
  q.addEventListener('input', () => {
    if (pt.bmv) { pt.bmv.setQuery(q.value); return; }
    pt.raw = q.value; pt.q = q.value.toLowerCase().trim(); pt.sel = 0; pt.bm = []; pt.review = null;
    renderPointer();
    const asked = pt.q;
    if (asked) api.cmd('overlay:bookmarks', asked).then(list => { if (pt.q === asked) { pt.bm = list.filter(b => b.url); renderPointer(); } }).catch(() => {});
  });
  keyHandler = pointerKeys;
  renderPointer();
  for (const pr of root.querySelectorAll('.pop-page, .pop-tools')) pr.addEventListener('click', e => {
    const b = e.target.closest('[data-pp]');
    if (!b) return;
    e.stopPropagation();
    const a = b.dataset.pp;
    if (a === 'edit') editPointerAddress();
    else if (a === 'clear') { editPointerAddress(); const qq = $('#pt-q'); qq.value = ''; qq.dispatchEvent(new Event('input')); }
    else if (a === 'more') api.cmd('menu:page-actions');
    else if (PAGE_TOOLS.some(t => t[0] === a)) { const r = b.getBoundingClientRect(); api.cmd('page:tool', a, { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }); }
    else api.cmd('page:act', a).then(() => { if (a === 'bookmark') b.classList.toggle('on'); });
  });
  wirePointerDrag();
  wirePointerExt();
  if (d.editAddress) editPointerAddress();
}

// Extensions pinned to Ferna Tabs (puzzle menu, or right-click an extension → Pin to Ferna Tabs):
// a row of their buttons, so they stay at hand while the toolbar and the tab bar are hidden.
function drawPointerExt(st) {
  const box = $('#pt-ext');
  if (!box) return;
  const list = st && st.ready ? st.tabsActions || [] : [];
  box.hidden = !list.length;
  box.innerHTML = '<span class="px-label">Extensions</span>' + list.map(a => `<button class="pp px" data-px="${esc(a.id)}" title="${esc(a.title)}">${a.icon ? `<img src="${esc(a.icon)}" alt="">` : icon('puzzle')}${a.text ? `<span class="xb" style="${a.color ? `background:${esc(a.color)}` : ''}">${esc(a.text)}</span>` : ''}</button>`).join('');
}
function wirePointerExt() {
  const box = $('#pt-ext');
  if (!box) return;
  const rect = b => { const r = b.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; };
  box.addEventListener('click', e => { const b = e.target.closest('[data-px]'); if (b) { e.stopPropagation(); api.cmd('ext:click', b.dataset.px, rect(b)); } });
  box.addEventListener('contextmenu', e => { const b = e.target.closest('[data-px]'); if (b) { e.preventDefault(); e.stopPropagation(); api.cmd('ext:actionMenu', b.dataset.px, { ...rect(b), place: 'tabs' }); } });
  api.cmd('ext:toolbar').then(drawPointerExt).catch(() => {});
}
api.on('extensions', st => { if (mode === 'pointer') drawPointerExt(st); });

const FOOT_HINTS = '<span><kbd>Enter</kbd> switch · <kbd>Del</kbd> close · <kbd>Ctrl+Z</kbd> reopen · <kbd>Alt+P</kbd> park</span><span><kbd>Alt+S</kbd> pin · <kbd>Alt+Shift+S</kbd> common · <kbd>Alt+1…9</kbd> workspace</span>';
function setFoot(html) { const f = $('#pt-foot'); if (f) f.innerHTML = html == null ? FOOT_HINTS : html; }

function renderPointer() {
  const d = data;
  if (!d || !$('#pop')) return;
  placePointer(d);
  if (pt.view === 'settings') return;
  const tl = listPrefs(d);
  const tabById = id => d.tabs.find(t => t.id === id);
  const names = !!(d.settings && d.settings.wsShowNames);
  $('#pt-ws').innerHTML = [null, ...d.workspaces].map((w, i) => {
    const id = w ? w.id : '';
    const name = w ? w.name : 'All tabs';
    const cur = (d.currentWs || '') === id;
    return `<button class="${cur ? 'on' : ''}${names ? '' : ' ico'}" data-ws="${esc(id)}" title="${esc(name)} (Alt+${i})${cur ? ' — click for this workspace’s actions' : ''}" aria-label="${esc(name)}" style="--c:${w ? esc(w.color) : '#94a3b8'}"><span class="wsi">${w ? wsIconHtml(w) : icon('grid')}</span>${names ? esc(name) : ''}</button>`;
  }).join('');
  const commonOpen = new Set(d.strip.common.filter(c => c.tabId).map(c => c.tabId));
  $('#pt-common').innerHTML = d.strip.common.map(c => `<button class="${c.tabId ? '' : 'closed'}" data-common="${c.index}" title="${esc(c.entry.title || c.entry.url)}">${faviconHtml(c.entry.url, (c.tabId && (tabById(c.tabId) || {}).favicon) || (d.icons || {})[c.entry.url] || '')}${c.badge ? `<span class="badge">${esc(c.badge)}</span>` : ''}</button>`).join('') ||
    '<span class="pop-common-empty">Drag a tab here, or click its ☆, to keep it on the common bar</span>';
  $('#pt-common').style.display = tl.common && !pt.q ? '' : 'none';
  // One offer at a time: duplicate tabs, else tabs you have not used for days.
  const offer = $('#pt-offer');
  const dups = TabsMatch.duplicates(d.tabs, d.activeId);
  const old = TabsMatch.forgotten(d.tabs, tl.forgetDays, d.activeId);
  const copies = dups.reduce((n, g) => n + g.close.length, 0);
  if (tl.offers && !pt.q && !pt.review && !pt.dismissed && (copies || old.length)) {
    offer.hidden = false;
    offer.innerHTML = copies
      ? `<span>${copies} duplicate tab${copies === 1 ? '' : 's'} (the same page open twice)</span><button class="btn small" data-offer="dups">Close the copies</button><button class="x" data-offer="dismiss" title="Not now">${icon('close')}</button>`
      : `<span>${old.length} tab${old.length === 1 ? '' : 's'} not used for ${tl.forgetDays}+ day${tl.forgetDays === 1 ? '' : 's'}</span><button class="btn small" data-offer="review">Review</button><button class="x" data-offer="dismiss" title="Not now">${icon('close')}</button>`;
  } else offer.hidden = true;

  const rows = [];
  if (pt.review) {
    pt.review.map(tabById).filter(Boolean).forEach(t => rows.push({ kind: 'tab', t, old: true }));
  } else if (pt.q) {
    // One ranked list of tabs and bookmarks (initials and gaps match; recent tabs first among equals).
    TabsMatch.rank(pt.raw, d.tabs, pt.bm).forEach(r => rows.push(r.kind === 'tab' ? { kind: 'tab', t: r.item } : { kind: 'bm', b: r.item }));
    const text = pt.raw.trim();
    const search = { kind: 'search', text };
    if (looksLikeAddress(text)) { rows.unshift({ kind: 'go', text }); rows.push(search); }
    else if (!rows.length) rows.unshift(search);
    else rows.push(search);
  } else {
    d.strip.pinned.forEach(p => {
      const t = p.tabId ? tabById(p.tabId) : null;
      rows.push(t ? { kind: 'tab', t, pinned: p } : { kind: 'pin', p });
    });
    d.strip.tabs.forEach(id => { const t = tabById(id); if (t) rows.push({ kind: 'tab', t }); });
    if (tl.closed) (d.closed || []).forEach(c => rows.push({ kind: 'closed', c }));
  }
  pt.rows = rows;
  pt.sel = Math.max(0, Math.min(pt.sel, rows.length - 1));
  const ws = d.workspaces.find(w => w.id === d.currentWs);
  const days = t => Math.max(1, Math.round((Date.now() - (t.lastActive || Date.now())) / 86400e3));
  let html = '';
  let lastSect = null;
  rows.forEach((r, i) => {
    const pin = r.pinned || r.p;
    const sect = pt.review ? `Not used for ${tl.forgetDays}+ days, oldest first` : pt.q ? ({ tab: 'Tabs and bookmarks', bm: 'Tabs and bookmarks', go: 'Web', search: 'Web' })[r.kind]
      : r.kind === 'closed' ? 'Recently closed' : pin ? `Pinned in ${pin.wsId ? (d.workspaces.find(w => w.id === pin.wsId) || {}).name || '' : 'All tabs'}` : (ws ? 'Tabs' : 'All tabs');
    if (sect !== lastSect) {
      html += `<div class="pop-label${pin ? ' pin-zone' : ''}"${pin ? ' data-drop="pin"' : ''}>${esc(sect)}${pt.review && i === 0 ? ' <button class="linkish" data-offer="close-review">Close all of these</button> <button class="linkish" data-offer="end-review">Back to the list</button>' : ''}</div>`;
      lastSect = sect;
    }
    if (r.kind === 'search' || r.kind === 'go') {
      const label = r.kind === 'go' ? `Go to ${r.text}` : `Search ${d.engine ? `with ${d.engine} ` : 'the web '}for “${r.text}”`;
      html += `<div class="row-tab web${i === pt.sel ? ' sel' : ''}" data-i="${i}" role="option" title="Enter: new tab · Shift+Enter: this tab"><span class="wicon">${icon(r.kind === 'go' ? 'globe' : 'search')}</span><span class="t">${esc(label)}</span><span class="st">Enter</span></div>`;
    } else if (r.kind === 'bm') {
      html += `<div class="row-tab${i === pt.sel ? ' sel' : ''}" data-i="${i}" role="option" title="${esc(r.b.url)}">${faviconHtml(r.b.url, '')}<span class="t">${esc(r.b.title || r.b.url)}</span><span class="st">${icon('bookmarks')} ${esc(hostOf(r.b.url))}</span></div>`;
    } else if (r.kind === 'closed') {
      html += `<div class="row-tab closed${i === pt.sel ? ' sel' : ''}" data-i="${i}" role="option" title="Reopen ${esc(r.c.url)}">${faviconHtml(r.c.url, '')}<span class="t">${esc(r.c.title)}</span><span class="st">${i === rows.findIndex(x => x.kind === 'closed') ? 'Ctrl+Z' : 'Reopen'}</span></div>`;
    } else if (r.kind === 'pin') {
      const parked = r.p.pin.parked;
      html += `<div class="row-tab closed${parked ? ' parked' : ''}${i === pt.sel ? ' sel' : ''}" data-i="${i}" data-drop="pin" role="option">${faviconHtml(r.p.pin.url, (d.icons || {})[r.p.pin.url] || '')}<span class="t">${esc(r.p.pin.title || r.p.pin.url)}</span><span class="st">${parked ? esc(TabsMatch.parkedLabel(parked)) : 'Not open'}</span><button class="x act on" data-unpin="${i}" title="Unpin (Alt+S)">${icon('pin')}</button></div>`;
    } else {
      const t = r.t;
      const web = /^(https?|file):/i.test(t.url || '');
      const onCommon = commonOpen.has(t.id);
      html += `<div class="row-tab${i === pt.sel ? ' sel' : ''}${t.id === d.activeId ? ' cur' : ''}" data-i="${i}" role="option" title="${esc(t.url)}"${web ? ' draggable="true"' : ''}${r.pinned ? ' data-drop="pin"' : ''}>${faviconHtml(t.url, t.favicon)}<span class="t">${esc(t.title || t.url)}</span>${r.old ? `<span class="st">${days(t)} d</span>` : ''}${web ? `<button class="x act star${onCommon ? ' on' : ''}" data-star="${i}" title="${onCommon ? 'On the common bar: click to take it off' : 'Add to the common bar'} (Alt+Shift+S)">${icon('star')}</button>${r.pinned ? `<button class="x act on" data-unpin="${i}" title="Unpin (Alt+S)">${icon('pin')}</button>` : `<button class="x act" data-pin="${i}" title="Pin here (Alt+S)">${icon('pin')}</button>`}<button class="x act" data-park="${i}" title="Park: close it, keep it pinned here with today’s date (Alt+P)">${icon('clock')}</button>` : ''}<button class="x" data-x="${i}" title="Close (Delete)">${icon('close')}</button></div>`;
    }
  });
  const S = d.strip;
  if (!pt.q && !pt.review && d.currentWs && S.noWorkspace) html += `<div class="pop-label" style="text-transform:none;letter-spacing:0;cursor:pointer" data-ws="">${S.noWorkspace} tab${S.noWorkspace === 1 ? '' : 's'} in no workspace — show all</div>`;
  $('#pt-list').innerHTML = html || '<div class="empty">No tabs</div>';
  if (!pt.drag) setFoot(null);
  const s = $('#pt-list .sel');
  if (s) s.scrollIntoView({ block: 'nearest' });
}

/** The workspace you are in, clicked again: actions on all its tabs. */
function toggleWsMenu(btn) {
  const m = $('#pt-wsmenu');
  if (!m) return;
  if (!m.hidden) { m.hidden = true; return; }
  const d = data;
  const id = d.currentWs || '';
  const name = id ? (d.workspaces.find(w => w.id === id) || {}).name : 'All tabs';
  const items = [['openAll', 'Open all its pinned sites'], ['close', 'Close these tabs'], ['sleep', 'Put these tabs to sleep']];
  if ((d.windowCount || 1) > 1) items.push(['gather', 'Gather its tabs in this window']);
  m.innerHTML = `<div class="wm-title">${esc(name)}</div>${items.map(([a, l]) => `<button role="menuitem" data-wsact="${a}">${esc(l)}</button>`).join('')}`;
  const r = btn.getBoundingClientRect(), pr = $('#pop').getBoundingClientRect();
  m.style.left = `${Math.max(6, r.left - pr.left)}px`; m.style.top = `${r.bottom - pr.top + 4}px`;
  m.hidden = false;
  const first = m.querySelector('button'); if (first) first.focus();
}

function pointerAct(i, alternate = false) {
  const r = pt.rows[i];
  if (!r) return;
  if (r.kind === 'pin') api.cmd('pinned:open', r.p.wsId || '', r.p.index);
  else if (r.kind === 'closed') api.cmd('tab:reopen', r.c.i);
  // Editing the address of this page: Enter goes there in this tab (Shift+Enter: a new tab).
  else if (pt.editUrl && (r.kind === 'search' || r.kind === 'go')) { if (alternate) api.cmd('overlay:web', r.kind, r.text, true); else api.cmd('page:act', 'go', r.text); }
  else if (r.kind === 'search' || r.kind === 'go') api.cmd('overlay:web', r.kind, r.text, !alternate);
  else if (r.kind === 'bm') api.cmd('overlay:web', 'go', r.b.url, !alternate);
  else api.cmd('tab:activate', r.t.id);
}

/** Close tabs from the list; the note offers Undo for six seconds. */
function closeFromList(ids) {
  const list = [].concat(ids);
  (list.length === 1 ? api.cmd('tab:close', list[0]) : api.cmd('tabs:close', list)).then(() => {
    toast(list.length === 1 ? 'Tab closed' : `${list.length} tabs closed`, { undo: () => { for (let k = 0; k < list.length; k++) api.cmd('tab:reopen', 0); }, ms: 6000 });
  });
}

/** An address rather than search words (same rules as the address bar, roughly). */
function looksLikeAddress(t) {
  if (!t || /\s/.test(t)) return false;
  return /^(https?|file|ferna):\/\/\S+$/i.test(t) || /^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/.*)?$/i.test(t) || /^[^/?#:]+\.[a-z]{2,63}(:\d+)?([/?#].*)?$/i.test(t);
}

root.addEventListener('click', e => {
  if (mode !== 'pointer') return;
  const wa = e.target.closest('[data-wsact]');
  if (wa) {
    e.stopPropagation();
    const a = wa.dataset.wsact;
    $('#pt-wsmenu').hidden = true;
    api.cmd('ws:act', data.currentWs || null, a).then(n => toast(({ openAll: n ? `Opened ${n} pinned site${n === 1 ? '' : 's'}` : 'Every pinned site is already open', close: `${n} tab${n === 1 ? '' : 's'} closed`, sleep: `${n} tab${n === 1 ? '' : 's'} put to sleep`, gather: n ? `${n} tab${n === 1 ? '' : 's'} brought here` : 'No tabs of this workspace in other windows' })[a], a === 'close' && n ? { undo: () => { for (let k = 0; k < Math.min(n, 5); k++) api.cmd('tab:reopen', 0); }, ms: 6000 } : {}));
    return;
  }
  if (!e.target.closest('#pt-wsmenu') && $('#pt-wsmenu') && !$('#pt-wsmenu').hidden && !e.target.closest('[data-ws]')) $('#pt-wsmenu').hidden = true;
  const of = e.target.closest('[data-offer]');
  if (of) {
    e.stopPropagation();
    const a = of.dataset.offer;
    if (a === 'dismiss') { pt.dismissed = true; renderPointer(); }
    else if (a === 'dups') { const ids = TabsMatch.duplicates(data.tabs, data.activeId).flatMap(g => g.close.map(t => t.id)); if (ids.length) closeFromList(ids); }
    else if (a === 'review') { pt.review = TabsMatch.forgotten(data.tabs, listPrefs(data).forgetDays, data.activeId).map(t => t.id); pt.sel = 0; renderPointer(); }
    else if (a === 'close-review') { const ids = (pt.review || []).filter(id => data.tabs.some(t => t.id === id)); pt.review = null; if (ids.length) closeFromList(ids); else renderPointer(); }
    else if (a === 'end-review') { pt.review = null; renderPointer(); }
    return;
  }
  const x = e.target.closest('[data-x]');
  if (x) { e.stopPropagation(); const r = pt.rows[Number(x.dataset.x)]; if (r && r.t) closeFromList(r.t.id); return; }
  const st = e.target.closest('[data-star]');
  if (st) { e.stopPropagation(); const r = pt.rows[Number(st.dataset.star)]; if (r && r.t) api.cmd('tab:common', r.t.id); return; }
  const pn = e.target.closest('[data-pin]');
  if (pn) { e.stopPropagation(); const r = pt.rows[Number(pn.dataset.pin)]; if (r && r.t) api.cmd('tab:pin', r.t.id); return; }
  const pk = e.target.closest('[data-park]');
  if (pk) { e.stopPropagation(); const r = pt.rows[Number(pk.dataset.park)]; if (r && r.t) api.cmd('tab:park', r.t.id).then(ok => { if (ok) toast('Parked: kept pinned here with today’s date'); }); return; }
  const un = e.target.closest('[data-unpin]');
  if (un) { e.stopPropagation(); const r = pt.rows[Number(un.dataset.unpin)]; const p = r && (r.pinned || r.p); if (p) api.cmd('pinned:unpin', p.wsId || '', p.index); return; }
  const w = e.target.closest('[data-ws]');
  if (w) {
    // The workspace you are in, clicked again: its actions.
    if ((w.dataset.ws || '') === (data.currentWs || '') && w.closest('#pt-ws')) { toggleWsMenu(w); return; }
    api.cmd('ws:switch', w.dataset.ws || null); return;
  }
  const c = e.target.closest('[data-common]');
  if (c) { api.cmd('common:open', Number(c.dataset.common)); return; }
  const row = e.target.closest('.row-tab');
  if (row && row.closest('#pt-list')) pointerAct(Number(row.dataset.i));
});

/** Drag a row onto the common bar, a workspace chip or the pinned part of the list. */
function wirePointerDrag() {
  const pop = $('#pop');
  const target = el => el && (el.closest('#pt-common') ? { kind: 'common', el: el.closest('#pt-common') } : el.closest('#pt-ws [data-ws]') ? { kind: 'ws', el: el.closest('[data-ws]') } : el.closest('[data-drop="pin"]') ? { kind: 'pin', el: el.closest('[data-drop="pin"]') } : null);
  const tell = tg => {
    const d = data;
    if (!tg) { setFoot('<span>Drop on the common bar, a workspace, or the pinned sites</span>'); return; }
    const t = d.tabs.find(x => x.id === pt.drag);
    const name = t ? (t.title || t.url) : 'this tab';
    const wsName = id => (id ? (d.workspaces.find(w => w.id === id) || {}).name : 'no workspace') || '';
    setFoot(`<span>${esc(tg.kind === 'common' ? `Add “${name}” to the common bar` : tg.kind === 'ws' ? `Move “${name}” to ${wsName(tg.el.dataset.ws)}` : `Pin “${name}” here`)}</span>`);
  };
  let lit = null;
  const light = tg => { if (lit && (!tg || lit !== tg.el)) lit.classList.remove('drop-on'); lit = tg ? tg.el : null; if (lit) lit.classList.add('drop-on'); };
  pop.addEventListener('dragstart', e => {
    const row = e.target.closest && e.target.closest('.row-tab[draggable="true"]');
    const r = row && pt.rows[Number(row.dataset.i)];
    if (!r || !r.t) { e.preventDefault(); return; }
    pt.drag = r.t.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', r.t.url || '');
    pop.classList.add('dragging');
    tell(null);
  });
  pop.addEventListener('dragover', e => {
    if (!pt.drag) return;
    const tg = target(e.target);
    if (tg) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
    light(tg); tell(tg);
  });
  pop.addEventListener('drop', e => {
    if (!pt.drag) return;
    const tg = target(e.target);
    if (!tg) return;
    e.preventDefault();
    const id = pt.drag;
    if (tg.kind === 'common') api.cmd('tab:to', id, 'common');
    else if (tg.kind === 'pin') api.cmd('tab:to', id, 'pin');
    else api.cmd('tab:ws', id, tg.el.dataset.ws || 'none');
  });
  pop.addEventListener('dragend', () => { pt.drag = null; light(null); pop.classList.remove('dragging'); setFoot(null); });
}

/** Switch the Ferna Tabs list between tabs and the bookmarks browser. */
function togglePointerBookmarks() {
  const q = $('#pt-q');
  const pop = $('#pop');
  if (pt.view === 'settings') togglePointerSettings();
  if (pt.bmv) {
    pt.bmv = null;
    pop.classList.remove('bm-view');
    $('#pt-bm').setAttribute('aria-pressed', 'false');
    $('#pt-list').className = 'pop-list'; $('#pt-list').removeAttribute('tabindex');
    q.placeholder = 'Filter tabs and bookmarks, or type to search the web';
    q.value = ''; pt.q = ''; pt.raw = ''; renderPointer();
  } else {
    pop.classList.add('bm-view');
    $('#pt-bm').setAttribute('aria-pressed', 'true');
    q.placeholder = 'Search bookmarks or the web';
    const host = $('#pt-list');
    host.className = 'pop-list';
    pt.bmv = BMView.create({ api, host, search: q, embedded: true, engine: data.engine, page: null, ...(data.bmFolder ? { folder: data.bmFolder } : {}) });
    if (q.value) pt.bmv.setQuery(q.value);
  }
  q.focus();
}

/** The list's own settings: its size, position, rows, font and what it shows. */
function togglePointerSettings() {
  const pop = $('#pop');
  if (pt.view === 'settings') {
    pt.view = 'list';
    pop.classList.remove('set-view');
    $('#pt-set').setAttribute('aria-pressed', 'false');
    renderPointer();
    $('#pt-q').focus();
    return;
  }
  if (pt.bmv) togglePointerBookmarks();
  pt.view = 'settings';
  pop.classList.add('set-view');
  $('#pt-set').setAttribute('aria-pressed', 'true');
  $('#pt-offer').hidden = true;
  drawPointerSettings();
}
function drawPointerSettings() {
  const tl = listPrefs(data);
  const opt = (v, l, cur) => `<option value="${esc(String(v))}"${String(v) === String(cur) ? ' selected' : ''}>${esc(l)}</option>`;
  const num = (k, lo, hi, step, unit) => `<span class="ps-num"><input type="number" data-ps="${k}" min="${lo}" max="${hi}" step="${step}" value="${tl[k]}"> ${unit}</span>`;
  const chk = (k, l) => `<label class="ps-chk"><input type="checkbox" data-ps="${k}"${tl[k] ? ' checked' : ''}> ${esc(l)}</label>`;
  $('#pt-list').innerHTML = `<div class="ps" role="form" aria-label="Settings of this list">
      <div class="pop-label">Size and place</div>
      <div class="ps-row"><span>Width</span>${num('width', 300, 900, 10, 'px')}</div>
      <div class="ps-row"><span>Height</span>${num('height', 280, 1000, 10, 'px')}</div>
      <div class="ps-row"><span>Opens</span><select data-ps="position">${opt('pointer', 'At the mouse pointer', tl.position)}${opt('center', 'In the middle of the window', tl.position)}</select></div>
      <div class="pop-label">Items</div>
      <div class="ps-row"><span>Row size</span><select data-ps="rows">${opt('compact', 'Compact', tl.rows)}${opt('normal', 'Normal', tl.rows)}${opt('large', 'Large', tl.rows)}</select></div>
      <div class="ps-row"><span>Icon size</span><select data-ps="icons" data-num="1">${[14, 16, 20, 24].map(v => opt(v, `${v} px`, tl.icons)).join('')}</select></div>
      <div class="ps-row"><span>Font</span><select data-ps="font">${TabsMatch.FONTS.map(f => opt(f, f || 'Same as the browser', tl.font)).join('')}</select></div>
      <div class="ps-row"><span>Font size</span>${num('fontSize', 10, 22, 1, 'px')}</div>
      <div class="pop-label">Show</div>
      ${chk('pageRow', 'The page controls while the bars are hidden (Ctrl+Shift+H)')}
      ${chk('extensions', 'Extensions pinned to Ferna Tabs')}
      ${chk('common', 'The common bar')}
      ${chk('closed', 'Recently closed tabs')}
      ${chk('offers', 'Offers to close duplicates and forgotten tabs')}
      <div class="ps-row"><span>Forgotten after</span><select data-ps="forgetDays" data-num="1">${[1, 3, 7, 14, 30].map(v => opt(v, `${v} day${v === 1 ? '' : 's'}`, tl.forgetDays)).join('')}</select></div>
      ${chk('hints', 'Keyboard hints at the bottom')}
      <div class="ps-foot"><button class="btn small" data-ps-reset="1">Reset to defaults</button><button class="btn small primary" data-ps-done="1">Done</button></div>
    </div>`;
  const box = $('#pt-list .ps');
  box.addEventListener('change', e => {
    const el = e.target.closest('[data-ps]');
    if (!el) return;
    const k = el.dataset.ps;
    const v = el.type === 'checkbox' ? el.checked : (el.type === 'number' || el.dataset.num) ? Number(el.value) : el.value;
    saveListPrefs({ ...listPrefs(data), [k]: v }, k === 'pageRow' || k === 'extensions');
  });
  box.addEventListener('click', e => {
    if (e.target.closest('[data-ps-reset]')) saveListPrefs({ ...TabsMatch.LIST_DEFAULTS }, true);
    if (e.target.closest('[data-ps-done]')) togglePointerSettings();
  });
}
function saveListPrefs(v, redraw) {
  api.cmd('tabslist:set', v).then(clean => {
    data = { ...data, settings: { ...(data.settings || {}), tabsList: clean } };
    placePointer(data);
    // The page controls row is part of the list's frame: draw the list again.
    if (redraw) { const d = data; openPointer(d); togglePointerSettings(); } else if (pt.view === 'settings') drawPointerSettings();
  });
}

function pointerKeys(e) {
  if (pt.view === 'settings') {
    if (e.key === 'Escape') { e.preventDefault(); togglePointerSettings(); return true; }
    return false;
  }
  const m = $('#pt-wsmenu');
  if (m && !m.hidden) {
    if (e.key === 'Escape') { e.preventDefault(); m.hidden = true; $('#pt-q').focus(); return true; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const b = [...m.querySelectorAll('button')]; const i = b.indexOf(document.activeElement);
      b[(i + (e.key === 'ArrowDown' ? 1 : -1) + b.length) % b.length].focus();
      return true;
    }
    return false;
  }
  if (e.altKey && !e.ctrlKey && !e.shiftKey && e.code === 'KeyB') { e.preventDefault(); togglePointerBookmarks(); return true; }
  if (pt.bmv) return pt.bmv.keys(e);
  const n = pt.rows.length;
  if (pt.review && e.key === 'Escape') { e.preventDefault(); pt.review = null; renderPointer(); return true; }
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'KeyZ' && !(e.target && e.target.id === 'pt-q' && e.target.value)) { e.preventDefault(); api.cmd('tab:reopen', 0); return true; }
  if (e.altKey && e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
    e.preventDefault();
    const w = data.workspaces[Number(e.code.slice(5)) - 1];
    const r = pt.rows[pt.sel];
    if (w && r && r.t) api.cmd('tab:ws', r.t.id, w.id).catch(() => {});
    return true;
  }
  if (wsShortcut(e, id => { if (id !== undefined) api.cmd('ws:switch', id === 'all' ? null : id); })) return true;
  if (e.ctrlKey && e.key === 'Tab') {
    e.preventDefault();
    const order = [null, ...data.workspaces.map(w => w.id)];
    api.cmd('ws:switch', order[(order.indexOf(data.currentWs) + (e.shiftKey ? -1 : 1) + order.length) % order.length]);
    return true;
  }
  if (e.key === 'ArrowDown') { e.preventDefault(); pt.sel = Math.min(n - 1, pt.sel + 1); renderPointer(); return true; }
  if (e.key === 'ArrowUp') { e.preventDefault(); pt.sel = Math.max(0, pt.sel - 1); renderPointer(); return true; }
  if (e.key === 'Enter') { e.preventDefault(); pointerAct(pt.sel, e.shiftKey); return true; }
  if (e.key === 'Delete') {
    // In the search box, Delete deletes text while there is text after the cursor (or selected).
    const q = e.target && e.target.id === 'pt-q' ? e.target : null;
    if (q && q.value && (q.selectionStart < q.value.length || q.selectionStart !== q.selectionEnd)) return false;
    e.preventDefault(); const r = pt.rows[pt.sel]; if (r && r.t) closeFromList(r.t.id); return true;
  }
  // Alt+P parks the selected tab (closes it, keeps it pinned here with the date).
  if (e.altKey && !e.ctrlKey && !e.shiftKey && e.code === 'KeyP') {
    e.preventDefault();
    const r = pt.rows[pt.sel];
    if (r && r.t) api.cmd('tab:park', r.t.id).then(ok => { if (ok) toast('Parked: kept pinned here with today’s date'); });
    return true;
  }
  // As in Ferna Tabs: Alt+S pins the selected tab here (or unpins it), Alt+Shift+S puts it on the common bar.
  if (e.altKey && !e.ctrlKey && e.code === 'KeyS') {
    e.preventDefault();
    const r = pt.rows[pt.sel];
    if (r && r.kind === 'pin' && !e.shiftKey) api.cmd('pinned:unpin', r.p.wsId || '', r.p.index);
    else if (r && r.t) api.cmd(e.shiftKey ? 'tab:common' : 'tab:pin', r.t.id);
    return true;
  }
  return false;
}

// =====================================================================
// Command palette (Ctrl+K)
// =====================================================================
const COMMANDS = [
  ['newTab', 'New tab', 'Ctrl+T'], ['newWindow', 'New window', 'Ctrl+N'], ['privateWindow', 'New private window', 'Ctrl+Shift+N'],
  ['tabOverview', 'Tab Overview', 'Ctrl+Shift+A'], ['toggleTabBar', 'Hide/unhide tab bar', 'Ctrl+Shift+H'],
  ['toggleBookmarksBar', 'Hide/unhide bookmarks bar', 'Ctrl+Shift+B'], ['cycleTabPosition', 'Move tab bar (top / left / right)', 'Ctrl+Shift+,'],
  ['collapseTabs', 'Collapse vertical tab bar', 'Ctrl+Shift+\\'], ['focusMode', 'Focus mode', 'Ctrl+Shift+F'],
  ['zoomIn', 'Zoom in', 'Ctrl+='], ['zoomOut', 'Zoom out', 'Ctrl+−'], ['zoomReset', 'Reset zoom', 'Ctrl+0'],
  ['history', 'History', 'Ctrl+H'], ['downloads', 'Downloads', 'Ctrl+J'], ['bookmarkManager', 'Bookmarks', 'Ctrl+Shift+O'],
  ['find', 'Find in page', 'Ctrl+F'], ['reopenTab', 'Reopen closed tab', 'Ctrl+Shift+T'], ['print', 'Print', 'Ctrl+P'],
  ['devtools', 'Developer tools', 'F12'], ['settings', 'Settings', ''], ['nextWorkspace', 'Next workspace', 'Alt+Shift+.'],
];
let pal = { q: '', sel: 0, items: [], seq: 0 };

function openPalette(d) {
  pal = { q: '', sel: 0, items: [], seq: 0 };
  root.innerHTML = `<div class="backdrop" data-bg="1"></div>
    <div class="pal" role="dialog" aria-label="Command palette">
      <div class="pal-in">${icon('search')}<input id="pal-q" placeholder="Search tabs, bookmarks, history and commands — or type an address" aria-label="Command palette"></div>
      <div class="pal-list" id="pal-list"></div>
    </div>`;
  root.querySelector('[data-bg]').onclick = close;
  const q = $('#pal-q');
  q.focus();
  q.addEventListener('input', () => { pal.q = q.value; pal.sel = 0; refreshPalette(); });
  keyHandler = paletteKeys;
  refreshPalette();
}

async function refreshPalette() {
  const seq = ++pal.seq;
  const q = pal.q.trim();
  const s = q.toLowerCase();
  const items = [];
  if (q) items.push({ sec: 'Go', title: /\s/.test(q) || !q.includes('.') ? `Search the web for “${q}”` : `Go to ${q}`, sub: '', icon: 'search', act: () => api.cmd('overlay:open', q) });
  const tabs = data.tabs.filter(t => !s || (t.title || '').toLowerCase().includes(s) || (t.url || '').toLowerCase().includes(s)).slice(0, 8);
  tabs.forEach(t => items.push({ sec: 'Open tabs', title: t.title || t.url, sub: hostOf(t.url), fav: [t.url, t.favicon], act: () => api.cmd('overlay:activate', t.windowId, t.id) }));
  COMMANDS.filter(c => !s || c[1].toLowerCase().includes(s)).slice(0, s ? 6 : 8)
    .forEach(c => items.push({ sec: 'Commands', title: c[1], sub: c[2], icon: 'layers', act: () => { close(); api.cmd('run', c[0]); } }));
  const [bms, hist] = await Promise.all([api.cmd('overlay:bookmarks', q), q ? api.cmd('overlay:history', q) : Promise.resolve([])]);
  if (seq !== pal.seq) return;
  bms.slice(0, 5).forEach(b => items.push({ sec: 'Bookmarks', title: b.title || b.url, sub: hostOf(b.url), fav: [b.url, ''], act: () => api.cmd('overlay:open', b.url) }));
  hist.slice(0, 6).forEach(h => items.push({ sec: 'History', title: h.title || h.url, sub: hostOf(h.url), fav: [h.url, ''], act: () => api.cmd('overlay:open', h.url) }));
  pal.items = items;
  pal.sel = Math.min(pal.sel, Math.max(0, items.length - 1));
  renderPalette();
}

function renderPalette() {
  let last = null;
  $('#pal-list').innerHTML = pal.items.map((it, i) => {
    const head = it.sec !== last ? `<div class="pal-sec">${esc(it.sec)}</div>` : '';
    last = it.sec;
    const lead = it.fav ? faviconHtml(it.fav[0], it.fav[1]) : icon(it.icon);
    return `${head}<div class="pal-item${i === pal.sel ? ' sel' : ''}" data-p="${i}">${lead}<span class="t">${esc(it.title)}</span><span class="s">${esc(it.sub)}</span></div>`;
  }).join('') || '<div class="empty">Nothing found</div>';
  const s = $('#pal-list .sel');
  if (s) s.scrollIntoView({ block: 'nearest' });
}

root.addEventListener('click', e => {
  if (mode !== 'palette') return;
  const it = e.target.closest('[data-p]');
  if (it) pal.items[Number(it.dataset.p)].act();
});

function paletteKeys(e) {
  const n = pal.items.length;
  if (e.key === 'ArrowDown') { e.preventDefault(); pal.sel = Math.min(n - 1, pal.sel + 1); renderPalette(); return true; }
  if (e.key === 'ArrowUp') { e.preventDefault(); pal.sel = Math.max(0, pal.sel - 1); renderPalette(); return true; }
  if (e.key === 'Enter') { e.preventDefault(); const it = pal.items[pal.sel]; if (it) it.act(); return true; }
  return false;
}

// =====================================================================
// Prompt (new workspace, rename)
// =====================================================================
function openPrompt(d) {
  root.innerHTML = `<div class="backdrop" data-bg="1"></div>
    <form class="dlg" id="dlg">
      <h2>${esc(d.title)}</h2>
      <label for="dlg-in">${esc(d.label)}</label>
      <input class="field" id="dlg-in" maxlength="40" value="${esc(d.value)}" autocomplete="off">
      <div class="acts"><button type="button" class="btn" id="dlg-cancel">Cancel</button><button class="btn primary" type="submit">OK</button></div>
    </form>`;
  const input = $('#dlg-in');
  input.focus();
  input.select();
  root.querySelector('[data-bg]').onclick = () => api.cmd('overlay:prompt', null);
  $('#dlg-cancel').onclick = () => api.cmd('overlay:prompt', null);
  $('#dlg').onsubmit = e => { e.preventDefault(); api.cmd('overlay:prompt', { action: d.action, id: d.id || null, value: input.value }); };
}

// =====================================================================
// Zoom panel (Alt+Z): the page zoom, remembered per site, like Chrome
// =====================================================================
let zp = null;

function openZoom(d) {
  zp = d;
  const W = innerWidth;
  const pw = 280;
  const x = Math.max(8, Math.min(d.anchor.x + d.anchor.width - pw, W - pw - 8));
  const y = d.anchor.y + d.anchor.height + 6;
  root.innerHTML = `<div class="backdrop clear" data-bg="1"></div>
    <div class="zpanel" id="zpanel" style="left:${x}px;top:${y}px;width:${pw}px" role="dialog" aria-label="Zoom">
      <div class="zp-row" id="zp-zoom" title="Scroll here to zoom">
        <button class="zbtn" data-z="out" title="Zoom out (Ctrl+−)" aria-label="Zoom out">−</button>
        <output class="zp-pct" id="zp-level" aria-live="polite"></output>
        <button class="zbtn" data-z="in" title="Zoom in (Ctrl++)" aria-label="Zoom in">+</button>
        <button class="btn small" data-z="reset" title="Back to the default size (Ctrl+0)">Reset</button>
      </div>
      <div class="zp-foot"><span id="zp-scope"></span><a href="#" id="zp-settings">Zoom settings</a></div>
    </div>`;
  root.querySelector('[data-bg]').onclick = close;
  renderZoom();
  $('#zpanel').addEventListener('click', e => { const b = e.target.closest('[data-z]'); if (b) zoomDo(b.dataset.z); });
  $('#zp-zoom').addEventListener('wheel', e => { e.preventDefault(); zoomDo(e.deltaY < 0 ? 'in' : 'out'); }, { passive: false });
  $('#zp-settings').onclick = e => { e.preventDefault(); close(); api.cmd('run', 'settings'); };
  keyHandler = e => {
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomDo('in'); return true; }
    if (e.key === '-') { e.preventDefault(); zoomDo('out'); return true; }
    if (e.key === '0') { e.preventDefault(); zoomDo('reset'); return true; }
    return false;
  };
  setTimeout(() => { const b = root.querySelector('[data-z="in"]'); if (b) b.focus(); }, 0);
}

async function zoomDo(action, value) {
  const r = await api.cmd('zoom:act', action, value === undefined ? null : value);
  if (r) { zp = { ...zp, ...r }; renderZoom(); }
}

function renderZoom() {
  if (!zp || !$('#zpanel')) return;
  $('#zp-level').textContent = `${zp.level}%`;
  $('#zp-scope').textContent = zp.private ? 'This private window only' : zp.site ? `Remembered for ${zp.site}` : '';
}

// =====================================================================
// Screen sharing: the site asked to share your screen (video calls, presentations)
// =====================================================================
function openShare(d) {
  const kinds = [['screen', 'Entire screen'], ['window', 'Window'], ['tab', 'Tab']].filter(([k]) => d.items.some(i => i.kind === k));
  let kind = kinds.length ? kinds[0][0] : 'screen';
  let sel = null;
  root.innerHTML = `<div class="backdrop" data-bg="1"></div>
    <div class="dlg share" role="dialog" aria-modal="true" aria-labelledby="sh-t">
      <h2 id="sh-t">${esc(d.origin || 'This site')} wants to share your screen</h2>
      <p class="muted">Choose what to share. Nothing is shared until you click Share.</p>
      <div class="sh-kinds" role="tablist">${kinds.map(([k, l]) => `<button role="tab" data-kind="${k}">${l}</button>`).join('')}</div>
      <div class="sh-grid" id="sh-grid" role="listbox" aria-label="What to share"></div>
      <div class="sh-foot">
        ${d.audio ? `<label class="sh-audio" id="sh-audio-l"><input type="checkbox" id="sh-audio" checked> <span id="sh-audio-t">Share sound</span></label>` : '<span></span>'}
        <span><button class="btn" id="sh-cancel">Cancel</button> <button class="btn primary" id="sh-ok" disabled>Share</button></span>
      </div>
    </div>`;
  const draw = () => {
    root.querySelectorAll('[data-kind]').forEach(b => { b.classList.toggle('on', b.dataset.kind === kind); b.setAttribute('aria-selected', String(b.dataset.kind === kind)); });
    const list = d.items.filter(i => i.kind === kind);
    $('#sh-grid').innerHTML = list.map(i => `<button class="sh-item${sel === i.id ? ' on' : ''}" role="option" aria-selected="${sel === i.id}" data-id="${esc(i.id)}" title="${esc(i.name)}">
        <span class="sh-th">${i.thumb ? `<img src="${esc(i.thumb)}" alt="">` : ''}</span>
        <span class="sh-name">${i.icon ? `<img class="sh-ic" src="${esc(i.icon)}" alt="">` : ''}<span>${esc(i.name)}</span></span></button>`).join('') || '<p class="muted">Nothing to share here.</p>';
    $('#sh-ok').disabled = !sel || !d.items.some(i => i.id === sel && i.kind === kind);
    const al = $('#sh-audio-l');
    if (al) {
      // Sound: of a tab; of the whole computer when sharing a screen on Windows.
      const can = kind === 'tab' || (kind === 'screen' && d.loopback);
      al.hidden = !can;
      $('#sh-audio-t').textContent = kind === 'tab' ? 'Share tab sound' : 'Share system sound';
    }
  };
  draw();
  root.querySelector('[data-bg]').onclick = () => api.cmd('share:pick', null, false);
  root.querySelector('.sh-kinds').onclick = e => { const b = e.target.closest('[data-kind]'); if (b) { kind = b.dataset.kind; sel = null; draw(); } };
  $('#sh-grid').addEventListener('click', e => { const b = e.target.closest('[data-id]'); if (b) { sel = b.dataset.id; draw(); } });
  $('#sh-grid').addEventListener('dblclick', e => { const b = e.target.closest('[data-id]'); if (b) { sel = b.dataset.id; go(); } });
  const go = () => { if (!sel) return; const a = $('#sh-audio'); api.cmd('share:pick', sel, !!(a && a.checked && !$('#sh-audio-l').hidden)); };
  $('#sh-ok').onclick = go;
  $('#sh-cancel').onclick = () => api.cmd('share:pick', null, false);
  keyHandler = e => {
    if (e.key === 'Enter' && sel) { e.preventDefault(); go(); return true; }
    return false;
  };
  setTimeout(() => { const b = root.querySelector('[data-kind]'); if (b) b.focus(); }, 0);
}

// =====================================================================
// Bookmarks popup (Ease Bookmarks style), from the toolbar or Ctrl+Shift+Y
// =====================================================================
let bmPop = null;
function openBookmarks(d) {
  const W = innerWidth, H = innerHeight;
  const pw = Math.min(400, W - 16), ph = Math.min(560, H - d.anchor.y - d.anchor.height - 16);
  const x = Math.max(8, Math.min(d.anchor.x + d.anchor.width - pw, W - pw - 8));
  const y = d.anchor.y + d.anchor.height + 6;
  root.innerHTML = `<div class="backdrop clear" data-bg="1"></div>
    <div class="pop bm-pop" id="bm-pop" style="left:${x}px;top:${y}px;width:${pw}px;height:${Math.max(260, ph)}px" role="dialog" aria-label="Bookmarks"></div>`;
  root.querySelector('[data-bg]').onclick = close;
  bmPop = BMView.create({ api, host: $('#bm-pop'), folder: d.folder, page: d.page, engine: d.engine, manage: true, toast: t => toast(t) });
  keyHandler = e => bmPop.keys(e);
  setTimeout(() => bmPop.focus(), 0);
}

function toast(text, { undo = null, ms = 0 } = {}) {
  let t = $('#ov-toast');
  if (!t) { t = document.createElement('div'); t.id = 'ov-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = text;
  t.classList.toggle('has-undo', !!undo);
  if (undo) { const b = document.createElement('button'); b.textContent = 'Undo'; b.onclick = () => { t.classList.remove('on'); undo(); }; t.append(' ', b); }
  t.classList.add('on');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('on'), ms || 2200);
}

// =====================================================================
// Link preview (Shift+click a link): the page floats above the current one
// =====================================================================
function openPeek(d) {
  root.innerHTML = `<div class="backdrop peek-bg" data-bg="1"></div>
    <div class="peek-head" id="peek-head">
      <span class="peek-title" id="peek-title"></span><span class="peek-url" id="peek-url"></span>
      <button class="btn small" data-how="tab" title="Keep it: open in a new tab">${icon('plus')} Open in tab</button>
      <button class="btn small" data-how="split" title="Open next to this page">${icon('split')} Split view</button>
      <button class="btn small" data-how="window">${icon('arrow')} New window</button>
      <button class="tb" id="peek-x" title="Close (Esc)">${icon('close')}</button>
    </div>`;
  root.querySelector('[data-bg]').onclick = close;
  $('#peek-x').onclick = close;
  root.querySelectorAll('[data-how]').forEach(b => { b.onclick = () => api.cmd('peek:open-as', b.dataset.how); });
  updatePeek(d);
}
function updatePeek(d) {
  if (!d) return;
  const h = $('#peek-head');
  if (!h) return;
  if (d.rect) Object.assign(h.style, { left: `${d.rect.x}px`, top: `${d.rect.y - 44}px`, width: `${d.rect.width}px` });
  $('#peek-title').textContent = d.title || 'Loading…';
  $('#peek-url').textContent = hostOf(d.url || '') || d.url || '';
}

// =====================================================================
// Media controls: everything playing, in every window
// =====================================================================
let mediaP = null;
function openMedia(d) {
  mediaP = d;
  const W = innerWidth;
  const pw = Math.min(380, W - 16);
  const x = Math.max(8, Math.min(d.anchor.x + d.anchor.width - pw, W - pw - 8));
  const y = d.anchor.y + d.anchor.height + 6;
  root.innerHTML = `<div class="backdrop clear" data-bg="1"></div>
    <div class="zpanel mediap" id="mediap" style="left:${x}px;top:${y}px;width:${pw}px" role="dialog" aria-label="Media controls"></div>`;
  root.querySelector('[data-bg]').onclick = close;
  renderMedia(d.items);
  clearInterval(openMedia.t);
  openMedia.t = setInterval(async () => { if (mode !== 'media') { clearInterval(openMedia.t); return; } renderMedia(await api.cmd('media:list')); }, 1500);
}
function fmtTime(s) { s = Math.round(s || 0); const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, '0')}`; }
function renderMedia(items) {
  const p = $('#mediap');
  if (!p) return;
  if (!items || !items.length) { p.innerHTML = '<div class="muted" style="padding:16px">Nothing is playing.</div>'; return; }
  p.innerHTML = `<div class="zp-label" style="margin-bottom:8px">Playing in your tabs</div>` + items.map(m => `
    <div class="media-item" data-w="${m.windowId}" data-t="${m.tabId}">
      <div class="mi-head" data-a="go" title="Go to this tab">${faviconHtml(m.url, m.favicon)}<div class="mi-txt"><div class="mi-title">${esc(m.title || m.tabTitle)}</div><div class="mi-sub">${esc([m.artist, hostOf(m.url)].filter(Boolean).join(' · '))}${m.duration ? ` · ${fmtTime(m.time)} / ${fmtTime(m.duration)}` : ''}</div></div></div>
      <div class="mi-ctl">
        <button class="tb small" data-a="back" title="Back 10 s">${icon('undo')}</button>
        <button class="tb mi-play" data-a="toggle" title="${m.playing ? 'Pause' : 'Play'}">${icon(m.playing ? 'pause' : 'play')}</button>
        <button class="tb small" data-a="forward" title="Forward 10 s">${icon('redo')}</button>
        <button class="tb small${m.muted ? ' on' : ''}" data-a="mute" title="${m.muted ? 'Unmute tab' : 'Mute tab'}">${icon(m.muted ? 'muted' : 'audio')}</button>
        ${m.video ? `<button class="tb small${m.pip ? ' on' : ''}" data-a="pip" title="Picture-in-Picture">${icon('pip')}</button>` : ''}
      </div>
    </div>`).join('');
  p.onclick = async e => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const it = b.closest('.media-item');
    const r = await api.cmd('media:act', Number(it.dataset.w), Number(it.dataset.t), b.dataset.a);
    if (r) renderMedia(r);
  };
}

// =====================================================================
// Save / update password bubble
// =====================================================================
function openPwSave(d) {
  const W = innerWidth;
  const pw = Math.min(380, W - 16);
  const x = Math.max(8, Math.min(d.anchor.x + d.anchor.width - pw, W - pw - 8));
  const y = d.anchor.y + d.anchor.height + 6;
  root.innerHTML = `<div class="backdrop clear" data-bg="1"></div>
    <div class="zpanel pwsave" style="left:${x}px;top:${y}px;width:${pw}px" role="dialog" aria-label="Save password">
      <div class="pw-h">${icon('key')}<b>${d.update ? 'Update password' : 'Save password'} for ${esc(d.host)}?</b></div>
      <label class="pw-l">Username<input id="pw-u" value="${esc(d.username)}" spellcheck="false"></label>
      <label class="pw-l">Password<span class="pw-row"><input id="pw-p" type="password" value="${esc(d.password)}" readonly><button class="tb small" id="pw-eye" title="Show">${icon('peek')}</button></span></label>
      <div class="pw-b">${d.update ? '' : '<button class="btn small" data-a="never">Never for this site</button>'}<span style="flex:1"></span><button class="btn small" data-a="later">Not now</button><button class="btn small primary" data-a="save">${d.update ? 'Update' : 'Save'}</button></div>
      <div class="muted" style="font-size:11px;margin-top:8px">Saved encrypted on this PC. Manage in Menu → Passwords and autofill.</div>
    </div>`;
  root.querySelector('[data-bg]').onclick = () => { api.cmd('pw:answer', d.token, 'later'); };
  $('#pw-eye').onclick = () => { const p = $('#pw-p'); p.type = p.type === 'password' ? 'text' : 'password'; };
  root.querySelectorAll('[data-a]').forEach(b => { b.onclick = () => api.cmd('pw:answer', d.token, b.dataset.a, $('#pw-u').value); });
  keyHandler = e => { if (e.key === 'Enter') { api.cmd('pw:answer', d.token, 'save', $('#pw-u').value); return true; } if (e.key === 'Escape') { api.cmd('pw:answer', d.token, 'later'); return true; } };
  setTimeout(() => root.querySelector('[data-a=save]').focus(), 0);
}

// =====================================================================
// Password prompts: end the exam (invigilator) and parental controls (parent)
// =====================================================================
function passwordBox({ title, text, cmd, cancel }) {
  root.innerHTML = `<div class="backdrop" data-bg="1"></div>
    <div class="zpanel pwbox" role="dialog" aria-label="${esc(title)}" style="left:50%;top:30%;transform:translateX(-50%);width:min(380px,calc(100vw - 32px))">
      <div class="pw-h">${icon('lock')}<b>${esc(title)}</b></div>
      <p class="muted" style="margin:4px 0 10px">${esc(text)}</p>
      <input type="password" id="pwb" autocomplete="off" style="width:100%;padding:8px 10px;border:1px solid var(--line-strong);border-radius:8px;background:var(--bg)">
      <div class="pw-msg" id="pwb-msg" style="color:var(--danger);font-size:12px;min-height:18px;margin-top:4px"></div>
      <div class="pw-b"><span style="flex:1"></span><button class="btn small" id="pwb-x">Cancel</button><button class="btn small primary" id="pwb-ok">OK</button></div>
    </div>`;
  const go = async () => {
    const ok = await api.cmd(cmd, $('#pwb').value);
    if (!ok) { $('#pwb-msg').textContent = 'Wrong password.'; $('#pwb').value = ''; $('#pwb').focus(); }
  };
  const no = () => (cancel ? api.cmd(cancel) : close());
  $('#pwb-ok').onclick = go;
  $('#pwb-x').onclick = no;
  keyHandler = e => { if (e.key === 'Enter') { go(); return true; } if (e.key === 'Escape') { no(); return true; } };
  setTimeout(() => $('#pwb').focus(), 0);
}
function openExamPw(d) { passwordBox({ title: `End “${d.title}”`, text: 'The invigilator enters the exam password to end the exam and unlock this PC.', cmd: 'exam:unlock' }); }
function openParentPw(d) { passwordBox({ title: 'Parent password needed', text: `Parental controls are on. A parent or guardian must enter the password to ${d.what || 'do this'}.`, cmd: 'parental:answer', cancel: 'parental:cancel' }); }
