'use strict';
// 0.6.3: pinning PDFs, recently-used Ctrl+Tab, blocker party detection without a referrer.
const test = require('node:test');
const assert = require('node:assert');
const W = require('../../src/main/workspaces');
const { ShortcutRegistry } = require('../../src/main/shortcuts');
const { Blocker } = require('../../src/main/blocker');

const viewer = u => `ferna://pdf/viewer/viewer.html?file=${encodeURIComponent(u)}`;

test('PDF tabs: the reader address maps back to the file; a PDF pin is the file itself', () => {
  assert.equal(W.pageUrlOf(viewer('https://lms.example/course/week7.pdf')), 'https://lms.example/course/week7.pdf');
  assert.equal(W.pageUrlOf(viewer('file:///C:/Notes/svm.pdf')), 'file:///C:/Notes/svm.pdf');
  assert.equal(W.pageUrlOf('https://a.example/x'), 'https://a.example/x');
  assert.equal(W.pageUrlOf(viewer('javascript:alert(1)')), viewer('javascript:alert(1)'));
  assert.equal(W.folderOf('https://lms.example/course/week7.pdf?x=1#p=3'), 'https://lms.example/course/week7.pdf');
  assert.equal(W.folderOf('https://lms.example/course/index.html'), 'https://lms.example/course/');
});

test('PDF tabs: pinned in a workspace and on the common bar; the most specific pin wins', () => {
  const pdf = 'https://lms.example/course/week7.pdf';
  const ws = [{ id: 'study', name: 'Study', pinned: [
    { url: 'https://lms.example/course/', folder: 'https://lms.example/course/' },
    { url: pdf, folder: W.folderOf(pdf) },
  ], hosts: [] }];
  const tabs = [{ id: 1, url: viewer(pdf) }, { id: 2, url: 'https://lms.example/course/page.html' }, { id: 3, url: viewer('file:///home/t/a.pdf') }];
  const s = W.buildStrip(tabs, ws, [{ url: 'file:///home/t/a.pdf', folder: W.folderOf('file:///home/t/a.pdf') }], 'study');
  assert.equal(s.pinned.find(p => p.pin.url === pdf).tabId, 1);       // the PDF pin claims the PDF tab
  assert.equal(s.pinned.find(p => p.pin.url.endsWith('/course/')).tabId, 2);
  assert.equal(s.common[0].tabId, 3);                                  // local PDF on the common bar
  assert.equal(W.workspaceOfTab({ url: viewer(pdf) }, ws), 'study');   // a PDF belongs to its site's workspace
});

test('Ctrl+Tab goes to the recently used tab; Ctrl+PageDown keeps strip order', () => {
  const r = new ShortcutRegistry({});
  const key = (code, mods = {}) => ({ type: 'keyDown', key: code, code: code === 'Tab' ? 'Tab' : code, control: true, shift: false, alt: false, meta: false, ...mods });
  assert.equal(r.commandFor(key('Tab')), 'recentTab');
  assert.equal(r.commandFor(key('Tab', { shift: true })), 'recentTabBack');
  assert.equal(r.commandFor(key('PageDown')), 'nextTab');
  assert.equal(r.commandFor(key('PageUp')), 'prevTab');
});

test('blocker: a request without a referrer is judged against the frame that made it', () => {
  const b = new Blocker(require('os').tmpdir());
  let seen = null;
  b.lib = { fromElectronDetails: d => { seen = d; return {}; } };
  b.engine = { match: () => ({ match: false }) };
  b.custom = null;
  b.match({ url: 'https://static.example-cdn.net/a.js', resourceType: 'script', referrer: '', frame: { url: 'https://www.example.com/feed' } });
  assert.equal(seen.referrer, 'https://www.example.com/feed');
  b.match({ url: 'https://x.example/y', resourceType: 'script', referrer: 'https://keep.example/', frame: { url: 'https://other.example/' } });
  assert.equal(seen.referrer, 'https://keep.example/');
  b.match({ url: 'https://x.example/', resourceType: 'mainFrame', referrer: '', frame: { url: 'ferna://newtab/' } });
  assert.equal(seen.referrer, '');
});
