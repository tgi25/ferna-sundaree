'use strict';
// 0.6.1 Linux port: ClamAV scanning, policy files, update kinds, desktop launchers.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const def = require('../../src/main/defender');
const gp = require('../../src/main/grouppolicy');
const up = require('../../src/main/updater');
const desk = require('../../src/main/linuxdesk');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ferna-linux-'));
const fakeRun = code => (exe, args, opts, cb) => { fakeRun.last = { exe, args }; setImmediate(() => cb(code ? Object.assign(new Error('x'), { code }) : null)); };

test('ClamAV: exit 0 clean, 1 threat (file removed), no scanner unavailable; clamdscan passes the file descriptor', async () => {
  const d = tmp(), f = path.join(d, 'a.bin');
  fs.writeFileSync(f, 'x');
  assert.strictEqual(await def.scanLinux(f, { exe: '/usr/bin/clamdscan', run: fakeRun(0) }), 'clean');
  assert.deepStrictEqual(fakeRun.last.args, ['--no-summary', '--fdpass', f]);
  assert.strictEqual(await def.scanLinux(f, { exe: '/usr/bin/clamscan', run: fakeRun(1) }), 'threat');
  assert.ok(!fs.existsSync(f));
  assert.strictEqual(await def.scanLinux(f, { exe: null }), 'unavailable');
  assert.strictEqual(await def.scanLinux(f, { exe: '/usr/bin/clamscan', run: fakeRun(2) }), 'unavailable');
});

test('Linux policies: root-owned JSON read in name order; writable or broken files ignored', { skip: process.getuid && process.getuid() !== 0 ? 'needs root' : false }, () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, '10-base.json'), JSON.stringify({ HttpsFirst: false, HistoryDays: 30, TorWindowsAllowed: false, 'bad key': 1, Nested: { a: 1 } }));
  fs.writeFileSync(path.join(d, '20-school.json'), JSON.stringify({ HistoryDays: 90 }));
  fs.writeFileSync(path.join(d, '30-open.json'), JSON.stringify({ AdBlocker: false }));
  fs.chmodSync(path.join(d, '30-open.json'), 0o666);
  fs.writeFileSync(path.join(d, '40-broken.json'), '{nope');
  for (const f of ['10-base.json', '20-school.json']) fs.chmodSync(path.join(d, f), 0o644);
  const pol = gp.readLinux(d);
  assert.deepStrictEqual(pol, { HttpsFirst: 0, HistoryDays: 90, TorWindowsAllowed: 0 });
  const s = gp.settingsFrom(pol);
  assert.strictEqual(s.httpsFirst, false);
  assert.strictEqual(s.historyDays, 90);
  assert.deepStrictEqual(gp.readLinux(path.join(d, 'missing')), {});
});

test('updates: Linux kinds in the signed manifest; install kind detected', () => {
  const h = 'a'.repeat(64);
  const m = up.validateManifest({ product: 'ferna-sundaree', version: '0.6.1', files: {
    'appimage-x64': { name: 'FernaSundaree-0.6.1-x64.AppImage', sha256: h, size: 10 },
    'deb-arm64': { name: 'FernaSundaree-0.6.1-arm64.deb', sha256: h, size: 10 },
    'rpm-x64': { name: 'FernaSundaree-0.6.1-x64.rpm', sha256: h, size: 10 },
    'tar-x64': { name: 'FernaSundaree-0.6.1-x64.tar.gz', sha256: h, size: 10 },
    junk: { name: 'evil.sh', sha256: h, size: 10 },
  } });
  assert.deepStrictEqual(Object.keys(m.files).sort(), ['appimage-x64', 'deb-arm64', 'rpm-x64', 'tar-x64']);
  assert.throws(() => up.validateManifest({ product: 'ferna-sundaree', version: '0.6.1', files: { 'deb-x64': { name: 'FernaSundaree-0.6.1.deb.sh', sha256: h, size: 1 } } }));
  const k = (exe, env = {}, dpkg = false) => up.installKind(exe, env, 'linux', p => dpkg && p.includes('dpkg'));
  assert.strictEqual(k('/tmp/.mount_Ferna/ferna-sundaree', { APPIMAGE: '/home/a/FernaSundaree.AppImage' }), 'appimage');
  assert.strictEqual(k('/opt/Ferna Sundaree/ferna-sundaree', {}, true), 'deb');
  assert.strictEqual(k('/opt/Ferna Sundaree/ferna-sundaree', {}, false), 'rpm');
  assert.strictEqual(k('/home/a/apps/FernaSundaree-0.6.1/ferna-sundaree'), 'tar');
  assert.strictEqual(k('/home/a/src/node_modules/electron/dist/electron'), 'dev');
  assert.strictEqual(up.installKind('C:\\Program Files\\Ferna Sundaree\\x.exe', { ProgramFiles: 'C:\\Program Files' }, 'win32'), 'msi');
});

