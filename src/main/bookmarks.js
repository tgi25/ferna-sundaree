'use strict';
// Bookmarks with folders. One flat array keeps every node in display order:
//   bookmark { id, url, title, folder, ts }      folder = parent id
//   folder   { id, type: 'folder', title, folder, ts }
// The roots are virtual: 'bar' (Bookmarks bar), 'other' (Other bookmarks) and 'reading' (Reading list).
// Files written by earlier versions (bookmarks only, folder 'bar' | 'other') are valid as is.

const ROOTS = { bar: 'Bookmarks bar', other: 'Other bookmarks', reading: 'Reading list' };
const bmId = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const isFolder = n => n && n.type === 'folder';
const okUrl = u => typeof u === 'string' && /^(https?|file|ferna):/i.test(u) && u.length <= 4000;

function byId(items, id) { return items.find(n => n.id === id) || null; }
function isParent(items, id) { return id in ROOTS || isFolder(byId(items, id)); }
function children(items, parent) { return items.filter(n => (n.folder || 'other') === parent); }

/** Ids of a folder and everything inside it. */
function subtree(items, id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of items) if (!out.has(n.id) && out.has(n.folder)) { out.add(n.id); grew = true; }
  }
  return out;
}

/** Path of folder titles from a root down to (and including) the given parent. */
function pathOf(items, parent) {
  const out = [];
  let id = parent;
  for (let guard = 0; guard < 64 && id; guard++) {
    if (id in ROOTS) { out.unshift({ id, title: ROOTS[id] }); break; }
    const f = byId(items, id);
    if (!f) break;
    out.unshift({ id: f.id, title: f.title });
    id = f.folder;
  }
  return out;
}

/** Repair a loaded array: unknown parents go to Other bookmarks, cycles are broken. */
function repair(items) {
  const list = (Array.isArray(items) ? items : []).filter(n => n && typeof n.id === 'string' && (isFolder(n) || okUrl(n.url)));
  for (const n of list) if (!(n.folder in ROOTS) && !isFolder(byId(list, n.folder))) n.folder = 'other';
  for (const n of list) {
    if (!isFolder(n)) continue;
    // Walk up; reaching n again means a cycle.
    let id = n.folder;
    for (let guard = 0; guard < 64 && id && !(id in ROOTS); guard++) {
      if (id === n.id) { n.folder = 'other'; break; }
      const p = byId(list, id);
      id = p ? p.folder : 'other';
    }
  }
  return list;
}

function addBookmark(items, { parent = 'bar', url, title, index }) {
  if (!okUrl(url) || !isParent(items, parent)) return null;
  const n = { id: bmId(), url, title: String(title || url).slice(0, 500), folder: parent, ts: Date.now() };
  insertAt(items, n, parent, index);
  return n;
}

function addFolder(items, { parent = 'other', title, index }) {
  if (!isParent(items, parent)) return null;
  const n = { id: bmId(), type: 'folder', title: String(title || 'New folder').trim().slice(0, 200) || 'New folder', folder: parent, ts: Date.now() };
  insertAt(items, n, parent, index);
  return n;
}

/** Put a node into a parent at a position among its siblings (end when omitted). */
function insertAt(items, node, parent, index) {
  const sib = children(items, parent).filter(n => n !== node);
  node.folder = parent;
  const at = Number.isInteger(index) && index >= 0 && index < sib.length ? items.indexOf(sib[index]) : (sib.length ? items.indexOf(sib[sib.length - 1]) + 1 : items.length);
  items.splice(at, 0, node);
}

function move(items, id, parent, index) {
  const n = byId(items, id);
  if (!n || !isParent(items, parent)) return false;
  if (isFolder(n) && subtree(items, id).has(parent)) return false; // into itself
  items.splice(items.indexOf(n), 1);
  insertAt(items, n, parent, index);
  return true;
}

function update(items, id, patch) {
  const n = byId(items, id);
  if (!n) return false;
  if (typeof patch.title === 'string') n.title = patch.title.slice(0, 500);
  if (!isFolder(n) && typeof patch.url === 'string') { if (!okUrl(patch.url)) return false; n.url = patch.url; }
  if (typeof patch.folder === 'string' && patch.folder !== n.folder) return move(items, id, patch.folder, patch.index);
  if (Number.isInteger(patch.index)) return move(items, id, n.folder, patch.index);
  return true;
}

