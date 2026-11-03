'use strict';
// Keyboard shortcuts: a registry of commands with re-assignable accelerators,
// matched against Electron "before-input-event" input (layout-independent, by key code).

const DEFAULTS = {
  // Ferna requirements
  toggleTabBar: ['Ctrl+Shift+H'],
  toggleBookmarksBar: ['Ctrl+Shift+B'],
  cycleTabPosition: ['Ctrl+Shift+,'],
  collapseTabs: ['Ctrl+Shift+\\'],
  focusMode: ['Ctrl+Shift+F'],
  favoritesOnly: ['Alt+Shift+P'],
  pinTab: ['Alt+S'],
  pip: ['Alt+P'],
  pickElement: [],
  equalizer: ['Alt+Q'],
  bookmarksPanel: ['Ctrl+Shift+Y'],
  addToCommon: ['Alt+Shift+S'],
  workspaceNames: [],
  tabOverview: ['Ctrl+Shift+A'],
  tabsAtPointer: ['Alt+Shift+L'],
  nextWorkspace: ['Alt+Shift+.'],
  prevWorkspace: ['Alt+Shift+,'],
  commandPalette: ['Ctrl+K'],
  shotVisible: ['Alt+Shift+V'],
  shotFull: ['Alt+Shift+F'],
  shotRegion: ['Alt+Shift+R'],
  shotElement: ['Alt+Shift+E'],
  // 0.5
  splitView: ['Alt+Shift+D'], swapSplit: [], mediaPanel: ['Alt+M'], sleepTab: [], taskManager: ['Shift+Escape'],
  readerMode: ['F9'], readAloud: ['Ctrl+Shift+U'], translatePage: ['Alt+Shift+T'], assistant: ['Alt+A'],
  passwords: [], readingList: [], addToReadingList: ['Alt+R'], torWindow: [], installApp: [], examMode: [], parentalControls: [],
  // Standard browser commands
  newTab: ['Ctrl+T'],
  closeTab: ['Ctrl+W', 'Ctrl+F4'],
  reopenTab: ['Ctrl+Shift+T'],
  recentTab: ['Ctrl+Tab'],
  recentTabBack: ['Ctrl+Shift+Tab'],
  nextTab: ['Ctrl+PageDown'],
  prevTab: ['Ctrl+PageUp'],
  newWindow: ['Ctrl+N'],
  privateWindow: ['Ctrl+Shift+N'],
  focusAddress: ['Ctrl+L', 'Alt+D', 'F6'],
  find: ['Ctrl+F'],
  history: ['Ctrl+H'],
  downloads: ['Ctrl+J'],
  bookmark: ['Ctrl+D'],
  bookmarkManager: ['Ctrl+Shift+O'],
  zoomIn: ['Ctrl+=', 'Ctrl+Shift+='],
  zoomOut: ['Ctrl+-'],
  zoomReset: ['Ctrl+0'],
  zoomType: ['Ctrl+Alt+9'],
  zoomAutoFit: ['Ctrl+Alt+8'],
  fontReset: ['Ctrl+Alt+7'],
  zoomPanel: ['Alt+Z'],
  extensions: [],
  back: ['Alt+Left'],
  forward: ['Alt+Right'],
  reload: ['F5', 'Ctrl+R'],
  hardReload: ['Ctrl+F5', 'Ctrl+Shift+R'],
  devtools: ['F12', 'Ctrl+Shift+I'],
  print: ['Ctrl+P'],
  savePage: ['Ctrl+S'],
  openFile: ['Ctrl+O'],
  fullscreen: ['F11'],
  escape: ['Escape'],
  tab1: ['Ctrl+1'], tab2: ['Ctrl+2'], tab3: ['Ctrl+3'], tab4: ['Ctrl+4'],
  tab5: ['Ctrl+5'], tab6: ['Ctrl+6'], tab7: ['Ctrl+7'], tab8: ['Ctrl+8'], tabLast: ['Ctrl+9'],
};

