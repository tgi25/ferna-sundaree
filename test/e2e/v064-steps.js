'use strict';
// End-to-end steps for 0.6.4: cut/copy/paste menu in the address bar, × on the right of tabs,
// dragging a tab onto the common bar or the pinned area, ad-blocking scriptlets once at page
// start, pinning PDFs from the tab menu, local files claimed by pinned folders.

module.exports = async function v064({ step, assert, main, win, page, H, base, shot, freshTab, evalActive }) {
  const ui = () => page('ferna://ui/');
  const active = async () => { const s = await win(); return s.tabs.find(t => t.id === s.active); };
  const state = () => main(() => global.__ferna.windows[0].state());

  await step('0.6.4 address bar right-click menu: undo, cut, copy, paste, paste and go, select all', async () => {
    const r = await main(async e => {
      const w = global.__ferna.windows[0];
      const wc = w.ui.webContents;
      const menus = global.__ferna._menus;
      const listeners = wc.listenerCount('context-menu');
      await e.clipboard.writeText('127.0.0.1');
      let went = null;
      const m = await menus.editMenu(w, wc, { isEditable: true, editFlags: { canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: true, canDelete: true, canSelectAll: true } }, { goText: t => { went = t; } });
      const labels = m.items.filter(i => i.type !== 'separator').map(i => i.label);
      m.items.find(i => i.label === 'Paste and go').click();
      const sel = await menus.editMenu(w, wc, { isEditable: false, selectionText: 'abc', editFlags: {} });
      const none = await menus.editMenu(w, wc, { isEditable: false, selectionText: '', editFlags: {} });
      return { listeners, labels, went, sel: sel && sel.items.map(i => i.label), none };
    });
    assert(r.listeners >= 1, 'UI listens for right-clicks');
    assert(['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Paste and go', 'Delete', 'Select all'].every(l => r.labels.includes(l)), JSON.stringify(r.labels));
    assert(r.went === '127.0.0.1', `paste and go: ${r.went}`);
    assert(JSON.stringify(r.sel) === '["Copy"]' && r.none === null, JSON.stringify(r));
  });

  await step('0.6.4 tab close button is on the right; common bar and pin buttons stay on the left', async () => {
    await freshTab(`${base}/long.html?right-close`);
    const u = await ui();
    for (const position of ['left', 'top']) {
      await main((_, p) => global.__ferna.setSetting('tabPosition', p), position);
      await H.sleep(500);
      const pos = await u.evaluate(() => {
        const t = document.querySelector('#tabs .tab.active');
        const r = sel => { const e = t.querySelector(sel); return e ? e.getBoundingClientRect().left : null; };
        return { close: r('[data-close]'), title: r('.title'), pin: r('[data-pin-tab]'), last: t.lastElementChild.className };
      });
      assert(pos.close > pos.title && /\bx\b/.test(pos.last), `${position}: ${JSON.stringify(pos)}`);
      if (position === 'left') { assert(pos.pin < pos.title, `pin on the left ${JSON.stringify(pos)}`); await u.hover('#tabs .tab.active'); await shot('v064-01-close-right'); }
    }
  });

  await step('0.6.4 drag a tab onto the common bar or the pinned area', async () => {
    await main(() => { const w = global.__ferna.windows[0]; w.switchWorkspace(null); global.__ferna.setSetting('tabPosition', 'left'); });
    await H.sleep(400);
    const url = `${base}/long.html?drag-me`;
    // A pin claims the open tab of its page; close earlier test pages from the same folder.
    await main((_, b) => { const w = global.__ferna.windows[0]; for (const t of [...w.tabs]) if ((t.url || '').startsWith(b)) w.closeTab(t); }, base);
    await freshTab(url);
    const tab = await active();
    const u = await ui();
    const drag = (zone) => u.evaluate(({ id, zone }) => {
      // The tab itself, or (once it is on the common bar) its common bar button.
      const src = document.querySelector(`#tabs .tab[data-id="${id}"], #tabs [data-drag-tab="${id}"]`);
      if (!src) throw new Error(`drag ${zone}: no tab ${id} in ` + [...document.querySelectorAll('#tabs .tab')].map(t => t.outerHTML.slice(0, 160)).join(' ## ') + ' S=' + JSON.stringify((window.S && S.tabs || []).map(t => t.id)));
      const dt = new DataTransfer();
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      const z = document.querySelector(`#tabs [data-dz="${zone}"]`);
      const found = !!z, temp = !!(z && z.dataset.temp);
      if (z) {
        z.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
        const over = z.classList.contains('dz-over');
        z.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
        src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
        return { found, temp, over };
      }
      src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
      return { found };
    }, { id: tab.id, zone });
    await H.until(() => u.evaluate(id => !!document.querySelector(`#tabs .tab[data-id="${id}"]`), tab.id), 4000, 'tab in the strip');
    // Picture of the targets while a tab is held over the common bar.
    await u.evaluate(id => {
      const src = window.__src = document.querySelector(`#tabs .tab[data-id="${id}"]`);
      if (!src) throw new Error('mid: no tab');
      window.__dt = new DataTransfer();
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.__dt }));
      const z = document.querySelector('#tabs [data-dz="common"]'); if (!z) throw new Error('no zone: ' + document.querySelector('#tabs').className + ' ' + [...document.querySelector('#tabs').children].map(c => c.className).join('|') + ' drag=' + !!document.querySelector('#tabs.tab-dragging'));
      z.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.__dt }));
    }, tab.id);
    await shot('v064-02a-drop-targets');
    const after = await u.evaluate(() => { const inDoc = document.contains(window.__src); window.__src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: window.__dt })); return inDoc; });
    assert(after, 'the strip was not redrawn during the drag');
    // Empty common bar: a temporary target appears while dragging.
    const hadCommon = await main(() => global.__ferna.ws.data.common.length);
    const c = await drag('common');
    assert(c.found && c.over && (hadCommon ? true : c.temp), JSON.stringify(c));
    await H.until(() => main((_, x) => global.__ferna.findCommon(x) >= 0, url), 3000, 'on the common bar');
    const p = await drag('pin');
    assert(p.found && p.over, JSON.stringify(p));
    await H.until(() => main((_, x) => global.__ferna.findPin('', x) >= 0, url), 3000, 'pinned in All tabs');
    // Dropping again does not take it off.
    await drag('common');
    await H.sleep(300);
    assert(await main((_, x) => global.__ferna.findCommon(x) >= 0, url), 'still on the common bar');
    const left = await u.evaluate(() => document.querySelectorAll('#tabs [data-temp]').length);
    assert(left === 0, 'temporary targets removed');
    const s = await state();
    assert(s.strip.pinned.some(r => r.pin.url === url && r.tabId === tab.id), `pinned row claims the tab ${tab.id}: ${JSON.stringify(s.strip.pinned.map(r => [r.pin.url, r.tabId]))} tabs=${JSON.stringify(s.tabs.map(t => [t.id, t.url]))} ws=${s.currentWs}`);
    await shot('v064-02b-dragged');
    await main((_, x) => { const c = global.__ferna; c.removeCommon(c.findCommon(x)); c.unpinSite('', c.findPin('', x)); c.setSetting('tabPosition', 'top'); }, url);
  });

  await step('0.6.4 ad-blocking scriptlets run once, before the page\'s own code', async () => {
    const ids = () => main(() => global.__ferna.webSession.getPreloadScripts().map(p => p.id));
    const off = await main(() => global.__ferna.settings.data.listScriptlets);
    assert(off === false && !(await ids()).includes('ferna-scriptlets'), 'list scriptlets are off by default, no preload');
    await main(() => global.__ferna.setSetting('listScriptlets', true));
    const reg = await ids();
    assert(reg.includes('ferna-scriptlets'), `preloads: ${reg}`);
    // Stand-in rule: a scriptlet that records when it ran and how many times.
    await main(() => {
      const fx = global.__ferna.pageFx;
      fx._orig = fx.scriptletsFor;
      fx.scriptletsFor = u => /scriptlet-test/.test(u) ? ['window.__fsRuns = (window.__fsRuns || 0) + 1; window.__fsState = document.readyState;'] : [];
    });
    try {
      await freshTab(`${base}/long.html?scriptlet-test`);
      await H.sleep(3000); // past the late second cosmetic pass
      const r = await evalActive('({ runs: window.__fsRuns, state: window.__fsState })');
      assert(r.runs === 1 && r.state === 'loading', JSON.stringify(r));
      const other = await main(() => global.__ferna.pageFx._orig('http://127.0.0.1/'));
      assert(Array.isArray(other), 'real lookup answers');
    } finally {
      await main(() => { const fx = global.__ferna.pageFx; fx.scriptletsFor = fx._orig; delete fx._orig; global.__ferna.setSetting('listScriptlets', false); });
    }
  });

  await step('0.6.4 PDFs: “Pin to” in the tab menu works; right-click in the reader pins too', async () => {
    const pdf = `${base}/test.pdf`;
    await main((_, x) => { const w = global.__ferna.windows[0]; for (const t of [...w.tabs]) if (decodeURIComponent(t.url).includes(x)) w.closeTab(t); }, pdf);
    await main((_, x) => global.__ferna.windows[0].newTab(x), pdf);
    await H.until(async () => /^ferna:\/\/pdf\//.test((await active()).url), 8000, 'pdf in reader');
    const r = await main(async (_, x) => {
      const c = global.__ferna, w = c.windows[0], tab = w.active, menus = c._menus;
      const m = menus.tabMenu(w, tab);
      const pinTo = m.items.find(i => i.label === 'Pin to');
      const enabled = pinTo && pinTo.enabled;
      pinTo.submenu.items.find(i => i.label === 'All tabs').click();
      const pinned = c.findPin('', x) >= 0;
      const pm = await menus.pdfMenu(w, tab, { isEditable: false, selectionText: '', editFlags: {} });
      const labels = pm.items.map(i => i.label);
      pm.items.find(i => i.label === 'Add to common bar').click();
      const common = c.findCommon(x) >= 0;
      c.unpinSite('', c.findPin('', x)); c.removeCommon(c.findCommon(x));
      return { enabled, pinned, labels, common };
    }, pdf);
    assert(r.enabled && r.pinned && r.common, JSON.stringify(r));
    assert(r.labels.includes('Bookmark this PDF'), JSON.stringify(r.labels));
  });

  await step('0.6.7 YouTube: a video the player stops by itself keeps playing (first load, Next); your own pause stays', async () => {
    const port = new URL(base).port;
    await freshTab(`http://localhost:${port}/yt-watch.html`);
    const paused = () => evalActive('document.getElementById("v").paused');
    await H.until(() => evalActive('window.__selfPaused >= 1'), 6000, 'the page paused its video');
    await H.until(async () => !(await paused()), 4000, 'resumed after the first load');
    // A real click on "Next" (not on the player), then the page stops the new video.
    const wc = await main(() => global.__ferna.windows[0].active.view.webContents.id);
    const box = await evalActive(`(() => { const r = document.getElementById('next').getBoundingClientRect(); return { x: Math.round(r.left + 5), y: Math.round(r.top + 5) }; })()`);
    const click = (x, y) => main((e, a) => { const w = e.webContents.fromId(a.wc); for (const type of ['mouseDown', 'mouseUp']) w.sendInputEvent({ type, x: a.x, y: a.y, button: 'left', clickCount: 1 }); }, { wc, x, y });
    await click(box.x, box.y);
    await H.until(() => evalActive('window.__selfPaused >= 2'), 6000, 'the page paused the next video');
    await H.until(async () => !(await paused()), 4000, 'resumed after Next');
    // "ad-showing" for a moment with no ad on screen: the real video is not skipped.
    const t0 = await evalActive('document.getElementById("v").currentTime');
    await evalActive(`document.getElementById('adflash').click(); true`);
    await H.sleep(1500);
    const after = await evalActive('({ t: document.getElementById("v").currentTime, rate: document.getElementById("v").playbackRate })');
    assert(after.rate === 1 && after.t < t0 + 3, `not skipped ${JSON.stringify({ t0, after })}`);
    // Your own pause on the play button is kept.
    const pb = await evalActive(`(() => { const r = document.getElementById('pp').getBoundingClientRect(); return { x: Math.round(r.left + 5), y: Math.round(r.top + 5) }; })()`);
    await click(pb.x, pb.y);
    await H.sleep(1200);
    assert(await paused(), 'your pause is kept');
  });
  await step('0.6.8 icons stay: a sleeping tab, a pinned site and a common-bar page keep their favicon', async () => {
    const url = `${base}/fav.html`;
    await main(() => { const w = global.__ferna.windows[0]; w.switchWorkspace(null); });
    await freshTab(url);
    await H.until(() => main((_, u) => !!global.__ferna.favicons.lookup(u), url), 6000, 'icon kept');
    const tab = await active();
    await freshTab(`${base}/long.html?fav-other`);
    // Put the first tab to sleep, as happens after a period of inactivity.
    assert(await main((_, id) => { const w = global.__ferna.windows[0]; return w.sleepTab(w.tabs.find(t => t.id === id)); }, tab.id), 'slept');
    const u = await ui();
    const iconOk = sel => u.evaluate(s => { const img = document.querySelector(s); return !!img && img.tagName === 'IMG' && /^ferna:\/\/favicon\//.test(img.getAttribute('src')) && img.complete && img.naturalWidth > 0; }, sel);
    await H.until(() => iconOk(`#tabs .tab[data-id="${tab.id}"] img.favicon`), 4000, 'sleeping tab keeps its icon');
    // Pin it and put it on the common bar, then close it: both still show the icon.
    await main((_, x) => { const c = global.__ferna; c.pinSite('', x, 'Fav'); c.addCommon(x, 'Fav'); }, url);
    // Close it and the other test page (a pin also shows other open pages of its folder).
    await main((_, b) => { const w = global.__ferna.windows[0]; for (const t of [...w.tabs]) if (decodeURIComponent(t.url || '').includes(b)) w.closeTab(t); }, base);
    const idx = await main((_, x) => global.__ferna.findCommon(x), url);
    await H.until(() => iconOk(`#tabs [data-common="${idx}"] img.favicon`), 4000, 'common bar icon');
    await H.until(() => u.evaluate(() => [...document.querySelectorAll('#tabs [data-pinned] img.favicon')].some(i => i.complete && i.naturalWidth > 0)), 4000, 'pinned icon');
    await shot('v068-01-kept-icons');
    // Web pages cannot read the kept icons.
    await freshTab(`${base}/long.html?fav-check`);
    const fromPage = await evalActive(`fetch('ferna://favicon/?k=x').then(() => 'read', () => 'blocked')`);
    assert(fromPage === 'blocked', `page fetch: ${fromPage}`);
    await main((_, x) => { const c = global.__ferna; c.removeCommon(c.findCommon(x)); c.unpinSite('', c.findPin('', x)); }, url);
  });
  await step('0.6.9 the current tab stands out on light, dark and black themes (top and vertical tabs)', async () => {
    const u = await ui();
    await freshTab(`${base}/long.html?cur-a`);
    await freshTab(`${base}/long.html?cur-b`);
    const results = [];
    for (const theme of ['light', 'dark']) {
      for (const colour of [null, '#111827', '#000000']) {
        for (const position of ['top', 'left']) {
          const id = await main((_, a) => {
            const ctx = global.__ferna; ctx.setSetting('tabPosition', a.position);
            if (!a.colour) { ctx.windows[0].switchWorkspace(null); return null; }
            const w = ctx.createWorkspace(`Cur ${a.colour}`); w.color = a.colour; ctx.ws.save(); ctx.windows[0].switchWorkspace(w.id);
            ctx.windows[0].activate(ctx.windows[0].tabs[ctx.windows[0].tabs.length - 1]);
            return w.id;
          }, { theme, colour, position });
          await main((e, t) => { e.nativeTheme.themeSource = t; }, theme);
          await u.emulateMedia({ colorScheme: theme });
          await H.sleep(300);
          await H.sleep(600);
          const c = await u.evaluate(() => ({ ...window.__fernaContrast().curTab, dark: matchMedia('(prefers-color-scheme: dark)').matches, bar: getComputedStyle(document.querySelector('#tabs')).backgroundColor, tab: getComputedStyle(document.querySelector('#tabs .tab.active')).backgroundColor, mk: getComputedStyle(document.querySelector('#tabs .tab.active'), '::after').backgroundColor }));
          results.push({ theme, colour, position, c });
          if (theme === 'dark' && colour === '#000000' && position === 'left') await shot('v069-01-current-tab-black');
          if (theme === 'dark' && !colour) await shot(`v069-02-current-tab-dark-${position}`);
          if (id) await main((_, i) => { const ctx = global.__ferna; ctx.windows[0].switchWorkspace(null); ctx.deleteWorkspace(i); }, id);
        }
      }
    }
    await u.emulateMedia({ colorScheme: null });
    await main(e => { e.nativeTheme.themeSource = global.__ferna.settings.data.theme || 'system'; });
    await main(() => { const ctx = global.__ferna; ctx.setSetting('tabPosition', 'top'); });
    // Dark bars: the current tab's background is lifted clearly; light bars keep a white tab with a shadow.
    const darkBar = r => (r.c.bar.match(/\d+/g) || []).slice(0, 3).reduce((a, v) => a + Number(v), 0) < 300;
    const bad = results.filter(r => !r.c || r.c.mark < 3 || (r.position === 'left' && darkBar(r) && r.c.bg < 1.4));
    assert(results.some(r => darkBar(r) && r.position === 'left'), 'a dark bar was tested');
    assert(!bad.length, JSON.stringify(bad));
  });
};
