'use strict';
// Loads an unpacked extension, opens a page of it, and prints errors from its worker and page.
//   node test/e2e/probe-ext.js <folder> <page.html> [seconds]
const fs = require('fs'); const path = require('path'); const os = require('os');
const H = require('./harness');
(async () => {
  const [dir, pageFile = '', secs = '12'] = process.argv.slice(2);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ferna-probe-'));
  const { app, display } = await H.launch(profile);
  const main = (fn, arg) => app.evaluate(fn, arg);
  try {
    await H.until(() => main(() => global.__ferna && global.__ferna.ext && global.__ferna.ext.ready), 20000, 'ext ready');
    await main(() => {
      global.__log = [];
      const ses = global.__ferna.ext.ses;
      ses.serviceWorkers.on('console-message', (e, d) => { if (d.level >= 2 || /error|exception|not implemented/i.test(d.message)) global.__log.push(`[sw ${d.level}] ${d.message.slice(0, 300)} @ ${d.sourceUrl}:${d.lineNumber}`); });
    });
    const id = await main(async (_, d) => (await global.__ferna.ext.loadUnpacked(path.resolve ? d : d, { skipConfirm: true })).id, path.resolve(dir)).catch(async () => main(async (_, d) => (await global.__ferna.ext.loadUnpacked(d, { skipConfirm: true })).id, path.resolve(dir)));
    console.log('loaded', id);
    if (pageFile) {
      await main((_, u) => {
        const t = global.__ferna.windows[0].newTab(u, { forceWeb: true });
        t.view.webContents.on('console-message', (e) => { const d = e; if ((d.level === 'error' || d.level === 'warning' || d.level >= 2)) global.__log.push(`[page ${d.level}] ${String(d.message).slice(0, 300)}`); });
      }, `chrome-extension://${id}/${pageFile}`);
    }
    await H.sleep(+secs * 1000);
    H.screenshot(display, path.join(__dirname, 'out', 'probe-ext.png'));
    const log = await main(() => global.__log);
    const uniq = [...new Set(log)];
    console.log(uniq.length + ' distinct messages'); uniq.slice(0, 80).forEach(l => console.log(l));
  } catch (e) { console.error('ERR', e.stack); }
  await app.close().catch(() => {}); H.stop();
})();
