'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');
const U = require('../../src/main/updater');

test('updater: version order, no downgrades', () => {
  assert.equal(U.compareVersions('0.4.0', '0.3.1'), 1);
  assert.equal(U.compareVersions('0.3.10', '0.3.9'), 1);
  assert.equal(U.compareVersions('1.0.0', '1.0.0-beta.2'), 1);
  assert.equal(U.compareVersions('v0.4.0', '0.4.0'), 0);
  assert.equal(U.compareVersions('0.3.0', '0.4.0'), -1);
});

test('updater: only a manifest signed with the right key is accepted', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const other = crypto.generateKeyPairSync('ed25519');
  const pub = publicKey.export({ type: 'spki', format: 'pem' });
  const bytes = Buffer.from('{"product":"ferna-sundaree","version":"9.9.9"}');
  const sig = crypto.sign(null, bytes, privateKey).toString('base64');
  assert.ok(U.verifyManifest(bytes, sig, pub));
  assert.ok(!U.verifyManifest(Buffer.from(bytes.toString().replace('9.9.9', '9.9.8')), sig, pub), 'tampered manifest');
  assert.ok(!U.verifyManifest(bytes, crypto.sign(null, bytes, other.privateKey).toString('base64'), pub), 'wrong key');
  assert.ok(!U.verifyManifest(bytes, 'not base64 !!', pub));
  assert.throws(() => U.validateManifest({ product: 'other', version: '1.0.0', files: {} }));
  assert.throws(() => U.validateManifest({ product: 'ferna-sundaree', version: '1.0.0', files: { setup: { name: '../evil.exe', sha256: 'a'.repeat(64), size: 1 } } }));
  const ok = U.validateManifest({ product: 'ferna-sundaree', version: '1.2.3', files: { setup: { name: 'FernaSundaree-Setup-1.2.3.exe', sha256: 'a'.repeat(64), size: 10 } } });
  assert.equal(ok.files.setup.size, 10);
});

test('updater: the embedded public key is a valid Ed25519 key', () => {
  const k = crypto.createPublicKey(require('../../src/main/update-key'));
  assert.equal(k.asymmetricKeyType, 'ed25519');
});

test('updater: install kind from the program location', () => {
  const env = { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\t\\AppData\\Local' };
  assert.equal(U.installKind('C:\\Program Files\\Ferna Sundaree\\Ferna Sundaree.exe', env, 'win32'), 'msi');
  assert.equal(U.installKind(path.join('C:\\Users\\t\\AppData\\Local', 'Programs', 'ferna-sundaree', 'Ferna Sundaree.exe'), env, 'win32'), 'setup');
  assert.equal(U.installKind('D:\\x.exe', { ...env, PORTABLE_EXECUTABLE_DIR: 'D:\\' }, 'win32'), 'portable');
});

test('updater: end to end against a local release — signed, verified, checksum enforced', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const installer = Buffer.from('MZ fake installer bytes '.repeat(200));
  let serve = installer;
  const files = { setup: { name: 'FernaSundaree-Setup-9.0.0.exe', size: installer.length, sha256: crypto.createHash('sha256').update(installer).digest('hex') } };
  const manifest = Buffer.from(JSON.stringify({ product: 'ferna-sundaree', version: '9.0.0', files }));
  const sig = crypto.sign(null, manifest, privateKey).toString('base64');
  const srv = http.createServer((req, res) => {
    const base = `http://127.0.0.1:${srv.address().port}`;
    if (req.url === '/latest') { res.end(JSON.stringify({ assets: [{ name: 'update.json', browser_download_url: `${base}/m` }, { name: 'update.json.sig', browser_download_url: `${base}/s` }, { name: files.setup.name, browser_download_url: `${base}/f` }] })); return; }
    if (req.url === '/m') return res.end(manifest);
    if (req.url === '/s') return res.end(sig);
    if (req.url === '/f') return res.end(serve);
    res.writeHead(404); res.end();
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    const ctx = { settings: { data: {} } };
    const up = new U.Updater(ctx, { publicKey: publicKey.export({ type: 'spki', format: 'pem' }), currentVersion: '0.4.0', releasesUrl: `http://127.0.0.1:${srv.address().port}/latest`, allowAnyHost: true });
    const st = await up.check();
    assert.equal(st.status, 'available', st.error);
    const file = await up.download('setup');
    assert.deepEqual(fs.readFileSync(file), installer);
    assert.deepEqual(up.install({ dryRun: true }), [file, ['/S', '--updated']]);
    // A tampered installer is refused.
    serve = Buffer.from(installer); serve[5] ^= 1;
    up.state.status = 'available';
    await assert.rejects(() => up.download('setup'), /checksum/);
    // Same version: nothing to do. Wrong key: refused.
    const same = new U.Updater(ctx, { publicKey: publicKey.export({ type: 'spki', format: 'pem' }), currentVersion: '9.0.0', releasesUrl: `http://127.0.0.1:${srv.address().port}/latest`, allowAnyHost: true });
    assert.equal((await same.check()).status, 'current');
    const wrong = new U.Updater(ctx, { publicKey: crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }), currentVersion: '0.4.0', releasesUrl: `http://127.0.0.1:${srv.address().port}/latest`, allowAnyHost: true });
    const w = await wrong.check();
    assert.equal(w.status, 'error'); assert.match(w.error, /signature/);
    // Real hosts only (without the test switch).
    const strict = new U.Updater(ctx, { publicKey: 'x', currentVersion: '0.4.0', releasesUrl: `http://127.0.0.1:${srv.address().port}/latest` });
    assert.match((await strict.check()).error, /https only|unexpected host/);
  } finally { srv.close(); }
});

