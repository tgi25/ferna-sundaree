'use strict';
// Calls the chrome.* functions the Ferna extensions rely on, against a real tab.  node test/e2e/probe-fn.js
const fs = require('fs'); const path = require('path'); const os = require('os');
const H = require('./harness');
(async () => {
  const { srv, base } = await H.serve();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ferna-probe-'));
  const { app } = await H.launch(profile);
  const main = (fn, arg) => app.evaluate(fn, arg);
  try {
    await H.until(() => main(() => global.__ferna && global.__ferna.ext && global.__ferna.ext.ready), 30000, 'ext ready');
    const id = await main(async (_, d) => (await global.__ferna.ext.loadUnpacked(d, { skipConfirm: true })).id, path.join(H.FIX, 'extensions', 'probe-fn'));
    await H.sleep(1500);
    const out = await main(async (_, { id, url }) => {
      const ctx = global.__ferna; const w = ctx.windows[0];
      const web = w.newTab(url); await new Promise(r => setTimeout(r, 2500));
      const tabId = web.view.webContents.id;
      const pg = w.newTab(`chrome-extension://${id}/page.html`, { forceWeb: true, activate: false }); await new Promise(r => setTimeout(r, 1500));
      const run = await pg.view.webContents.executeJavaScript(`chrome.runtime.sendMessage({ t: 'run', tabId: ${tabId} })`);
      const factor = web.view.webContents.getZoomFactor();
      w.activate(web);
      await ctx.zoomAct(w, web, 'in');
      const afterIn = web.view.webContents.getZoomFactor();
      // the extension's shortcut, typed into the page
      for (const type of ['keyDown', 'keyUp']) web.view.webContents.sendInputEvent({ type, keyCode: 'Y', modifiers: ['alt', 'shift'] });
      ctx.ext.click(w, id, null);
      await new Promise(r => setTimeout(r, 2500));
      const side = w.side ? { kind: w.side.kind, url: w.side.view.webContents.getURL() } : null;
      if (w.side) { await w.side.view.webContents.executeJavaScript('window.close()').catch(() => {}); await new Promise(r => setTimeout(r, 600)); }
      const sideAfterClose = w.side ? w.side.kind : null;
      const log = await pg.view.webContents.executeJavaScript(`chrome.runtime.sendMessage({ t: 'log' })`);
      return { tabId, run, factor, afterIn, side, sideAfterClose, log, downloads: ctx.downloads.slice(0, 2).map(d => d.path) };
    }, { id, url: `${base}/long.html` });
    console.log(JSON.stringify(out, null, 1));
  } catch (e) { console.error('ERR', e.message); }
  await app.close().catch(() => {}); srv.close(); H.stop();
})();
