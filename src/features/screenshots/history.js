import { listCaptures, deleteCapture, clearAll } from './lib/db.js';
import { formatTime, MODE_NAMES, buildFilename } from './lib/util.js';
import { getSettings } from './lib/settings.js';

const $ = (id) => document.getElementById(id);
let all = [];
const urls = [];

async function load() {
  all = await listCaptures();
  draw();
}

function draw() {
  urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
  const q = $('q').value.trim().toLowerCase();
  const list = q ? all.filter((r) => (r.title + ' ' + r.url).toLowerCase().includes(q)) : all;
  $('count').textContent = `${all.length} screenshot${all.length === 1 ? '' : 's'} kept on this computer`;
  $('empty').hidden = all.length > 0;
  const g = $('grid'); g.innerHTML = '';
  for (const r of list) {
    const card = document.createElement('div'); card.className = 'card';
    const th = document.createElement('div'); th.className = 'thumb';
    const im = document.createElement('img');
    const u = URL.createObjectURL(r.thumb || r.blob); urls.push(u); im.src = u; im.alt = '';
    th.appendChild(im);
    th.onclick = () => open(r.id);
    const m = document.createElement('div'); m.className = 'meta';
    const b = document.createElement('b'); b.textContent = r.title || '(untitled page)';
    const a = document.createElement('div'); a.className = 'u'; a.textContent = r.url;
    const d = document.createElement('div'); d.className = 'muted';
    d.innerHTML = `<span class="tag">${MODE_NAMES[r.mode] || r.mode}</span>`;
    d.append(`${r.cssW}×${r.cssH} · ${formatTime(r.ts, 'local').replace(/ \(UTC.*\)$/, '')}`);
    m.append(b, a, d);
    const acts = document.createElement('div'); acts.className = 'acts';
    const bo = btn('Edit', () => open(r.id), 'primary');
    const bs = btn('Save original', async () => {
      const st = await getSettings();
      const url = URL.createObjectURL(r.blob);
      await chrome.downloads.download({ url, filename: buildFilename(st.filePattern, r, 'png', st.folder), saveAs: !!st.saveAs, conflictAction: 'uniquify' });
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    });
    const bd = btn('Delete', async () => { await deleteCapture(r.id); all = all.filter((x) => x.id !== r.id); draw(); }, 'danger');
    acts.append(bo, bs, bd);
    card.append(th, m, acts);
    g.appendChild(card);
  }
}

function btn(label, fn, cls) { const b = document.createElement('button'); b.className = 'btn ' + (cls || ''); b.textContent = label; b.onclick = fn; return b; }
function open(id) { chrome.tabs.create({ url: chrome.runtime.getURL('editor.html?id=' + id) }); }

$('q').addEventListener('input', draw);
$('clear').onclick = async () => {
  if (!all.length || !confirm('Delete all screenshots kept in Ferna Screenshots? Files you already saved are not affected.')) return;
  await clearAll(); load();
};
$('settings').onclick = () => chrome.runtime.openOptionsPage();
load();
