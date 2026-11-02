'use strict';
// Install a site as an app: a Start-menu and desktop shortcut that opens the site in its own
// window (no tabs or address bar, its own taskbar button and icon). Links to other sites open
// in the normal browser. Started with --app=<address>.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, shell, nativeImage } = require('electron');

/** A Windows .ico holding PNG images (Vista and later read PNG entries directly). */
function pngsToIco(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6 + 16 * count);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(count, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e); header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt8(0, e + 2); header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8); header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map(p => p.data)]);
}

function appsFile(ctx) { return path.join(ctx.dataDir, 'apps.json'); }
function list(ctx) { try { return JSON.parse(fs.readFileSync(appsFile(ctx), 'utf8')).apps || []; } catch { return []; } }
function saveList(ctx, apps) { fs.writeFileSync(appsFile(ctx), JSON.stringify({ apps }, null, 2)); }

function shortcutPaths(name) {
  const safe = name.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 60) || 'Web app';
  return {
    start: path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Ferna Sundaree Apps', `${safe}.lnk`),
    desktop: path.join(app.getPath('desktop'), `${safe}.lnk`),
  };
}

/** 256 px PNG of the site's icon (Linux launchers). */
async function pngFor(ctx, tab) {
  let img = null;
  try {
    if (tab.favicon && tab.favicon.startsWith('data:')) img = nativeImage.createFromDataURL(tab.favicon);
    else if (tab.favicon && /^https?:/.test(tab.favicon)) { const r = await ctx.webSession.fetch(tab.favicon); if (r.ok) img = nativeImage.createFromBuffer(Buffer.from(await r.arrayBuffer())); }
  } catch { img = null; }
  if (!img || img.isEmpty()) img = nativeImage.createFromPath(ctx.iconPath);
  return img.resize({ width: 256, height: 256, quality: 'best' }).toPNG();
}

async function iconFor(ctx, tab, id) {
  const dir = path.join(ctx.dataDir, 'apps');
  fs.mkdirSync(dir, { recursive: true });
  let img = null;
  try {
    if (tab.favicon && /^https?:|^data:/.test(tab.favicon)) {
      if (tab.favicon.startsWith('data:')) img = nativeImage.createFromDataURL(tab.favicon);
      else { const r = await ctx.webSession.fetch(tab.favicon); if (r.ok) img = nativeImage.createFromBuffer(Buffer.from(await r.arrayBuffer())); }
    }
  } catch { img = null; }
  if (!img || img.isEmpty()) img = nativeImage.createFromPath(ctx.iconPath);
  const pngs = [16, 32, 48, 256].map(size => ({ size, data: img.resize({ width: size, height: size, quality: 'best' }).toPNG() }));
  const file = path.join(dir, `${id}.ico`);
  fs.writeFileSync(file, pngsToIco(pngs));
  return file;
}

/** Ask for the name, then create it (from the overlay prompt, action app:install). */
function install(ctx, win, tab) {
  win.openOverlay('prompt', { title: 'Install as an app', label: 'App name', value: (tab.title || new URL(tab.url).hostname).slice(0, 60), action: 'app:install', id: String(tab.id) });
}

async function create(ctx, win, tab, name) {
  const url = tab.url;
  const origin = new URL(url).origin;
  const id = crypto.createHash('sha1').update(origin).digest('hex').slice(0, 12);
  const icon = await iconFor(ctx, tab, id);
  const args = [...(app.isPackaged ? [] : [path.join(__dirname, '..', '..')]), ...(ctx.profile !== 'Default' ? [`--profile=${ctx.profile}`] : []), `--app=${url}`];
  const sc = shortcutPaths(name);
  let ok = true;
  if (process.platform === 'linux') {
    const png = path.join(ctx.dataDir, 'apps', `${id}.png`);
    fs.writeFileSync(png, (await pngFor(ctx, tab)));
    ok = require('./linuxdesk').webApp({ id, name, url, profile: ctx.profile, pngPath: png, desktopDir: app.getPath('desktop') });
  } else if (process.platform === 'win32') {
    fs.mkdirSync(path.dirname(sc.start), { recursive: true });
    const opts = { target: process.execPath, args: args.map(a => (/[\s&]/.test(a) ? `"${a}"` : a)).join(' '), description: `${name} (Ferna Sundaree app)`, icon, iconIndex: 0, appUserModelId: `com.fernasolutions.sundaree.app.${id}` };
    ok = shell.writeShortcutLink(sc.start, opts) && shell.writeShortcutLink(sc.desktop, opts);
  }
  const apps = list(ctx).filter(a => a.id !== id);
  apps.push({ id, name, url, origin, icon, created: Date.now() });
  saveList(ctx, apps);
  win.sendUi('toast', { text: ok ? `“${name}” is installed. Find it in ${process.platform === 'linux' ? 'your applications menu' : 'the Start menu'} and on the desktop.` : 'Could not create the shortcuts.' });
  ctx.openAppWindow(url, name);
  return ok;
}

function uninstall(ctx, id) {
  const apps = list(ctx);
  const a = apps.find(x => x.id === id);
  if (!a) return false;
  if (process.platform === 'linux') require('./linuxdesk').removeWebApp(id, app.getPath('desktop'));
  const sc = shortcutPaths(a.name);
  for (const f of [sc.start, sc.desktop, a.icon, path.join(ctx.dataDir, 'apps', `${id}.png`)]) { try { fs.unlinkSync(f); } catch { /* gone */ } }
  saveList(ctx, apps.filter(x => x.id !== id));
  return true;
}

module.exports = { install, create, uninstall, list, pngsToIco };
