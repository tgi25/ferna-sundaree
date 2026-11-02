// Renders build/icon.svg once at 1024 px with Electron, then scales to each size.
// Run: npx electron tools/make-icons.js   (then python3 tools/make-ico.py)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const dir = path.join(__dirname, '..', 'build');
  const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8').replace('width="128" height="128"', 'width="1024" height="1024"');
  const w = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  const file = path.join(app.getPath('temp'), 'ferna-icon.html');
  fs.writeFileSync(file, `<html><body style="margin:0;background:transparent;overflow:hidden">${svg}</body></html>`);
  await w.loadFile(file);
  await new Promise(r => setTimeout(r, 400));
  const big = await w.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
    fs.writeFileSync(path.join(dir, `icon-${size}.png`), big.resize({ width: size, height: size, quality: 'best' }).toPNG());
  }
  fs.writeFileSync(path.join(dir, 'icon.png'), big.resize({ width: 512, height: 512, quality: 'best' }).toPNG());
  app.quit();
});
