'use strict';
// Window layout: where the tab strip, toolbar, bookmarks bar, find bar and the page sit.
// The window has no Windows title bar, so the window controls (minimise, maximise, close)
// sit on the tab strip when tabs are on top, or on the toolbar when tabs are vertical
// (one bar, as in Brave). Ctrl+Shift+H hides the tab bar together with those controls.
// Pure function, shared by the main process and the UI page.

const SIZES = { toolbar: 44, htabs: 38, bookmarks: 30, find: 40, collapsed: 52, edge: 5, minV: 160, maxV: 400 };

/**
 * @param {number} W content width
 * @param {number} H content height
 * @param {object} s  {position, tabBarHidden, bookmarksHidden, collapsed, vwidth, focus, findOpen,
 *                     revealTabs, revealToolbar, htmlFullscreen, hideToolbarWithTabs}
 */
function computeLayout(W, H, s) {
  const position = ['top', 'left', 'right'].includes(s.position) ? s.position : 'top';
  const controlsOn = position === 'top' ? 'tabs' : 'toolbar';
  const out = {
    position, W, H, controlsOn, windowControls: null,
    showTabs: false, showToolbar: false, showBookmarks: false, showFind: false,
    tabs: null, toolbar: null, bookmarks: null, find: null, content: null,
    edgeTabs: null, edgeToolbar: null,
  };
  if (s.htmlFullscreen) {
    out.content = { x: 0, y: 0, width: W, height: H };
    return out;
  }
  // Installed web app window: one slim bar (title, back, reload, window controls) and the page.
  if (s.appMode) {
    out.showToolbar = true; out.controlsOn = 'toolbar'; out.windowControls = 'toolbar';
    out.toolbar = { x: 0, y: 0, width: W, height: SIZES.toolbar };
    out.content = { x: 0, y: SIZES.toolbar, width: W, height: Math.max(1, H - SIZES.toolbar) };
    return out;
  }
  // The bar holding the window controls hides with the tab bar.
  const toolbarHiddenByTabs = !!s.tabBarHidden && (controlsOn === 'toolbar' || !!s.hideToolbarWithTabs);
  out.showTabs = (!s.tabBarHidden && !s.focus) || !!s.revealTabs;
  out.showToolbar = (!s.focus && !toolbarHiddenByTabs) || !!s.revealToolbar;
  out.showBookmarks = !s.bookmarksHidden && !s.focus;
  out.showFind = !!s.findOpen;

  let y = 0;
  let left = 0;
  let right = W;

  if (position === 'top') {
    if (out.showTabs) { out.tabs = { x: 0, y, width: W, height: SIZES.htabs }; y += SIZES.htabs; }
    else if (out.showToolbar) { out.edgeTabs = { x: 0, y, width: W, height: SIZES.edge }; y += SIZES.edge; }
  }
  if (out.showToolbar) { out.toolbar = { x: 0, y, width: W, height: SIZES.toolbar }; y += SIZES.toolbar; }
  else { out.edgeToolbar = { x: 0, y, width: W, height: SIZES.edge }; y += SIZES.edge; }
  if (out.showBookmarks) { out.bookmarks = { x: 0, y, width: W, height: SIZES.bookmarks }; y += SIZES.bookmarks; }

  if (position !== 'top') {
    const vw = s.collapsed ? SIZES.collapsed : Math.max(SIZES.minV, Math.min(SIZES.maxV, s.vwidth || 240));
    const h = Math.max(0, H - y);
    if (out.showTabs) {
      const x = position === 'left' ? 0 : W - vw;
      out.tabs = { x, y, width: vw, height: h };
      if (position === 'left') left = vw; else right = W - vw;
    } else {
      const x = position === 'left' ? 0 : W - SIZES.edge;
      out.edgeTabs = { x, y, width: SIZES.edge, height: h };
      if (position === 'left') left = SIZES.edge; else right = W - SIZES.edge;
    }
  }
  if (controlsOn === 'tabs' && out.tabs) out.windowControls = 'tabs';
  else if (controlsOn === 'toolbar' && out.toolbar) out.windowControls = 'toolbar';
  if (out.showFind) { out.find = { x: left, y, width: right - left, height: SIZES.find }; y += SIZES.find; }
  out.content = { x: left, y, width: Math.max(1, right - left), height: Math.max(1, H - y) };
  return out;
}

module.exports = { computeLayout, SIZES };
