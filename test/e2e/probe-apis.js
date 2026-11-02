'use strict';
// Loads an extension folder and reports which chrome.* APIs work in its worker and pages.
//   node test/e2e/probe-apis.js [extensionFolder]
const fs = require('fs'); const path = require('path'); const os = require('os');
const H = require('./harness');
(async () => {
  const dir = path.resolve(process.argv[2] || path.join(H.FIX, 'extensions', 'probe-src'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ferna-probe-'));
  const { app } = await H.launch(profile);
  const main = (fn, arg) => app.evaluate(fn, arg);
  try {
    await H.until(() => main(() => global.__ferna && global.__ferna.ext && global.__ferna.ext.ready), 20000, 'ext ready');
    const id = await main(async (_, d) => (await global.__ferna.ext.loadUnpacked(d, { skipConfirm: true })).id, dir);
    console.log('loaded', id);
    await H.sleep(1500);
    const w = await main(async (_, id) => {
      const t = global.__ferna.windows[0].newTab(`chrome-extension://${id}/probe.html`, { forceWeb: true });
      await new Promise(r => setTimeout(r, 1500));
      const wc = t.view.webContents;
      const js = c => wc.executeJavaScript(c);
      return {
        page: await js('probe()'),
        worker: await js(`chrome.runtime.sendMessage('probe')`),
        offscreen: await js(`chrome.runtime.sendMessage('offscreen')`),
        alarm: await js(`chrome.runtime.sendMessage('fast-alarm').then(() => new Promise(r => setTimeout(r, 1200))).then(() => chrome.runtime.sendMessage('fired'))`),
      };
    }, id);
    console.log(JSON.stringify(w, null, 1));
  } catch (e) { console.error('ERR', e.message); }
  await app.close().catch(() => {}); H.stop();
})();
