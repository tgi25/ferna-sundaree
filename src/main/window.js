'use strict';
// One browser window: a UI view (drawn behind everything), one sandboxed view per
// tab (only the active one attached), and an overlay view for the Ferna Tabs list,
// Tab Overview, command palette and screenshot region picker.

const path = require('path');
const { BaseWindow, WebContentsView, screen, dialog, nativeImage } = require('electron');
const { computeLayout } = require('./layout');
const { buildStrip, workspaceOfTab, hostOf, folderOf, pageUrlOf } = require('./workspaces');
const { registerInternal } = require('./ipc');
const menus = require('./menus');
const capture = require('./capture');

const PRELOAD = path.join(__dirname, '..', 'preload', 'internal.js');
let nextTabId = 1;
let nextWindowId = 1;

const isInternal = url => /^ferna:/i.test(url || '');
const siteOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const sameSite = (a, b) => !!siteOf(a) && siteOf(a) === siteOf(b);
const NEWTAB = 'ferna://newtab/';

// Load-failure codes that get Ferna's own error page.
const CERT_ERRORS = c => c <= -200 && c >= -299;

/** The view's WebContents while it is alive; null once the page has closed or crashed away. */
const liveWc = v => { const wc = v && v.webContents; return wc && !wc.isDestroyed() ? wc : null; };

// Network errors worth one automatic retry: connection reset/closed/timed out, DNS not
// resolved yet, empty response.
const TRANSIENT_NET_ERRORS = new Set([-100, -101, -105, -118, -137, -324]);

class FernaWindow {
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.id = nextWindowId++;
    this.private = !!opts.private;
    this.session = this.private ? (opts.session || ctx.newPrivateSession()) : ctx.webSession;
    this.tor = opts.tor || 0;
    this.tabs = [];
    this.activeId = null;
    this.closed = [];
    this.currentWs = opts.restore ? opts.restore.currentWs || null : (ctx.settings.data.lastWorkspace || null);
    this.focus = false;
    this.findOpen = false;
    this.reveal = { tabs: false, toolbar: false };
    this.htmlFullscreen = false;
    this.overlayMode = null;
    this._stateTimer = null;
    this.split = null;   // { a: tabId, b: tabId } two tabs side by side
    this.peek = null;    // link preview
    this.side = null;    // side panel (assistant): { view, kind }
    this.appMode = opts.app || null; // installed web app window: { url, origin, name }
    this.exam = opts.exam || null;   // Secure Exam Mode settings (see exam.js)
    this.internalIds = new Set();

    const b = (opts.restore && opts.restore.bounds) || opts.bounds || this.defaultBounds();
    this.win = new BaseWindow({
      ...b, minWidth: 480, minHeight: 360, show: false,
      title: this.tor ? 'Ferna Sundaree (Private · Tor)' : this.private ? 'Ferna Sundaree (Private)' : 'Ferna Sundaree',
      icon: ctx.iconPath, backgroundColor: ctx.isDark() ? '#0f172a' : '#f8fafc',
      autoHideMenuBar: true,
      // No Windows title bar: minimise / maximise / close live on Ferna's own tab bar or
      // toolbar and hide with it. thickFrame keeps resize borders, shadow and Aero Snap.
      frame: false, thickFrame: true,
    });
    if (opts.restore && opts.restore.maximized) this.win.maximize();

    this.ui = this.makeInternalView('ferna://ui/', { transparent: false });
    this.win.contentView.addChildView(this.ui);
    this.overlay = this.makeInternalView('ferna://overlay/', { transparent: true });
    this.overlay.setVisible(false);
    this.win.contentView.addChildView(this.overlay);

    this.win.on('resize', () => this.relayout());
    this.win.on('maximize', () => this.relayout());
    this.win.on('unmaximize', () => this.relayout());
    this.win.on('enter-full-screen', () => this.relayout());
    this.win.on('leave-full-screen', () => this.relayout());
    this.win.on('focus', () => ctx.setLastFocused(this));
    this.win.on('close', () => { this.windowClosing = true; ctx.onWindowClosing(this); });
    this.win.on('closed', () => this.destroy());

