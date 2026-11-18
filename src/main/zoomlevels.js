'use strict';
// Page zoom as in Chrome: Chromium's own zoom, Chrome's steps, remembered per site (host).
// Pure helpers, kept free of Electron so they can be unit-tested. Text-only zoom, AutoFit and
// minimum font size are the Ferna Zoom extension's job since 0.9.0.

const LEVELS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500];
const MIN = 25;
const MAX = 500;
const clamp = v => Math.max(MIN, Math.min(MAX, Math.round(Number(v) || 100)));

/** The key a zoom level is remembered under: the host (as Chrome does), '' for other pages. */
function hostKey(url) {
  let u;
  try { u = new URL(url); } catch { return ''; }
  if (!/^https?:$/.test(u.protocol)) return u.protocol === 'file:' ? 'file://' : '';
  return u.port ? `${u.hostname.toLowerCase()}:${u.port}` : u.hostname.toLowerCase();
}

/** Next level in a direction ('in' | 'out'), from any current level. */
function step(cur, dir) {
  const c = clamp(cur);
  if (dir === 'in') return LEVELS.find(l => l > c + 0.5) || LEVELS[LEVELS.length - 1];
  return [...LEVELS].reverse().find(l => l < c - 0.5) || LEVELS[0];
}

/**
 * The remembered level for a page: its host's own, else the registrable domain's (older
 * Ferna versions remembered zoom per domain), else the default.
 */
function levelFor(url, levels, def = 100) {
  const key = hostKey(url);
  if (!key || !levels) return clamp(def);
  if (Number.isFinite(levels[key])) return clamp(levels[key]);
  const parts = key.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const k = parts.slice(i).join('.');
    if (Number.isFinite(levels[k])) return clamp(levels[k]);
  }
  return clamp(def);
}

/**
 * 0.9.0: zoom settings of the old built-in zoom (Zoom Page WE style) → plain levels.
 * Full-zoom entries keep their level; text-only entries are dropped (that zoom is the
 * Ferna Zoom extension's now). Returns { levels, def }.
 */
function migrate(zoomSites, zoomPrefs) {
  const levels = {};
  for (const [k, st] of Object.entries(zoomSites || {})) {
    if (!k || !st || typeof st !== 'object') continue;
    if (st.type === 'text') continue;
    const l = clamp(st.full);
    if (l !== 100) levels[k] = l;
  }
  const p = zoomPrefs || {};
  const def = p.defaultType === 'text' ? 100 : clamp(p.defaultFull || 100);
  return { levels, def };
}

module.exports = { LEVELS, MIN, MAX, clamp, hostKey, step, levelFor, migrate };
