'use strict';
// Smart workspaces, the learning part (no Electron, unit-tested).
//
// Ferna notes the first time each day you open a site, and when (kept on this PC, encrypted, for
// six weeks). A routine is a set of 2–8 sites you open together — within 45 minutes — at about
// the same time of day on at least three different days. For example: the LMS, Gmail and the
// timetable at 8 a.m. on weekdays. A routine can become a workspace that opens itself.

const DAY = 86400000;
const KEEP_DAYS = 42;
const BURST_GAP = 20;   // minutes between two opens that still belong to one burst
const BURST_SPAN = 45;  // minutes a burst may last
const NEAR = 45;        // minutes two bursts may differ in time and still be "the same time"
const MIN_DAYS = 3;

const pad = n => String(n).padStart(2, '0');
/** Local calendar day "2026-11-02" and minutes since midnight. */
function dayKey(t) { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function minuteOf(t) { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); }
const hhmm = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
const weekdayOf = key => new Date(`${key}T12:00:00`).getDay(); // 0 Sunday … 6 Saturday

/** A site, as Ferna remembers it: host plus first path segment for big hosts (docs.google.com/spreadsheets). */
function siteKey(url) {
  let u;
  try { u = new URL(url); } catch { return ''; }
  if (!/^https?:$/.test(u.protocol)) return '';
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const seg = (u.pathname.split('/')[1] || '').toLowerCase();
  // One host, several apps: keep them apart.
  if (/^(docs|drive|sites)\.google\.com$/.test(host) && seg) return `${host}/${seg}`;
  return host;
}

/**
 * Record that you opened a page. data = { days: { "2026-11-02": { site: { t, url, title, n } } } }.
 * Only the first open of a site per day sets its time; later opens only count.
 */
function record(data, url, title, t = Date.now()) {
  const site = siteKey(url);
  if (!site) return false;
  data.days = data.days || {};
  const k = dayKey(t);
  const day = data.days[k] || (data.days[k] = {});
  const e = day[site];
  if (e) { e.n = (e.n || 1) + 1; if (!e.title && title) e.title = String(title).slice(0, 120); return false; }
  day[site] = { t, url: String(url).slice(0, 500), title: String(title || '').slice(0, 120), n: 1 };
  if (Object.keys(day).length > 300) delete day[site]; // a crawler, not a person
  prune(data, t);
  return true;
}
function prune(data, now = Date.now()) {
  const cut = dayKey(now - KEEP_DAYS * DAY);
  for (const k of Object.keys(data.days || {})) if (k < cut) delete data.days[k];
}

/** Bursts of one day: sites first-opened close together. → [{ start, sites: Set, day }] */
function burstsOf(dayKeyStr, day) {
  const opens = Object.entries(day).map(([site, e]) => ({ site, m: minuteOf(e.t) })).sort((a, b) => a.m - b.m);
  const out = [];
  let cur = null;
  for (const o of opens) {
    if (cur && o.m - cur.last <= BURST_GAP && o.m - cur.start <= BURST_SPAN) { cur.sites.add(o.site); cur.last = o.m; continue; }
    cur = { start: o.m, last: o.m, sites: new Set([o.site]), day: dayKeyStr };
    out.push(cur);
  }
  return out.filter(b => b.sites.size >= 2);
}
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };
const keyOfSet = s => [...s].sort().join('|');

/**
 * Routines in what was recorded: [{ id, sites: [site], time: "08:00", minute, days: [1..5], weekdays: bool, support, examples }]
 * `skip`: ids you dismissed or already turned into a workspace.
 */
