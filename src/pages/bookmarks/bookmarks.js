'use strict';
// Bookmark manager: folders, reading list, smart filters (unread, broken links, duplicates),
// tags, site and date filters, multi-select across folders with bulk delete (with undo), move,
// tags, read status, link check and export; imports from every major browser; backups.
const { $, $$, esc, icon, faviconHtml, hostOf } = FK;
const api = window.ferna;

let D = { items: [], roots: {}, tags: [], domains: [], dupes: [], check: {}, backups: [], settings: {} };
const S = {
  view: { kind: 'folder', id: null }, q: '', tags: new Set(), domain: '', from: 0, to: 0, read: '',
  sel: new Set(), anchor: null, cur: null, limit: 500, open: new Set(['bar', 'other', 'reading']), rows: [], keep: {},
};
const byId = id => D.items.find(n => n.id === id);
const isFolder = n => n && n.type === 'folder';
const kids = p => D.items.filter(n => (n.folder || 'other') === p);

$('#q-icon').innerHTML = icon('search');

// ---------- data ----------
async function load() {
  D = await api.cmd('bm:manager');
  const have = new Set(D.items.map(n => n.id));
  for (const id of [...S.sel]) if (!have.has(id)) S.sel.delete(id);
  render();
}
let loadT = null;
api.on('refresh', () => { clearTimeout(loadT); loadT = setTimeout(load, 60); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });

function pathOf(id) {
  const out = [];
  for (let g = 0; g < 64 && id; g++) {
    if (D.roots[id]) { out.unshift(D.roots[id]); break; }
    const f = byId(id); if (!f) break;
    out.unshift(f.title); id = f.folder;
  }
  return out.join(' › ');
}
function subtree(id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) { grew = false; for (const n of D.items) if (!out.has(n.id) && out.has(n.folder)) { out.add(n.id); grew = true; } }
  return out;
}
const filtersOn = () => !!(S.q || S.tags.size || S.domain || S.from || S.to || S.read);

// ---------- rows ----------
function computeRows() {
  const v = S.view;
  const terms = S.q.toLowerCase().split(/\s+/).filter(Boolean);
  const host = u => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
  const dom = S.domain.toLowerCase().replace(/^www\./, '');
  const dupIds = new Set(D.dupes.flatMap(g => g.ids));
  const pass = n => {
    if (isFolder(n)) return false;
    if (terms.length) { const hay = `${n.title || ''} ${n.url || ''} ${(n.tags || []).join(' ')}`.toLowerCase(); if (!terms.every(t => hay.includes(t))) return false; }
    if (S.tags.size && ![...S.tags].every(t => (n.tags || []).some(x => x.toLowerCase() === t))) return false;
    if (dom) { const h = host(n.url); if (h !== dom && !h.endsWith(`.${dom}`)) return false; }
    if (S.from && (n.ts || 0) < S.from) return false;
    if (S.to && (n.ts || 0) > S.to) return false;
    if (S.read === 'read' && !n.visited) return false;
    if (S.read === 'unread' && n.visited) return false;
    return true;
  };
  if (v.kind === 'smart') {
    const by = {
      unread: n => !n.visited, read: n => !!n.visited, dead: n => n.check && n.check.s === 'dead',
      error: n => n.check && n.check.s === 'error', unchecked: n => !n.check && /^https?:/.test(n.url || ''), dupes: n => dupIds.has(n.id),
    }[v.id];
    return D.items.filter(n => pass(n) && by(n)).map(n => ({ n }));
  }
  if (v.id && !filtersOn()) return kids(v.id).map(n => ({ n }));
  const inside = v.id ? subtree(v.id) : null;
  return D.items.filter(n => (!inside || inside.has(n.id)) && pass(n)).map(n => ({ n }));
}

function statusHtml(n) {
  if (isFolder(n)) return `<span class="st">${kids(n.id).length} items</span>`;
  const c = n.check;
  if (c && c.s === 'dead') return `<span class="st dead" title="${esc(c.code ? `HTTP ${c.code}` : c.err || 'Not found')}">${icon('unlink')} Broken</span>`;
  if (c && c.s === 'error') return `<span class="st error" title="${esc(c.code ? `HTTP ${c.code}` : c.err || '')}">Can't reach</span>`;
  if (!n.visited) return '<span class="st unread" title="Never opened">Unread</span>';
  if (c && c.s === 'ok') return `<span class="st ok" title="Checked ${esc(new Date(c.at).toLocaleString())}">${icon('check')} OK</span>`;
  return '<span class="st">Read</span>';
}

