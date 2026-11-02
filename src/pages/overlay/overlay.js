// Ferna Sundaree — overlay: Tab Overview, Ferna Tabs list at the pointer,
// command palette, screenshot region picker and small prompts.
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
  ({ overview: openOverview, pointer: openPointer, palette: openPalette, region: openRegion, prompt: openPrompt, zoom: openZoom, bookmarks: openBookmarks, eq: openEq, peek: openPeek, media: openMedia, pwsave: openPwSave, exampw: openExamPw, parentpw: openParentPw })[mode](data);
});
api.on('state', s => { if (mode === 'pointer') { data = { ...data, ...s }; if (!pt.bmv) renderPointer(); } });

document.addEventListener('keydown', e => {
  if (keyHandler && keyHandler(e) === true) return;
  if (e.key === 'Escape') { e.preventDefault(); if (mode === 'region') api.cmd('overlay:region', null); else close(); }
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

function openPointer(d) {
  pt = { q: '', raw: '', sel: 0, rows: [], bm: [], bmv: null };
  const W = innerWidth;
  const H = innerHeight;
  const pw = Math.min(380, W - 16);
  const ph = Math.min(520, H - 16);
  const x = Math.max(8, Math.min(d.x - 24, W - pw - 8));
  const y = Math.max(8, Math.min(d.y - 12, H - ph - 8));
  root.innerHTML = `<div class="backdrop clear" data-bg="1"></div>
    <div class="pop" id="pop" style="left:${x}px;top:${y}px;width:${pw}px;max-height:${ph}px" role="dialog" aria-label="Open tabs">
      <div class="pop-search">${icon('search')}<input id="pt-q" placeholder="Filter tabs, or type to search the web" aria-label="Filter tabs or search"><button class="pop-bm" id="pt-bm" title="Bookmarks (Alt+B)" aria-pressed="false">${icon('bookmarks')}</button></div>
      <div class="pop-ws" id="pt-ws"></div>
      <div class="pop-common" id="pt-common"></div>
      <div class="pop-list" id="pt-list" role="listbox"></div>
      <div class="pop-foot"><span><kbd>Enter</kbd> switch · <kbd>Del</kbd> close · <kbd>Alt+1…9</kbd> workspace · <kbd>Alt+B</kbd> bookmarks</span><span><kbd>Alt+S</kbd> pin · <kbd>Alt+Shift+S</kbd> common · <kbd>Alt+Shift+1…9</kbd> move</span></div>
    </div>`;
  root.querySelector('[data-bg]').onclick = close;
  const q = $('#pt-q');
  q.focus();
  $('#pt-bm').onclick = () => togglePointerBookmarks();
  q.addEventListener('input', () => {
    if (pt.bmv) { pt.bmv.setQuery(q.value); return; }
    pt.raw = q.value; pt.q = q.value.toLowerCase().trim(); pt.sel = 0; pt.bm = [];
    renderPointer();
    const asked = pt.q;
    if (asked) api.cmd('overlay:bookmarks', asked).then(list => { if (pt.q === asked) { pt.bm = list.filter(b => b.url); renderPointer(); } }).catch(() => {});
  });
  keyHandler = pointerKeys;
  renderPointer();
}

function renderPointer() {
  const d = data;
  if (!d || !$('#pop')) return;
  const tabById = id => d.tabs.find(t => t.id === id);
  const names = !!(d.settings && d.settings.wsShowNames);
  $('#pt-ws').innerHTML = [null, ...d.workspaces].map((w, i) => {
    const id = w ? w.id : '';
    const name = w ? w.name : 'All tabs';
    return `<button class="${(d.currentWs || '') === id ? 'on' : ''}${names ? '' : ' ico'}" data-ws="${esc(id)}" title="${esc(name)} (Alt+${i})" aria-label="${esc(name)}" style="--c:${w ? esc(w.color) : '#94a3b8'}"><span class="wsi">${w ? wsIconHtml(w) : icon('grid')}</span>${names ? esc(name) : ''}</button>`;
  }).join('');
  $('#pt-common').innerHTML = d.strip.common.map(c => `<button class="${c.tabId ? '' : 'closed'}" data-common="${c.index}" title="${esc(c.entry.title || c.entry.url)}">${faviconHtml(c.entry.url, c.tabId ? (tabById(c.tabId) || {}).favicon : '')}${c.badge ? `<span class="badge">${esc(c.badge)}</span>` : ''}</button>`).join('');
  $('#pt-common').style.display = d.strip.common.length ? '' : 'none';
  const match = (title, url) => !pt.q || (title || '').toLowerCase().includes(pt.q) || (url || '').toLowerCase().includes(pt.q);
  const rows = [];
  // While filtering, search every tab; otherwise follow the three-part split.
  if (pt.q) {
    // Smart fallback (as in Ferna Tabs): open tabs first, then bookmarks; an address gets
    // "Go to" at the top; other text gets "Search the web", at the top when nothing matched.
    d.tabs.filter(t => match(t.title, t.url)).forEach(t => rows.push({ kind: 'tab', t }));
    (pt.bm || []).filter(b => !rows.some(r => r.t && r.t.url === b.url)).forEach(b => rows.push({ kind: 'bm', b }));
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
  }
  pt.rows = rows;
  pt.sel = Math.max(0, Math.min(pt.sel, rows.length - 1));
  const ws = d.workspaces.find(w => w.id === d.currentWs);
  let html = '';
  let lastSect = null;
  rows.forEach((r, i) => {
    const pin = r.pinned || r.p;
    const sect = pt.q ? ({ tab: 'Open tabs', bm: 'Bookmarks', go: 'Web', search: 'Web' })[r.kind] : pin ? `Pinned in ${pin.wsId ? (d.workspaces.find(w => w.id === pin.wsId) || {}).name || '' : 'All tabs'}` : (ws ? 'Tabs' : 'All tabs');
    if (sect !== lastSect) { html += `<div class="pop-label">${esc(sect)}</div>`; lastSect = sect; }
    if (r.kind === 'search' || r.kind === 'go') {
      const label = r.kind === 'go' ? `Go to ${r.text}` : `Search ${d.engine ? `with ${d.engine} ` : 'the web '}for “${r.text}”`;
      html += `<div class="row-tab web${i === pt.sel ? ' sel' : ''}" data-i="${i}" role="option" title="Enter: new tab · Shift+Enter: this tab"><span class="wicon">${icon(r.kind === 'go' ? 'globe' : 'search')}</span><span class="t">${esc(label)}</span><span class="st">Enter</span></div>`;
    } else if (r.kind === 'bm') {
      html += `<div class="row-tab${i === pt.sel ? ' sel' : ''}" data-i="${i}" role="option" title="${esc(r.b.url)}">${faviconHtml(r.b.url, '')}<span class="t">${esc(r.b.title || r.b.url)}</span><span class="st">${esc(hostOf(r.b.url))}</span></div>`;
    } else if (r.kind === 'pin') {
      html += `<div class="row-tab closed${i === pt.sel ? ' sel' : ''}" data-i="${i}" role="option">${faviconHtml(r.p.pin.url, '')}<span class="t">${esc(r.p.pin.title || r.p.pin.url)}</span><span class="st">Not open</span><button class="x act on" data-unpin="${i}" title="Unpin (Alt+S)">${icon('pin')}</button></div>`;
    } else {
      const t = r.t;
      html += `<div class="row-tab${i === pt.sel ? ' sel' : ''}${t.id === d.activeId ? ' cur' : ''}" data-i="${i}" role="option" title="${esc(t.url)}">${faviconHtml(t.url, t.favicon)}<span class="t">${esc(t.title || t.url)}</span>${/^(https?|file):/i.test(t.url || '') ? (r.pinned ? `<button class="x act on" data-unpin="${i}" title="Unpin (Alt+S)">${icon('pin')}</button>` : `<button class="x act" data-star="${i}" title="Add to common bar (Alt+Shift+S)">${icon('star')}</button><button class="x act" data-pin="${i}" title="Pin here (Alt+S)">${icon('pin')}</button>`) : ''}<button class="x" data-x="${i}" title="Close (Delete)">${icon('close')}</button></div>`;
    }
  });
  const S = d.strip;
  if (!pt.q && d.currentWs && S.noWorkspace) html += `<div class="pop-label" style="text-transform:none;letter-spacing:0;cursor:pointer" data-ws="">${S.noWorkspace} tab${S.noWorkspace === 1 ? '' : 's'} in no workspace — show all</div>`;
  $('#pt-list').innerHTML = html || '<div class="empty">No tabs</div>';
  const s = $('#pt-list .sel');
  if (s) s.scrollIntoView({ block: 'nearest' });
}

function pointerAct(i, alternate = false) {
  const r = pt.rows[i];
  if (!r) return;
  if (r.kind === 'pin') api.cmd('pinned:open', r.p.wsId || '', r.p.index);
  else if (r.kind === 'search' || r.kind === 'go') api.cmd('overlay:web', r.kind, r.text, !alternate);
  else if (r.kind === 'bm') api.cmd('overlay:web', 'go', r.b.url, !alternate);
  else api.cmd('tab:activate', r.t.id);
}

/** An address rather than search words (same rules as the address bar, roughly). */
function looksLikeAddress(t) {
  if (!t || /\s/.test(t)) return false;
  return /^(https?|file|ferna):\/\/\S+$/i.test(t) || /^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/.*)?$/i.test(t) || /^[^/?#:]+\.[a-z]{2,63}(:\d+)?([/?#].*)?$/i.test(t);
}

root.addEventListener('click', e => {
  if (mode !== 'pointer') return;
  const x = e.target.closest('[data-x]');
  if (x) { e.stopPropagation(); const r = pt.rows[Number(x.dataset.x)]; if (r && r.t) api.cmd('tab:close', r.t.id); return; }
  const st = e.target.closest('[data-star]');
  if (st) { e.stopPropagation(); const r = pt.rows[Number(st.dataset.star)]; if (r && r.t) api.cmd('tab:common', r.t.id); return; }
  const pn = e.target.closest('[data-pin]');
  if (pn) { e.stopPropagation(); const r = pt.rows[Number(pn.dataset.pin)]; if (r && r.t) api.cmd('tab:pin', r.t.id); return; }
  const un = e.target.closest('[data-unpin]');
  if (un) { e.stopPropagation(); const r = pt.rows[Number(un.dataset.unpin)]; const p = r && (r.pinned || r.p); if (p) api.cmd('pinned:unpin', p.wsId || '', p.index); return; }
  const w = e.target.closest('[data-ws]');
  if (w) { api.cmd('ws:switch', w.dataset.ws || null); return; }
  const c = e.target.closest('[data-common]');
  if (c) { api.cmd('common:open', Number(c.dataset.common)); return; }
  const row = e.target.closest('.row-tab');
  if (row) pointerAct(Number(row.dataset.i));
});

/** Switch the Ferna Tabs list between tabs and the bookmarks browser. */
function togglePointerBookmarks() {
  const q = $('#pt-q');
  const pop = $('#pop');
  if (pt.bmv) {
    pt.bmv = null;
    pop.classList.remove('bm-view');
    $('#pt-bm').setAttribute('aria-pressed', 'false');
    $('#pt-list').className = 'pop-list'; $('#pt-list').removeAttribute('tabindex');
    q.placeholder = 'Filter tabs, or type to search the web';
    q.value = ''; pt.q = ''; pt.raw = ''; renderPointer();
  } else {
    pop.classList.add('bm-view');
    $('#pt-bm').setAttribute('aria-pressed', 'true');
    q.placeholder = 'Search bookmarks or the web';
    const host = $('#pt-list');
    host.className = 'pop-list';
    pt.bmv = BMView.create({ api, host, search: q, embedded: true, engine: data.engine, page: null });
    if (q.value) pt.bmv.setQuery(q.value);
  }
  q.focus();
}

function pointerKeys(e) {
  if (e.altKey && !e.ctrlKey && !e.shiftKey && e.code === 'KeyB') { e.preventDefault(); togglePointerBookmarks(); return true; }
  if (pt.bmv) return pt.bmv.keys(e);
  const n = pt.rows.length;
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
  if (e.key === 'Delete') { e.preventDefault(); const r = pt.rows[pt.sel]; if (r && r.t) api.cmd('tab:close', r.t.id); return true; }
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
  ['shotVisible', 'Screenshot: visible area', 'Alt+Shift+V'], ['shotFull', 'Screenshot: entire page', 'Alt+Shift+F'],
  ['shotRegion', 'Screenshot: select region', 'Alt+Shift+R'], ['shotElement', 'Screenshot: select element', 'Alt+Shift+E'],
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
// Screenshot region picker: select any area of the whole page, even beyond the screen
// =====================================================================
function openRegion(d) {
  const c = d.content;
  root.innerHTML = `
    <div class="reg" id="reg" style="left:${c.x}px;top:${c.y}px;width:${c.width}px;height:${c.height}px">
      <div id="reg-canvas" style="position:relative;width:${d.cssWidth}px">
        <img id="reg-img" src="ferna://shotimg/${encodeURIComponent(d.id)}.png" style="width:${d.cssWidth}px" alt="Page capture">
        <div class="sel" id="reg-sel" hidden><span class="dim" id="reg-dim"></span></div>
      </div>
    </div>
    <div class="reg-bar" style="top:${c.y + 12}px">
      <span class="tip" id="reg-tip">Drag to select · scroll to reach any part of the page</span>
      <button class="btn small" id="reg-full">Full width</button>
      <button class="btn small" id="reg-cancel">Cancel</button>
      <button class="btn small primary" id="reg-ok" disabled>Capture</button>
    </div>`;
  const reg = $('#reg');
  const img = $('#reg-img');
  const sel = $('#reg-sel');
  let rect = null;
  img.onload = () => { reg.scrollTop = d.scrollY || 0; reg.scrollLeft = d.scrollX || 0; };
  const show = () => {
    sel.hidden = !rect;
    $('#reg-ok').disabled = !rect || rect.width < 4 || rect.height < 4;
    if (!rect) return;
    Object.assign(sel.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    $('#reg-dim').textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
  };
  const pos = e => {
    const b = reg.getBoundingClientRect();
    const H = img.getBoundingClientRect().height;
    return { x: Math.max(0, Math.min(d.cssWidth, e.clientX - b.left + reg.scrollLeft)), y: Math.max(0, Math.min(H, e.clientY - b.top + reg.scrollTop)) };
  };
  let drag = null;
  let auto = null;
  reg.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    const p = pos(e);
    const inside = rect && p.x >= rect.x && p.x <= rect.x + rect.width && p.y >= rect.y && p.y <= rect.y + rect.height;
    drag = inside ? { kind: 'move', dx: p.x - rect.x, dy: p.y - rect.y } : { kind: 'new', x0: p.x, y0: p.y };
    let last = e;
    const update = ev => {
      last = ev;
      const q = pos(ev);
      if (drag.kind === 'new') rect = { x: Math.min(drag.x0, q.x), y: Math.min(drag.y0, q.y), width: Math.abs(q.x - drag.x0), height: Math.abs(q.y - drag.y0) };
      else rect = { ...rect, x: Math.max(0, Math.min(d.cssWidth - rect.width, q.x - drag.dx)), y: Math.max(0, q.y - drag.dy) };
      show();
    };
    const tick = () => {
      // Auto-scroll when dragging near the top or bottom edge, so a selection can span the whole page.
      const b = reg.getBoundingClientRect();
      const m = 40;
      if (last.clientY > b.bottom - m) reg.scrollTop += Math.min(40, (last.clientY - (b.bottom - m)));
      else if (last.clientY < b.top + m) reg.scrollTop -= Math.min(40, ((b.top + m) - last.clientY));
      update(last);
      auto = requestAnimationFrame(tick);
    };
    auto = requestAnimationFrame(tick);
    const up = () => { removeEventListener('mousemove', update); removeEventListener('mouseup', up); cancelAnimationFrame(auto); drag = null; };
    addEventListener('mousemove', update);
    addEventListener('mouseup', up);
  });
  reg.addEventListener('dblclick', () => { if (rect) api.cmd('overlay:region', rect); });
  const done = () => { if (rect && rect.width >= 4 && rect.height >= 4) api.cmd('overlay:region', rect); };
  $('#reg-ok').onclick = done;
  $('#reg-cancel').onclick = () => api.cmd('overlay:region', null);
  $('#reg-full').onclick = () => {
    const top = rect ? rect.y : reg.scrollTop;
    const h = rect ? rect.height : reg.clientHeight;
    rect = { x: 0, y: top, width: d.cssWidth, height: h };
    show();
  };
  keyHandler = e => { if (e.key === 'Enter') { e.preventDefault(); done(); return true; } return false; };
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
// Zoom panel (Zoom Page WE style): full / text zoom, levels, AutoFit, minimum font size
// =====================================================================
let zp = null;

function openZoom(d) {
  zp = d;
  const W = innerWidth;
  const pw = 360;
  const x = Math.max(8, Math.min(d.anchor.x + d.anchor.width - pw, W - pw - 8));
  const y = d.anchor.y + d.anchor.height + 6;
  root.innerHTML = `<div class="backdrop clear" data-bg="1"></div>
    <div class="zpanel" id="zpanel" style="left:${x}px;top:${y}px;width:${pw}px" role="dialog" aria-label="Zoom">
      <div class="zp-cols">
        <div class="zp-font" id="zp-font" title="Scroll here to change the minimum font size">
          <div class="zp-label">Minimum font</div>
          <select class="field" id="zp-min" aria-label="Minimum font size"></select>
          <button class="btn small" data-z="fontReset" title="Reset font size to the default (Ctrl+Alt+7)">Font reset</button>
        </div>
        <div class="zp-zoom" id="zp-zoom" title="Scroll here to zoom; Shift for small steps">
          <div class="zp-type" role="radiogroup" aria-label="Zoom type">
            <button data-type="0" role="radio">Full</button><button data-type="1" role="radio">Text</button>
          </div>
          <div class="zp-row">
            <button class="zbtn" data-z="out" title="Zoom out (Ctrl+−); Shift = small step">−</button>
            <select class="field" id="zp-level" aria-label="Zoom level"></select>
            <button class="zbtn" data-z="in" title="Zoom in (Ctrl++); Shift = small step">+</button>
          </div>
          <div class="zp-row">
            <button class="btn small" data-z="autofit" title="Fit the page width to the window (Ctrl+Alt+8)">AutoFit</button>
            <button class="btn small" data-z="reset" title="Default type and level (Ctrl+0). Ctrl+click: make this the default">Reset</button>
          </div>
        </div>
      </div>
      <div class="zp-foot"><span id="zp-scope"></span><a href="#" id="zp-settings">Zoom settings</a></div>
    </div>`;
  root.querySelector('[data-bg]').onclick = close;
  renderZoom();
  $('#zpanel').addEventListener('click', async e => {
    const t = e.target.closest('[data-type]');
    if (t) return zoomDo('setType', Number(t.dataset.type));
    const b = e.target.closest('[data-z]');
    if (!b) return;
    let act = b.dataset.z;
    if ((act === 'in' || act === 'out') && e.shiftKey) act += 'Small';
    if (act === 'reset' && e.ctrlKey) act = 'setDefault';
    zoomDo(act);
  });
  $('#zp-level').onchange = e => zoomDo('set', Number(e.target.value));
  $('#zp-min').onchange = e => zoomDo('minFont', Number(e.target.value));
  $('#zp-zoom').addEventListener('wheel', e => { e.preventDefault(); zoomDo((e.deltaY < 0 ? 'in' : 'out') + (e.shiftKey ? 'Small' : '')); }, { passive: false });
  $('#zp-font').addEventListener('wheel', e => {
    e.preventDefault();
    const list = zp.fonts;
    const i = Math.max(0, list.indexOf(zp.state.minFont || 0));
    zoomDo('minFont', list[Math.max(0, Math.min(list.length - 1, i + (e.deltaY < 0 ? 1 : -1)))]);
  }, { passive: false });
  $('#zp-settings').onclick = e => { e.preventDefault(); close(); api.cmd('run', 'settings'); };
  keyHandler = e => {
    if ((e.key === '+' || e.key === '=') ) { e.preventDefault(); zoomDo(e.shiftKey && e.key === '=' ? 'in' : 'in'); return true; }
    if (e.key === '-') { e.preventDefault(); zoomDo('out'); return true; }
    if (e.key === '0') { e.preventDefault(); zoomDo('reset'); return true; }
    if (e.key.toLowerCase() === 't') { e.preventDefault(); zoomDo('type'); return true; }
    if (e.key.toLowerCase() === 'a') { e.preventDefault(); zoomDo('autofit'); return true; }
    return false;
  };
  setTimeout(() => $('#zp-level').focus(), 0);
}

async function zoomDo(action, value) {
  const r = await api.cmd('zoom:act', action, value === undefined ? null : value);
  if (r) { zp = { ...zp, ...r }; renderZoom(); }
}

function renderZoom() {
  if (!zp || !$('#zpanel')) return;
  const st = zp.state;
  const levels = [...new Set([...zp.levels, zp.level])].sort((a, b) => a - b);
  $('#zp-level').innerHTML = levels.map(l => `<option value="${l}" ${l === zp.level ? 'selected' : ''}>${l}%</option>`).join('');
  const fonts = [...new Set([...zp.fonts, st.minFont || 0])].sort((a, b) => a - b);
  $('#zp-min').innerHTML = fonts.map(f => `<option value="${f}" ${f === (st.minFont || 0) ? 'selected' : ''}>${f ? `${f} px` : 'Off'}</option>`).join('');
  root.querySelectorAll('[data-type]').forEach(b => { const on = (b.dataset.type === '1') === (st.type === 'text'); b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
  $('#zp-scope').textContent = zp.mode === 'tab' ? 'This tab only' : `Remembered for ${zp.site || 'this site'}`;
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

function toast(text) {
  let t = $('#ov-toast');
  if (!t) { t = document.createElement('div'); t.id = 'ov-toast'; document.body.appendChild(t); }
  t.textContent = text; t.classList.add('on');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('on'), 2200);
}

// =====================================================================
// Equalizer panel (Alt+Q)
// =====================================================================
let eqp = null;
function openEq(d) {
  eqp = { ...d };
  const W = innerWidth;
  const pw = Math.min(460, W - 16);
  const x = Math.max(8, Math.min(d.anchor.x + d.anchor.width - pw, W - pw - 8));
  const y = d.anchor.y + d.anchor.height + 6;
  const fmt = f => f >= 1000 ? `${f / 1000}k` : String(f);
  root.innerHTML = `<div class="backdrop clear" data-bg="1"></div>
    <div class="zpanel eqp" id="eqp" style="left:${x}px;top:${y}px;width:${pw}px" role="dialog" aria-label="Equalizer">
      <div class="eq-head">
        <label class="eq-switch"><input type="checkbox" id="eq-on"><span></span><b>Equalizer</b></label>
        <label class="eq-auto" title="Detect the genre of what is playing and pick a preset"><input type="checkbox" id="eq-auto"> Auto-EQ</label>
      </div>
      <div class="eq-detect" id="eq-detect"></div>
      <div class="eq-presets" id="eq-presets" role="radiogroup" aria-label="Presets"></div>
      <div class="eq-bands" id="eq-bands">
        ${d.bands.map((f, i) => `<div class="eq-band"><span class="eq-val" id="eq-v${i}">0</span><input type="range" min="-12" max="12" step="0.5" value="0" data-band="${i}" aria-label="${fmt(f)} Hz" orient="vertical"><span class="eq-f">${fmt(f)}</span></div>`).join('')}
      </div>
      <div class="eq-save"><input id="eq-name" maxlength="40" placeholder="Name this sound (e.g. My Baila, Car stereo)"><button class="btn small" id="eq-save">Save preset</button></div>
      <div class="zp-foot"><span id="eq-note"></span><a href="#" id="eq-reset">Reset to flat</a></div>
    </div>`;
  root.querySelector('[data-bg]').onclick = close;
  const P = d.presets;
  const drawPresets = () => {
    $('#eq-presets').innerHTML = Object.keys(P).map(k => `<button data-preset="${k}" role="radio">${esc(P[k].label)}</button>`).join('') +
      (eqp.user || []).map(u => `<button data-user="${esc(u.id)}" role="radio" class="user" title="Your preset. Right-click to delete.">★ ${esc(u.name)}</button>`).join('') +
      '<button data-preset="custom" role="radio">Custom</button>';
  };
  drawPresets();
  $('#eq-presets').addEventListener('contextmenu', async e => {
    const b = e.target.closest('[data-user]');
    if (!b) return;
    e.preventDefault();
    if (!confirm(`Delete your preset “${b.textContent.replace(/^★ /, '')}”?`)) return;
    const r = await api.cmd('eq:preset-delete', b.dataset.user);
    eqp.user = r.user; drawPresets(); renderEq();
  });
  $('#eq-save').onclick = async () => {
    const name = $('#eq-name').value.trim();
    if (!name) { $('#eq-name').focus(); return; }
    const gains = [...document.querySelectorAll('#eqp [data-band]')].map(r => Number(r.value));
    const r = await api.cmd('eq:preset-save', name, gains);
    if (r) { eqp.user = r.user; eqp.cfg = r.cfg; $('#eq-name').value = ''; drawPresets(); renderEq(); }
  };
  const panel = $('#eqp');
  const send = async patch => { const r = await api.cmd('eq:set', patch); eqp.cfg = r.cfg; eqp.status = r.status; renderEq(); };
  $('#eq-on').onchange = e => send({ enabled: e.target.checked });
  $('#eq-auto').onchange = e => send({ auto: e.target.checked, enabled: true });
  $('#eq-reset').onclick = e => { e.preventDefault(); send({ preset: 'flat', auto: false, gains: d.bands.map(() => 0) }); };
  panel.addEventListener('click', e => {
    const u = e.target.closest('[data-user]');
    if (u) { const p = (eqp.user || []).find(x => x.id === u.dataset.user); if (p) send({ preset: 'custom', auto: false, enabled: true, gains: p.gains, customName: p.name }); return; }
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    const k = b.dataset.preset;
    send({ preset: k, auto: false, enabled: true, ...(k !== 'custom' ? { gains: P[k].gains } : {}) });
  });
  let pending = null;
  panel.addEventListener('input', e => {
    const i = e.target.dataset && e.target.dataset.band;
    if (i === undefined) return;
    const gains = [...panel.querySelectorAll('[data-band]')].map(r => Number(r.value));
    $(`#eq-v${i}`).textContent = fmtDb(Number(e.target.value));
    clearTimeout(pending);
    pending = setTimeout(() => send({ preset: 'custom', auto: false, enabled: true, gains }), 60);
  });
  renderEq();
  clearInterval(openEq.poll);
  openEq.poll = setInterval(async () => {
    if (mode !== 'eq') { clearInterval(openEq.poll); return; }
    const r = await api.cmd('eq:status').catch(() => null);
    if (r) { eqp.cfg = r.cfg; eqp.status = r.status; renderEq(true); }
  }, 1000);
}
const fmtDb = v => (v > 0 ? '+' : '') + (Math.round(v * 2) / 2);
function renderEq(fromPoll = false) {
  if (!$('#eqp')) return;
  const c = eqp.cfg, s = eqp.status, P = eqp.presets;
  $('#eq-on').checked = c.enabled;
  $('#eq-auto').checked = c.auto;
  $('#eqp').classList.toggle('off', !c.enabled);
  const shownPreset = c.auto ? (s && s.applied) || 'flat' : c.preset;
  const userOn = !c.auto && c.preset === 'custom' && c.customName ? ((eqp.user || []).find(u => u.name === c.customName) || {}).id : null;
  document.querySelectorAll('#eq-presets [data-preset], #eq-presets [data-user]').forEach(b => {
    const on = b.dataset.user ? b.dataset.user === userOn : (!userOn && b.dataset.preset === shownPreset);
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
  const gains = c.auto ? (s && s.gains) || P.flat.gains : c.preset === 'custom' ? c.gains : (P[c.preset] || P.flat).gains;
  document.querySelectorAll('#eqp [data-band]').forEach((r, i) => {
    if (!(fromPoll && document.activeElement === r)) r.value = gains[i];
    r.disabled = !!c.auto;
    $(`#eq-v${i}`).textContent = fmtDb(Number(r.value));
  });
  const det = $('#eq-detect');
  if (c.enabled && c.auto) {
    det.hidden = false;
    det.innerHTML = s && s.genre
      ? `Detected <b>${esc(P[s.genre] ? P[s.genre].label : s.genre)}</b> · ${s.confidence}% · using <b>${esc(P[s.applied] ? P[s.applied].label : s.applied)}</b><div class="why">${esc(s.reason || '')}</div>`
      : `<span class="why">${esc((s && s.reason) || 'Play something: Auto-EQ listens for a few seconds, and reads the page title.')}</span>`;
  } else det.hidden = true;
  const note = $('#eq-note');
  if (!eqp.web) note.textContent = 'Works on web pages.';
  else if (s && s.skipped && !s.attached) note.textContent = 'This player streams from another site that does not allow audio processing.';
  else if (c.enabled && s) note.textContent = s.attached ? `Equalizing ${s.attached} player${s.attached === 1 ? '' : 's'} on this page` : 'Waiting for audio on this page';
  else note.textContent = 'Applies to every tab.';
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
