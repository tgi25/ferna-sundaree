'use strict';
// End-to-end steps for 0.8.0: 3D look, feeds, fact-check bubble, scam guard, smart workspaces.

module.exports = async function v080({ step, assert, main, win, page, H, base, shot, freshTab, evalActive, app }) {
  const ui = () => page('ferna://ui/');

  await step('0.8.0 3D look: raised bars and tiles; pointing lifts and tilts; pressing pushes in; can be turned off', async () => {
    const u = await ui();
    await main(() => { const c = global.__ferna; c.windows[0].switchWorkspace(null); c.setSetting('depth3d', true); c.setSetting('tabPosition', 'top'); });
    for (const q of ['one', 'two', 'three']) await freshTab(`${base}/long.html?d3-${q}`);
    await H.sleep(500);
    const pick = async (pos, theme) => {
      await main((e, a) => { e.nativeTheme.themeSource = a.theme; global.__ferna.setSetting('tabPosition', a.pos); }, { pos, theme });
      await u.emulateMedia({ colorScheme: theme });
      await H.sleep(600);
      // A tab that is not the current one.
      const box = await u.evaluate(() => { const t = [...document.querySelectorAll('#tabs .tab[data-id]:not(.active)')].pop(); const r = t.getBoundingClientRect(); return { x: r.left + r.width * 0.7, y: r.top + r.height * 0.3, id: t.dataset.id }; });
      await u.mouse.move(box.x - 30, box.y); await u.mouse.move(box.x, box.y, { steps: 4 });
      await H.sleep(400);
      return u.evaluate(id => {
        const t = document.querySelector(`#tabs .tab[data-id="${id}"]`), cs = getComputedStyle(t);
        return { d3: document.body.classList.contains('d3'), transform: cs.transform, shadow: cs.boxShadow, rx: t.style.getPropertyValue('--rx'), ry: t.style.getPropertyValue('--ry'), bar: getComputedStyle(document.querySelector('#toolbar')).boxShadow };
      }, box.id);
    };
    // At rest, buttons and tabs are flat; the current tab stays raised.
    await u.mouse.move(5, 300);
    await H.sleep(400);
    const rest = await u.evaluate(() => {
      const other = document.querySelector('#tabs .tab[data-id]:not(.active)'), cur = document.querySelector('#tabs .tab.active'), b = document.querySelector('#btn-reload');
      const cs = e => getComputedStyle(e);
      return { otherT: cs(other).transform, otherImg: cs(other).backgroundImage, btnT: cs(b).transform, btnImg: cs(b).backgroundImage, btnShadow: cs(b).boxShadow, curT: cs(cur).transform, curShadow: cs(cur).boxShadow };
    });
    assert(rest.otherT === 'none' && rest.otherImg === 'none' && rest.btnT === 'none' && rest.btnImg === 'none' && !/rgba?\([^)]*\) 0px 2px 0px/.test(rest.btnShadow) && rest.curT !== 'none' && /px/.test(rest.curShadow), JSON.stringify(rest));
    const light = await pick('top', 'light');
    assert(light.d3 && light.transform !== 'none' && /matrix3d|matrix/.test(light.transform) && light.rx && light.ry && /inset/.test(light.bar), JSON.stringify(light));
    await shot('v080-01-3d-light-top');
    const dark = await pick('left', 'dark');
    assert(dark.transform !== 'none' && dark.rx, JSON.stringify(dark));
    // Hover a toolbar button too, for the picture.
    const b = await u.evaluate(() => { const r = document.querySelector('#btn-menu').getBoundingClientRect(); return { x: r.left + r.width * 0.3, y: r.top + r.height * 0.3 }; });
    await u.mouse.move(b.x, b.y, { steps: 3 });
    await H.sleep(300);
    const btn = await u.evaluate(() => getComputedStyle(document.querySelector('#btn-menu')).transform);
    assert(btn !== 'none', `button lifts: ${btn}`);
    await shot('v080-02-3d-dark-vertical');
    // Off: flat again.
    await main(() => global.__ferna.setSetting('depth3d', false));
    await H.sleep(400);
    const flat = await u.evaluate(() => ({ d3: document.body.classList.contains('d3'), t: getComputedStyle(document.querySelector('#btn-menu')).transform }));
    assert(!flat.d3 && flat.t === 'none', JSON.stringify(flat));
    await main(() => { global.__ferna.setSetting('depth3d', true); global.__ferna.setSetting('tabPosition', 'top'); });
    await u.emulateMedia({ colorScheme: null });
    await main(e => { e.nativeTheme.themeSource = global.__ferna.settings.data.theme || 'system'; });
    await u.mouse.move(5, 5);
  });

  const lh = () => `http://localhost:${new URL(base).port}`;





  await step('0.8.0 scam & payment guard: fake bank login warned before typing; scam pages and messages flagged', async () => {
    await main(() => { const c = global.__ferna; c.setSetting('checkTrusted', []); c.__dlg = []; c.check.showDialog = async (w, o) => { c.__dlg.push(o); return { response: c.__dlgAnswer || 0 }; }; c.__dlgAnswer = 0; });
    // A page dressed as Sampath Bank on another address, asking for a password and OTP
    await freshTab(`${base}/check/fake-bank.html`);
    await H.until(() => main(() => global.__ferna.__dlg.length > 0), 10000, 'fake-bank warning');
    const d = await main(() => global.__ferna.__dlg[0]);
    assert(/Sampath Bank/.test(d.message) && /sampath\.lk/.test(d.detail) && /password/.test(d.detail) && /one-time code/.test(d.detail) && d.buttons[0] === 'Leave this page', JSON.stringify(d));
    // "Leave this page" took the tab away from it
    await H.until(() => main(() => { const t = global.__ferna.windows[0].active; return !/fake-bank/.test(t.url || ''); }), 6000, 'left the fake page');
    // Open again and answer "I trust this site": no more warnings for it
    await main(() => { global.__ferna.__dlgAnswer = 2; });
    await freshTab(`${base}/check/fake-bank.html?again`);
    await H.until(() => main(() => global.__ferna.__dlg.length > 1), 10000, 'second warning');
    await H.until(() => main(() => (global.__ferna.settings.data.checkTrusted || []).includes('127.0.0.1')), 4000, 'trusted');
    const n = await main(() => global.__ferna.__dlg.length);
    await freshTab(`${base}/check/fake-bank.html?third`);
    await H.sleep(3500);
    assert(await main((_, a) => global.__ferna.__dlg.length === a, n), 'no warning once trusted: ' + JSON.stringify(await main(() => [global.__ferna.__dlg.map(x => x.detail.slice(0, 40)), global.__ferna.settings.data.checkTrusted])));
    await main(() => global.__ferna.setSetting('checkTrusted', []));
    // A "parcel on hold, pay the customs fee" page: toast and a red check button
    await freshTab(`${lh()}/check/scam.html`);
    const u = await ui();
    await H.until(() => u.evaluate(() => { const b = document.querySelector('#btn-check'); return !b.hidden && b.dataset.level === 'scam'; }), 8000, 'scam level');
    // (another notice, such as the daily digest, may be showing first)
    await H.until(() => u.evaluate(() => /scam/.test(document.querySelector('#toast').textContent) && /Why\?/.test(document.querySelector('#toast').textContent)), 8000, 'scam notice', () => u.evaluate(() => document.querySelector('#toast').textContent));
    await shot('v080-07-scam-page');
    // Messages (SMS, WhatsApp): English, Sinhala; a bank's honest warning is not flagged
    const m = await main(() => {
      const C = global.__ferna.check;
      return {
        courier: C.checkMessage('Sri Lanka Post: your parcel is on hold due to an incomplete address. Pay the Rs.150 redelivery fee: https://slpost-lk.top/pay'),
        prize: C.checkMessage('Congratulations! You have won Rs. 500,000 in the Dialog lucky draw. Pay a small processing fee to claim your prize. bit.ly/3xYz'),
        si: C.checkMessage('ඔබගේ පාර්සලය රේගු ගාස්තු නොගෙවූ නිසා රඳවා ඇත. ඉක්මනින් ක්‍රියා කරන්න'),
        honest: C.checkMessage('Commercial Bank: never share your OTP or PIN with anyone. Rs. 2,500 was debited from your account. Call 0112353353 if this was not you.'),
        official: C.checkMessage('Your HNB statement is ready. Log in at https://www.hnb.net'),
      };
    });
    assert(m.courier.level === 'danger' && m.courier.links[0].bad && /Sri Lanka Post/.test(m.courier.links[0].notes.join(' ')), JSON.stringify(m.courier));
    assert(m.prize.level === 'danger' && m.prize.scam.length >= 2 && m.prize.links.some(l => /shortened/.test(l.notes.join(' '))), JSON.stringify(m.prize));
    assert(m.si.level !== 'ok' && m.si.scam.some(x => /customs/.test(x)), JSON.stringify(m.si));
    assert(m.honest.level === 'ok', JSON.stringify(m.honest));
    assert(m.official.level === 'ok' && m.official.links[0].official, JSON.stringify(m.official));
  });

  await step('0.8.0 fact-check bubble: news article shows who else reports it, fact-checks and warning signs; check a selection', async () => {
    await main((_, b) => { process.env.FERNA_NEWS_SEARCH = `${b}/check/news.xml`; global.__ferna.setSetting('factCheckAuto', false); }, base);
    await freshTab(`${lh()}/check/article.html`);
    const u = await ui();
    await H.until(() => u.evaluate(() => { const b = document.querySelector('#btn-check'); return !b.hidden && b.dataset.level === 'warn'; }), 8000, 'article flagged');
    await u.evaluate(() => document.querySelector('#btn-check').click());
    const p = await page('ferna://check/');
    await H.until(() => p.evaluate(() => !!document.querySelector('#cov-go')), 8000, 'panel');
    const flags = await p.evaluate(() => document.querySelector('#page').textContent);
    assert(/share or forward/i.test(flags) && /IMF approves/.test(flags), flags.slice(0, 300));
    await p.evaluate(() => document.querySelector('#cov-go').click());
    await H.until(() => p.evaluate(() => document.querySelectorAll('#cov .res li').length >= 4), 10000, 'coverage');
    const cov = await p.evaluate(() => ({ sum: document.querySelector('#cov .sum').textContent, est: [...document.querySelectorAll('#cov .badge.rel')].length, fc: [...document.querySelectorAll('#cov .badge.fc')].length, other: /Lanka Gossip/.test(document.querySelector('#cov').textContent), cricket: /Cricket/.test(document.querySelector('#cov').textContent) }));
    assert(cov.est === 3 && cov.fc === 1 && cov.other && !cov.cricket && /Fact-checkers/.test(cov.sum), JSON.stringify(cov));
    await shot('v080-08-factcheck-panel');
    // The button now carries the result
    await H.until(() => u.evaluate(() => /Fact check/.test(document.querySelector('#btn-check').title)), 4000, 'button title');
    // Right-click "Check this claim or message" on a selection
    await main(() => { const w = global.__ferna.windows[0]; global.__ferna.check.checkSelection(w, 'URGENT: your BOC account will be blocked today. Update your KYC at http://boc-lk-verify.top now'); });
    await H.until(() => p.evaluate(() => /Very likely a scam/.test(document.querySelector('#msg-out').textContent)), 6000, 'selection checked');
    const sel = await p.evaluate(() => document.querySelector('#msg-out').textContent);
    assert(/Bank of Ceylon/.test(sel), sel);
    await shot('v080-09-check-message');
    await main(() => { const w = global.__ferna.windows[0]; global.__ferna.check.closePanel(w); delete process.env.FERNA_NEWS_SEARCH; });
  });
  await step('0.8.0 smart workspaces: notices sites opened together, offers a workspace, opens it on schedule', async () => {
    const port = new URL(base).port;
    const sites = ['lms', 'mail', 'timetable'].map(n => `http://${n}.localhost:${port}/long.html?${n}`);
    await main((_, a) => {
      const c = global.__ferna, SW = c.smartws;
      c.setSetting('smartWorkspaces', true); c.setSetting('wsSchedules', []);
      SW.store.data.days = {}; SW.store.data.skip = []; SW.store.data.offered = {}; SW.store.data.made = [];
      const R = c._routines;
      // Four earlier days: the same three sites, a few minutes apart, at this time of day
      for (let d = 1; d <= 4; d++) a.forEach((u, i) => R.record(SW.store.data, u, ['Dashboard | SJP LMS', 'Inbox (12) - me@gmail.com - Gmail', 'Timetable 2026 - Google Sheets'][i], Date.now() - d * 86400000 - 20 * 60000 + i * 3 * 60000));
      c.__dlg = []; SW.showDialog = async (w, o) => { c.__dlg.push(o); return { response: 0 }; };
    }, sites);
    const n0 = await main(() => global.__ferna.ws.data.workspaces.length);
    for (const u of sites) await freshTab(u);
    const u = await ui();
    await H.until(() => u.evaluate(() => /Make it a workspace that opens itself/.test(document.querySelector('#toast').textContent)), 6000, 'offer toast');
    const toast = await u.evaluate(() => document.querySelector('#toast').textContent);
    assert(/SJP LMS/.test(toast) && /Gmail/.test(toast) && /Google Sheets/.test(toast), toast);
    await shot('v080-10-smartws-offer');
    await u.evaluate(() => document.querySelector('#toast .toast-act').click());
    await H.until(() => main((_, a) => global.__ferna.ws.data.workspaces.length > a, n0), 6000, 'workspace created');
    const made = await main(() => { const c = global.__ferna; const w = c.ws.data.workspaces[c.ws.data.workspaces.length - 1]; return { w, sched: c.settings.data.wsSchedules, dlg: c.__dlg[0], cur: c.windows[0].currentWs }; });
    assert(made.w.pinned.length === 3 && made.sched.length === 1 && made.sched[0].wsId === made.w.id && made.cur === made.w.id && /Make a workspace of/.test(made.dlg.message), JSON.stringify(made));
    // Not offered again the same way
    assert(await main(() => global.__ferna.smartws.routines().length === 0), 'not suggested again');
    // The schedule: close those tabs, make it due now, let the timer run
    await main((_, id) => {
      const c = global.__ferna, w = c.windows[0];
      for (const t of [...w.tabs]) if (/\.localhost:/.test(t.url)) w.closeTab(t);
      w.switchWorkspace(null);
      const d = new Date(Date.now() - 60000);
      c.lastFocused = w; // the schedule opens in the window you used last
      c.setSetting('wsSchedules', [{ wsId: id, days: [d.getDay()], time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, on: true, last: '' }]);
      c.smartws.tick();
    }, made.w.id);
    await H.until(() => main(() => global.__ferna.windows[0].tabs.filter(t => /\.localhost:/.test(t.url || t.pendingUrl || '')).length === 3), 8000, 'scheduled tabs open');
    const after = await main((_, id) => { const c = global.__ferna; return { cur: c.windows[0].currentWs === id, last: c.settings.data.wsSchedules[0].last, again: (c.smartws.tick(), c.windows[0].tabs.filter(t => /\.localhost:/.test(t.url || '')).length) }; }, made.w.id);
    assert(after.cur && after.last && after.again === 3, JSON.stringify(after));
    await H.until(() => u.evaluate(() => /scheduled/.test(document.querySelector('#toast').textContent)), 4000, 'opened toast');
    await shot('v080-11-smartws-opened');
    // Settings lists the schedule
    await main(() => global.__ferna.windows[0].openInternal('ferna://settings/#workspaces'));
    const sp = await page('ferna://settings/');
    await sp.reload(); // an earlier step may have left it open
    await H.until(() => sp.evaluate(() => document.querySelectorAll('#wsx-sched [data-ws]').length === 1), 6000, 'schedule in settings');
    await sp.evaluate(() => document.querySelector('#wsx-sched').scrollIntoView({ block: 'center' }));
    await shot('v080-12-smartws-settings');
    await main((_, id) => { const c = global.__ferna; c.deleteWorkspace(id); const w = c.windows[0]; for (const t of [...w.tabs]) if (/\.localhost:|ferna:\/\/settings/.test(t.url)) w.closeTab(t); }, made.w.id);
    assert(await main(() => (global.__ferna.settings.data.wsSchedules || []).length === 0), 'schedule removed with its workspace');
  });
  await step('0.8.1/0.8.3 Ctrl+Shift+H: bars stay hidden; the window edge does not bring them back', async () => {
    await main(() => { global.__ferna.setSetting('tabPosition', 'top'); global.__ferna.setSetting('hideBars', 'both'); });
    // An old edge reveal does not survive the key
    await main(() => global.__ferna.windows[0].run('toggleTabBar'));
    await main(() => { const w = global.__ferna.windows[0]; w.reveal.tabs = true; w.relayout(); });
    await main(() => global.__ferna.windows[0].run('toggleTabBar'));
    await main(() => global.__ferna.windows[0].run('toggleTabBar'));
    await H.sleep(200);
    let L = (await win()).layout;
    assert(!L.showTabs && !L.showToolbar && !L.edgeTabs && !L.edgeToolbar, `hidden, no edges: ${JSON.stringify(L)}`);
    // The UI asking to reveal (pointer at the edge) changes nothing
    const u = await ui();
    await u.evaluate(() => window.ferna.cmd('ui:reveal', 'tabs', true));
    await H.sleep(300);
    L = (await win()).layout;
    assert(!L.showTabs && !L.showToolbar, 'edge reveal ignored');
    await main(() => global.__ferna.windows[0].run('toggleTabBar'));
    L = (await win()).layout;
    assert(L.showTabs && L.showToolbar, 'shown again');
  });


  await step('0.8.3 Ctrl+Shift+H choices; the address bar inside Ferna Tabs and the tabs list; Ctrl+L goes there', async () => {
    const C = (cmd) => main((_, c) => global.__ferna.windows[0].run(c), cmd);
    await main(() => { const c = global.__ferna; c.setSetting('tabPosition', 'top'); c.setSetting('tabBarHidden', false); c.setSetting('hideBars', 'toolbar'); });
    await freshTab(`${base}/long.html?one`);
    await main((_, b) => global.__ferna.windows[0].navigate(global.__ferna.windows[0].active, `${b}/long.html?two`), base);
    await H.until(async () => /two/.test(await evalActive('location.href')), 5000, 'second page');
    // Only the address bar: the tab bar stays, with the window controls and the page controls
    await C('toggleTabBar');
    await H.sleep(300);
    let L = (await win()).layout;
    assert(L.showTabs && !L.showToolbar && L.windowControls === 'tabs' && !L.edgeToolbar, JSON.stringify(L));
    const u = await ui();
    await H.until(() => u.evaluate(() => !!document.querySelector('#tabs .pagebar .pb-url')), 4000, 'page bar in the tab strip');
    const pb = await u.evaluate(() => ({ host: document.querySelector('#tabs .pagebar .pb-url').textContent.trim(), btns: [...document.querySelectorAll('#tabs .pagebar [data-pb]')].map(b => b.dataset.pb) }));
    assert(/localhost|127\.0\.0\.1/.test(pb.host) && ['back', 'reload', 'edit', 'bookmark', 'more'].every(x => pb.btns.includes(x)), JSON.stringify(pb));
    await shot('v083-01-pagebar-top');
    // 0.8.4: every address-bar button is in the strip too, and they work from there
    const tools = await u.evaluate(() => [...document.querySelectorAll('#tabs .pagebar .pb-tools [data-pb]')].map(b => ({ k: b.dataset.pb, dis: b.disabled })));
    for (const k of ['copy', 'clear', 'reader', 'translate', 'zoom', 'shield', 'bookmarks', 'assistant', 'overview']) assert(tools.some(t => t.k === k && !t.dis), `strip has ${k}: ${JSON.stringify(tools)}`);
    await u.evaluate(() => document.querySelector('#tabs .pagebar [data-pb="zoom"]').click());
    await H.until(() => main(() => global.__ferna.windows[0].overlayMode === 'zoom'), 3000, 'zoom from the strip');
    await main(() => global.__ferna.windows[0].closeOverlay());
    await u.evaluate(() => document.querySelector('#tabs .pagebar [data-pb="assistant"]').click());
    await H.until(() => main(() => (global.__ferna.windows[0].side || {}).kind === 'assistant'), 3000, 'assistant from the strip');
    await main(() => global.__ferna.windows[0].run('assistant'));
    // Back from the strip
    await u.evaluate(() => document.querySelector('#tabs .pagebar [data-pb="back"]').click());
    await H.until(async () => /one/.test(await evalActive('location.href')), 5000, 'went back');
    // Ctrl+L edits the address in the strip; Enter goes there in this tab
    const n0 = await main(() => global.__ferna.windows[0].tabs.length);
    await C('focusAddress');
    await H.until(() => u.evaluate(() => !document.querySelector('#pb-edit').hidden && document.activeElement.id === 'pb-edit'), 3000, 'inline address field', async () => JSON.stringify(await u.evaluate(() => ({ hidden: document.querySelector('#pb-edit').hidden, ae: document.activeElement && (document.activeElement.id || document.activeElement.tagName), chip: !!document.querySelector('#tabs .pb-url') }))));
    await shot('v083-02-pagebar-edit');
    await u.evaluate(b => { const i = document.querySelector('#pb-edit'); i.value = `${b}/long.html?three`; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }, base);
    await H.until(async () => /three/.test(await evalActive('location.href')), 5000, 'navigated from the strip');
    assert(await main((_, a) => global.__ferna.windows[0].tabs.length === a, n0), 'same tab');
    // The ⋯ menu holds every address-bar action
    const labels = await main(() => global.__ferna._menus.pageActionsMenu(global.__ferna.windows[0]).items.map(i => i.label));
    for (const l of ['Back', 'Reload', 'Copy address', 'Bookmark this page', 'Reading mode', 'Translate this page', 'Safety check', 'Zoom…', 'Split view', 'Tracker and ad blocking', 'Downloads', 'AI assistant', 'Menu']) assert(labels.includes(l), `menu has ${l}: ${labels.join(', ')}`);
    // Vertical tabs, address bar hidden: the window controls and the page controls on the side strip
    await main(() => global.__ferna.setSetting('tabPosition', 'left'));
    await H.sleep(400);
    L = (await win()).layout;
    assert(L.tabs && !L.toolbar && L.windowControls === 'tabs', JSON.stringify(L));
    await H.until(() => u.evaluate(() => !!document.querySelector('#tabs.v .v-ctlrow .winctl') && !!document.querySelector('#tabs.v .pagebar .pb-url')), 3000, 'vertical controls');
    await shot('v083-03-pagebar-vertical');
    await main(() => global.__ferna.setSetting('tabPosition', 'top'));
    // Only the tab bar: the address bar stays and takes the window controls
    await main(() => global.__ferna.setSetting('hideBars', 'tabs'));
    await H.sleep(300);
    L = (await win()).layout;
    assert(!L.showTabs && L.showToolbar && L.windowControls === 'toolbar', JSON.stringify(L));
    // Both: Ctrl+L opens the tabs list at the pointer with the page controls and the address ready to edit
    await main(() => global.__ferna.setSetting('hideBars', 'both'));
    await H.sleep(300);
    await C('focusAddress');
    const ov = await page('ferna://overlay/');
    await H.until(() => ov.evaluate(() => !!document.querySelector('.pop-page') && /three/.test(document.querySelector('#pt-q').value)), 4000, 'tabs list with the address');
    await shot('v083-04-tabslist-page');
    const lt = await ov.evaluate(() => [...document.querySelectorAll('.pop-tools [data-pp]')].map(b => b.dataset.pp));
    for (const k of ['copy', 'clear', 'reader', 'translate', 'zoom', 'shield', 'bookmarks', 'assistant', 'overview']) assert(lt.includes(k), `tabs list has ${k}: ${lt}`);
    await ov.evaluate(b => { const q = document.querySelector('#pt-q'); q.value = `${b}/long.html?four`; q.dispatchEvent(new Event('input')); }, base);
    await H.sleep(200);
    await ov.keyboard.press('Enter');
    await H.until(async () => /four/.test(await evalActive('location.href')), 5000, 'navigated from the tabs list');
    assert(await main((_, a) => global.__ferna.windows[0].tabs.length === a, n0), 'same tab from the list');
    await C('toggleTabBar');
    L = (await win()).layout;
    assert(L.showTabs && L.showToolbar, 'all back');
    // The address bar keeps these buttons on every page (greyed out where they do not apply)
    const ids = ['#btn-copyurl', '#btn-clearurl', '#btn-reader', '#btn-translate', '#btn-zoom', '#btn-shield', '#btn-bookmarks', '#btn-assistant', '#btn-overview'];
    const vis = async () => u.evaluate(list => list.map(id => { const b = document.querySelector(id); const r = b.getBoundingClientRect(); return { id, shown: !b.hidden && r.width > 0, dis: b.disabled }; }), ids);
    await H.until(async () => (await vis()).every(x => x.shown), 4000, 'address bar back with its buttons');
    let v = await vis();
    await main(() => global.__ferna.windows[0].newTab('ferna://newtab/'));
    await H.until(async () => (await vis()).find(x => x.id === '#btn-reader').dis, 4000, 'new tab page');
    v = await vis();
    assert(v.every(x => x.shown), `new tab page: ${JSON.stringify(v.filter(x => !x.shown))}`);
    assert(v.find(x => x.id === '#btn-reader').dis && !v.find(x => x.id === '#btn-overview').dis, JSON.stringify(v));
    await shot('v084-01-toolbar-buttons');
    await main(() => { const w = global.__ferna.windows[0]; w.closeTab(w.active); });
  });

};
