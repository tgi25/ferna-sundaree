// Ferna Sundaree — browser UI (tab strip, toolbar, bookmarks bar, find bar).
// Drawn in a view behind the page; the main process tells it where the page sits.
'use strict';

const { icon, esc, faviconHtml, wsIconHtml, $ } = FK;
const api = window.ferna;
let S = null;
let dragId = null;

const el = {
  tabs: $('#tabs'), toolbar: $('#toolbar'), bookmarks: $('#bookmarks'), find: $('#find'),
  edgeTabs: $('#edge-tabs'), edgeToolbar: $('#edge-toolbar'), address: $('#address'), toast: $('#toast'),
};

// ---------- static buttons ----------
$('#btn-back').innerHTML = icon('back');
$('#btn-forward').innerHTML = icon('forward');
$('#btn-star').innerHTML = icon('star');
$('#btn-shield').insertAdjacentHTML('afterbegin', icon('shield'));
$('#btn-shot').innerHTML = icon('camera');
$('#btn-zoom').insertAdjacentHTML('afterbegin', icon('zoom'));
$('#btn-puzzle').innerHTML = icon('puzzle');
const rectOf = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; };
$('#btn-zoom').onclick = () => api.cmd('zoom:panel', rectOf($('#btn-zoom')));
$('#btn-puzzle').onclick = () => api.cmd('ext:puzzle');
$('#btn-pip').innerHTML = icon('pip');
$('#btn-pip').onclick = () => api.cmd('run', 'pip');
$('#btn-eq').insertAdjacentHTML('afterbegin', icon('eq'));
$('#btn-eq').onclick = () => api.cmd('eq:panel', rectOf($('#btn-eq')));
$('#btn-media').innerHTML = icon('play');
$('#btn-media').onclick = () => api.cmd('media:panel', rectOf($('#btn-media')));
$('#btn-split').innerHTML = icon('split');
$('#btn-split').onclick = () => api.cmd('split:act', 'toggle');
$('#btn-split').addEventListener('contextmenu', e => { e.preventDefault(); api.cmd('menu:split'); });
$('#btn-assistant').innerHTML = icon('sparkle');
$('#btn-assistant').onclick = () => api.cmd('run', 'assistant');
$('#btn-reader').innerHTML = icon('reader');
$('#btn-reader').onclick = () => api.cmd('run', 'readerMode');
$('#btn-translate').innerHTML = icon('translate');
$('#btn-translate').onclick = () => api.cmd('run', 'translatePage');
$('#btn-key').innerHTML = icon('key');
$('#btn-key').onclick = () => api.cmd('pw:site-menu');
// Split view divider: drag to resize the two halves.
(() => {
  const d = $('#split-divider');
  let drag = null;
  d.addEventListener('pointerdown', e => { if (!S || !S.split) return; drag = { content: S.split.content }; d.setPointerCapture(e.pointerId); d.classList.add('drag'); });
  d.addEventListener('pointermove', e => {
    if (!drag) return;
    const c = drag.content;
    const r = (e.clientX - c.x) / Math.max(1, c.width - 6);
    d.style.left = `${e.clientX - 3}px`;
    clearTimeout(drag.t); drag.t = setTimeout(() => api.cmd('split:ratio', Math.max(0.2, Math.min(0.8, r))), 16);
  });
  const end = () => { if (drag) { drag = null; d.classList.remove('drag'); } };
  d.addEventListener('pointerup', end);
  d.addEventListener('pointercancel', end);
  d.addEventListener('dblclick', () => api.cmd('split:ratio', 0.5));
})();
$('#btn-bookmarks').innerHTML = icon('bookmarks');
$('#btn-bookmarks').onclick = () => api.cmd('bm:panel', rectOf($('#btn-bookmarks')));

// ---------- window controls (frameless window) ----------
const WIN_SVG = {
  min: '<svg viewBox="0 0 10 10"><path d="M0 5.5h10"/></svg>',
  max: '<svg viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9"/></svg>',
  restore: '<svg viewBox="0 0 10 10"><rect x="0.5" y="2.5" width="7" height="7"/><path d="M2.5 2.5V0.5h7v7h-2"/></svg>',
  close: '<svg viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10"/></svg>',
};
function winctlHtml() {
  const max = S && S.maximized;
  return `<button data-win="minimize" title="Minimise" aria-label="Minimise">${WIN_SVG.min}</button>` +
    `<button data-win="maximize" title="${max ? 'Restore' : 'Maximise'}" aria-label="${max ? 'Restore' : 'Maximise'}">${max ? WIN_SVG.restore : WIN_SVG.max}</button>` +
    `<button data-win="close" class="close" title="Close" aria-label="Close">${WIN_SVG.close}</button>`;
}
document.addEventListener('click', e => { const b = e.target.closest('[data-win]'); if (b) api.cmd('win:control', b.dataset.win); });
window.addEventListener('blur', () => document.body.classList.add('blur'));
window.addEventListener('focus', () => document.body.classList.remove('blur'));

// ---------- extension buttons ----------
function renderExt(st) {
  const box = $('#ext-actions');
  if (!st || !st.ready) { box.innerHTML = ''; return; }
  box.innerHTML = st.actions.map(a => `<button class="xa" data-ext="${esc(a.id)}" title="${esc(a.title)}">${a.icon ? `<img src="${esc(a.icon)}" alt="">` : icon('puzzle')}${a.text ? `<span class="xb" style="${a.color ? `background:${esc(a.color)}` : ''}">${esc(a.text)}</span>` : ''}</button>`).join('');
}
$('#ext-actions').addEventListener('click', e => { const b = e.target.closest('[data-ext]'); if (b) api.cmd('ext:click', b.dataset.ext, rectOf(b)); });
$('#ext-actions').addEventListener('contextmenu', e => { const b = e.target.closest('[data-ext]'); if (b) { e.preventDefault(); api.cmd('ext:actionMenu', b.dataset.ext, rectOf(b)); } });
api.on('extensions', renderExt);
api.cmd('ext:toolbar').then(renderExt).catch(() => {});

