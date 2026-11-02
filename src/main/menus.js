'use strict';
// Native menus: the app menu (⋮), tab, common-bar, pinned-site, bookmark, shield and
// page context menus. Native menus draw above the page, need no extra view, and
// cannot be scripted by websites.

const { Menu, clipboard, shell } = require('electron');
const { hostOf, folderOf } = require('./workspaces');

function acc(ctx, cmd) {
  const k = ctx.shortcuts.map[cmd] && ctx.shortcuts.map[cmd].raw && ctx.shortcuts.map[cmd].raw[0];
  return k ? k.replace('Ctrl', 'CmdOrCtrl') : undefined;
}

function appMenu(win) {
  const ctx = win.ctx;
  const s = ctx.settings.data;
  const run = cmd => () => win.run(cmd);
  const pos = p => () => { ctx.setSetting('tabPosition', p); };
  return Menu.buildFromTemplate([
    { label: 'New tab', accelerator: acc(ctx, 'newTab'), registerAccelerator: false, click: run('newTab') },
    { label: 'New window', accelerator: acc(ctx, 'newWindow'), registerAccelerator: false, click: run('newWindow') },
    { label: 'New private window', accelerator: acc(ctx, 'privateWindow'), registerAccelerator: false, click: run('privateWindow') },
    { label: 'New private window with Tor', accelerator: acc(ctx, 'torWindow'), registerAccelerator: false, click: run('torWindow') },
    { label: `Profiles (${ctx.profile})`, submenu: ctx.profileMenu ? ctx.profileMenu(win) : [] },
    { label: 'Open file…', accelerator: acc(ctx, 'openFile'), registerAccelerator: false, click: run('openFile') },
    { label: 'Ferna PDF Reader', enabled: !!ctx.hasPdfReader, click: () => win.openInternal('ferna://pdf/viewer/viewer.html') },
    { type: 'separator' },
    ...(ctx.updater && ctx.updater.state.status === 'ready' ? [{ label: `Restart to update to ${ctx.updater.state.available.version}`, click: () => ctx.installUpdate() }, { type: 'separator' }] : []),
    { label: 'Tab Overview', accelerator: acc(ctx, 'tabOverview'), registerAccelerator: false, click: run('tabOverview') },
    { label: 'Bookmarks', accelerator: acc(ctx, 'bookmarksPanel'), registerAccelerator: false, click: run('bookmarksPanel') },
    { label: 'Bookmark manager', accelerator: acc(ctx, 'bookmarkManager'), registerAccelerator: false, click: run('bookmarkManager') },
    { label: 'Reading list', click: run('readingList') },
    { label: 'Passwords and autofill', click: run('passwords') },
    { label: 'AI assistant', accelerator: acc(ctx, 'assistant'), registerAccelerator: false, click: run('assistant') },
    { label: 'Split view', type: 'checkbox', checked: !!(win.active && win.inSplit(win.active.id)), accelerator: acc(ctx, 'splitView'), registerAccelerator: false, click: run('splitView') },
    { label: 'Media controls', accelerator: acc(ctx, 'mediaPanel'), registerAccelerator: false, click: run('mediaPanel') },
    { label: 'Task manager', accelerator: acc(ctx, 'taskManager'), registerAccelerator: false, click: run('taskManager') },
    { label: 'Picture-in-Picture', accelerator: acc(ctx, 'pip'), registerAccelerator: false, click: run('pip') },
    { label: 'Equalizer', accelerator: acc(ctx, 'equalizer'), registerAccelerator: false, click: run('equalizer') },
    { label: 'Tabs list at pointer', accelerator: acc(ctx, 'tabsAtPointer'), registerAccelerator: false, click: run('tabsAtPointer') },
    { label: 'Command palette', accelerator: acc(ctx, 'commandPalette'), registerAccelerator: false, click: run('commandPalette') },
    {
      label: 'Tab bar', submenu: [
        { label: 'Top', type: 'radio', checked: s.tabPosition === 'top', click: pos('top') },
        { label: 'Left', type: 'radio', checked: s.tabPosition === 'left', click: pos('left') },
        { label: 'Right', type: 'radio', checked: s.tabPosition === 'right', click: pos('right') },
        { type: 'separator' },
        { label: 'Show tab bar', type: 'checkbox', checked: !s.tabBarHidden, accelerator: acc(ctx, 'toggleTabBar'), registerAccelerator: false, click: run('toggleTabBar') },
        { label: 'Collapse vertical tab bar', type: 'checkbox', checked: !!s.verticalCollapsed, enabled: s.tabPosition !== 'top', accelerator: acc(ctx, 'collapseTabs'), registerAccelerator: false, click: run('collapseTabs') },
        { label: 'Only workspaces, favourites and pinned tabs', type: 'checkbox', checked: !!s.stripFavoritesOnly, accelerator: acc(ctx, 'favoritesOnly'), registerAccelerator: false, click: run('favoritesOnly') },
        { label: 'Show workspace names', type: 'checkbox', checked: !!s.wsShowNames, accelerator: acc(ctx, 'workspaceNames'), registerAccelerator: false, click: run('workspaceNames') },
      ],
    },
    { label: 'Show bookmarks bar', type: 'checkbox', checked: !s.bookmarksBarHidden, accelerator: acc(ctx, 'toggleBookmarksBar'), registerAccelerator: false, click: run('toggleBookmarksBar') },
    { label: 'Focus mode', type: 'checkbox', checked: !!win.focus, accelerator: acc(ctx, 'focusMode'), registerAccelerator: false, click: run('focusMode') },
    { type: 'separator' },
    {
      label: 'Screenshot', submenu: [
        { label: 'Visible area', accelerator: acc(ctx, 'shotVisible'), registerAccelerator: false, click: run('shotVisible') },
        { label: 'Entire page', accelerator: acc(ctx, 'shotFull'), registerAccelerator: false, click: run('shotFull') },
        { label: 'Select region', accelerator: acc(ctx, 'shotRegion'), registerAccelerator: false, click: run('shotRegion') },
        { label: 'Select element', accelerator: acc(ctx, 'shotElement'), registerAccelerator: false, click: run('shotElement') },
        { type: 'separator' },
        { label: 'Screenshot history', click: () => win.openInternal('ferna://shots/history.html') },
        { label: 'Open screenshots folder', click: () => shell.openPath(ctx.screenshotDir()) },
        { label: 'Screenshot settings…', click: () => win.openInternal('ferna://shots/options.html') },
      ],
    },
    { label: 'Find in page…', accelerator: acc(ctx, 'find'), registerAccelerator: false, click: run('find') },
    { label: 'Zoom', submenu: zoomItems(win) },
    { label: 'Full screen', accelerator: 'F11', registerAccelerator: false, click: run('fullscreen') },
    { label: 'Secure exam mode…', click: run('examMode') },
    { label: 'Parental controls…', click: run('parentalControls') },
    { label: 'Install this site as an app…', enabled: !!(win.active && /^https?:/.test(win.active.url || '')), click: run('installApp') },
    { label: 'Extensions', click: () => win.openInternal('ferna://extensions/') },
    { label: 'Print…', accelerator: acc(ctx, 'print'), registerAccelerator: false, click: run('print') },
    { label: 'Save page as…', accelerator: acc(ctx, 'savePage'), registerAccelerator: false, click: run('savePage') },
    { type: 'separator' },
    { label: 'History', accelerator: acc(ctx, 'history'), registerAccelerator: false, click: run('history') },
    { label: 'Downloads', accelerator: acc(ctx, 'downloads'), registerAccelerator: false, click: run('downloads') },
    { label: 'Bookmarks', accelerator: acc(ctx, 'bookmarkManager'), registerAccelerator: false, click: run('bookmarkManager') },
    { type: 'separator' },
    { label: 'Settings', click: () => win.openInternal('ferna://settings/') },
    { label: 'Developer tools', accelerator: 'F12', registerAccelerator: false, click: run('devtools') },
    { label: 'About Ferna Sundaree', click: () => win.openInternal('ferna://settings/#about') },
    { type: 'separator' },
    { label: 'Exit', click: () => ctx.quit() },
  ]);
}

