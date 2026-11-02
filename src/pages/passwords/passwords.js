'use strict';
const LINUX = /Linux/.test(navigator.userAgent) && !/Windows/.test(navigator.userAgent);
const LOCK = LINUX ? 'your account password' : 'Windows Hello';
// Passwords and autofill: saved passwords (search, show, copy, edit, delete, import/export CSV),
// checkup (weak, reused, leaked), addresses, payment cards, passkeys (Windows Hello) and options.
const { $, $$, esc, icon, faviconHtml } = FK;
const api = window.ferna;
let D = null, AF = null, tab = 'logins', q = '';
const fmtDate = t => t ? new Date(t).toLocaleDateString() : '—';

async function load() {
  D = await api.cmd('pw:list');
  AF = await api.cmd('af:list');
  if (LINUX && D.encrypted) $('#lead').textContent = 'Saved encrypted on this PC with your desktop keyring (GNOME Keyring or KWallet). Showing, copying or exporting a password asks for your account password first.';
  if (!D.encrypted) $('#lead').textContent = LINUX ? 'No login keyring (GNOME Keyring or KWallet) is available, so the vault is stored without encryption. Install and unlock a keyring, and keep this computer locked.' : 'Windows encryption is not available on this account, so the vault is stored without it. Keep this PC locked.';
  render();
}
api.on('refresh', load);
$$('.tabs button').forEach(b => { b.onclick = () => { tab = b.dataset.tab; $$('.tabs button').forEach(x => x.classList.toggle('on', x === b)); $$('section').forEach(s => { s.hidden = s.id !== `t-${tab}`; }); render(); }; });

function render() {
  ({ logins: renderLogins, checkup: renderCheckup, addresses: renderAddresses, cards: renderCards, passkeys: renderPasskeys, options: renderOptions })[tab]();
}

function flags(l) {
  const f = [];
  if (l.leaked) f.push(`<span class="flag bad" title="Seen ${l.leaked.toLocaleString()} times in data breaches">Leaked</span>`);
  if (l.reused.length) f.push(`<span class="flag warn" title="Also used on ${esc(l.reused.join(', '))}">Reused</span>`);
  if (l.strength.score <= 1) f.push(`<span class="flag warn" title="${esc(l.strength.reason || '')}">Weak</span>`);
  return f.join('');
}

function renderLogins() {
  const box = $('#t-logins');
  const list = D.logins.filter(l => !q || `${l.host} ${l.username} ${l.note}`.toLowerCase().includes(q));
  box.innerHTML = `<div class="bar"><input type="search" id="q" placeholder="Search ${D.logins.length} passwords" value="${esc(q)}">
      <button class="btn primary" id="add">Add</button><label class="btn">Import CSV…<input type="file" id="imp" accept=".csv,text/csv" hidden></label><button class="btn" id="exp">Export CSV…</button></div>
    <div class="card" style="padding:4px 12px">${list.length ? `<table><thead><tr><th>Site</th><th>Username</th><th>Password</th><th></th></tr></thead><tbody>${list.map(l => `<tr data-id="${esc(l.id)}">
      <td><div class="site">${faviconHtml(l.origin, '')}<span title="${esc(l.origin)}">${esc(l.host)}</span></div></td>
      <td>${esc(l.username) || '<span class="muted">none</span>'}</td>
      <td><span class="pw">${'•'.repeat(Math.min(12, l.length))}</span> ${flags(l)}</td>
      <td><div class="acts"><button class="btn small" data-a="show">Show</button><button class="btn small" data-a="cuser">Copy username</button><button class="btn small" data-a="cpass">Copy password</button><button class="btn small" data-a="edit">Edit</button><button class="btn small danger" data-a="del">Delete</button></div></td></tr>`).join('')}</tbody></table>`
    : `<div class="empty" style="padding:30px;text-align:center" class="muted">${q ? 'No match.' : 'No passwords yet. Ferna offers to save one when you sign in to a site, or import a CSV from Chrome, Edge, Firefox, Safari, Bitwarden, LastPass or 1Password.'}</div>`}</div>`;
  const qi = $('#q');
  qi.oninput = () => { q = qi.value.toLowerCase(); const pos = qi.selectionStart; renderLogins(); $('#q').focus(); $('#q').setSelectionRange(pos, pos); };
  $('#add').onclick = () => editLogin(null);
  $('#exp').onclick = async () => { if (await api.cmd('pw:export-csv')) alert('Exported. The file is not encrypted: delete it once you have imported it elsewhere.'); };
  $('#imp').onchange = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    const r = await api.cmd('pw:import-csv', await f.text());
    alert(r.ok ? `Imported from ${r.format}: ${r.added} added, ${r.updated} updated${r.skipped ? `, ${r.skipped} rows skipped (no site or password)` : ''}.` : `Could not import: ${r.error}`);
    load();
  };
  box.querySelector('tbody') && box.querySelector('tbody').addEventListener('click', async e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const id = b.closest('tr').dataset.id;
    const l = D.logins.find(x => x.id === id);
    if (b.dataset.a === 'show') {
      const cell = b.closest('tr').querySelector('.pw');
      if (cell.dataset.shown) { cell.textContent = '•'.repeat(Math.min(12, l.length)); delete cell.dataset.shown; b.textContent = 'Show'; return; }
      const pw = await api.cmd('pw:reveal', id);
      if (pw !== null) { cell.textContent = pw; cell.dataset.shown = '1'; b.textContent = 'Hide'; }
    } else if (b.dataset.a === 'cuser') { await api.cmd('pw:copy', id, 'username'); b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy username'; }, 1200); }
    else if (b.dataset.a === 'cpass') { if (await api.cmd('pw:copy', id, 'password')) { b.textContent = 'Copied (clears in 30 s)'; setTimeout(() => { b.textContent = 'Copy password'; }, 2000); } }
    else if (b.dataset.a === 'edit') editLogin(l);
    else if (b.dataset.a === 'del' && confirm(`Delete the password for ${l.username || 'this account'} on ${l.host}?`)) { await api.cmd('pw:delete', [id]); load(); }
  });
}

