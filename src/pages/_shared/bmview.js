'use strict';
// Bookmarks browser in the style of Ease Bookmarks: folders you walk into and out of, a
// breadcrumb, search across everything, open (new tab / this tab / background), edit, delete,
// new folder, add the current page, and drag and drop to reorder or file into folders.
// Used by the toolbar popup, inside the Ferna Tabs list (Alt+Shift+L → Bookmarks) and on the
// bookmarks manager page. Talks to the browser through bm:tree, bm:op and bm:go.
(function () {
  const { icon, esc, faviconHtml, hostOf } = FK;
  const ROOT_ORDER = ['bar', 'other', 'reading'];
  let lastFolder = null; // remembered between openings within this page

  function looksLikeAddress(t) {
    if (!t || /\s/.test(t)) return false;
    return /^(https?|file):\/\/\S+$/i.test(t) || /^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/.*)?$/i.test(t) || /^[^/?#:]+\.[a-z]{2,63}(:\d+)?([/?#].*)?$/i.test(t);
  }

  function create(o) {
    const api = o.api;
    const S = { items: [], roots: { bar: 'Bookmarks bar', other: 'Other bookmarks' }, folder: o.folder !== undefined && o.folder !== null ? o.folder : lastFolder, q: '', raw: '', sel: 0, rows: [], editing: null, confirm: null, undo: null, drag: null };
    const host = o.host;
    host.classList.add('bmv');
    host.innerHTML = `${o.embedded ? '' : `<div class="bmv-head">
        <div class="bmv-search">${icon('search')}<input class="bmv-q" placeholder="Search bookmarks" aria-label="Search bookmarks"></div>
        ${o.page ? `<button class="bmv-tool" data-tool="add" title="Bookmark this page here">${icon('star')}</button>` : ''}
        <button class="bmv-tool" data-tool="folder" title="New folder here">${icon('newfolder')}</button>
        ${o.manage ? `<button class="bmv-tool" data-tool="manage" title="Bookmark manager (import, export)">${icon('menu')}</button>` : ''}
      </div>`}
      <div class="bmv-crumbs" role="navigation" aria-label="Folder"></div>
      <div class="bmv-list" role="listbox" tabindex="-1"></div>
      <div class="bmv-undo" hidden></div>
      ${o.embedded ? '' : '<div class="bmv-foot"><span><kbd>Enter</kbd> new tab · <kbd>⇧ Enter</kbd> this tab · <kbd>→</kbd><kbd>←</kbd> folders · <kbd>F2</kbd> edit · <kbd>Del</kbd> delete</span></div>'}`;
    const input = o.search || host.querySelector('.bmv-q');
    const list = host.querySelector('.bmv-list');
    const crumbs = host.querySelector('.bmv-crumbs');
    const undoBar = host.querySelector('.bmv-undo');

    const byId = id => S.items.find(n => n.id === id);
    const isFolder = n => n && n.type === 'folder';
    const kids = p => S.items.filter(n => (n.folder || 'other') === p);
    const countIn = p => kids(p).length;
    function pathOf(id) {
      const out = [];
      for (let g = 0; g < 64 && id; g++) {
        if (S.roots[id]) { out.unshift({ id, title: S.roots[id] }); break; }
        const f = byId(id); if (!f) break;
        out.unshift({ id: f.id, title: f.title }); id = f.folder;
      }
      return out;
    }

    async function load() {
      const r = await api.cmd('bm:tree');
      S.items = r.items; S.roots = r.roots || S.roots;
      if (S.folder && !S.roots[S.folder] && !isFolder(byId(S.folder))) S.folder = null;
      render();
    }
    async function op(name, args) {
      const r = await api.cmd('bm:op', name, args);
      S.items = r.items;
      render();
      return r.ok;
    }

    function buildRows() {
      const rows = [];
      if (S.q) {
        const terms = S.q.split(/\s+/).filter(Boolean);
        const hit = n => terms.every(t => (n.title || '').toLowerCase().includes(t) || (n.url || '').toLowerCase().includes(t));
        S.items.filter(hit).slice(0, 300).forEach(n => rows.push({ kind: isFolder(n) ? 'folder' : 'bm', n, path: pathOf(n.folder).map(p => p.title).join(' › ') }));
        if (o.webFallback !== false) {
          const text = S.raw.trim();
          const search = { kind: 'search', text };
          if (looksLikeAddress(text)) { rows.unshift({ kind: 'go', text }); rows.push(search); }
          else if (!rows.length) rows.unshift(search);
          else rows.push(search);
        }
        return rows;
      }
      if (!S.folder) {
        ROOT_ORDER.filter(id => id !== 'reading' || countIn(id)).forEach(id => rows.push({ kind: 'root', id }));
        return rows;
      }
      const parent = S.roots[S.folder] ? null : byId(S.folder);
      rows.push({ kind: 'up', to: parent ? parent.folder : null });
      kids(S.folder).forEach(n => rows.push({ kind: isFolder(n) ? 'folder' : 'bm', n }));
      return rows;
    }

    function rowHtml(r, i) {
      const sel = i === S.sel ? ' sel' : '';
      if (r.kind === 'up') return `<div class="bmv-row up${sel}" data-i="${i}" role="option">${icon('back')}<span class="t">Back</span><span class="s">${esc(r.to ? (S.roots[r.to] || (byId(r.to) || {}).title || '') : 'All bookmarks')}</span></div>`;
      if (r.kind === 'root') return `<div class="bmv-row folder${sel}" data-i="${i}" data-drop="${r.id}" role="option"><span class="fi">${icon(r.id === 'bar' ? 'star' : r.id === 'reading' ? 'book' : 'folder')}</span><span class="t">${esc(S.roots[r.id])}</span><span class="s">${countIn(r.id)}</span>${icon('right')}</div>`;
      if (r.kind === 'go' || r.kind === 'search') {
        const label = r.kind === 'go' ? `Go to ${r.text}` : `Search ${o.engine ? `with ${o.engine} ` : 'the web '}for “${r.text}”`;
        return `<div class="bmv-row web${sel}" data-i="${i}" role="option"><span class="fi">${icon(r.kind === 'go' ? 'globe' : 'search')}</span><span class="t">${esc(label)}</span></div>`;
      }
      const n = r.n;
      if (S.editing === n.id) {
        return `<div class="bmv-row editing${sel}" data-i="${i}">
          <span class="fi">${isFolder(n) ? icon('folder') : faviconHtml(n.url, '')}</span>
          <div class="bmv-edit"><input class="e-title" value="${esc(n.title)}" aria-label="Name">${isFolder(n) ? '' : `<input class="e-url" value="${esc(n.url)}" aria-label="Address">`}</div>
          <button class="bmv-btn primary" data-act="save">Save</button><button class="bmv-btn" data-act="cancel">Cancel</button></div>`;
      }
      if (S.confirm === n.id) {
        const c = isFolder(n) ? S.items.filter(x => x !== n && pathOf(x.folder).some(p => p.id === n.id)).length : 0;
        return `<div class="bmv-row confirm${sel}" data-i="${i}"><span class="fi">${icon('trash')}</span><span class="t">Delete “${esc(n.title)}”${c ? ` and the ${c} item${c === 1 ? '' : 's'} in it` : ''}?</span>
          <button class="bmv-btn danger" data-act="del-yes">Delete</button><button class="bmv-btn" data-act="cancel">Cancel</button></div>`;
      }
      const sub = r.path ? r.path : isFolder(n) ? String(countIn(n.id)) : hostOf(n.url);
      return `<div class="bmv-row ${isFolder(n) ? 'folder' : 'bm'}${sel}" data-i="${i}" draggable="true" ${isFolder(n) ? `data-drop="${esc(n.id)}"` : ''} role="option" title="${esc(isFolder(n) ? n.title : `${n.title}\n${n.url}`)}">
        <span class="fi">${isFolder(n) ? icon('folder') : faviconHtml(n.url, '')}</span><span class="t">${esc(n.title || n.url)}</span><span class="s">${esc(sub)}</span>
        <span class="acts"><button class="bmv-act" data-act="edit" title="Edit (F2)">${icon('edit')}</button><button class="bmv-act" data-act="del" title="Delete (Del)">${icon('trash')}</button></span>
        ${isFolder(n) ? icon('right') : ''}</div>`;
    }

    function render() {
      S.rows = buildRows();
      S.sel = Math.max(0, Math.min(S.sel, S.rows.length - 1));
      const path = S.q ? [{ id: '', title: `Search: ${S.raw.trim()}` }] : [{ id: null, title: 'Bookmarks' }, ...(S.folder ? pathOf(S.folder) : [])];
      crumbs.innerHTML = path.map((p, k) => `<button class="crumb${k === path.length - 1 ? ' cur' : ''}" ${p.id === '' ? 'disabled' : `data-crumb="${esc(p.id || '')}"`}>${esc(p.title)}</button>`).join(`<span class="sep">${icon('right')}</span>`);
      const body = S.rows.map(rowHtml).join('');
      list.innerHTML = body || `<div class="bmv-empty">${S.folder ? 'This folder is empty.' : 'No bookmarks yet.'}${o.page ? ' Press ★ to add this page.' : ''}</div>`;
      const se = list.querySelector('.sel');
      if (se) se.scrollIntoView({ block: 'nearest' });
      const ed = list.querySelector('.editing .e-title');
      if (ed && document.activeElement !== ed && !list.querySelector('.editing input:focus')) { ed.focus(); ed.select(); }
      undoBar.hidden = !S.undo;
      if (S.undo) undoBar.innerHTML = `<span>Deleted “${esc(S.undo.n.title)}”.</span><button class="bmv-btn" data-act="undo">Undo</button>`;
      if (o.onRender) o.onRender(S);
    }

    function go(folder) { S.folder = folder; lastFolder = folder; S.sel = folder ? 1 : 0; S.editing = null; S.confirm = null; render(); }

    function activate(i, how = 'new') {
      const r = S.rows[i];
      if (!r) return;
      if (r.kind === 'up') return go(r.to);
      if (r.kind === 'root') return go(r.id);
      if (r.kind === 'folder') { if (S.q) { S.q = ''; S.raw = ''; if (input) input.value = ''; } return go(r.n.id); }
      if (r.kind === 'bm') return api.cmd('bm:go', r.n.url, how);
      if (r.kind === 'go' || r.kind === 'search') return api.cmd('overlay:web', r.kind, r.text, how !== 'current').catch(() => api.cmd('bm:go', r.text, how));
    }

    async function save(row) {
      const n = S.rows[Number(row.dataset.i)].n;
      const title = row.querySelector('.e-title').value.trim();
      const url = row.querySelector('.e-url') ? row.querySelector('.e-url').value.trim() : undefined;
      S.editing = null;
      const ok = await op('update', { id: n.id, title: title || n.title, ...(url !== undefined ? { url } : {}) });
      if (!ok && o.toast) o.toast('That address is not valid.');
    }
    async function del(n) {
      const sib = kids(n.folder);
      S.confirm = null;
      if (!isFolder(n)) S.undo = { n: { ...n }, index: sib.indexOf(n) };
      await op('delete', { id: n.id });
    }

    // ---------- events ----------
    host.addEventListener('click', async e => {
      const tool = e.target.closest('[data-tool]');
      if (tool) {
        const parent = S.folder || 'bar';
        if (tool.dataset.tool === 'add' && o.page) {
          const exists = S.items.find(n => n.url === o.page.url);
          if (exists) { go(exists.folder); S.sel = S.rows.findIndex(r => r.n === byId(exists.id)); render(); if (o.toast) o.toast('Already bookmarked here.'); return; }
          await op('add', { parent, url: o.page.url, title: o.page.title });
          if (!S.folder) go('bar'); else render();
          const just = S.items.find(n => n.url === o.page.url);
          S.sel = S.rows.findIndex(r => r.n && r.n.id === just.id); render();
        } else if (tool.dataset.tool === 'folder') {
          await op('folder', { parent, title: 'New folder' });
          if (!S.folder) go(parent);
          const f = kids(parent).filter(isFolder).pop();
          if (f) { S.editing = f.id; S.sel = S.rows.findIndex(r => r.n === f); render(); }
        } else if (tool.dataset.tool === 'manage') api.cmd('bm:manage').catch(() => {});
        return;
      }
      const cr = e.target.closest('[data-crumb]');
      if (cr) return go(cr.dataset.crumb || null);
      const act = e.target.closest('[data-act]');
      if (act) {
        e.stopPropagation();
        const row = act.closest('.bmv-row');
        const r = row ? S.rows[Number(row.dataset.i)] : null;
        if (act.dataset.act === 'edit') { S.editing = r.n.id; S.confirm = null; render(); }
        else if (act.dataset.act === 'save') save(row);
        else if (act.dataset.act === 'cancel') { S.editing = null; S.confirm = null; render(); }
        else if (act.dataset.act === 'del') { if (isFolder(r.n)) { S.confirm = r.n.id; render(); } else del(r.n); }
        else if (act.dataset.act === 'del-yes') del(r.n);
        else if (act.dataset.act === 'undo' && S.undo) { const u = S.undo; S.undo = null; await op('add', { parent: u.n.folder, url: u.n.url, title: u.n.title, index: u.index }); }
        return;
      }
      const row = e.target.closest('.bmv-row');
      if (row && !row.classList.contains('editing') && !row.classList.contains('confirm')) {
        S.sel = Number(row.dataset.i);
        activate(S.sel, e.shiftKey ? 'current' : (e.ctrlKey || e.metaKey) ? 'background' : 'new');
      }
    });
    host.addEventListener('auxclick', e => {
      const row = e.target.closest('.bmv-row');
      if (row && e.button === 1) { const r = S.rows[Number(row.dataset.i)]; if (r && r.kind === 'bm') api.cmd('bm:go', r.n.url, 'background'); }
    });
    host.addEventListener('keydown', e => {
      const row = e.target.closest && e.target.closest('.bmv-row.editing');
      if (!row) return;
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); save(row); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); S.editing = null; render(); }
    }, true);

    // Drag and drop: reorder, or drop on a folder to file it there.
    list.addEventListener('dragstart', e => {
      const row = e.target.closest('.bmv-row[draggable]');
      if (!row) return;
      S.drag = S.rows[Number(row.dataset.i)].n.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', S.drag);
      row.classList.add('dragging');
    });
    list.addEventListener('dragend', () => { S.drag = null; list.querySelectorAll('.drop-into,.drop-before,.drop-after,.dragging').forEach(x => x.classList.remove('drop-into', 'drop-before', 'drop-after', 'dragging')); });
    function dropTarget(e) {
      const row = e.target.closest('.bmv-row');
      if (!row || !S.drag) return null;
      const r = S.rows[Number(row.dataset.i)];
      if (!r || r.kind === 'web' || r.kind === 'go' || r.kind === 'search') return null;
      const box = row.getBoundingClientRect();
      const y = (e.clientY - box.top) / box.height;
      if (r.kind === 'root' || r.kind === 'up') return { row, into: r.kind === 'root' ? r.id : (r.to || null) };
      if (r.n.id === S.drag) return null;
      if (r.kind === 'folder' && y > 0.25 && y < 0.75) return { row, into: r.n.id };
      return { row, before: y <= 0.5, n: r.n };
    }
    list.addEventListener('dragover', e => {
      const t = dropTarget(e);
      list.querySelectorAll('.drop-into,.drop-before,.drop-after').forEach(x => x.classList.remove('drop-into', 'drop-before', 'drop-after'));
      if (!t || (t.into === null && !t.n)) return;
      e.preventDefault();
      t.row.classList.add(t.into !== undefined ? 'drop-into' : t.before ? 'drop-before' : 'drop-after');
    });
    list.addEventListener('drop', async e => {
      const t = dropTarget(e);
      if (!t) return;
      e.preventDefault();
      const id = S.drag; S.drag = null;
      if (t.into !== undefined) { if (t.into) await op('move', { id, parent: t.into }); return; }
      const parent = t.n.folder;
      const sib = kids(parent).filter(n => n.id !== id);
      const k = sib.indexOf(t.n) + (t.before ? 0 : 1);
      await op('move', { id, parent, index: k });
    });

    if (input && !o.embedded) input.addEventListener('input', () => setQuery(input.value));

    function setQuery(v) { S.raw = v; S.q = v.toLowerCase().trim(); S.sel = 0; S.editing = null; S.confirm = null; render(); }

    /** Keyboard handling; returns true when the key was used. */
    function keys(e) {
      if (S.editing) return false;
      const n = S.rows.length;
      const typing = e.target === input;
      if (e.key === 'ArrowDown') { e.preventDefault(); S.sel = Math.min(n - 1, S.sel + 1); render(); return true; }
      if (e.key === 'ArrowUp') { e.preventDefault(); S.sel = Math.max(0, S.sel - 1); render(); return true; }
      if (e.key === 'Enter') { e.preventDefault(); activate(S.sel, e.shiftKey ? 'current' : e.ctrlKey ? 'background' : 'new'); return true; }
      const r = S.rows[S.sel];
      if (e.key === 'ArrowRight' && (!typing || !input.value) && r && (r.kind === 'folder' || r.kind === 'root')) { e.preventDefault(); activate(S.sel); return true; }
      if ((e.key === 'ArrowLeft' || e.key === 'Backspace') && (!typing || !input.value) && S.folder && !S.q) {
        e.preventDefault();
        const parent = S.roots[S.folder] ? null : (byId(S.folder) || {}).folder || null;
        go(parent); return true;
      }
      if (e.key === 'F2' && r && r.n) { e.preventDefault(); S.editing = r.n.id; render(); return true; }
      if (e.key === 'Delete' && r && r.n && (!typing || !input.value)) { e.preventDefault(); if (isFolder(r.n)) { S.confirm = r.n.id; render(); } else del(r.n); return true; }
      return false;
    }

    load();
    return { keys, setQuery, reload: load, state: S, focus: () => input && input.focus() };
  }

  window.BMView = { create, looksLikeAddress };
})();
