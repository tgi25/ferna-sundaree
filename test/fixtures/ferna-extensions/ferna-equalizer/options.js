// Ferna Equalizer — settings page: your presets (rename, delete, export, import) and sites where it is off.
import { BANDS, cleanUserPresets } from './eqcore.js';
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const toast = t => { const el = $('#toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 1800); };
if (location.hash === '#welcome') $('#welcome').hidden = false;
const bars = g => `<span class="bars">${g.map(v => `<i style="height:${4 + (v + 12) * 0.8}px"></i>`).join('')}</span>`;

async function render() {
  const { userPresets, offSites } = await chrome.storage.sync.get(['userPresets', 'offSites']);
  const user = cleanUserPresets(userPresets);
  $('#ucount').textContent = user.length ? `(${user.length})` : '';
  $('#presets').innerHTML = user.length ? user.map(u => `<tr><td>${bars(u.gains)}</td><td><b>${esc(u.name)}</b></td><td><button class="btn small" data-ren="${esc(u.id)}">Rename</button> <button class="btn small danger" data-del="${esc(u.id)}">Delete</button></td></tr>`).join('') : '<tr><td class="muted">None yet. Shape the sound in the pop-up and choose “Save preset”.</td></tr>';
  const sites = Array.isArray(offSites) ? offSites : [];
  $('#sites').innerHTML = sites.length ? sites.map(h => `<tr><td><b>${esc(h)}</b></td><td><button class="btn small" data-on="${esc(h)}">Turn back on</button></td></tr>`).join('') : '<tr><td class="muted">None. Use “Off on this site” in the pop-up.</td></tr>';
}
document.addEventListener('click', async e => {
  const b = e.target.closest('button[data-ren], button[data-del], button[data-on]');
  if (!b) return;
  const st = await chrome.storage.sync.get(['userPresets', 'offSites']);
  let user = cleanUserPresets(st.userPresets);
  if (b.dataset.del) { const p = user.find(u => u.id === b.dataset.del); if (!confirm(`Delete “${p.name}”?`)) return; user = user.filter(u => u.id !== b.dataset.del); await chrome.storage.sync.set({ userPresets: user }); }
  if (b.dataset.ren) { const p = user.find(u => u.id === b.dataset.ren); const n = prompt('New name', p.name); if (!n || !n.trim()) return; p.name = n.trim().slice(0, 40); await chrome.storage.sync.set({ userPresets: user }); }
  if (b.dataset.on) await chrome.storage.sync.set({ offSites: (st.offSites || []).filter(h => h !== b.dataset.on) });
  render();
});
$('#export').onclick = async () => {
  const { userPresets } = await chrome.storage.sync.get('userPresets');
  const blob = new Blob([JSON.stringify({ format: 'ferna-equalizer-presets', version: 1, bands: BANDS, presets: cleanUserPresets(userPresets) }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'Ferna Equalizer presets.json'; a.click();
};
$('#import').onclick = () => $('#file').click();
$('#file').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d.format !== 'ferna-equalizer-presets') throw new Error('Not a Ferna Equalizer presets file');
    const { userPresets } = await chrome.storage.sync.get('userPresets');
    const mine = cleanUserPresets(userPresets);
    const names = new Set(mine.map(u => u.name));
    const add = cleanUserPresets(d.presets).filter(p => !names.has(p.name));
    await chrome.storage.sync.set({ userPresets: cleanUserPresets([...mine, ...add]) });
    toast(`${add.length} preset${add.length === 1 ? '' : 's'} imported`); render();
  } catch (err) { toast(String(err.message || err)); }
  e.target.value = '';
};
$('#keys').onclick = e => { e.preventDefault(); chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); };
chrome.storage.onChanged.addListener(render);
render();
