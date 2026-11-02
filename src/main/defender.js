'use strict';
// Scans finished downloads with Microsoft Defender Antivirus (MpCmdRun.exe, part of Windows),
// in addition to the Mark of the Web that makes SmartScreen check the file when you open it.
// Exit codes: 0 = no threat, 2 = threat found (Defender removes it). Anything else = could not
// scan (Defender turned off, another antivirus in charge, …).

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function defenderPath(env = process.env) {
  const candidates = [];
  if (env.ProgramFiles) candidates.push(path.join(env.ProgramFiles, 'Windows Defender', 'MpCmdRun.exe'));
  if (env.ProgramData) {
    // Platform updates install newer copies here; take the newest.
    const plat = path.join(env.ProgramData, 'Microsoft', 'Windows Defender', 'Platform');
    try { for (const v of fs.readdirSync(plat).sort().reverse()) candidates.push(path.join(plat, v, 'MpCmdRun.exe')); } catch { /* none */ }
  }
  return candidates.find(p => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
}

function scanArgs(file) { return ['-Scan', '-ScanType', '3', '-File', file]; }

// Linux: ClamAV (clamdscan through the clamd daemon when it runs, else clamscan).
// Exit codes: 0 = clean, 1 = virus found, 2 = error. A found file is deleted, as Defender does.
function clamPath() {
  for (const p of ['/usr/bin/clamdscan', '/usr/local/bin/clamdscan', '/usr/bin/clamscan', '/usr/local/bin/clamscan']) { try { if (fs.statSync(p).isFile()) return p; } catch { /* next */ } }
  return null;
}
function scanLinux(file, { exe = clamPath(), run = execFile } = {}) {
  return new Promise(resolve => {
    if (!exe) return resolve('unavailable');
    const args = /clamdscan$/.test(exe) ? ['--no-summary', '--fdpass', file] : ['--no-summary', file];
    run(exe, args, { timeout: 5 * 60 * 1000 }, err => {
      const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0;
      if (code === 1) { try { fs.unlinkSync(file); } catch { /* already gone */ } resolve('threat'); return; }
      if (code !== 0 && /clamdscan$/.test(exe)) { const c = ['/usr/bin/clamscan', '/usr/local/bin/clamscan'].find(p => fs.existsSync(p)); if (c) return scanLinux(file, { exe: c, run }).then(resolve); }
      resolve(code === 0 ? 'clean' : 'unavailable');
    });
  });
}
const scannerName = () => (process.platform === 'win32' ? 'Microsoft Defender' : process.platform === 'linux' ? 'ClamAV' : 'antivirus');

/** Resolves 'clean' | 'threat' | 'unavailable'. */
function scan(file, { platform = process.platform, exe = platform === 'linux' ? undefined : defenderPath(), run = execFile } = {}) {
  if (platform === 'linux') return scanLinux(file, { run, ...(exe !== undefined ? { exe } : {}) });
  return new Promise(resolve => {
    if (!exe) return resolve('unavailable');
    run(exe, scanArgs(file), { windowsHide: true, timeout: 5 * 60 * 1000 }, err => {
      const code = err ? (typeof err.code === 'number' ? err.code : -1) : 0;
      resolve(code === 0 ? 'clean' : code === 2 ? 'threat' : 'unavailable');
    });
  });
}

module.exports = { defenderPath, scanArgs, scan, scanLinux, clamPath, scannerName };
