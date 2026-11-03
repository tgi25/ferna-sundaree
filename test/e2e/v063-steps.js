'use strict';
// End-to-end steps for 0.6.3: Ctrl+Tab to the recently used tab, copy/clear in the address bar,
// pinning PDFs, the default bookmark folder, tab buttons on the left, clicks while the strip
// redraws, automatic secure DNS.

module.exports = async function v063({ step, assert, main, win, page, H, base, shot, freshTab }) {
  const ui = () => page('ferna://ui/');
  const active = async () => { const s = await win(); return s.tabs.find(t => t.id === s.active); };
  const state = () => main(() => global.__ferna.windows[0].state());

  await step('0.6.3 Ctrl+Tab goes to the previously used tab; holding Ctrl walks further back', async () => {
    await main(() => { const w = global.__ferna.windows[0]; w.switchWorkspace(null); });
    for (const q of ['a', 'b', 'c']) await freshTab(`${base}/long.html?mru-${q}`);
    const id = async q => (await win()).tabs.find(t => t.url.includes(`mru-${q}`)).id;
    const A = await id('a'), B = await id('b'), C = await id('c');
    // Visit order: A, C, B (B is current).
    for (const t of [A, C, B]) { await main((_, i) => { const w = global.__ferna.windows[0]; w.activate(w.tabs.find(x => x.id === i)); w.mru = null; }, t); await H.sleep(60); }
    const ctrlTab = () => main(() => global.__ferna.windows[0].run('recentTab'));
    const ctrlUp = () => main(() => global.__ferna.windows[0].onKey({ preventDefault() {} }, { type: 'keyUp', key: 'Control' }, null));
    await ctrlTab(); await ctrlUp();
    assert((await win()).active === C, 'Ctrl+Tab → the tab used before (C)');
    await ctrlTab(); await ctrlUp();
    assert((await win()).active === B, 'Ctrl+Tab again → back to B');
    await ctrlTab(); await ctrlTab(); await ctrlUp();
    assert((await win()).active === A, 'holding Ctrl, Tab twice → A');
    const keys = await main(() => global.__ferna.shortcuts.map);
    assert(keys.recentTab.some(k => k.code === 'Tab' && k.ctrl && !k.shift) && keys.nextTab.every(k => k.code !== 'Tab'), JSON.stringify({ r: keys.recentTab, n: keys.nextTab }));
  });

  await step('0.6.3 address bar: copy and clear buttons', async () => {
    await freshTab(`${base}/long.html?copy-me`);
    const u = await ui();
    await H.until(() => u.evaluate(() => !document.querySelector('#btn-copyurl').hidden && !document.querySelector('#btn-clearurl').hidden), 3000, 'buttons shown');
    await main(e => e.clipboard.writeText('nothing'));
    await u.click('#btn-copyurl');
    await H.until(async () => /copy-me/.test(await main(e => e.clipboard.readText())), 3000, 'copied');
    await u.click('#btn-clearurl');
    const v = await u.evaluate(() => ({ value: document.querySelector('#address').value, focused: document.activeElement.id }));
    assert(v.value === '' && v.focused === 'address', JSON.stringify(v));
    await shot('v063-01-address-buttons');
    await u.evaluate(() => document.querySelector('#address').blur());
  });

  await step('0.6.3 PDFs: pinned in All tabs and on the common bar; address shows the file; bookmarkable', async () => {
    const pdf = `${base}/test.pdf`;
    // Earlier steps may have this PDF open already; keep one tab of it.
    await main((_, u) => { const w = global.__ferna.windows[0]; for (const t of [...w.tabs]) if (decodeURIComponent(t.url).includes(u)) w.closeTab(t); }, pdf);
    await main((_, u) => global.__ferna.windows[0].newTab(u), pdf);
    await H.until(async () => /^ferna:\/\/pdf\//.test((await active()).url), 8000, 'pdf in reader');
    const tab = await active();
    await main(() => global.__ferna.windows[0].run('pinTab'));
    const pinned = await main(() => global.__ferna.ws.data.allPinned.map(p => p.url));
    assert(pinned.includes(pdf), `pinned: ${pinned}`);
    let s = await state();
    const row = s.strip.pinned.find(p => p.pin.url === pdf);
    assert(row && row.tabId === tab.id, 'pinned row claims the PDF tab');
    assert(s.nav.url === pdf && s.nav.pdf, `address ${s.nav.url}`);
    await main(() => global.__ferna.windows[0].run('addToCommon'));
    s = await state();
    assert(s.strip.common.some(c => c.entry.url === pdf && c.tabId === tab.id), 'on the common bar');
    await main(() => global.__ferna.windows[0].run('bookmark'));
    assert(await main((_, u) => !!global.__ferna.findBookmark(u), pdf), 'bookmarked');
    await shot('v063-02-pdf-pinned');
    // Tidy up.
    await main((_, u) => { const c = global.__ferna; c.windows[0].run('bookmark'); c.removeCommon(c.findCommon(u)); c.unpinSite('', c.findPin('', u)); }, pdf);
  });

  await step('0.6.3 default bookmark folder: new bookmarks go there and the popup opens in it', async () => {
    const fid = await main(() => {
      const c = global.__ferna;
      c.bookmarkOp('folder', { parent: 'bar', title: 'Lectures' });
      const f = c.bookmarks.data.items.find(x => x.type === 'folder' && x.title === 'Lectures');
      c.setSetting('bookmarkFolder', f.id);
      return f.id;
    });
    await freshTab(`${base}/long.html?bm-default`);
    await main(() => global.__ferna.windows[0].run('bookmark'));
    const parent = await main(() => (global.__ferna.bookmarks.data.items.find(x => (x.url || '').includes('bm-default')) || {}).folder);
    assert(parent === fid, `saved in ${parent}`);
    await main(() => global.__ferna.windows[0].openBookmarksPanel());
    const ov = await page('ferna://overlay/');
    await H.until(() => ov.evaluate(() => /Lectures/.test((document.querySelector('.crumb.cur') || {}).textContent || '')), 3000, 'popup opened in Lectures');
    await shot('v063-03-default-folder');
    await main(() => { const c = global.__ferna; c.windows[0].closeOverlay(); c.setSetting('bookmarkFolder', ''); });
  });

  await step('0.6.3 tab buttons on the left: common bar and pin before the icon and title', async () => {
    await freshTab(`${base}/long.html?left-buttons`);
    const u = await ui();
    // Vertical tabs are wide enough for all three buttons (narrow top tabs keep only ×).
    await main(() => global.__ferna.setSetting('tabPosition', 'left'));
    await H.sleep(600);
    const pos = await u.evaluate(() => {
      const t = document.querySelector('#tabs .tab.active');
      const r = sel => { const e = t.querySelector(sel); return e ? e.getBoundingClientRect().left : null; };
      return { star: r('[data-common-tab]'), pin: r('[data-pin-tab]'), close: r('[data-close]'), title: r('.title'), first: t.firstElementChild.className };
    });
    // 0.6.4: × moved back to the right; the common bar and pin buttons stay on the left.
    assert(pos.first === 'lacts' && pos.star < pos.pin && pos.pin < pos.title && pos.close > pos.title, JSON.stringify(pos));
    await u.hover('#tabs .tab.active');
    await shot('v063-04-tab-buttons');
    await main(() => global.__ferna.setSetting('tabPosition', 'top'));
    await H.sleep(400);
    const top = await u.evaluate(() => { const t = document.querySelector('#tabs .tab.active'); return { close: t.querySelector('[data-close]').getBoundingClientRect().left, title: t.querySelector('.title').getBoundingClientRect().left }; });
    assert(top.close > top.title, `top tabs: close after title ${JSON.stringify(top)}`);
  });

  await step('0.6.3 a click on the strip is not lost while it redraws (loading pages)', async () => {
    const u = await ui();
    const idx = await main((_, url) => { const c = global.__ferna; c.addCommon(url, 'Common test'); return c.findCommon(url); }, `${base}/nowhere/common.html?common-click`);
    await H.sleep(300);
    const btn = await u.$(`#tabs [data-common="${idx}"]`);
    const box = await btn.boundingBox();
    await u.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await u.mouse.down();
    // Many redraws while the button is held, as a loading page causes.
    for (let i = 0; i < 6; i++) { await main(() => global.__ferna.windows[0].pushState()); await H.sleep(40); }
    await u.mouse.up();
    await H.until(async () => /common-click/.test((await active()).url), 4000, 'common entry opened on the first click');
    await main((_, url) => { const c = global.__ferna; c.removeCommon(c.findCommon(url)); }, `${base}/nowhere/common.html?common-click`);
  });

  await step('0.6.3 secure DNS defaults to Automatic (falls back when the provider does not answer)', async () => {
    const s = await main(() => ({ mode: global.__ferna.settings.data.dohMode, migrated: global.__ferna.settings.data.dns063 }));
    assert(s.mode === 'automatic' && s.migrated === true, JSON.stringify(s));
  });
};
