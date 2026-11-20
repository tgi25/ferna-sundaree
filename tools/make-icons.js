// Renders the icon at every size with Playwright's Chromium (a dev dependency):
//   build/icon.svg        — 48 px and up (the full drawing)
//   build/icon-small.svg  — 16, 24 and 32 px (drawn for small sizes: no stripes, bigger eyes)
// Writes build/icon-<size>.png, build/icon.png (512) and build/icons/<size>x<size>.png (Linux).
// Run: node tools/make-icons.js   (then python3 tools/make-ico.py)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const SMALL = [16, 24, 32];
const LARGE = [48, 64, 128, 256, 512];
(async () => {
  const dir = path.join(__dirname, '..', 'build');
  // ICON_CHROME: a Chromium to use when Playwright's own browser is not downloaded.
  const browser = await chromium.launch(process.env.ICON_CHROME ? { executablePath: process.env.ICON_CHROME } : {});
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const shot = async (file, size) => {
    const svg = fs.readFileSync(path.join(dir, file), 'utf8');
    await page.setContent(`<html><head><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style></head><body>${svg}</body></html>`);
    return page.locator('svg').screenshot({ omitBackground: true });
  };
  fs.mkdirSync(path.join(dir, 'icons'), { recursive: true });
  for (const size of [...SMALL, ...LARGE]) {
    const png = await shot(SMALL.includes(size) ? 'icon-small.svg' : 'icon.svg', size);
    fs.writeFileSync(path.join(dir, `icon-${size}.png`), png);
    fs.writeFileSync(path.join(dir, 'icons', `${size}x${size}.png`), png);
    if (size === 512) fs.writeFileSync(path.join(dir, 'icon.png'), png);
  }
  await browser.close();
  console.log('icons written');
})();