async function editLogin(l) {
  let password = '';
  if (l) { password = await api.cmd('pw:reveal', l.id); if (password === null) return; }
  const d = $('#dlg');
  d.innerHTML = `<h2 style="margin:0 0 6px">${l ? 'Edit password' : 'Add password'}</h2>
    <label>Site<input id="e-site" value="${esc(l ? l.origin : '')}" placeholder="https://example.com" ${l ? '' : 'autofocus'}></label>
    <label>Username<input id="e-user" value="${esc(l ? l.username : '')}"></label>
    <label>Password<span style="display:flex;gap:6px"><input id="e-pass" style="flex:1;font-family:var(--mono)" value="${esc(password)}"><button class="btn small" id="e-gen" type="button">Generate</button></span></label>
    <label>Note<input id="e-note" value="${esc(l ? l.note : '')}"></label>
    <div class="btns"><button class="btn" id="e-cancel">Cancel</button><button class="btn primary" id="e-save">Save</button></div>`;
  d.showModal();
  $('#e-cancel').onclick = () => d.close();
  $('#e-gen').onclick = async () => { $('#e-pass').value = await api.cmd('pw:generate', 16); };
  $('#e-save').onclick = async () => {
    const r = await api.cmd('pw:save-login', { id: l ? l.id : undefined, origin: $('#e-site').value.trim(), username: $('#e-user').value, password: $('#e-pass').value, note: $('#e-note').value });
    if (!r.ok) { alert(r.error || 'Could not save.'); return; }
    d.close(); load();
  };
}

function renderCheckup() {
  const box = $('#t-checkup');
  const leaked = D.logins.filter(l => l.leaked), reused = D.logins.filter(l => l.reused.length), weak = D.logins.filter(l => l.strength.score <= 1);
  const row = l => `<tr><td><div class="site">${faviconHtml(l.origin, '')}${esc(l.host)}</div></td><td>${esc(l.username)}</td><td>${flags(l)}</td><td style="text-align:right"><button class="btn small" data-edit="${esc(l.id)}">Change</button></td></tr>`;
  box.innerHTML = `<div class="sumcards">
      <div class="card"><b style="color:var(--danger)">${leaked.length}</b>leaked in data breaches</div>
      <div class="card"><b style="color:var(--warn)">${reused.length}</b>used on more than one site</div>
      <div class="card"><b style="color:var(--warn)">${weak.length}</b>weak</div>
    </div>
    <div class="card"><div class="row" style="border:0"><div class="grow"><b>Check for leaked passwords</b><div class="hint">Uses Have I Been Pwned's range check: only the first 5 characters of each password's SHA-1 fingerprint are sent, never the password itself.</div></div><button class="btn primary" id="leak">Check now</button></div><div id="leak-r" class="muted"></div></div>
    ${[...new Set([...leaked, ...reused, ...weak])].length ? `<div class="card" style="padding:4px 12px"><table><tbody>${[...new Set([...leaked, ...reused, ...weak])].map(row).join('')}</tbody></table></div>` : '<p class="muted">Nothing to fix. 🎉</p>'}`;
  $('#leak').onclick = async () => { $('#leak').disabled = true; $('#leak-r').textContent = 'Checking…'; const r = await api.cmd('pw:leak-check'); $('#leak-r').textContent = `Checked ${r.checked}; ${r.leaked} found in breaches.`; await load(); };
  $$('[data-edit]', box).forEach(b => { b.onclick = () => editLogin(D.logins.find(l => l.id === b.dataset.edit)); });
}

