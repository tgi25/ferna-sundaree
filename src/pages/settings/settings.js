'use strict';
const { esc, faviconHtml, wsIconHtml, hostOf, $, $$ } = FK;
// Suggested workspace glyphs (the same set as Ferna Tabs).
const GLYPHS = ['🎓', '🔬', '🗂', '💼', '📚', '🧪', '✉️', '📰', '🛒', '🎬', '🎵', '⚽', '🏦', '🧭', '🛠', '🐙', '☁️', '🏠', '✈️', '🍳'];
const api = window.ferna;
let S = null;
let WS = null;

// ---------- simple settings ----------
async function loadSettings() {
  S = await api.cmd('settings:get');
  $$('[data-k]').forEach(el => {
    const v = S[el.dataset.k];
    if (el.type === 'checkbox') el.checked = el.dataset.invert ? !v : !!v;
    else el.value = String(v);
  });
  $('#vw').textContent = `${S.verticalWidth}px`;
  fillBmFolders();
  chips('#https-ex', S.httpsExceptions, h => set('httpsExceptions', S.httpsExceptions.filter(x => x !== h)));
  chips('#blocker-allow', S.blockerAllow, h => set('blockerAllow', S.blockerAllow.filter(x => x !== h)));
  const perms = await api.cmd('perm:list');
  const pk = Object.keys(perms);
  $('#perms').innerHTML = pk.length ? '' : '<span class="muted">None saved.</span>';
  pk.forEach(k => {
    const [origin, perm] = k.split('|');
    const c = document.createElement('span');
    c.className = 'chip';
    c.innerHTML = `<span>${esc(hostOf(origin) || origin)} · ${esc(perm)} · <b>${esc(perms[k])}</b></span><button title="Forget">×</button>`;
    c.querySelector('button').onclick = async () => { await api.cmd('perm:revoke', k); loadSettings(); };
    $('#perms').append(c);
  });
}

function chips(sel, list, onRemove) {
  const box = $(sel);
  box.innerHTML = list.length ? '' : '<span class="muted">None.</span>';
  list.forEach(h => {
    const c = document.createElement('span');
    c.className = 'chip';
    c.innerHTML = `<span>${esc(h)}</span><button title="Remove">×</button>`;
    c.querySelector('button').onclick = () => onRemove(h);
    box.append(c);
  });
}

async function set(k, v) {
  try { S = await api.cmd('settings:set', k, v); } catch (e) { alert('Could not save that setting.'); }
  loadSettings();
}

$$('[data-k]').forEach(el => {
  el.addEventListener(el.type === 'range' ? 'input' : 'change', () => {
    let v = el.type === 'checkbox' ? (el.dataset.invert ? !el.checked : el.checked) : el.value;
    if (el.dataset.num) v = Number(v);
    if (el.type === 'range') { $('#vw').textContent = `${v}px`; clearTimeout(el._t); el._t = setTimeout(() => set(el.dataset.k, v), 200); return; }
    set(el.dataset.k, v);
  });
});
$('#defbrowser').onclick = () => api.cmd('default-browser');

// ---------- default bookmark folder ----------
async function fillBmFolders() {
  const sel = $('#bmfolder');
  if (!sel) return;
  let t;
  try { t = await api.cmd('bm:tree'); } catch { return; }
  const kids = p => t.items.filter(n => n.type === 'folder' && (n.folder || 'other') === p);
  const opts = ['<option value="">Bookmarks bar (popup opens at the top)</option>'];
  const walk = (p, depth) => kids(p).forEach(n => { opts.push(`<option value="${esc(n.id)}">${'\u00a0\u00a0\u00a0'.repeat(depth)}${esc(n.title || 'Folder')}</option>`); walk(n.id, depth + 1); });
  for (const r of ['bar', 'other']) {
    if (r !== 'bar') opts.push(`<option value="${r}">${esc(t.roots[r])}</option>`);
    walk(r, r === 'bar' ? 1 : 1);
  }
  sel.innerHTML = opts.join('');
  sel.value = t.defaultFolder || '';
}
$('#bmfolder').addEventListener('change', e => set('bookmarkFolder', e.target.value));

