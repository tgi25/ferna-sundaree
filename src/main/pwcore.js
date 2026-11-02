'use strict';
// Password manager core (pure functions, unit-tested): origins, the password generator,
// strength and reuse checks, CSV import from other browsers and password managers, CSV export.

const crypto = require('crypto');

/** The site a password belongs to: scheme + host (+ port). http and https stay apart. */
function originOf(u) {
  try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.origin : null; } catch { return null; }
}
/** Registrable site for matching sub-domains (accounts.example.com ~ www.example.com). */
function siteOf(u) {
  let host = '';
  try { host = new URL(u).hostname; } catch { return ''; }
  try { return require('tldts-experimental').getDomain(host) || host; } catch { return host.split('.').slice(-2).join('.'); }
}

const SETS = { lower: 'abcdefghijkmnopqrstuvwxyz', upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ', digits: '23456789', symbols: '-_.!@#$%*+=?' };
/** Strong random password: every class present, no look-alike characters (l/1, O/0). */
function generate(len = 16, opts = {}) {
  len = Math.max(8, Math.min(64, len | 0));
  const classes = Object.entries(SETS).filter(([k]) => opts[k] !== false).map(([, v]) => v);
  const all = classes.join('');
  const pick = set => set[crypto.randomInt(set.length)];
  const out = classes.map(pick);
  while (out.length < len) out.push(pick(all));
  for (let i = out.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out.join('');
}

const COMMON = new Set(['123456', '123456789', '12345678', 'password', 'qwerty', '12345', '1234567', '111111', '123123', 'abc123', 'password1', '1234567890', 'iloveyou', '000000', 'qwerty123', 'admin', 'welcome', 'letmein', 'monkey', 'dragon', 'sunshine', 'princess', 'football', 'master', 'shadow', 'superman', 'passw0rd', 'trustno1', 'srilanka', 'colombo', 'Password1', 'Password@123', 'Admin@123']);
/** 0 (very weak) … 4 (strong), with a reason for the weak ones. */
function strength(pw) {
  pw = String(pw || '');
  if (!pw) return { score: 0, reason: 'empty' };
  if (COMMON.has(pw) || COMMON.has(pw.toLowerCase())) return { score: 0, reason: 'very common' };
  let classes = 0;
  if (/[a-z]/.test(pw)) classes++;
  if (/[A-Z]/.test(pw)) classes++;
  if (/\d/.test(pw)) classes++;
  if (/[^A-Za-z0-9]/.test(pw)) classes++;
  if (/^(.)\1+$/.test(pw) || /^(0123|1234|2345|abcd|qwer)/i.test(pw)) return { score: 0, reason: 'predictable' };
  const bits = pw.length * Math.log2([0, 26, 52, 62, 90][classes] || 26);
  if (pw.length < 8) return { score: 1, reason: 'too short' };
  if (bits < 40) return { score: 1, reason: 'too simple' };
  if (bits < 60) return { score: 2, reason: 'could be stronger' };
  if (bits < 80) return { score: 3 };
  return { score: 4 };
}

/** Which saved logins share a password with another site: Map(id → [other origins]). */
function reused(logins) {
  const by = new Map();
  for (const l of logins) { if (!l.password) continue; if (!by.has(l.password)) by.set(l.password, []); by.get(l.password).push(l); }
  const out = new Map();
  for (const group of by.values()) {
    const sites = new Set(group.map(l => siteOf(l.origin)));
    if (sites.size < 2) continue;
    for (const l of group) out.set(l.id, [...sites].filter(s => s !== siteOf(l.origin)));
  }
  return out;
}

/** SHA-1 for the Have I Been Pwned range check (only the first 5 hex characters leave the PC). */
function sha1(pw) { return crypto.createHash('sha1').update(String(pw), 'utf8').digest('hex').toUpperCase(); }
function pwnedCount(rangeText, fullHash) {
  const suffix = fullHash.slice(5);
  for (const line of String(rangeText).split(/\r?\n/)) {
    const [s, n] = line.trim().split(':');
    if (s === suffix) return Number(n) || 0;
  }
  return 0;
}

// ---------- CSV ----------
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(x => x !== ''));
}
const csvCell = v => /[",\n\r]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '');

/**
 * Logins from a CSV export of Chrome / Edge / Brave / Opera, Firefox, Safari, Bitwarden,
 * LastPass, 1Password, Dashlane, KeePass(XC) or Proton Pass: columns are found by header name.
 */
function importCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { logins: [], skipped: 0, format: 'empty' };
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = (...names) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
  const iUrl = col('url', 'login_uri', 'website', 'web site', 'origin', 'login url', 'uri');
  const iUser = col('username', 'login_username', 'login', 'user name', 'email', 'login name');
  const iPass = col('password', 'login_password');
  const iName = col('name', 'title');
  const iNote = col('note', 'notes', 'extra', 'comments');
  if (iUrl < 0 || iPass < 0) throw new Error('This CSV has no url and password columns');
  const format = head.includes('login_uri') ? 'Bitwarden' : head.includes('httprealm') ? 'Firefox' : head.includes('grouping') ? 'LastPass' : head.includes('otpauth') ? 'Safari' : 'Chrome-compatible';
  const logins = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    let url = (r[iUrl] || '').trim();
    if (url && !/^[a-z]+:\/\//i.test(url)) url = `https://${url}`;
    const origin = originOf(url);
    const password = r[iPass] || '';
    if (!origin || !password) { skipped++; continue; }
    logins.push({ origin, username: iUser >= 0 ? (r[iUser] || '') : '', password, name: iName >= 0 ? r[iName] || '' : '', note: iNote >= 0 ? (r[iNote] || '').slice(0, 2000) : '' });
  }
  return { logins, skipped, format };
}

