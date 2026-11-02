'use strict';
const { $ } = FK;
const api = window.ferna;
let C = null;
async function load() {
  C = await api.cmd('parental:get');
  $('#setup').hidden = C.hasPassword;
  $('#manage').hidden = !C.hasPassword;
  if (!C.hasPassword) return;
  $('#dot').classList.toggle('on', C.enabled);
  $('#state').textContent = C.enabled ? 'Parental controls are on' : 'Parental controls are off';
  $('#info').textContent = `${C.blockedCount} page${C.blockedCount === 1 ? '' : 's'} blocked so far · ${C.counts.adult.toLocaleString()} adult, ${C.counts.gambling.toLocaleString()} gambling, ${C.counts.social.toLocaleString()} social sites listed · ${C.status}`;
  $('#m-on').checked = C.enabled; $('#m-gambling').checked = C.categories.gambling; $('#m-social').checked = C.categories.social; $('#m-safe').checked = C.safeSearch;
  $('#m-allow').value = C.allow.join('\n'); $('#m-block').value = C.block.join('\n');
}
$('#s-go').onclick = async () => {
  if ($('#s-pw').value !== $('#s-pw2').value) { $('#s-msg').textContent = 'The two passwords are different.'; return; }
  const r = await api.cmd('parental:setup', $('#s-pw').value, { gambling: $('#s-gambling').checked, social: $('#s-social').checked, safeSearch: $('#s-safe').checked });
  if (!r.ok) { $('#s-msg').textContent = r.error; return; }
  load();
};
$('#m-save').onclick = async () => {
  const patch = { enabled: $('#m-on').checked, categories: { adult: true, gambling: $('#m-gambling').checked, social: $('#m-social').checked }, safeSearch: $('#m-safe').checked, allow: $('#m-allow').value, block: $('#m-block').value };
  if ($('#m-new').value) patch.newPassword = $('#m-new').value;
  const r = await api.cmd('parental:change', $('#m-pw').value, patch);
  $('#m-msg').className = r.ok ? 'msg ok' : 'msg';
  $('#m-msg').textContent = r.ok ? 'Saved.' : r.error;
  if (r.ok) { $('#m-pw').value = ''; $('#m-new').value = ''; load(); }
};
$('#m-refresh').onclick = async () => { $('#m-msg').className = 'msg'; $('#m-msg').textContent = 'Updating…'; const r = await api.cmd('parental:refresh', $('#m-pw').value); $('#m-msg').className = r.ok ? 'msg ok' : 'msg'; $('#m-msg').textContent = r.ok ? 'Lists updated.' : r.error; if (r.ok) load(); };
load();