// ---------- theme (Chrome themes) ----------
const THEME_MAP = { '--tabs-bg': '--th-frame', '--toolbar-bg': '--th-toolbar', '--tab-active-bg': '--th-toolbar', '--tab-active-ink': '--th-tab-text',
  '--tabs-ink': '--th-tab-bg-text', '--toolbar-ink': '--th-toolbar-icon', '--omni-bg': '--th-omnibox-bg', '--omni-ink': '--th-omnibox-text', '--bm-ink': '--th-bookmark-text' };
let themeId = null;
function applyTheme(th) {
  const id = th ? th.id + JSON.stringify(th.vars) : null;
  if (id === themeId) return;
  themeId = id;
  const st = document.documentElement.style;
  for (const k of [...Object.keys(THEME_MAP), '--frame-img', '--toolbar-img']) st.removeProperty(k);
  if (!th) return;
  for (const [ours, theirs] of Object.entries(THEME_MAP)) if (th.vars[theirs]) st.setProperty(ours, th.vars[theirs]);
  if (th.images.theme_frame) st.setProperty('--frame-img', `url("${th.images.theme_frame}")`);
  if (th.images.theme_toolbar) st.setProperty('--toolbar-img', `url("${th.images.theme_toolbar}")`);
}
// ---------- context-aware theme (workspace / page colour) ----------
let ctxKey = null;
function applyCtxTheme(t) {
  const key = t ? JSON.stringify(t) : null;
  if (key === ctxKey) return;
  ctxKey = key;
  const st = document.documentElement.style;
  for (const k of ['--accent', '--accent-soft', '--tabs-bg', '--toolbar-bg', '--tab-active-bg']) st.removeProperty(k);
  if (!t) { themeId = null; applyTheme(S && S.theme); return; }
  st.setProperty('--accent', t.accent);
  st.setProperty('--accent-soft', `${t.accent}26`);
  st.setProperty('--tabs-bg', t.frame);
  st.setProperty('--toolbar-bg', t.toolbar);
  st.setProperty('--tab-active-bg', t.toolbar);
}