test('privacy: tracking tags removed, real parameters kept', () => {
  const { stripTracking } = require('../../src/main/privacy');
  assert.equal(stripTracking('https://news.example/a?utm_source=x&utm_medium=y&id=5&fbclid=abc#top'), 'https://news.example/a?id=5#top');
  assert.equal(stripTracking('https://shop.example/p?gclid=1'), 'https://shop.example/p');
  assert.equal(stripTracking('https://shop.example/p?q=utm_source'), 'https://shop.example/p?q=utm_source');
  assert.equal(stripTracking('https://www.google.com/search?q=x&gclid=1'), 'https://www.google.com/search?q=x&gclid=1');
  assert.equal(stripTracking('ferna://settings/?utm_source=1'), 'ferna://settings/?utm_source=1');
});

test('look-alike addresses: imitations flagged, real and visited sites not', () => {
  const L = require('../../src/main/lookalike');
  const flag = h => (L.check(h) || {}).suggest;
  assert.equal(flag('xn--pypal-4ve.com'), 'paypal.com');   // Cyrillic а
  assert.equal(flag('paypa1.com'), 'paypal.com');
  assert.equal(flag('rnicrosoft.com'), 'microsoft.com');
  assert.equal(flag('amazom.com'), 'amazon.com');
  assert.equal(flag('paypal.com.secure-check.xyz'), 'paypal.com');
  assert.equal(flag('combank.lk.verify.top'), 'combank.lk');
  assert.equal(flag('netflix-login.com'), 'netflix.com');
  assert.equal(flag('5ampath.lk'), 'sampath.lk');
  for (const ok of ['paypal.com', 'google.lk', 'mail.google.com', 'yahoo.co.jp', 'finance.gov.lk', 'ping.com', 'sjp.ac.lk', 'github.io']) assert.equal(L.check(ok), null, ok);
  assert.equal(L.check('paypa1.com', new Set(['paypa1.com'])), null, 'visited before');
  assert.equal(L.check('rnyuni.edu', new Set(), ['myuni.edu']).suggest, 'myuni.edu', 'your bookmarks are protected too');
});

test('defender: scan command and result mapping', async () => {
  const D = require('../../src/main/defender');
  assert.deepEqual(D.scanArgs('C:\\d\\a.exe'), ['-Scan', '-ScanType', '3', '-File', 'C:\\d\\a.exe']);
  const fake = code => (exe, args, opts, cb) => cb(code === 0 ? null : Object.assign(new Error('x'), { code }));
  assert.equal(await D.scan('a', { exe: 'mp', run: fake(0), platform: 'win32' }), 'clean');
  assert.equal(await D.scan('a', { exe: 'mp', run: fake(2), platform: 'win32' }), 'threat');
  assert.equal(await D.scan('a', { exe: 'mp', run: fake(5), platform: 'win32' }), 'unavailable');
  assert.equal(await D.scan('a', { exe: null, platform: 'win32' }), 'unavailable');
});