const LABELS = {
  toggleTabBar: 'Hide/unhide tab bar', toggleBookmarksBar: 'Hide/unhide bookmarks bar',
  cycleTabPosition: 'Tab bar top / left / right', collapseTabs: 'Collapse vertical tab bar',
  focusMode: 'Focus mode (hide all bars)', favoritesOnly: 'Tab bar: only workspaces, favourites and pinned tabs', pinTab: 'Pin / unpin the tab here (workspace or All tabs)', pip: 'Picture-in-Picture (largest video)', pickElement: 'Hide an element on this page (element picker)', equalizer: 'Equalizer panel', bookmarksPanel: 'Bookmarks popup', addToCommon: 'Add / remove the tab on the common bar', workspaceNames: 'Show/hide workspace names', tabOverview: 'Tab Overview (all open pages)',
  tabsAtPointer: 'Tabs list at the pointer', nextWorkspace: 'Next workspace', prevWorkspace: 'Previous workspace',
  commandPalette: 'Command palette', shotVisible: 'Screenshot: visible area', shotFull: 'Screenshot: full page',
  shotRegion: 'Screenshot: select region', shotElement: 'Screenshot: select element',
  splitView: 'Split view on / off', swapSplit: 'Swap the two halves of split view', mediaPanel: 'Media controls (everything playing)',
  sleepTab: 'Put this tab to sleep', taskManager: 'Task manager', readerMode: 'Reading mode', readAloud: 'Read aloud',
  translatePage: 'Translate this page', assistant: 'AI assistant side panel', passwords: 'Passwords and autofill',
  examMode: 'Secure exam mode', parentalControls: 'Parental controls', readingList: 'Reading list', addToReadingList: 'Add this page to the reading list', torWindow: 'New private window with Tor', installApp: 'Install this site as an app',
  newTab: 'New tab', closeTab: 'Close tab', reopenTab: 'Reopen closed tab', recentTab: 'Previously used tab (hold Ctrl and press Tab again to go further back)', recentTabBack: 'Recently used tabs, the other way', nextTab: 'Next tab (strip order)', prevTab: 'Previous tab (strip order)',
  newWindow: 'New window', privateWindow: 'New private window', focusAddress: 'Address bar', find: 'Find in page',
  history: 'History', downloads: 'Downloads', bookmark: 'Bookmark this page', bookmarkManager: 'Bookmark manager',
  zoomIn: 'Zoom in', zoomOut: 'Zoom out', zoomReset: 'Reset zoom', zoomType: 'Zoom type: full / text only', zoomAutoFit: 'Zoom AutoFit (fit to width)', fontReset: 'Reset minimum font size', zoomPanel: 'Zoom panel', extensions: 'Extensions', back: 'Back', forward: 'Forward',
  reload: 'Reload', hardReload: 'Hard reload', devtools: 'Developer tools', print: 'Print', savePage: 'Save page as', openFile: 'Open file',
  fullscreen: 'Full screen', escape: 'Close panel / stop',
  tab1: 'Tab 1', tab2: 'Tab 2', tab3: 'Tab 3', tab4: 'Tab 4', tab5: 'Tab 5', tab6: 'Tab 6', tab7: 'Tab 7', tab8: 'Tab 8', tabLast: 'Last tab',
};

const KEY_TO_CODE = {
  ',': 'Comma', '.': 'Period', '\\': 'Backslash', '/': 'Slash', ';': 'Semicolon', "'": 'Quote',
  '[': 'BracketLeft', ']': 'BracketRight', '=': 'Equal', '-': 'Minus', '`': 'Backquote',
  LEFT: 'ArrowLeft', RIGHT: 'ArrowRight', UP: 'ArrowUp', DOWN: 'ArrowDown',
  TAB: 'Tab', ESCAPE: 'Escape', ESC: 'Escape', ENTER: 'Enter', SPACE: 'Space',
  PAGEUP: 'PageUp', PAGEDOWN: 'PageDown', HOME: 'Home', END: 'End', DELETE: 'Delete',
  BACKSPACE: 'Backspace', INSERT: 'Insert',
};