// ---------- contrast: toolbar icons and text always readable (WCAG AA) ----------
function rgbOf(str) {
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(str || '');
  if (!m) return null;
  if (m[4] !== undefined && Number(m[4]) < 0.5) return null; // mostly transparent
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
function lum([r, g, b]) {
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }
const DARK_INK = [15, 23, 42], LIGHT_INK = [248, 250, 252];
const css = rgb => `rgb(${rgb.map(Math.round).join(', ')})`;
/** The theme's ink if it reaches `min` against `bg`, otherwise near-black or near-white. */
function readable(bg, ink, min) {
  if (ink && contrast(bg, ink) >= min) return ink;
  return contrast(bg, DARK_INK) >= contrast(bg, LIGHT_INK) ? DARK_INK : LIGHT_INK;
}
let contrastKey = '';
function ensureContrast() {
  const st = document.documentElement.style;
  const probe = (sel, prop) => rgbOf(getComputedStyle($(sel))[prop]);
  // Start from the theme's own inks each time.
  for (const k of ['--toolbar-ink', '--tabs-ink', '--bm-ink', '--tab-active-ink', '--omni-ink', '--tb-on-bg', '--tb-on-ink']) if (st.getPropertyValue(k) && st.getPropertyValue(k).startsWith('rgb(') && contrastKey) st.removeProperty(k);
  if (S && S.theme && S.theme.vars && !S.ctxTheme) applyThemeInks(S.theme);
  const tb = probe('#toolbar', 'backgroundColor') || [255, 255, 255];
  const tabs = probe('#tabs', 'backgroundColor') || tb;
  const omni = probe('#omnibox', 'backgroundColor') || tb;
  const inkOf = sel => rgbOf(getComputedStyle($(sel)).color);
  // Icons are graphics (3:1 needed) but we hold them to the text level, 4.5:1, so they stand out.
  const tbInk = readable(tb, inkOf('#btn-menu'), 4.5);
  const tabInk = readable(tabs, rgbOf(getComputedStyle(el.tabs).color), 4.5);
  st.setProperty('--toolbar-ink', css(tbInk));
  st.setProperty('--bm-ink', css(readable(tb, null, 4.5) === tbInk ? tbInk : readable(tb, null, 4.5)));
  st.setProperty('--tabs-ink', css(tabInk));
  st.setProperty('--tab-active-ink', css(readable(tb, null, 4.5)));
  st.setProperty('--omni-ink', css(readable(omni, rgbOf(getComputedStyle(el.address).color), 4.5)));
  // "On" buttons (equalizer, PiP, split …): accent fill with readable ink; if the accent is
  // too close to the bar, a darker or lighter accent is used so the button still stands out.
  const acc = rgbOf(getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().replace(/^#(..)(..)(..)$/, (m, r, g, b) => `rgb(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)})`)) || [37, 99, 235];
  let onBg = acc;
  if (contrast(onBg, tb) < 3) onBg = lum(tb) > 0.4 ? onBg.map(v => v * 0.55) : onBg.map(v => v + (255 - v) * 0.5);
  st.setProperty('--tb-on-bg', css(onBg));
  st.setProperty('--tb-on-ink', css(readable(onBg, LIGHT_INK, 4.5)));
  contrastKey = 'set';
}
// The current tab must stand out from the tab bar on every theme. On dark bars its background
// is lifted until it differs clearly from the bar (vertical tabs); on every bar it gets a mark in
// the workspace or accent colour that reaches 3:1 against it. Runs after the strip is drawn.
function ensureTabContrast() {
  const st = document.documentElement.style;
  st.removeProperty('--tab-cur-bg'); st.removeProperty('--tab-mark');
  const tb = rgbOf(getComputedStyle($('#toolbar')).backgroundColor) || [255, 255, 255];
  const tabs = rgbOf(getComputedStyle(el.tabs).backgroundColor) || tb;
  const hex = v => rgbOf(String(v || '').trim().replace(/^#(..)(..)(..)$/, (m, r, g, b) => `rgb(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)})`));
  const acc = hex(getComputedStyle(document.documentElement).getPropertyValue('--accent')) || [37, 99, 235];
  const probeEl = $('#tab-probe') || Object.assign(document.body.appendChild(document.createElement('div')), { id: 'tab-probe' });
  probeEl.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;background:var(--tab-active-bg)';
  const activeBg = rgbOf(getComputedStyle(probeEl).backgroundColor) || tb;
  let cur = activeBg;
  if (lum(tabs) < 0.4) for (let k = 0.06; contrast(cur, tabs) < 1.45 && k <= 0.42; k += 0.06) cur = activeBg.map(v => v + (255 - v) * k);
  st.setProperty('--tab-cur-bg', css(cur));
  const wsCol = hex(getComputedStyle(el.tabs).getPropertyValue('--ws')) || acc;
  // The workspace colour if it shows on the tab; else the accent (a black or grey workspace
  // would give a dull mark); then lightened or darkened as far as needed.
  const sat = c => (Math.max(...c) - Math.min(...c)) / 255;
  const base = contrast(wsCol, cur) >= 3 && sat(wsCol) > 0.25 ? wsCol : sat(wsCol) > 0.25 && contrast(acc, cur) < 3 ? wsCol : acc;
  let mark = base;
  for (let k = 0.15; contrast(mark, cur) < 3 && k <= 0.9; k += 0.15) mark = lum(cur) > 0.4 ? base.map(v => v * (1 - k)) : base.map(v => v + (255 - v) * k);
  st.setProperty('--tab-mark', css(mark));
}
function applyThemeInks(th) {
  const st = document.documentElement.style;
  for (const [ours, theirs] of Object.entries(THEME_MAP)) if (/ink/.test(ours) && th.vars[theirs]) st.setProperty(ours, th.vars[theirs]);
}
window.__fernaContrast = () => {
  const tb = rgbOf(getComputedStyle($('#toolbar')).backgroundColor);
  const at = document.querySelector('#tabs .tab.active');
  const curTab = at ? { bg: contrast(rgbOf(getComputedStyle(at).backgroundColor) || tb, rgbOf(getComputedStyle(el.tabs).backgroundColor) || tb), mark: contrast(rgbOf(getComputedStyle(at, '::after').backgroundColor) || tb, rgbOf(getComputedStyle(at).backgroundColor) || tb) } : null;
  return { curTab, toolbar: contrast(tb, rgbOf(getComputedStyle($('#btn-menu')).color)), eqOn: contrast(rgbOf(getComputedStyle(document.documentElement).getPropertyValue('--tb-on-bg')), rgbOf(getComputedStyle(document.documentElement).getPropertyValue('--tb-on-ink'))), tabs: contrast(rgbOf(getComputedStyle(el.tabs).backgroundColor) || tb, rgbOf(getComputedStyle(el.tabs).color)) };
};
$('#btn-downloads').innerHTML = icon('download') + '<span class="count" id="dl-count"></span>';
$('#btn-overview').innerHTML = icon('grid');
$('#btn-menu').innerHTML = icon('menu');
$('#find-prev').innerHTML = icon('up');
$('#find-next').innerHTML = icon('down');
$('#find-close').innerHTML = icon('close');

$('#btn-back').onclick = () => api.cmd('nav:back');
$('#btn-forward').onclick = () => api.cmd('nav:forward');
$('#btn-reload').onclick = () => api.cmd(S && S.nav.loading ? 'nav:stop' : 'nav:reload');
$('#btn-star').onclick = () => api.cmd('run', 'bookmark');
$('#btn-shield').onclick = () => api.cmd('menu:shield');
$('#btn-shot').onclick = () => api.cmd('menu:shot');
$('#btn-downloads').onclick = () => api.cmd('run', 'downloads');
$('#btn-overview').onclick = () => api.cmd('run', 'tabOverview');
$('#btn-menu').onclick = () => api.cmd('menu:app');

// ---------- address bar ----------
let editing = false;
el.address.addEventListener('focus', () => { editing = true; requestAnimationFrame(() => el.address.select()); });
el.address.addEventListener('blur', () => { editing = false; if (S) el.address.value = S.nav.url; });
el.address.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const v = el.address.value.trim();
    if (v) api.cmd('nav:go', v);
    el.address.blur();
  } else if (e.key === 'Escape') {
    el.address.value = S ? S.nav.url : '';
    el.address.blur();
  }
});
api.on('focus-address', () => { el.address.focus(); el.address.select(); });

// Copy and clear buttons inside the address bar.
$('#btn-copyurl').innerHTML = icon('copy');
$('#btn-clearurl').innerHTML = icon('close');
for (const b of ['#btn-copyurl', '#btn-clearurl']) $(b).addEventListener('mousedown', e => e.preventDefault()); // keep the caret where it is
$('#btn-copyurl').onclick = () => api.cmd('nav:copy');
$('#btn-clearurl').onclick = () => {
  el.address.value = '';
  editing = true;
  el.address.focus();
  syncOmniActs();
};
function syncOmniActs() {
  $('#btn-copyurl').hidden = !(S && S.nav && S.nav.url);
  $('#btn-clearurl').hidden = !el.address.value;
}
el.address.addEventListener('input', syncOmniActs);

// ---------- find bar ----------
const findInput = $('#find-input');
let findText = '';
api.on('find-open', () => { findInput.focus(); findInput.select(); });
api.on('find-close', () => { $('#find-count').textContent = ''; el.find.classList.remove('nomatch'); });
api.on('find-result', r => {
  $('#find-count').textContent = r.total ? `${r.active} of ${r.total}` : (findText ? 'No results' : '');
  el.find.classList.toggle('nomatch', !!findText && !r.total);
});
findInput.addEventListener('input', () => { findText = findInput.value; api.cmd('find:query', findText, true, false); });
findInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); if (findText) api.cmd('find:query', findText, !e.shiftKey, true); }
  if (e.key === 'Escape') api.cmd('find:close');
});
$('#find-next').onclick = () => findText && api.cmd('find:query', findText, true, true);
$('#find-prev').onclick = () => findText && api.cmd('find:query', findText, false, true);
$('#find-close').onclick = () => api.cmd('find:close');