function exportCsv(logins) {
  const lines = ['name,url,username,password,note'];
  for (const l of logins) lines.push([l.name || new URL(l.origin).hostname, l.origin, l.username, l.password, l.note || ''].map(csvCell).join(','));
  return lines.join('\r\n') + '\r\n';
}

/** Add or update logins; same origin + username replaces the password. Returns counts. */
function merge(existing, incoming, now = Date.now()) {
  let added = 0, updated = 0;
  for (const l of incoming) {
    const hit = existing.find(x => x.origin === l.origin && x.username === l.username);
    if (hit) { if (hit.password !== l.password) { hit.password = l.password; hit.changed = now; updated++; } }
    else { existing.push({ id: newId(), origin: l.origin, username: l.username, password: l.password, note: l.note || '', created: now, used: 0, changed: now }); added++; }
  }
  return { added, updated };
}
const newId = () => `p${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;

/** Logins that apply to a page: same origin first, then the same site (sub-domains). */
function forPage(logins, url) {
  const o = originOf(url);
  if (!o) return [];
  const site = siteOf(url);
  const exact = logins.filter(l => l.origin === o);
  const https = o.startsWith('https:');
  const near = logins.filter(l => l.origin !== o && siteOf(l.origin) === site && (!https || l.origin.startsWith('https:')));
  return [...exact, ...near];
}

// ---------- cards ----------
function luhn(num) {
  const d = String(num).replace(/\D/g, '');
  if (d.length < 12 || d.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) { let x = +d[d.length - 1 - i]; if (i % 2) { x *= 2; if (x > 9) x -= 9; } sum += x; }
  return sum % 10 === 0;
}
function cardBrand(num) {
  const d = String(num).replace(/\D/g, '');
  if (/^4/.test(d)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(d)) return 'Mastercard';
  if (/^3[47]/.test(d)) return 'American Express';
  if (/^(6011|65|64[4-9])/.test(d)) return 'Discover';
  if (/^35/.test(d)) return 'JCB';
  if (/^(62|81)/.test(d)) return 'UnionPay';
  return 'Card';
}

module.exports = { originOf, siteOf, generate, strength, reused, sha1, pwnedCount, parseCsv, importCsv, exportCsv, merge, forPage, newId, luhn, cardBrand };