/** "Ctrl+Shift+," → {ctrl:true, shift:true, alt:false, meta:false, code:'Comma'} or null. */
function parseAccelerator(acc) {
  if (typeof acc !== 'string' || !acc.trim()) return null;
  const parts = acc.split('+');
  // A trailing "+" key ("Ctrl++") arrives as two empty parts.
  let key = parts.pop();
  if (key === '' && parts.length && parts[parts.length - 1] === '') { parts.pop(); key = '='; }
  const out = { ctrl: false, shift: false, alt: false, meta: false, code: '' };
  for (const p of parts) {
    const m = p.trim().toLowerCase();
    if (m === 'ctrl' || m === 'control' || m === 'cmdorctrl') out.ctrl = true;
    else if (m === 'shift') out.shift = true;
    else if (m === 'alt') out.alt = true;
    else if (m === 'meta' || m === 'win' || m === 'super') out.meta = true;
    else return null;
  }
  const k = key.trim();
  if (/^[a-z]$/i.test(k)) out.code = `Key${k.toUpperCase()}`;
  else if (/^[0-9]$/.test(k)) out.code = `Digit${k}`;
  else if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(k)) out.code = k.toUpperCase();
  else if (k.toUpperCase() in KEY_TO_CODE) out.code = KEY_TO_CODE[k.toUpperCase()];
  else if (k in KEY_TO_CODE) out.code = KEY_TO_CODE[k];
  else if (k === 'Plus') out.code = 'Equal';
  else return null;
  return out;
}

/** Normalise an input event into the same shape. Numpad +/- count as =/-. */
function inputCode(input) {
  let code = input.code || '';
  if (code === 'NumpadAdd') code = 'Equal';
  if (code === 'NumpadSubtract') code = 'Minus';
  if (/^Numpad[0-9]$/.test(code)) code = `Digit${code.slice(6)}`;
  return code;
}

function matches(spec, input) {
  return !!spec && spec.code === inputCode(input) && spec.ctrl === !!input.control &&
    spec.shift === !!input.shift && spec.alt === !!input.alt && spec.meta === !!input.meta;
}

class ShortcutRegistry {
  constructor(overrides = {}) { this.setOverrides(overrides); }

  setOverrides(overrides) {
    this.map = {};
    for (const [cmd, accs] of Object.entries(DEFAULTS)) {
      const list = Array.isArray(overrides[cmd]) ? overrides[cmd] : accs;
      this.map[cmd] = list.map(parseAccelerator).filter(Boolean);
      this.map[cmd].raw = list;
    }
  }

  /** Command name for a keyDown input, or null. */
  commandFor(input) {
    if (input.type !== 'keyDown') return null;
    for (const [cmd, specs] of Object.entries(this.map)) {
      if (specs.some(s => matches(s, input))) return cmd;
    }
    return null;
  }

  /** Returns the command that already uses acc (other than cmd), or null. */
  conflict(cmd, acc) {
    const spec = parseAccelerator(acc);
    if (!spec) return 'invalid';
    for (const [other, specs] of Object.entries(this.map)) {
      if (other === cmd) continue;
      if (specs.some(s => s.code === spec.code && s.ctrl === spec.ctrl && s.shift === spec.shift && s.alt === spec.alt && s.meta === spec.meta)) return other;
    }
    return null;
  }

  describe() {
    return Object.keys(DEFAULTS).map(cmd => ({ cmd, label: LABELS[cmd] || cmd, keys: this.map[cmd].raw }));
  }
}

module.exports = { DEFAULTS, LABELS, parseAccelerator, matches, ShortcutRegistry };
