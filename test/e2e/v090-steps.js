'use strict';
// End-to-end steps for 0.9.0: Chrome-style zoom, the Ferna extensions (Feeds, Zoom, Equalizer,
// Screenshot) running in Sundaree, camera / microphone / speaker access for meeting sites, and
// the Ferna Tabs 1.16 features with the list's own settings.

const path = require('path');

module.exports = async function v090({ step, assert, main, win, page, H, base, shot, freshTab, evalActive }) {
  const ui = () => page('ferna://ui/');
  const zoomOf = () => main(() => Math.round(global.__ferna.windows[0].active.view.webContents.getZoomFactor() * 100));

  await step('0.9 zoom: Chrome steps, every tab of the site follows, remembered per site, reset forgets it', async () => {
    await main(() => { const c = global.__ferna; c.setSetting('zoomLevels', {}); c.windows[0].switchWorkspace(null); });
    await freshTab(`${base}/long.html?z1`);
    await main(() => global.__ferna.windows[0].run('zoomIn'));
    assert(await zoomOf() === 110, `in: ${await zoomOf()}`);
    await main(() => global.__ferna.windows[0].run('zoomIn'));
    assert(await zoomOf() === 125, `in twice: ${await zoomOf()}`);
    const host = await main(() => Object.keys(global.__ferna.settings.data.zoomLevels));
    assert(host.length === 1 && /localhost|127\.0\.0\.1/.test(host[0]), `remembered: ${JSON.stringify(host)}`);
    // A second tab of the same site opens at the same size; the address bar shows it
    await freshTab(`${base}/article.html?z2`);
    assert(await zoomOf() === 125, `second tab: ${await zoomOf()}`);
    const u = await ui();
    await H.until(() => u.evaluate(() => document.querySelector('#zoom-level').textContent === '125%'), 3000, 'level shown');
    // After a restart Chromium has forgotten it: Ferna puts the remembered level back on load
    await main(() => { const t = global.__ferna.windows[0].active; t.view.webContents.setZoomFactor(1); });
    await freshTab(`${base}/long.html?z3`);
    assert(await zoomOf() === 125, `remembered on load: ${await zoomOf()}`);
    // Ctrl+wheel (Chromium asks the browser) and the panel
    await main(() => { const w = global.__ferna.windows[0]; w.active.view.webContents.emit('zoom-changed', {}, 'out'); });
    assert(await zoomOf() === 110, `wheel out: ${await zoomOf()}`);
    await main(() => global.__ferna.windows[0].openZoomPanel());
    const ov = await page('ferna://overlay/');
    await H.until(() => ov.evaluate(() => !!document.querySelector('#zpanel') && document.querySelector('#zp-level').textContent === '110%'), 3000, 'panel');
    await shot('v090-01-zoom-panel');
    await ov.evaluate(() => document.querySelector('[data-z="reset"]').click());
    await H.until(async () => (await zoomOf()) === 100, 3000, 'reset');
    const left = await main(() => Object.keys(global.__ferna.settings.data.zoomLevels).length);
    assert(left === 0, `reset forgets the site: ${left}`);
    await main(() => global.__ferna.windows[0].closeOverlay());
  });

  await step('0.9 removed from the browser: Feeds, Equalizer, Zoom Page WE zoom and the Screenshot tool (now extensions)', async () => {
    const u = await ui();
    const ids = await u.evaluate(() => ['#btn-feeds', '#btn-eq', '#btn-shot', '#btn-rss'].filter(s => document.querySelector(s)));
    assert(!ids.length, `buttons left: ${ids}`);
    const gone = await main(() => { const c = global.__ferna; return { feeds: !!c.feeds, eq: typeof c.pageFx.setEq, shots: !!c.shots, cmds: ['equalizer', 'shotVisible', 'zoomType'].filter(k => k in c.shortcuts.map) }; });
    assert(!gone.feeds && gone.eq === 'undefined' && !gone.shots && !gone.cmds.length, JSON.stringify(gone));
  });

  // ---------- video calls (Zoom, Teams, Meet): devices and screen sharing ----------
  const stubAsk = answer => main(({ dialog }, a) => {
    const c = global.__ferna;
    c.__asked = [];
    if (!c.__origMB) c.__origMB = dialog.showMessageBox;
    dialog.showMessageBox = async (w, o) => { const opts = o || w; c.__asked.push(opts.message); return { response: a ? 1 : 0, checkboxChecked: false }; };
  }, answer);
  const unstubAsk = () => main(({ dialog }) => { const c = global.__ferna; if (c.__origMB) dialog.showMessageBox = c.__origMB; });

  await step('0.9 meetings: camera and microphone asked once; then the site names your cameras, microphones and speakers and may pick speakers', async () => {
    await main(() => { const c = global.__ferna; c.settings.data.permissions = {}; c.settings.save(); if (c.permGrants) c.permGrants.clear(); });
    await stubAsk(true);
    try {
      await freshTab(`${base}/meeting.html`);
      const before = await evalActive('devices()');
      assert(before.length && before.every(d => !d.label), `no names before: ${JSON.stringify(before)}`);
      const tracks = await evalActive('join()');
      assert(tracks.length === 2, `camera and microphone: ${JSON.stringify(tracks)}`);
      const after = await evalActive('devices()');
      assert(after.some(d => d.kind === 'audioinput' && d.label) && after.some(d => d.kind === 'videoinput' && d.label), `named after allowing (once, not remembered): ${JSON.stringify(after)}`);
      const sp = await evalActive('speaker()');
      assert(sp === 'ok', `choosing speakers: ${sp}`);
      // Reloading the meeting page does not ask again (allowed for this session)
      await main(() => global.__ferna.windows[0].active.view.webContents.reload());
      await H.until(async () => (await evalActive('document.readyState')) === 'complete', 6000, 'reloaded');
      await evalActive('join()');
      const asked = await main(() => global.__ferna.__asked);
      assert(asked.length === 1 && /camera and microphone/.test(asked[0]), `asked once: ${JSON.stringify(asked)}`);
      // Camera and microphone are separate decisions
      const saved = await main(() => [...global.__ferna.permGrants.keys()].filter(k => /\|media:/.test(k)).sort());
      assert(saved.length === 2 && saved[0].endsWith('media:audio') && saved[1].endsWith('media:video'), JSON.stringify(saved));
    } finally { await unstubAsk(); await evalActive('window.stream && window.stream.getTracks().forEach(t => t.stop())').catch(() => {}); }
  });

  await step('0.9 meetings: screen sharing shows a picker (screens, windows, tabs); Cancel shares nothing; a tab can be shared', async () => {
    await freshTab(`${base}/long.html?share-me`);
    await freshTab(`${base}/meeting.html?share`);
    const ask = () => main(() => global.__ferna.windows[0].active.view.webContents.executeJavaScript('share()', true));
    let p = ask();
    await H.until(() => main(() => global.__ferna.windows[0].overlayMode === 'share'), 10000, 'picker');
    const ov = await page('ferna://overlay/');
    await H.until(() => ov.evaluate(() => !!document.querySelector('.dlg.share')), 4000, 'picker drawn');
    const kinds = await ov.evaluate(() => [...document.querySelectorAll('[data-kind]')].map(b => b.dataset.kind));
    assert(kinds.includes('tab'), `kinds ${kinds}`);
    await shot('v090-05-share-picker');
    await ov.evaluate(() => document.querySelector('#sh-cancel').click());
    const r1 = await p;
    assert(!Array.isArray(r1), `cancel shares nothing: ${JSON.stringify(r1)}`);
    p = ask();
    await H.until(() => main(() => global.__ferna.windows[0].overlayMode === 'share'), 10000, 'picker again');
    await H.until(() => ov.evaluate(() => !!document.querySelector('[data-kind="tab"]')), 4000, 'tabs');
    await ov.evaluate(() => { document.querySelector('[data-kind="tab"]').click(); });
    await ov.evaluate(() => { document.querySelector('.sh-item').click(); });
    await ov.evaluate(() => { document.querySelector('#sh-ok').click(); });
    const r2 = await p;
    assert(Array.isArray(r2) && r2.length === 1, `a tab shared: ${JSON.stringify(r2)}`);
    await evalActive('window.shared && window.shared.getTracks().forEach(t => t.stop())');
  });

  await step('0.9 microphone and speaker sites: mic alone, permission state, levels, recording, every speaker, embedded frames', async () => {
    await main(() => { const c = global.__ferna; c.settings.data.permissions = {}; c.settings.save(); if (c.permGrants) c.permGrants.clear(); });
    const res = {};
    // Refused: the site is told so, and asking again asks again
    await stubAsk(false);
    try {
      await freshTab(`${base}/miccheck.html?deny`);
      res.deniedMic = await evalActive('mic()');
      assert(!res.deniedMic.ok && res.deniedMic.error === 'NotAllowedError', `refused: ${JSON.stringify(res.deniedMic)}`);
    } finally { await unstubAsk(); }
    await main(() => { const c = global.__ferna; if (c.permGrants) c.permGrants.clear(); });
    await stubAsk(true);
    try {
      await freshTab(`${base}/miccheck.html`);
      res.before = await evalActive('state()');
      assert(res.before.mic === 'prompt', `before: ${JSON.stringify(res.before)}`);
      await evalActive('watch()');
      res.mic = await evalActive('mic()');
      assert(res.mic.ok && res.mic.tracks.length === 1 && res.mic.tracks[0].startsWith('audio:'), `mic alone: ${JSON.stringify(res.mic)}`);
      const asked = await main(() => global.__ferna.__asked);
      assert(asked.length === 1 && /microphone/.test(asked[0]) && !/camera/.test(asked[0]), `asks for the microphone only: ${JSON.stringify(asked)}`);
      res.after = await evalActive('state()');
      assert(res.after.mic === 'granted' && res.after.cam === 'prompt', `state after: ${JSON.stringify(res.after)}`);
      await H.until(async () => JSON.stringify(await evalActive('window.seen')) === '["granted"]', 3000, 'the page hears the change');
      res.devices = await evalActive('devices()');
      const ins = res.devices.filter(d => d.kind === 'audioinput'), outs = res.devices.filter(d => d.kind === 'audiooutput'), cams = res.devices.filter(d => d.kind === 'videoinput');
      assert(ins.length && ins.every(d => d.label), `microphones named: ${JSON.stringify(ins)}`);
      assert(outs.length && outs.every(d => d.label && d.id), `speakers named: ${JSON.stringify(outs)}`);
      assert(cams.every(d => !d.label), `cameras stay unnamed (camera not allowed): ${JSON.stringify(cams)}`);
      res.level = await evalActive('level()');
      assert(res.level > 0.01, `input level: ${res.level}`);
      res.recorded = await evalActive('record()');
      assert(res.recorded > 0, `recording: ${res.recorded}`);
      res.speakers = await evalActive('speakers()');
      assert(res.speakers.length && res.speakers.every(s => s.element === 'ok' && (s.webAudio === 'ok' || s.webAudio === 'n/a')), `every speaker selectable: ${JSON.stringify(res.speakers)}`);
      // Embedded frames (voice widgets, call SDKs): with allow="microphone" the frame uses the page's answer, no second question
      const other = base.replace('127.0.0.1', 'localhost');
      res.frameAllowed = await evalActive(`frameMic(${JSON.stringify(`${other}/micframe.html`)}, 'microphone; speaker-selection')`);
      assert(String(res.frameAllowed).startsWith('ok:'), `frame with allow: ${res.frameAllowed}`);
      res.frameBlocked = await evalActive(`frameMic(${JSON.stringify(`${other}/micframe.html?noallow`)}, null)`);
      assert(res.frameBlocked === 'error:NotAllowedError', `a frame without allow is refused, as in Chrome: ${res.frameBlocked}`);
      const asked2 = await main(() => global.__ferna.__asked);
      assert(asked2.length === 1, `no extra questions: ${JSON.stringify(asked2)}`);
      console.log('    mic/speaker results', JSON.stringify(res));
    } finally { await unstubAsk(); await evalActive('stop()').catch(() => {}); }
  });

  // ---------- Ferna Tabs 1.16 in the tabs list at the pointer, and the list's own settings ----------
  const openList = async () => {
    await main(() => { const w = global.__ferna.windows[0]; if (w.overlayMode) w.closeOverlay(); w.run('tabsAtPointer'); });
    const ov = await page('ferna://overlay/');
    await H.until(() => ov.evaluate(() => !!document.querySelector('#pop #pt-list .row-tab')), 5000, 'list open');
    return ov;
  };
  const tabsNow = () => main(() => global.__ferna.windows[0].tabs.map(t => ({ id: t.id, url: t.url })));

  await step('0.9 Ferna Tabs list settings: width, height, row size, font and font size are applied and kept', async () => {
    await main(() => { const c = global.__ferna; c.setSetting('tabsList', null); c.windows[0].switchWorkspace(null); });
    let ov = await openList();
    await ov.evaluate(() => document.querySelector('#pt-set').click());
    await H.until(() => ov.evaluate(() => !!document.querySelector('.ps')), 3000, 'settings panel');
    await shot('v090-06-tabs-list-settings');
    const setv = (k, v) => ov.evaluate(([k, v]) => { const el = document.querySelector(`[data-ps="${k}"]`); if (el.type === 'checkbox') el.checked = v; else el.value = String(v); el.dispatchEvent(new Event('change', { bubbles: true })); }, [k, v]);
    await setv('width', 520); await H.sleep(300);
    await setv('rows', 'large'); await H.sleep(300);
    await setv('font', 'Georgia'); await H.sleep(300);
    await setv('fontSize', 16); await H.sleep(300);
    await setv('hints', false); await H.sleep(400);
    const saved = await main(() => global.__ferna.settings.data.tabsList);
    assert(saved.width === 520 && saved.rows === 'large' && saved.font === 'Georgia' && saved.fontSize === 16 && saved.hints === false, JSON.stringify(saved));
    await ov.evaluate(() => document.querySelector('[data-ps-done]').click());
    // Open again: the new look
    ov = await openList();
    const look = await ov.evaluate(() => { const p = document.querySelector('#pop'); const r = document.querySelector('#pt-list .row-tab'); const cs = getComputedStyle(r); return { w: Math.round(p.getBoundingClientRect().width), h: Math.round(r.getBoundingClientRect().height), font: cs.fontFamily, size: cs.fontSize, foot: getComputedStyle(document.querySelector('#pt-foot')).display }; });
    assert(look.w === 520 && look.h === 44 && /Georgia/.test(look.font) && look.size === '16px' && look.foot === 'none', JSON.stringify(look));
    await shot('v090-07-tabs-list-large-georgia');
    await main(() => { const c = global.__ferna; c.setSetting('tabsList', null); c.windows[0].closeOverlay(); });
  });

  await step('0.9 Ferna Tabs 1.16: star toggles the common bar; Park closes and keeps the page dated; opening it clears the date', async () => {
    // Earlier steps may have left workspaces whose pinned folders claim test pages: park
    // keeps the page in the tab's own workspace, so look for it everywhere.
    const pinAnywhere = () => main(() => { const c = global.__ferna; const lists = [c.ws.data.allPinned || [], ...(c.ws.data.workspaces || []).map(w => w.pinned || [])]; for (const l of lists) { const p = l.find(x => /park-me/.test(x.url)); if (p) return p; } return null; });
    await freshTab(`${base}/feeds/nofeed.html?park-me`);
    await freshTab(`${base}/long.html?star-me`);
    let ov = await openList();
    const rowOf = q => ov.evaluate(q => [...document.querySelectorAll('#pt-list .row-tab')].findIndex(r => (r.title || '').includes(q)), q);
    // Star: on, then off again
    let i = await rowOf('star-me');
    await ov.evaluate(i => document.querySelector(`#pt-list [data-star="${i}"]`).click(), i);
    await H.until(() => main(() => global.__ferna.ws.data.common.some(c => /star-me/.test(c.url))), 3000, 'on the common bar');
    // Now an icon on the common bar (not a row); searching lists every tab, with the star filled
    await ov.fill('#pt-q', 'star-me');
    await H.until(() => ov.evaluate(() => !!document.querySelector('#pt-list .x.star.on')), 3000, 'star filled');
    await shot('v090-10-tabs-list-star-filled');
    await ov.evaluate(() => document.querySelector('#pt-list .x.star.on').click());
    await H.until(() => main(() => !global.__ferna.ws.data.common.some(c => /star-me/.test(c.url))), 3000, 'off the common bar');
    await ov.fill('#pt-q', '');
    // Park
    await H.sleep(300);
    i = await rowOf('park-me');
    const parkBtn = await ov.evaluate(i => !!document.querySelector(`#pt-list [data-park="${i}"]`), i);
    if (!parkBtn) throw new Error(`no park button for row ${i}: ${await ov.evaluate(() => JSON.stringify({ q: pt.q, raw: pt.raw, val: document.querySelector("#pt-q").value, rows: pt.rows.map(r => r.t ? r.t.url : r.kind), tabs: data.tabs.map(t => t.url) }))}`);
    await ov.evaluate(i => document.querySelector(`#pt-list [data-park="${i}"]`).click(), i);
    await H.until(async () => !(await tabsNow()).some(t => /park-me/.test(t.url)), 3000, 'parked tab closed');
    const pin = await pinAnywhere();
    assert(pin && pin.parked > Date.now() - 60e3, `parked pin: ${JSON.stringify(pin)}`);
    await H.until(() => ov.evaluate(() => [...document.querySelectorAll('#pt-list .row-tab.parked .st')].some(s => /^Parked \d+ \w{3}$/.test(s.textContent))), 3000, 'Parked date shown');
    await shot('v090-08-tabs-list-parked');
    await ov.evaluate(() => document.querySelector('#pt-list .row-tab.parked').click());
    await H.until(async () => (await tabsNow()).some(t => /park-me/.test(t.url)), 4000, 'reopened');
    const after = await pinAnywhere();
    assert(after && !after.parked, `date cleared: ${JSON.stringify(after)}`);
    await main(() => { const c = global.__ferna; for (const id of ['', ...(c.ws.data.workspaces || []).map(w => w.id)]) { const l = c.pinnedList(id) || []; const i = l.findIndex(p => /park-me/.test(p.url)); if (i >= 0) c.unpinSite(id, i); } c.windows[0].closeOverlay(); });
  });

  await step('0.9 Ferna Tabs 1.16: close with Undo, Ctrl+Z and recently closed; duplicates offer; one ranked search with bookmarks', async () => {
    await freshTab(`${base}/long.html?closeme`);
    let ov = await openList();
    let i = await ov.evaluate(() => [...document.querySelectorAll('#pt-list .row-tab')].findIndex(r => (r.title || '').includes('closeme')));
    await ov.evaluate(i => document.querySelector(`#pt-list [data-x="${i}"]`).click(), i);
    await H.until(() => ov.evaluate(() => { const t = document.querySelector('#ov-toast'); return !!t && t.classList.contains('on') && /Undo/.test(t.textContent); }), 3000, 'Undo offered');
    await ov.evaluate(() => document.querySelector('#ov-toast button').click());
    await H.until(async () => (await tabsNow()).some(t => /closeme/.test(t.url)), 4000, 'undone');
    // Close again, then Ctrl+Z in the list; the closed tab is listed under Recently closed
    ov = await openList();
    i = await ov.evaluate(() => [...document.querySelectorAll('#pt-list .row-tab')].findIndex(r => (r.title || '').includes('closeme')));
    await ov.evaluate(i => document.querySelector(`#pt-list [data-x="${i}"]`).click(), i);
    await H.until(() => ov.evaluate(() => [...document.querySelectorAll('#pt-list .pop-label')].some(l => /Recently closed/i.test(l.textContent))), 3000, 'recently closed listed');
    await ov.focus('#pt-q'); await ov.keyboard.press('Control+z');
    await H.until(async () => (await tabsNow()).some(t => /closeme/.test(t.url)), 4000, 'Ctrl+Z reopened');
    // Duplicates: the same page twice → offer → Close the copies (other copies left by earlier steps closed first)
    await main(() => { const w = global.__ferna.windows[0]; for (const t of w.tabs.filter(t => /article\.html/.test(t.url))) w.closeTab(t); });
    await freshTab(`${base}/article.html?dup=1`);
    await freshTab(`${base}/article.html?dup=2`);
    ov = await openList();
    await H.until(() => ov.evaluate(() => { const o = document.querySelector('#pt-offer'); return !o.hidden && /duplicate/.test(o.textContent); }), 3000, 'duplicates offered');
    const before = (await tabsNow()).filter(t => /article\.html/.test(t.url)).length;
    await ov.evaluate(() => document.querySelector('[data-offer="dups"]').click());
    await H.until(async () => (await tabsNow()).filter(t => /article\.html/.test(t.url)).length === 1, 4000, `copies closed (had ${before})`);
    // Ranked search: initials and gaps ("lng tst" finds the Long test page)
    ov = await openList();
    await ov.fill('#pt-q', 'lng tst');
    await H.until(() => ov.evaluate(() => /Long test page/.test((document.querySelector('#pt-list .row-tab') || {}).textContent || '')), 3000, 'ranked match first');
    await main(() => global.__ferna.windows[0].closeOverlay());
  });

  await step('0.9 Ferna Tabs 1.16: the workspace you are in, clicked again, acts on its tabs; drag a row onto the common bar', async () => {
    const id = await main(() => { const c = global.__ferna; const w = c.createWorkspace('Lectures 1.16'); c.ws.save(); c.windows[0].switchWorkspace(w.id); return w.id; });
    await freshTab(`${base}/long.html?lec-a`);
    await freshTab(`${base}/long.html?lec-b`);
    let ov = await openList();
    await ov.evaluate(id => document.querySelector(`#pt-ws [data-ws="${id}"]`).click(), id);
    await H.until(() => ov.evaluate(() => !document.querySelector('#pt-wsmenu').hidden), 3000, 'workspace menu');
    const items = await ov.evaluate(() => [...document.querySelectorAll('#pt-wsmenu [data-wsact]')].map(b => b.dataset.wsact));
    assert(['openAll', 'close', 'sleep'].every(a => items.includes(a)), items.join());
    await shot('v090-09-tabs-list-workspace-actions');
    await ov.evaluate(() => document.querySelector('#pt-wsmenu [data-wsact="sleep"]').click());
    await H.until(() => main(() => { const w = global.__ferna.windows[0]; return w.tabs.filter(t => /lec-/.test(t.url) && t.id !== w.activeId).every(t => !t.view); }), 4000, 'asleep');
    // Drag a row onto the common bar
    ov = await openList();
    const src = await ov.evaluate(() => { const r = [...document.querySelectorAll('#pt-list .row-tab[draggable="true"]')].find(x => /lec-a/.test(x.title)); return r ? `#pt-list .row-tab[data-i="${r.dataset.i}"]` : null; });
    assert(src, 'draggable row');
    // The drag events a mouse drag produces (a real OS drag cannot be driven inside Electron here)
    const foot = await ov.evaluate(sel => {
      const row = document.querySelector(sel), target = document.querySelector('#pt-common');
      const dt = new DataTransfer();
      const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
      fire(row, 'dragstart'); fire(target, 'dragenter'); fire(target, 'dragover');
      const hint = document.querySelector('#pt-foot').textContent;
      fire(target, 'drop'); fire(row, 'dragend');
      return hint;
    }, src);
    assert(/common bar/.test(foot), `the footer says what will happen: ${foot}`);
    await H.until(() => main(() => global.__ferna.ws.data.common.some(c => /lec-a/.test(c.url))), 4000, 'dropped on the common bar');
    await main(id => { const c = global.__ferna; const w = c.windows[0]; w.closeOverlay(); const i = c.ws.data.common.findIndex(x => /lec-a/.test(x.url)); if (i >= 0) c.removeCommon(i); w.workspaceAction(id, 'close'); w.switchWorkspace(null); c.deleteWorkspace(id); }, id);
  });

  // ---------- the Ferna extensions, installed from their folders ----------
  const EXT = path.join(H.FIX, 'ferna-extensions');
  const ids = {};
  await step('0.9 Ferna extensions load: Feeds, Zoom, Equalizer and Screenshot, with toolbar buttons', async () => {
    for (const n of ['ferna-feeds', 'ferna-zoom', 'ferna-equalizer', 'ferna-screenshot']) {
      ids[n] = await main(async (_, d) => (await global.__ferna.ext.loadUnpacked(d, { skipConfirm: true })).id, path.join(EXT, n));
    }
    await H.sleep(2500);
    // Their first-run pages (welcome / manage) open in tabs: close them
    await main(() => { const w = global.__ferna.windows[0]; for (const t of [...w.tabs]) if (/^chrome-extension:/.test(t.url || '')) w.closeTab(t); });
    const u = await ui();
    for (const id of Object.values(ids)) await H.until(() => u.evaluate(i => !!document.querySelector(`#ext-actions [data-ext="${i}"]`) || !!document.querySelector('#btn-puzzle'), id), 6000, 'toolbar');
  });

  await step('0.9 Ferna Zoom extension: zooms the page and the text; hears the browser zoom (Ctrl +)', async () => {
    await freshTab(`${base}/article.html?fz`);
    const tabId = await main(() => global.__ferna.windows[0].active.view.webContents.id);
    const act = (action, value) => main(async (_, { id, tabId, action, value }) => {
      const w = global.__ferna.windows[0];
      const t = w.newTab(`chrome-extension://${id}/popup.html?tab=${tabId}`, { forceWeb: true, activate: false });
      await new Promise(r => setTimeout(r, 700));
      const r = await t.view.webContents.executeJavaScript(`chrome.runtime.sendMessage({ t: 'act', tabId: ${tabId}, action: ${JSON.stringify(action)}, value: ${JSON.stringify(value)} })`);
      w.closeTab(t);
      return r;
    }, { id: ids['ferna-zoom'], tabId, action, value });
    await act('in');
    await H.until(async () => (await zoomOf()) === 110, 4000, 'extension zoomed to 110');
    // Text zoom: the text grows, the page does not
    const fs0 = await evalActive("parseFloat(getComputedStyle(document.querySelector('p')).fontSize)");
    await act('setType', 'text'); await act('set', 150);
    await H.until(async () => (await evalActive("parseFloat(getComputedStyle(document.querySelector('p')).fontSize)")) > fs0 * 1.3, 5000, 'text zoomed');
    await shot('v090-02-ferna-zoom-text');
    await act('reset'); await act('setType', 'full');
    await H.until(async () => (await zoomOf()) === 100, 4000, 'back to 100');
    // Ctrl + in the browser: the extension remembers it as this site's zoom
    await main(() => global.__ferna.windows[0].run('zoomIn'));
    const level = await main(async (_, { id, tabId }) => {
      const w = global.__ferna.windows[0];
      await new Promise(r => setTimeout(r, 900));
      const t = w.newTab(`chrome-extension://${id}/popup.html?tab=${tabId}`, { forceWeb: true, activate: false });
      await new Promise(r => setTimeout(r, 700));
      const r = await t.view.webContents.executeJavaScript(`chrome.runtime.sendMessage({ t: 'panel', tabId: ${tabId} })`);
      w.closeTab(t);
      return r && r.level;
    }, { id: ids['ferna-zoom'], tabId });
    assert(level === 110, `extension saw the browser zoom: ${level}`);
    await main(() => global.__ferna.windows[0].run('zoomReset'));
  });

  await step('0.9 Ferna Equalizer extension: Alt+Shift+Q turns it on (keyboard shortcut of an extension), badge shows it', async () => {
    await freshTab(`${base}/video.html?eq`);
    await main(() => { const wc = global.__ferna.windows[0].active.view.webContents; wc.focus(); for (const type of ['keyDown', 'keyUp']) wc.sendInputEvent({ type, keyCode: 'Q', modifiers: ['alt', 'shift'] }); });
    await H.until(() => main(async (_, id) => {
      const t = global.__ferna.windows[0].active;
      const a = global.__ferna.ext.lib.api.browserAction.actionMap.get(id);
      const tab = a && a.tabs[t.view.webContents.id];
      return !!a && /\S/.test((tab && tab.text) || a.text || '');
    }, ids['ferna-equalizer']), 6000, 'equalizer badge on');
    await main(() => { const wc = global.__ferna.windows[0].active.view.webContents; for (const type of ['keyDown', 'keyUp']) wc.sendInputEvent({ type, keyCode: 'Q', modifiers: ['alt', 'shift'] }); });
  });

  await step('0.9 Ferna Screenshot extension: Alt+Shift+V captures the visible page into its editor; saving writes the file', async () => {
    await freshTab(`${base}/long.html?shot`);
    const before = await main(() => global.__ferna.windows[0].tabs.length);
    await main(() => { const wc = global.__ferna.windows[0].active.view.webContents; wc.focus(); for (const type of ['keyDown', 'keyUp']) wc.sendInputEvent({ type, keyCode: 'V', modifiers: ['alt', 'shift'] }); });
    await H.until(() => main((_, id) => global.__ferna.windows[0].tabs.some(t => (t.url || '').startsWith(`chrome-extension://${id}/editor.html`)), ids['ferna-screenshot']), 8000, 'editor opened');
    await H.sleep(1500);
    await shot('v090-03-ferna-screenshot-editor');
    const r = await main(async (_, id) => {
      const w = global.__ferna.windows[0];
      const t = w.tabs.find(x => (x.url || '').startsWith(`chrome-extension://${id}/editor.html`));
      const wc = t.view.webContents;
      const img = await wc.executeJavaScript(`new Promise(r => { const i = document.querySelector('canvas'); r(i ? [i.width, i.height] : null); })`);
      // Save with the downloads API (the editor's Save button does the same)
      const dl = await wc.executeJavaScript(`chrome.downloads.download({ url: document.querySelector('canvas').toDataURL('image/png'), filename: 'Ferna Screenshot/e2e-test.png' })`);
      const file = global.__ferna.downloads[0] && global.__ferna.downloads[0].path;
      w.closeTab(t);
      return { img, dl, file, size: file ? process.getBuiltinModule('fs').statSync(file).size : 0 };
    }, ids['ferna-screenshot']);
    assert(r.img && r.img[0] > 300 && r.dl >= 1 && /Ferna Screenshot[\\/]e2e-test\.png$/.test(r.file || '') && r.size > 1000, JSON.stringify(r));
    void before;
  });

  await step('0.9 Ferna Feeds extension: its button opens the side panel; follows a feed; the panel closes itself', async () => {
    await freshTab(`${base}/long.html?feedsx`);
    await main((_, id) => { const w = global.__ferna.windows[0]; global.__ferna.ext.click(w, id, null); }, ids['ferna-feeds']);
    await H.until(() => main(() => { const s = global.__ferna.windows[0].side; return !!s && s.kind === 'ext' && /feeds\.html/.test(s.view.webContents.getURL()); }), 6000, 'side panel');
    await H.sleep(1500);
    const res = await main(async (_, url) => {
      const wc = global.__ferna.windows[0].side.view.webContents;
      const sub = await wc.executeJavaScript(`window.ferna.cmd('feeds:subscribe', ${JSON.stringify(url)}, {})`);
      await new Promise(r => setTimeout(r, 2500));
      const list = await wc.executeJavaScript(`window.ferna.cmd('feeds:list', { category: 'all', limit: 50 })`);
      return { ok: sub && sub.ok, n: list && list.cards ? list.cards.length : -1 };
    }, `${base}/feeds/lanka.xml`);
    assert(res.ok && res.n > 0, JSON.stringify(res));
    await shot('v090-04-ferna-feeds-panel');
    // Its own close button calls window.close(): the panel goes away
    await main(() => global.__ferna.windows[0].side.view.webContents.executeJavaScript("window.ferna.cmd('feeds:close-panel')").catch(() => {}));
    await H.until(() => main(() => !global.__ferna.windows[0].side), 4000, 'panel closed');
  });
};
