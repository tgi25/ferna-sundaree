'use strict';
// Ferna Tabs arrangement rules, kept free of Electron so they can be unit-tested.
//
// A workspace owns the host names of its pinned sites plus explicit host rules;
// sub-domains count. A per-tab override wins. The common bar is shared by every
// workspace and stores the *folder* a page was in, so two accounts of one site
// (mail.google.com/mail/u/0/ and /u/1/) keep separate icons.

function parse(url) {
  try { return new URL(url); } catch { return null; }
}

/** The page a tab really shows: a PDF opened in Ferna PDF Reader is its file's own address. */
function pageUrlOf(url) {
  const m = /^ferna:\/\/pdf\/viewer\/viewer\.html\?(?:[^#]*&)?file=([^&#]+)/.exec(url || '');
  if (!m) return url || '';
  try { const f = decodeURIComponent(m[1]); return /^(https?|file):/i.test(f) ? f : url; } catch { return url; }
}
const isPdfUrl = url => /\.pdf([?#]|$)/i.test(url || '');

function hostOf(url) {
  const u = parse(url);
  return u && (u.protocol === 'http:' || u.protocol === 'https:') ? u.hostname.toLowerCase() : '';
}

/** Folder of a page: origin + path up to and including the last "/". */
function folderOf(url) {
  const u = parse(url);
  if (!u || !/^https?:$/.test(u.protocol)) return url || '';
  // A PDF stands for itself, not for the folder it is in.
  if (isPdfUrl(url)) return `${u.protocol}//${u.host.toLowerCase()}${u.pathname}`;
  const p = u.pathname.endsWith('/') ? u.pathname : u.pathname.slice(0, u.pathname.lastIndexOf('/') + 1);
  return `${u.protocol}//${u.host.toLowerCase()}${p || '/'}`;
}

/** "example.com" matches example.com and any sub-domain; "*.example.com" likewise. */
function hostMatches(rule, host) {
  if (!rule || !host) return false;
  const r = String(rule).trim().toLowerCase().replace(/^\*\./, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!r) return false;
  return host === r || host.endsWith(`.${r}`);
}

/** Does a page URL fall inside a stored folder (same scheme+host, path prefix)? */
function inFolder(folder, url) {
  const f = parse(folder);
  const u = parse(url);
  if (!f || !u) return false;
  if (f.host.toLowerCase() !== u.host.toLowerCase()) return false;
  return u.pathname.startsWith(f.pathname);
}

function workspaceHosts(ws) {
  const hosts = new Set();
  for (const p of ws.pinned || []) { const h = hostOf(p.url); if (h) hosts.add(h); }
  for (const r of ws.hosts || []) { if (String(r).trim()) hosts.add(String(r).trim().toLowerCase()); }
  return [...hosts];
}

/** id of the workspace a tab belongs to, or null. */
function workspaceOfTab(tab, workspaces) {
  if (tab.wsOverride === 'none') return null;
  if (tab.wsOverride && workspaces.some(w => w.id === tab.wsOverride)) return tab.wsOverride;
  const page = pageUrlOf(tab.url);
  const host = hostOf(page);
  if (!host) {
    // A local file belongs to the workspace that pinned it, or pinned a folder it is in
    // (as in Ferna Tabs: pin C:\\Notes\\ and every PDF opened from it joins the workspace).
    if (!/^file:/i.test(page)) return null;
    let best = null, len = -1;
    for (const ws of workspaces) {
      for (const p of ws.pinned || []) {
        const f = p.folder || folderOf(p.url);
        if (/^file:/i.test(f) && inFolder(f, page) && f.length > len) { best = ws.id; len = f.length; }
      }
    }
    return best;
  }
  for (const ws of workspaces) {
    if (workspaceHosts(ws).some(r => hostMatches(r, host))) return ws.id;
  }
  return null;
}

/** Badge text for common-bar entries that share a host: the /u/N/ account number, else 1, 2, 3… */
function commonBadges(common) {
  const byHost = new Map();
  common.forEach((c, i) => {
    const h = hostOf(c.url);
    if (!byHost.has(h)) byHost.set(h, []);
    byHost.get(h).push(i);
  });
  const badges = common.map(() => '');
  for (const idxs of byHost.values()) {
    if (idxs.length < 2) continue;
    idxs.forEach((i, n) => {
      const m = /\/u\/(\d+)\//.exec(common[i].folder || folderOf(common[i].url));
      badges[i] = m ? m[1] : String(n + 1);
    });
  }
  return badges;
}

/** Pick the best entry index for a tab among folder entries (longest folder wins). */
function bestFolderMatch(entries, url) {
  let best = -1;
  let len = -1;
  entries.forEach((e, i) => {
    const folder = e.folder || folderOf(e.url);
    if (inFolder(folder, url) && folder.length > len) { best = i; len = folder.length; }
  });
  return best;
}

/**
 * Build the three-part strip for one window.
 * @param {Array<{id:number,url:string,title?:string,wsOverride?:string}>} tabs  in strip order
 * @param {Array} workspaces
 * @param {Array<{url:string,title?:string,folder?:string}>} common
 * @param {string|null} currentWs  null = All tabs
 */
function buildStrip(tabs, workspaces, common, currentWs, { allPinned = false, allTabsPinned = [] } = {}) {
  const claimed = new Set();
  const badges = commonBadges(common);

  const ws = workspaces.find(w => w.id === currentWs) || null;
  const pinnedOut = [];
  // The current workspace's pinned sites. With "All" selected: the sites pinned in All tabs
  // (wsId ''), then, with allPinned set (favourites-only view), every workspace's pinned sites.
  const sources = ws ? [ws] : [{ id: '', pinned: allTabsPinned || [] }, ...(allPinned ? workspaces : [])];
  for (const w of sources) (w.pinned || []).forEach((p, i) => pinnedOut.push({ index: i, pin: p, tabId: null, wsId: w.id }));
  const pinFolders = pinnedOut.map(r => r.pin.folder || folderOf(r.pin.url));

  const commonOut = common.map((c, i) => ({ index: i, entry: c, badge: badges[i], tabId: null }));
  // Tabs showing exactly a common-bar page are matched first, so an entry shows its own page
  // rather than another page from the same folder.
  const exact = new Set(common.map(c => String(c.url).split('#')[0]));
  const ordered = [...tabs].sort((a, b) => exact.has(pageUrlOf(b.url).split('#')[0]) - exact.has(pageUrlOf(a.url).split('#')[0]));
  for (const t of ordered) {
    const u = pageUrlOf(t.url);
    const i = bestFolderMatch(common, u);
    if (i < 0 || commonOut[i].tabId !== null) continue;
    // A more specific pin (a pinned PDF inside a folder on the common bar) takes the tab instead.
    const cl = (common[i].folder || folderOf(common[i].url)).length;
    if (pinFolders.some(f => f.length > cl && inFolder(f, u))) continue;
    commonOut[i].tabId = t.id; claimed.add(t.id);
  }
  // The most specific pin claims a tab first (a pinned PDF before a pin on its folder).
  const byDepth = [...pinnedOut].sort((a, b) => (b.pin.folder || folderOf(b.pin.url)).length - (a.pin.folder || folderOf(a.pin.url)).length);
  // A page that is both on the common bar and pinned shows as open in both places: a pin takes
  // a tab no one else has if there is one, else the tab the common bar shows.
  const byCommon = new Set(claimed);
  const byPin = new Set();
  for (const row of byDepth) {
    const folder = row.pin.folder || folderOf(row.pin.url);
    const fits = tabs.filter(t => !byPin.has(t.id) && inFolder(folder, pageUrlOf(t.url)));
    const same = x => { const u = pageUrlOf(x.url); return u === row.pin.url || u.split('#')[0] === String(row.pin.url).split('#')[0]; };
    // The pinned page itself first, then a page in its folder no one else shows, then any.
    const t = fits.find(same) || fits.find(x => !byCommon.has(x.id)) || fits[0];
    if (t) { row.tabId = t.id; byPin.add(t.id); claimed.add(t.id); }
  }

  const listed = [];
  let noWorkspace = 0;
  for (const t of tabs) {
    const wid = workspaceOfTab(t, workspaces);
    if (wid === null) noWorkspace++;
    if (claimed.has(t.id)) continue;
    if (ws === null || wid === ws.id) listed.push(t.id);
  }
  return { common: commonOut, pinned: pinnedOut, tabs: listed, noWorkspace: ws ? noWorkspace : 0 };
}

function newWorkspace(name, color = '#2563eb', icon = '') {
  return { id: `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name, color, icon: cleanIcon(icon, name), pinned: [], hosts: [] };
}

/** A workspace glyph: one or two characters (an emoji, a letter); defaults to the name's initial. */
function cleanIcon(icon, name) {
  const g = typeof icon === 'string' ? [...icon.trim()].filter(ch => !/[\u0000-\u001f<>&"']/.test(ch)).slice(0, 2).join('') : '';
  if (g) return g;
  const first = [...String(name || '').trim()][0];
  return first ? first.toUpperCase() : '•';
}

/** An uploaded workspace picture: a small raster data: URL (no SVG), or undefined. */
const MAX_IMAGE = 16 * 1024;
function cleanImage(v) {
  return typeof v === 'string' && v.length <= MAX_IMAGE && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(v) ? v : undefined;
}

/**
 * Import a Ferna Tabs export file. Accepts the extension's export object
 * (workspaces + common bar) in its known shapes and returns
 * { workspaces, common } in Ferna Sundaree's schema.
 */
// Ferna Tabs stores a workspace colour as an index into this list.
const FERNA_TABS_COLORS = ['#0060df', '#c7611f', '#1c8c4a', '#8f2fbf', '#b5122a', '#0b7a8c', '#8a6d00', '#5a5f73'];

function site(p) {
  if (typeof p === 'string') return /^(https?|file):/i.test(p) ? { url: p.slice(0, 2000), title: '' } : null;
  if (!p || typeof p !== 'object') return null;
  const url = String(p.url || p.u || '');
  if (!/^(https?|file):/i.test(url)) return null;
  return { url: url.slice(0, 2000), title: String(p.title || p.t || '').slice(0, 120), folder: typeof p.folder === 'string' ? p.folder : undefined };
}

function colorOf(c, i) {
  if (Number.isInteger(c)) return FERNA_TABS_COLORS[c] || FERNA_TABS_COLORS[i % FERNA_TABS_COLORS.length];
  return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : FERNA_TABS_COLORS[i % FERNA_TABS_COLORS.length];
}

function importFernaTabs(obj) {
  const src = obj && (obj.data || obj);
  const wsIn = Array.isArray(src.workspaces) ? src.workspaces : Object.values(src.workspaces || {});
  let order = Array.isArray(src.order) ? src.order : null;
  if (order && order.length && wsIn.every(w => order.includes(w && w.id))) wsIn.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const icons = src.icons && typeof src.icons === 'object' ? src.icons : {}; // Ferna Tabs: { wsIcon_<id>: dataURL }
  const workspaces = wsIn.filter(w => w && typeof w === 'object').slice(0, 24).map((w, i) => ({
    id: typeof w.id === 'string' && w.id ? w.id.slice(0, 60) : newWorkspace('x').id,
    name: String(w.name || `Workspace ${i + 1}`).slice(0, 40),
    color: colorOf(w.color, i),
    icon: cleanIcon(w.icon, w.name || `Workspace ${i + 1}`),
    image: cleanImage(w.image) || cleanImage(icons[`wsIcon_${w.id}`]),
    pinned: (w.pinned || w.sites || []).map(site).filter(Boolean).slice(0, 60),
    hosts: (w.hosts || w.rules || []).map(String).filter(h => /^[*a-z0-9.-]+$/i.test(h)).slice(0, 200),
    ...(w.separate === true ? { separate: true } : {}), // own cookies and logins (container)
    ...(w.theme && typeof w.theme === 'object' ? { theme: Object.fromEntries(['accent', 'frame', 'toolbar'].filter(k => /^#[0-9a-f]{6}$/i.test(w.theme[k] || '')).map(k => [k, w.theme[k].toLowerCase()])) } : {}),
  }));
  const commonIn = Array.isArray(src.common) ? src.common : (src.common && src.common.sites) || src.commonBar || src.commonSites || [];
  const common = commonIn.map(site).filter(Boolean).map(c => ({ ...c, folder: c.folder || folderOf(c.url) })).slice(0, 20);
  const allPinned = (Array.isArray(src.allPinned) ? src.allPinned : []).map(site).filter(Boolean).slice(0, 60);
  return { workspaces, common, allPinned };
}

module.exports = {
  hostOf, folderOf, hostMatches, inFolder, workspaceHosts, workspaceOfTab,
  commonBadges, bestFolderMatch, buildStrip, newWorkspace, importFernaTabs, cleanIcon, cleanImage, pageUrlOf, isPdfUrl,
};