function zoomItems(win) {
  const ctx = win.ctx;
  const run = cmd => () => win.run(cmd);
  const t = win.active;
  const z = t ? ctx.zoomDisplay(win, t) : { type: 'full' };
  return [
    { label: 'Zoom panel…', accelerator: acc(ctx, 'zoomPanel'), registerAccelerator: false, click: run('zoomPanel') },
    { type: 'separator' },
    { label: 'Zoom in', accelerator: acc(ctx, 'zoomIn'), registerAccelerator: false, click: run('zoomIn') },
    { label: 'Zoom out', accelerator: acc(ctx, 'zoomOut'), registerAccelerator: false, click: run('zoomOut') },
    { label: 'Reset zoom', accelerator: acc(ctx, 'zoomReset'), registerAccelerator: false, click: run('zoomReset') },
    { type: 'separator' },
    { label: 'Zoom text only', type: 'checkbox', checked: z.type === 'text', accelerator: acc(ctx, 'zoomType'), registerAccelerator: false, click: run('zoomType') },
    { label: 'AutoFit (fit to width)', accelerator: acc(ctx, 'zoomAutoFit'), registerAccelerator: false, click: run('zoomAutoFit') },
    { label: 'Reset minimum font size', accelerator: acc(ctx, 'fontReset'), registerAccelerator: false, click: run('fontReset') },
  ];
}

