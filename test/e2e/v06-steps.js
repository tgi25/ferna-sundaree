'use strict';
// End-to-end steps for 0.6: equalizer genres and saved presets, toolbar contrast, workspace and
// adaptive colours, scheduled dark mode, parental controls, Secure Exam Mode.

const fs = require('fs');
const path = require('path');

module.exports = async function v06({ step, assert, main, win, page, H, base, shot, freshTab, evalActive, profile }) {
  const ui = () => page('ferna://ui/');

  await step('0.6 equalizer: new genres listed; save, use and delete your own preset', async () => {
    await freshTab(`${base}/video.html?eq6`);
    await main(() => global.__ferna.windows[0].openEqPanel());
    const ov = await page('ferna://overlay/');
    await H.until(() => ov.evaluate(() => !!document.querySelector('[data-preset=baila]') && !!document.querySelector('[data-preset=reggae]') && !!document.querySelector('[data-preset=synthwave]')), 4000, 'genre chips');
    await ov.evaluate(() => { const r = document.querySelectorAll('#eqp [data-band]'); r[0].value = 7; r[9].value = -3; r[0].dispatchEvent(new Event('input', { bubbles: true })); });
    await H.sleep(300);
    await ov.fill('#eq-name', 'My Baila');
    await ov.click('#eq-save');
    await H.until(() => ov.evaluate(() => [...document.querySelectorAll('[data-user]')].some(b => b.textContent.includes('My Baila') && b.classList.contains('on'))), 4000, 'user preset on');
    const cfg = await main(() => global.__ferna.pageFx.eqCfg());
    assert(cfg.customName === 'My Baila' && cfg.gains[0] === 7 && cfg.gains[9] === -3, JSON.stringify(cfg));
    const label = await main(() => global.__ferna.windows[0].state().nav.eq.label);
    assert(label === 'My Baila', label);
    await shot('v06-01-eq-presets');
    await ov.click('[data-preset=reggae]');
    await H.until(async () => (await main(() => global.__ferna.pageFx.eqCfg().preset)) === 'reggae', 3000, 'reggae');
    const id = await main(() => global.__ferna.settings.data.eqPresets[0].id);
    await ov.evaluate(i => window.ferna.cmd('eq:preset-delete', i), id);
    assert((await main(() => global.__ferna.settings.data.eqPresets.length)) === 0, 'deleted');
    await main(() => { global.__ferna.pageFx.setEq({ enabled: false, preset: 'flat' }); global.__ferna.windows[0].closeOverlay(); });
  });

  await step('0.6 toolbar contrast: icons and "on" buttons stay ≥ 4.5:1 on light, dark and coloured bars', async () => {
    const u = await ui();
    await main(() => global.__ferna.pageFx.setEq({ enabled: true, preset: 'rock' }));
    await H.sleep(400);
    let c = await u.evaluate(() => window.__fernaContrast());
    assert(c.toolbar >= 4.5 && c.eqOn >= 4.5 && c.tabs >= 4.5, `default ${JSON.stringify(c)}`);
    // A pale yellow workspace and a very dark one: the inks flip to stay readable.
    for (const colour of ['#facc15', '#111827', '#22d3ee']) {
      const id = await main((_, col) => { const ctx = global.__ferna; const w = ctx.createWorkspace(`C ${col}`); w.color = col; ctx.ws.save(); ctx.windows[0].switchWorkspace(w.id); return w.id; }, colour);
      await H.sleep(500);
      c = await u.evaluate(() => window.__fernaContrast());
      const bg = await u.evaluate(() => getComputedStyle(document.querySelector('#toolbar')).backgroundColor);
      assert(c.toolbar >= 4.5 && c.eqOn >= 4.5 && c.tabs >= 4.5, `${colour} ${bg} ${JSON.stringify(c)}`);
      if (colour === '#facc15') await shot('v06-02-workspace-colour');
      await main((_, i) => { const ctx = global.__ferna; ctx.windows[0].switchWorkspace(null); ctx.deleteWorkspace(i); }, id);
    }
    await main(() => global.__ferna.pageFx.setEq({ enabled: false, preset: 'flat' }));
  });

  await step('0.6 themes: workspace colours the bars; adaptive colour follows the site; scheduled dark mode', async () => {
    const u = await ui();
    const id = await main(() => { const ctx = global.__ferna; const w = ctx.createWorkspace('Study'); w.color = '#16a34a'; ctx.ws.save(); ctx.windows[0].switchWorkspace(w.id); return w.id; });
    await H.sleep(400);
    let t = await main(() => global.__ferna.windows[0].state().ctxTheme);
    const tb = await u.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--toolbar-bg').trim());
    assert(t && t.source === 'workspace' && tb === t.toolbar, `${JSON.stringify(t)} ${tb}`);
    await main((_, i) => { const ctx = global.__ferna; ctx.windows[0].switchWorkspace(null); ctx.deleteWorkspace(i); }, id);
    await main(() => global.__ferna.settings.set('adaptiveTheme', true));
    await freshTab(`${base}/colors.html`);
    await H.until(() => main(() => !!global.__ferna.windows[0].active.dominant), 6000, 'colour sampled');
    t = await main(() => global.__ferna.windows[0].state().ctxTheme);
    assert(t && t.source === 'page' && parseInt(t.accent.slice(1, 3), 16) > 150, JSON.stringify(t));
    await H.sleep(500);
    await shot('v06-03-adaptive-colour');
    await main(() => global.__ferna.settings.set('adaptiveTheme', false));
    const now = new Date(); const hh = String(now.getHours()).padStart(2, '0'); const later = String((now.getHours() + 2) % 24).padStart(2, '0');
    await main((_, sc) => global.__ferna.setSetting('themeSchedule', sc), { on: true, dark: `${hh}:00`, light: `${later}:00` });
    assert((await main(e => e.nativeTheme.themeSource)) === 'dark', 'dark by schedule');
    await main(() => global.__ferna.setSetting('themeSchedule', { on: false, dark: '19:00', light: '06:30' }));
    assert((await main(e => e.nativeTheme.themeSource)) === 'system', 'back to system');
  });

  await step('0.6 parental controls: set up with a password; adult site blocked; SafeSearch forced; private window needs the password', async () => {
    await main(() => global.__ferna.windows[0].openInternal('ferna://parental/'));
    const p = await page('ferna://parental/');
    await H.until(() => p.evaluate(() => !document.querySelector('#setup').hidden), 4000, 'setup form');
    await p.fill('#s-pw', 'parent-123'); await p.fill('#s-pw2', 'parent-123');
    await p.click('#s-go');
    await H.until(() => p.evaluate(() => !document.querySelector('#manage').hidden), 4000, 'manage view');
    await freshTab('about:blank');
    await main(() => global.__ferna.windows[0].navigateActive('https://www.xvideos.com/'));
    await H.until(async () => (await main(() => global.__ferna.windows[0].active.url)).startsWith('ferna://interstitial/?kind=parental'), 6000, 'block page');
    await H.sleep(400);
    await shot('v06-04-parental-block');
    const ip = await page('ferna://interstitial/?kind=parental');
    await ip.evaluate(() => { document.querySelector('details.parent').open = true; });
    await ip.fill('#pp', 'wrong-one');
    await ip.click('[data-act=parent]');
    await H.until(() => ip.evaluate(() => document.querySelector('#pp-msg').textContent === 'Wrong password.'), 3000, 'wrong password refused');
    // SafeSearch: the search address is rewritten before it is requested.
    await freshTab('about:blank');
    await main(() => global.__ferna.windows[0].navigateActive('https://www.google.com/search?q=science'));
    await H.until(async () => decodeURIComponent(await main(() => global.__ferna.windows[0].active.url)).includes('safe=active'), 8000, 'safe=active');
    // Private window asks for the parent password.
    const n = await main(() => global.__ferna.windows.length);
    await main(() => global.__ferna.windows[0].run('privateWindow'));
    await H.until(async () => (await win()).overlay === 'parentpw', 3000, 'password prompt');
    const ov = await page('ferna://overlay/');
    await ov.fill('#pwb', 'nope'); await ov.click('#pwb-ok');
    await H.until(() => ov.evaluate(() => document.querySelector('#pwb-msg').textContent === 'Wrong password.'), 3000, 'wrong refused');
    assert((await main(() => global.__ferna.windows.length)) === n, 'no private window yet');
    await ov.fill('#pwb', 'parent-123'); await ov.click('#pwb-ok');
    await H.until(async () => (await main(() => global.__ferna.windows.length)) === n + 1, 4000, 'private window after password');
    await main(() => { const ws = global.__ferna.windows; ws[ws.length - 1].win.close(); });
    await H.until(async () => (await main(() => global.__ferna.windows.length)) === n, 4000, 'closed');
    // Turn it off again (password needed).
    const off = await p.evaluate(() => window.ferna.cmd('parental:change', 'parent-123', { enabled: false }));
    assert(off.ok && !off.cfg.enabled, JSON.stringify(off));
    assert(!(await main(() => global.__ferna.parental.on())), 'off');
  });

  await step('0.6 secure exam: kiosk window, others hidden, other sites blocked, cannot close, ends only with the password', async () => {
    await main(() => { global.__ferna.testExamNoDialog = true; global.__ferna.testExamNoRefocus = true; global.__ferna.windows[0].openInternal('ferna://exam/'); });
    const ep = await page('ferna://exam/');
    const port = new URL(base).port;
    const r = await ep.evaluate(a => window.ferna.cmd('exam:start', { title: 'Mid-semester quiz', url: `${a}/long.html?exam`, allowed: '', minutes: 0, password: 'invig-42' }), base);
    assert(r.ok, JSON.stringify(r));
    const ex = () => main(() => { const w = global.__ferna.examWin; return w ? { kiosk: w.win.isKiosk(), top: w.win.isAlwaysOnTop(), url: w.active.url, tabs: w.tabs.length, layout: w.layoutState(), others: global.__ferna.windows.filter(x => x !== w).map(x => x.win.isVisible()), log: w.examLog } : null; });
    await H.until(async () => { const e = await ex(); return e && /long\.html\?exam/.test(e.url); }, 6000, 'exam loaded');
    let e = await ex();
    assert(e.kiosk && e.top && e.layout.tabs === null && e.others.every(v => v === false), JSON.stringify({ k: e.kiosk, t: e.top, o: e.others }));
    const examWc = code => main((_, c) => global.__ferna.examWin.active.view.webContents.executeJavaScript(c), code);
    await examWc(`location.href = 'http://localhost:${port}/article.html'; 1`);
    await H.sleep(800);
    e = await ex();
    assert(/long\.html\?exam/.test(e.url) && e.log.blocked.length === 1 && e.log.blocked[0].url.includes('localhost'), JSON.stringify(e.log));
    await examWc(`window.open('${base}/article.html'); 1`);
    await H.sleep(600);
    e = await ex();
    assert(e.tabs === 1, 'no new tab');
    // Browser shortcuts do nothing (Ctrl+T, Ctrl+N), the window cannot be closed, themes are locked.
    await main(() => { const wc = global.__ferna.examWin.active.view.webContents; for (const k of ['T', 'N']) { wc.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: ['control'] }); wc.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: ['control'] }); } });
    await main(() => global.__ferna.examWin.win.close());
    await H.sleep(600);
    e = await ex();
    assert(e && e.tabs === 1 && (await main(() => global.__ferna.windows.length)) >= 2, 'still open, still one tab');
    await main(() => global.__ferna.examWin.win.emit('blur'));
    await H.sleep(300);
    assert((await ex()).log.leftWindow.length === 1, 'leaving recorded');
    await shot('v06-05-exam-window');
    // End: wrong password first, then the right one.
    await main(() => global.__ferna.examWin.openOverlay('exampw', { title: 'Mid-semester quiz' }));
    await H.sleep(400);
    await main(() => global.__ferna.examWin.overlay.webContents.executeJavaScript(`document.querySelector('#pwb').value = 'guess'; document.querySelector('#pwb-ok').click(); 1`));
    await H.until(() => main(() => global.__ferna.examWin.overlay.webContents.executeJavaScript(`document.querySelector('#pwb-msg').textContent`)).then(t => t === 'Wrong password.'), 3000, 'prompt says wrong');
    assert((await ex()).log.wrongPasswords === 1, 'wrong password counted');
    await H.sleep(300);
    await shot('v06-06-exam-unlock');
    const ok = await main(() => global.__ferna.exam.unlock(global.__ferna.examWin, 'invig-42'));
    assert(ok === true, 'unlocked');
    await H.until(async () => (await main(() => global.__ferna.examWin)) === null, 4000, 'exam closed');
    const vis = await main(() => global.__ferna.windows.every(w => w.win.isVisible()));
    assert(vis, 'other windows back');
    const logs = fs.readdirSync(path.join(profile, 'exam-logs'));
    const log = JSON.parse(fs.readFileSync(path.join(profile, 'exam-logs', logs[0]), 'utf8'));
    assert(log.endedBy === 'invigilator' && log.blocked.length === 1 && log.leftWindow.length === 1 && log.wrongPasswords === 1, JSON.stringify(log));
  });

  await step('0.6 secure exam: time limit ends the exam by itself; exam file holds only a password hash', async () => {
    const ep = await page('ferna://exam/');
    const r = await ep.evaluate(a => window.ferna.cmd('exam:start', { title: 'Timed', url: `${a}/long.html?timed`, minutes: 1, password: 'abcd' }), base);
    assert(r.ok, JSON.stringify(r));
    const sp = await page('ferna://settings/');
    const locked = await sp.evaluate(() => window.ferna.cmd('settings:set', 'theme', 'dark').then(() => 'accepted', e => String(e.message)));
    assert(/locked during an exam/.test(locked), locked);
    await main(() => { global.__ferna.examWin.exam.endsAt = Date.now() + 600; });
    await H.until(async () => (await main(() => global.__ferna.examWin)) === null, 5000, 'ended by time');
    const files = fs.readdirSync(path.join(profile, 'exam-logs')).sort();
    const log = JSON.parse(fs.readFileSync(path.join(profile, 'exam-logs', files[files.length - 1]), 'utf8'));
    assert(log.endedBy === 'time', log.endedBy);
    // An exam file started from disk (as a student would double-click it).
    const secret = require('../../src/main/secret');
    const f = path.join(profile, 'quiz.fernaexam');
    fs.writeFileSync(f, JSON.stringify({ format: 'ferna-exam', v: 1, title: 'From file', url: `${base}/long.html?file`, allowed: [], minutes: 0, passwordHash: secret.hash('teacher') }));
    fs.chmodSync(f, 0o644);
    const r2 = await main((_, p) => global.__ferna.startExamFile(p), f);
    assert(r2.ok, JSON.stringify(r2));
    assert(!fs.readFileSync(f, 'utf8').includes('teacher'), 'no plain password in file');
    assert(await main(() => global.__ferna.exam.unlock(global.__ferna.examWin, 'teacher')), 'unlock file exam');
    await H.until(async () => (await main(() => global.__ferna.examWin)) === null, 4000, 'closed');
  });
};
