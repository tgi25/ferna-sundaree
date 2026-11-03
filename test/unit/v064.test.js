'use strict';
// 0.6.4: local files join the workspace whose pinned folder holds them; scriptlets for a page.
const test = require('node:test');
const assert = require('node:assert');
const W = require('../../src/main/workspaces');

const viewer = u => `ferna://pdf/viewer/viewer.html?file=${encodeURIComponent(u)}`;

test('local files: the workspace that pinned the folder (deepest one wins) claims them', () => {
  const ws = [
    { id: 'ml', name: 'ML', pinned: [{ url: 'file:///C:/Teaching/', folder: 'file:///C:/Teaching/' }], hosts: [] },
    { id: 'nlp', name: 'NLP', pinned: [{ url: 'file:///C:/Teaching/NLP/', folder: 'file:///C:/Teaching/NLP/' }], hosts: [] },
    { id: 'web', name: 'Web', pinned: [{ url: 'https://lms.example/', folder: 'https://lms.example/' }], hosts: ['lms.example'] },
  ];
  assert.equal(W.workspaceOfTab({ url: viewer('file:///C:/Teaching/NLP/week3.pdf') }, ws), 'nlp');
  assert.equal(W.workspaceOfTab({ url: 'file:///C:/Teaching/ML/svm.html' }, ws), 'ml');
  assert.equal(W.workspaceOfTab({ url: 'file:///D:/Other/x.pdf' }, ws), null);
  assert.equal(W.workspaceOfTab({ url: 'https://lms.example/c/1' }, ws), 'web');
  // A pinned file (not a folder) claims only itself.
  const one = [{ id: 'a', name: 'A', pinned: [{ url: 'file:///home/t/notes.pdf', folder: W.folderOf('file:///home/t/notes.pdf') }], hosts: [] }];
  assert.equal(W.workspaceOfTab({ url: viewer('file:///home/t/notes.pdf') }, one), 'a');
  assert.equal(W.workspaceOfTab({ url: viewer('file:///home/t/other.pdf') }, one), null);
});

test('scriptlets: asked per page address; none when blocking is off for the site', () => {
  const asked = [];
  const engine = { getCosmeticsFilters: q => { asked.push(q); return { scripts: ['/*s1*/', 42, '/*s2*/'], styles: 'x' }; } };
  const settings = { blocker: true, blockerAllow: ['allowed.example'], cosmeticFiltering: true, listScriptlets: false };
  const ctx = { blocker: { engine, custom: null }, settings: { data: settings } };
  const fx = require('../../src/main/pagefx').create(ctx);
  // Off by default: list scriptlets broke Facebook and YouTube.
  assert.deepEqual(fx.scriptletsFor('https://www.facebook.com/'), []);
  settings.listScriptlets = true;
  assert.deepEqual(fx.scriptletsFor('https://www.facebook.com/'), ['/*s1*/', '/*s2*/']);
  assert.equal(asked[0].hostname, 'www.facebook.com');
  assert.equal(asked[0].getInjectionRules, true);
  assert.equal(asked[0].getRulesFromDOM, false);
  assert.deepEqual(fx.scriptletsFor('https://allowed.example/'), []);
  assert.deepEqual(fx.scriptletsFor('ferna://settings/'), []);
  settings.blocker = false;
  assert.deepEqual(fx.scriptletsFor('https://www.facebook.com/'), []);
});

test('a page pinned and on the common bar shows open in both; the pin prefers its own page', () => {
  const page = 'https://h.example/long.html?drag-me';
  const tabs = [{ id: 71, url: viewer('https://h.example/test.pdf') }, { id: 76, url: page }];
  const s = W.buildStrip(tabs, [], [{ url: page, folder: W.folderOf(page) }], null, { allTabsPinned: [{ url: page, folder: W.folderOf(page) }] });
  assert.equal(s.common[0].tabId, 76);
  assert.equal(s.pinned[0].tabId, 76);
});

test('favicon cache: kept per page, folder and site; only images; served as ferna://favicon', async () => {
  const { FaviconCache } = require('../../src/main/favicons');
  const store = { data: { icons: {} }, saves: 0, save() { this.saves++; } };
  const fc = new FaviconCache(store);
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const fetchOk = (buf, type) => async () => ({ ok: true, headers: { get: h => (h === 'content-type' ? type : String(buf.length)) }, arrayBuffer: async () => buf });
  const d = await fc.learn('https://www.facebook.com/groups/x', 'https://static.xx.fbcdn.net/rsrc.php/fav.ico', fetchOk(png, 'application/octet-stream'));
  assert.match(d, /^data:image\/png;base64,/);
  assert.equal(fc.lookup('https://www.facebook.com/groups/x'), d);
  assert.equal(fc.lookup('https://facebook.com/other'), d);            // same site
  assert.match(fc.urlFor('https://www.facebook.com/'), /^ferna:\/\/favicon\/\?k=host%3Afacebook\.com&v=[0-9a-f]{10}$/);
  assert.deepEqual(fc.file('host:facebook.com').buf, png);
  // Not an image (an HTML error page): nothing kept.
  const bad = await fc.learn('https://bad.example/', 'https://bad.example/favicon.ico', fetchOk(Buffer.from('<html>'), 'text/html'));
  assert.equal(bad, '');
  assert.equal(fc.lookup('https://bad.example/'), '');
  // Internal pages and junk are ignored.
  assert.equal(await fc.learn('ferna://settings/', 'https://x/', fetchOk(png, 'image/png')), '');
  assert.equal(fc.file('nope'), null);
});