function workspaceSubmenu(win, onPick, { includeNone = false, current = null } = {}) {
  const ctx = win.ctx;
  const items = ctx.ws.data.workspaces.map(w => ({
    label: w.name, type: 'radio', checked: current === w.id, click: () => onPick(w.id),
  }));
  if (includeNone) items.push({ type: 'separator' }, { label: 'No workspace', type: 'radio', checked: current === 'none', click: () => onPick('none') });
  items.push({ type: 'separator' }, { label: 'New workspace…', click: () => win.promptNewWorkspace(onPick) });
  return items;
}

/** "Pin here", "Pin to ▸" and "Add to common bar" items for a tab (tab menu and page menu). */
function pinAndCommonItems(win, tab) {
  const ctx = win.ctx;
  const ok = /^(https?|file):/i.test(tab.url || '');
  const here = win.currentWs || '';
  const hereName = here ? `“${(ctx.ws.data.workspaces.find(w => w.id === here) || {}).name || ''}”` : 'All tabs';
  const pinnedHere = ok && ctx.findPin(here, tab.url) >= 0;
  const onCommon = ok && ctx.findCommon(tab.url) >= 0;
  const full = ctx.ws.data.common.length >= 20;
  const pinTo = [
    { label: 'All tabs', type: 'checkbox', checked: ok && ctx.findPin('', tab.url) >= 0, click: () => win.togglePin(tab, '') },
    ...(ctx.ws.data.workspaces.length ? [{ type: 'separator' }] : []),
    ...ctx.ws.data.workspaces.map(w => ({ label: w.name, type: 'checkbox', checked: ok && ctx.findPin(w.id, tab.url) >= 0, click: () => win.togglePin(tab, w.id) })),
    { type: 'separator' },
    { label: 'New workspace…', click: () => win.promptNewWorkspace(id => { ctx.pinSite(id, tab.url, tab.title); win.switchWorkspace(id); }) },
  ];
  return [
    { label: pinnedHere ? `Unpin from ${hereName}` : `Pin in ${hereName}`, enabled: ok, accelerator: acc(ctx, 'pinTab'), registerAccelerator: false, click: () => win.togglePin(tab) },
    { label: 'Pin to', enabled: ok, submenu: pinTo },
    { label: onCommon ? 'Remove from common bar' : full ? 'Add to common bar (full: 20 of 20)' : 'Add to common bar', enabled: ok && (onCommon || !full), accelerator: acc(ctx, 'addToCommon'), registerAccelerator: false, click: () => win.toggleCommon(tab) },
  ];
}

