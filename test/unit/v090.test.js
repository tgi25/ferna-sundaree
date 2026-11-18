'use strict';
// 0.9.0: permissions for video-call sites, extension shortcuts and downloads, Ferna Tabs 1.16 rules.
const test = require('node:test');
const assert = require('node:assert');
const P = require('../../src/main/policy');

test('permissions 0.9: camera and microphone are separate; a session answer counts; speakers follow the microphone', () => {
  const o = 'https://app.zoom.us';
  assert.strictEqual(P.permissionDecision('media', o, {}, 'audio'), 'ask');
  const grants = new Map([[P.permissionKey(o, 'media', 'audio'), 'allow']]);
  assert.strictEqual(P.permissionDecision('media', o, {}, 'audio', grants), 'allow');
  assert.strictEqual(P.permissionDecision('media', o, {}, 'video', grants), 'ask', 'microphone does not grant the camera');
  assert.strictEqual(P.permissionDecision('media', o, {}, undefined, grants), 'allow', 'a device list check: either answer counts');
  assert.strictEqual(P.permissionDecision('speaker-selection', o, {}, undefined, grants), 'allow');
  assert.strictEqual(P.permissionDecision('speaker-selection', o, {}), 'deny');
  // saved answers, and older saves for both
  assert.strictEqual(P.permissionDecision('media', o, { [`${o}|media:video`]: 'deny' }, 'video'), 'deny');
  assert.strictEqual(P.permissionDecision('media', o, { [`${o}|media`]: 'allow' }, 'video'), 'allow');
  // the screen-sharing picker is the consent; wake lock is harmless
  assert.strictEqual(P.permissionDecision('display-capture', o, {}), 'allow');
  assert.strictEqual(P.permissionDecision('screen-wake-lock', o, {}), 'allow');
  assert.strictEqual(P.permissionDecision('usb', o, {}), 'deny');
  assert.strictEqual(P.permissionKey(o, 'media', 'video'), `${o}|media:video`);
  assert.strictEqual(P.permissionKey(o, 'notifications'), `${o}|notifications`);
});

test('extension shortcuts 0.9: Chrome key names, platform keys, built-in shortcuts win, first extension wins', () => {
  const X = require('../../src/main/crxmore');
  assert.deepStrictEqual(X.parseChromeKey('Alt+Shift+Up'), { ctrl: false, shift: true, alt: true, meta: false, code: 'ArrowUp' });
  assert.deepStrictEqual(X.parseChromeKey('Ctrl+Shift+Comma'), { ctrl: true, shift: true, alt: false, meta: false, code: 'Comma' });
  assert.strictEqual(X.parseChromeKey('MacCtrl+Shift+0').code, 'Digit0');
  assert.strictEqual(X.parseChromeKey('nonsense+'), null);
  assert.strictEqual(X.suggestedKey({ suggested_key: { default: 'Alt+Shift+N', windows: 'Alt+Shift+W' } }, 'win32'), 'Alt+Shift+W');
  assert.strictEqual(X.suggestedKey({ suggested_key: { default: 'Alt+Shift+N' } }, 'linux'), 'Alt+Shift+N');
  assert.strictEqual(X.suggestedKey({}, 'linux'), '');
  const exts = [
    { id: 'a', manifest: { commands: { one: { suggested_key: { default: 'Alt+Shift+V' } }, two: { suggested_key: { default: 'Ctrl+T' } }, none: {} } } },
    { id: 'b', manifest: { commands: { three: { suggested_key: { default: 'Alt+Shift+V' } }, four: { suggested_key: { default: 'Alt+Shift+Q' } } } } },
  ];
  const builtIn = spec => spec.ctrl && spec.code === 'KeyT';
  const t = X.commandTable(exts, builtIn, 'linux');
  assert.deepStrictEqual(t.map(c => `${c.extId}:${c.name}`), ['a:one', 'b:four']);
});

