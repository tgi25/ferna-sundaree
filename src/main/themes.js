'use strict';
// Chrome themes: a theme is a .crx whose manifest has a "theme" key with colors, images
// and properties. Ferna Sundaree maps them onto its own UI variables. Pure functions.

const fs = require('fs');
const path = require('path');

function rgb(c) {
  if (!Array.isArray(c) || c.length < 3 || !c.slice(0, 3).every(n => Number.isFinite(n))) return null;
  const [r, g, b] = c.map(n => Math.max(0, Math.min(255, Math.round(n))));
  const a = c.length > 3 && Number.isFinite(c[3]) ? Math.max(0, Math.min(1, c[3])) : 1;
  return a < 1 ? `rgba(${r}, ${g}, ${b}, ${a})` : `rgb(${r}, ${g}, ${b})`;
}

function luminance(c) {
  if (!Array.isArray(c)) return null;
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}

/**
 * @param {object} manifest  theme manifest
 * @returns {{name, vars: Record<string,string>, images: Record<string,string>, dark: boolean, ntp: object}}
 */
function themeFromManifest(manifest, dir) {
  const t = (manifest && manifest.theme) || {};
  const C = t.colors || {};
  const vars = {};
  const set = (k, v) => { if (v) vars[k] = v; };
  set('--th-frame', rgb(C.frame));
  set('--th-frame-inactive', rgb(C.frame_inactive) || rgb(C.frame));
  set('--th-toolbar', rgb(C.toolbar));
  set('--th-tab-text', rgb(C.tab_text) || rgb(C.toolbar_text));
  set('--th-tab-bg-text', rgb(C.tab_background_text) || rgb(C.background_tab_text));
  set('--th-bookmark-text', rgb(C.bookmark_text) || rgb(C.toolbar_text));
  set('--th-toolbar-icon', rgb(C.toolbar_button_icon) || rgb(C.tab_text));
  set('--th-omnibox-bg', rgb(C.omnibox_background));
  set('--th-omnibox-text', rgb(C.omnibox_text));
  set('--th-ntp-bg', rgb(C.ntp_background));
  set('--th-ntp-text', rgb(C.ntp_text));
  set('--th-ntp-link', rgb(C.ntp_link));
  const images = {};
  const I = t.images || {};
  for (const key of ['theme_frame', 'theme_frame_inactive', 'theme_toolbar', 'theme_tab_background', 'theme_ntp_background', 'theme_ntp_attribution']) {
    const rel = typeof I[key] === 'string' ? I[key] : null;
    if (!rel || rel.includes('..')) continue;
    if (dir && !fs.existsSync(path.join(dir, rel))) continue;
    images[key] = rel.replace(/\\/g, '/');
  }
  const P = t.properties || {};
  const lum = luminance(C.toolbar || C.frame);
  return {
    name: manifest.name || 'Theme',
    vars,
    images,
    dark: lum !== null ? lum < 0.25 : false,
    ntp: {
      alignment: typeof P.ntp_background_alignment === 'string' ? P.ntp_background_alignment : 'center',
      repeat: typeof P.ntp_background_repeat === 'string' ? P.ntp_background_repeat : 'no-repeat',
    },
  };
}

module.exports = { themeFromManifest, rgb, luminance };
