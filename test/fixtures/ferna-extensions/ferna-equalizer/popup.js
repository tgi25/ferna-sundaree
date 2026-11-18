// Ferna Equalizer — the pop-up (the same panel as in Ferna Sundaree).
import { BANDS, PRESETS, clean, cleanUserPresets } from './eqcore.js';
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = f => (f >= 1000 ? `${f / 1000}k` : String(f));
const fmtDb = v => (v > 0 ? '+' : '') + (Math.round(v * 2) / 2);
let tab = null, host = '', cfg = null, status = null, user = [], offSites = [];

$('#eq-bands').innerHTML = BANDS.map((f, i) => `<div class="eq-band"><span class="eq-val" id="eq-v${i}">0</span><input type="range" min="-12" max="12" step="0.5" value="0" data-band="${i}" aria-label="${fmt(f)} Hz"><span class="eq-f">${fmt(f)}</span></div>`).join('');
function drawPresets() {
  $('#eq-presets').innerHTML = Object.keys(PRESETS).map(k => `<button data-preset="${k}" role="radio">${esc(PRESETS[k].label)}</button>`).join('') +
    user.map(u => `<button data-user="${esc(u.id)}" role="radio" class="user" title="Your preset. Right-click to delete.">★ ${esc(u.name)}</button>`).join('') +
    '<button data-preset="custom" role="radio">Custom</button>';
}
async function send(patch) {
  const r = await chrome.runtime.sendMessage({ t: 'set', patch, tabId: tab && tab.id });
  cfg = r.cfg; status = r.status; render();
}
function render(fromPoll = false) {
  const c = cfg, s = status;
  $('#eq-on').checked = c.enabled; $('#eq-auto').checked = c.auto;
  $('#eqp').classList.toggle('off', !c.enabled);
  const shown = c.auto ? (s && s.applied) || 'flat' : c.preset;
  const userOn = !c.auto && c.preset === 'custom' && c.customName ? (user.find(u => u.name === c.customName) || {}).id : null;
  document.querySelectorAll('#eq-presets [data-preset], #eq-presets [data-user]').forEach(b => {
    const on = b.dataset.user ? b.dataset.user === userOn : (!userOn && b.dataset.preset === shown);
    b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on));
  });
  const gains = c.auto ? (s && s.gains) || PRESETS.flat.gains : c.preset === 'custom' ? c.gains : (PRESETS[c.preset] || PRESETS.flat).gains;
  document.querySelectorAll('[data-band]').forEach((r, i) => {
    if (!(fromPoll && document.activeElement === r)) r.value = gains[i];
    r.disabled = !!c.auto;
    $(`#eq-v${i}`).textContent = fmtDb(Number(r.value));
  });
  const det = $('#eq-detect');
  det.hidden = !(c.enabled && c.auto);
  if (!det.hidden) det.innerHTML = s && s.genre
    ? `Detected <b>${esc(PRESETS[s.genre] ? PRESETS[s.genre].label : s.genre)}</b> · ${s.confidence}% · using <b>${esc(PRESETS[s.applied] ? PRESETS[s.applied].label : s.applied)}</b><div class="why">${esc(s.reason || '')}</div>`
    : `<span class="why">${esc((s && s.reason) || 'Play something: Auto-EQ listens for a few seconds, and reads the page title.')}</span>`;
  const off = offSites.includes(host);
  $('#site-off').checked = off; $('#site').textContent = host || 'this page';
  $('.site').hidden = !host;
  const note = $('#eq-note');
  if (!s || !s.web) note.textContent = 'Works on web pages. Browser pages and the Chrome Web Store cannot be changed by extensions.';
  else if (off) note.textContent = 'Off on this site.';
  else if (!c.enabled) note.textContent = 'Turn it on to shape the sound of every tab.';
  else if (s.waiting && !s.attached) note.textContent = 'Click on the page once: Chrome lets sound be processed after you interact with a page.';
  else if (s.skipped && !s.attached) note.textContent = 'This player streams from another site that does not allow sound processing.';
  else if (s.attached) note.textContent = `Equalizing ${s.attached} player${s.attached === 1 ? '' : 's'} on this page`;
  else note.textContent = s.media ? 'Waiting for the player to start' : 'No video or audio on this page yet';
}