function rowHtml(r, i) {
  const n = r.n;
  const sel = S.sel.has(n.id);
  const date = n.ts ? new Date(n.ts).toLocaleDateString() : '';
  const icn = isFolder(n) ? icon('folder') : faviconHtml(n.url, '');
  return `<div class="bmrow${isFolder(n) ? ' folder' : ''}${sel ? ' sel' : ''}${S.cur === n.id ? ' cur' : ''}" data-i="${i}" data-id="${esc(n.id)}" role="option" aria-selected="${sel}" draggable="true">
    <input type="checkbox" ${sel ? 'checked' : ''} aria-label="Select ${esc(n.title)}" tabindex="-1">
    <div class="t">${icn}<div class="txt"><div class="ti">${esc(n.title || n.url)}</div>${isFolder(n) ? '' : `<div class="u">${esc(n.url)}</div>`}</div>
      <div class="rowacts">${isFolder(n) ? '' : `<button data-act="open" title="Open in new tab">${icon('arrow')}</button>`}<button data-act="edit" title="Edit (F2)">${icon('edit')}</button><button data-act="del" title="Delete">${icon('trash')}</button></div></div>
    <div class="f" title="${esc(pathOf(n.folder))}">${esc(pathOf(n.folder))}</div>
    <div class="tg">${(n.tags || []).map(t => `<span>${esc(t)}</span>`).join('')}</div>
    <div class="d">${esc(date)}</div>
    <div>${statusHtml(n)}</div>
  </div>`;
}

function render() {
  renderSide();
  S.rows = computeRows();
  const list = $('#list');
  const top = list.scrollTop;
  if (S.view.kind === 'smart' && S.view.id === 'dupes') renderDupes(list);
  else {
    const shown = S.rows.slice(0, S.limit);
    list.innerHTML = shown.length ? shown.map(rowHtml).join('') + (S.rows.length > S.limit ? `<div class="more"><button class="btn" id="more">Show ${Math.min(500, S.rows.length - S.limit)} more (${S.rows.length - S.limit} left)</button></div>` : '')
      : `<div class="empty">${filtersOn() ? 'No bookmarks match these filters.' : S.view.id === 'reading' ? 'Your reading list is empty. Right-click a page or link → Add to reading list.' : 'Nothing here.'}</div>`;
    const more = $('#more');
    if (more) more.onclick = () => { S.limit += 500; render(); };
  }
  list.scrollTop = top;
  renderSelBar();
  renderBanner();
}

function renderDupes(list) {
  const q = S.q.toLowerCase();
  const groups = D.dupes.filter(g => !q || g.key.toLowerCase().includes(q));
  if (!groups.length) { list.innerHTML = '<div class="empty">No duplicates. Every bookmark points to a different page.</div>'; return; }
  let i = 0;
  list.innerHTML = `<div id="banner-d" style="padding:10px 14px;display:flex;gap:10px;align-items:center;border-bottom:1px solid var(--line)">
      <b>${groups.length} page${groups.length === 1 ? ' is' : 's are'} bookmarked more than once</b><span class="muted">Merging keeps one bookmark per page (with all tags) and removes the rest.</span>
      <span style="flex:1"></span><button class="btn small primary" id="merge-all">Merge all</button></div>` +
    groups.map(g => `<div class="dupgroup" data-key="${esc(g.key)}"><div class="gh"><span class="k" title="${esc(g.key)}">${esc(g.key)}</span><span>${g.ids.length} copies</span><button class="btn small" data-merge="${esc(g.key)}">Merge</button></div>
      ${g.ids.map(id => byId(id)).filter(Boolean).map(n => { const r = { n }; const h = rowHtml(r, i++); S.rows[i - 1] = r;
        return h.replace('<div>' + statusHtml(n) + '</div>', `<label class="keep"><input type="radio" name="k-${esc(g.key)}" value="${esc(n.id)}" ${(S.keep[g.key] || g.ids[0]) === n.id ? 'checked' : ''}> Keep</label>`); }).join('')}
    </div>`).join('');
  $('#merge-all').onclick = () => merge(groups.map(g => g.key));
  $$('[data-merge]', list).forEach(b => { b.onclick = () => merge([b.dataset.merge]); });
  $$('input[type=radio]', list).forEach(r => { r.onchange = () => { S.keep[r.name.slice(2)] = r.value; }; });
}

