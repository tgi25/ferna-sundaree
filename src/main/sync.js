'use strict';
// Sync between your PCs without an account: Ferna writes one encrypted file into a folder you
// choose, normally one that OneDrive, Google Drive, Dropbox or a USB stick already keeps in step.
// Only someone with your passphrase can read it; neither Ferna nor the storage service can.
// What syncs: bookmarks (with tags and the reading list), workspaces and pinned sites, common
// settings, and (optionally) passwords, addresses and cards, and history.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { dialog } = require('electron');
const C = require('./synccore');
const { JsonStore } = require('./store');
const BM = require('./bookmarks');

const FILE = 'ferna-sundaree.fsync';

function create(ctx, { dataDir }) {
  const state = new JsonStore(path.join(dataDir, 'sync-state.enc'), { key: '', salt: '', device: '', base: null }, { encrypt: true });
  if (!state.data.device) { state.data.device = crypto.randomBytes(6).toString('hex'); state.save(); }
  const status = { running: false, last: 0, error: '', changes: 0 };
  let timer = null;
  const cfg = () => ({ folder: '', enabled: false, passwords: true, history: false, ...(ctx.settings.data.sync || {}) });
  const setCfg = patch => ctx.settings.set('sync', { ...cfg(), ...patch });
  const dir = () => path.join(cfg().folder, 'FernaSundaree');
  const keyBuf = () => state.data.key ? Buffer.from(state.data.key, 'base64') : null;

  function local() {
    const o = cfg();
    const out = {
      device: state.data.device, host: os.hostname(), at: Date.now(), version: ctx.version,
      bookmarks: ctx.bookmarks.data.items,
      workspaces: ctx.ws.data.workspaces, common: ctx.ws.data.common, allPinned: ctx.ws.data.allPinned,
      settings: Object.fromEntries(C.SYNCED_SETTINGS.filter(k => k in ctx.settings.data).map(k => [k, ctx.settings.data[k]])),
    };
    if (o.passwords && ctx.passwords) { const v = ctx.passwords.vault.data; out.logins = v.logins; out.addresses = v.addresses; out.cards = v.cards; }
    if (o.history) out.history = ctx.history.data.entries.slice(0, 20000);
    // A copy: the base kept after a sync must not change when the live data does.
    return JSON.parse(JSON.stringify(out));
  }

  function apply(m) {
    ctx.bookmarks.data.items = BM.repair(m.bookmarks);
    ctx.bookmarks.save();
    ctx.ws.data.workspaces = m.workspaces; ctx.ws.data.common = m.common; ctx.ws.data.allPinned = m.allPinned;
    ctx.ws.save();
    for (const [k, v] of Object.entries(m.settings || {})) if (ctx.SETTABLE && ctx.SETTABLE[k] && ctx.SETTABLE[k](v) && JSON.stringify(ctx.settings.data[k]) !== JSON.stringify(v)) ctx.settings.set(k, v);
    if (m.logins && ctx.passwords) { const v = ctx.passwords.vault.data; v.logins = m.logins; v.addresses = m.addresses || v.addresses; v.cards = m.cards || v.cards; ctx.passwords.vault.save(); }
    if (m.history) { ctx.history.data.entries = m.history; ctx.history.save(); }
    ctx.broadcast();
    ctx.notifyPages('bookmarks'); ctx.notifyPages('passwords');
  }

  function mergeAll(base, loc, rem) {
    const b = base || {};
    const m = {
      bookmarks: C.merge3(b.bookmarks, loc.bookmarks, rem.bookmarks),
      workspaces: C.merge3(b.workspaces, loc.workspaces, rem.workspaces || []),
      common: C.merge3value(b.common, loc.common, rem.common || []),
      allPinned: C.merge3value(b.allPinned, loc.allPinned, rem.allPinned || []),
      settings: C.mergeSettings(b.settings, loc.settings, rem.settings || {}),
    };
    if (loc.logins) { m.logins = C.merge3(b.logins, loc.logins, rem.logins || []); m.addresses = C.merge3(b.addresses, loc.addresses, rem.addresses || []); m.cards = C.merge3(b.cards, loc.cards, rem.cards || []); }
    if (loc.history) m.history = C.mergeHistory(loc.history, rem.history || []);
    return m;
  }

  /** One sync: read the folder's file(s), merge, apply here, write back. */
  async function run() {
    const o = cfg();
    if (!o.enabled || !o.folder || !keyBuf()) return { ...status };
    if (status.running) return { ...status };
    status.running = true; status.error = '';
    try {
      fs.mkdirSync(dir(), { recursive: true });
      const key = keyBuf();
      const salt = Buffer.from(state.data.salt, 'base64');
      // The main file plus any "conflicted copy" the cloud service made.
      const files = fs.readdirSync(dir()).filter(f => /^ferna-sundaree.*\.fsync$/i.test(f));
      const loc0 = local();
      let merged = { ...loc0 };
      let base = state.data.base;
      for (const f of files.sort((a, b) => (a === FILE ? -1 : b === FILE ? 1 : a.localeCompare(b)))) {
        const remote = C.open(fs.readFileSync(path.join(dir(), f), 'utf8'), key);
        merged = { ...merged, ...mergeAll(base, merged, remote) };
        if (f !== FILE) base = null; // after a conflict copy, merge without assuming deletions
      }
      const changed = JSON.stringify([merged.bookmarks, merged.workspaces, merged.settings, merged.logins]) !== JSON.stringify([loc0.bookmarks, loc0.workspaces, loc0.settings, loc0.logins]);
      if (changed) apply(merged);
      const out = { ...local() };
      const tmp = path.join(dir(), `${FILE}.${state.data.device}.tmp`);
      fs.writeFileSync(tmp, C.seal(out, key, salt));
      fs.renameSync(tmp, path.join(dir(), FILE));
      for (const f of files) if (f !== FILE) { try { fs.unlinkSync(path.join(dir(), f)); } catch { /* ignore */ } }
      state.data.base = { bookmarks: out.bookmarks, workspaces: out.workspaces, common: out.common, allPinned: out.allPinned, settings: out.settings, logins: out.logins, addresses: out.addresses, cards: out.cards };
      state.save();
      status.last = Date.now();
      status.changes = changed ? status.changes + 1 : status.changes;
      setCfg({ last: status.last });
    } catch (e) {
      status.error = String(e && e.message || e);
    } finally { status.running = false; }
    ctx.notifyPages('settings');
    return { ...status };
  }

  /** Set up: folder + passphrase. With an existing sync file the passphrase must open it. */
  async function setup(folder, passphrase, opts = {}) {
    if (!folder || !fs.existsSync(folder)) return { ok: false, error: 'Choose a folder that exists.' };
    if (String(passphrase || '').length < 10) return { ok: false, error: 'Use a passphrase of at least 10 characters (a few words is best).' };
    const d = path.join(folder, 'FernaSundaree');
    const f = path.join(d, FILE);
    let salt;
    if (fs.existsSync(f)) {
      try { salt = C.header(fs.readFileSync(f, 'utf8')).salt; } catch (e) { return { ok: false, error: e.message }; }
      const key = C.deriveKey(passphrase, salt);
      try { C.open(fs.readFileSync(f, 'utf8'), key); } catch (e) { return { ok: false, error: 'That passphrase does not open the sync file already in this folder.' }; }
      state.data.key = key.toString('base64');
    } else {
      salt = crypto.randomBytes(16);
      state.data.key = C.deriveKey(passphrase, salt).toString('base64');
    }
    state.data.salt = salt.toString('base64');
    state.data.base = null; // first sync: merge without assuming anything was deleted
    state.save();
    setCfg({ folder, enabled: true, passwords: opts.passwords !== false, history: !!opts.history });
    const r = await run();
    return { ok: !r.error, error: r.error, status: r };
  }
  function disable() { state.data.key = ''; state.data.base = null; state.save(); setCfg({ enabled: false }); return true; }

  function soon() { if (!cfg().enabled) return; clearTimeout(timer); timer = setTimeout(run, 30000); }
  setTimeout(() => run(), 20000).unref?.();
  setInterval(() => run(), 10 * 60000).unref?.();

  function register(Cmd) {
    const P = ['settings'];
    Cmd('sync:status', [], P, () => ({ ...status, ...cfg(), device: state.data.device, ready: !!keyBuf() }));
    Cmd('sync:choose-folder', [], P, async c => {
      const w = ctx.windowFor(c.wc);
      const r = await dialog.showOpenDialog(w.win, { title: 'Folder to sync through (OneDrive, Google Drive, Dropbox …)', properties: ['openDirectory', 'createDirectory'], defaultPath: process.env.OneDrive || os.homedir() });
      return r.canceled ? '' : r.filePaths[0];
    });
    Cmd('sync:setup', ['string', 'string', 'object?'], P, (c, folder, pass, opts) => setup(folder, pass, opts || {}));
    Cmd('sync:now', [], P, () => run());
    Cmd('sync:disable', [], P, () => disable());
    Cmd('sync:options', ['object'], P, (c, o) => { setCfg({ passwords: !!o.passwords, history: !!o.history }); soon(); return true; });
  }

  return { run, setup, disable, soon, register, status };
}

module.exports = { create };