$('#eq-on').onchange = e => send({ enabled: e.target.checked });
$('#eq-auto').onchange = e => send({ auto: e.target.checked, enabled: true });
$('#eq-reset').onclick = e => { e.preventDefault(); send({ preset: 'flat', auto: false, gains: BANDS.map(() => 0) }); };
$('#settings').onclick = e => { e.preventDefault(); chrome.runtime.openOptionsPage(); window.close(); };
$('#site-off').onchange = async e => {
  offSites = offSites.filter(h => h !== host);
  if (e.target.checked) offSites.push(host);
  await chrome.storage.sync.set({ offSites: offSites.slice(-500) });
  setTimeout(poll, 150);
};
const panel = $('#eqp');
panel.addEventListener('click', e => {
  const u = e.target.closest('[data-user]');
  if (u) { const p = user.find(x => x.id === u.dataset.user); if (p) send({ preset: 'custom', auto: false, enabled: true, gains: p.gains, customName: p.name }); return; }
  const b = e.target.closest('[data-preset]');
  if (!b) return;
  const k = b.dataset.preset;
  send({ preset: k, auto: false, enabled: true, ...(k !== 'custom' ? { gains: PRESETS[k].gains } : {}) });
});
$('#eq-presets').addEventListener('contextmenu', async e => {
  const b = e.target.closest('[data-user]');
  if (!b) return;
  e.preventDefault();
  if (!confirm(`Delete your preset “${b.textContent.replace(/^★ /, '')}”?`)) return;
  user = user.filter(u => u.id !== b.dataset.user);
  await chrome.storage.sync.set({ userPresets: user });
  drawPresets(); render();
});
$('#eq-save').onclick = async () => {
  const name = $('#eq-name').value.trim();
  if (!name) { $('#eq-name').focus(); return; }
  const gains = [...document.querySelectorAll('[data-band]')].map(r => Number(r.value));
  user = cleanUserPresets([...user.filter(u => u.name !== name), { name, gains }]);
  await chrome.storage.sync.set({ userPresets: user });
  $('#eq-name').value = '';
  drawPresets();
  send({ preset: 'custom', auto: false, enabled: true, gains, customName: name });
};
$('#eq-name').addEventListener('keydown', e => { if (e.key === 'Enter') $('#eq-save').click(); });
let pending = null;
panel.addEventListener('input', e => {
  const i = e.target.dataset && e.target.dataset.band;
  if (i === undefined) return;
  const gains = [...panel.querySelectorAll('[data-band]')].map(r => Number(r.value));
  $(`#eq-v${i}`).textContent = fmtDb(Number(e.target.value));
  clearTimeout(pending);
  pending = setTimeout(() => send({ preset: 'custom', auto: false, enabled: true, gains }), 60);
});

async function poll() {
  const { eq } = await chrome.storage.sync.get('eq');
  cfg = clean(eq);
  status = tab ? await chrome.runtime.sendMessage({ t: 'status', tabId: tab.id }) : null;
  render(true);
}
(async () => {
  const q = new URLSearchParams(location.search).get('tab'); // (tests open the pop-up as a page)
  tab = q ? await chrome.tabs.get(Number(q)).catch(() => null) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  try { const u = new URL(tab.url); host = /^https?:$/.test(u.protocol) ? u.hostname : ''; } catch { host = ''; }
  const st = await chrome.storage.sync.get(['eq', 'userPresets', 'offSites']);
  cfg = clean(st.eq); user = cleanUserPresets(st.userPresets); offSites = Array.isArray(st.offSites) ? st.offSites : [];
  drawPresets();
  render();
  await poll();
  setInterval(poll, 1000);
})();
