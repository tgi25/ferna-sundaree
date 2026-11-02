#!/usr/bin/env node
'use strict';
// Weekly Chromium security update helper (used by .github/workflows/chromium-patches.yml).
//
// Chrome gets a security update about once a week; Electron ships the same fixes as patch
// releases of each supported major version (the newest three). This script:
//   node tools/electron-patch.js            report: current Electron, newest patch of the same
//                                           major, Chromium version, whether the major is still
//                                           supported, newest major
//   node tools/electron-patch.js --apply    also pin Electron to that patch and bump the app's
//                                           patch version (0.6.2 → 0.6.3) in package.json
// With GITHUB_OUTPUT set, the results are written as step outputs.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const PKG = path.join(ROOT, 'package.json');

const parse = v => String(v).replace(/^[^\d]*/, '').split('.').map(n => parseInt(n, 10) || 0);
const cmp = (a, b) => { const x = parse(a), y = parse(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const stable = v => /^\d+\.\d+\.\d+$/.test(v);

function installedElectron(pkg) {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
    const v = lock.packages && lock.packages['node_modules/electron'] && lock.packages['node_modules/electron'].version;
    if (v) return v;
  } catch { /* fall back */ }
  return String(pkg.devDependencies.electron).replace(/^[\^~=]/, '');
}

/** Stable Electron releases with their Chromium versions (Electron's release list, else npm). */
async function releases() {
  try {
    const r = await fetch('https://releases.electronjs.org/releases.json', { signal: AbortSignal.timeout(30000) });
    if (r.ok) return (await r.json()).filter(x => stable(x.version)).map(x => ({ version: x.version, chrome: x.chrome || '', date: x.date || '' }));
  } catch { /* npm below */ }
  const list = JSON.parse(execFileSync('npm', ['view', 'electron', 'versions', '--json'], { encoding: 'utf8' }));
  return list.filter(stable).map(version => ({ version, chrome: '', date: '' }));
}

function decide(current, list) {
  const major = parse(current)[0];
  const majors = [...new Set(list.map(x => parse(x.version)[0]))].sort((a, b) => b - a);
  const supported = majors.slice(0, 3);
  const sameMajor = list.filter(x => parse(x.version)[0] === major).sort((a, b) => cmp(b.version, a.version));
  const latest = sameMajor[0] || { version: current, chrome: '' };
  return {
    current, major, latest: latest.version, chrome: latest.chrome,
    update: cmp(latest.version, current) > 0,
    majorSupported: supported.includes(major),
    newestMajor: majors[0] || major,
    supportedMajors: supported,
  };
}

function bumpPatch(v) { const [a, b, c] = parse(v); return `${a}.${b}.${c + 1}`; }

async function main() {
  const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
  const d = decide(installedElectron(pkg), await releases());
  const apply = process.argv.includes('--apply');
  const force = process.argv.includes('--force');
  d.appVersion = pkg.version;
  if (apply && (d.update || force)) {
    d.appVersion = bumpPatch(pkg.version);
    pkg.version = d.appVersion;
    pkg.devDependencies.electron = d.latest; // exact pin; npm install updates the lock file
    fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n');
  }
  d.notes = `Security update: Chromium ${d.chrome || '(see Electron notes)'} through Electron ${d.latest}. https://releases.electronjs.org/release/v${d.latest}`;
  console.log(JSON.stringify(d, null, 2));
  if (process.env.GITHUB_OUTPUT) {
    const out = Object.entries({ current: d.current, latest: d.latest, chrome: d.chrome, update: String(d.update), major_supported: String(d.majorSupported), newest_major: String(d.newestMajor), major: String(d.major), app_version: d.appVersion, notes: d.notes });
    fs.appendFileSync(process.env.GITHUB_OUTPUT, out.map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  }
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { decide, bumpPatch, cmp };