async function merge(keys) {
  const r = await api.cmd('bm:bulk', 'merge', { keys, keep: S.keep });
  D = r.data; S.sel.clear(); render();
  toast(`Merged ${r.count} page${r.count === 1 ? '' : 's'}; removed ${r.removedCount} duplicate${r.removedCount === 1 ? '' : 's'}.`, r.token);
}

// ---------- sidebar ----------
function renderSide() {
  const node = (id, title, depth, ic, count, hasKids) => `<div class="node${S.view.kind === 'folder' && S.view.id === id ? ' on' : ''}" data-folder="${esc(id || '')}" data-drop="${esc(id || '')}" style="padding-left:${8 + depth * 14}px" role="treeitem">
      <span class="tw" data-tw="${esc(id || '')}">${hasKids ? icon(S.open.has(id) ? 'down' : 'right') : ''}</span>${icon(ic)}<span class="lbl">${esc(title)}</span><span class="n">${count}</span></div>`;
  const out = [node(null, 'All bookmarks', 0, 'bookmarks', D.items.filter(n => !isFolder(n)).length, false)];
  const walk = (parent, depth) => {
    for (const f of kids(parent).filter(isFolder)) {
      const sub = kids(f.id).some(isFolder);
      out.push(node(f.id, f.title, depth, 'folder', [...subtree(f.id)].filter(id => !isFolder(byId(id))).length, sub));
      if (sub && S.open.has(f.id)) walk(f.id, depth + 1);
    }
  };
  for (const r of ['bar', 'other', 'reading']) {
    const sub = kids(r).some(isFolder);
    out.push(node(r, D.roots[r] || r, 0, r === 'bar' ? 'star' : r === 'reading' ? 'book' : 'folder', [...subtree(r)].filter(id => id !== r && !isFolder(byId(id))).length, sub));
    if (sub && S.open.has(r)) walk(r, 1);
  }
  $('#folders').innerHTML = out.join('');
  const cnt = f => D.items.filter(n => !isFolder(n) && f(n)).length;
  const smart = [
    ['unread', 'Unread', 'peek', cnt(n => !n.visited)], ['read', 'Read', 'check', cnt(n => !!n.visited)],
    ['dead', 'Broken links', 'unlink', cnt(n => n.check && n.check.s === 'dead')], ['error', "Can't reach", 'warn', cnt(n => n.check && n.check.s === 'error')],
    ['unchecked', 'Not checked yet', 'info', cnt(n => !n.check && /^https?:/.test(n.url || ''))], ['dupes', 'Duplicates', 'dupe', D.dupes.length],
  ];
  $('#smart').innerHTML = smart.map(([id, t, ic, n]) => `<div class="node${S.view.kind === 'smart' && S.view.id === id ? ' on' : ''}${(id === 'dead' || id === 'dupes') && n ? ' bad' : ''}" data-smart="${id}">${icon(ic)}<span class="lbl">${t}</span><span class="n">${n}</span></div>`).join('');
  $('#tags').innerHTML = D.tags.length ? D.tags.map(t => `<button class="tagchip${S.tags.has(t.tag.toLowerCase()) ? ' on' : ''}" data-tag="${esc(t.tag)}">${esc(t.tag)}<span class="n">${t.count}</span></button>`).join('')
    : '<span class="muted" style="padding:2px 4px;font-size:12px">No tags yet. Select bookmarks → Tags…</span>';
  $('#domains').innerHTML = D.domains.slice(0, 200).map(d => `<option value="${esc(d.domain)}">${d.count}</option>`).join('');
  // Move-to list
  const opts = ['<option value="">Move to…</option>'];
  const walkOpts = (parent, depth) => { for (const f of kids(parent).filter(isFolder)) { opts.push(`<option value="${esc(f.id)}">${'  '.repeat(depth)}${esc(f.title)}</option>`); walkOpts(f.id, depth + 1); } };
  for (const r of ['bar', 'other', 'reading']) { opts.push(`<option value="${r}">${esc(D.roots[r] || r)}</option>`); walkOpts(r, 1); }
  $('#a-move').innerHTML = opts.join('').replace(/> {2,}/g, m => `>${'  '.repeat((m.length - 1) / 2)}`);
}

