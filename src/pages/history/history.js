'use strict';
const { icon, esc, faviconHtml, hostOf, $ } = FK;
const api = window.ferna;
let items = [];

async function load() {
  items = await api.cmd('history:query', $('#q').value.trim(), 3000);
  render();
}

function render() {
  if (!items.length) { $('#list').innerHTML = '<div class="empty">No history yet.</div>'; return; }
  let html = '';
  let lastDay = '';
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 864e5).toDateString();
  items.forEach((h, i) => {
    const d = new Date(h.ts);
    const ds = d.toDateString();
    if (ds !== lastDay) {
      html += `<div class="day">${ds === today ? 'Today' : ds === yesterday ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>`;
      lastDay = ds;
    }
    html += `<div class="item"><time>${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</time>${faviconHtml(h.url, '')}
      <a data-url="${esc(h.url)}" title="${esc(h.url)}">${esc(h.title || h.url)}</a><span class="h">${esc(hostOf(h.url))}</span>
      <button class="btn small del" data-del="${i}" title="Remove from history">${icon('trash')}</button></div>`;
  });
  $('#list').innerHTML = html;
}

let t = null;
$('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 150); });
$('#list').addEventListener('click', async e => {
  const del = e.target.closest('[data-del]');
  if (del) { const h = items[Number(del.dataset.del)]; await api.cmd('history:remove', h.url, h.ts); load(); return; }
  const a = e.target.closest('[data-url]');
  if (a) location.href = a.dataset.url;
});
$('#clear').onclick = () => { location.href = 'ferna://settings/#privacy'; };
load();
