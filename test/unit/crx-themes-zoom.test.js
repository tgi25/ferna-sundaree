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
const zoom = require('../../src/main/zoom');
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

test('zoom: levels, fixed steps, small steps, limits', () => {
  const p = { ...zoom.DEFAULTS };
  assert.strictEqual(zoom.nextLevel(100, 'in', p), 110);
  assert.strictEqual(zoom.nextLevel(100, 'out', p), 90);
  assert.strictEqual(zoom.nextLevel(105, 'in', p), 110);
  assert.strictEqual(zoom.nextLevel(500, 'in', p), 500);
  assert.strictEqual(zoom.nextLevel(30, 'out', p), 30);
  assert.strictEqual(zoom.nextLevel(100, 'in', { ...p, stepMode: 'fixed', step: 25 }), 125);
  assert.strictEqual(zoom.nextLevel(100, 'out', p, true), 98);
});

test('zoom: text mode separates text and non-text levels; per-tab uses CSS', () => {
  const p = { ...zoom.DEFAULTS };
  assert.deepStrictEqual(zoom.effective({ type: 'full', full: 150, text: 100, nonText: 100, minFont: 0 }, p), { pageFactor: 1.5, textFactor: 1, minFont: 0, lineSpacing: 1, useCss: false });
  const e = zoom.effective({ type: 'text', full: 150, text: 130, nonText: 100, minFont: 14 }, { ...p, mode: 'tab' });
  assert.strictEqual(e.pageFactor, 1);
  assert.strictEqual(e.textFactor, 1.3);
  assert.strictEqual(e.minFont, 14);
  assert.strictEqual(e.useCss, true);
});

test('zoom: site keys group sub-domains unless asked not to', () => {
  const p = { ...zoom.DEFAULTS };
  assert.strictEqual(zoom.siteKey('https://mail.google.com/x', p), 'google.com');
  assert.strictEqual(zoom.siteKey('https://www.sjp.ac.lk/', p), 'sjp.ac.lk');
  assert.strictEqual(zoom.siteKey('https://mail.google.com/x', { ...p, subdomainsSeparate: true }), 'mail.google.com');
  assert.strictEqual(zoom.siteKey('ferna://settings/', p), '');
});

test('zoom: AutoFit fits content width within the configured range', () => {
  const p = { ...zoom.DEFAULTS };
  assert.strictEqual(zoom.autofitLevel({ vw: 1232, left: 316, right: 916, sw: 1232 }, 100, p), 200);
  assert.strictEqual(zoom.autofitLevel({ vw: 1000, left: 0, right: 1000, sw: 1600 }, 100, p), 61);
});

test('layout: window controls follow the tab bar and hide with Ctrl+Shift+H', () => {
  const base = { position: 'top', vwidth: 240 };
  assert.strictEqual(computeLayout(1200, 800, base).windowControls, 'tabs');
  let L = computeLayout(1200, 800, { ...base, tabBarHidden: true });
  assert.strictEqual(L.windowControls, null);
  assert.ok(L.toolbar, 'toolbar stays by default with tabs on top');
  L = computeLayout(1200, 800, { ...base, tabBarHidden: true, hideToolbarWithTabs: true });
  assert.ok(!L.toolbar && L.edgeToolbar);
  L = computeLayout(1200, 800, { ...base, position: 'left' });
  assert.strictEqual(L.windowControls, 'toolbar');
  L = computeLayout(1200, 800, { ...base, position: 'left', tabBarHidden: true });
  assert.ok(!L.toolbar && !L.tabs && L.windowControls === null, 'vertical: toolbar with controls hides too');
  assert.strictEqual(L.content.x, 5);
  L = computeLayout(1200, 800, { ...base, position: 'left', tabBarHidden: true, revealTabs: true, revealToolbar: true });
  assert.ok(L.toolbar && L.tabs && L.windowControls === 'toolbar');
});
