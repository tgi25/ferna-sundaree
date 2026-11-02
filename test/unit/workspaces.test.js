'use strict';
const test = require('node:test');
const assert = require('node:assert');
const ws = require('../../src/main/workspaces');

test('folderOf keeps the folder a page was in', () => {
  assert.strictEqual(ws.folderOf('https://mail.google.com/mail/u/1/#inbox'), 'https://mail.google.com/mail/u/1/');
  assert.strictEqual(ws.folderOf('https://example.com/a/b.html?x'), 'https://example.com/a/');
  assert.strictEqual(ws.folderOf('https://example.com'), 'https://example.com/');
});

test('host rules match sub-domains, not look-alikes', () => {
  assert.ok(ws.hostMatches('github.com', 'gist.github.com'));
  assert.ok(ws.hostMatches('*.github.com', 'github.com'));
  assert.ok(!ws.hostMatches('github.com', 'notgithub.com'));
  assert.ok(!ws.hostMatches('', 'a.com'));
});

test('per-tab override beats host rules; "none" forces no workspace', () => {
  const W = [{ id: 'a', pinned: [{ url: 'https://github.com/x' }], hosts: [] }, { id: 'b', pinned: [], hosts: ['github.com'] }];
  assert.strictEqual(ws.workspaceOfTab({ url: 'https://github.com/y' }, W), 'a');
  assert.strictEqual(ws.workspaceOfTab({ url: 'https://github.com/y', wsOverride: 'b' }, W), 'b');
  assert.strictEqual(ws.workspaceOfTab({ url: 'https://github.com/y', wsOverride: 'none' }, W), null);
  assert.strictEqual(ws.workspaceOfTab({ url: 'ferna://newtab/' }, W), null);
});

test('common bar: two accounts of one site keep separate icons with badges', () => {
  const common = [{ url: 'https://mail.google.com/mail/u/0/', folder: 'https://mail.google.com/mail/u/0/' }, { url: 'https://mail.google.com/mail/u/1/', folder: 'https://mail.google.com/mail/u/1/' }];
  assert.deepStrictEqual(ws.commonBadges(common), ['0', '1']);
  const tabs = [{ id: 1, url: 'https://mail.google.com/mail/u/1/#inbox/abc' }, { id: 2, url: 'https://mail.google.com/mail/u/0/#sent' }];
  const s = ws.buildStrip(tabs, [], common, null);
  assert.strictEqual(s.common[0].tabId, 2);
  assert.strictEqual(s.common[1].tabId, 1);
  assert.deepStrictEqual(s.tabs, []);
});

test('buildStrip: pinned sites listed open or closed; workspace filters tabs; no-workspace count', () => {
  const W = [{ id: 't', name: 'Teaching', pinned: [{ url: 'https://lms.example.edu/course/' }, { url: 'https://docs.example.org/' }], hosts: ['slides.example.com'] }];
  const tabs = [
    { id: 1, url: 'https://lms.example.edu/course/week1' },
    { id: 2, url: 'https://slides.example.com/deck' },
    { id: 3, url: 'https://news.example.net/' },
  ];
  const s = ws.buildStrip(tabs, W, [], 't');
  assert.strictEqual(s.pinned.length, 2);
  assert.strictEqual(s.pinned[0].tabId, 1);
  assert.strictEqual(s.pinned[1].tabId, null);
  assert.deepStrictEqual(s.tabs, [2]);
  assert.strictEqual(s.noWorkspace, 1);
  const all = ws.buildStrip(tabs, W, [], null);
  assert.deepStrictEqual(all.tabs, [1, 2, 3]);
});

