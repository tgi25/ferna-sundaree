'use strict';
const { $, esc } = FK;
const api = window.ferna;
const cfg = () => ({ title: $('#title').value, url: $('#url').value.trim(), allowed: $('#allowed').value, minutes: Number($('#minutes').value) || 0, allowCopy: $('#copy').checked, allowSpell: $('#spell').checked, password: $('#pw').value });
function check() {
  if ($('#pw').value !== $('#pw2').value) { $('#msg').textContent = 'The two passwords are different.'; return false; }
  if ($('#pw').value.length < 4) { $('#msg').textContent = 'Use at least 4 characters for the password.'; return false; }
  $('#msg').textContent = ''; return true;
}
$('#start').onclick = async () => {
  if (!check()) return;
  if (!confirm('Start the exam now? This PC stays locked until time runs out or the invigilator enters the password.')) return;
  const r = await api.cmd('exam:start', cfg());
  if (!r.ok) $('#msg').textContent = r.error || 'Could not start.';
};
$('#save').onclick = async () => {
  if (!check()) return;
  const r = await api.cmd('exam:save-file', cfg());
  $('#msg').style.color = r.ok ? 'var(--ok)' : '';
  $('#msg').textContent = r.ok ? `Saved: ${r.file}` : (r.error || '');
};
$('#open').onclick = async () => { const r = await api.cmd('exam:open-file'); if (r && r.error) $('#msg').textContent = r.error; };
api.cmd('exam:logs').then(logs => {
  if (!logs.length) return;
  $('#logs').innerHTML = `<table><tr><th>Exam</th><th>Started</th><th>Ended</th><th>By</th><th>Left window</th><th>Blocked</th><th>Wrong passwords</th></tr>${logs.map(l => `<tr><td>${esc(l.title)}</td><td>${esc(new Date(l.started).toLocaleString())}</td><td>${esc(l.ended ? new Date(l.ended).toLocaleTimeString() : '')}</td><td>${esc(l.endedBy || '')}</td><td>${l.leftWindow.length}</td><td>${l.blocked.length}</td><td>${l.wrongPasswords}</td></tr>`).join('')}</table>`;
});
