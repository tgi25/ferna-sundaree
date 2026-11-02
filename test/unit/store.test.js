'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { JsonStore, atomicWrite } = require('../../src/main/store');

test('JsonStore saves atomically and keeps unreadable files aside', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-'));
  const f = path.join(dir, 'a.json');
  const s = new JsonStore(f, { n: 1, list: [] });
  s.data.n = 5; s.flush();
  assert.strictEqual(new JsonStore(f, { n: 1 }).data.n, 5);
  fs.writeFileSync(f, '{broken');
  const s2 = new JsonStore(f, { n: 1 });
  assert.strictEqual(s2.data.n, 1);
  assert.ok(fs.readdirSync(dir).some(x => x.startsWith('a.json.bad-')));
  atomicWrite(path.join(dir, 'b.bin'), Buffer.from('x'));
  assert.ok(!fs.readdirSync(dir).some(x => x.endsWith('.tmp')));
});

test('memory-only stores never touch disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-'));
  const s = new JsonStore(path.join(dir, 'm.json'), { a: 1 }, { memoryOnly: true });
  s.set('a', 2); s.flush();
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});