// ---------- appearance ----------
async function loadTheme() {
  const th = await api.cmd('theme:get');
  $('#theme-name').textContent = th ? th.name : 'Default Ferna theme';
  $('#theme-reset').disabled = !th;
}
$('#theme-reset').onclick = async () => { await api.cmd('theme:reset'); loadTheme(); };

// ---------- zoom ----------
const ZDEF = { mode: 'site', defaultType: 'full', defaultFull: 100, defaultText: 100, defaultNonText: 100, levels: [30, 50, 67, 80, 90, 100, 110, 120, 133, 150, 170, 200, 240, 300, 400, 500], stepMode: 'levels', step: 10, autofitMin: 50, autofitMax: 200, autofitOnLoad: false, minFont: 0, lineSpacing: 1, subdomainsSeparate: false };
let Z = null;
function loadZoom() {
  Z = { ...ZDEF, ...(S.zoomPrefs || {}) };
  $$('[data-z]').forEach(el => {
    const v = Z[el.dataset.z];
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = Array.isArray(v) ? v.join(', ') : String(v);
  });
  api.cmd('zoom:sites').then(sites => {
    const keys = Object.keys(sites);
    chips('#zoom-sites', keys.map(k => `${k}: ${sites[k].type === 'text' ? 'text ' + sites[k].text : sites[k].full}%${sites[k].minFont ? `, min ${sites[k].minFont}px` : ''}`), label => {
      api.cmd('zoom:clearSite', label.split(':')[0]).then(loadZoom);
    });
  });
}
$$('[data-z]').forEach(el => el.addEventListener('change', async () => {
  const k = el.dataset.z;
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if (k === 'levels') v = v.split(/[\s,;]+/).map(Number).filter(n => n >= 25 && n <= 500);
  else if (el.type === 'number' || el.dataset.num) v = Number(v);
  const next = { ...Z, [k]: v };
  try { S = await api.cmd('settings:set', 'zoomPrefs', next); } catch { alert('Please check the zoom values (levels between 25 and 500 %).'); }
  loadZoom();
}));
$('#zoom-clear').onclick = async () => { if (confirm('Forget the saved zoom of every site?')) { await api.cmd('zoom:clearSite', null); loadZoom(); } };
$$('[data-open]').forEach(b => { b.onclick = () => { location.href = b.dataset.open; }; });

// ---------- workspaces ----------
async function loadWs() { WS = await api.cmd('ws:get'); renderWs(); }

