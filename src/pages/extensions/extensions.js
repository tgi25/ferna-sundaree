'use strict';
const { icon, esc, $ } = FK;
const api = window.ferna;
let items = [];

const SOURCE = { store: 'Chrome Web Store', file: 'From file', zip: 'From zip', unpacked: 'Unpacked' };

async function load() {
  items = await api.cmd('ext:list');
  const box = $('#list');
  if (!items.length) {
    box.innerHTML = '<div class="empty" style="grid-column:1/-1">No extensions yet. Open the Chrome Web Store and choose “Add to Chrome”, or install one from a file.</div>';
  } else {
    box.innerHTML = items.map(x => `
      <div class="ext${x.enabled ? '' : ' off'}" data-id="${esc(x.id)}">
        <div class="head">
          <div class="ic">${x.icon ? `<img src="${esc(x.icon)}" alt="">` : icon('puzzle')}</div>
          <div style="flex:1;min-width:0">
            <div class="name">${esc(x.name)}</div>
            <div class="meta">Version ${esc(x.version)} · <span class="tag">${esc(SOURCE[x.source] || x.source)}</span> · MV${esc(x.mv)}</div>
          </div>
          <label class="switch" title="${x.enabled ? 'Turn off' : 'Turn on'}"><input type="checkbox" data-a="enable" ${x.enabled ? 'checked' : ''}><span></span></label>
        </div>
        <div class="desc">${esc(x.description)}</div>
        ${x.paused ? '<div class="err">Paused: an update asks for more access. Turn it on to allow the new access.</div>' : ''}
        ${x.allSites ? '<div class="broad">Can read and change everything on every website you visit. Keep only extensions you trust.</div>' : ''}
        ${x.warnings.length ? `<details><summary>Permissions (${x.warnings.length})</summary><ul>${x.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></details>` : '<div class="meta">No special permissions</div>'}
        ${x.error ? `<div class="err">Could not load: ${esc(x.error)}</div>` : ''}
        <div class="acts">
          ${x.hasAction ? `<label style="display:flex;gap:6px;align-items:center;font-size:12px"><input type="checkbox" data-a="pin" ${x.pinned ? 'checked' : ''}>Show in toolbar</label>` : ''}
          <span class="grow"></span>
          ${x.optionsUrl && x.enabled ? '<button class="btn small" data-a="options">Options</button>' : ''}
          ${x.source === 'store' ? '<button class="btn small" data-a="page">Store page</button>' : ''}
          <button class="btn small danger" data-a="remove">Remove</button>
        </div>
      </div>`).join('');
  }
  const th = await api.cmd('theme:get');
  $('#theme').innerHTML = th
    ? `<div style="flex:1">${esc(th.name)}<div class="muted" style="font-size:12px">Applied to the tab bar, toolbar and new tab page.</div></div><button class="btn" id="reset-theme">Reset to default</button>`
    : '<div style="flex:1" class="muted">Default Ferna theme. Install a Chrome theme from the Web Store or a .crx file.</div>';
  const rt = $('#reset-theme');
  if (rt) rt.onclick = async () => { await api.cmd('theme:reset'); load(); };
}

document.addEventListener('change', async e => {
  const a = e.target.dataset.a;
  if (!a) return;
  const id = e.target.closest('[data-id]').dataset.id;
  if (a === 'enable') await api.cmd('ext:enable', id, e.target.checked).catch(err => alert(err.message));
  if (a === 'pin') await api.cmd('ext:pin', id, e.target.checked);
  load();
});
document.addEventListener('click', async e => {
  const b = e.target.closest('button[data-a]');
  if (!b) return;
  const x = items.find(i => i.id === b.closest('[data-id]').dataset.id);
  if (b.dataset.a === 'remove') { if (await api.cmd('ext:remove', x.id)) load(); }
  if (b.dataset.a === 'options') api.cmd('ext:open', x.optionsUrl);
  if (b.dataset.a === 'page') api.cmd('ext:open', `https://chromewebstore.google.com/detail/${x.id}`);
});

async function install(kind) {
  const r = await api.cmd('ext:installFile', kind);
  if (r && r.error) alert(`Could not install: ${r.error}`);
  load();
}
$('#store').onclick = () => api.cmd('ext:open', 'https://chromewebstore.google.com/category/extensions');
$('#themes').onclick = () => api.cmd('ext:open', 'https://chromewebstore.google.com/category/themes');
$('#file').onclick = () => install('file');
$('#folder').onclick = () => install('folder');
load();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