$('#folders').addEventListener('click', e => {
  const tw = e.target.closest('[data-tw]');
  if (tw && tw.dataset.tw && tw.innerHTML) { const id = tw.dataset.tw; if (S.open.has(id)) S.open.delete(id); else S.open.add(id); renderSide(); return; }
  const n = e.target.closest('[data-folder]');
  if (!n) return;
  S.view = { kind: 'folder', id: n.dataset.folder || null }; S.limit = 500;
  render();
});
$('#smart').addEventListener('click', e => { const n = e.target.closest('[data-smart]'); if (n) { S.view = { kind: 'smart', id: n.dataset.smart }; S.limit = 500; render(); } });
$('#tags').addEventListener('click', e => { const b = e.target.closest('[data-tag]'); if (!b) return; const t = b.dataset.tag.toLowerCase(); if (S.tags.has(t)) S.tags.delete(t); else S.tags.add(t); render(); });
let qt;
$('#q').addEventListener('input', () => { clearTimeout(qt); qt = setTimeout(() => { S.q = $('#q').value.trim(); S.limit = 500; render(); }, 120); });
$('#f-domain').addEventListener('change', () => { S.domain = $('#f-domain').value.trim(); render(); });
$('#f-from').addEventListener('change', () => { S.from = $('#f-from').value ? new Date(`${$('#f-from').value}T00:00:00`).getTime() : 0; render(); });
$('#f-to').addEventListener('change', () => { S.to = $('#f-to').value ? new Date(`${$('#f-to').value}T23:59:59`).getTime() : 0; render(); });
$('#f-read').addEventListener('change', () => { S.read = $('#f-read').value; render(); });
$('#f-clear').onclick = () => {
  S.q = ''; S.tags.clear(); S.domain = ''; S.from = 0; S.to = 0; S.read = '';
  $('#q').value = ''; $('#f-domain').value = ''; $('#f-from').value = ''; $('#f-to').value = ''; $('#f-read').value = '';
  render();
};

// ---------- selection ----------
function visibleIds() { return S.rows.slice(0, S.view.id === 'dupes' && S.view.kind === 'smart' ? S.rows.length : S.limit).map(r => r.n.id); }
function renderSelBar() {
  const vis = visibleIds();
  const allOn = vis.length > 0 && vis.every(id => S.sel.has(id));
  const all = $('#sel-all');
  all.checked = allOn;
  all.indeterminate = !allOn && vis.some(id => S.sel.has(id));
  const n = S.sel.size;
  const hidden = [...S.sel].filter(id => !vis.includes(id)).length;
  $('#sel-count').textContent = n ? `${n} selected${hidden ? ` (${hidden} in other folders)` : ''}` : 'Select all';
  $('#acts').classList.toggle('off', !n);
  const bms = S.rows.filter(r => !isFolder(r.n)).length;
  $('#shown').textContent = `${bms} bookmark${bms === 1 ? '' : 's'}${S.rows.length > bms ? `, ${S.rows.length - bms} folder${S.rows.length - bms === 1 ? '' : 's'}` : ''}`;
}
function setSel(id, on) { if (on) S.sel.add(id); else S.sel.delete(id); }
function refreshRows() {
  for (const el of $$('.bmrow', $('#list'))) {
    const on = S.sel.has(el.dataset.id);
    el.classList.toggle('sel', on); el.classList.toggle('cur', S.cur === el.dataset.id);
    el.setAttribute('aria-selected', String(on));
    const cb = el.querySelector('input[type=checkbox]'); if (cb) cb.checked = on;
  }
  renderSelBar();
}
$('#sel-all').addEventListener('change', e => { const vis = visibleIds(); vis.forEach(id => setSel(id, e.target.checked)); refreshRows(); });
$('#a-clear').onclick = () => { S.sel.clear(); refreshRows(); };

$('#list').addEventListener('click', e => {
  const row = e.target.closest('.bmrow');
  if (!row) return;
  const id = row.dataset.id;
  const i = Number(row.dataset.i);
  const act = e.target.closest('[data-act]');
  if (act) {
    const n = byId(id);
    if (act.dataset.act === 'open') api.cmd('bm:go', n.url, 'new');
    else if (act.dataset.act === 'edit') editDialog(n);
    else if (act.dataset.act === 'del') confirmDelete([id]);
    return;
  }
  if (e.target.type === 'radio' || e.target.closest('.keep')) return;
  if (e.shiftKey && S.anchor !== null) {
    const [a, b] = [Math.min(S.anchor, i), Math.max(S.anchor, i)];
    for (let k = a; k <= b; k++) if (S.rows[k]) S.sel.add(S.rows[k].n.id);
  } else if (e.target.type === 'checkbox' || e.ctrlKey || e.metaKey) {
    setSel(id, !S.sel.has(id)); S.anchor = i;
  } else {
    S.anchor = i;
    S.cur = id;
  }
  refreshRows();
});
$('#list').addEventListener('dblclick', e => {
  const row = e.target.closest('.bmrow');
  if (!row || e.target.closest('input,button')) return;
  const n = byId(row.dataset.id);
  if (isFolder(n)) { S.view = { kind: 'folder', id: n.id }; S.open.add(n.folder); render(); } else api.cmd('bm:go', n.url, 'new');
});
$('#list').addEventListener('auxclick', e => {
  const row = e.target.closest('.bmrow');
  if (e.button === 1 && row) { const n = byId(row.dataset.id); if (n && n.url) api.cmd('bm:go', n.url, 'background'); }
});

