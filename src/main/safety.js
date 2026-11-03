'use strict';
// Safe browsing: warns before opening phishing and malware sites, and blocks downloads and
// page resources from them. Lists (updated twice a day upstream, fetched every 12 hours here):
//   phishing — malware-filter's Phishing URL Blocklist (PhishTank, OpenPhish, phishunt.io),
//   malware  — malware-filter's URLhaus Malicious URL Blocklist (abuse.ch).
// Both list whole sites as ||host^ and, for popular sites that cannot be listed whole, single
// pages as ||host/path. Lookups are local: no address you visit is sent anywhere.

const fs = require('fs');
const path = require('path');

const MIRRORS = ['https://malware-filter.gitlab.io/malware-filter/', 'https://curbengh.github.io/malware-filter/', 'https://malware-filter.pages.dev/'];
const LISTS = { phishing: 'phishing-filter.txt', malware: 'urlhaus-filter-online.txt' };
const MAX_AGE = 12 * 3600 * 1000;

/** Parse a uBlock/ABP-style list into { hosts:Set, pages:Map<host, string[]> }. */
function parseList(text) {
  const hosts = new Set();
  const pages = new Map();
  for (let line of String(text).split(/\r?\n/)) {
    line = line.trim();
    if (!line || line[0] === '!' || line[0] === '#' || line.startsWith('[') || line.includes('##') || line.startsWith('@@')) continue;
    line = line.replace(/\$.*$/, '').replace(/^\|\|?/, '').replace(/^[a-z]+:\/\//i, '').replace(/[|^]+$/, '');
    if (!line || /[\s*]/.test(line)) continue;
    const slash = line.indexOf('/');
    if (slash < 0) { hosts.add(line.toLowerCase()); continue; }
    const host = line.slice(0, slash).toLowerCase();
    const rest = line.slice(slash);
    if (!host || rest === '/') { if (host) hosts.add(host); continue; }
    if (!pages.has(host)) pages.set(host, []);
    pages.get(host).push(rest);
  }
  return { hosts, pages };
}

function matchList(list, url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const labels = host.split('.');
  for (let i = 0; i < labels.length - 1 || (i === 0 && labels.length === 1); i++) {
    if (list.hosts.has(labels.slice(i).join('.'))) return true;
  }
  const p = list.pages.get(host);
  if (p) { const rest = u.pathname + u.search; if (p.some(x => rest.startsWith(x))) return true; }
  return false;
}

class Safety {
  constructor(dir) {
    this.file = path.join(dir, 'safebrowsing.json');
    this.lists = { phishing: { hosts: new Set(), pages: new Map() }, malware: { hosts: new Set(), pages: new Map() } };
    this.counts = { phishing: 0, malware: 0 };
    this.updated = null;
    this.status = 'loading';
    this.allowed = new Set(); // hosts the user chose to visit anyway (this session only)
    this.hits = new Map();    // webContents id → { url, kind } for the warning page
  }

  async init() {
    try {
      const st = fs.statSync(this.file);
      this.load(JSON.parse(fs.readFileSync(this.file, 'utf8')));
      this.updated = st.mtime;
      this.status = 'ready';
      // Stale: refresh later, so parsing the lists does not hold up the first pages you open.
      if (Date.now() - st.mtimeMs > MAX_AGE) { const t = setTimeout(() => this.refresh().catch(() => {}), Number(process.env.FERNA_LIST_REFRESH_DELAY || 90000)); if (t.unref) t.unref(); }
    } catch {
      await this.refresh().catch(() => { this.status = this.counts.phishing ? 'ready' : 'lists unavailable'; });
    }
    clearInterval(this.timer);
    this.timer = setInterval(() => this.refresh().catch(() => {}), MAX_AGE);
    if (this.timer.unref) this.timer.unref();
  }

  load(raw) {
    for (const k of Object.keys(LISTS)) {
      if (!raw[k]) continue;
      this.lists[k] = { hosts: new Set(raw[k].hosts), pages: new Map(raw[k].pages) };
      this.counts[k] = this.lists[k].hosts.size + [...this.lists[k].pages.values()].reduce((a, b) => a + b.length, 0);
    }
  }

  async fetchList(name) {
    let last;
    for (const m of MIRRORS) {
      try {
        const r = await fetch(m + name, { signal: AbortSignal.timeout(30000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const text = await r.text();
        if (text.length < 1000) throw new Error('list too short');
        return text;
      } catch (e) { last = e; }
    }
    throw last;
  }

  async refresh() {
    const out = {};
    for (const [k, name] of Object.entries(LISTS)) {
      const list = parseList(await this.fetchList(name));
      out[k] = { hosts: [...list.hosts], pages: [...list.pages] };
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(out));
    fs.renameSync(`${this.file}.tmp`, this.file);
    this.load(out);
    this.updated = new Date();
    this.status = 'ready';
  }

  /** 'phishing' | 'malware' | null */
  check(url) {
    if (matchList(this.lists.phishing, url)) return 'phishing';
    if (matchList(this.lists.malware, url)) return 'malware';
    return null;
  }

  isAllowed(url) { try { return this.allowed.has(new URL(url).hostname); } catch { return false; } }
  allow(url) { try { this.allowed.add(new URL(url).hostname); return true; } catch { return false; } }

  /** For tests: add entries without downloading. */
  addForTest(kind, entry) { const l = parseList(entry); for (const h of l.hosts) this.lists[kind].hosts.add(h); for (const [h, p] of l.pages) this.lists[kind].pages.set(h, [...(this.lists[kind].pages.get(h) || []), ...p]); this.status = 'ready'; }
}

module.exports = { Safety, parseList, matchList, LISTS, MIRRORS };
