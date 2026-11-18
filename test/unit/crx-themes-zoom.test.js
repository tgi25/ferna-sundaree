'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const crx = require('../../src/main/crx');
const { packCrx, zipFolder } = require('../../tools/make-crx');
const { themeFromManifest } = require('../../src/main/themes');
const ZL = require('../../src/main/zoomlevels');
const { computeLayout } = require('../../src/main/layout');
const FIX = path.join(__dirname, '..', 'fixtures');

test('CRX3: valid package verifies and yields the id of its key', () => {
  const r = packCrx(zipFolder(path.join(FIX, 'ext-src')));
  const p = crx.parseCrx(r.crx);
  assert.strictEqual(p.id, r.id);
  assert.ok(p.verified && p.publicKey.length > 200);
  assert.strictEqual(crx.idFromPublicKey(p.publicKey), r.id);
});

test('CRX3: tampered archive, wrong magic and CRX2 are refused', () => {
  assert.throws(() => crx.parseCrx(fs.readFileSync(path.join(FIX, 'tampered.crx'))), /signature/);
  assert.throws(() => crx.parseCrx(Buffer.from('PK\x03\x04 not a crx')), /Not a Chrome extension/);
  const v2 = Buffer.alloc(16); Buffer.from('Cr24').copy(v2); v2.writeUInt32LE(2, 4);
  assert.throws(() => crx.parseCrx(v2), /CRX3/);
});

test('zip extraction refuses path traversal and finds a nested manifest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crx-'));
  const evil = new AdmZip();
  evil.addFile('manifest.json', Buffer.from('{"name":"x","version":"1"}'));
  evil.addFile('a/../../escape.txt', Buffer.from('x'));
  // adm-zip normalises names on add; write the raw entry name instead
  const e = evil.getEntry('a/../../escape.txt') || evil.getEntries().find(x => x.entryName.includes('escape'));
  if (e) e.entryName = '../escape.txt';
  assert.throws(() => crx.extractZip(evil.toBuffer(), path.join(dir, 'out')), /Unsafe path/);
  assert.ok(!fs.existsSync(path.join(dir, 'escape.txt')));
  const nested = new AdmZip();
  nested.addFile('myext/manifest.json', Buffer.from('{"name":"Nested","version":"2"}'));
  const r = crx.extractZip(nested.toBuffer(), path.join(dir, 'n'));
  assert.strictEqual(r.manifest.name, 'Nested');
  assert.ok(r.base.endsWith('myext'));
});

test('permission warnings resemble Chrome install prompts', () => {
  const w = crx.permissionWarnings({ permissions: ['tabs', 'storage'], host_permissions: ['<all_urls>'] });
  assert.ok(w.includes('Read and change all your data on all websites'));
  assert.ok(w.includes('Read your browsing history'));
  assert.deepStrictEqual(crx.permissionWarnings({ permissions: ['storage'] }), []);
  const cs = crx.permissionWarnings({ content_scripts: [{ matches: ['https://mail.google.com/*'] }] });
  assert.ok(/mail\.google\.com/.test(cs[0]));
});

test('themes map Chrome colours to UI variables', () => {
  const t = themeFromManifest(JSON.parse(fs.readFileSync(path.join(FIX, 'theme-src', 'manifest.json'))), null);
  assert.strictEqual(t.vars['--th-frame'], 'rgb(20, 70, 45)');
  assert.strictEqual(t.vars['--th-toolbar'], 'rgb(228, 244, 234)');
  assert.strictEqual(t.dark, false);
  assert.deepStrictEqual(themeFromManifest({ theme: { colors: { frame: [0, 0, 0, 0.5] } } }).vars['--th-frame'], 'rgba(0, 0, 0, 0.5)');
  assert.ok(!('theme_frame' in themeFromManifest({ theme: { images: { theme_frame: '../x.png' } } }).images));
});

test('zoom 0.9: Chrome steps from any level, limits', () => {
  assert.strictEqual(ZL.step(100, 'in'), 110);
  assert.strictEqual(ZL.step(100, 'out'), 90);
  assert.strictEqual(ZL.step(105, 'in'), 110);
  assert.strictEqual(ZL.step(133, 'out'), 125);
  assert.strictEqual(ZL.step(500, 'in'), 500);
  assert.strictEqual(ZL.step(25, 'out'), 25);
  assert.strictEqual(ZL.clamp(9999), 500);
  assert.strictEqual(ZL.clamp('x'), 100);
});

