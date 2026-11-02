'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function shield() {
  // Load the YouTube preload with stand-ins and capture the function it injects.
  let fn = null;
  const src = fs.readFileSync(path.join(__dirname, '../../src/preload/yt-shield.js'), 'utf8');
  vm.runInNewContext(src, {
    require: () => ({ contextBridge: { executeInMainWorld: ({ func }) => { fn = func; } } }),
    location: { hostname: 'www.youtube.com' }, process: { env: {} },
  });
  return fn;
}

test('YouTube shield: prunes the ad schedule from parsed and inline player data', async () => {
  const fn = shield();
  assert.equal(typeof fn, 'function');
  const win = { JSON: { parse: JSON.parse }, Response: class { constructor(o) { this.o = o; } json() { return Promise.resolve(this.o); } } };
  win.window = win;
  vm.runInNewContext(`(${fn})()`, win);
  const parsed = win.JSON.parse('{"playerResponse":{"adPlacements":[1],"streamingData":{}},"playerAds":[2]}');
  assert.deepEqual(Object.keys(parsed), ['playerResponse']);
  assert.deepEqual(Object.keys(parsed.playerResponse), ['streamingData']);
  assert.deepEqual(win.JSON.parse('{"a":1}'), { a: 1 });
  const fetched = await new win.Response({ adSlots: [1], videoDetails: {} }).json();
  assert.deepEqual(Object.keys(fetched), ['videoDetails']);
  vm.runInNewContext('window.ytInitialPlayerResponse = { adPlacements: [1], videoDetails: { title: "t" } }', win);
  assert.deepEqual(Object.keys(win.ytInitialPlayerResponse), ['videoDetails']);
});

test('YouTube shield: does nothing on other sites', () => {
  let called = false;
  const src = fs.readFileSync(path.join(__dirname, '../../src/preload/yt-shield.js'), 'utf8');
  vm.runInNewContext(src, { require: () => ({ contextBridge: { executeInMainWorld: () => { called = true; } } }), location: { hostname: 'notyoutube.com' }, process: { env: {} } });
  assert.equal(called, false);
});

test('equalizer: presets are 10-band, config is clamped, script compiles', () => {
  const eq = require('../../src/main/pagefx/eq');
  for (const [k, p] of Object.entries(eq.PRESETS)) assert.equal(p.gains.length, 10, k);
  assert.deepEqual(eq.clean({ enabled: 1, preset: 'zzz', gains: [99, -99, 1.26, 0, 0, 0, 0, 0, 0, 0] }), { enabled: true, auto: false, preset: 'flat', gains: [12, -12, 1.5, 0, 0, 0, 0, 0, 0, 0] });
  assert.doesNotThrow(() => new vm.Script(eq.SCRIPT));
  for (const g of eq.AUTO_GENRES) assert.ok(eq.PRESETS[g] && eq.KEYWORDS[g], g);
});

test('selection menu and PiP scripts compile', () => {
  assert.doesNotThrow(() => new vm.Script(require('../../src/main/pagefx/selection').SCRIPT));
  assert.doesNotThrow(() => new vm.Script(require('../../src/main/pagefx/pip').TOGGLE));
  assert.doesNotThrow(() => new vm.Script(require('../../src/main/pagefx/youtube').WATCH));
});

test('safe browsing lists: whole sites, single pages, parent domains, no false matches', () => {
  const { parseList, matchList } = require('../../src/main/safety');
  const l = parseList(`! Title: Phishing URL Blocklist
||bad-login.example^
||evil.test^$all
||docs.google.com/forms/d/e/abc123
|http://198.51.100.7/payload.exe|
example.org##.x
@@||good.example^`);
  assert.ok(matchList(l, 'https://bad-login.example/'));
  assert.ok(matchList(l, 'https://secure.bad-login.example/verify'), 'sub-domain of a listed site');
  assert.ok(matchList(l, 'http://evil.test/x'));
  assert.ok(matchList(l, 'https://docs.google.com/forms/d/e/abc123/viewform'));
  assert.ok(!matchList(l, 'https://docs.google.com/forms/d/e/other'), 'other pages of a popular site stay open');
  assert.ok(matchList(l, 'http://198.51.100.7/payload.exe'));
  assert.ok(!matchList(l, 'https://notbad-login.example/'), 'look-alike suffix is not a match');
  assert.ok(!matchList(l, 'https://example.org/'));
  assert.ok(!matchList(l, 'https://good.example/'));
  assert.ok(!matchList(l, 'ferna://settings/'));
});

test('element picker script compiles', () => {
  assert.doesNotThrow(() => new vm.Script(require('../../src/main/pagefx/picker').script({ x: 10, y: 20 })));
});