document.addEventListener('keydown', e => {
  if (!$('#modal-back').hidden) { if (e.key === 'Escape') closeModal(); return; }
  if (e.target.closest('input, select, textarea') && e.target.type !== 'checkbox') return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); visibleIds().forEach(id => S.sel.add(id)); refreshRows(); }
  else if (e.key === 'Delete') { const ids = S.sel.size ? [...S.sel] : S.cur ? [S.cur] : []; if (ids.length) confirmDelete(ids); }
  else if (e.key === 'Escape') { S.sel.clear(); refreshRows(); }
  else if (e.key === 'F2' && S.cur) { e.preventDefault(); editDialog(byId(S.cur)); }
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const ids = visibleIds(); let i = ids.indexOf(S.cur); i = Math.max(0, Math.min(ids.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
    S.cur = ids[i]; if (e.shiftKey && S.cur) S.sel.add(S.cur);
    refreshRows();
    const el = $(`.bmrow[data-id="${CSS.escape(S.cur || '')}"]`); if (el) el.scrollIntoView({ block: 'nearest' });
  } else if (e.key === ' ' && S.cur) { e.preventDefault(); setSel(S.cur, !S.sel.has(S.cur)); refreshRows(); }
  else if (e.key === 'Enter' && S.cur) { const n = byId(S.cur); if (n && n.url) api.cmd('bm:go', n.url, e.shiftKey ? 'current' : 'new'); }
});

// Drag rows onto a folder in the sidebar: moves the dragged row, or the whole selection.
let dragIds = null;
$('#list').addEventListener('dragstart', e => {
  const row = e.target.closest('.bmrow'); if (!row) return;
  dragIds = S.sel.has(row.dataset.id) ? [...S.sel] : [row.dataset.id];
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', `${dragIds.length} bookmarks`);
});
$('#folders').addEventListener('dragover', e => { const n = e.target.closest('[data-drop]'); if (n && dragIds && n.dataset.drop) { e.preventDefault(); $$('.node.drop').forEach(x => x.classList.remove('drop')); n.classList.add('drop'); } });
$('#folders').addEventListener('dragleave', e => { const n = e.target.closest('[data-drop]'); if (n) n.classList.remove('drop'); });
$('#folders').addEventListener('drop', async e => {
  e.preventDefault();
  $$('.node.drop').forEach(x => x.classList.remove('drop'));
  const n = e.target.closest('[data-drop]');
  if (!n || !dragIds || !n.dataset.drop) return;
  await bulkMove(dragIds, n.dataset.drop);
  dragIds = null;
});

// ---------- bulk actions ----------
function counts(ids) {
  let b = 0, f = 0, inside = 0;
  for (const id of ids) { const n = byId(id); if (!n) continue; if (isFolder(n)) { f++; inside += [...subtree(id)].filter(x => x !== id && !isFolder(byId(x)) && !ids.includes(x)).length; } else b++; }
  return { b, f, inside };
}
function confirmDelete(ids) {
  const c = counts(ids);
  const total = c.b + c.inside;
  const what = `${total} bookmark${total === 1 ? '' : 's'}${c.f ? ` and ${c.f} folder${c.f === 1 ? '' : 's'}` : ''}`;
  modal(`<h2>Delete ${what}?</h2><p>Are you sure you want to delete ${what}?${c.inside ? ` That includes ${c.inside} inside the selected folder${c.f === 1 ? '' : 's'}.` : ''} You can undo this straight after.</p>
    <div class="btns"><button class="btn" data-close>Cancel</button><button class="btn danger" id="m-ok">Delete ${total || ''}</button></div>`);
  $('#m-ok').focus();
  $('#m-ok').onclick = async () => {
    closeModal();
    const r = await api.cmd('bm:bulk', 'delete', { ids });
    D = r.data; ids.forEach(id => S.sel.delete(id)); render();
    toast(`Deleted ${r.count} bookmark${r.count === 1 ? '' : 's'}${r.folders ? ` and ${r.folders} folder${r.folders === 1 ? '' : 's'}` : ''}.`, r.token);
  };
}
$('#a-delete').onclick = () => confirmDelete([...S.sel]);

