'use strict';
const test = require('node:test');
const assert = require('node:assert');
const BM = require('../../src/main/bookmarks');

test('bookmarks: folders, move, no cycles, delete with contents', () => {
  const items = [];
  const f = BM.addFolder(items, { parent: 'bar', title: 'Teaching' });
  const g = BM.addFolder(items, { parent: f.id, title: 'ML' });
  const a = BM.addBookmark(items, { parent: g.id, url: 'https://a.example/', title: 'A' });
  const b = BM.addBookmark(items, { parent: 'bar', url: 'https://b.example/', title: 'B' });
  assert.equal(BM.addBookmark(items, { parent: 'bar', url: 'javascript:alert(1)' }), null);
  assert.equal(BM.addBookmark(items, { parent: 'nope', url: 'https://c.example/' }), null);
  assert.deepEqual(BM.pathOf(items, g.id).map(p => p.title), ['Bookmarks bar', 'Teaching', 'ML']);
  assert.equal(BM.move(items, f.id, g.id), false, 'a folder cannot go inside itself');
  assert.ok(BM.move(items, b.id, 'bar', 0));
  assert.deepEqual(BM.children(items, 'bar').map(n => n.title), ['B', 'Teaching']);
  assert.ok(BM.move(items, a.id, 'other'));
  assert.equal(BM.byId(items, a.id).folder, 'other');
  const left = BM.remove(items, f.id);
  assert.deepEqual(left.map(n => n.title).sort(), ['A', 'B']);
});

test('bookmarks: repair old files and broken parents', () => {
  const r = BM.repair([
    { id: 'x', url: 'https://x.example/', title: 'x', folder: 'bar' },
    { id: 'y', url: 'https://y.example/', title: 'y', folder: 'gone' },
    { id: 'f1', type: 'folder', title: 'loop1', folder: 'f2' },
    { id: 'f2', type: 'folder', title: 'loop2', folder: 'f1' },
    { id: 'bad', url: 'javascript:void 0', title: 'bad', folder: 'bar' },
  ]);
  assert.deepEqual(r.map(n => n.id), ['x', 'y', 'f1', 'f2']);
  assert.equal(r[1].folder, 'other');
  assert.ok(r.some(n => n.type === 'folder' && n.folder === 'other'), 'cycle broken');
});

test('bookmarks: Netscape import keeps folders, export round-trips', () => {
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p>
    <DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
    <DL><p><DT><A HREF="https://bar.example/">Bar &amp; site</A>
      <DT><H3>Research</H3><DL><p><DT><A HREF="https://arxiv.org/">arXiv</A></DL><p>
    </DL><p>
    <DT><H3>Other bookmarks</H3><DL><p><DT><A HREF="https://other.example/">Other</A></DL><p>
    <DT><H3>Bookmarks Menu</H3><DL><p><DT><A HREF="https://menu.example/">Menu</A></DL><p>
  </DL><p>`;
  const items = [];
  assert.equal(BM.importHtml(items, html), 4);
  const research = items.find(n => n.title === 'Research');
  assert.equal(research.folder, 'bar');
  assert.equal(items.find(n => n.url === 'https://arxiv.org/').folder, research.id);
  assert.equal(items.find(n => n.url === 'https://bar.example/').title, 'Bar & site');
  assert.equal(items.find(n => n.url === 'https://other.example/').folder, 'other');
  const menu = items.find(n => n.title === 'Bookmarks Menu');
  assert.equal(menu.folder, 'other');
  const again = [];
  BM.importHtml(again, BM.exportHtml(items));
  assert.deepEqual(again.map(n => [n.title, n.type || 'bm']).sort(), items.map(n => [n.title, n.type || 'bm']).sort());
});
