'use strict';
// Separate identities:
//   • Workspaces with "separate logins": each has its own cookies, storage and sign-ins
//     (like Firefox containers), so a personal and a university Google account can be open side
//     by side in one window. Extensions run only in the shared (normal) session.
//   • Profiles: a whole separate browser (bookmarks, passwords, extensions, settings), run as its
//     own instance with --profile=<name>; each can get a desktop shortcut.
//   • Private window with Tor: a private window whose traffic goes through Tor (needs Tor Browser
//     or the Tor service running on this PC; nothing is bundled).
//   • Spell-check languages.

const fs = require('fs');
const net = require('net');
const path = require('path');
const { app, session, dialog, shell } = require('electron');

function install(ctx, { hardenSession }) {
  const containers = new Map(); // workspace id → session

  ctx.sessionForWorkspace = wsId => {
    const w = wsId && ctx.ws.data.workspaces.find(x => x.id === wsId);
    if (!w || !w.separate) return ctx.webSession;
    if (!containers.has(w.id)) {
      const ses = session.fromPartition(`persist:ws-${w.id.replace(/[^\w-]/g, '')}`);
      hardenSession(ses);
      containers.set(w.id, ses);
    }
    return containers.get(w.id);
  };
  ctx.containerOf = (win, tab) => {
    if (!tab || win.private || tab.kind !== 'web') return null;
    const id = tab.wsOverride || win.tabWorkspace(tab);
    const w = id && ctx.ws.data.workspaces.find(x => x.id === id);
    return w && w.separate ? { id: w.id, name: w.name, color: w.color } : null;
  };
  /** Turn "separate logins" on or off for a workspace; its open tabs reload in the new session. */
  ctx.setWorkspaceSeparate = (wsId, on) => {
    const w = ctx.ws.data.workspaces.find(x => x.id === wsId);
    if (!w) return false;
    if (on) w.separate = true; else delete w.separate;
    ctx.ws.save();
    for (const win of ctx.windows) for (const t of win.tabs) if ((t.wsOverride || win.tabWorkspace(t)) === wsId) win.reopenInSession(t);
    ctx.broadcast();
    return true;
  };
  /** Clear one container's cookies and storage (when the option is turned off, or on request). */
  ctx.clearContainer = async wsId => {
    const ses = session.fromPartition(`persist:ws-${String(wsId).replace(/[^\w-]/g, '')}`);
    await ses.clearStorageData().catch(() => {});
    await ses.clearCache().catch(() => {});
  };

  // ---------- profiles ----------
  const safeName = n => String(n || '').replace(/[^\w .-]/g, '').trim().slice(0, 40);
  ctx.listProfiles = () => {
    try { return fs.readdirSync(ctx.profilesDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort((a, b) => (a === 'Default' ? -1 : b === 'Default' ? 1 : a.localeCompare(b))); } catch { return ['Default']; }
  };
  const exeArgs = extra => {
    const args = app.isPackaged ? [] : [path.join(__dirname, '..', '..')];
    return [...args, ...extra];
  };
  ctx.launchProfile = name => {
    name = safeName(name);
    if (!name) return false;
    if (name === ctx.profile) { ctx.newWindow({}); return true; }
    fs.mkdirSync(path.join(ctx.profilesDir, name), { recursive: true });
    const { spawn } = require('child_process');
    const child = spawn(process.env.APPIMAGE || process.execPath, exeArgs([`--profile=${name}`]), { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  };
  ctx.profileShortcut = name => {
    name = safeName(name);
    if (process.platform === 'linux') return require('./linuxdesk').profileShortcut(name, app.getPath('desktop'));
    if (process.platform !== 'win32') return false;
    const lnk = path.join(app.getPath('desktop'), `Ferna Sundaree - ${name}.lnk`);
    return shell.writeShortcutLink(lnk, { target: process.execPath, args: exeArgs([`--profile=${name}`]).map(a => (/\s/.test(a) ? `"${a}"` : a)).join(' '), description: `Ferna Sundaree (${name} profile)`, icon: process.execPath, iconIndex: 0, appUserModelId: `com.fernasolutions.sundaree.${name}` });
  };
  ctx.profileMenu = win => [
    ...ctx.listProfiles().map(n => ({ label: n === ctx.profile ? `${n} (this window)` : n, type: 'radio', checked: n === ctx.profile, click: () => ctx.launchProfile(n) })),
    { type: 'separator' },
    { label: 'New profile…', click: () => win.openOverlay('prompt', { title: 'New profile', label: 'Name', value: '', action: 'profile:create' }) },
    { label: 'Manage profiles…', click: () => win.openInternal('ferna://settings/#profiles') },
  ];

  // ---------- Tor ----------
  const probe = port => new Promise(res => {
    const s = net.connect({ host: '127.0.0.1', port }, () => { s.destroy(); res(true); });
    s.on('error', () => res(false));
    s.setTimeout(800, () => { s.destroy(); res(false); });
  });
  ctx.openTorWindow = async () => {
    const port = (await probe(9150)) ? 9150 : (await probe(9050)) ? 9050 : 0;
    if (!port) {
      const r = await dialog.showMessageBox({
        type: 'info', buttons: ['OK', 'Get Tor Browser'], defaultId: 0, noLink: true, title: 'Tor is not running',
        message: 'Start Tor first, then try again.',
        detail: 'Ferna Sundaree sends a Tor window through the Tor network that Tor Browser (port 9150) or the Tor service (port 9050) provides on this PC. Open Tor Browser and leave it running, then choose "New private window with Tor" again.\n\nFor the strongest anonymity use Tor Browser itself: it also hides your screen size, fonts and other details that a normal browser shows.',
      });
      if (r.response === 1) shell.openExternal('https://www.torproject.org/download/');
      return null;
    }
    const ses = ctx.newPrivateSession();
    await ctx.configureTorSession(ses, port);
    return ctx.newWindow({ private: true, session: ses, tor: port, url: 'https://check.torproject.org/' });
  };
  ctx.configureTorSession = async (ses, port) => {
    await ses.setProxy({ proxyRules: `socks5://127.0.0.1:${port}`, proxyBypassRules: '<-loopback>' });
    // WebRTC could reveal the real address around the proxy.
    ses.setPermissionCheckHandler(() => false);
  };

  // ---------- spell check ----------
  ctx.applySpellLangs = () => {
    const want = (ctx.settings.data.spellLangs && ctx.settings.data.spellLangs.length) ? ctx.settings.data.spellLangs : ['en-US'];
    for (const ses of ctx.webSessions || []) {
      let avail = [];
      try { avail = ses.availableSpellCheckerLanguages || []; } catch { /* ignore */ }
      const langs = avail.length ? want.filter(l => avail.includes(l)) : want;
      try { ses.setSpellCheckerLanguages(langs.length ? langs : ['en-US']); } catch { /* Windows uses its own list */ }
    }
  };
}

module.exports = { install };
