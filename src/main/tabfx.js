'use strict';
// Tab features mixed into FernaWindow (see window.js):
//   split view (two tabs side by side in one window, resizable),
//   automatic Picture-in-Picture when you switch away from a playing video,
//   sleeping tabs (unload tabs you have not used for a while; they reload when opened),
//   link preview (Shift+click a link: the page opens in a floating card, not a new tab),
//   media controls for every tab that plays sound or video.

const { WebContentsView } = require('electron');
const media = require('./pagefx/media');

const liveWc = v => { const wc = v && v.webContents; return wc && !wc.isDestroyed() ? wc : null; };
const GAP = 6;

const mixin = {
  // ---------- split view ----------
  inSplit(id) { return !!this.split && (this.split.a === id || this.split.b === id); },
  splitPartner(tab) {
    if (!tab || !this.inSplit(tab.id)) return null;
    const other = this.split.a === tab.id ? this.split.b : this.split.a;
    return this.tabs.find(t => t.id === other) || null;
  },
  /** Put `tab` (left) and `other` (right) side by side. No `other`: the next tab, or a new one. */
  splitWith(tab, other) {
    if (!tab) return;
    if (this.split) this.exitSplit();
    if (!other || other === tab) {
      const order = this.visibleOrder().filter(id => id !== tab.id);
      const next = order[order.indexOf(tab.id) + 1] || order.find(id => id !== tab.id);
      other = next ? this.tabs.find(t => t.id === next) : null;
      if (!other) other = this.newTab(require('./window').NEWTAB, { activate: false, index: this.tabs.indexOf(tab) + 1 });
    }
    this.split = { a: tab.id, b: other.id };
    this.ensureView(other);
    this.activate(tab);
    this.ctx.saveSessionSoon();
  },
  exitSplit() {
    if (!this.split) return;
    const active = this.active;
    const ids = [this.split.a, this.split.b];
    this.split = null;
    for (const id of ids) {
      const t = this.tabs.find(x => x.id === id);
      if (t && t !== active && t.view && !this.win.isDestroyed()) this.win.contentView.removeChildView(t.view);
    }
    this.relayout();
    this.pushState();
  },
  swapSplit() {
    if (!this.split) return;
    this.split = { a: this.split.b, b: this.split.a };
    this.relayout();
  },
  setSplitRatio(r) {
    if (!Number.isFinite(r)) return;
    this.ctx.settings.set('splitRatio', Math.max(0.2, Math.min(0.8, r)));
    this.relayout();
  },
  /** Page rectangles for the two halves of the content area. */
  splitRects(content) {
    const r = Math.max(0.2, Math.min(0.8, Number(this.ctx.settings.data.splitRatio) || 0.5));
    const wa = Math.round((content.width - GAP) * r);
    return {
      a: { x: content.x, y: content.y, width: Math.max(1, wa), height: content.height },
      b: { x: content.x + wa + GAP, y: content.y, width: Math.max(1, content.width - wa - GAP), height: content.height },
      divider: { x: content.x + wa, y: content.y, width: GAP, height: content.height },
    };
  },

  // ---------- automatic Picture-in-Picture ----------
  /** Called when leaving `prev` for `next`: a playing video follows you in a PiP window. */
  autoPipOnLeave(prev) {
    if (!prev || this.ctx.settings.data.autoPip === false || !prev.hasVideo || !prev.audible || prev.pipOn) return;
    const wc = liveWc(prev.view);
    if (!wc) return;
    media.pipEnter(wc).then(r => {
      if (r === 'entered') { prev.pipOn = true; prev.autoPip = true; this.pushState(); }
    }).catch(() => {});
  },
  /** Coming back to a tab whose video went to PiP automatically: bring it back in. */
  autoPipOnReturn(tab) {
    if (!tab || !tab.autoPip) return;
    tab.autoPip = false;
    const wc = liveWc(tab.view);
    if (!wc) return;
    media.pipExit(wc).then(r => { if (r === 'exited') { tab.pipOn = false; this.pushState(); } }).catch(() => {});
  },

  // ---------- sleeping tabs ----------
  canSleep(tab, now = Date.now()) {
    const s = this.ctx.settings.data;
    if (!tab.view || tab.kind !== 'web' || tab.keepLoaded || tab.audible || tab.pipOn) return false;
    if (tab.id === this.activeId || (this.inSplit(tab.id) && this.inSplit(this.activeId))) return false;
    if (tab === (this.peek && this.peek.tab)) return false;
    return now - (tab.lastActive || now) >= (s.sleepAfterMinutes || 60) * 60000;
  },
  sleepTab(tab) {
    if (!tab || !tab.view || tab.id === this.activeId) return false;
    const view = tab.view;
    tab.pendingUrl = tab.url;
    tab.view = null; // so the 'destroyed' handler does not close the tab
    tab.slept = Date.now();
    if (!this.win.isDestroyed()) this.win.contentView.removeChildView(view);
    const wc = liveWc(view);
    if (wc) wc.close();
    this.pushState();
    return true;
  },
  sleepIdleTabs(now = Date.now()) {
    if (this.ctx.settings.data.sleepingTabs === false) return 0;
    let n = 0;
    for (const t of this.tabs) if (this.canSleep(t, now) && this.sleepTab(t)) n++;
    return n;
  },

  // ---------- link preview ----------
  openPeek(url, opener) {
    if (!/^(https?|file):/i.test(url || '')) return;
    this.closePeek();
    const view = new WebContentsView({ webPreferences: this.webPreferences() });
    view.setBackgroundColor(this.ctx.isDark() ? '#0f172a' : '#ffffff');
    const wc = view.webContents;
    this.ctx.registerContents(wc, this);
    this.peek = { view, url, title: '', opener: opener ? opener.id : null };
    wc.setWindowOpenHandler(({ url: u }) => { if (/^(https?|file):/i.test(u)) this.newTab(u, { activate: false }); return { action: 'deny' }; });
    wc.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') { e.preventDefault(); this.closeOverlay(); return; }
      this.onKey(e, input, wc);
    });
    wc.on('page-title-updated', (e, t) => { if (this.peek && this.peek.view === view) { this.peek.title = t; this.sendPeek(); } });
    wc.on('did-navigate', (e, u) => { if (this.peek && this.peek.view === view) { this.peek.url = u; this.sendPeek(); } });
    wc.on('did-stop-loading', () => { if (this.peek && this.peek.view === view && !this.peek.title) { this.peek.title = wc.getTitle() || this.peek.url; this.sendPeek(); } });
    wc.on('did-navigate-in-page', (e, u, main) => { if (main && this.peek && this.peek.view === view) { this.peek.url = u; this.sendPeek(); } });
    wc.on('context-menu', (e, p) => {
      const { Menu, clipboard } = require('electron');
      const items = [];
      if (p.linkURL) items.push({ label: 'Open link in new tab', click: () => this.newTab(p.linkURL, { activate: false }) }, { label: 'Preview this link', click: () => this.openPeek(p.linkURL, opener) }, { label: 'Copy link address', click: () => clipboard.writeText(p.linkURL) }, { type: 'separator' });
      if (p.isEditable) items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' });
      else if (p.selectionText) items.push({ role: 'copy' }, { type: 'separator' });
      items.push({ label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
        { label: 'Open in new tab', click: () => this.peekOpenAs('tab') }, { label: 'Open in split view', click: () => this.peekOpenAs('split') });
      Menu.buildFromTemplate(items).popup({ window: this.win });
    });
    this.openOverlay('peek', { url, title: '' });
    this.win.contentView.addChildView(view);
    this.layoutPeek();
    wc.loadURL(url).catch(() => {});
    wc.focus();
  },
  peekRect() {
    const c = this.layoutState().content;
    const w = Math.round(Math.min(c.width - 48, Math.max(480, c.width * 0.82)));
    const h = Math.round(c.height - 48 - 44);
    return { x: Math.round(c.x + (c.width - w) / 2), y: c.y + 24 + 44, width: Math.max(200, w), height: Math.max(150, h) };
  },
  layoutPeek() {
    if (!this.peek) return;
    const r = this.peekRect();
    this.peek.view.setBounds(r);
    this.sendPeek();
  },
  sendPeek() {
    if (!this.peek || this.overlayMode !== 'peek') return;
    const r = this.peekRect();
    this.overlay.webContents.send('overlay', { mode: 'peek', update: true, data: { url: this.peek.url, title: this.peek.title, rect: r }, dark: this.ctx.isDark() });
  },
  closePeek() {
    if (!this.peek) return;
    const { view } = this.peek;
    this.peek = null;
    if (!this.win.isDestroyed()) this.win.contentView.removeChildView(view);
    const wc = liveWc(view);
    if (wc) wc.close();
  },
  /** 'tab' | 'split' | 'window': keep the previewed page. */
  peekOpenAs(how) {
    if (!this.peek) return;
    const url = this.peek.url;
    const opener = this.tabs.find(t => t.id === this.peek.opener) || this.active;
    this.closeOverlay();
    if (how === 'window') { this.ctx.newWindow({ url }); return; }
    const t = this.newTab(url, { index: opener ? this.tabs.indexOf(opener) + 1 : undefined, opener, activate: how !== 'split' });
    if (how === 'split' && opener) this.splitWith(opener, t);
  },

  // ---------- media controls ----------
  async mediaList() {
    const out = [];
    for (const w of this.ctx.windows) {
      if (w.private !== this.private) continue;
      for (const t of w.tabs) {
        if (!(t.hasMedia || t.audible) || !liveWc(t.view)) continue;
        const st = await media.status(t.view.webContents).catch(() => null);
        if (!st) continue;
        out.push({ ...st, windowId: w.id, tabId: t.id, title: st.title || t.title || t.url, url: t.url, favicon: t.favicon, muted: !!t.muted, audible: !!t.audible });
      }
    }
    return out;
  },
  async openMediaPanel(anchor) {
    if (this.overlayMode === 'media') { this.closeOverlay(); return; }
    this.openOverlay('media', { anchor: anchor || this.defaultAnchor('media', 340), items: await this.mediaList() });
  },
  async mediaAct(windowId, tabId, action) {
    const w = this.ctx.windows.find(x => x.id === windowId);
    const t = w && w.tabs.find(x => x.id === tabId);
    const wc = t && liveWc(t.view);
    if (!wc) return null;
    if (action === 'toggle') await media.toggle(wc);
    else if (action === 'back') await media.seek(wc, -10);
    else if (action === 'forward') await media.seek(wc, 10);
    else if (action === 'mute') w.setMuted(t, !t.muted);
    else if (action === 'pip') await this.ctx.pageFx.pip(w, t);
    else if (action === 'go') { this.closeOverlay(); w.activate(t); w.win.focus(); return null; }
    await new Promise(r => setTimeout(r, 150));
    return this.mediaList();
  },
  mediaCount() {
    let n = 0;
    for (const w of this.ctx.windows) if (w.private === this.private) for (const t of w.tabs) if (t.hasMedia && liveWc(t.view)) n++;
    return n;
  },
};

module.exports = { mixin, GAP };