/** Remove a node (a folder with its contents); returns the remaining array. */
function remove(items, id) {
  const gone = subtree(items, id);
  return items.filter(n => !gone.has(n.id));
}

const unesc = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Import a Netscape bookmarks file (Chrome, Edge, Firefox exports), keeping folders. */
function importHtml(items, html) {
  const stack = []; // parent ids; null for a top-level container we map to a root
  let added = 0;
  let pendingFolder = null;
  const re = /<H3([^>]*)>([\s\S]*?)<\/H3>|<DL[^>]*>|<\/DL>|<A\s+([^>]*)>([\s\S]*?)<\/A>/gi;
  const current = () => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i]) return stack[i]; return 'other'; };
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0].slice(0, 3).toUpperCase();
    if (m[2] !== undefined) {
      const title = unesc(m[2].replace(/<[^>]+>/g, '')).trim();
      const depth = stack.length; // 0: inside the file's top <DL>? (set below)
      if (depth <= 1 && (/PERSONAL_TOOLBAR_FOLDER/i.test(m[1]) || /^(bookmarks bar|favorites bar|bookmarks toolbar|bookmark bar)$/i.test(title))) pendingFolder = 'bar';
      else if (depth <= 1 && /^(other bookmarks|other favorites|unsorted bookmarks)$/i.test(title)) pendingFolder = 'other';
      else if (depth <= 1 && /^reading ?list$/i.test(title)) pendingFolder = 'reading';
      else {
        const parent = current();
        const existing = children(items, parent).find(n => isFolder(n) && n.title === title);
        pendingFolder = existing ? existing.id : addFolder(items, { parent, title }).id;
      }
    } else if (tag === '<DL') {
      stack.push(pendingFolder);
      pendingFolder = null;
    } else if (tag === '</D') {
      stack.pop();
    } else if (m[3] !== undefined) {
      const href = /HREF="([^"]*)"/i.exec(m[3]);
      const url = href ? unesc(href[1]) : '';
      if (!okUrl(url) || /^ferna:/i.test(url)) continue;
      const parent = current();
      if (children(items, parent).some(n => n.url === url)) continue;
      addBookmark(items, { parent, url, title: unesc(m[4].replace(/<[^>]+>/g, '')).trim() || url });
      added++;
    }
  }
  return added;
}

function exportHtml(items) {
  const lines = ['<!DOCTYPE NETSCAPE-Bookmark-file-1>', '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">', '<TITLE>Bookmarks</TITLE>', '<H1>Bookmarks</H1>', '<DL><p>'];
  const walk = (parent, ind) => {
    for (const n of children(items, parent)) {
      if (isFolder(n)) {
        lines.push(`${ind}<DT><H3 ADD_DATE="${Math.round((n.ts || 0) / 1000)}">${esc(n.title)}</H3>`, `${ind}<DL><p>`);
        walk(n.id, ind + '    ');
        lines.push(`${ind}</DL><p>`);
      } else {
        lines.push(`${ind}<DT><A HREF="${esc(n.url)}" ADD_DATE="${Math.round((n.ts || 0) / 1000)}">${esc(n.title)}</A>`);
      }
    }
  };
  lines.push('    <DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>', '    <DL><p>');
  walk('bar', '        ');
  lines.push('    </DL><p>', '    <DT><H3>Other bookmarks</H3>', '    <DL><p>');
  walk('other', '        ');
  lines.push('    </DL><p>');
  if (children(items, 'reading').length) {
    lines.push('    <DT><H3>Reading list</H3>', '    <DL><p>');
    walk('reading', '        ');
    lines.push('    </DL><p>');
  }
  lines.push('</DL><p>', '');
  return lines.join('\n');
}

module.exports = { ROOTS, bmId, isFolder, okUrl, byId, children, subtree, pathOf, repair, addBookmark, addFolder, move, update, remove, importHtml, exportHtml };
