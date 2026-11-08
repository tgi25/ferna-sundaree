'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseAccelerator, ShortcutRegistry, DEFAULTS } = require('../../src/main/shortcuts');
const { computeLayout } = require('../../src/main/layout');

const key = (code, mods = {}) => ({ type: 'keyDown', code, control: !!mods.c, shift: !!mods.s, alt: !!mods.a, meta: false });

test('every default accelerator parses and no two commands share one', () => {
  const seen = new Map();
  for (const [cmd, accs] of Object.entries(DEFAULTS)) {
    for (const a of accs) {
      const s = parseAccelerator(a);
      assert.ok(s, `${cmd}: ${a}`);
      const k = JSON.stringify(s);
      assert.ok(!seen.has(k), `${a} used by ${seen.get(k)} and ${cmd}`);
      seen.set(k, cmd);
    }
  }
});

test('requirement shortcuts resolve to their commands', () => {
  const r = new ShortcutRegistry();
  assert.strictEqual(r.commandFor(key('KeyH', { c: 1, s: 1 })), 'toggleTabBar');
  assert.strictEqual(r.commandFor(key('KeyB', { c: 1, s: 1 })), 'toggleBookmarksBar');
  assert.strictEqual(r.commandFor(key('Comma', { c: 1, s: 1 })), 'cycleTabPosition');
  assert.strictEqual(r.commandFor(key('KeyA', { c: 1, s: 1 })), 'tabOverview');
  assert.strictEqual(r.commandFor(key('KeyL', { a: 1, s: 1 })), 'tabsAtPointer');
  assert.strictEqual(r.commandFor(key('KeyH')), null);
  assert.strictEqual(r.commandFor({ ...key('KeyH', { c: 1, s: 1 }), type: 'keyUp' }), null);
});

test('overrides apply and conflicts are reported', () => {
  const r = new ShortcutRegistry({ toggleTabBar: ['Alt+T'] });
  assert.strictEqual(r.commandFor(key('KeyT', { a: 1 })), 'toggleTabBar');
  assert.strictEqual(r.commandFor(key('KeyH', { c: 1, s: 1 })), null);
  assert.strictEqual(r.conflict('toggleTabBar', 'Ctrl+T'), 'newTab');
  assert.strictEqual(r.conflict('toggleTabBar', 'Ctrl+Shift+J'), null);
  assert.strictEqual(r.conflict('toggleTabBar', 'Ctrl+Shift+U'), 'readAloud');
  assert.strictEqual(r.conflict('toggleTabBar', 'Hyper+Q'), 'invalid');
});

test('layout: top, hidden, vertical, collapsed, focus, find, fullscreen', () => {
  const base = { position: 'top', vwidth: 240 };
  let L = computeLayout(1200, 800, base);
  assert.deepStrictEqual(L.content, { x: 0, y: 112, width: 1200, height: 688 });
  L = computeLayout(1200, 800, { ...base, tabBarHidden: true });
  assert.ok(!L.tabs && !L.toolbar && !L.edgeTabs && L.content.y === 30);
  L = computeLayout(1200, 800, { ...base, position: 'left' });
  assert.deepStrictEqual(L.tabs, { x: 0, y: 74, width: 240, height: 726 });
  assert.strictEqual(L.content.x, 240);
  L = computeLayout(1200, 800, { ...base, position: 'right', collapsed: true });
  assert.strictEqual(L.tabs.x, 1200 - 52);
  assert.strictEqual(L.content.width, 1200 - 52);
  L = computeLayout(1200, 800, { ...base, focus: true });
  assert.ok(!L.toolbar && !L.tabs && !L.bookmarks && L.content.y === 5);
  L = computeLayout(1200, 800, { ...base, findOpen: true });
  assert.strictEqual(L.content.y, 112 + 40);
  L = computeLayout(1200, 800, { ...base, htmlFullscreen: true });
  assert.deepStrictEqual(L.content, { x: 0, y: 0, width: 1200, height: 800 });
});