test('zoom 0.9: remembered per host; older per-domain levels still apply; other pages none', () => {
  assert.strictEqual(ZL.hostKey('https://Mail.Example.com/u/0/'), 'mail.example.com');
  assert.strictEqual(ZL.hostKey('http://localhost:8080/x'), 'localhost:8080');
  assert.strictEqual(ZL.hostKey('ferna://settings/'), '');
  const levels = { 'mail.example.com': 125, 'example.org': 150 };
  assert.strictEqual(ZL.levelFor('https://mail.example.com/', levels), 125);
  assert.strictEqual(ZL.levelFor('https://www.example.org/a', levels), 150);
  assert.strictEqual(ZL.levelFor('https://example.org/', levels), 150);
  assert.strictEqual(ZL.levelFor('https://other.com/', levels, 110), 110);
});

test('zoom 0.9: old Zoom Page WE settings keep full-zoom levels, drop text-only ones', () => {
  const m = ZL.migrate({ 'a.com': { type: 'full', full: 133 }, 'b.com': { type: 'text', full: 100, text: 150 }, 'c.com': { type: 'full', full: 100 } }, { defaultType: 'full', defaultFull: 110 });
  assert.deepStrictEqual(m, { levels: { 'a.com': 133 }, def: 110 });
  assert.deepStrictEqual(ZL.migrate(undefined, { defaultType: 'text' }), { levels: {}, def: 100 });
});

test('layout: Ctrl+Shift+H hides the chosen bars, no edge reveal, window controls move to the bar still shown', () => {
  const base = { position: 'top', vwidth: 240 };
  assert.strictEqual(computeLayout(1200, 800, base).windowControls, 'tabs');
  // Both (the default): nothing at the edges, the page fills the window under the bookmarks bar
  let L = computeLayout(1200, 800, { ...base, tabBarHidden: true });
  assert.ok(!L.tabs && !L.toolbar && !L.edgeTabs && !L.edgeToolbar && L.windowControls === null && L.content.y === 30);
  // Reveal flags do nothing outside focus mode
  L = computeLayout(1200, 800, { ...base, tabBarHidden: true, revealTabs: true, revealToolbar: true });
  assert.ok(!L.tabs && !L.toolbar);
  // Tab bar only: the address bar stays and takes the window controls
  L = computeLayout(1200, 800, { ...base, tabBarHidden: true, hideBars: 'tabs' });
  assert.ok(!L.tabs && L.toolbar && L.windowControls === 'toolbar' && !L.edgeTabs);
  // Address bar only: the tab bar stays with the controls
  L = computeLayout(1200, 800, { ...base, tabBarHidden: true, hideBars: 'toolbar' });
  assert.ok(L.tabs && !L.toolbar && L.windowControls === 'tabs' && !L.edgeToolbar && L.content.y === 38 + 30);
  // Vertical tabs
  L = computeLayout(1200, 800, { ...base, position: 'left' });
  assert.strictEqual(L.windowControls, 'toolbar');
  L = computeLayout(1200, 800, { ...base, position: 'left', tabBarHidden: true });
  assert.ok(!L.toolbar && !L.tabs && L.windowControls === null && L.content.x === 0);
  L = computeLayout(1200, 800, { ...base, position: 'left', tabBarHidden: true, hideBars: 'toolbar' });
  assert.ok(!L.toolbar && L.tabs && L.windowControls === 'tabs' && L.content.x === 240);
  L = computeLayout(1200, 800, { ...base, position: 'left', tabBarHidden: true, hideBars: 'tabs' });
  assert.ok(L.toolbar && !L.tabs && L.windowControls === 'toolbar' && L.content.x === 0);
  // Focus mode still reveals at the edge
  L = computeLayout(1200, 800, { ...base, position: 'left', focus: true, revealTabs: true, revealToolbar: true });
  assert.ok(L.toolbar && L.tabs && L.windowControls === 'toolbar');
});