function renderWs() {
  const box = $('#wslist');
  box.innerHTML = WS.workspaces.length ? '' : '<p class="muted">No workspaces yet. Add one, or right-click a tab → Move to workspace → New workspace.</p>';
  WS.workspaces.forEach((w, i) => {
    const d = document.createElement('div');
    d.className = 'ws-item';
    d.id = `ws-${w.id}`;
    d.style.setProperty('--c', w.color);
    d.innerHTML = `<div class="head"><button class="ws-ico" data-a="pick" title="Change icon" aria-label="Change icon of ${esc(w.name)}">${wsIconHtml(w)}</button><input type="color" value="${esc(w.color)}" data-f="color" title="Colour">
        <input class="field" type="text" value="${esc(w.name)}" data-f="name" maxlength="40" aria-label="Workspace name">
        <button class="btn small" data-a="up" ${i ? '' : 'disabled'}>Up</button><button class="btn small danger" data-a="del">Delete</button></div>
      <div class="chips">${w.pinned.map((p, k) => `<span class="chip">${faviconHtml(p.url, '')}<span title="${esc(p.url)}">${esc(p.title || p.url)}</span><button data-unpin="${k}" title="Unpin">×</button></span>`).join('') || '<span class="muted" style="font-size:12px">No pinned sites. Point at a tab and click the pin, or right-click a tab → Pin to.</span>'}</div>
      <div class="icon-pick">
        <div class="muted" style="font-size:12px">Pick an icon, type one or two characters (an emoji or letters), or upload a small picture.</div>
        <div class="glyphs">${GLYPHS.map(g => `<button data-glyph="${g}" title="Use ${g}">${g}</button>`).join('')}</div>
        <div class="row2">
          <input class="field" type="text" data-f="icon" maxlength="4" value="${esc(w.icon || '')}" placeholder="${esc(([...w.name][0] || '').toUpperCase())}" aria-label="Icon characters">
          <label class="btn small">Upload picture…<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-upload hidden></label>
          ${w.image ? '<button class="btn small" data-a="noimg">Remove picture</button>' : ''}
          <button class="btn small" data-a="pick">Done</button>
        </div>
      </div>
      <textarea class="field" rows="2" data-f="hosts" placeholder="Extra host names, one per line (e.g. github.com)">${esc(w.hosts.join('\n'))}</textarea>`;
    if (picking === w.id) d.classList.add('picking');
    d.addEventListener('change', async e => {
      if (e.target.dataset.upload !== undefined) {
        const file = e.target.files[0];
        if (!file) return;
        try { w.image = await shrinkIcon(file); saveWs(); } catch (err) { alert(err.message); }
        return;
      }
      const f = e.target.dataset.f;
      if (!f) return;
      if (f === 'hosts') w.hosts = e.target.value.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
      else { w[f] = e.target.value; if (f === 'icon') delete w.image; }
      saveWs();
    });
    d.addEventListener('click', e => {
      const g = e.target.closest('[data-glyph]');
      if (g) { w.icon = g.dataset.glyph; delete w.image; saveWs(); return; }
      const a = (e.target.closest('[data-a]') || {}).dataset?.a;
      if (a === 'pick') { picking = picking === w.id ? null : w.id; renderWs(); return; }
      if (a === 'noimg') { delete w.image; saveWs(); return; }
      if (a === 'del' && confirm(`Delete the workspace “${w.name}”? Its tabs stay open.`)) { WS.workspaces.splice(i, 1); saveWs(); }
      if (a === 'up') { WS.workspaces.splice(i - 1, 0, WS.workspaces.splice(i, 1)[0]); saveWs(); }
      if (e.target.dataset.unpin !== undefined) { w.pinned.splice(Number(e.target.dataset.unpin), 1); saveWs(); }
    });
    box.append(d);
  });
  const ap = $('#allpinned');
  const AP = WS.allPinned || [];
  ap.innerHTML = AP.length ? '' : '<span class="muted">None yet. Choose “All” on the workspaces bar, point at a tab and click the pin.</span>';
  AP.forEach((p, k) => {
    const s2 = document.createElement('span');
    s2.className = 'chip';
    s2.innerHTML = `${faviconHtml(p.url, '')}<span title="${esc(p.url)}">${esc(p.title || p.url)}</span><button title="Unpin">×</button>`;
    s2.querySelector('button').onclick = () => { AP.splice(k, 1); saveWs(); };
    ap.append(s2);
  });
  $('#common-n').textContent = `(${WS.common.length} of 20)`;
  const cb = $('#common');
  cb.innerHTML = WS.common.length ? '' : '<span class="muted">Empty.</span>';
  WS.common.forEach((c, k) => {
    const s = document.createElement('span');
    s.className = 'chip';
    s.innerHTML = `${faviconHtml(c.url, '')}<span title="${esc(c.url)}">${esc(c.title || c.url)}</span><button title="Remove">×</button>`;
    s.querySelector('button').onclick = () => { WS.common.splice(k, 1); saveWs(); };
    cb.append(s);
  });
}

let picking = null; // workspace whose icon picker is open