test('updates: Linux install commands use pkexec for packages and replace the AppImage in place', () => {
  const u = new up.Updater({ settings: { data: {} } }, { currentVersion: '0.6.0' });
  u.state = { status: 'ready', file: '/tmp/u/FernaSundaree-0.6.1-x64.deb', kind: 'deb-x64' };
  assert.deepStrictEqual(u.install({ dryRun: true }), ['pkexec', ['/usr/bin/dpkg', '-i', '/tmp/u/FernaSundaree-0.6.1-x64.deb']]);
  u.state.kind = 'rpm-arm64';
  assert.deepStrictEqual(u.install({ dryRun: true }), ['pkexec', ['/usr/bin/rpm', '-U', '--replacepkgs', '/tmp/u/FernaSundaree-0.6.1-x64.deb']]);
  u.state.kind = 'tar-x64';
  assert.strictEqual(u.install({ dryRun: true }), null);
  const d = tmp(), ai = path.join(d, 'Ferna.AppImage'), nu = path.join(d, 'new.AppImage');
  fs.writeFileSync(ai, 'old'); fs.writeFileSync(nu, 'new');
  u.state = { status: 'ready', file: nu, kind: 'appimage-x64' };
  assert.throws(() => u.install({ env: {} }), /not running from an AppImage/);
  u.install({ env: { APPIMAGE: ai } });
  assert.strictEqual(fs.readFileSync(ai, 'utf8'), 'new');
  assert.ok(fs.statSync(ai).mode & 0o100);
});

test('desktop launchers: Exec arguments quoted, newlines stripped, MIME list only for the browser entry', () => {
  const e = desk.desktopEntry({ name: 'Mail\nX', args: ['--profile=Work $HOME', '--app=https://a.example/?q="1"'], icon: 'ferna-app-1', wmClass: 'ferna-app-1' });
  assert.match(e, /^\[Desktop Entry\]\nType=Application/);
  assert.match(e, /\nName=Mail X\n/);
  assert.match(e, /Exec="[^"]+" "--profile=Work \\\$HOME" "--app=https:\/\/a\.example\/\?q=\\"1\\""\n/);
  assert.ok(!/MimeType=/.test(e) && /StartupWMClass=ferna-app-1/.test(e));
  assert.match(desk.desktopEntry({ name: 'B', icon: 'i', mime: 'text/html;' }), /Exec="[^"]+" %U\n[\s\S]*MimeType=text\/html;/);
  const home = tmp(), dt = tmp();
  const old = process.env.XDG_DATA_HOME; process.env.XDG_DATA_HOME = home;
  try {
    const png = path.join(home, 'i.png'); fs.writeFileSync(png, 'png');
    desk.webApp({ id: 'abc', name: 'Campus', url: 'https://lms.example/', profile: 'Default', pngPath: png, desktopDir: dt });
    const f = path.join(home, 'applications', 'ferna-app-abc.desktop');
    assert.ok(fs.existsSync(f) && fs.existsSync(path.join(dt, 'ferna-app-abc.desktop')) && fs.existsSync(path.join(home, 'icons/hicolor/256x256/apps/ferna-app-abc.png')));
    assert.ok(!fs.readFileSync(f, 'utf8').includes('--profile'));
    desk.removeWebApp('abc', dt);
    assert.ok(!fs.existsSync(f) && !fs.existsSync(path.join(dt, 'ferna-app-abc.desktop')));
    desk.profileShortcut('Work', null);
    assert.match(fs.readFileSync(path.join(home, 'applications', 'ferna-sundaree-profile-work.desktop'), 'utf8'), /--profile=Work/);
  } finally { if (old === undefined) delete process.env.XDG_DATA_HOME; else process.env.XDG_DATA_HOME = old; }
});
