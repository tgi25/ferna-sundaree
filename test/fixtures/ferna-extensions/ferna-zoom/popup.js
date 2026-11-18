// Ferna Zoom — the pop-up (the same panel as in Ferna Sundaree).
const $ = s => document.querySelector(s);
let tab = null;
let d = null;

const send = (t, extra = {}) => chrome.runtime.sendMessage({ t, tabId: tab && tab.id, ...extra });
async function act(action, value) { d = await send('act', { action, value }); render(); }

function render() {
  const on = d && d.web;
  $('#main').hidden = !on; $('#off').hidden = on;
  document.querySelector('footer .keys').hidden = !on;
  if (!on) { $('#scope').textContent = 'Not available on this page'; $('#big').textContent = ''; return; }
  const st = d.state;
  $('#big').innerHTML = `${d.level}%<small>${st.type === 'text' ? 'text' : 'full'}</small>`;
  $('#scope').textContent = d.mode === 'tab' ? 'This tab only' : `Remembered for ${d.site}`;
  $('#scope').title = $('#scope').textContent;
  const levels = [...new Set([...d.levels, d.level])].sort((a, b) => a - b);
  $('#level').innerHTML = levels.map(l => `<option value="${l}"${l === d.level ? ' selected' : ''}>${l}%</option>`).join('');
  const fonts = [...new Set([...d.fonts, st.minFont || 0])].sort((a, b) => a - b);
  $('#min').innerHTML = fonts.map(f => `<option value="${f}"${f === (st.minFont || 0) ? ' selected' : ''}>${f ? `${f} px` : 'Off'}</option>`).join('');
  document.querySelectorAll('[data-type]').forEach(b => { const o = b.dataset.type === st.type; b.classList.toggle('on', o); b.setAttribute('aria-checked', String(o)); });
  const note = $('#note');
  const msg = d.note || d.error || (d.canvas ? 'This page draws its text as pictures (like Google Docs), so text zoom zooms the whole page here.' : '');
  note.hidden = !msg;
  note.textContent = msg;
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-type]');
  if (t) { act('setType', t.dataset.type); return; }
  const b = e.target.closest('[data-z]');
  if (!b) return;
  let a = b.dataset.z;
  if ((a === 'in' || a === 'out') && e.shiftKey) a += 'Small';
  if (a === 'reset' && (e.ctrlKey || e.metaKey)) a = 'setDefault';
  act(a);
});
$('#level').onchange = e => act('set', Number(e.target.value));
$('#min').onchange = e => act('minFont', Number(e.target.value));
$('#zoom').addEventListener('wheel', e => { e.preventDefault(); act((e.deltaY < 0 ? 'in' : 'out') + (e.shiftKey ? 'Small' : '')); }, { passive: false });
$('#font').addEventListener('wheel', e => {
  e.preventDefault();
  const list = d.fonts; const i = Math.max(0, list.indexOf(d.state.minFont || 0));
  act('minFont', list[Math.max(0, Math.min(list.length - 1, i + (e.deltaY < 0 ? 1 : -1)))]);
}, { passive: false });
$('#settings').onclick = e => { e.preventDefault(); chrome.runtime.openOptionsPage(); window.close(); };
document.addEventListener('keydown', e => {
  if (!d || !d.web || e.target.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  if (k === '+' || k === '=') { e.preventDefault(); act(e.shiftKey && k === '=' ? 'in' : 'in'); }
  else if (k === '-') { e.preventDefault(); act('out'); }
  else if (k === '0') { e.preventDefault(); act('reset'); }
  else if (k === 't') { e.preventDefault(); act('type'); }
  else if (k === 'a') { e.preventDefault(); act('autofit'); }
});

(async () => {
  const q = new URLSearchParams(location.search).get('tab'); // (tests open the pop-up as a page)
  tab = q ? await chrome.tabs.get(Number(q)).catch(() => null) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  d = await send('panel');
  render();
  setTimeout(() => { if (d && d.web) $('#level').focus(); }, 0);
})();
