'use strict';
// Loads the Ferna extensions (Feeds, Zoom, Equalizer, Screenshot) and reports which chrome.* APIs
// they use are present in their service workers.  node test/e2e/probe-ferna.js
const fs = require('fs'); const path = require('path'); const os = require('os');
const H = require('./harness');
const EXT = process.env.FERNA_EXT_DIR || '/tmp/ferna-ext-probe';
const NAMES = ['ferna-feeds', 'ferna-zoom', 'ferna-equalizer', 'ferna-screenshot'];
const CHECK = ['alarms.create', 'alarms.onAlarm', 'sidePanel.setPanelBehavior', 'sidePanel.open', 'notifications.create', 'contextMenus.create', 'contextMenus.onClicked',
  'commands.onCommand', 'commands.getAll', 'action.setBadgeText', 'action.setBadgeBackgroundColor', 'action.setTitle', 'action.onClicked', 'storage.sync.get', 'storage.session.get', 'storage.local.get', 'storage.onChanged',
  'tabs.setZoom', 'tabs.getZoom', 'tabs.setZoomSettings', 'tabs.getZoomSettings', 'tabs.onZoomChange', 'tabs.captureVisibleTab', 'tabs.sendMessage', 'tabs.query', 'tabs.create', 'tabs.onUpdated', 'tabs.onActivated', 'tabs.onRemoved',
  'scripting.executeScript', 'scripting.insertCSS', 'downloads.download', 'runtime.openOptionsPage', 'runtime.onInstalled', 'windows.getCurrent', 'dom.openOrClosedShadowRoot', 'offscreen.createDocument'];
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ferna-probe-'));
  const { app } = await H.launch(profile);
  const main = (fn, arg) => app.evaluate(fn, arg);
  try {
    await H.until(() => main(() => global.__ferna && global.__ferna.ext && global.__ferna.ext.ready), 30000, 'ext ready');
    for (const n of NAMES) {
      const r = await main(async ({ session }, { dir, check }) => {
        const ctx = global.__ferna;
        let ext;
        try { ext = await ctx.ext.loadUnpacked(dir, { skipConfirm: true }); } catch (e) { return { error: 'load: ' + e.message }; }
        await new Promise(r => setTimeout(r, 2500));
        const page = { 'ferna-feeds': 'feeds.html', 'ferna-zoom': 'popup.html', 'ferna-equalizer': 'popup.html', 'ferna-screenshot': 'options.html' }[dir.split('/').slice(-2)[0]];
        const t = ctx.windows[0].newTab(`chrome-extension://${ext.id}/${page}`, { forceWeb: true });
        await new Promise(r => setTimeout(r, 2000));
        const code = `(() => { const o = {}; for (const p of ${JSON.stringify(check)}) { let v = globalThis.chrome; for (const k of p.split('.')) v = v == null ? undefined : v[k]; o[p] = typeof v; } return o; })()`;
        let res;
        try { res = await t.view.webContents.executeJavaScript(code); } catch (e) { res = 'ERR ' + e.message; }
        const missing = res && typeof res === 'object' ? Object.entries(res).filter(([, v]) => v === 'undefined').map(([k]) => k) : res;
        ctx.windows[0].closeTab(t);
        return { id: ext.id, missing };
      }, { dir: path.join(EXT, n, 'ext'), check: CHECK });
      console.log(n, JSON.stringify(r));
    }
  } catch (e) { console.error('ERR', e.message); }
  await app.close().catch(() => {}); H.stop();
})();
