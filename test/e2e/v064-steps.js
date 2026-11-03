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

};
