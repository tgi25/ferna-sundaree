'use strict';
// Automatic updates, verified with Ferna's own signing key (no paid code-signing certificate).
//
// Each GitHub release carries update.json and update.json.sig. The manifest lists the version
// and the SHA-256 of every installer; the .sig is an Ed25519 signature of the manifest made
// with the private key the developer keeps (GitHub secret UPDATE_SIGNING_KEY). The browser
// holds the matching public key (src/main/update-key.js) and installs an update only if:
//   1. the signature verifies with that key,
//   2. the version is newer than the running one (no downgrades),
//   3. the downloaded file's SHA-256 equals the one in the signed manifest.
// The download itself may come from GitHub's CDN or a mirror; the signature is what is trusted.
//
// Update sources (checked together; the newest validly signed manifest wins, so one stale or
// unreachable source cannot hold updates back):
//   - mirrors: static folders holding update.json, update.json.sig and the installers, e.g. a
//     Cloudflare R2 / Backblaze bucket filled by the release workflow (package.json
//     "fernaUpdateMirrors", set at build time), so updates do not depend on GitHub;
//   - GitHub releases (latest);
//   - an organisation's own server (policy UpdateMirror): when set, it is the only source.
//
// Install path depends on how Ferna Sundaree was installed:
//   MSI (Program Files)     → msiexec /i <msi> /passive (Windows asks for permission), then quit
//   Setup exe (per user)    → <setup>.exe /S --updated, then quit
//   Portable                → tells you; the new portable exe is saved next to Downloads
//   Linux AppImage          → the verified AppImage replaces the running file, then restarts
//   Linux .deb / .rpm       → pkexec dpkg -i / rpm -U (asks for your password), then restarts
//   Linux .tar.gz           → tells you; the new archive is saved in Downloads

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const RELEASES = 'https://api.github.com/repos/tgi25/ferna-sundaree/releases/latest';
const ALLOWED_HOSTS = /^(api\.github\.com|github\.com|objects\.githubusercontent\.com|release-assets\.githubusercontent\.com)$/i;
const CHECK_EVERY = 6 * 3600 * 1000;
const LINUX_KINDS = ['appimage', 'deb', 'rpm', 'tar'];
const KINDS = ['setup', 'msi', 'portable', ...LINUX_KINDS.flatMap(k => [`${k}-x64`, `${k}-arm64`])];