test('extension downloads 0.9: file names stay inside the downloads folder', () => {
  const { safeRelative } = require('../../src/main/crxmore');
  assert.deepStrictEqual(safeRelative('Ferna Screenshot/shot 1.png'), ['Ferna Screenshot', 'shot 1.png']);
  assert.deepStrictEqual(safeRelative('../../etc/passwd'), ['etc', 'passwd']);
  assert.deepStrictEqual(safeRelative('C:\\Windows\\x.png'), ['C_', 'Windows', 'x.png']);
  assert.deepStrictEqual(safeRelative('a/b/c/d/e/f.png'), ['c', 'd', 'e', 'f.png']);
  assert.deepStrictEqual(safeRelative(''), []);
});

test('Ferna Tabs 1.16: ranked matching (initials and gaps, word starts, recent tabs, bookmarks after tabs)', () => {
  const M = require('../../src/pages/_shared/tabsmatch');
  assert.ok(M.score('lec3', 'Lecture 3 — Swarm Intelligence') > 0, 'initials and gaps');
  assert.strictEqual(M.score('xyz', 'Lecture 3'), 0);
  assert.ok(M.score('swarm', 'Lecture 3 — Swarm Intelligence') > M.score('warm', 'Lecture 3 — Swarm Intelligence'), 'word start beats the middle of a word');
  assert.ok(M.score('mail', 'Inbox — mail.google.com') >= 100);
  const now = Date.UTC(2026, 10, 18);
  const tabs = [
    { id: 1, title: 'Lecture 3 notes', url: 'https://lms.sjp.ac.lk/l3', lastActive: now - 10 * 86400e3 },
    { id: 2, title: 'Lecture 3 slides', url: 'https://lms.sjp.ac.lk/s3', lastActive: now - 60e3 },
    { id: 3, title: 'Weather', url: 'https://weather.lk', lastActive: now },
  ];
  const bms = [{ title: 'Lecture 3 recording', url: 'https://video.sjp.ac.lk/3' }, { title: 'Lecture 3 notes', url: 'https://lms.sjp.ac.lk/l3' }];
  const r = M.rank('lec 3', tabs, bms, now);
  assert.deepStrictEqual(r.map(x => `${x.kind}:${x.item.title}`), ['tab:Lecture 3 slides', 'tab:Lecture 3 notes', 'bm:Lecture 3 recording'], 'recent first; open page not repeated as a bookmark');
});

test('Ferna Tabs 1.16: duplicates (query and #part ignored, the tab in use kept), forgotten tabs, parked date, list settings', () => {
  const M = require('../../src/pages/_shared/tabsmatch');
  const now = Date.UTC(2026, 10, 18);
  const tabs = [
    { id: 1, url: 'https://a.com/x?utm=1', lastActive: now - 5e3 },
    { id: 2, url: 'https://a.com/x#top', lastActive: now - 1e3 },
    { id: 3, url: 'https://a.com/x/', lastActive: now - 9 * 86400e3 },
    { id: 4, url: 'https://b.com/', lastActive: now - 20 * 86400e3 },
    { id: 5, url: 'ferna://newtab/', lastActive: now - 30 * 86400e3 },
  ];
  const d = M.duplicates(tabs, 1);
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].keep.id, 1, 'the tab in use is kept');
  assert.deepStrictEqual(d[0].close.map(t => t.id).sort(), [2, 3]);
  assert.strictEqual(M.duplicates(tabs, 99)[0].keep.id, 2, 'else the most recently used');
  assert.deepStrictEqual(M.forgotten(tabs, 7, 1, now).map(t => t.id), [5, 4, 3], 'oldest first');
  assert.strictEqual(M.parkedLabel(new Date(2026, 10, 12, 10).getTime()), 'Parked 12 Nov');
  const c = M.cleanListSettings({ width: 5000, rows: 'huge', font: 'Comic Sans', fontSize: 15, icons: 20, pageRow: false, forgetDays: 3 });
  assert.deepStrictEqual([c.width, c.rows, c.font, c.fontSize, c.icons, c.pageRow, c.forgetDays], [900, 'normal', '', 15, 20, false, 3]);
});