// ---------- toast ----------
let toastTimer = null;
api.on('toast', ({ text }) => {
  const L = S && S.layout;
  const bar = L && (L.toolbar || L.tabs);
  el.toast.style.top = `${bar ? bar.y + Math.max(2, (Math.min(bar.height, 44) - 32) / 2) : 6}px`;
  el.toast.textContent = text;
  el.toast.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('on'), 3500);
});

// ---------- reveal hidden bars ----------
let revealTimer = null;
let hideTimer = null;
function armReveal(what) {
  clearTimeout(revealTimer);
  revealTimer = setTimeout(() => api.cmd('ui:reveal', what, true), 220);
}
el.edgeTabs.addEventListener('mouseenter', () => armReveal('tabs'));
el.edgeToolbar.addEventListener('mouseenter', () => armReveal('toolbar'));
el.edgeTabs.addEventListener('mouseleave', () => clearTimeout(revealTimer));
el.edgeToolbar.addEventListener('mouseleave', () => clearTimeout(revealTimer));
function isRevealed() {
  return S && ((S.settings.tabBarHidden && S.layout.showTabs) || (S.focus && (S.layout.showToolbar || S.layout.showTabs)));
}
document.documentElement.addEventListener('mouseleave', () => {
  if (!isRevealed() || document.activeElement === el.address || document.activeElement === findInput) return;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    api.cmd('ui:reveal', 'tabs', false);
    api.cmd('ui:reveal', 'toolbar', false);
  }, 450);
});
document.documentElement.addEventListener('mouseenter', () => clearTimeout(hideTimer));
el.address.addEventListener('blur', () => { if (S && S.focus && isRevealed()) setTimeout(() => api.cmd('ui:reveal', 'toolbar', false), 300); });