function tabMenu(win, tab) {
  const ctx = win.ctx;
  const idx = win.tabs.indexOf(tab);
  const isWeb = /^https?:/.test(tab.url || '');
  const wsId = win.tabWorkspace(tab);
  return Menu.buildFromTemplate([
    { label: 'New tab to the right', click: () => win.newTab(null, { index: idx + 1 }) },
    { type: 'separator' },
    { label: 'Reload', click: () => tab.view && tab.view.webContents.reload() },
    { label: 'Duplicate', click: () => win.newTab(tab.url, { index: idx + 1 }) },
    { label: tab.muted ? 'Unmute site' : 'Mute site', enabled: !!tab.view, click: () => win.setMuted(tab, !tab.muted) },
    { label: 'Keep loaded (never sleep)', type: 'checkbox', checked: !!tab.keepLoaded, click: () => { tab.keepLoaded = !tab.keepLoaded; win.pushState(); } },
    { label: 'Sleep now', enabled: !!tab.view && tab.id !== win.activeId && tab.kind === 'web', click: () => win.sleepTab(tab) },
    { type: 'separator' },
    win.inSplit(tab.id)
      ? { label: 'Leave split view', click: () => win.exitSplit() }
      : { label: tab.id === win.activeId ? 'Split view with the next tab' : 'Split view with the current tab', click: () => (tab.id === win.activeId ? win.splitWith(tab) : win.splitWith(win.active, tab)) },
    { type: 'separator' },
    ...pinAndCommonItems(win, tab),
    { label: 'Move to workspace', submenu: workspaceSubmenu(win, id => win.moveTabToWorkspace(tab, id), { includeNone: true, current: tab.wsOverride || wsId }) },
    { label: 'Copy address', click: () => clipboard.writeText(tab.url || '') },
    { type: 'separator' },
    { label: 'Close', click: () => win.closeTab(tab) },
    { label: 'Close other tabs', enabled: win.tabs.length > 1, click: () => win.tabs.filter(t => t !== tab).forEach(t => win.closeTab(t)) },
    { label: 'Close tabs to the right', enabled: idx < win.tabs.length - 1, click: () => win.tabs.slice(idx + 1).forEach(t => win.closeTab(t)) },
    { label: 'Reopen closed tab', enabled: win.closed.length > 0, click: () => win.run('reopenTab') },
  ]);
}

/** Right-click on the split view button: choose the tab to put next to this one. */
function splitMenu(win) {
  const t = win.active;
  if (!t) return null;
  const others = win.tabs.filter(x => x !== t).slice(0, 30);
  return Menu.buildFromTemplate([
    ...(win.split ? [{ label: 'Leave split view', click: () => win.exitSplit() }, { label: 'Swap sides', click: () => win.swapSplit() }, { label: 'Equal halves', click: () => win.setSplitRatio(0.5) }, { type: 'separator' }] : []),
    { label: 'Split with a new tab', click: () => win.splitWith(t, win.newTab(null, { activate: false, index: win.tabs.indexOf(t) + 1 })) },
    { type: 'separator' },
    ...others.map(x => ({ label: (x.title || x.url || 'Tab').slice(0, 60), click: () => win.splitWith(t, x) })),
  ]);
}

