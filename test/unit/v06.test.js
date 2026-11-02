'use strict';
// 0.6: equalizer genres and saved presets, password hashing, exam settings and allowed sites,
// parental-control lists and SafeSearch, contextual theme colours.
const test = require('node:test');
const assert = require('node:assert');
const eq = require('../../src/main/pagefx/eq');
const secret = require('../../src/main/secret');
const exam = require('../../src/main/exam');
const par = require('../../src/main/parental');
const th = require('../../src/main/ctxtheme');

test('equalizer: new genres have presets, keywords and a sound family; script compiles', () => {
  for (const g of ['reggae', 'dub', 'synthwave', 'bossanova', 'afrobeats', 'bhangra', 'ambient', 'baila']) {
    assert.ok(eq.PRESETS[g] && eq.PRESETS[g].gains.length === 10 && eq.KEYWORDS[g].length && eq.AUTO_GENRES.includes(g), g);
    assert.ok(eq.PRESETS[g].gains.every(v => v >= -12 && v <= 12));
    assert.ok(eq.FAMILY[g] in eq.PRESETS);
  }
  assert.ok(!eq.KEYWORDS.electronic.includes('synthwave') && !eq.KEYWORDS.jazz.includes('bossa nova'));
  assert.doesNotThrow(() => new Function(eq.SCRIPT));
});

test('equalizer: your presets are cleaned and a named custom preset keeps its name', () => {
  const list = eq.cleanUserPresets([{ name: '  My Baila ', gains: [13, -20, 1.26, 0, 0, 0, 0, 0, 0, 0] }, { name: '', gains: [] }, { name: 'bad', gains: [1] }]);
  assert.strictEqual(list.length, 1);
  assert.deepStrictEqual([list[0].name, list[0].gains.slice(0, 3)], ['My Baila', [12, -12, 1.5]]);
  assert.match(list[0].id, /^u/);
  assert.strictEqual(eq.clean({ preset: 'custom', gains: list[0].gains, customName: 'My Baila', enabled: true }).customName, 'My Baila');
  assert.strictEqual(eq.clean({ preset: 'rock', customName: 'x' }).customName, undefined);
});

test('passwords for parents and invigilators: scrypt hash, constant-time verify', () => {
  const h = secret.hash('invigilator-1');
  assert.ok(secret.valid(h) && !JSON.stringify(h).includes('invigilator'));
  assert.ok(secret.verify('invigilator-1', h));
  assert.ok(!secret.verify('invigilator-2', h));
  assert.ok(!secret.verify('x', { salt: 'a', hash: 'b' }));
});

test('exam: settings validated; only the exam site and listed sites are allowed', () => {
  assert.throws(() => exam.cleanConfig({ url: 'ftp://x' }), /https/);
  const c = exam.cleanConfig({ title: 'Quiz', url: 'https://lms.sjp.ac.lk/quiz?id=3', allowed: '*.sjp.ac.lk\naccounts.google.com\nhttps://docs.example.com/allowed/\nnot a host!!', minutes: 9999, allowCopy: 1 });
  assert.deepStrictEqual([c.minutes, c.allowCopy, c.allowed.length], [600, true, 3]);
  const ok = u => exam.allowedUrl(c, u);
  assert.ok(ok('https://lms.sjp.ac.lk/other'));
  assert.ok(ok('https://library.sjp.ac.lk/x') && ok('https://sjp.ac.lk/'));
  assert.ok(ok('https://accounts.google.com/signin') && !ok('https://mail.google.com/'));
  assert.ok(ok('https://docs.example.com/allowed/page') && !ok('https://docs.example.com/other'));
  assert.ok(!ok('https://chatgpt.com/') && !ok('https://sjp.ac.lk.evil.com/') && !ok('file:///C:/notes.txt'));
  assert.ok(exam.ALLOWED_CMDS.has('reload') && !exam.ALLOWED_CMDS.has('newTab') && !exam.ALLOWED_CMDS.has('devtools'));
});

test('parental: hosts lists parsed, parent domains matched, adult names caught, SafeSearch forced', () => {
  const set = par.parseHosts('# c\n0.0.0.0 www.badsite.com\n127.0.0.1 other.net # x\n0.0.0.0 localhost\n::1 ip6\n');
  assert.deepStrictEqual([...set].sort(), ['badsite.com', 'other.net']);
  assert.strictEqual(par.inSet(set, 'cdn.badsite.com'), 'badsite.com');
  assert.strictEqual(par.inSet(set, 'notbadsite.com'), null);
  assert.ok(par.ADULT_NAME.test('free-porn.example') && par.ADULT_NAME.test('xxx.example.com'));
  assert.ok(!par.ADULT_NAME.test('essex.ac.uk') && !par.ADULT_NAME.test('sussex.com') && !par.ADULT_NAME.test('middlesex.ac.uk'));
  assert.match(par.safeSearchUrl('https://www.google.lk/search?q=cats'), /safe=active/);
  assert.strictEqual(par.safeSearchUrl('https://www.google.com/search?q=cats&safe=active'), null);
  assert.match(par.safeSearchUrl('https://www.bing.com/search?q=a'), /adlt=strict/);
  assert.match(par.safeSearchUrl('https://duckduckgo.com/?q=a'), /kp=1/);
  assert.match(par.safeSearchUrl('https://search.brave.com/search?q=a'), /safesearch=strict/);
  assert.strictEqual(par.safeSearchUrl('https://www.google.com/maps'), null);
});

test('themes: workspace palettes for light and dark; dominant colour of a picture', () => {
  const light = th.palette('#16a34a', false), dark = th.palette('#16a34a', true);
  assert.strictEqual(light.accent, '#16a34a');
  assert.ok(parseInt(light.toolbar.slice(1, 3), 16) > 200 && parseInt(dark.toolbar.slice(1, 3), 16) < 60);
  assert.strictEqual(th.palette('nope', false), null);
  const w = 10, h = 10, bmp = Buffer.alloc(w * h * 4, 255);
  for (let i = 0; i < 40; i++) { bmp[i * 4] = 0x5b; bmp[i * 4 + 1] = 0x18; bmp[i * 4 + 2] = 0xc2; } // BGRA magenta-ish
  const c = th.dominant(bmp, w, h);
  assert.ok(c && parseInt(c.slice(1, 3), 16) > 150 && parseInt(c.slice(3, 5), 16) < 60, c);
  assert.strictEqual(th.dominant(Buffer.alloc(w * h * 4, 128), w, h), null); // grey page
});