async function bulkMove(ids, parent) {
  const r = await api.cmd('bm:bulk', 'move', { ids, parent });
  D = r.data; render();
  toast(`Moved ${r.count} item${r.count === 1 ? '' : 's'} to ${pathOf(parent) || D.roots[parent]}.`);
}
$('#a-move').onchange = async e => { const p = e.target.value; e.target.value = ''; if (p) await bulkMove([...S.sel], p); };

$('#a-tag').onclick = () => {
  const ids = [...S.sel].filter(id => !isFolder(byId(id)));
  const present = new Map();
  for (const id of ids) for (const t of byId(id).tags || []) present.set(t.toLowerCase(), t);
  modal(`<h2>Tags for ${ids.length} bookmark${ids.length === 1 ? '' : 's'}</h2>
    <label>Add tags (separate with commas)<input id="m-add" list="m-tags" placeholder="research, to read, ml" autocomplete="off"></label>
    <datalist id="m-tags">${D.tags.map(t => `<option value="${esc(t.tag)}">`).join('')}</datalist>
    ${present.size ? `<p style="margin-bottom:4px">Remove from the selected bookmarks:</p><div class="tagcloud" id="m-rm">${[...present.values()].map(t => `<label class="tagchip" style="display:inline-flex;gap:4px;margin:0"><input type="checkbox" value="${esc(t)}"> ${esc(t)}</label>`).join('')}</div>` : ''}
    <div class="btns"><button class="btn" data-close>Cancel</button><button class="btn primary" id="m-ok">Apply</button></div>`);
  $('#m-add').focus();
  const apply = async () => {
    const add = $('#m-add').value.split(',').map(s => s.trim()).filter(Boolean);
    const remove = $$('#m-rm input:checked').map(x => x.value);
    closeModal();
    if (!add.length && !remove.length) return;
    const r = await api.cmd('bm:bulk', 'tag', { ids, add, remove });
    D = r.data; render();
    toast(`Updated tags on ${r.count} bookmark${r.count === 1 ? '' : 's'}.`);
  };
  $('#m-ok').onclick = apply;
  $('#m-add').addEventListener('keydown', e => { if (e.key === 'Enter') apply(); });
};
$('#a-read').onclick = async () => { const r = await api.cmd('bm:bulk', 'read', { ids: [...S.sel], read: true }); D = r.data; render(); };
$('#a-unread').onclick = async () => { const r = await api.cmd('bm:bulk', 'read', { ids: [...S.sel], read: false }); D = r.data; render(); };
$('#a-export').onchange = async e => {
  const fmt = e.target.value; e.target.value = '';
  if (!fmt) return;
  const text = await api.cmd('bm:export-sel', [...S.sel], fmt);
  download(text, `ferna-bookmarks-selected-${new Date().toISOString().slice(0, 10)}.${fmt}`, fmt === 'json' ? 'application/json' : 'text/html');
};
$('#a-check').onclick = () => startCheck([...S.sel].filter(id => !isFolder(byId(id))));
$('#b-check').onclick = () => startCheck(null);
async function startCheck(ids) {
  D.check = await api.cmd('bm:check', ids);
  renderBanner();
  poll();
}
let pollT = null;
function poll() { clearTimeout(pollT); pollT = setTimeout(async () => { await load(); if (D.check.running) poll(); }, 1200); }

