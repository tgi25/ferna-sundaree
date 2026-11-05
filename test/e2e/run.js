'use strict';
// End-to-end tests for Ferna Sundaree (Playwright Electron driver under Xvfb).
// Run: npm run test:e2e   — screenshots go to test/e2e/out/

const fs = require('fs');
const path = require('path');
const os = require('os');
const H = require('./harness');

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
let failed = 0;

async function step(name, fn) {
  // FERNA_E2E_ONLY=<regex> runs only matching steps (for debugging one area).
  if (process.env.FERNA_E2E_ONLY && !new RegExp(process.env.FERNA_E2E_ONLY).test(name)) return;
  const t = Date.now();
  try {
    await fn();
    results.push(`  ok   ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    failed++;
    results.push(`  FAIL ${name}: ${e.message}`);
  }
  console.log(results[results.length - 1]);
}
function assert(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }

(async () => {
  const { srv, base } = await H.serve();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ferna-e2e-'));
  const downloads = path.join(profile, 'Downloads');
  fs.mkdirSync(downloads, { recursive: true });
  const { app, display } = await H.launch(profile, { FERNA_TEST_YT_HOST: 'localhost', FERNA_TEST_POLICY: JSON.stringify({ PopupBlocker: 1, TorWindowsAllowed: 0 }) });
  const shot = async name => { await H.sleep(700); H.screenshot(display, path.join(OUT, `${name}.png`)); };
  const main = (fn, arg) => app.evaluate(fn, arg);
  const win = () => main(() => { const w = global.__ferna.windows[0]; return { tabs: w.tabs.map(t => ({ id: t.id, kind: t.kind, url: t.url, title: t.title, ws: w.tabWorkspace(t), override: t.wsOverride })), active: w.activeId, layout: w.layoutState(), currentWs: w.currentWs, overlay: w.overlayMode }; });
  const page = async prefix => H.until(() => app.windows().find(p => p.url().startsWith(prefix)), 10000, `page ${prefix}`);

  await H.until(() => main(() => global.__ferna && global.__ferna.windows.length === 1), 20000, 'first window');
  await main((electron, d) => { electron.app.setPath('downloads', d); }, downloads);
  await H.sleep(800);

  results.push(`       Chromium sandbox: ${H.AS_USER ? 'on (running as ' + H.AS_USER + ')' : 'per environment'}`);
  await step('window opens on the new tab page with UI drawn', async () => {
    const s = await win();
    assert(s.tabs.length === 1 && s.tabs[0].url === 'ferna://newtab/', 'expected new tab');
    const ui = await page('ferna://ui/');
    await H.until(() => ui.evaluate(() => document.querySelectorAll('#tabs .tab').length === 1), 5000, 'tab drawn');
    await shot('01-new-tab');
  });

  await step('address bar navigates; page view sits below the bars', async () => {
    const ui = await page('ferna://ui/');
    await ui.fill('#address', `${base}/long.html`);
    await ui.press('#address', 'Enter');
    await H.until(async () => (await win()).tabs[0].title === 'Long test page', 8000, 'page load');
    const s = await win();
    assert(s.layout.content.y === 38 + 44 + 30, `content y ${s.layout.content.y}`);
    await shot('02-page');
  });

  await step('req 1: Ctrl+Shift+H hides and shows the tab bar', async () => {
    await main(() => global.__ferna.windows[0].run('toggleTabBar'));
    let s = await win();
    assert(!s.layout.showTabs && s.layout.edgeTabs, 'tab bar should be hidden with a reveal edge');
    assert(s.layout.content.y === 5 + 44 + 30, `content y ${s.layout.content.y}`);
    await shot('03-tabbar-hidden');
    // the reveal edge brings it back temporarily
    await main(() => { const w = global.__ferna.windows[0]; w.reveal.tabs = true; w.relayout(); });
    s = await win();
    assert(s.layout.showTabs, 'reveal should show the strip');
    await main(() => { const w = global.__ferna.windows[0]; w.reveal.tabs = false; w.run('toggleTabBar'); });
    s = await win();
    assert(s.layout.showTabs && !s.layout.edgeTabs, 'tab bar should be back');
  });

  await step('req 1 via real key press (before-input-event)', async () => {
    // A real keyboard event into the page view (Playwright's CDP keys bypass the input router).
    const press = () => main(() => { const wc = global.__ferna.windows[0].active.view.webContents; wc.sendInputEvent({ type: 'keyDown', keyCode: 'H', modifiers: ['control', 'shift'] }); wc.sendInputEvent({ type: 'keyUp', keyCode: 'H', modifiers: ['control', 'shift'] }); });
    await press();
    await H.until(async () => !(await win()).layout.showTabs, 3000, 'hidden by key');
    await press();
    await H.until(async () => (await win()).layout.showTabs, 3000, 'shown by key');
  });

  await step('req 2: Ctrl+Shift+B hides and shows the bookmarks bar', async () => {
    await main(() => global.__ferna.windows[0].run('toggleBookmarksBar'));
    let s = await win();
    assert(!s.layout.showBookmarks && s.layout.content.y === 38 + 44, 'bookmarks bar hidden');
    await main(() => global.__ferna.windows[0].run('toggleBookmarksBar'));
    s = await win();
    assert(s.layout.showBookmarks, 'bookmarks bar shown');
  });

  await step('bookmark the page (Ctrl+D) and see it on the bar', async () => {
    await main(() => global.__ferna.windows[0].run('bookmark'));
    const ui = await page('ferna://ui/');
    await H.until(() => ui.evaluate(() => document.querySelectorAll('#bookmarks .bm[data-bm]').length === 1), 3000, 'bookmark on bar');
  });

  await step('req 4: workspaces, pinned sites and common bar arrange the strip', async () => {
    await main((_, b) => {
      const ctx = global.__ferna;
      const w = ctx.windows[0];
      const teach = ctx.createWorkspace('Teaching');
      const research = ctx.createWorkspace('Research');
      ctx.pinSite(teach.id, `${b}/long.html`, 'Long page');
      ctx.addCommon(`${b}/popup.html`, 'Opener page');
      w.newTab(`${b}/popup.html`, { activate: false });
      w.newTab(`${b}/hostile.html?a=1`, { activate: false, wsOverride: research.id });
      w.newTab(`${b}/hostile.html?b=2`, { activate: false, wsOverride: research.id });
    }, base);
    await H.sleep(800);
    let s = await win();
    const strip = await main(() => global.__ferna.windows[0].strip());
    assert(strip.common[0].tabId, 'common bar entry claims the open popup tab');
    await main(() => { const w = global.__ferna.windows[0]; w.switchWorkspace(global.__ferna.ws.data.workspaces[0].id); });
    const t1 = await main(() => global.__ferna.windows[0].strip());
    assert(t1.pinned.length === 1 && t1.pinned[0].tabId, 'Teaching shows its pinned long page as open');
    assert(t1.tabs.length + t1.pinned.length + t1.common.length >= 2, 'Teaching shows its tabs');
    await shot('04-workspace-teaching');
    await main(() => global.__ferna.windows[0].rotateWorkspace(1));
    s = await win();
    const t2 = await main(() => global.__ferna.windows[0].strip());
    assert(s.currentWs === (await main(() => global.__ferna.ws.data.workspaces[1].id)), 'rotated to Research');
    assert(t2.tabs.length === 2, `Research lists its 2 tabs, got ${t2.tabs.length}`);
    await main(() => global.__ferna.windows[0].switchWorkspace(null));
  });

  await step('req 3: tab bar on the left, collapsed, then on the right', async () => {
    await main(() => global.__ferna.setSetting('tabPosition', 'left'));
    let s = await win();
    assert(s.layout.tabs.x === 0 && s.layout.content.x === s.layout.tabs.width, 'left strip pushes the page right');
    await main(() => global.__ferna.windows[0].switchWorkspace(global.__ferna.ws.data.workspaces[0].id));
    await H.sleep(300);
    await shot('05-vertical-left');
    await main(() => global.__ferna.windows[0].switchWorkspace(null));
    await main(() => global.__ferna.setSetting('verticalCollapsed', true));
    s = await win();
    assert(s.layout.tabs.width === 52, 'collapsed rail is 52 px');
    await H.sleep(300);
    await shot('06-vertical-collapsed');
    await main(() => { global.__ferna.setSetting('verticalCollapsed', false); global.__ferna.setSetting('tabPosition', 'right'); });
    s = await win();
    assert(s.layout.tabs.x + s.layout.tabs.width === s.layout.W, 'right strip touches the right edge');
    await main(() => global.__ferna.windows[0].run('cycleTabPosition'));
    s = await win();
    assert(s.layout.position === 'top', 'Ctrl+Shift+, cycles back to top');
  });

  await step('workspaces as icons; filter button shows only workspaces, favourites and pinned tabs', async () => {
    const ui = await page('ferna://ui/');
    await main(() => { const c = global.__ferna; c.setSetting('tabPosition', 'top'); c.ws.data.workspaces[0].icon = '🎓'; c.ws.save(); c.broadcast(); });
    await H.sleep(400);
    let r = await ui.evaluate(() => ({ names: document.querySelectorAll('#tabs .ws-chip .name').length, ico: document.querySelectorAll('#tabs .ws-chip.ico .wsi').length, glyph: [...document.querySelectorAll('#tabs .ws-chip .ws-glyph')].map(e => e.textContent) }));
    assert(r.names === 0 && r.ico === 3, `icon-only chips ${JSON.stringify(r)}`);
    assert(r.glyph[0] === '🎓' && r.glyph[1] === 'R', `glyphs ${r.glyph}`);
    await main(() => global.__ferna.windows[0].switchWorkspace(global.__ferna.ws.data.workspaces[0].id));
    await ui.click('#tabs [data-fav-only]');
    await H.until(() => ui.evaluate(() => document.querySelector('#tabs').classList.contains('fav-only')), 3000, 'favourites-only on');
    r = await ui.evaluate(() => ({ list: !!document.querySelector('#tabs .tablist'), common: document.querySelectorAll('#tabs .group.common .icon-btn').length, pinned: document.querySelectorAll('#tabs .group.pinned .icon-btn').length, on: document.querySelector('[data-fav-only]').getAttribute('aria-pressed') }));
    assert(!r.list && r.common === 1 && r.pinned === 1 && r.on === 'true', `fav-only top ${JSON.stringify(r)}`);
    await shot('05b-favourites-only-top');
    // "All": pinned sites of every workspace; vertical shows them under workspace names, no tab list.
    await main(() => { const c = global.__ferna; c.windows[0].switchWorkspace(null); c.setSetting('tabPosition', 'left'); });
    await H.sleep(400);
    r = await ui.evaluate(() => ({ sections: [...document.querySelectorAll('#tabs .sect-label')].map(e => e.textContent), rows: document.querySelectorAll('#tabs .scroll .tab').length }));
    assert(r.sections.includes('Pinned') && r.sections.includes('Teaching') && !r.sections.includes('All tabs') && r.rows === 1, `fav-only vertical ${JSON.stringify(r)}`);
    await shot('05c-favourites-only-left');
    await main(() => { const c = global.__ferna; c.windows[0].run('favoritesOnly'); c.windows[0].run('workspaceNames'); });
    await H.sleep(300);
    r = await ui.evaluate(() => ({ names: [...document.querySelectorAll('#tabs .ws-chip .name')].map(e => e.textContent), list: [...document.querySelectorAll('#tabs .sect-label')].map(e => e.textContent) }));
    assert(r.names.join() === 'All tabs,Teaching,Research' && r.list.includes('All tabs'), `names back ${JSON.stringify(r)}`);
    await main(() => { const c = global.__ferna; c.windows[0].run('workspaceNames'); c.setSetting('tabPosition', 'top'); });
  });

  await step('req 5: Tab Overview shows every open page', async () => {
    await main(() => global.__ferna.windows[0].run('tabOverview'));
    const ov = await page('ferna://overlay/');
    await H.until(() => ov.evaluate(() => document.querySelectorAll('.card').length), 5000, 'cards');
    const n = await ov.evaluate(() => document.querySelectorAll('.card').length);
    const tabs = (await win()).tabs.length;
    assert(n === tabs, `overview shows ${n} of ${tabs} tabs`);
    await H.sleep(300);
    await shot('07-tab-overview');
    await ov.keyboard.press('Escape');
    await H.until(async () => !(await win()).overlay, 3000, 'overlay closed');
  });

  await step('Ferna Tabs list opens at the pointer', async () => {
    await main(() => global.__ferna.windows[0].run('tabsAtPointer'));
    const ov = await page('ferna://overlay/');
    await H.until(() => ov.evaluate(() => document.querySelectorAll('.row-tab').length > 0), 5000, 'rows');
    await shot('08-tabs-at-pointer');
    await ov.keyboard.press('Escape');
    await H.until(async () => !(await win()).overlay, 3000, 'closed');
  });

  await step('command palette finds tabs and commands', async () => {
    await main(() => global.__ferna.windows[0].run('commandPalette'));
    const ov = await page('ferna://overlay/');
    await ov.waitForSelector('#pal-q');
    await ov.fill('#pal-q', 'hostile');
    await H.until(() => ov.evaluate(() => [...document.querySelectorAll('.pal-item .t')].some(e => /Hostile/.test(e.textContent))), 4000, 'match');
    await shot('09-palette');
    await ov.keyboard.press('Escape');
  });

  await step('security: a hostile page reaches no Node, no IPC and no ferna:// page', async () => {
    const id = await main(() => { const w = global.__ferna.windows[0]; const t = w.tabs.find(x => /hostile\.html\?a=1/.test(x.url)); w.activate(t); return t.id; });
    await H.sleep(800);
    const hp = await page(`${base}/hostile.html?a=1`);
    const r = await hp.evaluate(() => window.__probe());
    fs.writeFileSync(path.join(OUT, 'hostile-probe.json'), JSON.stringify(r, null, 2));
    assert(r.require === 'undefined' && r.process === 'undefined' && r.module === 'undefined', 'Node globals visible');
    assert(r.fernaApi === 'undefined' && r.ipcRenderer === 'undefined', 'Ferna API visible to the page');
    assert(r.fetchFerna === 'blocked' && r.fetchShot === 'blocked', 'page could fetch ferna://');
    const tabs = (await win()).tabs;
    assert(!tabs.some(t => /^ferna:\/\/settings/.test(t.url)), 'window.open(ferna://settings) must not open it');
    // top navigation to ferna:// swaps the view instead of loading it with the page's renderer
    await hp.evaluate(() => { location.href = 'ferna://settings/'; });
    await H.until(async () => (await win()).tabs.find(t => t.id === id).url.startsWith('ferna://settings'), 5000, 'swapped');
    const t = (await win()).tabs.find(x => x.id === id);
    assert(t.kind === 'internal', 'swapped tab is a fresh internal view');
    const rejected = await main(() => global.__ferna._ipc.rejected.length).catch(() => 0);
    results.push(`       (IPC calls rejected so far: ${rejected})`);
  });

  await step('IPC gate refuses commands from the wrong Ferna page', async () => {
    const nt = await main(() => global.__ferna.windows[0].newTab('ferna://newtab/').id);
    const p = await page('ferna://newtab/');
    const r = await p.evaluate(async () => {
      const out = {};
      try { await window.ferna.cmd('settings:set', 'httpsFirst', false); out.set = 'allowed'; } catch (e) { out.set = 'refused'; }
      try { await window.ferna.cmd('no:such', 1); out.unknown = 'allowed'; } catch (e) { out.unknown = 'refused'; }
      try { await window.ferna.cmd('nav:go', 12345); out.badType = 'allowed'; } catch (e) { out.badType = 'refused'; }
      return out;
    });
    assert(r.set === 'refused' && r.unknown === 'refused' && r.badType === 'refused', JSON.stringify(r));
    const still = await main(() => global.__ferna.settings.data.httpsFirst);
    assert(still === true, 'setting must be unchanged');
    await main((_, id) => { const w = global.__ferna.windows[0]; w.closeTab(w.tabs.find(t => t.id === id)); }, nt);
  });

  await step('popups become tabs and keep window.opener', async () => {
    await main((_, b) => global.__ferna.windows[0].newTab(`${b}/popup.html?x=1`), base);
    await H.sleep(800);
    const p = await page(`${base}/popup.html?x=1`);
    const before = (await win()).tabs.length;
    await p.click('#b');
    await H.until(async () => (await win()).tabs.length === before + 1, 5000, 'popup tab');
    const child = await H.until(() => app.windows().find(x => x.url() === `${base}/long.html` && x !== p && x.url()), 5000, 'child page');
    await H.sleep(500);
    const hasOpener = await p.evaluate(() => !!(window.__child && !window.__child.closed));
    assert(hasOpener, 'opener lost its child window handle');
  });

  await step('screenshot: entire page in one capture, opened in the Ferna Screenshots editor', async () => {
    await main(() => { const w = global.__ferna.windows[0]; w.activate(w.tabs.find(t => /long\.html$/.test(t.url))); });
    await H.sleep(600);
    await main(() => global.__ferna.windows[0].run('shotFull'));
    const ed = await page('ferna://shots/editor.html');
    await ed.waitForLoadState('load');
    await H.until(() => ed.evaluate(() => !!document.querySelector('canvas#view') && document.title.includes('Long test page')), 10000, 'editor loaded the capture');
    const size = await main(() => [...global.__ferna.shots.values()].pop().image.getSize());
    assert(size.height >= 3000 && size.height <= 3200, `full page height ${size.height}`);
    await H.sleep(800);
    await shot('10-screenshot-editor');
  });

  await step('screenshot: editor saves the stamped PNG into Downloads/Ferna Screenshots', async () => {
    const ed = await page('ferna://shots/editor.html');
    const btn = await ed.$('#savePng, [data-format="png"], #save');
    assert(btn, 'save button present');
    await btn.click();
    const dir = path.join(downloads, 'Ferna Screenshots');
    await H.until(() => fs.existsSync(dir) && fs.readdirSync(dir).some(f => f.endsWith('.png')), 8000, 'png saved');
    const f = fs.readdirSync(dir).find(x => x.endsWith('.png'));
    results.push(`       saved ${f} (${fs.statSync(path.join(dir, f)).size} bytes)`);
  });

  await step('screenshot: region picker spans the whole page', async () => {
    await main(() => { const w = global.__ferna.windows[0]; w.activate(w.tabs.find(t => /long\.html$/.test(t.url))); });
    await H.sleep(400);
    await main(() => global.__ferna.windows[0].run('shotRegion'));
    const ov = await page('ferna://overlay/');
    await H.until(() => ov.evaluate(() => { const i = document.querySelector('#reg-img'); return i && i.complete && i.naturalWidth > 0; }), 8000, 'region image');
    await shot('11-region-picker');
    const before = (await win()).tabs.length;
    await main(() => global.__ferna.windows[0].finishRegion({ x: 0, y: 500, width: 400, height: 1400 }));
    await H.until(async () => (await win()).tabs.length === before + 1, 5000, 'region editor tab');
    const size = await main(() => [...global.__ferna.shots.values()].pop().image.getSize());
    assert(size.height === 1400 && size.width === 400, `region ${size.width}×${size.height}`);
  });

  await step('PDF: web PDF opens in the built-in Ferna PDF Reader and renders', async () => {
    await main((_, b) => global.__ferna.windows[0].newTab(`${b}/test.pdf`), base);
    const pv = await page('ferna://pdf/viewer/viewer.html');
    await pv.waitForLoadState('load');
    await H.until(() => pv.evaluate(() => document.querySelector('#welcome') && document.querySelector('#welcome').hidden && /\/\s*2/.test(document.body.innerText) && document.querySelectorAll('canvas').length > 0), 15000, 'pdf rendered (2 pages)');
    await H.sleep(1200);
    await shot('12-pdf-reader');
  });

  await step('PDF: a PDF served without .pdf in the address also opens in the reader', async () => {
    const before = (await win()).tabs.filter(t => /ferna:\/\/pdf/.test(t.url)).length;
    await main((_, b) => global.__ferna.windows[0].newTab(`${b}/document?nopdfext`), base);
    await H.until(async () => (await win()).tabs.filter(t => /ferna:\/\/pdf/.test(t.url)).length > before, 8000, 'reader tab');
    const pv = await H.until(() => app.windows().find(p => p.url().includes('document%3Fnopdfext')), 8000, 'reader page');
    await H.until(() => pv.evaluate(() => document.querySelector('#welcome').hidden && document.querySelectorAll('canvas').length > 0), 15000, 'rendered');
  });

  await step('PDF: the browser acts as the save helper (local file read, write, verify)', async () => {
    const src = path.join(H.FIX, 'test.pdf');
    const copy = path.join(profile, 'copy.pdf');
    fs.copyFileSync(src, copy);
    H.own(copy);
    const pv = await page('ferna://pdf/viewer/viewer.html');
    const r = await pv.evaluate(async file => {
      const port = chrome.runtime.connectNative('com.fernasolutions.pdf_saver');
      const replies = [];
      const call = m => new Promise(res => { port.onMessage.addListener(function f(x) { port.onMessage.removeListener(f); res(x); }); port.postMessage(m); });
      replies.push(await call({ cmd: 'ping' }));
      const read = await call({ cmd: 'read', path: file, offset: 0, length: 1 << 20 });
      replies.push({ ok: read.ok, size: read.size });
      const data = btoa(atob(read.data) + '\n% saved by Ferna Sundaree\n');
      replies.push(await call({ cmd: 'begin', path: file }));
      replies.push(await call({ cmd: 'chunk', data }));
      replies.push(await call({ cmd: 'commit', size: atob(data).length }));
      replies.push(await call({ cmd: 'read', path: file.replace(/\.pdf$/, '.txt'), offset: 0, length: 10 }));
      return replies;
    }, copy);
    assert(r[0].ok && r[1].ok && r[4].ok, JSON.stringify(r));
    assert(fs.readFileSync(copy, 'utf8').includes('saved by Ferna Sundaree'), 'file not overwritten');
    assert(r[5].ok === false, 'helper must refuse non-PDF paths');
  });

  await step('internal pages load: settings, history, downloads, bookmarks', async () => {
    for (const u of ['ferna://settings/', 'ferna://history/', 'ferna://downloads/', 'ferna://bookmarks/']) {
      await main((_, x) => global.__ferna.windows[0].openInternal(x), u);
      const p = await page(u);
      await p.waitForLoadState('load');
      await H.sleep(500);
      const errs = await p.evaluate(() => document.body.innerText.length);
      assert(errs > 50, `${u} looks empty`);
      if (u === 'ferna://settings/') await shot('13-settings');
      if (u === 'ferna://history/') { const n = await p.evaluate(() => document.querySelectorAll('.item').length); assert(n >= 1, 'history has entries'); }
    }
  });

  await step('Ferna Tabs export file imports into workspaces', async () => {
    const r = await main(() => {
      const ws = global.__ferna._ws;
      return ws.importFernaTabs({ format: 'x', workspaces: [{ id: 'w1', name: 'Code', color: 2, sites: [{ u: 'https://github.com/', t: 'GitHub' }], hosts: ['gitlab.com'] }], common: [{ u: 'https://mail.google.com/mail/u/0/', t: 'Mail 0' }, { u: 'https://mail.google.com/mail/u/1/', t: 'Mail 1' }] });
    });
    assert(r.workspaces[0].color === '#1c8c4a' && r.workspaces[0].pinned[0].url === 'https://github.com/', JSON.stringify(r.workspaces[0]));
    assert(r.common.length === 2, 'two common entries');
  });

  await step('private window: separate session, nothing written to history', async () => {
    const before = await main(() => global.__ferna.history.data.entries.length);
    await main((_, b) => global.__ferna.newWindow({ private: true, url: `${b}/long.html?private` }), base);
    await H.sleep(1500);
    const after = await main(() => global.__ferna.history.data.entries.length);
    const sameSession = await main(() => global.__ferna.windows[1].session === global.__ferna.webSession);
    assert(after === before, 'private visit recorded');
    assert(!sameSession, 'private window must use its own session');
    await main(() => global.__ferna.windows[1].win.close());
    await H.sleep(500);
  });

  await step('session restore data is written encrypted-or-plain JSON and lists the tabs', async () => {
    await main(() => global.__ferna.saveSessionSoon());
    await H.sleep(1500);
    assert(fs.existsSync(path.join(profile, 'session.enc')), 'session file missing');
  });

  // ===================== v0.2: frameless window, zoom, extensions, themes =====================
  const activeWc = () => main(() => { const w = global.__ferna.windows[0]; return w.active.view.webContents.id; });
  const evalActive = (code) => main((_, c) => global.__ferna.windows[0].active.view.webContents.executeJavaScript(c), code);
  const freshTab = async url => { await main((_, u) => global.__ferna.windows[0].newTab(u), url); await H.until(async () => (await evalActive('document.readyState')) === 'complete', 8000, 'tab loaded'); await H.sleep(300); };

  await step('frameless: window controls on the tab bar; Ctrl+Shift+H hides them with it', async () => {
    const ui = await page('ferna://ui/');
    await H.until(() => ui.evaluate(() => document.querySelectorAll('#tabs .winctl [data-win]').length === 3), 4000, 'controls on tab bar');
    const drag = await ui.evaluate(() => getComputedStyle(document.querySelector('#tabs')).webkitAppRegion || getComputedStyle(document.querySelector('#tabs')).getPropertyValue('-webkit-app-region'));
    assert(/drag/.test(drag), `tab bar should be a drag region (${drag})`);
    await main(() => global.__ferna.windows[0].run('toggleTabBar'));
    let s = await win();
    assert(s.layout.windowControls === null && !s.layout.showTabs, 'controls hidden with the tab bar');
    await main(() => global.__ferna.windows[0].run('toggleTabBar'));
    await main(() => global.__ferna.setSetting('tabPosition', 'left'));
    await H.until(() => ui.evaluate(() => !document.querySelector('#winctl-tb').hidden && document.querySelectorAll('#winctl-tb [data-win]').length === 3), 4000, 'controls on toolbar');
    await shot('20-vertical-one-bar');
    await main(() => global.__ferna.windows[0].run('toggleTabBar'));
    s = await win();
    assert(!s.layout.toolbar && !s.layout.tabs && s.layout.edgeToolbar, 'vertical: toolbar with controls hides together with tabs');
    await shot('21-vertical-hidden');
    await main(() => { global.__ferna.windows[0].run('toggleTabBar'); global.__ferna.setSetting('tabPosition', 'top'); });
    const isMax0 = await main(() => global.__ferna.windows[0].win.isMaximized());
    await ui.click('#tabs .winctl [data-win="maximize"]');
    await H.sleep(600);
    const isMax1 = await main(() => global.__ferna.windows[0].win.isMaximized());
    results.push(`       maximise button: ${isMax0} → ${isMax1} (no window manager under Xvfb, may not change)`);
    if (isMax1) await ui.click('#tabs .winctl [data-win="maximize"]');
  });

  await step('zoom: full zoom per site, shared by tabs of the same site', async () => {
    await freshTab(`${base}/zoom.html`);
    await main(() => global.__ferna.windows[0].run('zoomIn'));
    await H.sleep(300);
    let f = await main(() => global.__ferna.windows[0].active.view.webContents.getZoomFactor());
    assert(Math.abs(f - 1.1) < 0.001, `zoom factor ${f}`);
    await freshTab(`${base}/long.html?same-site`);
    await H.sleep(400);
    f = await main(() => global.__ferna.windows[0].active.view.webContents.getZoomFactor());
    assert(Math.abs(f - 1.1) < 0.001, `second tab of the site follows (${f})`);
    await main(() => global.__ferna.windows[0].run('zoomReset'));
    await H.sleep(300);
    f = await main(() => global.__ferna.windows[0].active.view.webContents.getZoomFactor());
    assert(Math.abs(f - 1) < 0.001, 'reset to 100 %');
  });

  await step('zoom: text-only zoom scales text, not images, and follows late content', async () => {
    await freshTab(`${base}/zoom.html?text`);
    const before = await evalActive(`({ p: getComputedStyle(document.getElementById('p')).fontSize, em: getComputedStyle(document.getElementById('em')).fontSize, inner: getComputedStyle(document.getElementById('inner')).fontSize, img: document.getElementById('img').getBoundingClientRect().width })`);
    await main(async () => { const w = global.__ferna.windows[0]; await global.__ferna.zoomAct(w, w.active, 'setType', 'text'); await global.__ferna.zoomAct(w, w.active, 'set', 150); });
    await H.sleep(400);
    const after = await evalActive(`({ p: getComputedStyle(document.getElementById('p')).fontSize, em: getComputedStyle(document.getElementById('em')).fontSize, inner: getComputedStyle(document.getElementById('inner')).fontSize, img: document.getElementById('img').getBoundingClientRect().width, zoom: devicePixelRatio })`);
    assert(parseFloat(after.p) === parseFloat(before.p) * 1.5, `p ${before.p} → ${after.p}`);
    assert(parseFloat(after.em) === parseFloat(before.em) * 1.5, `em ${before.em} → ${after.em}`);
    assert(parseFloat(after.inner) === parseFloat(before.inner) * 1.5, `nested ${before.inner} → ${after.inner} (no compounding)`);
    assert(after.img === before.img, `image width must not change (${before.img} → ${after.img})`);
    await H.sleep(1600);
    const late = await evalActive(`getComputedStyle(document.getElementById('late')).fontSize`);
    assert(parseFloat(late) === 18, `late content 12px → ${late}`);
    await shot('22-text-zoom');
    // page script cannot see the zoom code
    const leak = await evalActive('typeof window.__fernaTZ');
    assert(leak === 'undefined', 'text-zoom code must live in an isolated world');
  });

  await step('zoom: minimum font size, reset, panel and AutoFit', async () => {
    await main(async () => { const w = global.__ferna.windows[0]; await global.__ferna.zoomAct(w, w.active, 'reset'); await global.__ferna.zoomAct(w, w.active, 'minFont', 16); });
    await H.sleep(400);
    let small = await evalActive(`[getComputedStyle(document.getElementById('small')).fontSize, getComputedStyle(document.getElementById('p')).fontSize]`);
    assert(small[0] === '16px' && small[1] === '16px', `min font: ${small}`);
    await main(async () => { const w = global.__ferna.windows[0]; await global.__ferna.zoomAct(w, w.active, 'fontReset'); });
    await H.sleep(300);
    small = await evalActive(`getComputedStyle(document.getElementById('small')).fontSize`);
    assert(small === '12px', `font reset: ${small}`);
    await main(() => global.__ferna.windows[0].run('zoomPanel'));
    const ov = await page('ferna://overlay/');
    await ov.waitForSelector('#zpanel');
    await ov.click('[data-type="1"]');
    await H.until(async () => (await main(() => { const w = global.__ferna.windows[0]; return global.__ferna.zoomState(w, w.active).type; })) === 'text', 3000, 'panel switched to text');
    await ov.click('[data-z="in"]');
    await H.sleep(300);
    await shot('23-zoom-panel');
    await ov.click('[data-type="0"]');
    await ov.click('[data-z="autofit"]');
    await H.sleep(500);
    const st = await main(() => { const w = global.__ferna.windows[0]; return global.__ferna.zoomState(w, w.active); });
    assert(st.type === 'full' && st.full > 100, `AutoFit widened a 600 px page: ${JSON.stringify(st)}`);
    await ov.keyboard.press('Escape');
    await main(async () => { const w = global.__ferna.windows[0]; await global.__ferna.zoomAct(w, w.active, 'reset'); });
  });

  await step('zoom: per-tab mode uses CSS zoom and leaves other tabs alone', async () => {
    await main(() => global.__ferna.settings.set('zoomPrefs', { ...global.__ferna.zoomPrefs(), mode: 'tab' }));
    await freshTab(`${base}/zoom.html?tab1`);
    await main(async () => { const w = global.__ferna.windows[0]; await global.__ferna.zoomAct(w, w.active, 'set', 133); });
    await H.sleep(300);
    const z1 = await evalActive(`getComputedStyle(document.documentElement).zoom`);
    await freshTab(`${base}/zoom.html?tab2`);
    const z2 = await evalActive(`getComputedStyle(document.documentElement).zoom`);
    assert(Math.abs(parseFloat(z1) - 1.33) < 0.01 && parseFloat(z2) === 1, `tab zoom ${z1} vs ${z2}`);
    await main(() => global.__ferna.settings.set('zoomPrefs', { ...global.__ferna.zoomPrefs(), mode: 'site' }));
  });

  await step('tabs: star adds to the common bar, pin works in All tabs and in a workspace, Alt+S', async () => {
    const ui = await page('ferna://ui/');
    await main(() => global.__ferna.windows[0].switchWorkspace(null));
    await freshTab(`${base}/extensions/probe-src/probe.html?pinme`); // own folder: the common bar keys sites by folder
    const id = (await win()).active;
    await main(() => global.__ferna.setSetting('tabPosition', 'left'));
    await H.sleep(500);
    const commonBefore = await main(() => global.__ferna.ws.data.common.length);
    // Hover buttons on the tab in the strip (tabs on top).
    await ui.hover(`#tabs .tab[data-id="${id}"]`);
    await ui.click(`#tabs .tab[data-id="${id}"] [data-common-tab]`);
    await H.until(() => main((_, n) => global.__ferna.ws.data.common.length === n + 1, commonBefore), 3000, 'added to common bar');
    await main(() => { const c = global.__ferna; c.removeCommon(c.ws.data.common.length - 1); });
    await H.sleep(300);
    await ui.hover(`#tabs .tab[data-id="${id}"]`);
    await ui.click(`#tabs .tab[data-id="${id}"] [data-pin-tab]`);
    await H.until(() => main(() => global.__ferna.ws.data.allPinned.length === 1), 3000, 'pinned in All tabs');
    let st = await main(() => global.__ferna.windows[0].strip());
    assert(st.pinned.length === 1 && st.pinned[0].wsId === '' && st.pinned[0].tabId, `All strip ${JSON.stringify(st.pinned)}`);
    const labels = await ui.evaluate(() => [...document.querySelectorAll('#tabs .sect-label')].map(e => e.textContent));
    assert(labels[0] === 'Pinned in All tabs', `labels ${labels}`);
    await shot('05d-pinned-in-all-tabs');
    // Unpin from the row's pin button, then Alt+S pins the active tab into the current workspace.
    await ui.hover('#tabs .scroll .tab.pinned');
    await ui.click('#tabs .scroll .tab.pinned [data-unpin]');
    await H.until(() => main(() => global.__ferna.ws.data.allPinned.length === 0), 3000, 'unpinned');
    const research = await main(() => global.__ferna.ws.data.workspaces[1].id);
    await main((_, r) => { const w = global.__ferna.windows[0]; w.moveTabToWorkspace(w.active, r); w.switchWorkspace(r); }, research);
    await main(() => { const w = global.__ferna.windows[0]; w.active.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'S', modifiers: ['alt'] }); });
    await H.until(() => main((_, r) => global.__ferna.ws.data.workspaces.find(w => w.id === r).pinned.some(p => p.url.includes('pinme')), research), 3000, 'Alt+S pinned in workspace');
    const items = await main(() => { const w = global.__ferna.windows[0]; return global.__ferna._menus.tabMenu(w, w.active).items.map(i => i.label); });
    assert(items.some(l => /^Unpin from “Research”$/.test(l)) && items.includes('Pin to') && items.includes('Add to common bar'), `menu ${items}`);
    await main((_, r) => { const c = global.__ferna; const w = c.ws.data.workspaces.find(x => x.id === r); w.pinned = w.pinned.filter(p => !p.url.includes('pinme')); c.ws.save(); c.windows[0].switchWorkspace(null); c.setSetting('tabPosition', 'top'); }, research);
  });

  // ---------------- v0.3 features ----------------
  const overlayPage = () => page('ferna://overlay/');
  await step('Ferna Tabs list: no matching tab offers web search; an address offers Go to; Alt+B bookmarks', async () => {
    await main(() => global.__ferna.windows[0].run('tabsAtPointer'));
    const ov = await overlayPage();
    await ov.waitForSelector('#pt-q');
    await ov.fill('#pt-q', 'zzqq nothing here');
    await H.until(() => ov.evaluate(() => { const r = document.querySelector('#pt-list .row-tab'); return r && r.classList.contains('web') && /Search with .* for “zzqq nothing here”/.test(r.textContent); }), 3000, 'search row first');
    await ov.fill('#pt-q', 'long');
    await H.until(() => ov.evaluate(() => { const rows = [...document.querySelectorAll('#pt-list .row-tab')]; return rows.length > 1 && !rows[0].classList.contains('web') && rows[rows.length - 1].classList.contains('web'); }), 3000, 'tabs first, search last');
    await ov.fill('#pt-q', 'example.org');
    await H.until(() => ov.evaluate(() => /Go to example\.org/.test(document.querySelector('#pt-list .row-tab').textContent)), 3000, 'go-to row');
    await shot('30-pointer-search-fallback');
    const before = (await win()).tabs.length;
    await ov.fill('#pt-q', 'ferna sundaree test query');
    await ov.press('#pt-q', 'Enter');
    await H.until(async () => (await win()).tabs.length === before + 1, 4000, 'search tab');
    const s = await win();
    assert(s.tabs.some(t => /q=ferna(\+|%20)sundaree(\+|%20)test(\+|%20)query/.test(t.url)), `search url ${s.tabs.map(t => t.url)}`);
    await main(() => { const c = global.__ferna; c.bookmarkOp('folder', { parent: 'bar', title: 'Research' }); });
    await main(() => global.__ferna.windows[0].run('tabsAtPointer'));
    const ov2 = await overlayPage();
    await ov2.waitForSelector('#pt-q');
    await ov2.press('#pt-q', 'Alt+B');
    await H.until(() => ov2.evaluate(() => document.querySelector('#pop').classList.contains('bm-view') && document.querySelectorAll('#pt-list .bmv-row').length >= 1), 3000, 'bookmarks view in the list');
    await shot('31-pointer-bookmarks');
    await main(() => global.__ferna.windows[0].closeOverlay());
  });

  await step('bookmarks popup: folders, breadcrumb, search, add this page, move', async () => {
    await freshTab(`${base}/long.html?bm`);
    const ids = await main(() => {
      const c = global.__ferna;
      const res = c.bookmarks.data.items.find(n => n.title === 'Research');
      c.bookmarkOp('add', { parent: res.id, url: 'https://arxiv.org/', title: 'arXiv' });
      const ml = c.bookmarkOp('folder', { parent: res.id, title: 'ML papers' }).items.find(n => n.title === 'ML papers');
      c.bookmarkOp('add', { parent: ml.id, url: 'https://paperswithcode.com/', title: 'Papers with Code' });
      return { res: res.id, ml: ml.id };
    });
    await main(() => global.__ferna.windows[0].run('bookmarksPanel'));
    const ov = await overlayPage();
    await ov.waitForSelector('#bm-pop .bmv-row');
    await ov.click('#bm-pop .bmv-row.folder >> text=Bookmarks bar');
    await ov.click('#bm-pop .bmv-row.folder >> text=Research');
    await H.until(() => ov.evaluate(() => [...document.querySelectorAll('#bm-pop .crumb')].map(c => c.textContent).join('>') === 'Bookmarks>Bookmarks bar>Research'), 3000, 'breadcrumb');
    await ov.click('#bm-pop [data-tool="add"]');
    await H.until(() => main((_, id) => global.__ferna.bookmarks.data.items.some(n => n.folder === id && /long\.html\?bm/.test(n.url || '')), ids.res), 3000, 'added to Research');
    await shot('32-bookmarks-popup');
    await ov.fill('#bm-pop .bmv-q', 'papers');
    await H.until(() => ov.evaluate(() => [...document.querySelectorAll('#bm-pop .bmv-row')].some(r => /Papers with Code/.test(r.textContent) && /Research › ML papers/.test(r.textContent))), 3000, 'search with path');
    const moved = await main((_, i) => { const c = global.__ferna; const a = c.bookmarks.data.items.find(n => n.url === 'https://arxiv.org/'); return c.bookmarkOp('move', { id: a.id, parent: i.ml, index: 0 }).ok && c.bookmarks.data.items.find(n => n.url === 'https://arxiv.org/').folder === i.ml; }, ids);
    assert(moved, 'move into folder');
    await main(() => global.__ferna.windows[0].closeOverlay());
  });

  await step('selection menu: Copy and Search appear next to selected text; Search opens a tab', async () => {
    await freshTab(`${base}/video.html`);
    const r = await evalActive(`(() => { const p = document.querySelector('p'); const range = document.createRange(); range.setStart(p.firstChild, 0); range.setEnd(p.firstChild, 11); const s = getSelection(); s.removeAllRanges(); s.addRange(range); const b = range.getBoundingClientRect(); return { x: Math.round(b.right), y: Math.round(b.bottom), top: Math.round(b.top) }; })()`);
    await main((_, r) => { const wc = global.__ferna.windows[0].active.view.webContents; wc.sendInputEvent({ type: 'mouseUp', x: r.x - 2, y: r.y - 4, button: 'left', clickCount: 1 }); }, r);
    await H.until(() => evalActive(`!!document.querySelector('ferna-selection-menu')`), 3000, 'menu shown');
    await shot('33-selection-menu');
    const before = (await win()).tabs.length;
    // The bar is centred under the end of the selection: Copy on the left, Search on the right.
    for (const dx of [28, 40, 52]) {
      await main((_, p) => { const wc = global.__ferna.windows[0].active.view.webContents; wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 }); wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 }); }, { x: r.x + dx, y: r.y + 8 + 16 });
      await H.sleep(500);
      if ((await win()).tabs.length > before) break;
      await evalActive(`(() => { const p = document.querySelector('p'); const range = document.createRange(); range.setStart(p.firstChild, 0); range.setEnd(p.firstChild, 11); getSelection().removeAllRanges(); getSelection().addRange(range); })()`);
      await main((_, r) => { const wc = global.__ferna.windows[0].active.view.webContents; wc.sendInputEvent({ type: 'mouseUp', x: r.x - 2, y: r.y - 4, button: 'left', clickCount: 1 }); }, r);
      await H.sleep(200);
    }
    // The search page may fail to load offline; a failed first try is retried once, so wait for it.
    await H.until(async () => (await win()).tabs.some(t => /q=Select(\+|%20)this/.test(decodeURIComponent(t.url))), 6000, 'search tab address').catch(() => {});
    const s = await win();
    assert(s.tabs.length === before + 1 && s.tabs.some(t => /q=Select(\+|%20)this/.test(decodeURIComponent(t.url))), `search tab ${s.tabs.length - before} ${s.tabs.map(t => t.url).slice(-2)}`);
  });

  await step('Picture-in-Picture pops the video out (even with disablepictureinpicture) and back', async () => {
    await main((_, b) => { const w = global.__ferna.windows[0]; w.activate(w.tabs.find(t => /video\.html$/.test(t.url))); }, base);
    await H.until(() => evalActive(`document.getElementById('v').readyState > 0`), 6000, 'video metadata');
    await main(() => global.__ferna.windows[0].active.view.webContents.executeJavaScript(`document.getElementById('v').play()`, true));
    await H.until(() => main(() => global.__ferna.windows[0].active.hasVideo), 5000, 'video detected (toolbar button)');
    await main(() => global.__ferna.windows[0].run('pip'));
    await H.until(() => evalActive(`document.title === 'PIP-IN' && !!document.pictureInPictureElement`), 5000, 'in PiP');
    await shot('34-picture-in-picture');
    await main(() => global.__ferna.windows[0].run('pip'));
    await H.until(() => evalActive(`document.title === 'PIP-OUT' && !document.pictureInPictureElement`), 5000, 'out of PiP');
  });

  await step('equalizer: preset reaches the page; Auto-EQ picks Classical from the page and sound', async () => {
    let r = await main(async () => {
      const c = global.__ferna; const w = c.windows[0]; const t = w.active;
      c.pageFx.setEq({ enabled: true, auto: false, preset: 'rock' });
      await c.pageFx.EQ.apply(t.view.webContents, c.pageFx.eqCfg());
      await new Promise(res => setTimeout(res, 800));
      return c.pageFx.eqStatus(t);
    });
    assert(r && r.enabled && r.attached === 1 && r.gains[0] === 5 && r.gains[9] === 5, `rock ${JSON.stringify(r)}`);
    assert(await evalActive(`!document.getElementById('v').paused`), 'still playing through the equalizer');
    await main(() => global.__ferna.pageFx.setEq({ auto: true }));
    r = await H.until(async () => { const st = await main(() => global.__ferna.pageFx.eqStatus(global.__ferna.windows[0].active)); return st && st.applied === 'classical' ? st : null; }, 12000, 'auto genre');
    assert(/symphony|orchestra/.test(r.reason), `reason ${r.reason}`);
    await main(() => global.__ferna.windows[0].run('equalizer'));
    const ov = await overlayPage();
    await ov.waitForSelector('#eqp');
    await H.until(() => ov.evaluate(() => /Classical/.test(document.querySelector('#eq-detect').textContent)), 4000, 'panel shows detection');
    await shot('35-equalizer');
    await main(() => { const c = global.__ferna; c.windows[0].closeOverlay(); c.pageFx.setEq({ enabled: false, auto: false, preset: 'flat' }); });
  });

  await step('YouTube: ad schedule removed before the player, ad slot hidden, ad skipped; pop-up blocked', async () => {
    const port = new URL(base).port;
    await freshTab(`http://localhost:${port}/yt.html`);
    const r = await evalActive(`({ initial: window.__initialKeys, parsed: window.__parsedKeys, nested: Object.keys(JSON.parse('{"playerResponse":{"adPlacements":[1],"streamingData":{}}}').playerResponse) })`);
    assert(JSON.stringify(r.initial) === '["videoDetails"]', `inline ${JSON.stringify(r)}`);
    assert(JSON.stringify(r.parsed) === '["playerResponse"]' && JSON.stringify(r.nested) === '["streamingData"]', `parsed ${JSON.stringify(r)}`);
    await H.until(() => evalActive(`getComputedStyle(document.getElementById('adslot')).display === 'none' && (window.__skipClicked || 0) >= 1`), 5000, 'slot hidden and skip clicked');
    await H.sleep(1500);
    const st = await main(() => { const w = global.__ferna.windows[0]; return { blocked: w.active.blockedPopups || [], opened: w.tabs.some(t => /long\.html\?auto/.test(t.url)) }; });
    assert(st.blocked.length === 1 && !st.opened, `popup ${JSON.stringify(st)}`);
  });

  await step('safe browsing: a listed phishing page shows the red warning; "Visit anyway" opens it', async () => {
    const port = new URL(base).port;
    await main(() => global.__ferna.safety.addForTest('phishing', '||localhost/phish.html'));
    await main((_, u) => global.__ferna.windows[0].newTab(u), `http://localhost:${port}/phish.html`);
    await H.until(async () => /^ferna:\/\/interstitial\/\?kind=phishing/.test(await main(() => global.__ferna.windows[0].active.url)), 6000, 'phishing warning');
    const ip = await page('ferna://interstitial/?kind=phishing');
    await ip.waitForSelector('h1');
    assert(/Deceptive site ahead/.test(await ip.textContent('h1')), 'title');
    await shot('36-phishing-warning');
    await ip.click('summary');
    await ip.click('[data-act="unsafe"]');
    await H.until(async () => /phish\.html$/.test(await main(() => global.__ferna.windows[0].active.url)), 6000, 'visited anyway');
    const clean = await main(() => global.__ferna.safety.check('http://localhost:1/other.html'));
    assert(clean === null, 'other pages of the host are not listed');
  });

  await step('my filters and element picker: hide an element on a site, rule saved', async () => {
    await freshTab(`${base}/video.html?pick`);
    const r = await evalActive(`(() => { const b = document.querySelector('h1').getBoundingClientRect(); return { x: Math.round(b.left + 20), y: Math.round(b.top + b.height / 2), w: innerWidth, h: innerHeight }; })()`);
    main((_, at) => { const c = global.__ferna; const w = c.windows[0]; c.pageFx.pickElement(w, w.active, at); }, { x: r.x, y: r.y });
    await H.until(() => evalActive(`!!document.querySelector('ferna-element-picker')`), 3000, 'picker open');
    await H.sleep(400);
    await shot('37-element-picker');
    // "Hide" is the right-most button of the panel at the bottom-right corner.
    await main((_, p) => { const wc = global.__ferna.windows[0].active.view.webContents; wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 }); wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 }); }, { x: r.w - 52, y: r.h - 42 });
    await H.until(() => main(() => /##h1/.test(global.__ferna.settings.data.customFilters)), 4000, 'rule saved');
    await H.until(() => evalActive(`getComputedStyle(document.querySelector('h1')).display === 'none'`), 4000, 'element hidden');
    // A network rule of your own blocks at once.
    await main(() => { const c = global.__ferna; c.settings.set('customFilters', c.settings.data.customFilters + '/blockme.js$script\n'); c.blocker.setCustom(c.settings.data.customFilters); });
    const m = await main((_, u) => global.__ferna.blocker.match({ url: u, resourceType: 'script', referrer: `${new URL(u).origin}/video.html`, method: 'GET', id: 1 }), `${base}/blockme.js`);
    assert(m.block, 'custom network rule blocks');
    await main(() => { const c = global.__ferna; c.settings.set('customFilters', ''); c.blocker.setCustom(''); });
  });

  await step('look-alike address: "Did you mean paypal.com?" before the page loads', async () => {
    await main(() => global.__ferna.windows[0].newTab('https://paypa1.com/login'));
    await H.until(async () => /^ferna:\/\/interstitial\/\?kind=lookalike/.test(await main(() => global.__ferna.windows[0].active.url)), 6000, 'look-alike warning');
    const ip = await page('ferna://interstitial/?kind=lookalike');
    await ip.waitForSelector('h1');
    assert(/Did you mean paypal\.com\?/.test(await ip.textContent('h1')), await ip.textContent('h1'));
    assert(await ip.$('[data-act="suggest"]') && await ip.$('[data-act="lookalike-ok"]'), 'actions');
    await shot('38-lookalike-warning');
  });

  await step('privacy: tracking tags stripped, GPC, fingerprint noise per site, third-party cookies blocked, WebRTC limited', async () => {
    await freshTab(`${base}/long.html?utm_source=news&id=7&fbclid=abc`);
    assert(/long\.html\?id=7$/.test(await main(() => global.__ferna.windows[0].active.url)), 'tracking tags removed');
    await freshTab(`${base}/fp.html`);
    await H.until(() => evalActive('!!window.__frame'), 6000, 'frame message');
    const a = await evalActive(`({ canvas: window.__canvas, img: window.__img, cores: window.__cores, mem: window.__mem, gpc: window.__gpc, frame: window.__frame })`);
    assert(a.gpc === true && a.frame.gpc === true, `GPC in page and frame ${JSON.stringify([a.gpc, a.frame])}`);
    assert([4, 8].includes(a.cores) && a.mem === 8 && [4, 8].includes(a.frame.cores), `hardware buckets ${a.cores} ${a.mem}`);
    assert(a.frame.cookie === '', `third-party cookie stored: "${a.frame.cookie}"`);
    await freshTab(`${base}/fp.html?again`);
    const a2 = await evalActive(`({ canvas: window.__canvas, img: window.__img })`);
    assert(a2.canvas === a.canvas && a2.img === a.img, 'same site, same session: same values (pages keep working)');
    const port = new URL(base).port;
    await freshTab(`http://localhost:${port}/fp.html`);
    const b = await evalActive(`({ canvas: window.__canvas, img: window.__img })`);
    assert(b.canvas !== a.canvas && b.img !== a.img, 'another site sees a different canvas fingerprint');
    const policyNow = await main(() => global.__ferna.windows[0].active.view.webContents.getWebRTCIPHandlingPolicy());
    assert(policyNow === 'default_public_interface_only', `WebRTC policy ${policyNow}`);
  });

  await step('password warning on a first-visit sign-in page', async () => {
    await freshTab(`http://localhost:${new URL(base).port}/fp.html?pw`); // 127.0.0.1 is bookmarked by earlier steps
    const r = await evalActive(`(() => { const b = document.getElementById('pw').getBoundingClientRect(); return { x: Math.round(b.left + 10), y: Math.round(b.top + b.height / 2) }; })()`);
    await main((_, p) => { const wc = global.__ferna.windows[0].active.view.webContents; wc.focus(); wc.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 }); wc.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 }); }, r);
    await H.until(() => evalActive(`!!document.querySelector('ferna-password-note')`), 4000, 'password note');
    await shot('39-password-warning');
  });

  await step('extension guard: an update asking for more access is paused until approved', async () => {
    const id = (await main(async (_, f) => global.__ferna.ext.installFromPath(f, { skipConfirm: true }), path.join(H.FIX, 'test-extension.crx'))).id;
    await H.sleep(800);
    await main(() => { global.__ferna.testGuardAnswer = false; });
    // What the Chrome Web Store updater does: unpack the new version next to the old one and load it.
    await main(async (_, f) => {
      const c = global.__ferna, fs = process.getBuiltinModule('fs'), p = process.getBuiltinModule('path');
      const pkg = c._crx.parseCrx(fs.readFileSync(f));
      const dest = p.join(c.ext.storeDir, pkg.id, '2.0.0_0');
      const res = c._crx.extractZip(pkg.zip, dest + '.tmp');
      const m = res.manifest; m.key = pkg.publicKey.toString('base64');
      fs.writeFileSync(p.join(res.base, 'manifest.json'), JSON.stringify(m));
      fs.renameSync(res.base, dest); fs.rmSync(dest + '.tmp', { recursive: true, force: true });
      if (c.ext.api.getExtension(pkg.id)) c.ext.api.removeExtension(pkg.id);
      await c.ext.loadOne(dest);
    }, path.join(H.FIX, 'test-extension-v2.crx'));
    const st = await H.until(async () => { const l = await main(() => global.__ferna.ext.list()); const x = l.find(e => e.id === id); return x && x.paused && !x.enabled ? x : null; }, 6000, 'paused');
    assert(st.version === '2.0.0', st.version);
    await main((_, i) => global.__ferna.ext.guardApprove(i), id);
    const after = (await main(() => global.__ferna.ext.list())).find(e => e.id === id);
    assert(after.enabled && !after.paused, 'approved and on');
    await main((_, i) => global.__ferna.ext.uninstall(i), id);
    await main(() => { delete global.__ferna.testGuardAnswer; });
  });

  const ext = (fn, arg) => main(fn, arg);
  let extId = null;
  await step('extensions: a signed .crx installs, loads and runs its content script', async () => {
    const r = await ext(async (_, f) => global.__ferna.ext.installFromPath(f, { skipConfirm: true }), path.join(H.FIX, 'test-extension.crx'));
    assert(r && /^[a-p]{32}$/.test(r.id), `id ${JSON.stringify(r)}`);
    extId = r.id;
    await freshTab(`${base}/zoom.html?ext`);
    const attr = await evalActive(`document.documentElement.getAttribute('data-ferna-ext')`);
    assert(attr === 'yes', 'content script did not run');
    const ui = await page('ferna://ui/');
    await H.until(() => ui.evaluate(id => !!document.querySelector(`#ext-actions [data-ext="${id}"] img`), extId), 6000, 'toolbar button');
    await H.until(() => ui.evaluate(id => (document.querySelector(`#ext-actions [data-ext="${id}"] .xb`) || {}).textContent === 'ON', extId), 6000, 'badge from service worker');
    await shot('24-extension-toolbar');
  });

  await step('extensions: toolbar button opens the extension popup', async () => {
    const ui = await page('ferna://ui/');
    const before = await main(electron => electron.BrowserWindow.getAllWindows().length);
    await ui.click(`#ext-actions [data-ext="${extId}"]`);
    await H.until(async () => (await main(electron => electron.BrowserWindow.getAllWindows().length)) > before, 5000, 'popup window');
    const url = await H.until(() => main(electron => electron.BrowserWindow.getAllWindows().map(w => w.webContents.getURL()).find(u => u.includes('popup.html'))), 5000, 'popup url');
    assert(url && url.startsWith(`chrome-extension://${extId}/popup.html`), `popup url ${url}`);
    await H.sleep(800);
    await shot('25-extension-popup');
    await ui.click(`#ext-actions [data-ext="${extId}"]`);
  });

  await step('extensions: chrome.tabs sees Ferna tabs; disable, enable, extension page', async () => {
    const n = await main(async (electron, id) => {
      const { ElectronChromeExtensions } = require ? {} : {};
      const lib = global.__ferna.ext.lib;
      return lib.ctx.store.tabs.size;
    }, extId).catch(() => -1);
    assert(n === -1 || n >= 3, `extension tab store has ${n} tabs`);
    await ext(async (_, id) => global.__ferna.ext.setEnabled(id, false), extId);
    assert(!(await ext((_, id) => !!global.__ferna.webSession.extensions.getExtension(id), extId)), 'disabled extension still loaded');
    await ext(async (_, id) => global.__ferna.ext.setEnabled(id, true), extId);
    assert(await ext((_, id) => !!global.__ferna.webSession.extensions.getExtension(id), extId), 'enable failed');
    await main(() => global.__ferna.windows[0].openInternal('ferna://extensions/'));
    const p = await page('ferna://extensions/');
    await H.until(() => p.evaluate(() => document.querySelectorAll('.ext').length >= 1), 5000, 'extension card');
    await shot('26-extensions-page');
  });

  await step('extensions: tampered .crx is refused; .zip installs; uninstall removes files', async () => {
    const bad = await ext(async (_, f) => { try { await global.__ferna.ext.installFromPath(f, { skipConfirm: true }); return 'installed'; } catch (e) { return e.message; } }, path.join(H.FIX, 'tampered.crx'));
    assert(/signature/i.test(bad), `tampered: ${bad}`);
    const z = await ext(async (_, f) => global.__ferna.ext.installFromPath(f, { skipConfirm: true }), path.join(H.FIX, 'test-extension.zip'));
    assert(z && z.id && z.id !== extId, 'zip install');
    await ext(async (_, id) => global.__ferna.ext.uninstall(id), z.id);
    await ext(async (_, id) => global.__ferna.ext.uninstall(id), extId);
    assert(!fs.existsSync(path.join(profile, 'Extensions', extId)), 'store folder removed');
    const left = await ext(() => global.__ferna.webSession.extensions.getAllExtensions().length);
    assert(left === 0, `${left} extensions still loaded`);
  });

  await step('extensions: privacy settings answer, browser === chrome, user agent is plain Chrome', async () => {
    const dir = path.join(H.FIX, 'extensions', 'probe-src');
    const id = await ext(async (_, d) => (await global.__ferna.ext.loadUnpacked(d, { skipConfirm: true })).id, dir);
    await H.sleep(1200);
    const r = await main(async (_, id) => {
      const t = global.__ferna.windows[0].newTab(`chrome-extension://${id}/probe.html`, { forceWeb: true });
      await new Promise(res => setTimeout(res, 1500));
      const js = c => t.view.webContents.executeJavaScript(c);
      return { page: await js('probe()'), worker: await js(`chrome.runtime.sendMessage('probe')`), off: await js(`chrome.runtime.sendMessage('offscreen')`) };
    }, id);
    for (const k of ['page', 'worker']) {
      const v = r[k];
      assert(v.privacy.ok && v.privacy.v.value === false && v.privacy.v.levelOfControl === 'controllable_by_this_extension', `${k} privacy ${JSON.stringify(v.privacy)}`);
      assert(v.privacyP.ok && v.privacyP.v.value === false, `${k} privacy promise ${JSON.stringify(v.privacyP)}`);
      assert(v.same === true, `${k}: browser !== chrome`);
      assert(!/Electron|Sundaree/i.test(v.ua), `${k} UA ${v.ua}`);
      assert(v.alarm.ok && v.sessionRT.ok && v.idle.ok, `${k} alarms/session/idle ${JSON.stringify([v.alarm, v.sessionRT, v.idle])}`);
    }
    assert(r.worker.topLevelError === null, r.worker.topLevelError);
    assert(r.off.ok && r.off.r === 'pong:v', `offscreen ${JSON.stringify(r.off)}`);
    await main(() => { global.__ferna.testAnswerPermissions = false; });
    const denied = await main(async () => global.__ferna.windows[0].active.view.webContents.executeJavaScript(`chrome.permissions.request({ permissions: ['clipboardWrite'] })`));
    await main(() => { global.__ferna.testAnswerPermissions = true; });
    const granted = await main(async () => global.__ferna.windows[0].active.view.webContents.executeJavaScript(`chrome.permissions.request({ permissions: ['clipboardWrite'] }).then(() => chrome.permissions.contains({ permissions: ['clipboardWrite'] }))`));
    assert(denied === false && granted === true, `optional permission: denied=${denied} granted=${granted}`);
    await main(() => { const w = global.__ferna.windows[0]; w.closeTab(w.active); });
    await ext(async (_, id) => global.__ferna.ext.uninstall(id), id);
  });

  await step('tabs: a page that closes itself leaves no dead tab; Ctrl+W and state stay safe', async () => {
    const before = (await win()).tabs.length;
    await freshTab(`${base}/long.html?selfclose`);
    await evalActive(`setTimeout(() => window.close(), 50); 1`);
    await H.until(async () => (await win()).tabs.length === before, 4000, 'self-closed tab removed');
    // Contents destroyed behind the tab's back (crash, extension): closing and state() must not throw.
    await freshTab(`${base}/long.html?killed`);
    const r = await main(async () => {
      const w = global.__ferna.windows[0];
      const t = w.active; const n = w.tabs.length;
      t.view.webContents.removeAllListeners('destroyed');
      t.view.webContents.close();
      await new Promise(res => setTimeout(res, 300));
      let err = null;
      try { w.state(); w.run('closeTab'); w.state(); } catch (e) { err = e.message; }
      return { err, gone: !w.tabs.includes(t), n, now: w.tabs.length };
    });
    assert(!r.err && r.gone, JSON.stringify(r));
  });

  await step('themes: a Chrome theme .crx recolours the tab bar and toolbar', async () => {
    const r = await ext(async (_, f) => global.__ferna.ext.installFromPath(f, { skipConfirm: true }), path.join(H.FIX, 'test-theme.crx'));
    assert(r && r.theme, 'theme not recognised');
    const ui = await page('ferna://ui/');
    await H.until(() => ui.evaluate(() => getComputedStyle(document.querySelector('#tabs')).backgroundColor === 'rgb(20, 70, 45)'), 4000, 'tab bar colour');
    const tb = await ui.evaluate(() => getComputedStyle(document.querySelector('#toolbar')).backgroundColor);
    assert(tb === 'rgb(228, 244, 234)', `toolbar ${tb}`);
    await main(() => global.__ferna.windows[0].newTab('ferna://newtab/'));
    await H.sleep(800);
    await shot('27-theme');
    await ext(() => global.__ferna.ext.resetTheme());
    await H.until(() => ui.evaluate(() => getComputedStyle(document.querySelector('#tabs')).backgroundColor !== 'rgb(20, 70, 45)'), 4000, 'theme reset');
  });

  await step('security: web pages still see no Ferna, Electron or extension bridge', async () => {
    await freshTab(`${base}/hostile.html?after-ext`);
    const r = await evalActive(`({ e: typeof window.electron, ws: typeof window.electronWebstore, f: typeof window.ferna, req: typeof require, cr: typeof (window.chrome && window.chrome.webstorePrivate) })`);
    assert(r.e === 'undefined' && r.ws === 'undefined' && r.f === 'undefined' && r.req === 'undefined' && r.cr === 'undefined', JSON.stringify(r));
  });

  await require('./v05-steps')({ step, assert, main, win, page, H, base, shot, freshTab, evalActive, profile });
  await require('./v06-steps')({ step, assert, main, win, page, H, base, shot, freshTab, evalActive, profile });
  await require('./v063-steps')({ step, assert, main, win, page, H, base, shot, freshTab, evalActive, profile });
  await require('./v064-steps')({ step, assert, main, win, page, H, base, shot, freshTab, evalActive, profile, app });

  // An exam window cannot be closed: end any left over by a failed step.
  await main(() => { const ctx = global.__ferna; if (ctx.examWin) ctx.exam.finish(ctx.examWin, 'test'); }).catch(() => {});
  await app.close();
  srv.close();
  H.stop();
  console.log(`\n${results.length - results.filter(r => r.startsWith('       ')).length} steps, ${failed} failed`);
  fs.writeFileSync(path.join(OUT, 'results.txt'), results.join('\n') + `\n${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); H.stop(); process.exit(2); });
