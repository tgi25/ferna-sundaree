'use strict';
// End-to-end steps for 0.5: bookmark manager, split view, link preview, sleeping tabs, task
// manager, media controls, auto PiP, password manager and autofill, reading mode, read aloud,
// AI assistant (against a mock Ollama), translation, separate logins, Group Policy, sync, app windows.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

module.exports = async function v05({ step, assert, main, win, page, H, base, shot, freshTab, evalActive, profile }) {
  const iso = (world, code) => main((_, a) => global.__ferna.windows[0].active.view.webContents.executeJavaScriptInIsolatedWorld(a.world, [{ code: a.code }]), { world, code });
  const send = events => main((_, evs) => { const wc = global.__ferna.windows[0].active.view.webContents; for (const e of evs) wc.sendInputEvent(e); }, events);
  const typeText = text => send([...text].map(ch => ({ type: 'char', keyCode: ch })));
  const clickAt = (x, y, mods = []) => send([{ type: 'mouseDown', x, y, button: 'left', clickCount: 1, modifiers: mods }, { type: 'mouseUp', x, y, button: 'left', clickCount: 1, modifiers: mods }]);
  const rectOf = sel => evalActive(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), left: r.left, top: r.top, bottom: r.bottom }; })()`);

  // ---------------------------------------------------------------- bookmark manager
  await step('0.5 bookmarks: select all, delete with count confirmation, Undo restores', async () => {
    await main((_, b) => {
      const ctx = global.__ferna;
      const r = ctx.bookmarkOp('folder', { parent: 'other', title: 'Manager test' });
      const f = r.items.find(n => n.title === 'Manager test');
      for (let i = 0; i < 6; i++) ctx.bookmarkOp('add', { parent: f.id, url: `${b}/long.html?m=${i}`, title: `Manager item ${i}` });
      ctx.bookmarkOp('add', { parent: f.id, url: `${b}/long.html?m=0`, title: 'Manager item 0 copy' });
      ctx.bookmarkOp('add', { parent: f.id, url: `${b}/missing-page.html`, title: 'Broken one' });
    }, base);
    await main(() => global.__ferna.windows[0].openInternal('ferna://bookmarks/'));
    const p = await page('ferna://bookmarks/');
    p.on('pageerror', e => console.log('    bookmarks page error:', e.message));
    await H.until(() => p.evaluate(() => [...document.querySelectorAll('#folders .node')].some(n => n.textContent.includes('Manager test'))), 6000, 'folder in tree');
    await p.evaluate(() => [...document.querySelectorAll('#folders .node')].find(n => n.textContent.includes('Manager test')).click());
    await H.until(() => p.evaluate(() => document.querySelectorAll('#list .bmrow').length === 8), 4000, '8 rows');
    await p.click('#sel-all');
    assert((await p.textContent('#sel-count')).startsWith('8 selected'), await p.textContent('#sel-count'));
    await p.click('#a-delete');
    const msg = await p.textContent('#modal');
    assert(msg.includes('Are you sure you want to delete 8 bookmarks?'), msg);
    await shot('v05-01-bookmarks-confirm');
    await p.click('#m-ok');
    await H.until(() => p.evaluate(() => !document.querySelector('#toast').hidden && document.querySelector('#toast').textContent.includes('Deleted 8 bookmarks')), 4000, 'toast');
    const left = await main(() => global.__ferna.bookmarks.data.items.filter(n => /Manager item|Broken one/.test(n.title)).length);
    assert(left === 0, `left ${left}`);
    await p.click('#t-undo');
    await H.until(async () => (await main(() => global.__ferna.bookmarks.data.items.filter(n => /Manager item|Broken one/.test(n.title)).length)) === 8, 4000, 'undo restored');
  });

  await step('0.5 bookmarks: bulk tags, duplicates merged, broken link found and purged', async () => {
    const p = await page('ferna://bookmarks/');
    await H.until(() => p.evaluate(() => document.querySelectorAll('#list .bmrow').length === 8), 4000, 'rows back');
    // tag the first two
    await p.evaluate(() => { const rows = document.querySelectorAll('#list .bmrow input[type=checkbox]'); rows[0].click(); rows[1].click(); });
    await p.click('#a-tag');
    await p.fill('#m-add', 'exam, ml');
    await p.click('#m-ok');
    await H.until(() => p.evaluate(() => [...document.querySelectorAll('#tags .tagchip')].map(x => x.dataset.tag).join(',').includes('exam')), 4000, 'tag chip');
    const tagged = await main(() => global.__ferna.bookmarks.data.items.filter(n => (n.tags || []).includes('exam')).length);
    assert(tagged === 2, `tagged ${tagged}`);
    // duplicates
    await p.click('[data-smart=dupes]');
    await H.until(() => p.evaluate(() => !!document.querySelector('#merge-all')), 4000, 'dupes view');
    await shot('v05-02-duplicates');
    await p.click('#merge-all');
    await H.until(async () => (await main(() => global.__ferna.bookmarks.data.items.filter(n => /Manager item 0/.test(n.title)).length)) === 1, 4000, 'merged');
    // broken links
    await p.click('#b-check');
    await H.until(async () => (await main(() => global.__ferna.bookmarks.data.items.filter(n => n.check && n.check.s === 'dead').length)) >= 1, 20000, 'dead link detected');
    const ok = await main(() => global.__ferna.bookmarks.data.items.filter(n => /Manager item/.test(n.title) && n.check && n.check.s === 'ok').length);
    assert(ok >= 5, `ok ${ok}`);
    await H.sleep(1500);
    await p.click('[data-smart=dead]');
    await H.until(() => p.evaluate(() => !!document.querySelector('#purge')), 4000, 'purge button');
    await shot('v05-03-broken-links');
    await p.click('#purge');
    await p.click('#m-ok');
    await H.until(async () => !(await main(() => global.__ferna.bookmarks.data.items.some(n => n.title === 'Broken one'))), 4000, 'purged');
  });

  await step('0.5 bookmarks: export selection as JSON, Firefox import, backup file, reading list', async () => {
    const p = await page('ferna://bookmarks/');
    const ids = await main(() => global.__ferna.bookmarks.data.items.filter(n => (n.tags || []).includes('exam')).map(n => n.id));
    const json = JSON.parse(await p.evaluate(ids => window.ferna.cmd('bm:export-sel', ids, 'json'), ids));
    assert(json.format === 'ferna-bookmarks' && json.items.filter(n => n.url).length === 2 && json.items.some(n => n.title === 'Manager test'), 'export selection');
    const ff = { type: 'text/x-moz-place-container', children: [{ type: 'text/x-moz-place-container', root: 'toolbarFolder', children: [{ type: 'text/x-moz-place', title: 'From Firefox', uri: 'https://ff.example/' }] }] };
    const r = await p.evaluate(t => window.ferna.cmd('bm:import-any', t), JSON.stringify(ff));
    assert(r.ok && r.added === 1 && r.kind === 'Firefox', JSON.stringify(r));
    const b = await p.evaluate(() => window.ferna.cmd('bm:backup-now'));
    assert(fs.existsSync(path.join(profile, 'bookmark-backups', b.name)), 'backup written');
    const back = JSON.parse(fs.readFileSync(path.join(profile, 'bookmark-backups', b.name), 'utf8'));
    assert(back.items.some(n => n.title === 'From Firefox'), 'backup content');
    await freshTab(`${base}/article.html`);
    await main(() => global.__ferna.windows[0].run('addToReadingList'));
    const rl = await main(() => global.__ferna.bookmarks.data.items.filter(n => n.folder === 'reading').map(n => n.title));
    assert(rl.includes('Swarm intelligence explained'), JSON.stringify(rl));
  });

  // ---------------------------------------------------------------- tabs
  await step('0.5 split view: two tabs side by side, resizable, other half becomes active, exit', async () => {
    await freshTab(`${base}/long.html?split-left`);
    await freshTab(`${base}/article.html?split-right`);
    const r = await main(() => {
      const w = global.__ferna.windows[0];
      const right = w.active;
      const left = w.tabs[w.tabs.indexOf(right) - 1];
      w.splitWith(left, right);
      return { a: left.view.getBounds(), b: right.view.getBounds(), content: w.layoutState().content, active: w.activeId, left: left.id };
    });
    assert(r.a.x === r.content.x && r.b.x > r.a.x + r.a.width && Math.abs(r.a.width - r.b.width) <= 1 && r.a.height === r.b.height, JSON.stringify(r));
    const ui = await page('ferna://ui/');
    await H.until(() => ui.evaluate(() => !document.querySelector('#split-divider').hidden), 3000, 'divider shown');
    await shot('v05-04-split-view');
    const r2 = await main(() => { const w = global.__ferna.windows[0]; w.setSplitRatio(0.3); const l = w.tabs.find(t => t.id === w.split.a); const rt = w.tabs.find(t => t.id === w.split.b); rt.view.webContents.emit('focus'); return { a: l.view.getBounds().width, b: rt.view.getBounds().width, active: w.activeId, right: rt.id }; });
    assert(r2.a < r2.b && r2.active === r2.right, JSON.stringify(r2));
    const r3 = await main(() => { const w = global.__ferna.windows[0]; w.run('splitView'); return { split: w.split, w: w.active.view.getBounds().width, cw: w.layoutState().content.width }; });
    assert(!r3.split && r3.w === r3.cw, JSON.stringify(r3));
    await main(() => global.__ferna.settings.set('splitRatio', 0.5));
  });

  await step('0.5 link preview: Shift+click opens a floating preview; Open in tab keeps it', async () => {
    await freshTab(`${base}/article.html?peek`);
    const a = await rectOf('nav a');
    await clickAt(a.x, a.y, ['shift']);
    await H.until(async () => (await win()).overlay === 'peek', 4000, 'peek opened');
    const pk = await main(() => { const w = global.__ferna.windows[0]; return { b: w.peek.view.getBounds(), c: w.layoutState().content }; });
    assert(pk.b.width < pk.c.width && pk.b.y > pk.c.y, JSON.stringify(pk));
    await H.sleep(600);
    await shot('v05-05-link-preview');
    const n = (await win()).tabs.length;
    await main(() => global.__ferna.windows[0].peekOpenAs('tab'));
    await H.until(async () => { const s = await win(); return s.overlay === null && s.tabs.length === n + 1; }, 4000, 'kept as tab');
  });

  await step('0.5 sleeping tabs: an idle tab is unloaded and reloads when opened; task manager lists tabs', async () => {
    await freshTab(`${base}/long.html?sleepy`);
    const id = await main(() => global.__ferna.windows[0].active.id);
    await freshTab(`${base}/long.html?awake`);
    const r = await main((_, tid) => { const w = global.__ferna.windows[0]; const t = w.tabs.find(x => x.id === tid); t.lastActive = Date.now() - 3 * 3600000; const n = w.sleepIdleTabs(); return { n, view: !!t.view, state: w.state().tabs.find(x => x.id === tid).sleeping }; }, id);
    assert(r.n >= 1 && !r.view && r.state, JSON.stringify(r));
    await main((_, tid) => { const w = global.__ferna.windows[0]; w.activate(w.tabs.find(x => x.id === tid)); }, id);
    await H.until(async () => (await evalActive('location.search')) === '?sleepy', 6000, 'woke up');
    await main(() => global.__ferna.windows[0].run('taskManager'));
    const tp = await page('ferna://tasks/');
    await H.until(() => tp.evaluate(() => document.querySelectorAll('#tabs tr').length >= 3 && /MB|GB/.test(document.querySelector('#sum').textContent)), 6000, 'task rows');
    await shot('v05-06-task-manager');
  });

  await step('0.5 media: controls list what plays and pause it; video goes to PiP when you switch tabs', async () => {
    await freshTab(`${base}/video.html`);
    await main(() => global.__ferna.windows[0].active.view.webContents.executeJavaScript(`(() => { const v = document.querySelector('video'); v.loop = true; v.muted = false; return v.play().then(() => true); })()`, true));
    await H.until(() => main(() => global.__ferna.windows[0].active.hasVideo), 6000, 'media playing');
    await main(() => global.__ferna.windows[0].openMediaPanel());
    const ov = await page('ferna://overlay/');
    await H.until(() => ov.evaluate(() => document.querySelectorAll('.media-item').length >= 1), 5000, 'media item');
    await shot('v05-07-media-controls');
    const tid = await main(() => global.__ferna.windows[0].active.id);
    await H.until(() => ov.evaluate(t => !!document.querySelector(`.media-item[data-t="${t}"]`), tid), 4000, 'this tab listed');
    await ov.click(`.media-item[data-t="${tid}"] [data-a=toggle]`);
    await H.until(async () => (await evalActive(`document.querySelector('video').paused`)) === true, 3000, 'paused from panel');
    await main(() => global.__ferna.windows[0].closeOverlay());
    await main(() => global.__ferna.windows[0].active.view.webContents.executeJavaScript(`document.querySelector('video').play().then(() => true)`, true));
    const vid = await main(() => { const w = global.__ferna.windows[0]; const t = w.active; t.audible = true; const other = w.tabs.find(x => x !== t && x.kind === 'web'); w.activate(other); return t.id; });
    await H.until(() => main((_, id) => global.__ferna.windows[0].tabs.find(t => t.id === id).pipOn, vid), 5000, 'auto PiP on leave');
    await main((_, id) => { const w = global.__ferna.windows[0]; w.activate(w.tabs.find(t => t.id === id)); }, vid);
    await H.until(() => main((_, id) => !global.__ferna.windows[0].tabs.find(t => t.id === id).pipOn, vid), 5000, 'PiP back on return');
    await evalActive(`document.querySelector('video').pause(); 1`);
  });

  // ---------------------------------------------------------------- passwords
  await step('0.5 passwords: sign-in is captured, saved from the bubble, offered and filled on return', async () => {
    await freshTab(`${base}/login.html`);
    await H.until(async () => !!(await iso(7791, 'window.__fpw && window.__fpw.attached ? 1 : 0')), 6000, 'password manager attached');
    await evalActive(`document.getElementById('u').focus(); 1`);
    await typeText('teacher@sjp.ac.lk');
    await evalActive(`document.getElementById('p').focus(); 1`);
    await typeText('Correct-Horse-42');
    await send([{ type: 'keyDown', keyCode: 'Return' }, { type: 'char', keyCode: '\r' }, { type: 'keyUp', keyCode: 'Return' }]);
    await H.until(async () => (await win()).overlay === 'pwsave', 6000, 'save bubble');
    const ov = await page('ferna://overlay/');
    await H.until(() => ov.evaluate(() => !!document.querySelector('#pw-u')), 3000, 'bubble drawn');
    assert((await ov.inputValue('#pw-u')) === 'teacher@sjp.ac.lk', 'username in bubble');
    await shot('v05-08-save-password');
    await ov.click('[data-a=save]');
    const saved = await main(() => global.__ferna.passwords.vault.data.logins.map(l => [l.origin, l.username, l.password]));
    assert(saved.length === 1 && saved[0][1] === 'teacher@sjp.ac.lk' && saved[0][2] === 'Correct-Horse-42', JSON.stringify(saved));
    // Back on the sign-in page: a real click on the field shows the list; a real click fills.
    await main(() => global.__ferna.windows[0].navigateActive(global.__ferna.windows[0].active.url.replace(/login-done\.html.*$/, 'login.html')));
    await H.until(async () => (await evalActive('location.pathname')) === '/login.html' && !!(await iso(7791, 'window.__fpw && window.__fpw.resolve ? 1 : 0')), 6000, 'back on login');
    await H.until(() => main(() => global.__ferna.windows[0].active.pwCount === 1), 3000, 'key icon count');
    const pr = await rectOf('#p');
    await clickAt(pr.x, pr.y);
    await H.until(async () => !!(await evalActive(`!!document.querySelector('ferna-autofill')`)), 3000, 'account list shown');
    await shot('v05-09-autofill-list');
    await clickAt(Math.round(pr.left + 30), Math.round(pr.bottom + 4 + 34));
    await H.until(async () => (await evalActive(`document.getElementById('p').value`)) === 'Correct-Horse-42', 3000, 'filled by click');
    assert((await evalActive(`document.getElementById('u').value`)) === 'teacher@sjp.ac.lk', 'username filled');
  });

  await step('0.5 passwords: strong password suggested for a new account; address filled; passwords page', async () => {
    await evalActive(`document.getElementById('np1').focus(); 1`);
    await main(() => { const w = global.__ferna.windows[0]; return global.__ferna.passwords.fillGenerated(w, w.active); });
    const v = await evalActive(`[document.getElementById('np1').value, document.getElementById('np2').value]`);
    assert(v[0].length === 16 && v[0] === v[1], JSON.stringify(v));
    await main(() => { const v = global.__ferna.passwords.vault.data; v.addresses.push({ id: 'a1', given: 'Kamal', city: 'Nugegoda', postal: '10250' }); });
    await iso(7791, `(() => { window.__fpw.target = document.getElementById('fn'); return 1; })()`);
    const code = require('../../src/main/pagefx/pwfill').FILL_FIELDS('address', { given: 'Kamal', city: 'Nugegoda', postal: '10250' });
    const n = await iso(7791, code);
    const vals = await evalActive(`[fn.value, city.value, zip.value]`);
    assert(n === 3 && vals.join('|') === 'Kamal|Nugegoda|10250', JSON.stringify([n, vals]));
    await main(() => { global.__ferna.testVerify = () => true; global.__ferna.windows[0].run('passwords'); });
    const pp = await page('ferna://passwords/');
    await H.until(() => pp.evaluate(() => document.querySelectorAll('#t-logins tbody tr').length === 1), 5000, 'row on passwords page');
    await pp.click('[data-a=show]');
    await H.until(() => pp.evaluate(() => document.querySelector('.pw').textContent === 'Correct-Horse-42'), 3000, 'revealed after verification');
    await shot('v05-10-passwords-page');
  });

  // ---------------------------------------------------------------- reading
  await step('0.5 reading mode shows the article over the page; read aloud bar for a selection', async () => {
    await freshTab(`${base}/article.html?reader`);
    await main(() => global.__ferna.windows[0].run('readerMode'));
    await H.until(async () => !!(await evalActive(`!!document.querySelector('ferna-reader')`)), 5000, 'reader open');
    await H.until(() => main(() => global.__ferna.windows[0].active.readerOn), 3000, 'readerOn');
    await shot('v05-11-reading-mode');
    await main(() => global.__ferna.windows[0].run('readerMode'));
    await H.until(async () => !(await evalActive(`!!document.querySelector('ferna-reader')`)), 5000, 'reader closed');
    await main(() => { const w = global.__ferna.windows[0]; global.__ferna.pageFx.readAloud(w, w.active, 'Particle swarm optimisation. Ant colony optimisation.'); });
    await H.until(async () => (await evalActive(`(() => { const h = document.querySelector('ferna-reader'); return h ? h.style.cssText : ''; })()`)).includes('bottom'), 5000, 'read-aloud bar');
    await iso(7792, require('../../src/main/pagefx/reader').CLOSE);
  });

  await step('0.5 AI assistant: side panel answers from the page through a local (mock Ollama) model', async () => {
    let lastBody = null;
    const mock = http.createServer((req, res) => {
      if (req.url === '/api/tags') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ models: [{ name: 'mock-model' }] })); return; }
      let b = '';
      req.on('data', c => { b += c; });
      req.on('end', () => {
        lastBody = JSON.parse(b || '{}');
        const sys = (lastBody.messages || [])[0] ? lastBody.messages[0].content : '';
        const t = /<page title="([^"]*)"/.exec(sys);
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        res.write(JSON.stringify({ message: { content: 'This page is about ' } }) + '\n');
        setTimeout(() => { res.write(JSON.stringify({ message: { content: t ? t[1] : 'nothing' } }) + '\n'); res.end(JSON.stringify({ done: true }) + '\n'); }, 100);
      });
    });
    await new Promise(r => mock.listen(0, '127.0.0.1', r));
    const ep = `http://127.0.0.1:${mock.address().port}`;
    await main((_, e) => global.__ferna.settings.set('assistant', { provider: 'ollama', endpoint: e, model: 'mock-model', skills: [] }), ep);
    const before = await main(() => global.__ferna.windows[0].active.view.getBounds().width);
    await main(() => global.__ferna.windows[0].run('assistant'));
    const ap = await page('ferna://assistant/');
    await H.until(async () => (await main(() => global.__ferna.windows[0].active.view.getBounds().width)) < before - 250, 4000, 'page narrower');
    await H.until(() => ap.evaluate(() => document.querySelector('#model').textContent === 'mock-model'), 4000, 'model shown');
    await ap.fill('#input', 'What is this page about?');
    await ap.press('#input', 'Enter');
    await H.until(() => ap.evaluate(() => { const m = [...document.querySelectorAll('.msg.assistant')].pop(); return m && m.textContent.includes('Swarm intelligence explained'); }), 10000, 'streamed answer');
    assert(lastBody && lastBody.model === 'mock-model' && lastBody.messages[0].content.includes('Particle swarm optimisation') && lastBody.messages[1].content === 'What is this page about?', 'page text sent as context');
    await shot('v05-12-assistant');
    const models = await ap.evaluate(e => window.ferna.cmd('ai:models', 'ollama', e), ep);
    assert(models.ok && models.models[0] === 'mock-model', JSON.stringify(models));
    await main(() => global.__ferna.windows[0].run('assistant'));
    await H.until(async () => (await main(() => global.__ferna.windows[0].side)) === null, 3000, 'panel closed');
    mock.close();
  });

  await step('0.5 translate: page goes through Google Translate when chosen', async () => {
    await main(() => global.__ferna.settings.set('translateService', 'google'));
    await main(() => global.__ferna.windows[0].run('translatePage'));
    await H.until(async () => decodeURIComponent(await main(() => global.__ferna.windows[0].active.url)).includes('translate.google.com/translate?sl=auto&tl=en'), 8000, 'translate url');
    await main(() => global.__ferna.settings.set('translateService', ''));
  });

  // ---------------------------------------------------------------- identities
  await step('0.5 separate logins: a workspace tab has its own cookie jar', async () => {
    const id = await main(() => { const ctx = global.__ferna; const w = ctx.createWorkspace('Uni login'); ctx.setWorkspaceSeparate(w.id, true); return w.id; });
    await main((_, a) => global.__ferna.windows[0].newTab(`${a.base}/long.html?container`, { wsOverride: a.id }), { base, id });
    await H.until(async () => (await evalActive('document.readyState')) === 'complete', 6000, 'container tab');
    await evalActive(`document.cookie = 'who=container; path=/'; 1`);
    const r = await main(async () => {
      const ctx = global.__ferna; const w = ctx.windows[0]; const t = w.active;
      const ses = t.view.webContents.session;
      const url = t.url;
      const inC = await ses.cookies.get({ url });
      const inD = await ctx.webSession.cookies.get({ url });
      return { separate: ses !== ctx.webSession, inC: inC.map(c => c.name), inD: inD.map(c => c.name), badge: w.state().nav.container };
    });
    assert(r.separate && r.inC.includes('who') && !r.inD.includes('who') && r.badge && r.badge.name === 'Uni login', JSON.stringify(r));
    await shot('v05-13-separate-logins');
    await main((_, wsId) => { const ctx = global.__ferna; const w = ctx.windows[0]; w.closeTab(w.active); ctx.deleteWorkspace(wsId); }, id);
  });

  await step('0.5 Group Policy: a managed setting is locked; a turned-off feature does not open', async () => {
    const r = await main(() => ({ locked: global.__ferna.policyLocked('popupBlocker'), tor: global.__ferna.policyAllows('TorWindowsAllowed'), n: global.__ferna.windows.length }));
    assert(r.locked && r.tor === false, JSON.stringify(r));
    await main(() => global.__ferna.windows[0].openInternal('ferna://settings/'));
    const sp = await page('ferna://settings/');
    const rej = await sp.evaluate(() => window.ferna.cmd('settings:set', 'popupBlocker', false).then(() => 'accepted', e => String(e.message)));
    assert(/managed by your organisation/.test(rej), rej);
    await H.until(() => sp.evaluate(() => !document.querySelector('#policy-banner').hidden && document.querySelector('[data-k=popupBlocker]').disabled), 4000, 'banner and greyed out');
    await main(() => global.__ferna.windows[0].run('torWindow'));
    await H.sleep(500);
    assert((await main(() => global.__ferna.windows.length)) === r.n, 'no Tor window');
  });

  await step('0.5 sync: encrypted file in a folder; a change from another PC arrives; deletions travel', async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ferna-sync-'));
    fs.chmodSync(folder, 0o777);
    const r = await main((_, f) => global.__ferna.sync.setup(f, 'correct horse battery staple', { passwords: true }), folder);
    assert(r.ok, JSON.stringify(r));
    const file = path.join(folder, 'FernaSundaree', 'ferna-sundaree.fsync');
    const text = fs.readFileSync(file, 'utf8');
    assert(!text.includes('Manager item') && !text.includes('teacher@sjp.ac.lk'), 'file is encrypted');
    const SC = require('../../src/main/synccore');
    const key = SC.deriveKey('correct horse battery staple', SC.header(text).salt);
    const data = SC.open(text, key);
    const localCount = await main(() => global.__ferna.bookmarks.data.items.length);
    assert(data.logins.length === 1 && data.bookmarks.length === localCount, `content synced ${data.logins.length} ${data.bookmarks.length}/${localCount}`);
    await main(() => global.__ferna.bookmarkOp('add', { parent: 'other', url: 'https://local.example/', title: 'Delete me later' }));
    await main(() => global.__ferna.sync.run());
    const data2 = SC.open(fs.readFileSync(file, 'utf8'), key);
    data2.bookmarks.push({ id: 'remote-1', url: 'https://laptop.example/', title: 'Added on my laptop', folder: 'other', ts: Date.now() });
    fs.writeFileSync(file, SC.seal(data2, key, SC.header(text).salt));
    await main(() => global.__ferna.sync.run());
    assert(await main(() => global.__ferna.bookmarks.data.items.some(b => b.id === 'remote-1')), 'remote bookmark arrived');
    await main(() => { const ctx = global.__ferna; ctx.bookmarkOp('delete', { id: ctx.bookmarks.data.items.find(n => n.title === 'Delete me later').id }); });
    await main(() => global.__ferna.sync.run());
    const after = SC.open(fs.readFileSync(file, 'utf8'), key);
    assert(!after.bookmarks.some(b => b.title === 'Delete me later') && after.bookmarks.some(b => b.id === 'remote-1'), 'deletion synced');
    await main(() => global.__ferna.sync.disable());
  });

  await step('0.5 installed app window: no tabs, one slim bar, links to other sites go to the browser', async () => {
    const n = await main(() => global.__ferna.windows.length);
    await main((_, u) => global.__ferna.openAppWindow(u, 'Test app'), `${base}/long.html?app`);
    await H.until(async () => (await main(() => global.__ferna.windows.length)) === n + 1, 4000, 'app window');
    const r = await main(() => { const w = global.__ferna.windows[global.__ferna.windows.length - 1]; const L = w.layoutState(); return { app: !!w.appMode, tabs: L.tabs, controls: L.windowControls, y: L.content.y }; });
    assert(r.app && r.tabs === null && r.controls === 'toolbar' && r.y === 44, JSON.stringify(r));
    await H.sleep(800);
    await shot('v05-14-app-window');
    await main(() => { const w = global.__ferna.windows[global.__ferna.windows.length - 1]; w.win.close(); });
    await H.until(async () => (await main(() => global.__ferna.windows.length)) === n, 4000, 'app closed');
  });

  await step('0.5 security: new internal pages are not reachable from the web; page sees no Ferna globals', async () => {
    await freshTab(`${base}/hostile.html?v05`);
    const r = await evalActive(`({ f: typeof window.ferna, fpw: typeof window.__fpw, frd: typeof window.__frd })`);
    assert(r.f === 'undefined' && r.fpw === 'undefined' && r.frd === 'undefined', JSON.stringify(r));
    // A page asking for a Ferna action without a click is ignored.
    const before = await main(() => global.__ferna.windows[0].side);
    await evalActive(`window.open('https://ferna-action.invalid/ask?t=hi'); 1`);
    await H.sleep(600);
    assert((await main(() => global.__ferna.windows[0].side)) === before, 'assistant not opened by a script');
  });
};