function renderBanner() {
  const b = $('#banner');
  const c = D.check || {};
  if (c.running) {
    b.hidden = false;
    b.innerHTML = `<b>Checking links…</b><span>${c.done} of ${c.total}</span><div class="progress"><span style="width:${c.total ? Math.round(c.done * 100 / c.total) : 0}%"></span></div>
      <span>${c.dead} broken</span><span class="grow"></span><button class="btn small" id="chk-cancel">Stop</button>`;
    $('#chk-cancel').onclick = () => api.cmd('bm:check-cancel');
    return;
  }
  const dead = D.items.filter(n => n.check && n.check.s === 'dead').length;
  if (S.view.kind === 'smart' && S.view.id === 'dead' && dead) {
    b.hidden = false;
    b.innerHTML = `<b>${dead} broken link${dead === 1 ? '' : 's'}</b><span class="muted">The page is gone (404 / 410) or the site no longer exists.</span><span class="grow"></span>
      <button class="btn small danger" id="purge">Delete all broken</button>`;
    $('#purge').onclick = () => {
      modal(`<h2>Delete ${dead} broken bookmark${dead === 1 ? '' : 's'}?</h2><p>Are you sure you want to delete ${dead} bookmark${dead === 1 ? '' : 's'} whose pages no longer exist?</p>
        <div class="btns"><button class="btn" data-close>Cancel</button><button class="btn danger" id="m-ok">Delete ${dead}</button></div>`);
      $('#m-ok').onclick = async () => { closeModal(); const r = await api.cmd('bm:bulk', 'purgeDead', {}); D = r.data; S.sel.clear(); render(); toast(`Deleted ${r.count} broken bookmark${r.count === 1 ? '' : 's'}.`, r.token); };
    };
    return;
  }
  if (c.total && c.done === c.total && S.dismissed !== `${c.total}:${c.dead}:${c.errors}`) {
    b.hidden = false;
    b.innerHTML = `<b>Link check finished.</b><span>${c.dead} broken, ${c.errors} could not be reached of ${c.total}.</span><span class="grow"></span>${c.dead ? '<button class="btn small" id="show-dead">Show broken</button>' : ''}<button class="btn small" id="dismiss">Dismiss</button>`;
    const sd = $('#show-dead'); if (sd) sd.onclick = () => { S.view = { kind: 'smart', id: 'dead' }; render(); };
    $('#dismiss').onclick = () => { S.dismissed = `${c.total}:${c.dead}:${c.errors}`; b.hidden = true; };
    return;
  }
  b.hidden = true;
}

// ---------- edit, new folder ----------
function editDialog(n) {
  if (!n) return;
  modal(`<h2>Edit ${isFolder(n) ? 'folder' : 'bookmark'}</h2>
    <label>Name<input id="m-title" value="${esc(n.title || '')}"></label>
    ${isFolder(n) ? '' : `<label>Address<input id="m-url" value="${esc(n.url || '')}"></label><label>Tags (commas)<input id="m-tg" value="${esc((n.tags || []).join(', '))}" list="m-tags"></label><datalist id="m-tags">${D.tags.map(t => `<option value="${esc(t.tag)}">`).join('')}</datalist>`}
    <div class="btns"><button class="btn" data-close>Cancel</button><button class="btn primary" id="m-ok">Save</button></div>`);
  $('#m-title').select();
  const save = async () => {
    const patch = { id: n.id, title: $('#m-title').value };
    if (!isFolder(n)) patch.url = $('#m-url').value.trim();
    const r = await api.cmd('bm:op', 'update', patch);
    if (!r.ok) { alert('That address is not valid.'); return; }
    if (!isFolder(n)) {
      const want = $('#m-tg').value.split(',').map(s => s.trim()).filter(Boolean);
      const have = n.tags || [];
      await api.cmd('bm:bulk', 'tag', { ids: [n.id], add: want, remove: have.filter(t => !want.some(w => w.toLowerCase() === t.toLowerCase())) });
    }
    closeModal(); load();
  };
  $('#m-ok').onclick = save;
  $$('#modal input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') save(); }));
}
$('#b-new-folder').onclick = () => {
  const parent = S.view.kind === 'folder' && S.view.id ? S.view.id : 'other';
  modal(`<h2>New folder in ${esc(pathOf(parent))}</h2><label>Name<input id="m-title" value="New folder"></label>
    <div class="btns"><button class="btn" data-close>Cancel</button><button class="btn primary" id="m-ok">Create</button></div>`);
  $('#m-title').select();
  const go = async () => { await api.cmd('bm:op', 'folder', { parent, title: $('#m-title').value }); closeModal(); S.open.add(parent); load(); };
  $('#m-ok').onclick = go;
  $('#m-title').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
};

