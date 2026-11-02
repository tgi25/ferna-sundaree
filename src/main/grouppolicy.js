'use strict';
// Group Policy: organisations can set and lock settings through the Windows registry
// (HKLM, then HKCU) under Software\Policies\FernaSundaree — by hand, with a .reg file, Intune,
// or with the ADMX template in build/policy/. A locked setting is greyed out in Settings.

const { execFileSync } = require('child_process');
const path = require('path');

/** Policy name → [setting key, type] for settings; features have their own names. */
const SETTINGS = {
  HttpsFirst: ['httpsFirst', 'bool'], AdBlocker: ['blocker', 'bool'], SafeBrowsing: ['safeBrowsing', 'bool'],
  SearchEngine: ['searchEngine', 'string'], DnsOverHttpsMode: ['dohMode', 'string'], DnsOverHttpsProvider: ['dohProvider', 'string'],
  BlockThirdPartyCookies: ['blockThirdPartyCookies', 'bool'], EnhancedSecurity: ['enhancedSecurity', 'bool'], AutoUpdate: ['autoUpdate', 'bool'],
  PasswordManager: ['passwordManager', 'bool'], AutofillAddresses: ['autofillAddresses', 'bool'], AutofillCards: ['autofillCards', 'bool'],
  LookalikeWarnings: ['lookalikeWarnings', 'bool'], DefenderScan: ['defenderScan', 'bool'], ExtensionGuard: ['extensionGuard', 'bool'],
  FingerprintProtection: ['fingerprintProtection', 'bool'], GlobalPrivacyControl: ['gpc', 'bool'], PopupBlocker: ['popupBlocker', 'bool'],
  SleepingTabs: ['sleepingTabs', 'bool'], HistoryDays: ['historyDays', 'int'], UpdateMirror: ['updateMirror', 'string'],
};
const FEATURES = ['AssistantAllowed', 'SyncAllowed', 'PrivateWindowsAllowed', 'TorWindowsAllowed', 'DeveloperToolsAllowed', 'ExtensionInstallAllowed', 'WebAppsAllowed', 'ProfilesAllowed'];

/** Parse `reg query /s` output into { Name: value }. */
function parseReg(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^\s{2,}(\S+)\s+(REG_DWORD|REG_SZ|REG_QWORD|REG_EXPAND_SZ)\s+(.*)$/.exec(line);
    if (!m) continue;
    const [, name, type, raw] = m;
    out[name] = /DWORD|QWORD/.test(type) ? parseInt(raw, 16) : raw.trim();
  }
  return out;
}

function convert(type, v) {
  if (type === 'bool') return v === 1 || v === '1' || /^true$/i.test(String(v));
  if (type === 'int') { const n = Number(v); return Number.isInteger(n) ? n : undefined; }
  return String(v);
}

/** Linux: JSON files in /etc/ferna-sundaree/policies/managed/ (as Chrome's /etc/opt/chrome/policies/managed). */
function readLinux(dir = '/etc/ferna-sundaree/policies/managed') {
  const fs = require('fs');
  const out = {};
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort(); } catch { return out; }
  for (const f of files) {
    try {
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      if (st.uid !== 0 || (st.mode & 0o022)) continue; // only files root owns and others cannot write
      const o = JSON.parse(fs.readFileSync(p, 'utf8'));
      for (const [k, v] of Object.entries(o)) if (/^[A-Za-z]+$/.test(k) && ['boolean', 'number', 'string'].includes(typeof v)) out[k] = typeof v === 'boolean' ? (v ? 1 : 0) : v;
    } catch { /* skip a broken file */ }
  }
  return out;
}

/** Read policies: Windows registry, or Linux policy files. Machine policies win over user policies. */
function read() {
  if (process.env.FERNA_TEST && process.env.FERNA_TEST_POLICY) { try { return JSON.parse(process.env.FERNA_TEST_POLICY); } catch { return {}; } }
  if (process.platform === 'linux') return readLinux();
  if (process.platform !== 'win32') return {};
  const reg = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
  const q = hive => { try { return parseReg(execFileSync(reg, ['query', `${hive}\\SOFTWARE\\Policies\\FernaSundaree`], { encoding: 'utf8', windowsHide: true, timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] })); } catch { return {}; } };
  return { ...q('HKCU'), ...q('HKLM') };
}

/** Settings to force: { key: value }, and the set of locked keys. */
function settingsFrom(pol) {
  const values = {};
  for (const [name, [key, type]] of Object.entries(SETTINGS)) if (name in pol) { const v = convert(type, pol[name]); if (v !== undefined) values[key] = v; }
  return values;
}

function install(ctx, pol, validators) {
  const forced = settingsFrom(pol);
  const locked = new Set();
  for (const [k, v] of Object.entries(forced)) {
    if (validators[k] && !validators[k](v)) continue;
    ctx.settings.data[k] = v;
    locked.add(k);
  }
  if (locked.size) ctx.settings.save();
  ctx.policy = pol;
  ctx.policyLocked = key => locked.has(key);
  ctx.policyList = () => ({ locked: [...locked], features: Object.fromEntries(FEATURES.filter(f => f in pol).map(f => [f, convert('bool', pol[f])])) });
  /** False when the organisation turned a feature off. */
  ctx.policyAllows = feature => !(feature in pol) || convert('bool', pol[feature]);
}

module.exports = { readLinux, read, parseReg, settingsFrom, install, SETTINGS, FEATURES };
