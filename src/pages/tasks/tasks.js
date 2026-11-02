'use strict';
// Task manager: tabs with memory and CPU, sleep / end process / close, refreshed every 2 s.
const { $, esc, faviconHtml } = FK;
const api = window.ferna;
let sort = { key: 'memory', dir: -1 };
const mb = kb => kb >= 1024 ? `${(kb / 1024).toFixed(1)} GB` : `${kb} MB`;

async function refresh() {
  const d = await api.cmd('tasks:list');
  const tabs = d.tabs.slice().sort((a, b) => {
    const x = a[sort.key], y = b[sort.key];
    return (typeof x === 'string' ? x.localeCompare(y) : (x - y)) * sort.dir;
  });
  const asleep = d.tabs.filter(t => t.state === 'sleeping').length;
  $('#sum').innerHTML = `<div><b>${mb(d.total)}</b><span class="muted">used in all</span></div><div><b>${d.tabs.length}</b><span class="muted">tabs</span></div><div><b>${asleep}</b><span class="muted">asleep</span></div>`;
  $('#tabs').innerHTML = tabs.map(t => `<tr data-w="${t.windowId}" data-t="${t.tabId}">
    <td><div class="t">${faviconHtml(t.url, t.favicon)}<span class="ti" title="${esc(t.url)}">${esc(t.title)}</span>${t.private ? '<span class="state">private</span>' : ''}${t.audible ? '<span class="state">♪ playing</span>' : ''}</div></td>
    <td><span class="state ${t.state}">${t.state === 'sleeping' ? 'Asleep' : t.state === 'active' ? 'Open' : 'Loaded'}</span>${t.keepLoaded ? ' <span class="muted" title="Never sleeps">📌</span>' : ''}</td>
    <td class="num">${t.memory ? mb(t.memory) : '—'}</td><td class="num">${t.state === 'sleeping' ? '—' : `${t.cpu}%`}</td><td class="num">${t.pid || '—'}</td>
    <td><div class="acts"><button class="btn small" data-a="go">Go to</button>${t.state === 'loaded' ? '<button class="btn small" data-a="sleep">Sleep</button>' : ''}${t.pid ? '<button class="btn small" data-a="end" title="Stop this page\'s process (the tab shows a crash page you can reload)">End process</button>' : ''}<button class="btn small danger" data-a="close">Close</button></div></td></tr>`).join('');
  $('#other').innerHTML = d.other.sort((a, b) => b.memory - a.memory).map(p => `<tr><td>${esc(p.type)}</td><td class="num">${mb(p.memory)}</td><td class="num">${p.cpu}%</td><td class="num">${p.pid}</td></tr>`).join('');
}
$('#tabs').addEventListener('click', async e => {
  const b = e.target.closest('[data-a]');
  if (!b) return;
  const tr = b.closest('tr');
  await api.cmd('tasks:act', Number(tr.dataset.w), Number(tr.dataset.t), b.dataset.a);
  setTimeout(refresh, 300);
});
document.querySelector('thead').addEventListener('click', e => {
  const k = e.target.dataset.s;
  if (!k) return;
  sort = { key: k, dir: sort.key === k ? -sort.dir : (k === 'title' || k === 'state' ? 1 : -1) };
  refresh();
});
refresh();
setInterval(refresh, 2000);