/** Compare dotted versions: 1 if a > b, -1 if a < b, 0 if equal. Pre-release tags sort before releases. */
function compareVersions(a, b) {
  const parse = v => { const [main, pre] = String(v).replace(/^v/, '').split('-'); return { n: main.split('.').map(x => parseInt(x, 10) || 0), pre: pre || '' }; };
  const A = parse(a), B = parse(b);
  for (let i = 0; i < Math.max(A.n.length, B.n.length); i++) {
    const d = (A.n[i] || 0) - (B.n[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  if (A.pre === B.pre) return 0;
  if (!A.pre) return 1;
  if (!B.pre) return -1;
  return A.pre > B.pre ? 1 : -1;
}

/** Verify an Ed25519 signature (base64) of the exact manifest bytes. */
function verifyManifest(bytes, sigB64, publicKeyPem) {
  try {
    return crypto.verify(null, Buffer.from(bytes), crypto.createPublicKey(publicKeyPem), Buffer.from(String(sigB64).trim(), 'base64'));
  } catch { return false; }
}

/** Check the manifest's shape; returns a clean copy or throws. */
function validateManifest(m) {
  if (!m || typeof m !== 'object') throw new Error('manifest is not an object');
  if (m.product !== 'ferna-sundaree') throw new Error('manifest is for another product');
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(m.version || '')) throw new Error('bad version');
  const files = {};
  for (const kind of KINDS) {
    const f = m.files && m.files[kind];
    if (!f) continue;
    if (!/^FernaSundaree-[\w.-]+\.(exe|msi|AppImage|deb|rpm|tar\.gz)$/.test(f.name || '') || !/^[a-f0-9]{64}$/.test(f.sha256 || '') || !Number.isInteger(f.size) || f.size <= 0 || f.size > 1024 * 1024 * 1024) throw new Error(`bad ${kind} entry`);
    files[kind] = { name: f.name, sha256: f.sha256, size: f.size };
  }
  if (!Object.keys(files).length) throw new Error('no files');
  return { product: m.product, version: m.version, date: String(m.date || ''), notes: String(m.notes || '').slice(0, 4000), files };
}

/** How this copy was installed. */
function installKind(exePath = process.execPath, env = process.env, platform = process.platform, exists = fs.existsSync) {
  if (platform === 'linux') {
    if (env.APPIMAGE) return 'appimage';
    if (!exePath.startsWith('/opt/') && !exePath.startsWith('/usr/')) return exePath.includes('node_modules') ? 'dev' : 'tar';
    if (exists('/var/lib/dpkg/info/ferna-sundaree.list')) return 'deb';
    return 'rpm';
  }
  if (env.PORTABLE_EXECUTABLE_DIR || env.PORTABLE_EXECUTABLE_FILE) return 'portable';
  const p = exePath.toLowerCase();
  if (env.ProgramFiles && p.startsWith(env.ProgramFiles.toLowerCase())) return 'msi';
  if (env['ProgramFiles(x86)'] && p.startsWith(env['ProgramFiles(x86)'].toLowerCase())) return 'msi';
  if (env.LOCALAPPDATA && p.startsWith(path.join(env.LOCALAPPDATA, 'Programs').toLowerCase())) return 'setup';
  return 'dev';
}

/** Built-in mirrors (folder URLs ending in /), written into package.json by the release build. */
function builtInMirrors() {
  try { return (require('../../package.json').fernaUpdateMirrors || []).filter(u => typeof u === 'string'); } catch { return []; }
}

/** A mirror URL must be https (or http on this computer, for tests) and end in a folder. */
function cleanMirror(u) {
  try {
    const x = new URL(String(u).trim());
    if (x.protocol !== 'https:' && !(x.protocol === 'http:' && /^(127\.0\.0\.1|localhost)$/.test(x.hostname))) return null;
    if (x.username || x.password || x.search || x.hash) return null;
    if (!x.pathname.endsWith('/')) x.pathname += '/';
    return x.toString();
  } catch { return null; }
}

class Updater {
  constructor(ctx, { publicKey, currentVersion, releasesUrl = RELEASES, allowAnyHost = false, mirrors } = {}) {
    this.ctx = ctx;
    this.publicKey = publicKey;
    this.current = currentVersion;
    this.releasesUrl = releasesUrl;
    this.mirrors = mirrors; // undefined = built-in list
    this.allowAnyHost = allowAnyHost; // tests only
    this.state = { status: 'idle', checked: null, available: null, error: null, progress: 0, file: null };
    this.listeners = new Set();
  }

  on(fn) { this.listeners.add(fn); }
  set(patch) { Object.assign(this.state, patch); for (const fn of this.listeners) { try { fn(this.state); } catch { /* ignore */ } } }

  /** The sources to ask, in order of preference. */
  sources() {
    const policy = cleanMirror((this.ctx.settings && this.ctx.settings.data.updateMirror) || '');
    if (policy) return [{ kind: 'mirror', base: policy }];
    const mirrors = (this.mirrors || builtInMirrors()).map(cleanMirror).filter(Boolean);
    return [...mirrors.map(base => ({ kind: 'mirror', base })), ...(this.releasesUrl ? [{ kind: 'github', url: this.releasesUrl }] : [])];
  }

  hostAllowed(url) {
    const u = new URL(url);
    if (this.allowAnyHost) return true;
    const mirrorHosts = this.sources().filter(s => s.kind === 'mirror').map(s => new URL(s.base).host);
    if (mirrorHosts.includes(u.host)) return u.protocol === 'https:' || /^(127\.0\.0\.1|localhost)$/.test(u.hostname);
    return u.protocol === 'https:' && ALLOWED_HOSTS.test(u.hostname);
  }

  async get(url, as = 'json') {
    const u = new URL(url);
    if (u.protocol !== 'https:' && !this.allowAnyHost && !this.hostAllowed(url)) throw new Error('updates use https only');
    if (!this.hostAllowed(url)) throw new Error(`unexpected host ${u.hostname}`);
    const r = await fetch(url, { headers: { 'User-Agent': 'FernaSundaree-Updater', Accept: as === 'json' ? 'application/vnd.github+json' : 'application/octet-stream' }, signal: AbortSignal.timeout(as === 'file' ? 30 * 60000 : 30000), redirect: 'follow' });
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
    if (r.url && !this.hostAllowed(r.url)) throw new Error('redirected to an unexpected host');
    return r;
  }

  /** Signed manifest from one source: { m, urlFor } or throws. */
  async fromSource(src) {
    try { return await this.readSource(src); } catch (e) {
      // 404 means nothing is published there yet (or the address is wrong) — say so plainly.
      if (e && e.status === 404) throw new Error(src.kind === 'github' ? 'no release has been published on GitHub yet' : `the update mirror ${new URL(src.base).host} has no update yet`);
      throw e;
    }
  }

  async readSource(src) {
    let bytes, signature, urlFor;
    if (src.kind === 'github') {
      const rel = await (await this.get(src.url)).json();
      const asset = n => (rel.assets || []).find(a => a.name === n);
      const man = asset('update.json'), sig = asset('update.json.sig');
      if (!man || !sig) throw new Error('the latest release has no signed update manifest');
      bytes = Buffer.from(await (await this.get(man.browser_download_url, 'bytes')).arrayBuffer());
      signature = await (await this.get(sig.browser_download_url, 'bytes')).text();
      urlFor = n => (asset(n) || {}).browser_download_url;
    } else {
      bytes = Buffer.from(await (await this.get(`${src.base}update.json`, 'bytes')).arrayBuffer());
      signature = await (await this.get(`${src.base}update.json.sig`, 'bytes')).text();
      urlFor = n => `${src.base}${encodeURIComponent(n)}`;
    }
    if (!verifyManifest(bytes, signature, this.publicKey)) throw new Error('the update signature is not valid — update refused');
    return { m: validateManifest(JSON.parse(bytes.toString('utf8'))), urlFor };
  }

  /** Look for a newer signed release. */
  async check() {
    if (this.state.status === 'downloading') return this.state;
    this.set({ status: 'checking', error: null });
    try {
      const srcs = this.sources();
      if (!srcs.length) throw new Error('no update source');
      const results = await Promise.allSettled(srcs.map(s => this.fromSource(s)));
      const good = results.map((r, i) => (r.status === 'fulfilled' ? { ...r.value, src: srcs[i] } : null)).filter(Boolean);
      if (!good.length) {
        const errs = results.map(r => String(r.reason && r.reason.message || r.reason));
        throw new Error(errs.find(e => /signature/.test(e)) || errs[0]);
      }
      // Newest signed version wins; every source that has that same version is a download location.
      const best = good.reduce((a, b) => (compareVersions(b.m.version, a.m.version) > 0 ? b : a));
      const m = { ...best.m, files: best.m.files };
      const same = good.filter(g => g.m.version === m.version && JSON.stringify(g.m.files) === JSON.stringify(m.files));
      m.urls = Object.fromEntries(Object.entries(m.files).map(([k, f]) => [k, [...new Set(same.map(g => g.urlFor(f.name)).filter(Boolean))]]).filter(([, u]) => u.length));
      m.sources = same.map(g => (g.src.kind === 'github' ? 'GitHub' : new URL(g.src.base).host));
      const newer = compareVersions(m.version, this.current) > 0;
      this.set({ status: newer ? 'available' : 'current', checked: new Date().toISOString(), available: newer ? m : null, sources: m.sources, failed: results.filter(r => r.status === 'rejected').length });
    } catch (e) {
      this.set({ status: 'error', checked: new Date().toISOString(), error: String(e && e.message || e) });
    }
    return this.state;
  }

  /** Download the installer for this kind of install and verify its SHA-256. */
  async download(kind = installKind()) {
    const m = this.state.available;
    if (!m) throw new Error('no update available');
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const which = LINUX_KINDS.includes(kind) ? `${kind}-${arch}` : kind === 'msi' ? 'msi' : kind === 'portable' ? 'portable' : 'setup';
    const key = m.files[which] ? which : (LINUX_KINDS.includes(kind) ? null : 'setup');
    const f = key && m.files[key];
    const urls = key ? [].concat(m.urls[key] || []) : [];
    if (!f || !urls.length) throw new Error('no installer for this kind of install');
    this.set({ status: 'downloading', progress: 0, error: null });
    const dir = path.join(os.tmpdir(), 'ferna-sundaree-update');
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, f.name);
    let last;
    // Try each location in turn; a broken or tampered copy on one mirror falls through to the next.
    for (const url of urls) {
      try {
        const r = await this.get(url, 'file');
        const hash = crypto.createHash('sha256');
        const ws = fs.createWriteStream(`${out}.part`);
        let got = 0;
        try {
          for await (const chunk of r.body) {
            got += chunk.length;
            if (got > f.size) throw new Error('download is larger than the signed size');
            hash.update(chunk);
            if (!ws.write(chunk)) await new Promise(res => ws.once('drain', res));
            this.set({ progress: Math.round(100 * got / f.size) });
          }
        } finally { await new Promise(res => ws.end(res)); }
        const digest = hash.digest('hex');
        if (got !== f.size || digest !== f.sha256) throw new Error('the download does not match the signed checksum — update refused');
        fs.renameSync(`${out}.part`, out);
        this.set({ status: 'ready', file: out, kind: key, progress: 100 });
        return out;
      } catch (e) {
        last = e;
        fs.rmSync(`${out}.part`, { force: true });
      }
    }
    this.set({ status: 'error', error: String(last && last.message || last) });
    throw last;
  }

  /** Start the verified installer and quit (setup / msi), or reveal the portable exe. */
  install({ app, shell, dryRun = false, env = process.env } = {}) {
    const { file, kind } = this.state;
    if (!file || this.state.status !== 'ready') throw new Error('nothing to install');
    const base = String(kind).replace(/-(x64|arm64)$/, '');
    if (LINUX_KINDS.includes(base)) return this.installLinux(base, file, { app, shell, dryRun, env });
    const cmd = kind === 'msi' ? ['msiexec.exe', ['/i', file, '/passive', '/norestart']] : kind === 'setup' ? [file, ['/S', '--updated']] : null;
    if (dryRun) return cmd;
    if (!cmd) { if (shell) shell.showItemInFolder(file); return null; }
    spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
    if (app) setTimeout(() => app.quit(), 500);
    return cmd;
  }

  installLinux(base, file, { app, shell, dryRun, env }) {
    if (base === 'appimage') {
      const target = env.APPIMAGE;
      if (!target) throw new Error('not running from an AppImage');
      if (dryRun) return ['replace', [target, file]];
      // Same folder, then an atomic rename over the running file (the old inode stays valid until exit).
      const tmp = `${target}.new`;
      fs.copyFileSync(file, tmp);
      fs.chmodSync(tmp, 0o755);
      fs.renameSync(tmp, target);
      if (app) { app.relaunch({ execPath: target, args: process.argv.slice(1) }); setTimeout(() => app.quit(), 300); }
      return ['replace', [target, file]];
    }
    const cmd = base === 'deb' ? ['pkexec', ['/usr/bin/dpkg', '-i', file]] : base === 'rpm' ? ['pkexec', ['/usr/bin/rpm', '-U', '--replacepkgs', file]] : null;
    if (dryRun) return cmd;
    if (!cmd) { if (shell) shell.showItemInFolder(file); return null; }
    this.set({ status: 'installing' });
    const child = spawn(cmd[0], cmd[1], { stdio: 'ignore' });
    child.on('error', e => this.set({ status: 'ready', error: `could not start the installer: ${e.message}` }));
    child.on('exit', code => {
      if (code === 0) { if (app) { app.relaunch(); app.quit(); } return; }
      // 126/127: password dialog dismissed or no polkit agent.
      this.set({ status: 'ready', error: code === 126 || code === 127 ? 'installation was cancelled' : `the installer failed (code ${code})` });
    });
    return cmd;
  }

  start() {
    clearInterval(this.timer);
    const tick = () => { if (this.ctx.settings.data.autoUpdate !== false) this.check().catch(() => {}); };
    this.firstTimer = setTimeout(tick, 60 * 1000);
    this.timer = setInterval(tick, CHECK_EVERY);
    if (this.timer.unref) this.timer.unref();
  }
}

module.exports = { Updater, compareVersions, verifyManifest, validateManifest, installKind, cleanMirror, builtInMirrors, ALLOWED_HOSTS, KINDS };
