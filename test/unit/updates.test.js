'use strict';
// 0.6.2: update mirrors besides GitHub — newest signed manifest wins, downloads fall through
// to the next location, an organisation's server (policy) replaces all others.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const U = require('../../src/main/updater');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'pem' });
const installer = Buffer.from('MZ installer '.repeat(300));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
function release(version, key = privateKey) {
  const files = { setup: { name: `FernaSundaree-Setup-${version}.exe`, size: installer.length, sha256: sha(installer) } };
  const m = Buffer.from(JSON.stringify({ product: 'ferna-sundaree', version, files }));
  return { m, sig: crypto.sign(null, m, key).toString('base64'), name: files.setup.name };
}

async function server(routes) {
  const hits = [];
  const srv = http.createServer((req, res) => {
    hits.push(req.url);
    const h = routes[decodeURIComponent(req.url)];
    if (!h) { res.writeHead(404); res.end(); return; }
    res.end(typeof h === 'function' ? h(srv) : h);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  srv.base = `http://127.0.0.1:${srv.address().port}`;
  srv.hits = hits;
  return srv;
}
const ctx = (data = {}) => ({ settings: { data } });

test('mirrors: mirror alone works without GitHub; stale mirror loses to a newer GitHub release', async () => {
  const r9 = release('9.0.0'), r8 = release('8.0.0');
  const srv = await server({
    '/a/update.json': r9.m, '/a/update.json.sig': r9.sig, [`/a/${r9.name}`]: installer,
    '/old/update.json': r8.m, '/old/update.json.sig': r8.sig,
    '/gh/latest': s => JSON.stringify({ assets: [['update.json', '/gh/m'], ['update.json.sig', '/gh/s'], [r9.name, '/gh/f']].map(([name, p]) => ({ name, browser_download_url: s.base + p })) }),
    '/gh/m': r9.m, '/gh/s': r9.sig, '/gh/f': installer,
  });
  try {
    const only = new U.Updater(ctx(), { publicKey: PUB, currentVersion: '0.6.1', releasesUrl: null, mirrors: [`${srv.base}/a`] });
    const st = await only.check();
    assert.equal(st.status, 'available', st.error);
    assert.deepEqual(st.available.urls.setup, [`${srv.base}/a/${encodeURIComponent(r9.name)}`]);
    assert.deepEqual(fs.readFileSync(await only.download('setup')), installer);

    const mixed = new U.Updater(ctx(), { publicKey: PUB, currentVersion: '0.6.1', releasesUrl: `${srv.base}/gh/latest`, mirrors: [`${srv.base}/old/`], allowAnyHost: true });
    const m = await mixed.check();
    assert.equal(m.available.version, '9.0.0');
    assert.deepEqual(m.available.sources, ['GitHub']);
    assert.deepEqual(m.available.urls.setup, [`${srv.base}/gh/f`]);
  } finally { srv.close(); }
});

test('mirrors: a forged mirror is ignored; a tampered copy falls through to the next location', async () => {
  const good = release('9.0.0'), forged = release('9.9.9', crypto.generateKeyPairSync('ed25519').privateKey);
  const bad = Buffer.from(installer); bad[3] ^= 1;
  const srv = await server({
    '/evil/update.json': forged.m, '/evil/update.json.sig': forged.sig,
    '/a/update.json': good.m, '/a/update.json.sig': good.sig, [`/a/${good.name}`]: bad,
    '/b/update.json': good.m, '/b/update.json.sig': good.sig, [`/b/${good.name}`]: installer,
  });
  try {
    const up = new U.Updater(ctx(), { publicKey: PUB, currentVersion: '0.6.1', releasesUrl: null, mirrors: [`${srv.base}/evil/`, `${srv.base}/a/`, `${srv.base}/b/`] });
    const st = await up.check();
    assert.equal(st.available.version, '9.0.0');
    assert.equal(st.failed, 1);
    assert.equal(st.available.urls.setup.length, 2);
    assert.deepEqual(fs.readFileSync(await up.download('setup')), installer);
    assert.ok(srv.hits.includes(`/a/${encodeURIComponent(good.name)}`) && srv.hits.includes(`/b/${encodeURIComponent(good.name)}`));
    // Only forged sources: refused with the signature message.
    const lone = new U.Updater(ctx(), { publicKey: PUB, currentVersion: '0.6.1', releasesUrl: null, mirrors: [`${srv.base}/evil/`] });
    assert.match((await lone.check()).error, /signature/);
  } finally { srv.close(); }
});

test('mirrors: the organisation’s server (policy UpdateMirror) replaces every other source', async () => {
  const r = release('9.1.0');
  const srv = await server({ '/org/update.json': r.m, '/org/update.json.sig': r.sig, '/a/update.json': 'x', '/gh/latest': '{}' });
  try {
    const up = new U.Updater(ctx({ updateMirror: `${srv.base}/org` }), { publicKey: PUB, currentVersion: '0.6.1', releasesUrl: `${srv.base}/gh/latest`, mirrors: [`${srv.base}/a/`] });
    const st = await up.check();
    assert.equal(st.available.version, '9.1.0');
    assert.ok(!srv.hits.some(h => h.startsWith('/a/') || h.startsWith('/gh/')), srv.hits.join());
  } finally { srv.close(); }
});

test('mirrors: addresses checked — https (or this computer), no credentials; other hosts refused', async () => {
  assert.equal(U.cleanMirror('https://updates.example.org/ferna'), 'https://updates.example.org/ferna/');
  assert.equal(U.cleanMirror('http://updates.example.org/'), null);
  assert.equal(U.cleanMirror('https://user:pw@example.org/'), null);
  assert.equal(U.cleanMirror('https://example.org/?x=1'), null);
  assert.equal(U.cleanMirror('http://127.0.0.1:8080/u/'), 'http://127.0.0.1:8080/u/');
  assert.equal(U.cleanMirror('not a url'), null);
  const up = new U.Updater(ctx(), { publicKey: PUB, currentVersion: '0.6.1', mirrors: ['https://updates.example.org/'] });
  assert.ok(up.hostAllowed('https://updates.example.org/FernaSundaree-Setup-9.0.0.exe'));
  assert.ok(up.hostAllowed('https://objects.githubusercontent.com/x'));
  assert.ok(!up.hostAllowed('https://evil.example.com/x'));
  assert.ok(!up.hostAllowed('http://updates.example.org/x'));
  assert.ok(Array.isArray(U.builtInMirrors()));
});

test('weekly patch check: newest patch of the same major; unsupported majors flagged', () => {
  const P = require('../../tools/electron-patch');
  const list = ['43.4.0', '44.1.2', '45.2.1', '45.2.3', '45.10.0', '46.0.0'].map(version => ({ version, chrome: version === '45.10.0' ? '156.0.8078.140' : '' }));
  const d = P.decide('45.2.1', list);
  assert.equal(d.latest, '45.10.0');            // numeric, not text, order
  assert.equal(d.chrome, '156.0.8078.140');
  assert.ok(d.update && d.majorSupported);
  assert.equal(d.newestMajor, 46);
  assert.ok(!P.decide('43.4.0', list).majorSupported);   // 46, 45, 44 are the three supported
  assert.ok(!P.decide('45.10.0', list).update);
  assert.equal(P.bumpPatch('0.6.9'), '0.6.10');
});
