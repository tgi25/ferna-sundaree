'use strict';
const test = require('node:test');
const assert = require('node:assert');
const p = require('../../src/main/policy');

test('HTTPS-first upgrades public hosts only', () => {
  assert.ok(p.shouldUpgrade('http://example.com/a'));
  assert.ok(!p.shouldUpgrade('https://example.com/'));
  for (const h of ['localhost', '127.0.0.1', '10.0.0.5', '192.168.1.1', '172.20.1.1', 'router', 'nas.local', '[::1]']) {
    assert.ok(!p.shouldUpgrade(`http://${h}/`), h);
  }
  assert.ok(!p.shouldUpgrade('http://old.example.com/', ['old.example.com']));
  assert.strictEqual(p.upgradeUrl('http://example.com:80/x?y'), 'https://example.com/x?y');
});

test('address bar input: URLs, hosts, searches; javascript: refused', () => {
  assert.strictEqual(p.normalizeInput('example.com'), 'https://example.com');
  assert.strictEqual(p.normalizeInput('localhost:3000/x'), 'http://localhost:3000/x');
  assert.strictEqual(p.normalizeInput('https://a.b/c'), 'https://a.b/c');
  assert.strictEqual(p.normalizeInput('swarm intelligence', 'duckduckgo'), 'https://duckduckgo.com/?q=swarm%20intelligence');
  assert.ok(!/^javascript:/i.test(p.normalizeInput('javascript:alert(1)')), 'never loads a javascript: URL');
  assert.strictEqual(p.normalizeInput('javascript://x'), null);
  assert.strictEqual(p.normalizeInput('   '), null);
});

test('risky downloads and Mark of the Web', () => {
  assert.ok(p.isRiskyDownload('setup.EXE'));
  assert.ok(p.isRiskyDownload('invoice.docm'));
  assert.ok(!p.isRiskyDownload('paper.pdf'));
  const z = p.zoneIdentifier('https://x.com/a.exe', 'https://x.com/');
  assert.match(z, /^\[ZoneTransfer\]\r\nZoneId=3\r\n/);
  assert.ok(!/\n[^\r]/.test(z.replace(/\r\n/g, '')), 'CRLF only');
  assert.ok(!p.zoneIdentifier('https://x/\r\nZoneId=0').includes('\nZoneId=0'));
});

test('permissions: deny by default, ask for promptable, remember choices', () => {
  assert.strictEqual(p.permissionDecision('usb', 'https://a.com'), 'deny');
  assert.strictEqual(p.permissionDecision('openExternal', 'https://a.com'), 'deny');
  assert.strictEqual(p.permissionDecision('media', 'https://a.com'), 'ask');
  assert.strictEqual(p.permissionDecision('fullscreen', 'https://a.com'), 'allow');
  assert.strictEqual(p.permissionDecision('media', 'https://a.com', { 'https://a.com|media': 'allow' }), 'allow');
  assert.strictEqual(p.permissionDecision('media', 'https://b.com', { 'https://a.com|media': 'allow' }), 'ask');
});

test('screenshot file names', () => {
  const n = p.screenshotName('https://www.usj.ac.lk/x', new Date(2026, 9, 31, 8, 5, 9), 'png');
  assert.strictEqual(n, 'usj.ac.lk_2026-10-31_08-05-09.png');
});