test('importFernaTabs reads the extension export schema', () => {
  const r = ws.importFernaTabs({ workspaces: [{ id: 'w2', name: 'B', color: 0, sites: [], hosts: [] }, { id: 'w1', name: 'A', color: 2, sites: [{ u: 'https://a.com/', t: 'A' }, { u: 'javascript:alert(1)' }], hosts: ['b.com', 'bad host!'] }], order: ['w1', 'w2'], common: [{ u: 'https://c.com/x/', t: 'C' }] });
  assert.deepStrictEqual(r.workspaces.map(w => w.id), ['w1', 'w2']);
  assert.strictEqual(r.workspaces[0].color, '#1c8c4a');
  assert.strictEqual(r.workspaces[0].pinned.length, 1);
  assert.deepStrictEqual(r.workspaces[0].hosts, ['b.com']);
  assert.strictEqual(r.common[0].folder, 'https://c.com/x/');
});

test('workspace icons: glyphs, initials, safe pictures, Ferna Tabs icons on import', () => {
  const W = require('../../src/main/workspaces');
  assert.equal(W.cleanIcon('🎓', 'Teaching'), '🎓');
  assert.equal(W.cleanIcon('', 'research'), 'R');
  assert.equal(W.cleanIcon('<b>', 'Code'), 'b');
  assert.equal(W.cleanIcon('ABCD', 'x'), 'AB');
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  assert.equal(W.cleanImage(png), png);
  assert.equal(W.cleanImage('data:image/svg+xml;base64,PHN2Zz4='), undefined);
  assert.equal(W.cleanImage('data:image/png;base64,' + 'A'.repeat(20000)), undefined);
  const imp = W.importFernaTabs({ workspaces: [{ id: 'a', name: 'Teaching', icon: '🎓', color: 1 }, { id: 'b', name: 'lab' }], icons: { wsIcon_b: png } });
  assert.equal(imp.workspaces[0].icon, '🎓');
  assert.equal(imp.workspaces[1].icon, 'L');
  assert.equal(imp.workspaces[1].image, png);
  assert.equal(W.newWorkspace('Maths').icon, 'M');
});

test('favourites-only strip: "All" lists the pinned sites of every workspace', () => {
  const W = require('../../src/main/workspaces');
  const wss = [
    { id: 'a', name: 'A', pinned: [{ url: 'https://one.example/' }], hosts: [] },
    { id: 'b', name: 'B', pinned: [{ url: 'https://two.example/' }, { url: 'https://three.example/' }], hosts: [] },
  ];
  const tabs = [{ id: 1, url: 'https://two.example/page' }, { id: 2, url: 'https://other.example/' }];
  assert.equal(W.buildStrip(tabs, wss, [], null).pinned.length, 0);
  const s = W.buildStrip(tabs, wss, [], null, { allPinned: true });
  assert.deepEqual(s.pinned.map(p => [p.wsId, p.index, p.tabId]), [['a', 0, null], ['b', 0, 1], ['b', 1, null]]);
  assert.deepEqual(s.tabs, [2]);
  const one = W.buildStrip(tabs, wss, [], 'b', { allPinned: true });
  assert.deepEqual(one.pinned.map(p => p.wsId), ['b', 'b']);
});

test('pinned in All tabs: shown with "All", claim their tab, kept by import', () => {
  const W = require('../../src/main/workspaces');
  const wss = [{ id: 'a', name: 'A', pinned: [{ url: 'https://one.example/' }], hosts: [] }];
  const tabs = [{ id: 1, url: 'https://news.example/today' }, { id: 2, url: 'https://other.example/' }];
  const all = [{ url: 'https://news.example/', folder: 'https://news.example/' }];
  const s = W.buildStrip(tabs, wss, [], null, { allTabsPinned: all });
  assert.deepEqual(s.pinned.map(p => [p.wsId, p.tabId]), [['', 1]]);
  assert.deepEqual(s.tabs, [2]);
  const f = W.buildStrip(tabs, wss, [], null, { allTabsPinned: all, allPinned: true });
  assert.deepEqual(f.pinned.map(p => p.wsId), ['', 'a']);
  assert.equal(W.buildStrip(tabs, wss, [], 'a', { allTabsPinned: all }).pinned.length, 1);
  const imp = W.importFernaTabs({ workspaces: [], allPinned: [{ u: 'https://news.example/', t: 'News' }, 'javascript:alert(1)'] });
  assert.deepEqual(imp.allPinned.map(p => p.url), ['https://news.example/']);
});