function commonMenu(win, index) {
  const ctx = win.ctx;
  const c = ctx.ws.data.common[index];
  if (!c) return null;
  return Menu.buildFromTemplate([
    { label: 'Open in new tab', click: () => win.newTab(c.url) },
    { label: 'Copy address', click: () => clipboard.writeText(c.url) },
    { type: 'separator' },
    { label: 'Move left', enabled: index > 0, click: () => ctx.moveCommon(index, index - 1) },
    { label: 'Move right', enabled: index < ctx.ws.data.common.length - 1, click: () => ctx.moveCommon(index, index + 1) },
    { label: 'Remove from common bar', click: () => ctx.removeCommon(index) },
  ]);
}

function pinnedMenu(win, wsId, index) {
  const ctx = win.ctx;
  const list = ctx.pinnedList(wsId || '');
  const p = list && list[index];
  if (!p) return null;
  const where = wsId ? 'workspace' : 'All tabs';
  const onCommon = ctx.findCommon(p.url) >= 0;
  return Menu.buildFromTemplate([
    { label: 'Open in new tab', click: () => win.newTab(p.url) },
    { label: 'Copy address', click: () => clipboard.writeText(p.url) },
    { type: 'separator' },
    { label: onCommon ? 'Already on the common bar' : 'Add to common bar', enabled: !onCommon && ctx.ws.data.common.length < 20, click: () => ctx.addCommon(p.url, p.title) },
    { label: 'Move up', enabled: index > 0, click: () => { list.splice(index - 1, 0, list.splice(index, 1)[0]); ctx.ws.save(); ctx.broadcast(); } },
    { label: 'Move down', enabled: index < list.length - 1, click: () => { list.splice(index + 1, 0, list.splice(index, 1)[0]); ctx.ws.save(); ctx.broadcast(); } },
    { label: `Unpin from ${where}`, click: () => ctx.unpinSite(wsId || '', index) },
  ]);
}

function workspaceMenu(win, wsId) {
  const ctx = win.ctx;
  const ws = ctx.ws.data.workspaces.find(w => w.id === wsId);
  const items = [
    { label: 'New workspace…', click: () => win.promptNewWorkspace(id => win.switchWorkspace(id)) },
    { label: 'Manage workspaces…', click: () => win.openInternal('ferna://settings/#workspaces') },
    { type: 'separator' },
    { label: 'Only workspaces, favourites and pinned tabs', type: 'checkbox', checked: !!ctx.settings.data.stripFavoritesOnly, click: () => win.run('favoritesOnly') },
    { label: 'Show workspace names', type: 'checkbox', checked: !!ctx.settings.data.wsShowNames, click: () => win.run('workspaceNames') },
  ];
  if (ws) {
    items.unshift(
      { label: `Rename “${ws.name}”…`, click: () => win.promptRenameWorkspace(ws.id) },
      { label: 'Change icon…', click: () => win.openInternal(`ferna://settings/#ws-${ws.id}`) },
      { label: 'Separate logins (own cookies, like a container)', type: 'checkbox', checked: !!ws.separate, click: () => ctx.setWorkspaceSeparate(ws.id, !ws.separate) },
      { label: `Delete “${ws.name}”`, click: () => ctx.deleteWorkspace(ws.id) },
      { type: 'separator' },
    );
  }
  return Menu.buildFromTemplate(items);
}

function bookmarkMenu(win, id) {
  const ctx = win.ctx;
  const b = ctx.bookmarks.data.items.find(x => x.id === id);
  if (!b) return null;
  if (b.type === 'folder') {
    const urls = ctx.bookmarks.data.items.filter(x => x.folder === b.id && x.url).map(x => x.url);
    return Menu.buildFromTemplate([
      { label: `Open all (${urls.length}) in new tabs`, enabled: urls.length > 0, click: () => urls.slice(0, 50).forEach(u => win.newTab(u, { activate: false })) },
      { label: 'Show in bookmarks popup', click: () => win.openBookmarksPanel(null, b.id) },
      { type: 'separator' },
      { label: 'Delete folder', click: () => ctx.deleteBookmark(id) },
    ]);
  }
  return Menu.buildFromTemplate([
    { label: 'Open in new tab', click: () => win.newTab(b.url) },
    { label: 'Open in new window', click: () => ctx.newWindow({ url: b.url }) },
    { label: 'Copy address', click: () => clipboard.writeText(b.url) },
    { type: 'separator' },
    { label: b.folder === 'bar' ? 'Move to Other bookmarks' : 'Move to bookmarks bar', click: () => ctx.updateBookmark(id, { folder: b.folder === 'bar' ? 'other' : 'bar' }) },
    { label: 'Edit in bookmarks popup', click: () => win.openBookmarksPanel(null, b.folder) },
    { label: 'Delete', click: () => ctx.deleteBookmark(id) },
  ]);
}