const ADDR_FIELDS = [['given', 'First name'], ['family', 'Last name'], ['org', 'Organisation'], ['email', 'Email'], ['tel', 'Phone'], ['line1', 'Address line 1'], ['line2', 'Address line 2'], ['city', 'City'], ['state', 'Province / state'], ['postal', 'Postal code'], ['country', 'Country']];
function renderAddresses() {
  const box = $('#t-addresses');
  box.innerHTML = `<div class="bar"><span class="grow muted">Filled into delivery and sign-up forms when you pick one from the list under a field.</span><button class="btn primary" id="add-a">Add address</button></div>
    ${AF.addresses.length ? AF.addresses.map(a => `<div class="card row" style="display:flex"><div class="grow"><b>${esc([a.given, a.family].filter(Boolean).join(' ') || a.name || a.email)}</b><div class="hint">${esc([a.line1, a.line2, a.city, a.postal, a.country].filter(Boolean).join(', '))}</div></div><button class="btn small" data-ea="${esc(a.id)}">Edit</button><button class="btn small danger" data-da="${esc(a.id)}">Delete</button></div>`).join('') : '<p class="muted">No addresses saved.</p>'}`;
  $('#add-a').onclick = () => editAddress({});
  $$('[data-ea]', box).forEach(b => { b.onclick = () => editAddress(AF.addresses.find(a => a.id === b.dataset.ea)); });
  $$('[data-da]', box).forEach(b => { b.onclick = async () => { if (confirm('Delete this address?')) { await api.cmd('af:delete-address', b.dataset.da); load(); } }; });
}
function editAddress(a) {
  const d = $('#dlg');
  d.innerHTML = `<h2 style="margin:0 0 6px">${a.id ? 'Edit' : 'Add'} address</h2><div class="grid2">${ADDR_FIELDS.map(([k, t]) => `<label>${t}<input data-k="${k}" value="${esc(a[k] || '')}"></label>`).join('')}</div>
    <div class="btns"><button class="btn" id="e-cancel">Cancel</button><button class="btn primary" id="e-save">Save</button></div>`;
  d.showModal();
  $('#e-cancel').onclick = () => d.close();
  $('#e-save').onclick = async () => { const o = { id: a.id }; $$('[data-k]', d).forEach(i => { o[i.dataset.k] = i.value.trim(); }); await api.cmd('af:save-address', o); d.close(); load(); };
}