test('privacy preloads and password script compile', () => {
  const vm = require('vm');
  for (const f of ['privacy-fp.js', 'privacy-gpc.js']) assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(__dirname, '../../src/preload', f), 'utf8')), f);
  assert.doesNotThrow(() => new vm.Script(require('../../src/main/pagefx/password').SCRIPT));
});

test('strict ZIP reader: normal package ok; slip, duplicates, links, bombs refused; store library routed through it', () => {
  const os = require('os');
  const zlib = require('zlib');
  const Z = require('../../src/main/zipsafe');
  // Minimal ZIP writer so the tests control every header field.
  function zip(list) {
    const locals = [], centrals = [];
    let off = 0;
    for (const f of list) {
      const name = Buffer.from(f.name, 'utf8');
      const raw = Buffer.from(f.data || '');
      const comp = f.method === 0 ? raw : zlib.deflateRawSync(raw);
      const size = f.fakeSize !== undefined ? f.fakeSize : raw.length;
      const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(f.method === 0 ? 0 : 8, 8);
      lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(size, 22); lh.writeUInt16LE(name.length, 26);
      const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(f.unix ? (3 << 8) | 20 : 20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(f.method === 0 ? 0 : 8, 10);
      ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(size, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(f.unix ? (f.unix << 16) >>> 0 : 0, 38); ch.writeUInt32LE(off, 42);
      locals.push(lh, name, comp); centrals.push(ch, name);
      off += 30 + name.length + comp.length;
    }
    const cd = Buffer.concat(centrals);
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(list.length, 8); end.writeUInt16LE(list.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
    return Buffer.concat([...locals, cd, end]);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-'));
  const ok = zip([{ name: 'manifest.json', data: '{"name":"x"}' }, { name: 'img/', data: '' }, { name: 'img/a.txt', data: 'hello'.repeat(100), method: 0 }]);
  assert.deepEqual(Z.extract(ok, path.join(dir, 'ok')), ['manifest.json', 'img/a.txt']);
  assert.equal(fs.readFileSync(path.join(dir, 'ok', 'img', 'a.txt'), 'utf8'), 'hello'.repeat(100));
  assert.throws(() => Z.extract(zip([{ name: '../evil.txt', data: 'x' }]), path.join(dir, 'slip')), /Unsafe path/);
  assert.throws(() => Z.extract(zip([{ name: 'C:/evil.txt', data: 'x' }]), path.join(dir, 'drive')), /Unsafe path/);
  assert.throws(() => Z.extract(zip([{ name: 'a.js', data: '1' }, { name: 'A.JS', data: '2' }]), path.join(dir, 'dup')), /Duplicate/);
  assert.throws(() => Z.extract(zip([{ name: 'link', data: '/etc/passwd', unix: 0o120777 }]), path.join(dir, 'lnk')), /Links/);
  assert.throws(() => Z.extract(zip([{ name: 'bomb.bin', data: Buffer.alloc(5 * 1024 * 1024), fakeSize: 100 }]), path.join(dir, 'bomb')), /buffer|length|Size|larger/i);
  assert.throws(() => Z.extract(zip([{ name: 'big.bin', data: Buffer.alloc(3000) }]), path.join(dir, 'cap'), { ...Z.LIMITS, maxTotal: 1000, maxFile: 1000 }), /too large/);
  // electron-chrome-web-store's adm-zip calls now go through the strict reader.
  assert.ok(Z.hardenAdmZip());
  const AdmZip = require(require.resolve('adm-zip', { paths: [path.dirname(require.resolve('electron-chrome-web-store'))] }));
  assert.throws(() => new AdmZip(zip([{ name: '../../evil.txt', data: 'x' }])).extractAllTo(path.join(dir, 'lib')), /Unsafe path/);
  new AdmZip(ok).extractAllTo(path.join(dir, 'lib-ok'));
  assert.ok(fs.existsSync(path.join(dir, 'lib-ok', 'manifest.json')));
});
