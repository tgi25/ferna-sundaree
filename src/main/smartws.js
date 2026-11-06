'use strict';
// Smart workspaces: notices sites you open together at the same time of day (src/main/routines.js),
// offers to make them a workspace, and opens scheduled workspaces by themselves.
const path = require('path');
const { dialog } = require('electron');
const R = require('./routines');
const { JsonStore } = require('./store');

function create(ctx, { dataDir }) {
  const store = new JsonStore(path.join(dataDir, 'routines.enc'), { days: {}, skip: [], offered: {} }, { encrypt: true });
  const S = () => ctx.settings.data;
  const on = () => S().smartWorkspaces !== false && !ctx.examWin && !(ctx.parental && ctx.parental.on && ctx.parental.on());
  let timer = null;
  let pending = null; // the routine offered in the last toast

  const schedules = () => (Array.isArray(S().wsSchedules) ? S().wsSchedules : []);
  const saveSchedules = list => ctx.settings.set('wsSchedules', list.slice(0, 30));
  const wsById = id => ctx.ws.data.workspaces.find(w => w.id === id);
  const accepted = () => schedules().map(s => s.routine).filter(Boolean);
  const routines = (now = Date.now()) => R.findRoutines(store.data, { skip: [...store.data.skip, ...accepted(), ...(store.data.made || [])], now });
  // "Inbox (12) - me@gmail.com - Gmail" → "Gmail"; "Dashboard | SJP LMS" → "SJP LMS".
  const titleOf = site => {
    const t = String(R.bestUrl(store.data, site).title || '').replace(/^\(\d+\)\s*|\s*\(\d+\)/g, '').trim();
    const parts = t.split(/\s+[-|–—:]\s+/).map(x => x.trim()).filter(Boolean);
    const name = parts.length > 1 && parts[parts.length - 1].length <= 25 ? parts[parts.length - 1] : parts[0] || '';
    return name && name.length <= 40 ? name : site.replace(/^www\./, '');
  };
  const names = r => { const n = r.sites.map(titleOf); return n.map((x, i) => (n.indexOf(x) !== i || n.lastIndexOf(x) !== i ? r.sites[i].split(':')[0] : x)); };
  const describe = r => { const names2 = names(r); return names2.length > 2 ? `${names2.slice(0, -1).join(', ')} and ${names2[names2.length - 1]}` : names2.join(' and '); };
  const nameFor = r => { const base = r.minute < 12 * 60 ? 'Morning' : r.minute < 17 * 60 ? 'Afternoon' : 'Evening'; return ctx.ws.data.workspaces.some(w => w.name === base) ? `${base} ${r.time}` : base; };

  /** A page finished loading in a tab: note the first open of its site today. */
  function note(win, tab) {
    if (!on() || win.private || win.appMode || !tab || tab.kind !== 'web') return;
    if (tab.noRoutine) { tab.noRoutine = false; return; } // the tab restored at start-up, or opened by a schedule
    const url = tab.url || '';
    if (!R.record(store.data, url, tab.title)) return;
    store.save();
    // Did that complete a routine today? Then offer it, right when it is happening.
    const today = store.data.days[R.dayKey(Date.now())] || {};
    const r = routines().find(x => x.sites.every(s => today[s]) && x.sites.includes(R.siteKey(url)));
    if (!r) return;
    const last = store.data.offered[r.id] || 0;
    if (Date.now() - last < 3 * 86400000) return;
    store.data.offered[r.id] = Date.now(); store.save();
    pending = r;
    win.sendUi('toast', { text: `You open ${describe(r)} together around ${r.time} on ${R.daysLabel(r.days)}. Make it a workspace that opens itself?`, action: 'Set up', cmd: 'wsx:accept', ms: 15000 });
  }

  /** Turn a routine into a workspace; with a schedule, it opens itself. */
  function makeWorkspace(r, { schedule = true, name } = {}) {
    const w = ctx.createWorkspace(name || nameFor(r));
    w.icon = r.minute < 12 * 60 ? '☀' : r.minute < 17 * 60 ? '◐' : '☾';
    for (const s of r.sites) {
      const b = R.bestUrl(store.data, s);
      if (!w.pinned.some(p => p.url === b.url)) w.pinned.push({ url: b.url, title: names(r)[r.sites.indexOf(s)], folder: require('./workspaces').folderOf(b.url) });
      const host = s.split('/')[0];
      if (!w.hosts.includes(host) && !/^(docs|drive)\.google\.com$/.test(host)) w.hosts.push(host);
    }
    ctx.ws.save(); ctx.broadcast();
    store.data.made = [...new Set([...(store.data.made || []), r.id])].slice(-50); store.save();
    if (schedule) saveSchedules([...schedules().filter(x => x.wsId !== w.id), { wsId: w.id, days: r.days, time: r.time, on: true, last: R.dayKey(Date.now()), routine: r.id }]);
    return w;
  }

  async function accept(win, r = pending) {
    if (!r) { win.openInternal('ferna://settings/#workspaces'); return; }
    const res = await api.showDialog(win.win, {
      type: 'question', title: 'Smart workspace',
      message: `Make a workspace of ${describe(r)}?`,
      detail: `You opened these together around ${r.time} on ${r.support} ${R.daysLabel(r.days) === 'weekdays' ? 'weekdays' : 'days'} recently.\n\nThe workspace “${nameFor(r)}” gets these sites pinned. With the schedule, Ferna opens it by itself at ${r.time} on ${R.daysLabel(r.days)} (or when you start the browser up to 90 minutes later). Change or remove it in Settings → Workspaces.`,
      buttons: [`Create and open at ${r.time} on ${R.daysLabel(r.days)}`, 'Create without a schedule', 'Not now', 'Don’t suggest this'], defaultId: 0, cancelId: 2, noLink: true,
    });
    if (res.response === 0 || res.response === 1) {
      const w = makeWorkspace(r, { schedule: res.response === 0 });
      win.switchWorkspace(w.id);
      win.sendUi('toast', { text: res.response === 0 ? `“${w.name}” will open by itself at ${r.time} on ${R.daysLabel(r.days)}.` : `Created the workspace “${w.name}”.`, action: 'Settings', cmd: 'wsx:settings', ms: 7000 });
    } else if (res.response === 3) { dismiss(r.id); }
    pending = null;
  }
  function dismiss(id) { store.data.skip = [...new Set([...store.data.skip, id])].slice(-100); store.save(); }

  /** Open a scheduled workspace: switch to it and open each pinned site that is not open yet. */
  function openWorkspace(sched, win) {
    const w = wsById(sched.wsId);
    if (!w) return false;
    win = win || (ctx.lastFocused && !ctx.lastFocused.win.isDestroyed() && !ctx.lastFocused.private ? ctx.lastFocused : ctx.windows.find(x => !x.private && !x.appMode && !x.exam));
    if (!win) return false;
    win.switchWorkspace(w.id);
    let first = null;
    for (const p of w.pinned) {
      const site = R.siteKey(p.url);
      const open = win.tabs.find(t => R.siteKey(require('./workspaces').pageUrlOf(t.pendingUrl || t.url)) === site);
      if (open) { first = first || open; continue; }
      const t = win.newTab(p.url, { activate: false });
      if (t) { t.noRoutine = true; first = first || t; }
    }
    if (first) win.activate(first);
    win.sendUi('toast', { text: `Opened “${w.name}” (scheduled, ${sched.time} on ${R.daysLabel(sched.days)}).`, action: 'Settings', cmd: 'wsx:settings', ms: 7000 });
    return true;
  }

  function tick(now = Date.now()) {
    if (!on()) return;
    const list = schedules();
    let changed = false;
    for (const s of list) {
      if (!R.isDue(s, now)) continue;
      if (openWorkspace(s)) { s.last = R.dayKey(now); changed = true; }
    }
    if (changed) saveSchedules(list.map(s => ({ ...s })));
  }
  function start() {
    clearInterval(timer);
    timer = setInterval(() => { try { tick(); } catch { /* next time */ } }, 30000);
    setTimeout(() => { try { tick(); } catch { /* next time */ } }, Number(process.env.FERNA_WSX_FIRST || 8000));
  }

  function info() {
    return {
      on: S().smartWorkspaces !== false,
      schedules: schedules().map(s => ({ ...s, name: (wsById(s.wsId) || {}).name || '(deleted workspace)', exists: !!wsById(s.wsId), label: R.daysLabel(s.days) })),
      suggestions: routines().map(r => ({ id: r.id, text: describe(r), time: r.time, days: r.days, label: R.daysLabel(r.days), support: r.support, name: nameFor(r) })),
      learnedDays: Object.keys(store.data.days).length,
    };
  }
  function setSchedule(wsId, o) {
    if (!wsById(wsId)) throw new Error('No such workspace');
    const days = Array.isArray(o.days) ? [...new Set(o.days.filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [1, 2, 3, 4, 5];
    const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(o.time || '') ? o.time : '08:00';
    const cur = schedules().find(s => s.wsId === wsId) || {};
    saveSchedules([...schedules().filter(s => s.wsId !== wsId), { ...cur, wsId, days, time, on: o.on !== false, last: cur.last || '' }]);
    return info();
  }
  function removeSchedule(wsId) { saveSchedules(schedules().filter(s => s.wsId !== wsId)); return info(); }
  function createFrom(id, schedule) { const r = routines().find(x => x.id === id); if (!r) throw new Error('That suggestion is gone'); const w = makeWorkspace(r, { schedule }); return { ...info(), ws: w.id }; }
  function forget() { store.data.days = {}; store.data.offered = {}; store.save(); return info(); }

  const api = { note, accept, dismiss, makeWorkspace, openWorkspace, tick, start, info, setSchedule, removeSchedule, createFrom, forget, routines, store, showDialog: (w, o) => dialog.showMessageBox(w, o), get pending() { return pending; } };
  return api;
}

module.exports = { create };
