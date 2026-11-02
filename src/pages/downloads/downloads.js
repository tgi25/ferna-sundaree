'use strict';
const AV = /Linux/.test(navigator.userAgent) && !/Windows/.test(navigator.userAgent) ? 'ClamAV' : 'Microsoft Defender';
const { icon, esc, hostOf, fmtBytes, $ } = FK;
const api = window.ferna;

function render(list) {
  if (!list.length) { $('#list').innerHTML = '<div class="empty">No downloads in this session.</div>'; return; }
  $('#list').innerHTML = list.map(d => {
    const pct = d.total ? Math.round(100 * d.received / d.total) : 0;
    const status = d.state === 'progressing'
      ? `${d.paused ? 'Paused · ' : ''}${fmtBytes(d.received)}${d.total ? ` of ${fmtBytes(d.total)}` : ''}`
      : d.state === 'completed' ? `${fmtBytes(d.received)} · ${esc(hostOf(d.url))}` : d.state === 'cancelled' ? 'Cancelled' : 'Failed';
    const acts = d.state === 'progressing'
      ? `${d.paused ? '<button class="btn small" data-a="resume">Resume</button>' : '<button class="btn small" data-a="pause">Pause</button>'}<button class="btn small" data-a="cancel">Cancel</button>`
      : `${d.state === 'completed' ? '<button class="btn small primary" data-a="open">Open</button><button class="btn small" data-a="show">Show in folder</button>' : ''}<button class="btn small" data-a="remove" title="Remove from list">${icon('close')}</button>`;
    return `<div class="dl" data-id="${d.id}"><div class="ic">${icon('file')}</div><div class="grow">
      <div class="name${d.state === 'cancelled' ? ' gone' : ''}" title="${esc(d.path)}">${esc(d.filename)}</div>
      <div class="sub">${d.risky ? '<span class="risky">Can run programs · </span>' : ''}${status}${d.scan === 'scanning' ? ` · <span>Scanning with ${AV}…</span>` : d.scan === 'clean' ? ` · <span class="ok-t">${AV}: no threats</span>` : d.scan === 'threat' ? ` · <span class="risky">${AV} found a threat and removed the file</span>` : ''}</div>
      ${d.state === 'progressing' ? `<div class="prog"><i style="width:${pct}%"></i></div>` : ''}</div><div class="acts">${acts}</div></div>`;
  }).join('');
}

$('#list').addEventListener('click', e => {
  const b = e.target.closest('[data-a]');
  if (b) api.cmd('downloads:act', Number(b.closest('[data-id]').dataset.id), b.dataset.a);
});
$('#folder').onclick = () => api.cmd('downloads:folder');
api.on('downloads', render);
api.cmd('downloads:list').then(render);