// ---------- import, export, backups ----------
$('#imp').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const r = await api.cmd('bm:import-any', await file.text());
  if (!r.ok) { toast(`Could not import: ${r.error}`); return; }
  await load();
  toast(`Imported ${r.added} bookmark${r.added === 1 ? '' : 's'} (${r.kind}). Folders were kept; addresses you already had in the same folder were skipped.`);
});
$('#b-export-all').onclick = () => {
  modal(`<h2>Export all bookmarks</h2><p>HTML opens in Chrome, Edge, Firefox, Safari and Brave (their "Import bookmarks" option). JSON keeps Ferna's tags and read status too.</p>
    <div class="btns"><button class="btn" data-close>Cancel</button><button class="btn" id="m-json">JSON</button><button class="btn primary" id="m-html">HTML</button></div>`);
  const go = async fmt => { closeModal(); download(await api.cmd('bm:export-sel', null, fmt), `ferna-bookmarks-${new Date().toISOString().slice(0, 10)}.${fmt}`, fmt === 'json' ? 'application/json' : 'text/html'); };
  $('#m-json').onclick = () => go('json');
  $('#m-html').onclick = () => go('html');
};
$('#b-backups').onclick = () => backupsDialog();
function backupsDialog() {
  const bs = D.backups || [];
  const days = D.settings.days, keep = D.settings.keep;
  modal(`<h2>Bookmark backups</h2><p>A JSON copy of all bookmarks (with folders, tags and read status) is saved automatically.</p>
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      <label>Back up<select id="m-days">${[[0, 'Never'], [1, 'Every day'], [3, 'Every 3 days'], [7, 'Every week'], [30, 'Every month']].map(([v, t]) => `<option value="${v}" ${v === days ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Keep<select id="m-keep">${[5, 14, 30, 60, 365].map(v => `<option value="${v}" ${v === keep ? 'selected' : ''}>${v} backups</option>`).join('')}</select></label>
    </div>
    <div class="blist">${bs.length ? bs.map(b => `<div class="b"><span class="grow">${esc(b.name)}</span><span class="muted">${esc(new Date(b.at).toLocaleString())}</span>
      <button class="btn small" data-merge="${esc(b.name)}" title="Add what is missing">Merge</button><button class="btn small danger" data-replace="${esc(b.name)}" title="Replace all bookmarks with this backup">Restore</button></div>`).join('') : '<div class="b muted">No backups yet.</div>'}</div>
    <div class="btns"><button class="btn" id="m-folder">Open folder</button><button class="btn" id="m-now">Back up now</button><button class="btn primary" data-close>Done</button></div>`);
  const saveSet = () => api.cmd('bm:backup-settings', Number($('#m-days').value), Number($('#m-keep').value)).then(load);
  $('#m-days').onchange = saveSet; $('#m-keep').onchange = saveSet;
  $('#m-folder').onclick = () => api.cmd('bm:backup-folder');
  $('#m-now').onclick = async () => { await api.cmd('bm:backup-now'); await load(); backupsDialog(); toast('Backup saved.'); };
  $$('[data-merge]', $('#modal')).forEach(b => { b.onclick = async () => { const r = await api.cmd('bm:backup-restore', b.dataset.merge, 'merge'); closeModal(); await load(); toast(r.ok ? `Merged: ${r.added} bookmark${r.added === 1 ? '' : 's'} added.` : `Could not restore: ${r.error}`); }; });
  $$('[data-replace]', $('#modal')).forEach(b => {
    b.onclick = () => {
      if (!confirm(`Replace all your bookmarks with ${b.dataset.replace}? Your current bookmarks are backed up first.`)) return;
      api.cmd('bm:backup-restore', b.dataset.replace, 'replace').then(async r => { closeModal(); await load(); toast(r.ok ? `Restored ${r.added} bookmarks.` : `Could not restore: ${r.error}`); });
    };
  });
}

function download(text, name, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- modal and toast ----------
function modal(html) {
  $('#modal').innerHTML = html;
  $('#modal-back').hidden = false;
  $$('[data-close]', $('#modal')).forEach(b => { b.onclick = closeModal; });
}
function closeModal() { $('#modal-back').hidden = true; $('#modal').innerHTML = ''; }
$('#modal-back').addEventListener('mousedown', e => { if (e.target.id === 'modal-back') closeModal(); });

let toastT = null;
function toast(text, undoToken) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(text)}</span>${undoToken ? '<button id="t-undo">Undo</button>' : ''}<button id="t-x" title="Close">✕</button>`;
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, undoToken ? 10000 : 5000);
  $('#t-x').onclick = () => { t.hidden = true; };
  const u = $('#t-undo');
  if (u) u.onclick = async () => { t.hidden = true; const r = await api.cmd('bm:bulk', 'undo', { token: undoToken }); D = r.data; render(); toast(r.ok ? 'Restored.' : 'Nothing to undo.'); };
}

// Open straight into a view: ferna://bookmarks/#reading, #unread, #dead, #dupes
function fromHash() {
  const h = location.hash.slice(1);
  if (['bar', 'other', 'reading'].includes(h)) S.view = { kind: 'folder', id: h };
  else if (['unread', 'read', 'dead', 'error', 'unchecked', 'dupes'].includes(h)) S.view = { kind: 'smart', id: h };
}
window.addEventListener('hashchange', () => { fromHash(); render(); });
fromHash();
load();
