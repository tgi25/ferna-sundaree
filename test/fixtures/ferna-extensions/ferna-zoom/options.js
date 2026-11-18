// Ferna Zoom — settings page.
import * as Z from './zoomcore.js';
const $ = s => document.querySelector(s);
const toast = t => { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 1800); };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
if (location.hash === '#welcome') $('#welcome').hidden = false;
$('#minFont').innerHTML = Z.FONTS.map(f => `<option value="${f}">${f ? `${f} px` : 'Off'}</option>`).join('');

let P = null;
async function load() {
  const { prefs } = await chrome.storage.sync.get('prefs');
  P = Z.cleanPrefs(prefs);
  for (const r of document.querySelectorAll('input[type=radio]')) r.checked = P[r.name] === r.value;
  for (const k of ['defaultFull', 'defaultText', 'defaultNonText', 'step', 'smallStep', 'autofitMin', 'autofitMax', 'lineSpacing']) $(`#${k}`).value = P[k];
  for (const k of ['subdomainsSeparate', 'autofitOnLoad', 'badge', 'wheel', 'canvasFallback']) $(`#${k}`).checked = !!P[k];
  $('#defaultType').value = P.defaultType; $('#minFont').value = String(P.minFont);
  $('#levels').value = P.levels.join(', ');
  renderSites();
}
async function save() {
  const p = { ...P };
  for (const r of document.querySelectorAll('input[type=radio]:checked')) p[r.name] = r.value;
  for (const k of ['defaultFull', 'defaultText', 'defaultNonText', 'step', 'smallStep', 'autofitMin', 'autofitMax', 'lineSpacing']) p[k] = Number($(`#${k}`).value);
  for (const k of ['subdomainsSeparate', 'autofitOnLoad', 'badge', 'wheel', 'canvasFallback']) p[k] = $(`#${k}`).checked;
  p.defaultType = $('#defaultType').value; p.minFont = Number($('#minFont').value);
  p.levels = $('#levels').value.split(/[,\s]+/).map(Number).filter(n => n >= 25 && n <= 500);
  P = Z.cleanPrefs(p);
  await chrome.storage.sync.set({ prefs: P });
  toast('Saved');
}
document.addEventListener('change', e => { if (e.target.closest('section') && !e.target.closest('#sites')) save(); });

async function renderSites() {
  const { sites } = await chrome.storage.local.get('sites');
  const list = Object.entries(sites || {}).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
  $('#count').textContent = list.length ? `(${list.length})` : '';
  $('#sites').innerHTML = list.length ? list.map(([k, s]) => `<tr><td><b>${esc(k)}</b></td><td>${s.type === 'text' ? `Text ${s.text}%` : `Full ${s.full}%`}${s.minFont ? `, minimum font ${s.minFont}px` : ''}</td><td><button class="btn small danger" data-forget="${esc(k)}">Forget</button></td></tr>`).join('') : '<tr><td class="muted">None yet. Zoom a site and it appears here.</td></tr>';
}
document.addEventListener('click', async e => {
  const f = e.target.closest('[data-forget]');
  if (f) { const { sites } = await chrome.storage.local.get('sites'); delete sites[f.dataset.forget]; await chrome.storage.local.set({ sites }); chrome.runtime.sendMessage({ t: 'reapply' }); renderSites(); toast('Forgotten'); }
});
$('#clearAll').onclick = async () => { if (!confirm('Forget the zoom of every site?')) return; await chrome.storage.local.set({ sites: {} }); chrome.runtime.sendMessage({ t: 'reapply' }); renderSites(); };
$('#keys').onclick = e => { e.preventDefault(); chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); };
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.sites) renderSites(); });
load();