function findRoutines(data, { skip = [], now = Date.now() } = {}) {
  const days = data.days || {};
  const bursts = [];
  for (const [k, d] of Object.entries(days)) bursts.push(...burstsOf(k, d));
  if (bursts.length < MIN_DAYS) return [];
  // How often each site appears in a burst at all; rare sites cannot be part of a routine.
  const freq = new Map();
  for (const b of bursts) for (const s of b.sites) freq.set(s, (freq.get(s) || 0) + 1);
  const keep = b => new Set([...b.sites].filter(s => freq.get(s) >= MIN_DAYS));
  const bs = bursts.map(b => ({ ...b, sites: keep(b) })).filter(b => b.sites.size >= 2);
  // Candidate sets: what two bursts at about the same time of day on different days share.
  const cands = new Map();
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i], b = bs[j];
      if (a.day === b.day || Math.abs(a.start - b.start) > NEAR) continue;
      const common = new Set([...a.sites].filter(s => b.sites.has(s)));
      if (common.size < 2 || common.size > 8) continue;
      cands.set(keyOfSet(common), common);
    }
  }
  const found = [];
  for (const [key, set] of cands) {
    const hits = bs.filter(b => [...set].every(s => b.sites.has(s)));
    // The time of day most of them cluster around (bursts far from it are another routine).
    const mid = median(hits.map(h => h.start));
    const near = hits.filter(h => Math.abs(h.start - mid) <= NEAR);
    const dayset = new Map();
    for (const h of near) if (!dayset.has(h.day) || h.start < dayset.get(h.day).start) dayset.set(h.day, h);
    if (dayset.size < MIN_DAYS) continue;
    const support = [...dayset.values()];
    const wds = [...new Set(support.map(h => weekdayOf(h.day)))].sort();
    const weekdays = wds.every(d => d >= 1 && d <= 5);
    // Open a little before you usually start, rounded to 5 minutes.
    const minute = Math.max(0, Math.floor((median(support.map(h => h.start)) - 5) / 5) * 5);
    found.push({ id: `${key}@${weekdays ? 'wd' : wds.join('')}`, key, sites: [...set].sort(), minute, time: hhmm(minute), days: weekdays && wds.length >= 2 ? [1, 2, 3, 4, 5] : wds, weekdays: weekdays && wds.length >= 2, support: support.length, last: support.map(h => h.day).sort().pop() });
  }
  // Keep the largest set of each family (LMS+Gmail+Timetable beats LMS+Gmail), then the best supported.
  found.sort((a, b) => b.sites.length - a.sites.length || b.support - a.support);
  const out = [];
  for (const r of found) {
    if (skip.some(s => s === r.id || s === r.key)) continue;
    if (out.some(o => r.sites.every(s => o.sites.includes(s)) && Math.abs(o.minute - r.minute) <= NEAR)) continue;
    out.push(r);
  }
  // Recent ones only: a routine you stopped weeks ago is not worth offering.
  const cutoff = dayKey(now - 14 * DAY);
  return out.filter(r => r.last >= cutoff).slice(0, 5);
}

/** The page to open for a site: the address you opened most recently; its usual title. */
function bestUrl(data, site) {
  let best = null;
  const titles = new Map();
  for (const [k, d] of Object.entries(data.days || {})) {
    if (!d[site]) continue;
    if (d[site].title) titles.set(d[site].title, (titles.get(d[site].title) || 0) + 1);
    if (!best || k > best.k) best = { k, url: d[site].url };
  }
  const title = [...titles].sort((a, b) => b[1] - a[1])[0];
  return best ? { url: best.url, title: (title && title[0]) || site } : { url: `https://${site}/`, title: site };
}

/** Is a schedule due now? sched = { days: [0-6], time: "08:00", last: "2026-11-02" }; opens up to 90 minutes late. */
function isDue(sched, now = Date.now()) {
  if (!sched || sched.on === false) return false;
  const [h, m] = String(sched.time || '').split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return false;
  const d = new Date(now);
  if (!(sched.days || []).includes(d.getDay())) return false;
  if (sched.last === dayKey(now)) return false;
  const diff = minuteOf(now) - (h * 60 + m);
  return diff >= 0 && diff <= 90;
}

/** "weekdays", "Mon, Wed, Fri", "every day". */
function daysLabel(days) {
  const s = [...new Set(days || [])].sort();
  if (s.join() === '1,2,3,4,5') return 'weekdays';
  if (s.length === 7) return 'every day';
  if (s.join() === '0,6') return 'weekends';
  return s.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ');
}

module.exports = { siteKey, record, prune, burstsOf, findRoutines, bestUrl, isDue, daysLabel, dayKey, minuteOf, hhmm };