function shieldMenu(win, tab) {
  const ctx = win.ctx;
  const host = hostOf(tab && tab.url);
  const allowed = host && ctx.settings.data.blockerAllow.includes(host);
  const b = ctx.blocker;
  return Menu.buildFromTemplate([
    { label: `${tab ? tab.blocked || 0 : 0} trackers and ads blocked on this page`, enabled: false },
    { label: `Filter lists: ${b.status}${b.updated ? `, updated ${b.updated.toLocaleDateString()}` : ''}`, enabled: false },
    { type: 'separator' },
    { label: host ? `Block trackers and ads on ${host}` : 'Not a website', type: 'checkbox', checked: !!host && !allowed, enabled: !!host && ctx.settings.data.blocker, click: () => ctx.toggleBlockerAllow(host) },
    { label: 'Blocking on for all sites', type: 'checkbox', checked: !!ctx.settings.data.blocker, click: () => ctx.setSetting('blocker', !ctx.settings.data.blocker) },
    { label: 'Hide ad spaces and banners (cosmetic filtering)', type: 'checkbox', checked: ctx.settings.data.cosmeticFiltering !== false, enabled: !!ctx.settings.data.blocker, click: () => ctx.setSetting('cosmeticFiltering', ctx.settings.data.cosmeticFiltering === false) },
    { label: 'Block YouTube ads', type: 'checkbox', checked: ctx.settings.data.youtubeAds !== false, enabled: !!ctx.settings.data.blocker, click: () => ctx.setSetting('youtubeAds', ctx.settings.data.youtubeAds === false) },
    { label: 'Block pop-ups the page opens by itself', type: 'checkbox', checked: ctx.settings.data.popupBlocker !== false, click: () => ctx.setSetting('popupBlocker', ctx.settings.data.popupBlocker === false) },
    ...(tab && tab.blockedPopups && tab.blockedPopups.length ? [
      { type: 'separator' },
      { label: `Blocked pop-ups on this page (${tab.blockedPopups.length})`, enabled: false },
      ...tab.blockedPopups.slice().reverse().map(u => ({ label: `Open ${u.length > 70 ? u.slice(0, 70) + '…' : u}`, click: () => win.newTab(u, { index: win.tabs.indexOf(tab) + 1 }) })),
      { label: host ? `Always allow pop-ups on ${host}` : 'Always allow', enabled: !!host, click: () => { ctx.allowPopups(host); tab.blockedPopups.forEach(u => win.newTab(u)); tab.blockedPopups = []; } },
    ] : []),
    { type: 'separator' },
    { label: 'Hide an element on this page…', enabled: !!host, click: () => win.run('pickElement') },
    { label: `Safe browsing (phishing and malware warnings): ${ctx.settings.data.safeBrowsing !== false ? 'on' : 'off'}`, type: 'checkbox', checked: ctx.settings.data.safeBrowsing !== false, click: () => ctx.setSetting('safeBrowsing', ctx.settings.data.safeBrowsing === false) },
    { label: 'My filters…', click: () => win.openInternal('ferna://settings/#filters') },
    { type: 'separator' },
    { label: 'Update filter lists now', click: () => { ctx.blocker.refresh().then(() => win.pushState()).catch(() => {}); ctx.safety.refresh().catch(() => {}); } },
    { label: 'Privacy and security settings…', click: () => win.openInternal('ferna://settings/#privacy') },
  ]);
}