function renderCards() {
  const box = $('#t-cards');
  box.innerHTML = `<div class="bar"><span class="grow muted">Card numbers are kept in the encrypted vault; the security code (CVV) is never saved. Filling a card asks for ${LOCK}. Cards are only offered on secure (https) pages.</span><button class="btn primary" id="add-c">Add card</button></div>
    ${AF.cards.length ? AF.cards.map(c => `<div class="card ccard"><span class="chip"></span><div class="grow"><b>${esc(c.nickname || c.brand)} •••• ${esc(c.last4)}</b><div class="hint">${esc(c.name)} · expires ${String(c.month).padStart(2, '0')}/${String(c.year).slice(-2)}</div></div><button class="btn small" data-ec="${esc(c.id)}">Edit</button><button class="btn small danger" data-dc="${esc(c.id)}">Delete</button></div>`).join('') : '<p class="muted">No cards saved.</p>'}`;
  $('#add-c').onclick = () => editCard({});
  $$('[data-ec]', box).forEach(b => { b.onclick = () => editCard(AF.cards.find(c => c.id === b.dataset.ec)); });
  $$('[data-dc]', box).forEach(b => { b.onclick = async () => { if (confirm('Delete this card?')) { await api.cmd('af:delete-card', b.dataset.dc); load(); } }; });
}
function editCard(c) {
  const d = $('#dlg');
  d.innerHTML = `<h2 style="margin:0 0 6px">${c.id ? 'Edit' : 'Add'} card</h2>
    <label>Card number<input id="c-num" inputmode="numeric" autocomplete="off" placeholder="${c.id ? `•••• ${esc(c.last4)} (leave empty to keep)` : ''}"></label>
    <label>Name on card<input id="c-name" value="${esc(c.name || '')}"></label>
    <div class="grid2"><label>Expiry month<input id="c-m" inputmode="numeric" value="${esc(c.month || '')}" placeholder="MM"></label><label>Expiry year<input id="c-y" inputmode="numeric" value="${esc(c.year || '')}" placeholder="YYYY"></label></div>
    <label>Nickname (optional)<input id="c-nick" value="${esc(c.nickname || '')}"></label>
    <div class="btns"><button class="btn" id="e-cancel">Cancel</button><button class="btn primary" id="e-save">Save</button></div>`;
  d.showModal();
  $('#e-cancel').onclick = () => d.close();
  $('#e-save').onclick = async () => {
    let y = Number($('#c-y').value); if (y < 100) y += 2000;
    const r = await api.cmd('af:save-card', { id: c.id, number: $('#c-num').value, name: $('#c-name').value, month: Number($('#c-m').value), year: y, nickname: $('#c-nick').value });
    if (!r.ok) { alert(r.error || 'Could not save.'); return; }
    d.close(); load();
  };
}

function renderPasskeys() {
  $('#t-passkeys').innerHTML = LINUX
    ? `<div class="card"><h2>Passkeys</h2>
      <p>A passkey replaces a password with a security key or your phone. On Linux, sites that offer passkeys can use a <b>USB or NFC security key</b> (YubiKey, Google Titan, SoloKey …) plugged into this PC, or <b>your phone</b>: choose "Use a phone or tablet" and scan the QR code.</p>
      <p class="muted">If your security key is not detected, install your distribution's udev rules for security keys (for example <code>sudo apt install libu2f-udev</code>) and plug it in again.</p></div>`
    : `<div class="card"><h2>Passkeys</h2>
      <p>A passkey replaces a password with your fingerprint, face or Windows PIN. When a site offers to create one, Ferna Sundaree hands the request to Windows Hello, which keeps the passkey on this PC (it never reaches Ferna or the site).</p>
      <p class="muted">Use one from your phone instead: choose "Use a phone or tablet" in the Windows Hello window and scan the QR code.</p>
      <button class="btn primary" id="pk">Manage passkeys in Windows Settings</button></div>`;
  const b = $('#pk'); if (b) b.onclick = () => api.cmd('pw:passkeys');
}

function renderOptions() {
  const s = D.settings;
  $('#t-options').innerHTML = `<div class="card">
    <div class="row"><div class="grow">Offer to save passwords<div class="hint">And fill them from the list under a sign-in field.</div></div><label class="switch"><input type="checkbox" data-k="passwordManager" ${s.passwordManager ? 'checked' : ''}><span></span></label></div>
    <div class="row"><div class="grow">Fill addresses</div><label class="switch"><input type="checkbox" data-k="autofillAddresses" ${s.addresses ? 'checked' : ''}><span></span></label></div>
    <div class="row"><div class="grow">Fill payment cards</div><label class="switch"><input type="checkbox" data-k="autofillCards" ${s.cards ? 'checked' : ''}><span></span></label></div>
    </div>
    <div class="card"><h2>Never saved for</h2><div id="never">${D.never.length ? D.never.map(o => `<span class="chip"><span>${esc(o.replace(/^https?:\/\//, ''))}</span><button data-o="${esc(o)}" title="Remove">×</button></span>`).join(' ') : '<span class="muted">None.</span>'}</div></div>`;
  $$('[data-k]').forEach(i => { i.onchange = async () => { await api.cmd('settings:set', i.dataset.k, i.checked).catch(() => {}); load(); }; });
  $$('#never [data-o]').forEach(b => { b.onclick = async () => { await api.cmd('pw:never-remove', b.dataset.o); load(); }; });
}

load();