/** Scale an uploaded picture to a 32 × 32 PNG (aspect kept, centred), as Ferna Tabs does. */
function shrinkIcon(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return reject(new Error('Please choose a PNG, JPEG, WebP or GIF picture.'));
    if (file.size > 4 * 1024 * 1024) return reject(new Error('Please choose a picture under 4 MB.'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const S2 = 32, c = document.createElement('canvas');
      c.width = c.height = S2;
      const k = Math.min(S2 / img.width, S2 / img.height);
      const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
      c.getContext('2d').drawImage(img, Math.round((S2 - w) / 2), Math.round((S2 - h) / 2), w, h);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That picture could not be read.')); };
    img.src = url;
  });
}

async function saveWs() { WS = await api.cmd('ws:save', { workspaces: WS.workspaces, common: WS.common, allPinned: WS.allPinned || [] }); renderWs(); }

$('#ws-add').onclick = () => {
  const colors = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2'];
  WS.workspaces.push({ id: `ws-${Date.now().toString(36)}`, name: `Workspace ${WS.workspaces.length + 1}`, color: colors[WS.workspaces.length % 6], icon: GLYPHS[WS.workspaces.length % GLYPHS.length], pinned: [], hosts: [] });
  saveWs();
};
$('#ws-import').onchange = async e => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const r = await api.cmd('ws:import', JSON.parse(await f.text()));
    WS = r.data; renderWs();
    alert(`Imported ${r.workspaces} workspace${r.workspaces === 1 ? '' : 's'} and ${r.common} common-bar site${r.common === 1 ? '' : 's'}.`);
  } catch (err) { alert('This file could not be read as a Ferna Tabs export.'); }
  e.target.value = '';
};
$('#ws-export').onclick = () => {
  const data = {
    format: 'ferna-tabs-backup', version: 1, exportedBy: 'Ferna Sundaree', exportedAt: new Date().toISOString(),
    workspaces: WS.workspaces.map(w => ({ id: w.id, name: w.name, color: w.color, icon: w.icon, sites: w.pinned.map(p => ({ u: p.url, t: p.title })), hosts: w.hosts })),
    common: WS.common.map(c => ({ u: c.url, t: c.title })),
    icons: Object.fromEntries(WS.workspaces.filter(w => w.image).map(w => [`wsIcon_${w.id}`, w.image])),
    allPinned: (WS.allPinned || []).map(p => ({ u: p.url, t: p.title })),
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = `ferna-workspaces-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
};

// ---------- privacy ----------
$('#clear').onclick = async () => {
  const range = Number($('#c-range').value);
  const what = { history: $('#c-history').checked, cookies: $('#c-cookies').checked, cache: $('#c-cache').checked, downloads: $('#c-downloads').checked, since: range ? Date.now() - range : 0 };
  if (!what.history && !what.cookies && !what.cache && !what.downloads) return;
  $('#clear').disabled = true;
  await api.cmd('privacy:clear', what);
  $('#clear').disabled = false;
  $('#clear').textContent = 'Cleared ✓';
  setTimeout(() => { $('#clear').textContent = 'Clear data'; }, 2000);
};
$('#blocker-refresh').onclick = async () => {
  $('#blocker-status').textContent = 'Updating filter lists…';
  try { await api.cmd('blocker:refresh'); } catch { /* status shows it */ }
  loadAbout();
};

// ---------- shortcuts ----------
async function loadShortcuts(list) {
  list = list || await api.cmd('shortcuts:get');
  const box = $('#sclist');
  box.innerHTML = list.filter(d => d.cmd !== 'escape').map(d => `<div class="sc"><span>${esc(d.label)}</span><input class="field" data-cmd="${esc(d.cmd)}" value="${esc(d.keys.join(', '))}" spellcheck="false"></div>`).join('');
}
$('#sclist').addEventListener('change', async e => {
  const inp = e.target;
  const keys = inp.value.split(',').map(s => s.trim()).filter(Boolean);
  const r = await api.cmd('shortcuts:set', inp.dataset.cmd, keys);
  inp.classList.toggle('bad', !r.ok);
  if (!r.ok) inp.title = r.clash === 'invalid' ? 'Not a valid key combination' : `Already used by: ${r.clash}`;
  else { inp.title = ''; loadShortcuts(r.list); }
});
$('#sc-reset').onclick = async () => loadShortcuts(await api.cmd('shortcuts:reset'));

// ---------- about ----------
async function loadAbout() {
  const a = await api.cmd('about:get');
  const yes = t => `<span class="ok">✓</span> ${t}`;
  const no = t => `<span class="bad-t">✗</span> ${t}`;
  $('#blocker-status').textContent = `Lists: ${a.blocker.status}${a.blocker.updated ? `, updated ${new Date(a.blocker.updated).toLocaleString()}` : ''}`;
  $('#about-body').innerHTML = `
    <dl class="kv">
      <dt>Ferna Sundaree</dt><dd>${esc(a.version)}</dd>
      <dt>Engine</dt><dd>Electron ${esc(a.electron)} · Chromium ${esc(a.chrome)} · Node ${esc(a.node)}</dd>
      <dt>Ferna Tabs</dt><dd>${esc(a.features.tabs)}</dd>
      <dt>Ferna PDF Reader</dt><dd>${esc(a.features.pdf)}</dd>
      <dt>Ferna Screenshots</dt><dd>${esc(a.features.screenshots)}</dd>
      <dt>System</dt><dd>${esc(a.platform)}</dd>
      <dt>Profile</dt><dd>${esc(a.profile)} · ${esc(a.dataDir)}</dd>
      <dt>Protected video (Widevine)</dt><dd>${esc(a.widevine)}${a.widevine === 'not in this edition' ? ' — Netflix, Disney+, Prime Video and Spotify need the Streaming edition' : ''}</dd>
    </dl>
    <h2 style="font-size:14px;margin-top:18px">Security status</h2>
    <div class="check">${yes('Every web page runs in a sandboxed, site-isolated process with no Node.js')}</div>
    <div class="check">${yes('Browser interface is separate from web pages; one validated IPC channel')}${a.rejectedIpc ? ` (${a.rejectedIpc} rejected calls this session)` : ''}</div>
    <div class="check">${a.encryption ? yes(FK.LINUX ? 'Bookmarks, history and session encrypted with your login keyring' : 'Bookmarks, history and session encrypted with your Windows account (DPAPI)') : no('Profile encryption unavailable on this system')}</div>
    <div class="check">${a.blocker.status === 'ready' ? yes('Tracker, ad and malware-domain blocking active') : no(`Filter lists ${a.blocker.status}`)}</div>
    <p class="muted" style="margin-top:14px">Made by Ferna Software Solutions · MIT licence · <a href="https://github.com/tgi25/ferna-sundaree">github.com/tgi25/ferna-sundaree</a></p>`;
}

// ---------- updates ----------
function showUpdate(u) {
  const t = $('#upd-status');
  const from = u.sources && u.sources.length ? ` (from ${u.sources.join(' and ')})` : '';
  const when = u.checked ? `${from}, checked ${new Date(u.checked).toLocaleString()}` : '';
  const msg = {
    idle: `Version ${u.current}. Checks for updates every 6 hours.`,
    checking: 'Checking for updates…',
    current: `Version ${u.current} is the latest${when}.`,
    available: `Version ${u.available && u.available.version} is available (signature verified)${when}.`,
    downloading: `Downloading the update… ${u.progress || 0}%`,
    ready: `Version ${u.available && u.available.version} is downloaded and verified.`,
    error: `Update check failed: ${u.error || 'unknown error'}${when}.`,
  }[u.status] || '';
  t.textContent = msg + (u.kind === 'portable' ? ' Portable copy: the new version is saved to Downloads for you to run.' : u.kind === 'dev' ? ' (Running from source: updates are not installed.)' : '');
  const ib = $('#upd-install');
  ib.hidden = !(u.status === 'ready' || (u.status === 'available' && u.kind === 'portable'));
  ib.textContent = u.kind === 'portable' ? 'Save new version' : 'Restart to update';
  if (u.status === 'available' && u.kind !== 'dev') { ib.hidden = false; ib.textContent = 'Download update'; ib.dataset.step = 'download'; } else ib.dataset.step = 'install';
}
async function loadUpdate() { showUpdate(await api.cmd('update:status')); }
$('#upd-check').onclick = async () => { showUpdate({ status: 'checking' }); showUpdate(await api.cmd('update:check')); };
$('#upd-install').onclick = async e => {
  if (e.target.dataset.step === 'download') { showUpdate({ status: 'downloading', progress: 0 }); showUpdate(await api.cmd('update:download')); return; }
  await api.cmd('update:install');
};

// ---------- safe browsing ----------
async function loadSafety(st) {
  st = st || await api.cmd('safety:status');
  const n = st.counts || {};
  $('#safety-status').textContent = st.status === 'ready'
    ? `${(n.phishing || 0).toLocaleString()} phishing and ${(n.malware || 0).toLocaleString()} malware entries${st.updated ? `, updated ${new Date(st.updated).toLocaleString()}` : ''}. Checked on this PC; no address is sent anywhere.`
    : `Lists: ${st.status}`;
}
$('#safety-refresh').onclick = async () => { $('#safety-status').textContent = 'Updating…'; loadSafety(await api.cmd('safety:refresh')); };

// ---------- my filters ----------
let FL = null;
async function loadFilters() {
  FL = await api.cmd('filters:get');
  $('#my-filters').value = FL.custom;
  $('#my-filters-n').textContent = `${FL.rules} rule${FL.rules === 1 ? '' : 's'}`;
  renderLists();
}
function renderLists() {
  const box = $('#lists');
  box.innerHTML = FL.lists.length ? '' : '<span class="muted">None.</span>';
  FL.lists.forEach((u, k) => {
    const c = document.createElement('span');
    c.className = 'chip';
    c.innerHTML = `<span title="${esc(u)}">${esc(u)}</span><button title="Remove">×</button>`;
    c.querySelector('button').onclick = () => saveLists(FL.lists.filter((_, i) => i !== k));
    box.append(c);
  });
}
async function saveLists(list) {
  $('#lists-status').textContent = 'Downloading lists and rebuilding the blocker… this can take a minute.';
  const r = await api.cmd('filters:lists', list);
  FL.lists = r.lists;
  renderLists();
  $('#lists-status').textContent = r.error ? `Could not update: ${r.error}` : `Lists ${r.status}${r.updated ? `, updated ${new Date(r.updated).toLocaleString()}` : ''}.`;
}
$('#my-filters-save').onclick = async () => {
  const r = await api.cmd('filters:save', $('#my-filters').value);
  $('#my-filters-n').textContent = `Saved · ${r.rules} rule${r.rules === 1 ? '' : 's'} understood`;
};
$('#list-add').onclick = () => {
  const u = $('#list-url').value.trim();
  if (!/^https:\/\/\S+$/i.test(u)) { alert('Please enter an https:// address of a filter list.'); return; }
  $('#list-url').value = '';
  saveLists([...FL.lists, u]);
};

// ---------- nav highlight ----------
function markNav() {
  const id = (location.hash || '#general').slice(1);
  const navId = id.startsWith('ws-') ? 'workspaces' : id;
  $$('#nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === `#${navId}`));
  if (id.startsWith('ws-') && WS && WS.workspaces.some(w => `ws-${w.id}` === id) && picking !== id.slice(3)) { picking = id.slice(3); renderWs(); }
  const sec = document.getElementById(id);
  if (sec) sec.scrollIntoView({ block: 'start' });
}
addEventListener('hashchange', markNav);

Promise.all([loadSettings(), loadWs(), loadShortcuts(), loadAbout(), loadTheme(), loadSafety(), loadFilters(), loadUpdate()]).then(() => { loadZoom(); markNav(); });

// ---------- 0.5: passwords, AI, languages, sync, profiles, apps, policy ----------
$('#open-passwords').onclick = () => api.cmd('run', 'passwords');
$('#open-assistant').onclick = () => api.cmd('run', 'assistant');
const LANGS = { en: 'English', si: 'Sinhala', ta: 'Tamil', hi: 'Hindi', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', ar: 'Arabic', fr: 'French', de: 'German', es: 'Spanish', pt: 'Portuguese', ru: 'Russian', it: 'Italian', nl: 'Dutch', ms: 'Malay', th: 'Thai', id: 'Indonesian', bn: 'Bengali', ur: 'Urdu' };
$('#tr-lang').innerHTML = Object.entries(LANGS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');

async function loadSpell() {
  const r = await api.cmd('spell:langs');
  const cur = r.current.length ? r.current : ['en-US'];
  const avail = r.available.length ? r.available : ['en-US', 'en-GB'];
  let names = null;
  try { names = new Intl.DisplayNames(undefined, { type: 'language' }); } catch { names = null; }
  $('#spell').innerHTML = avail.map(l => `<label class="chip" style="cursor:pointer"><input type="checkbox" value="${esc(l)}" ${cur.includes(l) ? 'checked' : ''}> <span>${esc(names ? (names.of(l) || l) : l)}</span></label>`).join('');
  $$('#spell input').forEach(i => { i.onchange = () => api.cmd('spell:set', $$('#spell input:checked').map(x => x.value)); });
}

let syncFolder = '';
async function loadSync() {
  const st = await api.cmd('sync:status');
  const on = st.enabled && st.ready;
  $('#sync-on').hidden = !on; $('#sync-off').hidden = on;
  if (on) {
    $('#sync-where').textContent = st.folder;
    $('#sync-pw2').checked = st.passwords; $('#sync-hist2').checked = st.history;
  }
  $('#sync-status').innerHTML = st.error ? `<span class="bad-t">✗</span> ${esc(st.error)}` : st.last ? `<span class="ok">✓</span> Last synced ${esc(new Date(st.last).toLocaleString())}${st.running ? ' · syncing…' : ''}` : st.running ? 'Syncing…' : '';
}
$('#sync-choose').onclick = async () => { const f = await api.cmd('sync:choose-folder'); if (f) { syncFolder = f; $('#sync-folder-t').textContent = f; } };
$('#sync-start').onclick = async () => {
  if (!syncFolder) { alert('Choose a folder first.'); return; }
  $('#sync-status').textContent = 'Setting up…';
  const r = await api.cmd('sync:setup', syncFolder, $('#sync-pass').value, { passwords: $('#sync-pw').checked, history: $('#sync-hist').checked });
  $('#sync-pass').value = '';
  if (!r.ok) { $('#sync-status').innerHTML = `<span class="bad-t">✗</span> ${esc(r.error)}`; return; }
  loadSync();
};
$('#sync-now').onclick = async () => { $('#sync-status').textContent = 'Syncing…'; await api.cmd('sync:now'); loadSync(); };
$('#sync-stop').onclick = async () => { if (confirm('Turn off sync on this PC? Your data stays here and in the sync folder.')) { await api.cmd('sync:disable'); loadSync(); } };
for (const id of ['#sync-pw2', '#sync-hist2']) $(id).onchange = () => api.cmd('sync:options', { passwords: $('#sync-pw2').checked, history: $('#sync-hist2').checked });
api.on('refresh', () => loadSync());

async function loadProfiles() {
  const p = await api.cmd('profiles:list');
  $('#profiles-list').innerHTML = p.list.map(n => `<div class="row"><div class="grow">${esc(n)}${n === p.current ? ' <span class="muted">(this window)</span>' : ''}</div><button class="btn small" data-po="${esc(n)}">Open</button><button class="btn small" data-ps="${esc(n)}">Desktop shortcut</button></div>`).join('');
  $$('[data-po]').forEach(b => { b.onclick = () => api.cmd('profiles:open', b.dataset.po); });
  $$('[data-ps]').forEach(b => { b.onclick = async () => { if (await api.cmd('profiles:shortcut', b.dataset.ps)) b.textContent = 'Created'; }; });
  const w = await api.cmd('ws:get');
  $('#ws-logins').innerHTML = w.workspaces.length ? w.workspaces.map(x => `<div class="row"><div class="grow">${wsIconHtml(x)} ${esc(x.name)}</div>${x.separate ? `<button class="btn small" data-wc="${esc(x.id)}" title="Sign out of every site in this workspace">Clear its logins</button>` : ''}<label class="switch"><input type="checkbox" data-wsep="${esc(x.id)}" ${x.separate ? 'checked' : ''}><span></span></label></div>`).join('') : '<p class="muted">No workspaces yet.</p>';
  $$('[data-wsep]').forEach(i => { i.onchange = async () => { await api.cmd('ws:separate', i.dataset.wsep, i.checked); loadProfiles(); }; });
  $$('[data-wc]').forEach(b => { b.onclick = async () => { if (confirm('Sign out of every site in this workspace (deletes its cookies and site data)?')) { await api.cmd('ws:clear-logins', b.dataset.wc); b.textContent = 'Cleared'; } }; });
  const apps = await api.cmd('apps:list');
  $('#apps-list').innerHTML = apps.length ? apps.map(a => `<div class="row"><div class="grow">${faviconHtml(a.url, '')} ${esc(a.name)}<div class="hint">${esc(a.origin)}</div></div><button class="btn small" data-ao="${esc(a.url)}">Open</button><button class="btn small danger" data-au="${esc(a.id)}">Uninstall</button></div>`).join('') : '<p class="muted">None installed.</p>';
  $$('[data-ao]').forEach(b => { b.onclick = () => api.cmd('apps:open', b.dataset.ao); });
  $$('[data-au]').forEach(b => { b.onclick = async () => { await api.cmd('apps:uninstall', b.dataset.au); loadProfiles(); }; });
}
$('#profile-add').onclick = async () => { const n = $('#profile-name').value.trim(); if (!n) return; await api.cmd('profiles:create', n, $('#profile-sc').checked); $('#profile-name').value = ''; setTimeout(loadProfiles, 800); };

async function loadPolicy() {
  const p = await api.cmd('policy:get');
  $('#policy-banner').hidden = !p.locked.length && !Object.keys(p.features).length;
  for (const k of p.locked) $$(`[data-k="${k}"]`).forEach(el => { el.disabled = true; el.closest('.row') && (el.closest('.row').title = 'Managed by your organisation'); });
}

loadSpell(); loadSync(); loadProfiles(); loadPolicy();

// ---------- 0.6: schedule, parental, exam ----------
$('#open-parental').onclick = () => api.cmd('run', 'parentalControls');
$('#open-exam').onclick = () => api.cmd('run', 'examMode');
async function loadSchedule() {
  const s = await api.cmd('settings:get');
  const sc = s.themeSchedule || { on: false, dark: '19:00', light: '06:30' };
  $('#sch-on').checked = sc.on; $('#sch-dark').value = sc.dark; $('#sch-light').value = sc.light;
}
for (const id of ['#sch-on', '#sch-dark', '#sch-light']) $(id).addEventListener('change', () => set('themeSchedule', { on: $('#sch-on').checked, dark: $('#sch-dark').value || '19:00', light: $('#sch-light').value || '06:30' }));
loadSchedule();