function shotMenu(win) {
  const ctx = win.ctx;
  const run = cmd => () => win.run(cmd);
  return Menu.buildFromTemplate([
    { label: 'Visible area', accelerator: acc(ctx, 'shotVisible'), registerAccelerator: false, click: run('shotVisible') },
    { label: 'Entire page', accelerator: acc(ctx, 'shotFull'), registerAccelerator: false, click: run('shotFull') },
    { label: 'Select region', accelerator: acc(ctx, 'shotRegion'), registerAccelerator: false, click: run('shotRegion') },
    { label: 'Select element', accelerator: acc(ctx, 'shotElement'), registerAccelerator: false, click: run('shotElement') },
    { type: 'separator' },
    { label: 'Screenshot history', click: () => win.openInternal('ferna://shots/history.html') },
    { label: 'Open screenshots folder', click: () => shell.openPath(ctx.screenshotDir()) },
    { label: 'Screenshot settings…', click: () => win.openInternal('ferna://shots/options.html') },
  ]);
}

function pageMenu(win, tab, p) {
  const t = [];
  if (p.linkURL) {
    t.push(
      { label: 'Open link in new tab', click: () => win.newTab(p.linkURL, { activate: false, index: win.tabs.indexOf(tab) + 1 }) },
      { label: 'Preview link (Shift+click)', click: () => win.openPeek(p.linkURL, tab) },
      { label: 'Open link in split view', click: () => { const t2 = win.newTab(p.linkURL, { activate: false, index: win.tabs.indexOf(tab) + 1, opener: tab }); win.splitWith(tab, t2); } },
      { label: 'Open link in new window', click: () => win.ctx.newWindow({ url: p.linkURL }) },
      { label: 'Open link in private window', click: () => win.ctx.newWindow({ url: p.linkURL, private: true }) },
      { label: 'Copy link address', click: () => clipboard.writeText(p.linkURL) },
      { label: 'Add link to reading list', click: () => { win.ctx.bmSvc.addToReadingList(p.linkURL, p.linkText || p.linkURL); win.sendUi('toast', { text: 'Added to your reading list.' }); } },
      { type: 'separator' },
    );
  }
  if (p.mediaType === 'image' && p.srcURL) {
    t.push(
      { label: 'Open image in new tab', click: () => win.newTab(p.srcURL, { activate: false }) },
      { label: 'Save image as…', click: () => tab.view.webContents.downloadURL(p.srcURL) },
      { label: 'Copy image', click: () => tab.view.webContents.copyImageAt(p.x, p.y) },
      { label: 'Copy image address', click: () => clipboard.writeText(p.srcURL) },
      { type: 'separator' },
    );
  }
  if (p.mediaType === 'video' || p.mediaType === 'audio') {
    t.push(
      ...(p.mediaType === 'video' ? [{ label: 'Picture-in-Picture', accelerator: acc(win.ctx, 'pip'), registerAccelerator: false, click: () => win.run('pip') }] : []),
      { label: 'Equalizer…', accelerator: acc(win.ctx, 'equalizer'), registerAccelerator: false, click: () => win.run('equalizer') },
      { type: 'separator' },
    );
  }
  if (p.isEditable) {
    if (p.misspelledWord && p.dictionarySuggestions.length) {
      p.dictionarySuggestions.slice(0, 5).forEach(s => t.push({ label: s, click: () => tab.view.webContents.replaceMisspelling(s) }));
    }
    if (p.misspelledWord) {
      t.push({ label: `Add “${p.misspelledWord}” to dictionary`, click: () => tab.view.webContents.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
      t.push({ type: 'separator' });
    }
    if (p.formControlType === 'input-password' || /password/i.test(p.inputFieldType || '')) {
      t.push({ label: 'Suggest a strong password', click: () => win.ctx.passwords.fillGenerated(win, tab) }, { label: 'Saved passwords…', click: () => win.openInternal('ferna://passwords/') }, { type: 'separator' });
    }
    t.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, { type: 'separator' });
  } else if (p.selectionText) {
    const q = p.selectionText.trim().slice(0, 200);
    t.push(
      { role: 'copy' },
      { label: `Search the web for “${q.length > 30 ? q.slice(0, 30) + '…' : q}”`, click: () => win.newTab(win.ctx.searchUrl(q), { index: win.tabs.indexOf(tab) + 1 }) },
      { label: 'Translate selection', click: () => win.ctx.translateText(win, tab, p.selectionText) },
      { label: 'Read aloud', click: () => win.ctx.pageFx.readAloud(win, tab, p.selectionText) },
      { label: 'Ask the AI assistant about this', click: () => win.ctx.askAssistant(win, { text: p.selectionText, action: 'explain' }) },
      { type: 'separator' },
    );
  }
  if (!p.linkURL && !p.isEditable && !p.selectionText) {
    t.push(
      { label: 'Back', enabled: tab.view.webContents.navigationHistory.canGoBack(), click: () => win.run('back') },
      { label: 'Forward', enabled: tab.view.webContents.navigationHistory.canGoForward(), click: () => win.run('forward') },
      { label: 'Reload', click: () => win.run('reload') },
      { type: 'separator' },
      ...pinAndCommonItems(win, tab),
      { type: 'separator' },
      { label: 'Screenshot of visible area', click: () => win.run('shotVisible') },
      { label: 'Screenshot of entire page', click: () => win.run('shotFull') },
      { label: 'Select region to capture', click: () => win.run('shotRegion') },
      { type: 'separator' },
      { label: 'Reading mode', accelerator: acc(win.ctx, 'readerMode'), registerAccelerator: false, enabled: /^https?:/.test(tab.url), click: () => win.run('readerMode') },
      { label: 'Read aloud', accelerator: acc(win.ctx, 'readAloud'), registerAccelerator: false, enabled: /^https?:/.test(tab.url), click: () => win.run('readAloud') },
      { label: 'Translate this page', accelerator: acc(win.ctx, 'translatePage'), registerAccelerator: false, enabled: /^https?:/.test(tab.url), click: () => win.run('translatePage') },
      { label: 'Summarise with the AI assistant', click: () => win.ctx.askAssistant(win, { action: 'summarize' }) },
      { label: 'Add page to reading list', accelerator: acc(win.ctx, 'addToReadingList'), registerAccelerator: false, enabled: /^https?:/.test(tab.url), click: () => win.run('addToReadingList') },
      { type: 'separator' },
      { label: 'Save page as…', click: () => win.run('savePage') },
      { label: 'Print…', click: () => win.run('print') },
      { label: 'View page source', enabled: /^https?:/.test(tab.url), click: () => win.newTab(`view-source:${tab.url}`) },
      { type: 'separator' },
    );
  }
  if (/^https?:/i.test(tab.url || '')) t.push({ label: 'Hide this element…', click: () => win.ctx.pageFx.pickElement(win, tab, { x: p.x, y: p.y }) });
  t.push({ label: 'Zoom', submenu: zoomItems(win) });
  const extItems = win.ctx.ext ? win.ctx.ext.contextMenuItems(tab.view.webContents, p) : [];
  if (extItems.length) { t.push({ type: 'separator' }); extItems.forEach(i => t.push(i)); t.push({ type: 'separator' }); }
  t.push({ label: 'Inspect', click: () => tab.view.webContents.inspectElement(p.x, p.y) });
  return Menu.buildFromTemplate(t);
}

module.exports = { splitMenu, appMenu, tabMenu, commonMenu, pinnedMenu, workspaceMenu, bookmarkMenu, shieldMenu, shotMenu, pageMenu, folderOf };