    // Restore or open the first tab(s).
    if (opts.restore && opts.restore.tabs && opts.restore.tabs.length) {
      opts.restore.tabs.forEach((t, i) => this.newTab(t.url, { activate: false, lazy: i !== opts.restore.active, wsOverride: t.wsOverride, title: t.title }));
      const act = this.tabs[opts.restore.active] || this.tabs[0];
      if (act) act.noRoutine = true; // loading it at start-up is not you opening it (smart workspaces)
      this.activate(act);
    } else {
      this.newTab(opts.url || NEWTAB, {});
    }
    this.ui.webContents.once('did-finish-load', () => { this.relayout(); this.win.show(); });
    setTimeout(() => { if (!this.win.isDestroyed() && !this.win.isVisible()) this.win.show(); }, 3000);
    ctx.setLastFocused(this);
  }

  defaultBounds() {
    const wa = screen.getPrimaryDisplay().workArea;
    const width = Math.min(1400, Math.round(wa.width * 0.85));
    const height = Math.min(920, Math.round(wa.height * 0.88));
    const last = this.ctx.lastFocused && !this.ctx.lastFocused.win.isDestroyed() ? this.ctx.lastFocused.win.getBounds() : null;
    if (last) return { x: last.x + 24, y: last.y + 24, width: last.width, height: last.height };
    return { x: wa.x + Math.round((wa.width - width) / 2), y: wa.y + Math.round((wa.height - height) / 2), width, height };
  }

  // ---------- views ----------

  webPreferences(extra = {}) {
    return {
      session: this.session,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: true, // with the sandbox on this only runs preloads in frames (privacy protections); never Node
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      plugins: !!this.ctx.widevineBuild || !this.ctx.hasPdfReader, // Widevine needs plugins on; PDFs still go to Ferna PDF Reader
      spellcheck: this.exam ? !!this.exam.allowSpell : true,
      safeDialogs: true,
      navigateOnDragDrop: false,
      enableWebSQL: false,
      ...extra,
    };
  }

  makeInternalView(url, { transparent }) {
    const view = new WebContentsView({
      webPreferences: {
        session: this.ctx.uiSession, preload: PRELOAD, sandbox: true, contextIsolation: true,
        nodeIntegration: false, webSecurity: true, spellcheck: false, webviewTag: false,
      },
    });
    if (transparent) view.setBackgroundColor('#00000000');
    const wc = view.webContents;
    registerInternal(wc);
    this.internalIds.add(wc.id);
    this.ctx.registerContents(wc, this);
    wc.on('before-input-event', (e, input) => this.onKey(e, input, wc));
    wc.setWindowOpenHandler(({ url: u }) => { if (/^(https?|ferna):/.test(u)) this.newTab(u); return { action: 'deny' }; });
    // Cut, copy, paste… for the address bar and the other text boxes of the browser's own UI.
    wc.on('context-menu', async (e, params) => {
      let address = false;
      if (params.isEditable && /^ferna:\/\/ui\//.test(wc.getURL())) {
        try { address = await wc.executeJavaScript("document.activeElement && document.activeElement.id === 'address'"); } catch { address = false; }
      }
      const go = address ? text => { const u = require('./policy').normalizeInput(text, this.ctx.settings.data.searchEngine); if (u) { if (this.active) this.navigate(this.active, u); else this.newTab(u); } } : null;
      const m = await menus.editMenu(this, wc, params, { goText: go });
      if (m) m.popup({ window: this.win });
    });
    wc.on('destroyed', () => this.internalIds.delete(wc.id));
    wc.loadURL(url);
    return view;
  }

  makeTabView(kind, tab, adopt) {
    let view;
    if (kind === 'internal') {
      view = new WebContentsView({
        webPreferences: { session: this.ctx.uiSession, preload: PRELOAD, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, webviewTag: false },
      });
      registerInternal(view.webContents);
      this.internalIds.add(view.webContents.id);
    } else if (adopt) {
      view = new WebContentsView({ webContents: adopt });
    } else {
      view = new WebContentsView({ webPreferences: this.webPreferences({ session: this.sessionFor(tab) }) });
    }
    view.setBackgroundColor(this.ctx.isDark() ? '#0f172a' : '#ffffff');
    if (this.tor && kind !== 'internal') view.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
    this.ctx.registerContents(view.webContents, this);
    this.attachTabEvents(tab, view, kind);
    // Extensions live in the shared session only (not in workspaces with separate logins).
    if (kind !== 'internal' && this.ctx.ext && view.webContents.session === this.ctx.webSession) this.ctx.ext.addTab(view.webContents, this);
    return view;
  }

  attachTabEvents(tab, view, kind) {
    const wc = view.webContents;
    const ctx = this.ctx;
    // A page or extension can close its own contents (window.close(), chrome.tabs.remove).
    // Drop the tab then, so no tab is left pointing at a dead page.
    wc.once('destroyed', () => {
      if (tab.view === view && this.tabs.includes(tab) && !this.windowClosing && !this.win.isDestroyed()) this.closeTab(tab);
    });
    const changed = () => this.pushState();
    wc.on('before-input-event', (e, input) => this.onKey(e, input, wc));
    // Split view: clicking into the other half makes it the active tab (address bar, shortcuts).
    wc.on('focus', () => {
      if (this.activeId !== tab.id && this.inSplit(tab.id) && this.inSplit(this.activeId) && this.tabs.includes(tab)) {
        this.activeId = tab.id;
        tab.lastActive = Date.now();
        this.updateTitle();
        this.pushState();
      }
    });
    wc.on('page-title-updated', (e, title) => {
      tab.title = title;
      if (tab.id === this.activeId) this.updateTitle();
      if (!this.private && kind === 'web') ctx.updateHistoryTitle(tab.url, title);
      changed();
    });
    wc.on('page-favicon-updated', (e, favs) => {
      tab.favicon = favs && favs[0] || '';
      changed();
      // Keep a copy, so the icon stays when the tab sleeps, for pins and the common bar, and
      // after a restart (not for private windows).
      if (!this.private && kind === 'web' && tab.favicon && ctx.favicons) {
        const page = tab.url;
        ctx.favicons.learn(page, tab.favicon, u => wc.session.fetch(u, { cache: 'force-cache' })).then(d => { if (d && tab.url === page) changed(); }).catch(() => {});
      }
    });
    wc.on('did-start-loading', () => { tab.loading = true; changed(); });
    wc.on('did-stop-loading', () => { tab.loading = false; changed(); if (tab.id === this.activeId && this.ctx.sampleTabColour) setTimeout(() => this.ctx.sampleTabColour(this, tab), 400); });
    wc.on('did-start-navigation', d => { if (d.isMainFrame && !d.isSameDocument) { tab.blocked = 0; tab.blockedPopups = []; tab.cosmeticKey = null; tab.feeds = null; tab.check = null; tab.checkGen = (tab.checkGen || 0) + 1; if (tab.favicon && !sameSite(tab.url, d.url)) tab.favicon = ''; tab.hasVideo = false; tab.hasMedia = false; tab.pipOn = false; tab.autoPip = false; tab.pwGen = (tab.pwGen || 0) + 1; tab.pwCount = 0; tab.readerOn = false; tab.speaking = false; } });
    wc.on('media-started-playing', () => {
      tab.hasMedia = true;
      ctx.pageFx.mediaStarted(this, tab);
      wc.mainFrame.executeJavaScript(require('./pagefx/pip').HAS_VIDEO).then(v => { if (v && !tab.hasVideo) { tab.hasVideo = true; changed(); } }).catch(() => {});
      changed();
    });
    wc.on('did-navigate', (e, url) => {
      tab.url = url; tab.crashed = false;
      if (!isInternal(url)) tab.lastGoodUrl = url;
      ctx.zoomOnNavigate(this, tab);
      if (!this.private && kind === 'web') ctx.addHistory(url, wc.getTitle());
      if (!this.private && kind === 'web' && ctx.bmSvc) ctx.bmSvc.markVisited(url);
      changed();
    });
    wc.on('did-navigate-in-page', (e, url, isMain) => { if (isMain) { tab.url = url; changed(); } });
    wc.on('did-fail-load', (e, code, desc, url, isMain) => {
      if (!isMain || code === -3 || kind !== 'web') return;
      // A passing network hiccup on the first try (DNS still warming up, a reset or changed
      // connection): try once more by itself before showing any error.
      if (TRANSIENT_NET_ERRORS.has(code) && /^https?:/i.test(url) && !(tab._retried && tab._retried.url === url && Date.now() - tab._retried.at < 30000)) {
        tab._retried = { url, at: Date.now() };
        setTimeout(() => { if (liveWc(tab.view) === wc) wc.loadURL(url); }, 700);
        return;
      }
      const httpUrl = ctx.upgradedFrom(wc.id, url);
      if (httpUrl && code <= -100 && code !== -105) {
        this.navigate(tab, `ferna://interstitial/?kind=https&url=${encodeURIComponent(httpUrl)}&code=${code}`);
      } else if (CERT_ERRORS(code)) {
        this.navigate(tab, `ferna://interstitial/?kind=cert&url=${encodeURIComponent(url)}&code=${code}&desc=${encodeURIComponent(desc)}`);
      } else if ((code === -20 || code === -21) && ctx.lookalikeHits.get(wc.id) && ctx.lookalikeHits.get(wc.id).url === url) {
        const hit = ctx.lookalikeHits.get(wc.id);
        ctx.lookalikeHits.delete(wc.id);
        this.navigate(tab, `ferna://interstitial/?kind=lookalike&url=${encodeURIComponent(url)}&suggest=${encodeURIComponent(hit.suggest)}&reason=${hit.reason}&code=${code}`);
      } else if ((code === -20 || code === -21) && ctx.parental && ctx.parental.hits.get(wc.id) && ctx.parental.hits.get(wc.id).url === url) {
        const hit = ctx.parental.hits.get(wc.id);
        ctx.parental.hits.delete(wc.id);
        this.navigate(tab, `ferna://interstitial/?kind=parental&why=${hit.why}&url=${encodeURIComponent(url)}&code=${code}`);
      } else if ((code === -20 || code === -21) && ctx.safety && ctx.safety.hits.get(wc.id) && ctx.safety.hits.get(wc.id).url === url) {
        const hit = ctx.safety.hits.get(wc.id);
        ctx.safety.hits.delete(wc.id);
        this.navigate(tab, `ferna://interstitial/?kind=${hit.kind}&url=${encodeURIComponent(url)}&code=${code}`);
      } else if (code === -20 || code === -21) {
        this.navigate(tab, `ferna://interstitial/?kind=blocked&url=${encodeURIComponent(url)}&code=${code}`);
      } else {
        this.navigate(tab, `ferna://interstitial/?kind=error&url=${encodeURIComponent(url)}&code=${code}&desc=${encodeURIComponent(desc)}`);
      }
    });
    wc.on('render-process-gone', (e, details) => {
      if (details.reason === 'clean-exit') return;
      tab.crashed = true;
      const u = tab.url;
      setImmediate(() => this.navigate(tab, `ferna://interstitial/?kind=crashed&url=${encodeURIComponent(u)}&code=0&desc=${encodeURIComponent(details.reason)}`));
    });
    wc.on('audio-state-changed', () => { tab.audible = wc.isCurrentlyAudible(); changed(); });
    wc.on('found-in-page', (e, r) => this.sendUi('find-result', { active: r.activeMatchOrdinal, total: r.matches }));
    wc.on('context-menu', (e, params) => {
      if (kind === 'internal') {
        Promise.resolve(/^ferna:\/\/pdf\//i.test(tab.url || '') ? menus.pdfMenu(this, tab, params) : menus.editMenu(this, wc, params))
          .then(m => { if (m && !wc.isDestroyed()) m.popup({ window: this.win }); }).catch(() => {});
        return;
      }
      if (kind !== 'web') return;
      if (this.exam) {
        const items = params.isEditable ? [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, ...(this.exam.allowCopy ? [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }] : []), { role: 'selectAll' }]
          : [...(this.exam.allowCopy && params.selectionText ? [{ role: 'copy' }, { type: 'separator' }] : []), { label: 'Back', click: () => this.run('back') }, { label: 'Reload', click: () => this.run('reload') }];
        if (params.misspelledWord && this.exam.allowSpell) params.dictionarySuggestions.slice(0, 5).reverse().forEach(sg => items.unshift({ label: sg, click: () => wc.replaceMisspelling(sg) }));
        require('electron').Menu.buildFromTemplate(items).popup({ window: this.win });
        return;
      }
      menus.pageMenu(this, tab, params).popup({ window: this.win });
    });
    wc.on('dom-ready', () => { if (kind === 'web') { ctx.zoomOnDomReady(this, tab); ctx.pageFx.domReady(this, tab); } });
    wc.on('did-finish-load', () => {
      if (kind !== 'web') return;
      ctx.zoomOnLoad(this, tab);
      // Feeds this page announces: the RSS button in the address bar.
      if (ctx.feeds && !this.private) ctx.feeds.discoverInTab(tab).then(f => { tab.feeds = f; if (tab.id === this.activeId) this.pushState(); }).catch(() => {});
      // Safety check: fake bank pages, scam wording, news articles (the fact-check bubble).
      if (ctx.check) ctx.check.scanTab(this, tab).catch(() => {});
      // Smart workspaces: the first time today you opened this site.
      if (ctx.smartws) ctx.smartws.note(this, tab);
    });
    wc.on('enter-html-full-screen', () => { this.htmlFullscreen = true; this.win.setFullScreen(true); this.relayout(); });
    wc.on('leave-html-full-screen', () => { this.htmlFullscreen = false; this.win.setFullScreen(false); this.relayout(); });
    wc.on('zoom-changed', (e, dir) => this.run(dir === 'in' ? 'zoomIn' : 'zoomOut'));

    // Never let a web view reach ferna:// (or an internal view reach the web):
    // swap the view instead, so a web page can never end up with Ferna's preload.
    const guard = (e, url) => {
      const toInternal = isInternal(url);
      if (this.exam && kind === 'web' && !this.ctx.examAllowed(this, url)) { e.preventDefault(); this.ctx.examBlocked(this, url); return; }
      if (this.appMode && kind === 'web' && /^https?:/i.test(url) && !this.ctx.sameApp(this.appMode.origin, url)) {
        e.preventDefault();
        this.ctx.openInBrowser(url);
        return;
      }
      if (kind === 'web' && this.ctx.pdfViewerFor(url)) {
        e.preventDefault();
        setImmediate(() => this.navigate(tab, url));
        return;
      }
      if ((kind === 'web' && toInternal) || (kind === 'internal' && !toInternal)) {
        e.preventDefault();
        if (/^(https?|ferna|file):/i.test(url)) setImmediate(() => this.navigate(tab, url));
      }
    };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);

    if (kind === 'web') {
      // Pop-up blocker: a page may open a window only right after the user clicked or typed.
      wc.on('input-event', (e, input) => { if (/^(mouseDown|mouseUp|rawKeyDown|keyDown|keyUp|char|touchStart|touchEnd|gestureTap)$/.test(input.type)) tab.lastInput = Date.now(); });
      wc.setWindowOpenHandler(details => {
        const u = details.url;
        if (!/^(https?|file|chrome-extension):|^about:blank$/i.test(u)) return { action: 'deny' };
        // Exam window: no new windows; an allowed link opens in place.
        if (this.exam) { if (this.ctx.examAllowed(this, u)) setImmediate(() => this.navigate(tab, u)); else this.ctx.examBlocked(this, u); return { action: 'deny' }; }
        // Selection menu actions (Translate, Read aloud, Ask): only right after a click.
        if (u.startsWith('https://ferna-action.invalid/')) {
          if (Date.now() - (tab.lastInput || 0) < 2000) {
            const x = new URL(u);
            const text = (x.searchParams.get('t') || '').slice(0, 5000);
            const act = x.pathname.slice(1);
            // The text must be what is selected on the page, so a script cannot send its own.
            const sel = require('./pagefx/selection');
            setImmediate(async () => {
              let current = '';
              try { current = String(await wc.executeJavaScriptInIsolatedWorld(sel.WORLD, [{ code: 'String(window.getSelection())' }]) || ''); } catch { return; }
              const norm = x => x.replace(/\s+/g, ' ').trim();
              if (!norm(current) || !norm(current).startsWith(norm(text).slice(0, 200))) return;
              if (act === 'translate') this.ctx.translateText(this, tab, text);
              else if (act === 'speak') this.ctx.pageFx.readAloud(this, tab, text);
              else if (act === 'ask') this.ctx.askAssistant(this, { text, action: 'explain' });
            });
          }
          return { action: 'deny' };
        }
        if (this.ctx.settings.data.popupBlocker !== false && Date.now() - (tab.lastInput || 0) > 5000 && !(this.ctx.settings.data.popupAllow || []).includes(hostOf(tab.url))) {
          tab.blockedPopups = [...(tab.blockedPopups || []).filter(x => x !== u), u].slice(-10);
          if (tab.id === this.activeId) this.sendUi('toast', { text: 'Pop-up blocked. Open it from the shield button if you want it.' });
          this.pushState();
          return { action: 'deny' };
        }
        // Link preview: Shift+click on a link opens it in a floating card instead of a window.
        if (details.disposition === 'new-window' && !details.features && this.ctx.settings.data.linkPreview !== false && Date.now() - (tab.lastInput || 0) < 1500) {
          setImmediate(() => this.openPeek(u, tab));
          return { action: 'deny' };
        }
        if (this.appMode) { setImmediate(() => (this.ctx.sameApp(this.appMode.origin, u) ? this.ctx.openAppWindow(u, this.appMode.name) : this.ctx.openInBrowser(u))); return { action: 'deny' }; }
        const background = details.disposition === 'background-tab';
        return {
          action: 'allow',
          overrideBrowserWindowOptions: { webPreferences: this.webPreferences({ session: wc.session }) },
          createWindow: options => {
            const t = this.newTab(null, { activate: !background, index: this.tabs.indexOf(tab) + 1, adopt: options.webContents, opener: tab });
            return t.view.webContents;
          },
        };
      });
    } else {
      wc.setWindowOpenHandler(({ url: u }) => { if (/^(https?|ferna):/.test(u)) this.newTab(u); return { action: 'deny' }; });
    }
    wc.on('destroyed', () => this.internalIds.delete(wc.id));
  }

  // ---------- tabs ----------

  newTab(url, o = {}) {
    url = url || (o.adopt ? 'about:blank' : NEWTAB);
    if (!o.adopt) url = this.ctx.pdfViewerFor(url) || url;
    const tab = {
      id: nextTabId++, url, title: o.title || '', favicon: '', loading: false, audible: false, muted: false,
      crashed: false, blocked: 0, thumb: null, keepLoaded: false, wsOverride: o.wsOverride || null,
      kind: isInternal(url) ? 'internal' : 'web', view: null, pendingUrl: null, lastGoodUrl: null,
      openerId: o.opener ? o.opener.id : null, // the tab that opened it (for "after closing a tab: go to its parent")
    };
    // A tab opened inside a workspace stays in it, even when its site belongs elsewhere.
    if (!tab.wsOverride && this.currentWs) {
      const w = o.opener ? this.tabWorkspace(o.opener) : this.currentWs;
      if (w && workspaceOfTab({ url }, this.ctx.ws.data.workspaces) !== w) tab.wsOverride = w;
    }
    const index = Number.isInteger(o.index) ? Math.max(0, Math.min(this.tabs.length, o.index)) : this.tabs.length;
    this.tabs.splice(index, 0, tab);
    if (o.lazy) {
      tab.pendingUrl = url;
    } else {
      tab.view = this.makeTabView(o.adopt ? 'web' : tab.kind, tab, o.adopt);
      if (!o.adopt) tab.view.webContents.loadURL(url).catch(() => {});
    }
    if (o.activate !== false) this.activate(tab);
    this.pushState();
    this.ctx.saveSessionSoon();
    return tab;
  }

  ensureView(tab) {
    if (tab.view && liveWc(tab.view)) return;
    if (tab.view) { // its page died without the tab being removed: start it again
      if (!this.win.isDestroyed()) this.win.contentView.removeChildView(tab.view);
      tab.pendingUrl = tab.pendingUrl || tab.url;
    }
    tab.view = this.makeTabView(tab.kind, tab);
    tab.view.webContents.loadURL(tab.pendingUrl || tab.url).catch(() => {});
    tab.pendingUrl = null;
  }

  /** The session a web tab uses: private, its workspace's own (separate logins), or the shared one. */
  sessionFor(tab) {
    if (this.private) return this.session;
    if (!this.ctx.sessionForWorkspace) return this.session;
    return this.ctx.sessionForWorkspace(tab.wsOverride || this.tabWorkspace(tab));
  }

  get active() { return this.tabs.find(t => t.id === this.activeId) || null; }

  activate(tab) {
    if (!tab) return;
    const prev = this.active;
    const bothInSplit = prev && this.inSplit(prev.id) && this.inSplit(tab.id);
    if (prev && prev !== tab) {
      prev.lastActive = Date.now();
      this.prevTabId = prev.id; // Ctrl+Tab goes back here
      if (!bothInSplit) {
        this.autoPipOnLeave(prev);
        if (prev.view) { this.snapshot(prev); this.win.contentView.removeChildView(prev.view); }
        const mate = this.splitPartner(prev);
        if (mate && mate !== tab && mate.view) { mate.lastActive = Date.now(); this.win.contentView.removeChildView(mate.view); }
      }
    }
    this.ensureView(tab);
    this.activeId = tab.id;
    tab.lastActive = Date.now();
    this.win.contentView.addChildView(tab.view, 1);
    const mate = this.splitPartner(tab);
    if (mate) { this.ensureView(mate); mate.lastActive = Date.now(); this.win.contentView.addChildView(mate.view, 1); }
    if (!bothInSplit) { this.autoPipOnReturn(tab); if (mate) this.autoPipOnReturn(mate); }
    if (this.overlay.getVisible()) this.win.contentView.addChildView(this.overlay);
    if (this.peek) this.win.contentView.addChildView(this.peek.view);
    this.relayout();
    if (liveWc(tab.view)) tab.view.webContents.focus();
    if (tab.kind === 'web' && this.ctx.ext) this.ctx.ext.selectTab(tab.view.webContents);
    // Follow the tab into its workspace if the current one hides it.
    if (this.currentWs) {
      const strip = this.strip();
      const visible = strip.tabs.includes(tab.id) || strip.pinned.some(p => p.tabId === tab.id) || strip.common.some(c => c.tabId === tab.id);
      if (!visible) this.currentWs = this.tabWorkspace(tab);
    }
    if (this.findOpen) this.closeFind();
    if (this.ctx.sampleTabColour && !tab.dominant && tab.view) setTimeout(() => this.ctx.sampleTabColour(this, tab), 300);
    this.updateTitle();
    this.pushState();
    this.ctx.saveSessionSoon();
  }

  snapshot(tab) {
    if (this.private || tab.kind !== 'web' || !liveWc(tab.view)) return Promise.resolve();
    return tab.view.webContents.capturePage().then(img => {
      if (!img.isEmpty()) tab.thumb = `data:image/jpeg;base64,${img.resize({ width: 400 }).toJPEG(70).toString('base64')}`;
    }).catch(() => {});
  }

  closeTab(tab) {
    const i = this.tabs.indexOf(tab);
    if (i < 0) return;
    const visibleBefore = this.activeId === tab.id ? this.visibleOrder() : null;
    if (!this.private && tab.url) {
      this.closed.push({ url: tab.url, index: i, wsOverride: tab.wsOverride, title: tab.title });
      if (this.closed.length > 25) this.closed.shift();
    }
    this.tabs.splice(i, 1);
    if (this.inSplit(tab.id)) {
      const mate = this.splitPartner(tab);
      this.split = null;
      if (mate && this.activeId === tab.id) { this.activeId = mate.id; setImmediate(() => { if (!this.win.isDestroyed()) { this.updateTitle(); this.relayout(); } }); } // stay on the other half
      else if (mate && mate.id !== this.activeId && mate.view && !this.win.isDestroyed()) this.win.contentView.removeChildView(mate.view);
    }
    if (tab.view) {
      if (!this.win.isDestroyed()) this.win.contentView.removeChildView(tab.view);
      const wc = liveWc(tab.view);
      if (wc) wc.close();
    }
    if (!this.tabs.length) {
      if (!this.win.isDestroyed()) this.win.close();
      return;
    }
    if (this.windowClosing || this.win.isDestroyed()) return;
    if (this.activeId === tab.id) {
      const next = this.tabAfterClose(tab, visibleBefore || [], this.ctx.settings.data.afterClose);
      this.activate(next || this.tabs[Math.min(i, this.tabs.length - 1)]);
    }
    this.pushState();
    this.ctx.saveSessionSoon();
  }

  /**
   * The tab to show after closing the current one (Settings → Tabs → After closing a tab):
   * 'right' the tab to its right (as in Chrome; the left one at the end), 'left' the tab to its
   * left, 'previous' the tab you used before it, 'opener' the tab that opened it. When the chosen
   * tab is not there, the tab to the right is used.
   */
  tabAfterClose(closed, visibleBefore, mode = 'right') {
    const alive = id => id !== closed.id && this.tabs.some(t => t.id === id) && visibleBefore.includes(id);
    const byId = id => this.tabs.find(t => t.id === id);
    const pos = visibleBefore.indexOf(closed.id);
    const right = () => { for (let k = pos + 1; k < visibleBefore.length; k++) if (alive(visibleBefore[k])) return visibleBefore[k]; for (let k = pos - 1; k >= 0; k--) if (alive(visibleBefore[k])) return visibleBefore[k]; return null; };
    const left = () => { for (let k = pos - 1; k >= 0; k--) if (alive(visibleBefore[k])) return visibleBefore[k]; return right(); };
    const previous = () => {
      if (alive(this.prevTabId)) return this.prevTabId;
      const recent = this.tabs.filter(t => alive(t.id)).sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0))[0];
      return recent ? recent.id : null;
    };
    let id = null;
    if (pos >= 0) {
      if (mode === 'left') id = left();
      else if (mode === 'previous') id = previous() || right();
      else if (mode === 'opener') id = (alive(closed.openerId) ? closed.openerId : null) || right();
      else id = right();
    }
    return id ? byId(id) : null;
  }

  moveTab(tab, toIndex) {
    const i = this.tabs.indexOf(tab);
    if (i < 0) return;
    this.tabs.splice(i, 1);
    this.tabs.splice(Math.max(0, Math.min(this.tabs.length, toIndex)), 0, tab);
    this.pushState();
    this.ctx.saveSessionSoon();
  }

  /** Tab ids in the order the strip shows them (common, pinned, tabs). */
  visibleOrder() {
    const s = this.strip();
    return [...s.common.map(c => c.tabId), ...s.pinned.map(p => p.tabId), ...s.tabs].filter(id => id !== null);
  }

  navigate(tab, url) {
    const kind = isInternal(url) ? 'internal' : 'web';
    const pdf = this.ctx.pdfViewerFor(url);
    if (pdf) url = pdf;
    if (!tab.view || tab.kind !== (isInternal(url) ? 'internal' : 'web')) {
      const old = tab.view;
      tab.kind = isInternal(url) ? 'internal' : kind;
      tab.view = this.makeTabView(tab.kind, tab);
      tab.url = url;
      if (tab.id === this.activeId) {
        if (old) this.win.contentView.removeChildView(old);
        this.win.contentView.addChildView(tab.view, 1);
        if (this.overlay.getVisible()) this.win.contentView.addChildView(this.overlay);
        this.relayout();
      }
      if (liveWc(old)) old.webContents.close();
    }
    tab.pendingUrl = null;
    tab.view.webContents.loadURL(url).catch(() => {});
    if (tab.id === this.activeId) tab.view.webContents.focus();
    this.pushState();
  }

  navigateActive(url) { const t = this.active; if (t) this.navigate(t, url); }

  openInternal(url) {
    const existing = this.tabs.find(t => t.url && t.url.split('#')[0] === url.split('#')[0]);
    if (existing) {
      this.activate(existing);
      if (url.includes('#') && liveWc(existing.view)) existing.view.webContents.loadURL(url);
    } else {
      this.newTab(url, { index: this.active ? this.tabs.indexOf(this.active) + 1 : undefined });
    }
  }

  setMuted(tab, muted) {
    tab.muted = muted;
    if (liveWc(tab.view)) tab.view.webContents.setAudioMuted(muted);
    this.pushState();
  }

  // ---------- workspaces ----------

  tabWorkspace(tab) { return workspaceOfTab(tab, this.ctx.ws.data.workspaces); }

  strip() {
    return buildStrip(this.tabs, this.ctx.ws.data.workspaces, this.ctx.ws.data.common, this.currentWs,
      { allPinned: !!this.ctx.settings.data.stripFavoritesOnly, allTabsPinned: this.ctx.ws.data.allPinned });
  }

  switchWorkspace(id) {
    const ws = this.ctx.ws.data.workspaces;
    this.currentWs = id && ws.some(w => w.id === id) ? id : null;
    if (!this.private) this.ctx.settings.set('lastWorkspace', this.currentWs);
    const s = this.strip();
    const ids = this.visibleOrder();
    if (this.activeId && !ids.includes(this.activeId)) {
      if (ids.length) this.activate(this.tabs.find(t => t.id === ids[0]));
      else if (this.currentWs && s.pinned.length === 0) this.newTab(NEWTAB);
    }
    this.pushState();
    this.ctx.saveSessionSoon();
  }

  rotateWorkspace(dir) {
    const order = [null, ...this.ctx.ws.data.workspaces.map(w => w.id)];
    const i = order.indexOf(this.currentWs);
    this.switchWorkspace(order[(i + dir + order.length) % order.length]);
  }

  moveTabToWorkspace(tab, id) {
    tab.wsOverride = id;
    this.reopenInSession(tab);
    if (this.currentWs && id !== this.currentWs) this.switchWorkspace(id === 'none' ? null : id);
    this.pushState();
    this.ctx.saveSessionSoon();
  }

  /** After a tab's workspace (or that workspace's separate-logins option) changed: reload it in the right session. */
  reopenInSession(tab) {
    const before = tab.kind === 'web' && liveWc(tab.view) ? tab.view.webContents.session : null;
    if (!before || this.sessionFor(tab) === before) return;
    const old = tab.view;
    const url = tab.url;
    tab.view = this.makeTabView('web', tab);
    if (tab.id === this.activeId || (this.inSplit(tab.id) && this.inSplit(this.activeId))) { this.win.contentView.removeChildView(old); this.win.contentView.addChildView(tab.view, 1); this.relayout(); }
    tab.view.webContents.loadURL(url).catch(() => {});
    old.webContents.close();
  }

  openPinned(wsId, index) {
    const list = this.ctx.pinnedList(wsId || '');
    const p = list && list[index];
    if (!p) return;
    const row = this.strip().pinned.find(r => r.index === index && (r.wsId || '') === (wsId || ''));
    if (row && row.tabId) this.activate(this.tabs.find(t => t.id === row.tabId));
    else this.newTab(p.url, wsId ? { wsOverride: wsId } : {});
  }

  /** Add the tab's page to the common bar, or take it off if it is there. */
  toggleCommon(tab) {
    const ctx = this.ctx;
    const url = tab ? pageUrlOf(tab.url) : '';
    if (!tab || !/^(https?|file):/i.test(url)) { this.sendUi('toast', { text: 'Only web pages and files can go on the common bar.' }); return; }
    const i = ctx.findCommon(url);
    if (i >= 0) { ctx.removeCommon(i); this.sendUi('toast', { text: 'Removed from the common bar.' }); return; }
    if (ctx.ws.data.common.length >= 20) { this.sendUi('toast', { text: 'The common bar is full (20). Remove one first.' }); return; }
    ctx.addCommon(url, tab.title);
    this.sendUi('toast', { text: 'Added to the common bar.' });
  }

  /** Pin the tab's page where you are (the current workspace, or All tabs), or unpin it. */
  togglePin(tab, wsId = this.currentWs || '') {
    const ctx = this.ctx;
    const url = tab ? pageUrlOf(tab.url) : '';
    if (!tab || !/^(https?|file):/i.test(url)) { this.sendUi('toast', { text: 'Only web pages and files can be pinned.' }); return; }
    const where = wsId ? `“${(ctx.ws.data.workspaces.find(w => w.id === wsId) || {}).name || 'workspace'}”` : 'All tabs';
    const i = ctx.findPin(wsId, url);
    if (i >= 0) { ctx.unpinSite(wsId, i); this.sendUi('toast', { text: `Unpinned from ${where}.` }); return; }
    if (ctx.pinSite(wsId, url, tab.title)) this.sendUi('toast', { text: `Pinned in ${where}.` });
  }

  openCommon(index) {
    const c = this.ctx.ws.data.common[index];
    if (!c) return;
    const row = this.strip().common.find(r => r.index === index);
    if (row && row.tabId) this.activate(this.tabs.find(t => t.id === row.tabId));
    else this.newTab(c.url);
  }

  promptNewWorkspace(onCreated) {
    this.openOverlay('prompt', { title: 'New workspace', label: 'Name', value: '', action: 'ws:create' });
    this._onWorkspaceCreated = onCreated;
  }

  promptRenameWorkspace(id) {
    const ws = this.ctx.ws.data.workspaces.find(w => w.id === id);
    if (ws) this.openOverlay('prompt', { title: 'Rename workspace', label: 'Name', value: ws.name, action: 'ws:rename', id });
  }

  // ---------- overlay ----------

  openOverlay(mode, data = {}) {
    this.overlayMode = mode;
    this.overlay.setVisible(true);
    this.win.contentView.addChildView(this.overlay);
    this.relayout();
    const send = () => this.overlay.webContents.send('overlay', { mode, data, dark: this.ctx.isDark() });
    if (this.overlay.webContents.isLoading()) this.overlay.webContents.once('did-finish-load', send); else send();
    this.overlay.webContents.focus();
  }

  closeOverlay() {
    if (!this.overlayMode) return;
    if (this.overlayMode === 'peek') this.closePeek();
    this.overlayMode = null;
    this.overlay.setVisible(false);
    this.overlay.webContents.send('overlay', { mode: null });
    const t = this.active;
    if (t && liveWc(t.view)) t.view.webContents.focus();
  }

  async overviewData() {
    if (this.active) await this.snapshot(this.active);
    const wsList = this.ctx.ws.data.workspaces;
    const describe = (w, t) => ({
      windowId: w.id, id: t.id, title: t.title || t.url, url: t.url, favicon: t.favicon, thumb: w.private ? null : t.thumb,
      ws: w.tabWorkspace(t), active: t.id === w.activeId, audible: t.audible, private: w.private,
    });
    const windows = this.private ? [this] : this.ctx.windows.filter(w => !w.private);
    return {
      currentWindow: this.id, currentWs: this.currentWs,
      workspaces: wsList.map(w => ({ id: w.id, name: w.name, color: w.color })),
      tabs: windows.flatMap(w => w.tabs.map(t => describe(w, t))),
    };
  }

  pointerData() {
    const cb = this.win.getContentBounds();
    const p = screen.getCursorScreenPoint();
    return { x: p.x - cb.x, y: p.y - cb.y, engine: (require('./policy').SEARCH_ENGINES[this.ctx.settings.data.searchEngine] || {}).name || '', bmFolder: this.ctx.defaultBookmarkFolder() || null, ...this.state() };
  }

  /** Where a toolbar popup goes when it was opened by a shortcut (no button rectangle). */
  defaultAnchor(id, fromRight = 280) {
    const L = this.layoutState();
    return L.toolbar ? { x: L.toolbar.x + L.toolbar.width - fromRight, y: L.toolbar.y + 6, width: 32, height: 32, id } : { x: L.W - fromRight - 40, y: 8, width: 32, height: 32, id };
  }

  async openEqPanel(anchor) {
    const t = this.active;
    if (this.overlayMode === 'eq') { this.closeOverlay(); return; }
    const fx = this.ctx.pageFx;
    const status = t ? await fx.eqStatus(t) : null;
    this.openOverlay('eq', { anchor: anchor || this.defaultAnchor('eq', 300), cfg: fx.eqCfg(), presets: fx.EQ.PRESETS, bands: fx.EQ.BANDS, auto: fx.EQ.AUTO_GENRES, status, web: !!(t && t.kind === 'web'), user: fx.EQ.cleanUserPresets(this.ctx.settings.data.eqPresets) });
  }

  openBookmarksPanel(anchor, folder) {
    if (this.overlayMode === 'bookmarks' && !folder) { this.closeOverlay(); return; }
    const t = this.active;
    const page = t && /^(https?|file):/i.test(t.url || '') ? { url: t.url, title: t.title || t.url } : null;
    this.openOverlay('bookmarks', { anchor: anchor || this.defaultAnchor('bm', 200), folder: folder || this.ctx.defaultBookmarkFolder() || null, page, engine: (require('./policy').SEARCH_ENGINES[this.ctx.settings.data.searchEngine] || {}).name || '' });
  }

  openZoomPanel(anchor) {
    const t = this.active;
    if (!t || t.kind !== 'web') { this.sendUi('toast', { text: 'Zoom works on web pages.' }); return; }
    if (this.overlayMode === 'zoom') { this.closeOverlay(); return; }
    const L = this.layoutState();
    const a = anchor || (L.toolbar ? { x: L.toolbar.x + L.toolbar.width - 240, y: L.toolbar.y + 6, width: 32, height: 32 } : { x: L.W - 300, y: 8, width: 32, height: 32 });
    this.openOverlay('zoom', { anchor: a, ...this.ctx.zoomPanelData(this, t) });
  }

  // ---------- find ----------

  openFind() { this.findOpen = true; this.relayout(); this.sendUi('find-open', {}); }
  closeFind() {
    this.findOpen = false;
    const t = this.active;
    if (t && liveWc(t.view)) t.view.webContents.stopFindInPage('clearSelection');
    this.relayout();
    this.sendUi('find-close', {});
  }

  // ---------- layout & state ----------

  layoutState() {
    const s = this.ctx.settings.data;
    const [W, H] = this.win.getContentSize();
    return computeLayout(W, H, {
      position: s.tabPosition, tabBarHidden: s.tabBarHidden, bookmarksHidden: s.bookmarksBarHidden,
      collapsed: s.verticalCollapsed, vwidth: s.verticalWidth, focus: this.focus, findOpen: this.findOpen,
      revealTabs: this.reveal.tabs, revealToolbar: this.reveal.toolbar, htmlFullscreen: this.htmlFullscreen || this.win.isFullScreen(),
      hideBars: s.hideBars, appMode: !!this.appMode,
    });
  }

  relayout() {
    if (this.win.isDestroyed()) return;
    const L = this.layoutState();
    const [W, H] = this.win.getContentSize();
    this.ui.setBounds({ x: 0, y: 0, width: W, height: H });
    this.overlay.setBounds({ x: 0, y: 0, width: W, height: H });
    const t = this.active;
    const content = this.sideLayout(L.content);
    const mate = this.splitPartner(t);
    if (t && t.view && mate && mate.view) {
      const r = this.splitRects(content);
      const left = this.split.a === t.id ? t : mate;
      const right = left === t ? mate : t;
      left.view.setBounds(r.a);
      right.view.setBounds(r.b);
    } else if (t && t.view) t.view.setBounds(content);
    if (this.peek) this.layoutPeek();
    this.pushState();
    if (this.reveal.tabs || this.reveal.toolbar) this.watchReveal();
  }

  /**
   * Bars brought back by the window edge go away again once the pointer has been on the page for
   * half a second. Checked here from the pointer position, because the bars' own "pointer left"
   * event is missed when the pointer moves quickly onto the page (it then sits in another view).
   */
  watchReveal() {
    if (this._revealTimer) return;
    let away = 0;
    this._revealTimer = setInterval(() => {
      if (this.win.isDestroyed() || !(this.reveal.tabs || this.reveal.toolbar)) { clearInterval(this._revealTimer); this._revealTimer = null; return; }
      const s = this.ctx.settings.data;
      if (!this.focus) { this.reveal = { tabs: false, toolbar: false }; clearInterval(this._revealTimer); this._revealTimer = null; this.relayout(); return; }
      if (this.overlayMode || (this.ui.webContents.isFocused() && this.win.isFocused())) { away = 0; return; } // typing in the address bar, a menu open
      const p = screen.getCursorScreenPoint();
      const b = this.win.getContentBounds();
      const L = this.layoutState();
      const c = this.sideLayout(L.content);
      const x = p.x - b.x, y = p.y - b.y;
      const inWin = x >= 0 && y >= 0 && x < b.width && y < b.height;
      const onPage = inWin && x >= c.x && x < c.x + c.width + (this.side ? 9999 : 0) && y >= c.y + 8 && y < c.y + c.height;
      away = onPage || !inWin ? away + 1 : 0;
      if (away >= 3) { this.reveal = { tabs: false, toolbar: false }; clearInterval(this._revealTimer); this._revealTimer = null; this.relayout(); }
    }, 200);
  }

  /** The page area once the side panel (assistant) takes its share on the right. */
  sideLayout(content) {
    if (!this.side) return content;
    const w = this.side.kind === 'feeds'
      ? Math.max(320, Math.min(900, Number(this.ctx.settings.data.feedsPanelWidth) || 420))
      : Math.max(300, Math.min(560, Number(this.ctx.settings.data.sideWidth) || 380));
    const width = Math.max(200, content.width - w);
    this.side.view.setBounds({ x: content.x + width, y: content.y, width: content.width - width, height: content.height });
    return { ...content, width };
  }

  updateTitle() {
    const t = this.active;
    const base = this.private ? 'Ferna Sundaree (Private)' : 'Ferna Sundaree';
    this.win.setTitle(t && t.title ? `${t.title} – ${base}` : base);
  }

  /** A tab's icon: the kept copy (stays while it sleeps and after a restart), else the page's own. */
  iconFor(tab) {
    const url = tab.pendingUrl || tab.url;
    if (this.private || !this.ctx.favicons) return tab.favicon;
    return this.ctx.favicons.urlFor(url) || tab.favicon || '';
  }

  /** Kept icons of the pinned sites and common-bar pages, by address (for entries not open). */
  stripIcons() {
    const ctx = this.ctx;
    if (!ctx.favicons) return {};
    const urls = new Set([...(ctx.ws.data.common || []), ...(ctx.ws.data.allPinned || []), ...ctx.ws.data.workspaces.flatMap(w => w.pinned || [])].map(p => p && p.url).filter(Boolean));
    const out = {};
    for (const u of urls) { const f = ctx.favicons.urlFor(u); if (f) out[u] = f; }
    return out;
  }

  state() {
    const ctx = this.ctx;
    const t = this.active;
    const wc = t ? liveWc(t.view) : null;
    const url = t ? (t.pendingUrl || t.url) : '';
    return {
      windowId: this.id,
      private: this.private,
      layout: this.layoutState(),
      maximized: this.win.isMaximized(),
      fullscreen: this.win.isFullScreen(),
      theme: ctx.ext ? ctx.ext.themeState() : null,
      settings: {
        tabPosition: ctx.settings.data.tabPosition, tabBarHidden: ctx.settings.data.tabBarHidden, hideBars: ctx.settings.data.hideBars || 'both',
        bookmarksBarHidden: ctx.settings.data.bookmarksBarHidden, verticalCollapsed: ctx.settings.data.verticalCollapsed,
        verticalWidth: ctx.settings.data.verticalWidth, accent: ctx.settings.data.accent, theme: ctx.settings.data.theme,
        hintShown: !!ctx.settings.data.hints.tabBarHidden,
        wsShowNames: !!ctx.settings.data.wsShowNames, stripFavoritesOnly: !!ctx.settings.data.stripFavoritesOnly, depth3d: ctx.settings.data.depth3d !== false,
      },
      shortcutKeys: Object.fromEntries(['favoritesOnly', 'pinTab', 'addToCommon'].map(k => [k, (ctx.shortcuts.map[k] && ctx.shortcuts.map[k].raw && ctx.shortcuts.map[k].raw[0]) || ''])),
      dark: ctx.isDark(),
      focus: this.focus,
      tabs: this.tabs.map(x => ({
        id: x.id, title: x.title, url: x.pendingUrl || x.url, favicon: this.iconFor(x), loading: x.loading, audible: x.audible,
        muted: x.muted, crashed: x.crashed, sleeping: !x.view, ws: this.tabWorkspace(x), wsOverride: x.wsOverride,
      })),
      activeId: this.activeId,
      strip: this.strip(),
      icons: this.stripIcons(),
      workspaces: ctx.ws.data.workspaces.map(w => ({ id: w.id, name: w.name, color: w.color, icon: w.icon, image: w.image, pinned: w.pinned })),
      common: ctx.ws.data.common,
      currentWs: this.currentWs,
      nav: {
        url: url === NEWTAB ? '' : pageUrlOf(url),
        canBack: !!(wc && wc.navigationHistory.canGoBack()),
        canForward: !!(wc && wc.navigationHistory.canGoForward()),
        loading: !!(t && t.loading),
        secure: /^https:/.test(pageUrlOf(url)),
        internal: isInternal(url), pdf: pageUrlOf(url) !== url,
        zoom: ctx.zoomDisplay(this, t),
        hasVideo: !!(t && t.hasVideo), hasMedia: !!(t && (t.hasMedia || t.hasVideo)), pipOn: !!(t && t.pipOn),
        eq: ctx.pageFx.eqDisplay(t),
        bookmarked: !!ctx.findBookmark(pageUrlOf(url)),
        split: !!(t && this.inSplit(t.id)), reader: !!(t && t.readerOn), speaking: !!(t && t.speaking),
        passwords: t ? (t.pwCount || 0) : 0, container: t ? ctx.containerOf(this, t) : null,
        feeds: t && t.feeds && t.feeds.length && !this.private ? { count: t.feeds.length, subscribed: t.feeds.some(f => ctx.feeds && ctx.feeds.isSubscribed(f.url)) } : null,
        check: t && t.check ? { level: t.check.danger || t.check.insecure ? 'danger' : t.check.scam.length ? 'scam' : t.check.claim.length ? 'warn' : t.check.article ? 'article' : '', article: t.check.article, cov: t.check.cov, danger: !!t.check.danger, scam: t.check.scam.length, claim: t.check.claim.length } : null,
        blocked: t ? t.blocked : 0,
        blockerOn: !!ctx.settings.data.blocker && !ctx.settings.data.blockerAllow.includes(hostOf(url)),
      },
      bookmarksBar: ctx.bookmarks.data.items.filter(b => b.folder === 'bar').map(b => ({ id: b.id, title: b.title, url: b.url || '', isFolder: b.type === 'folder' })),
      hasOtherBookmarks: ctx.bookmarks.data.items.some(b => b.folder === 'other'),
      downloads: ctx.downloadSummary(),
      split: this.split && t && this.inSplit(t.id) ? (() => { const c = this.sideLayout(this.layoutState().content); return { ...this.split, activeId: t.id, content: c, divider: this.splitRects(c).divider }; })() : null,
      media: this.mediaCount(),
      side: this.side ? this.side.kind : null,
      feedsUnread: ctx.feeds && !this.private ? ctx.feeds.unreadCount() : 0,
      app: this.appMode ? { name: this.appMode.name, origin: this.appMode.origin } : null,
      ctxTheme: ctx.ctxTheme ? ctx.ctxTheme(this) : null,
      highContrast: ctx.settings.data.highContrastToolbar !== false,
      exam: this.exam ? { title: this.exam.title, endsAt: this.exam.endsAt || 0, allowCopy: !!this.exam.allowCopy } : null,
      parental: !!(ctx.parental && ctx.parental.on()),
      profile: ctx.profile,
    };
  }

  pushState() {
    if (this._stateTimer) return;
    this._stateTimer = setTimeout(() => {
      this._stateTimer = null;
      if (this.win.isDestroyed() || this.ui.webContents.isDestroyed()) return;
      this.ui.webContents.send('state', this.state());
      // The safety-check panel follows the active tab.
      if (this.side && this.side.kind === 'check' && this._checkTab !== this.activeId) { this._checkTab = this.activeId; this.ctx.check.refreshPanel(this); }
      if (this.overlayMode === 'pointer') this.overlay.webContents.send('state', this.state());
    }, 8);
  }

  sendUi(channel, data) {
    if (!this.ui.webContents.isDestroyed()) this.ui.webContents.send(channel, data);
  }

  // ---------- keyboard & commands ----------

  onKey(e, input, wc) {
    const cmd = this.ctx.shortcuts.commandFor(input);
    if (this.exam && this.ctx.examKey && wc !== this.overlay.webContents && this.ctx.examKey(this, e, input, cmd)) return;
    if (!cmd) return;
    if (wc === this.overlay.webContents) {
      // The overlay handles its own keys except the toggles that open/close it.
      if (!['tabOverview', 'tabsAtPointer', 'commandPalette', 'zoomPanel'].includes(cmd)) return;
    }
    if (cmd === 'escape') {
      if (this.overlayMode) { e.preventDefault(); this.closeOverlay(); }
      else if (this.findOpen) { e.preventDefault(); this.closeFind(); }
      else if (this.reveal.toolbar && wc === this.ui.webContents) { this.reveal.toolbar = false; this.relayout(); }
      return; // otherwise Escape belongs to the page
    }
    e.preventDefault();
    this.run(cmd);
  }

  run(cmd) {
    const ctx = this.ctx;
    if (this.exam && !require('./exam').ALLOWED_CMDS.has(cmd)) return;
    // Parental controls: ways around the filter need the parent's password.
    if (ctx.parental && ctx.parental.on() && ['privateWindow', 'torWindow', 'devtools'].includes(cmd) && !this._parentOk) {
      ctx.parentalGate(this, { privateWindow: 'open a private window', torWindow: 'open a Tor window', devtools: 'open developer tools' }[cmd]).then(ok => { if (ok) { this._parentOk = true; try { this.run(cmd); } finally { this._parentOk = false; } } });
      return;
    }
    const GATE = { assistant: 'AssistantAllowed', torWindow: 'TorWindowsAllowed', privateWindow: 'PrivateWindowsAllowed', devtools: 'DeveloperToolsAllowed', installApp: 'WebAppsAllowed' };
    if (GATE[cmd] && ctx.policyAllows && !ctx.policyAllows(GATE[cmd])) { this.sendUi('toast', { text: 'Your organisation has turned this off.' }); return; }
    const t = this.active;
    const wc = t ? liveWc(t.view) : null;
    const s = ctx.settings.data;
    switch (cmd) {
      case 'toggleTabBar':
        // A bar brought back by the window edge must not keep it on screen after the shortcut.
        for (const w of ctx.windows) w.reveal = { tabs: false, toolbar: false };
        ctx.setSetting('tabBarHidden', !s.tabBarHidden);
        for (const w of ctx.windows) w.relayout();
        if (ctx.settings.data.tabBarHidden && !s.hints.barsHidden082) {
          ctx.settings.update(d => { d.hints.barsHidden082 = true; d.hints.tabBarHidden = true; });
          const which = s.hideBars || 'both';
          this.sendUi('toast', { text: which === 'toolbar' ? 'Address bar hidden: its address and buttons are now in the tab bar. Ctrl+Shift+H shows it again.' : which === 'tabs' ? 'Tab bar hidden. Ctrl+Shift+H shows it again.' : 'Bars hidden. Ctrl+L or the tabs list at the pointer reach the address; Ctrl+Shift+H shows them again.', ms: 7000 });
        }
        break;
      case 'toggleBookmarksBar': ctx.setSetting('bookmarksBarHidden', !s.bookmarksBarHidden); break;
      case 'cycleTabPosition': {
        const order = ['top', 'left', 'right'];
        ctx.setSetting('tabPosition', order[(order.indexOf(s.tabPosition) + 1) % 3]);
        break;
      }
      case 'collapseTabs': ctx.setSetting('verticalCollapsed', !s.verticalCollapsed); break;
      case 'favoritesOnly': ctx.setSetting('stripFavoritesOnly', !s.stripFavoritesOnly); break;
      case 'pip': if (t && t.kind === 'web') ctx.pageFx.pip(this, t); break;
      case 'splitView': if (this.split && t && this.inSplit(t.id)) this.exitSplit(); else if (t) this.splitWith(t); break;
      case 'swapSplit': this.swapSplit(); break;
      case 'mediaPanel': this.openMediaPanel(); break;
      case 'sleepTab': if (t) { const o = this.visibleOrder().find(id => id !== t.id); if (o) { const x = t; this.activate(this.tabs.find(k => k.id === o)); this.sleepTab(x); } } break;
      case 'taskManager': this.openInternal('ferna://tasks/'); break;
      case 'readerMode': if (t && t.kind === 'web') ctx.pageFx.reader(this, t); break;
      case 'readAloud': if (t && t.kind === 'web') ctx.pageFx.readAloud(this, t); break;
      case 'translatePage': if (t && t.kind === 'web') ctx.translatePage(this, t); break;
      case 'assistant': ctx.toggleAssistant(this); break;
      case 'passwords': this.openInternal('ferna://passwords/'); break;
      case 'torWindow': ctx.openTorWindow(); break;
      case 'examMode': this.openInternal('ferna://exam/'); break;
      case 'parentalControls': this.openInternal('ferna://parental/'); break;
      case 'installApp': if (t && /^https?:/.test(t.url || '')) ctx.installApp(this, t); break;
      case 'readingList': this.openInternal('ferna://bookmarks/#reading'); break;
      case 'addToReadingList': if (t && /^https?:/.test(t.url || '')) { ctx.bmSvc.addToReadingList(t.url, t.title); this.sendUi('toast', { text: 'Added to your reading list.' }); } break;
      case 'pickElement': if (t && t.kind === 'web') ctx.pageFx.pickElement(this, t); break;
      case 'equalizer': this.openEqPanel(); break;
      case 'bookmarksPanel': this.openBookmarksPanel(); break;
      case 'pinTab': if (t) this.togglePin(t); break;
      case 'addToCommon': if (t) this.toggleCommon(t); break;
      case 'workspaceNames': ctx.setSetting('wsShowNames', !s.wsShowNames); break;
      case 'focusMode': this.focus = !this.focus; this.reveal = { tabs: false, toolbar: false }; this.relayout(); break;
      case 'tabOverview':
        if (this.overlayMode === 'overview') this.closeOverlay();
        else this.overviewData().then(d => this.openOverlay('overview', d));
        break;
      case 'tabsAtPointer':
        if (this.overlayMode === 'pointer') this.closeOverlay(); else this.openOverlay('pointer', this.pointerData());
        break;
      case 'commandPalette':
        if (this.overlayMode === 'palette') this.closeOverlay(); else this.overviewData().then(d => this.openOverlay('palette', d));
        break;
      case 'nextWorkspace': this.rotateWorkspace(1); break;
      case 'prevWorkspace': this.rotateWorkspace(-1); break;
      case 'shotVisible': case 'shotFull': case 'shotRegion': case 'shotElement': this.screenshot(cmd); break;
      case 'newTab': this.newTab(NEWTAB); this.sendUi('focus-address', {}); break;
      case 'closeTab': if (t) this.closeTab(t); break;
      case 'reopenTab': {
        const c = this.closed.pop();
        if (c) this.newTab(c.url, { index: c.index, wsOverride: c.wsOverride });
        break;
      }
      case 'recentTab': case 'recentTabBack': {
        // Ctrl+Tab switches to the tab you used just before; pressing it again comes back, so it
        // flips between the two most recent tabs (TGI's choice). Ctrl+PageDown/Up keep strip order.
        const visible = new Set(this.visibleOrder());
        let next = this.tabs.find(x => x.id === this.prevTabId && x.id !== this.activeId && visible.has(x.id));
        if (!next) next = this.tabs.filter(x => x.id !== this.activeId && visible.has(x.id)).sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0))[0];
        if (next) this.activate(next);
        break;
      }
      case 'nextTab': case 'prevTab': {
        const ids = this.visibleOrder();
        if (!ids.length) break;
        const i = ids.indexOf(this.activeId);
        const n = ids[(i + (cmd === 'nextTab' ? 1 : -1) + ids.length) % ids.length];
        this.activate(this.tabs.find(x => x.id === n));
        break;
      }
      case 'tab1': case 'tab2': case 'tab3': case 'tab4': case 'tab5': case 'tab6': case 'tab7': case 'tab8': {
        const ids = this.visibleOrder();
        const n = ids[Number(cmd.slice(3)) - 1];
        if (n) this.activate(this.tabs.find(x => x.id === n));
        break;
      }
      case 'tabLast': { const ids = this.visibleOrder(); if (ids.length) this.activate(this.tabs.find(x => x.id === ids[ids.length - 1])); break; }
      case 'newWindow': ctx.newWindow({}); break;
      case 'privateWindow': ctx.newWindow({ private: true }); break;
      case 'focusAddress': {
        if (this.focus) { this.reveal.toolbar = true; this.relayout(); }
        const L = this.layoutState();
        if (!this.focus && !L.toolbar) {
          // The address bar is hidden with Ctrl+Shift+H: the address field in the tab bar, or in
          // the Ferna Tabs list when the tab bar is hidden too.
          if (L.tabs) { this.ui.webContents.focus(); this.sendUi('focus-address', { inline: true }); }
          else this.openOverlay('pointer', { ...this.pointerData(), center: true, editAddress: true });
          break;
        }
        this.ui.webContents.focus(); this.sendUi('focus-address', {});
        break;
      }
      case 'find': this.openFind(); this.ui.webContents.focus(); break;
      case 'history': this.openInternal('ferna://history/'); break;
      case 'downloads': this.openInternal('ferna://downloads/'); break;
      case 'bookmarkManager': this.openInternal('ferna://bookmarks/'); break;
      case 'bookmark': { const pu = t ? pageUrlOf(t.url) : ''; if (t && /^(https?|file):/i.test(pu)) ctx.toggleBookmark(pu, t.title); break; }
      case 'zoomIn': case 'zoomOut': case 'zoomReset': case 'zoomType': case 'zoomAutoFit': case 'fontReset':
        if (t && t.view && t.kind === 'web') ctx.zoomAct(this, t, { zoomIn: 'in', zoomOut: 'out', zoomReset: 'reset', zoomType: 'type', zoomAutoFit: 'autofit', fontReset: 'fontReset' }[cmd]);
        break;
      case 'zoomPanel': this.openZoomPanel(); break;
      case 'extensions': this.openInternal('ferna://extensions/'); break;
      case 'back': if (wc && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); break;
      case 'forward': if (wc && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); break;
      case 'reload': if (wc) wc.reload(); break;
      case 'hardReload': if (wc) wc.reloadIgnoringCache(); break;
      case 'devtools': if (wc) wc.toggleDevTools(); break;
      case 'print': if (wc) wc.print({}, () => {}); break;
      case 'savePage': this.savePage(); break;
      case 'openFile': this.openFile(); break;
      case 'fullscreen': this.win.setFullScreen(!this.win.isFullScreen()); break;
      default: break;
    }
  }

  async openFile() {
    const r = await dialog.showOpenDialog(this.win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Documents and pages', extensions: ['pdf', 'html', 'htm', 'svg', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'webp'] }, { name: 'All files', extensions: ['*'] }],
    });
    if (r.canceled) return;
    const { pathToFileURL } = require('url');
    r.filePaths.forEach(p => this.newTab(pathToFileURL(p).toString()));
  }

  async savePage() {
    const t = this.active;
    if (!t || !t.view || isInternal(t.url)) return;
    const name = (t.title || 'page').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 100);
    const r = await dialog.showSaveDialog(this.win, {
      defaultPath: path.join(this.ctx.downloadsDir(), `${name}.html`),
      filters: [{ name: 'Web page, complete', extensions: ['html'] }, { name: 'Web page, single file', extensions: ['mhtml'] }],
    });
    if (r.canceled || !r.filePath) return;
    await t.view.webContents.savePage(r.filePath, r.filePath.endsWith('.mhtml') ? 'MHTML' : 'HTMLComplete').catch(() => {});
  }

  // ---------- screenshots ----------

  async screenshot(cmd) {
    const t = this.active;
    if (!t || t.kind !== 'web' || !liveWc(t.view)) {
      this.sendUi('toast', { text: 'Screenshots work on web pages.' });
      return;
    }
    const wc = t.view.webContents;
    const meta = { url: t.url, title: t.title, time: new Date().toISOString(), windowId: this.id };
    const st = this.ctx.shotSettings();
    const fullOpts = { maxHeight: st.maxHeight, cssPixels: st.resolution === 'css' };
    const wait = async () => {
      if (!st.delay) return;
      this.sendUi('toast', { text: `Capturing in ${st.delay} s…` });
      await new Promise(r => setTimeout(r, st.delay * 1000));
    };
    try {
      if (cmd === 'shotVisible') {
        await wait();
        const img = await capture.captureVisible(wc);
        const m = await capture.pageMetrics(wc).catch(() => null);
        this.ctx.openShot(this, img, { ...meta, mode: 'visible', cssWidth: m ? m.vw : undefined });
      } else if (cmd === 'shotFull') {
        await wait();
        this.sendUi('toast', { text: 'Capturing the entire page…' });
        const r = await capture.captureFull(wc, fullOpts);
        this.ctx.openShot(this, r.image, { ...meta, mode: 'full', cssWidth: r.cssWidth, truncated: r.partial });
        if (r.partial) this.sendUi('toast', { text: `The page is very long; the first ${st.maxHeight.toLocaleString()} px were captured.` });
      } else if (cmd === 'shotElement') {
        this.sendUi('toast', { text: 'Click an element to capture it. Esc cancels.' });
        wc.focus();
        const rect = await capture.pickElement(wc);
        if (!rect || rect.width < 1 || rect.height < 1) return;
        const r = await capture.captureFull(wc, { ...fullOpts, maxHeight: Math.max(st.maxHeight, Math.ceil(rect.y + rect.height)) });
        this.ctx.openShot(this, capture.cropCss(r.image, rect, r.cssWidth), { ...meta, mode: 'element', cssWidth: rect.width });
      } else if (cmd === 'shotRegion') {
        const [r, m] = await Promise.all([capture.captureFull(wc, fullOpts), capture.pageMetrics(wc).catch(() => ({ scrollX: 0, scrollY: 0 }))]);
        const id = this.ctx.storeShot(r.image, { ...meta, mode: 'region' });
        this._region = { id, image: r.image, cssWidth: r.cssWidth || r.image.getSize().width, meta };
        const L = this.layoutState();
        this.openOverlay('region', {
          id, cssWidth: this._region.cssWidth, size: r.image.getSize(), scrollX: m.scrollX, scrollY: m.scrollY,
          content: L.content,
        });
      }
    } catch (err) {
      this.sendUi('toast', { text: `Screenshot failed: ${err.message}` });
    }
  }

  finishRegion(rect) {
    const reg = this._region;
    this._region = null;
    this.closeOverlay();
    if (!reg || !rect) return;
    const img = capture.cropCss(reg.image, rect, reg.cssWidth);
    this.ctx.dropShot(reg.id);
    this.ctx.openShot(this, img, { ...reg.meta, mode: 'region', cssWidth: rect.width });
  }

  // ---------- session ----------

  serialize() {
    const b = this.win.isMaximized() ? this.win.getNormalBounds() : this.win.getBounds();
    return {
      bounds: b, maximized: this.win.isMaximized(), currentWs: this.currentWs,
      active: Math.max(0, this.tabs.indexOf(this.active)),
      tabs: this.tabs.filter(t => t.url && !/^ferna:\/\/(interstitial|shot)/.test(t.url)).map(t => ({ url: t.pendingUrl || t.url, wsOverride: t.wsOverride, title: t.title })),
    };
  }

  destroy() {
    for (const t of this.tabs) {
      if (liveWc(t.view)) t.view.webContents.close();
    }
    for (const v of [this.ui, this.overlay, this.sideCache, this.peek && this.peek.view]) if (v && !v.webContents.isDestroyed()) v.webContents.close();
    this.tabs = [];
    this.ctx.onWindowClosed(this);
  }
}

module.exports = { FernaWindow, NEWTAB, isInternal };

Object.assign(FernaWindow.prototype, require('./tabfx').mixin);
