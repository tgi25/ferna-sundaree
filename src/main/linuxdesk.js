'use strict';
// Linux desktop integration: .desktop launchers for profiles and installed web apps, icons,
// and making Ferna Sundaree the default browser (xdg-settings / xdg-mime).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const home = () => process.env.HOME || os.homedir();
const appsDir = () => path.join(process.env.XDG_DATA_HOME || path.join(home(), '.local', 'share'), 'applications');
const iconsDir = () => path.join(process.env.XDG_DATA_HOME || path.join(home(), '.local', 'share'), 'icons', 'hicolor', '256x256', 'apps');
/** The program to start: the AppImage file when running from one, else the installed binary. */
const exe = () => process.env.APPIMAGE || process.execPath;
// Desktop Entry Exec quoting: each argument in double quotes, with ", `, $ and \ escaped.
const q = a => `"${String(a).replace(/(["`$\\])/g, '\\$1')}"`;
const clean = s => String(s).replace(/[\r\n]/g, ' ').trim();

function desktopEntry({ name, comment, args = [], icon, wmClass, mime }) {
  return ['[Desktop Entry]', 'Type=Application', 'Version=1.0', `Name=${clean(name)}`, comment ? `Comment=${clean(comment)}` : null,
    `Exec=${[exe(), ...args].map(q).join(' ')}${mime ? ' %U' : ''}`, `Icon=${icon}`, 'Terminal=false', 'Categories=Network;WebBrowser;',
    wmClass ? `StartupWMClass=${clean(wmClass)}` : null, mime ? `MimeType=${mime}` : null, ''].filter(x => x !== null).join('\n');
}

function write(file, text, desktopCopy) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, { mode: 0o755 });
  if (desktopCopy) {
    try {
      fs.writeFileSync(desktopCopy, text, { mode: 0o755 });
      // GNOME shows launchers on the desktop only when marked trusted.
      execFile('gio', ['set', desktopCopy, 'metadata::trusted', 'true'], () => {});
    } catch { /* no desktop folder */ }
  }
  execFile('update-desktop-database', [appsDir()], () => {});
  return true;
}

function profileShortcut(name, desktopDir) {
  const id = `ferna-sundaree-profile-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const text = desktopEntry({ name: `Ferna Sundaree (${name})`, comment: `Ferna Sundaree, ${name} profile`, args: [`--profile=${name}`], icon: 'ferna-sundaree' });
  return write(path.join(appsDir(), `${id}.desktop`), text, desktopDir && path.join(desktopDir, `${id}.desktop`));
}

function webApp({ id, name, url, profile, pngPath, desktopDir }) {
  const iconName = `ferna-app-${id}`;
  try { fs.mkdirSync(iconsDir(), { recursive: true }); fs.copyFileSync(pngPath, path.join(iconsDir(), `${iconName}.png`)); } catch { /* keep the default icon */ }
  const args = [...(profile && profile !== 'Default' ? [`--profile=${profile}`] : []), `--app=${url}`];
  const text = desktopEntry({ name, comment: `${name} (Ferna Sundaree app)`, args, icon: iconName, wmClass: `ferna-app-${id}` });
  return write(path.join(appsDir(), `${iconName}.desktop`), text, desktopDir && path.join(desktopDir, `${iconName}.desktop`));
}

function removeWebApp(id, desktopDir) {
  for (const f of [path.join(appsDir(), `ferna-app-${id}.desktop`), desktopDir && path.join(desktopDir, `ferna-app-${id}.desktop`), path.join(iconsDir(), `ferna-app-${id}.png`)]) {
    if (f) try { fs.unlinkSync(f); } catch { /* gone */ }
  }
}

/** Make Ferna Sundaree the default browser and PDF viewer for this user. */
function makeDefault() {
  // Packages install ferna-sundaree.desktop; an AppImage gets its own launcher first.
  let desktop = 'ferna-sundaree.desktop';
  const system = ['/usr/share/applications/ferna-sundaree.desktop', path.join(appsDir(), 'ferna-sundaree.desktop')].some(f => fs.existsSync(f));
  if (!system || process.env.APPIMAGE) {
    desktop = 'ferna-sundaree-local.desktop';
    write(path.join(appsDir(), desktop), desktopEntry({ name: 'Ferna Sundaree', comment: 'Secure web browser', icon: 'ferna-sundaree', mime: 'text/html;x-scheme-handler/http;x-scheme-handler/https;application/pdf;application/x-fernaexam;' }));
  }
  return new Promise(resolve => {
    execFile('xdg-settings', ['set', 'default-web-browser', desktop], err => {
      execFile('xdg-mime', ['default', desktop, 'application/pdf', 'text/html', 'x-scheme-handler/http', 'x-scheme-handler/https'], () => resolve(!err));
    });
  });
}

module.exports = { desktopEntry, profileShortcut, webApp, removeWebApp, makeDefault, appsDir, exe };