// ---------- layout ----------
function place(node, r) {
  node.classList.toggle('on', !!r);
  if (!r) return;
  Object.assign(node.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
}

function applyLayout(L) {
  place(el.tabs, L.tabs);
  place(el.toolbar, L.toolbar);
  place(el.bookmarks, L.bookmarks);
  place(el.find, L.find);
  place(el.edgeTabs, L.edgeTabs);
  place(el.edgeToolbar, L.edgeToolbar);
}

// ---------- rendering ----------
function render(state) {
  if (!state) return;
  S = state;
  document.body.classList.toggle('private', S.private);
  document.documentElement.style.setProperty('--accent', S.private ? '#7c3aed' : S.settings.accent || '#2563eb');
  applyLayout(S.layout);
  applyTheme(S.ctxTheme ? null : S.theme);
  applyCtxTheme(S.ctxTheme);
  document.body.classList.toggle('hc', !!S.highContrast);
  document.body.classList.toggle('exam', !!S.exam);
  ensureContrast();
  renderToolbar();
  renderBookmarks();
  renderTabs();
}

function renderToolbar() {
  const n = S.nav;
  document.body.classList.toggle('app', !!S.app);
  if (S.app) {
    const at = $('#app-title');
    if (at.parentElement !== el.toolbar) el.toolbar.insertBefore(at, $('#omnibox'));
    at.hidden = false;
    const t = S.tabs.find(x => x.id === S.activeId);
    at.textContent = (t && t.title) || S.app.name;
    at.title = n.url;
  }
  $('#btn-back').disabled = !n.canBack;
  $('#btn-forward').disabled = !n.canForward;
  const reload = $('#btn-reload');
  reload.innerHTML = icon(n.loading ? 'stop' : 'reload');
  reload.title = n.loading ? 'Stop (Esc)' : 'Reload (F5)';
  if (!editing) el.address.value = n.url;
  syncOmniActs();
  const oi = $('#omni-icon');
  oi.className = 'omni-icon';
  if (!n.url) oi.innerHTML = icon('search');
  else if (n.internal) { oi.innerHTML = '<span class="letter" style="background:var(--accent)">F</span>'; }
  else if (n.secure) { oi.innerHTML = icon('lock'); oi.classList.add('secure'); oi.title = 'Connection is secure (HTTPS)'; }
  else if (/^http:/.test(n.url)) { oi.innerHTML = icon('warn'); oi.classList.add('insecure'); oi.title = 'Not secure: this site does not use HTTPS'; }
  else oi.innerHTML = icon('info');
  const star = $('#btn-star');
  star.hidden = !n.url || (n.internal && !n.pdf);
  star.classList.toggle('on', n.bookmarked);
  star.title = n.bookmarked ? 'Remove bookmark (Ctrl+D)' : 'Bookmark this page (Ctrl+D)';
  const zb = $('#btn-zoom');
  const z = n.zoom || { level: 100, type: 'full', isDefault: true };
  zb.hidden = n.internal || !n.url;
  zb.classList.toggle('text', z.type === 'text');
  $('#zoom-level').textContent = z.isDefault && z.level === 100 ? '' : `${z.level}%`;
  zb.title = `Zoom: ${z.type === 'text' ? 'text only' : 'full page'} ${z.level}%${z.minFont ? `, minimum font ${z.minFont}px` : ''} (Alt+Z)`;
  const onToolbar = S.layout.windowControls === 'toolbar';
  el.toolbar.classList.toggle('drag', onToolbar);
  const wt = $('#winctl-tb');
  wt.hidden = !onToolbar;
  if (onToolbar) wt.innerHTML = winctlHtml();
  const oc = $('#omni-container');
  oc.hidden = !n.container;
  if (n.container) { oc.textContent = n.container.name; oc.style.setProperty('--c', n.container.color || 'var(--accent)'); oc.title = `Separate logins: this tab uses the cookies of the “${n.container.name}” workspace`; }
  $('#btn-media').hidden = !S.media;
  $('#btn-split').classList.toggle('on', !!n.split);
  $('#btn-split').title = n.split ? 'Leave split view (Alt+Shift+D). Right-click for more.' : 'Split view: this tab and the next side by side (Alt+Shift+D). Right-click to choose.';
  $('#btn-assistant').classList.toggle('on', S.side === 'assistant');
  const web = !!n.url && !n.internal && /^https?:/.test(n.url);
  $('#btn-reader').hidden = !web; $('#btn-reader').classList.toggle('on', !!n.reader);
  $('#btn-translate').hidden = !web;
  $('#btn-key').hidden = !web || !n.passwords;
  $('#btn-key').title = `${n.passwords} saved password${n.passwords === 1 ? '' : 's'} for this site`;
  const dv = $('#split-divider');
  dv.hidden = !S.split;
  if (S.split && !dv.classList.contains('drag')) { const r = S.split.divider; Object.assign(dv.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` }); }
  $('#btn-pip').hidden = n.internal || !n.hasVideo;
  $('#btn-pip').classList.toggle('on', !!n.pipOn);
  const eqb = $('#btn-eq');
  eqb.hidden = n.internal || !(n.hasMedia || (n.eq && n.eq.enabled));
  eqb.classList.toggle('on', !!(n.eq && n.eq.enabled));
  eqb.title = n.eq && n.eq.enabled ? `Equalizer: ${n.eq.label} (Alt+Q)` : 'Equalizer: off (Alt+Q)';
  const shield = $('#btn-shield');
  shield.classList.toggle('off-shield', !n.blockerOn);
  const cnt = $('#blocked-count');
  cnt.textContent = n.blocked > 99 ? '99+' : String(n.blocked);
  cnt.classList.toggle('on', n.blockerOn && n.blocked > 0);
  shield.title = n.blockerOn ? `Tracker and ad blocking: ${n.blocked} blocked on this page` : 'Tracker and ad blocking is off for this site';
  const dl = $('#btn-downloads');
  dl.hidden = !S.downloads.total;
  const dc = $('#dl-count');
  dc.textContent = String(S.downloads.active);
  dc.classList.toggle('on', S.downloads.active > 0);
}

function renderBookmarks() {
  const bar = el.bookmarks;
  const items = S.bookmarksBar;
  let html = items.length
    ? items.map(b => b.isFolder
      ? `<button class="bm bm-folder" data-bm-folder="${esc(b.id)}" title="${esc(b.title)}">${icon('folder')}<span class="t">${esc(b.title)}</span></button>`
      : `<button class="bm" data-bm="${esc(b.id)}" title="${esc(b.title)}\n${esc(b.url)}">${faviconHtml(b.url, keptIcon(b.url))}<span class="t">${esc(b.title || b.url)}</span></button>`).join('')
    : '<span class="bm-empty">Bookmark pages with Ctrl+D to see them here.</span>';
  if (S.hasOtherBookmarks) html += `<button class="bm bm-other" data-other="1">${icon('folder')}<span class="t">Other bookmarks</span></button>`;
  bar.innerHTML = html;
}
el.bookmarks.addEventListener('click', e => {
  const b = e.target.closest('[data-bm]');
  if (b) api.cmd('bm:open', b.dataset.bm, e.ctrlKey);
  const fo = e.target.closest('[data-bm-folder]');
  if (fo) api.cmd('bm:folder', fo.dataset.bmFolder, rectOf(fo));
  const ot = e.target.closest('[data-other]');
  if (ot) api.cmd('bm:other', rectOf(ot));
});
el.bookmarks.addEventListener('auxclick', e => { const b = e.target.closest('[data-bm]'); if (b && e.button === 1) api.cmd('bm:open', b.dataset.bm, true); });
el.bookmarks.addEventListener('contextmenu', e => { const b = e.target.closest('[data-bm],[data-bm-folder]'); if (b) { e.preventDefault(); api.cmd('bm:menu', b.dataset.bm || b.dataset.bmFolder); } });

const tabById = id => S.tabs.find(t => t.id === id);

function tabHtml(t, extra = '', { closable = true, label = '', acts = '' } = {}) {
  const lead = t.loading ? '<span class="spinner"></span>' : faviconHtml(t.url, t.favicon);
  const snd = t.muted ? `<span class="snd">${icon('muted')}</span>` : t.audible ? `<span class="snd">${icon('audio')}</span>` : '';
  const active = t.id === S.activeId ? ' active' : '';
  const title = t.title || (t.url ? t.url.replace(/^https?:\/\//, '') : 'New tab');
  const tip = `${title}${t.url && !/^ferna:/.test(t.url) ? `\n${t.url}` : ''}${t.sleeping ? '\n(sleeping: loads when opened)' : ''}`;
  return `<div class="tab${active}${t.sleeping ? ' sleeping' : ''} ${extra}" role="tab" aria-selected="${!!active}" tabindex="-1" draggable="true" data-id="${t.id}" title="${esc(tip)}">
    ${acts ? `<span class="lacts">${acts}</span>` : ''}${lead}<span class="title">${esc(label || title)}</span>${snd}${closable ? `<span class="x" data-close="${t.id}" title="Close tab (Ctrl+W)">${icon('close')}</span>` : ''}</div>`;
}

const keyOf = cmd => (S.shortcutKeys && S.shortcutKeys[cmd]) ? ` (${S.shortcutKeys[cmd]})` : '';
const canKeep = t => /^(https?|file):/i.test(t.url || '') || /^ferna:\/\/pdf\/viewer\/viewer\.html\?(?:[^#]*&)?file=(https?|file)/i.test(t.url || '');
/** Hover buttons on an ordinary tab: add to the common bar, pin where you are. */
function listActs(t) {
  if (!canKeep(t)) return '';
  const where = S.currentWs ? `“${(S.workspaces.find(w => w.id === S.currentWs) || {}).name || ''}”` : 'All tabs';
  return `<span class="acts"><span class="act" data-common-tab="${t.id}" title="Add to common bar${keyOf('addToCommon')}">${icon('star')}</span><span class="act" data-pin-tab="${t.id}" title="Pin in ${esc(where)}${keyOf('pinTab')}">${icon('pin')}</span></span>`;
}
/** Hover button on a pinned row: unpin. */
function pinnedActs(p) {
  const where = p.wsId ? `“${(S.workspaces.find(w => w.id === p.wsId) || {}).name || ''}”` : 'All tabs';
  return `<span class="acts"><span class="act on" data-unpin="${p.index}" data-unpin-ws="${esc(p.wsId || '')}" title="Unpin from ${esc(where)}">${icon('pin')}</span></span>`;
}

function wsChips(compact) {
  const cur = S.currentWs;
  const names = !!S.settings.wsShowNames && !(S.layout.position !== 'top' && S.settings.verticalCollapsed);
  const count = id => S.tabs.filter(t => (id === null ? true : t.ws === id || t.wsOverride === id)).length;
  const chip = (w, i) => {
    const id = w ? w.id : null;
    const name = w ? w.name : 'All tabs';
    const key = id === null ? 'Alt+0' : i < 9 ? `Alt+${i + 1}` : '';
    const n = count(id);
    return `<button class="ws-chip${names ? '' : ' ico'}${cur === id ? ' current' : ''}${id === null ? ' all' : ''}" data-ws="${id || ''}" aria-label="${esc(name)}" aria-pressed="${cur === id}"
      title="${esc(name)}${key ? ` (${key})` : ''}\n${n} tab${n === 1 ? '' : 's'}" style="--c:${w ? esc(w.color) : 'var(--ink-3)'}">
      <span class="wsi">${w ? wsIconHtml(w) : icon('grid')}</span>${names ? `<span class="name">${esc(name)}</span>${compact ? '' : `<span class="n">${n}</span>`}` : ''}</button>`;
  };
  const favOn = !!S.settings.stripFavoritesOnly;
  return chip(null, -1) + S.workspaces.map((w, i) => chip(w, i)).join('') +
    `<button class="icon-btn ws-add" data-ws-new="1" title="New workspace" aria-label="New workspace">${icon('plus')}</button>` +
    `<button class="icon-btn ws-fav${favOn ? ' on' : ''}" data-fav-only="1" aria-pressed="${favOn}" title="${favOn ? 'Show all tabs again' : 'Show only workspaces, favourites and pinned tabs'}${S.shortcutKeys && S.shortcutKeys.favoritesOnly ? ` (${esc(S.shortcutKeys.favoritesOnly)})` : ''}">${icon('filter')}</button>`;
}

/** The kept icon of a pinned or common-bar page that is not open. */
const keptIcon = url => (S.icons && S.icons[url]) || '';

function commonHtml() {
  return S.strip.common.map(c => {
    const t = c.tabId ? tabById(c.tabId) : null;
    const cls = t ? (t.id === S.activeId ? 'open current' : 'open') : 'closed';
    return `<button class="icon-btn ${cls}" data-common="${c.index}"${t ? ` draggable="true" data-drag-tab="${t.id}"` : ''} title="${esc(c.entry.title || c.entry.url)}${t ? '' : ' (not open)'}">
      ${faviconHtml(c.entry.url, (t && t.favicon) || keptIcon(c.entry.url))}${c.badge ? `<span class="badge">${esc(c.badge)}</span>` : ''}</button>`;
  }).join('');
}

// A click is lost if the strip is redrawn between mouse-down and mouse-up (a loading page
// redraws it many times a second), which made some buttons need a second click. While a
// button is held, redraws wait until it is released.
let stripPress = 0, stripPending = false, stripDragging = false;
function stripRelease() {
  if (!stripPress) return;
  stripPress = 0;
  if (stripPending) { stripPending = false; setTimeout(renderTabs, 0); }
}
el.tabs.addEventListener('pointerdown', e => { if (e.button === 0 || e.button === 1) stripPress = Date.now(); }, true);
for (const ev of ['pointerup', 'pointercancel', 'dragend', 'drop', 'blur']) window.addEventListener(ev, stripRelease, true);

function renderTabs() { drawTabs(); try { ensureTabContrast(); } catch { /* keep the strip */ } }
function drawTabs() {
  if (stripPress && Date.now() - stripPress < 2000) { stripPending = true; return; }
  if (stripDragging) { stripPending = true; return; } // redrawing would cancel the drag
  stripPress = 0;
  const L = S.layout;
  const node = el.tabs;
  if (!L.tabs) { node.innerHTML = ''; return; }
  const vertical = L.position !== 'top';
  const collapsed = vertical && S.settings.verticalCollapsed;
  node.className = `region on ${vertical ? `v ${L.position}` : 'h'}${collapsed ? ' collapsed' : ''}${isRevealed() ? ' revealed' : ''}`;
  const ws = S.workspaces.find(w => w.id === S.currentWs);
  node.style.setProperty('--ws', ws ? ws.color : 'var(--accent)');

  const favOnly = !!S.settings.stripFavoritesOnly;
  node.classList.toggle('fav-only', favOnly);
  const wsName = id => (S.workspaces.find(w => w.id === id) || {}).name || '';
  let lastWs = null;
  const pinnedRows = S.strip.pinned.map(p => {
    // "All" in favourites-only view lists every workspace's pinned sites under its name.
    const head = !ws && favOnly && p.wsId !== lastWs ? `<div class="sect-label sub">${esc(p.wsId ? wsName(p.wsId) : 'All tabs')}</div>` : '';
    lastWs = p.wsId;
    return head + pinnedRow(p);
  }).join('');
  function pinnedRow(p) {
    const t = p.tabId ? tabById(p.tabId) : null;
    if (t) return tabHtml(t, 'pinned', { label: p.pin.title || t.title, acts: pinnedActs(p) });
    return `<div class="tab pinned closed" role="button" tabindex="-1" data-pinned="${p.index}" data-pinned-ws="${esc(p.wsId)}" title="${esc(p.pin.title || p.pin.url)}\nNot open: click to open">
      <span class="lacts">${pinnedActs(p)}</span>${faviconHtml(p.pin.url, keptIcon(p.pin.url))}<span class="title">${esc(p.pin.title || p.pin.url)}</span><span class="state">Not open</span></div>`;
  }
  const listed = S.strip.tabs.map(id => tabById(id)).filter(Boolean);
  const noWs = S.strip.noWorkspace;
  const noWsHtml = S.currentWs && noWs ? `<button class="no-ws" data-ws="" title="Show all tabs (Alt+0)">${noWs} tab${noWs === 1 ? '' : 's'} in no workspace</button>` : '';

  if (!vertical) {
    const pinnedIcons = S.strip.pinned.map(p => {
      const t = p.tabId ? tabById(p.tabId) : null;
      const cls = t ? (t.id === S.activeId ? 'open current' : 'open') : 'closed';
      return `<button class="icon-btn ${cls}" ${t ? `data-id="${t.id}"` : `data-pinned="${p.index}" data-pinned-ws="${esc(p.wsId)}"`} title="${esc(p.pin.title || p.pin.url)}${t ? '' : ' (not open)'}${ws ? '' : `\nPinned in ${esc(wsName(p.wsId))}`}">${faviconHtml(p.pin.url, (t && t.favicon) || keptIcon(p.pin.url))}</button>`;
    }).join('');
    node.innerHTML = `
      <div class="group wsg">${wsChips(true)}</div>
      ${S.strip.common.length ? `<div class="group common" data-dz="common">${commonHtml()}</div>` : ''}
      ${pinnedIcons ? `<div class="group pinned" data-dz="pin">${pinnedIcons}</div>` : ''}
      ${favOnly ? `<div class="fav-space"></div>` : `<div class="tablist">${listed.map(t => tabHtml(t, '', { acts: listActs(t) })).join('')}</div>`}
      <button class="icon-btn new-tab" data-new="1" title="New tab (Ctrl+T)">${icon('plus')}</button>
      ${favOnly ? '' : noWsHtml}
      ${S.layout.windowControls === 'tabs' ? `<div class="winctl">${winctlHtml()}</div>` : ''}`;
    node.classList.toggle('has-ctl', S.layout.windowControls === 'tabs');
    const act = node.querySelector('.tablist .tab.active');
    if (act) act.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return;
  }

  node.innerHTML = `
    <div class="ws-bar">${wsChips(collapsed)}</div>
    ${S.strip.common.length ? `<div class="common" data-dz="common">${commonHtml()}</div>` : ''}
    <div class="scroll">
      <div class="section" data-dz="pin"><div class="sect-label">${ws ? `Pinned in ${esc(ws.name)}` : favOnly ? 'Pinned' : 'Pinned in All tabs'}</div>${pinnedRows || `<div class="muted pin-hint">Drag a tab here, or point at it and click ${icon('pin')}, to pin it</div>`}</div>
      ${favOnly ? '' : `<div class="section"><div class="sect-label">${ws ? 'Tabs' : 'All tabs'}</div>${listed.map(t => tabHtml(t, '', { acts: listActs(t) })).join('')}</div>`}
    </div>
    <div class="footer">
      <button class="new-tab-row" data-new="1" title="New tab (Ctrl+T)">${icon('plus')}<span>New tab</span></button>
      ${favOnly ? '' : noWsHtml}
    </div>
    ${collapsed ? '' : '<div class="resizer" title="Drag to resize"></div>'}`;
  const act = node.querySelector('.scroll .tab.active');
  if (act) act.scrollIntoView({ block: 'nearest' });
}

// ---------- strip interaction ----------
el.tabs.addEventListener('click', e => {
  const close = e.target.closest('[data-close]');
  if (close) { e.stopPropagation(); api.cmd('tab:close', Number(close.dataset.close)); return; }
  if (e.target.closest('[data-fav-only]')) { api.cmd('run', 'favoritesOnly'); return; }
  const ct = e.target.closest('[data-common-tab]');
  if (ct) { e.stopPropagation(); api.cmd('tab:common', Number(ct.dataset.commonTab)); return; }
  const pt = e.target.closest('[data-pin-tab]');
  if (pt) { e.stopPropagation(); api.cmd('tab:pin', Number(pt.dataset.pinTab)); return; }
  const up = e.target.closest('[data-unpin]');
  if (up) { e.stopPropagation(); api.cmd('pinned:unpin', up.dataset.unpinWs, Number(up.dataset.unpin)); return; }
  const tab = e.target.closest('[data-id]');
  if (tab) { api.cmd('tab:activate', Number(tab.dataset.id)); return; }
  const pin = e.target.closest('[data-pinned]');
  if (pin) { api.cmd('pinned:open', pin.dataset.pinnedWs ?? (S.currentWs || ''), Number(pin.dataset.pinned)); return; }
  const c = e.target.closest('[data-common]');
  if (c) { api.cmd('common:open', Number(c.dataset.common)); return; }
  const w = e.target.closest('[data-ws]');
  if (w) { api.cmd('ws:switch', w.dataset.ws || null); return; }
  if (e.target.closest('[data-ws-new]')) { api.cmd('ws:new'); return; }
  if (e.target.closest('[data-new]')) api.cmd('tab:new');
});
el.tabs.addEventListener('auxclick', e => {
  if (e.button !== 1) return;
  const tab = e.target.closest('[data-id]');
  if (tab) api.cmd('tab:close', Number(tab.dataset.id));
});
el.tabs.addEventListener('dblclick', e => {
  if (e.target.classList.contains('tablist') || e.target === el.tabs || e.target.classList.contains('scroll')) api.cmd('tab:new');
});
el.tabs.addEventListener('contextmenu', e => {
  e.preventDefault();
  const tab = e.target.closest('[data-id]');
  if (tab) return api.cmd('tab:menu', Number(tab.dataset.id));
  const c = e.target.closest('[data-common]');
  if (c) return api.cmd('common:menu', Number(c.dataset.common));
  const pin = e.target.closest('[data-pinned]');
  if (pin) return api.cmd('pinned:menu', pin.dataset.pinnedWs ?? (S.currentWs || ''), Number(pin.dataset.pinned));
  const w = e.target.closest('[data-ws]');
  if (w) return api.cmd('ws:menu', w.dataset.ws || null);
  return api.cmd('ws:menu', S.currentWs);
});

// Drag to reorder; drop on a workspace chip to move the tab there.
// Drop zones: drag a tab onto the common bar to add it there, or onto the pinned area to pin it
// where you are. Empty areas get a temporary target while a tab is dragged.
function addDropZones() {
  stripDragging = true;
  el.tabs.classList.add('tab-dragging');
  const vertical = S.layout.position !== 'top';
  const mk = (kind, text) => { const d = document.createElement('div'); d.className = `dz dz-${kind}`; d.dataset.dz = kind; d.dataset.temp = '1'; d.textContent = text; return d; };
  const after = el.tabs.querySelector(vertical ? '.ws-bar' : '.group.wsg');
  if (!el.tabs.querySelector('[data-dz="common"]') && after) after.after(mk('common', '☆ Drop here: common bar'));
  if (!el.tabs.querySelector('[data-dz="pin"]')) {
    const ref = el.tabs.querySelector('[data-dz="common"]') || after;
    if (ref) ref.after(mk('pin', `Drop here: pin in ${S.currentWs ? (S.workspaces.find(w => w.id === S.currentWs) || {}).name || 'workspace' : 'All tabs'}`));
  }
}
function removeDropZones() {
  el.tabs.classList.remove('tab-dragging');
  el.tabs.querySelectorAll('[data-temp]').forEach(n => n.remove());
  el.tabs.querySelectorAll('.dz-over').forEach(n => n.classList.remove('dz-over'));
  stripDragging = false;
  stripPress = 0; // a drag ends without a pointerup
  if (stripPending) { stripPending = false; setTimeout(renderTabs, 0); }
}
el.tabs.addEventListener('dragstart', e => {
  // A tab, or an open page on the common bar (drag it to the pinned area to pin it too).
  const tab = e.target.closest('.tab[data-id], [data-drag-tab]');
  if (!tab) return;
  dragId = Number(tab.dataset.id || tab.dataset.dragTab);
  tab.classList.add('dragging');
  addDropZones();
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(dragId));
});
el.tabs.addEventListener('dragend', () => { dragId = null; el.tabs.querySelectorAll('.dragging,.drop-before').forEach(n => n.classList.remove('dragging', 'drop-before')); removeDropZones(); });
el.tabs.addEventListener('dragover', e => {
  if (dragId === null) return;
  const zone = e.target.closest('[data-dz]');
  el.tabs.querySelectorAll('.dz-over').forEach(n => { if (n !== zone) n.classList.remove('dz-over'); });
  // Over a zone (but not over a tab row inside the pinned list, which reorders as before).
  if (zone && !(zone.dataset.dz === 'pin' && e.target.closest('.tab[data-id]:not(.pinned)'))) {
    e.preventDefault();
    zone.classList.add('dz-over');
    el.tabs.querySelectorAll('.drop-before').forEach(n => n.classList.remove('drop-before'));
    return;
  }
  const target = e.target.closest('.tab[data-id], [data-ws]');
  if (!target) return;
  e.preventDefault();
  el.tabs.querySelectorAll('.drop-before').forEach(n => n.classList.remove('drop-before'));
  if (target.matches('.tab')) target.classList.add('drop-before');
});
el.tabs.addEventListener('drop', e => {
  if (dragId === null) return;
  e.preventDefault();
  const zone = e.target.closest('[data-dz]');
  if (zone && !(zone.dataset.dz === 'pin' && e.target.closest('.tab[data-id]:not(.pinned)'))) {
    api.cmd('tab:to', dragId, zone.dataset.dz);
    removeDropZones();
    return;
  }
  const chip = e.target.closest('[data-ws]');
  if (chip) { api.cmd('tab:ws', dragId, chip.dataset.ws || 'none'); return; }
  const target = e.target.closest('.tab[data-id]');
  if (!target) return;
  const to = S.tabs.findIndex(t => t.id === Number(target.dataset.id));
  const from = S.tabs.findIndex(t => t.id === dragId);
  if (to < 0 || from < 0 || to === from) return;
  api.cmd('tab:move', dragId, from < to ? to - 1 : to);
});

// Resize the vertical strip.
el.tabs.addEventListener('mousedown', e => {
  const r = e.target.closest('.resizer');
  if (!r) return;
  e.preventDefault();
  r.classList.add('drag');
  const right = S.layout.position === 'right';
  let w = S.layout.tabs.width;
  const move = ev => {
    w = Math.max(160, Math.min(400, right ? S.layout.W - ev.clientX : ev.clientX));
    el.tabs.style.width = `${w}px`;
    if (right) el.tabs.style.left = `${S.layout.W - w}px`;
  };
  const up = () => {
    removeEventListener('mousemove', move);
    removeEventListener('mouseup', up);
    r.classList.remove('drag');
    api.cmd('ui:vwidth', Math.round(w));
  };
  addEventListener('mousemove', move);
  addEventListener('mouseup', up);
});

api.on('state', render);
api.cmd('ui:ready').then(render);

// ---------- Secure exam mode bar ----------
$('#exam-end').onclick = () => api.cmd('exam:end-prompt');
setInterval(() => {
  const t = $('#exam-timer');
  if (!S || !S.exam || !S.exam.endsAt) { t.hidden = true; return; }
  const left = Math.max(0, Math.round((S.exam.endsAt - Date.now()) / 1000));
  t.hidden = false;
  t.textContent = `${Math.floor(left / 3600) ? `${Math.floor(left / 3600)}:` : ''}${String(Math.floor(left / 60) % 60).padStart(2, '0')}:${String(left % 60).padStart(2, '0')} left`;
  t.classList.toggle('low', left < 300);
}, 1000);
