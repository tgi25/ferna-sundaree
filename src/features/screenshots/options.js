import { getSettings, setSettings } from './lib/settings.js';
import { renderFull } from './lib/compose.js';
import { buildFilename } from './lib/util.js';

const $ = (id) => document.getElementById(id);
let st = await getSettings();

const get = (k) => k.split('.').reduce((o, p) => o[p], st);
function patchFor(k, v) { const [a, b] = k.split('.'); return b ? { [a]: { [b]: v } } : { [a]: v }; }

for (const el of document.querySelectorAll('[data-k]')) {
  const k = el.dataset.k, v = get(k);
  if (el.type === 'checkbox') el.checked = !!v; else el.value = String(v);
  el.addEventListener(el.type === 'text' || el.type === 'range' ? 'input' : 'change', async () => {
    let val = el.type === 'checkbox' ? el.checked : el.value;
    if ('num' in el.dataset) val = Number(val);
    // update the preview at once, write to sync storage after a short pause (it has a write quota)
    const [a, b] = k.split('.'); if (b) st[a][b] = val; else st[a] = val;
    preview();
    clearTimeout(el._t);
    el._t = setTimeout(async () => { st = await setSettings(patchFor(k, val)); saved(); }, el.type === 'text' || el.type === 'range' ? 450 : 0);
  });
}
$('placement').value = st.stamp.placement === 'corner' ? `corner:${st.stamp.corner}` : st.stamp.placement;
$('placement').addEventListener('change', async () => {
  const [placement, corner] = $('placement').value.split(':');
  st = await setSettings({ stamp: corner ? { placement, corner } : { placement } });
  saved(); preview();
});
$('shortcuts').onclick = () => chrome.tabs.create({ url: 'ferna://settings/#shortcuts' });
const cmds = await chrome.commands.getAll();
$('keys').textContent = cmds.filter((c) => c.shortcut && c.name !== '_execute_action').map((c) => `${c.description}: ${c.shortcut}`).join(' · ') || 'No shortcuts set.';

let t = 0;
function saved() { $('saved').classList.add('show'); clearTimeout(t); t = setTimeout(() => $('saved').classList.remove('show'), 1200); }

// a made-up web page to preview the stamp on
const page = new OffscreenCanvas(840, 520);
{
  const c = page.getContext('2d');
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, 840, 520);
  c.fillStyle = '#1e3a8a'; c.fillRect(0, 0, 840, 56);
  c.fillStyle = '#fff'; c.font = '600 20px system-ui'; c.fillText('University News', 24, 36);
  c.fillStyle = '#93c5fd'; for (let i = 0; i < 4; i++) c.fillRect(470 + i * 88, 24, 64, 10);
  c.fillStyle = '#0f172a'; c.font = '700 26px system-ui'; c.fillText('Research week opens with record turnout', 24, 104);
  c.fillStyle = '#cbd5e1'; for (let i = 0; i < 9; i++) c.fillRect(24, 130 + i * 22, i % 3 === 2 ? 340 : 500, 9);
  const g = c.createLinearGradient(560, 120, 816, 320); g.addColorStop(0, '#f59e0b'); g.addColorStop(1, '#db2777');
  c.fillStyle = g; c.fillRect(560, 120, 256, 180);
  c.fillStyle = '#e2e8f0'; for (let i = 0; i < 6; i++) c.fillRect(24, 350 + i * 22, i % 2 ? 420 : 780, 9);
  c.fillStyle = '#f1f5f9'; c.fillRect(0, 488, 840, 32);
}
const meta = { ts: Date.now(), url: 'https://news.example.edu/research-week/2026/opening-ceremony?ref=home', title: 'Research week opens with record turnout — University News', mode: 'full', cssW: 1366, cssH: 5240, scale: 1 };

function preview() {
  const { canvas } = renderFull(page, { objects: [], crop: null, stamp: st.stamp }, meta, null);
  const pv = $('preview');
  pv.width = canvas.width; pv.height = canvas.height;
  pv.getContext('2d').drawImage(canvas, 0, 0);
  $('fnPreview').textContent = 'e.g. ' + buildFilename(st.filePattern, meta, 'png', st.folder);
}
preview();
