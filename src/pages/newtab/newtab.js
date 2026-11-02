'use strict';
const { icon, esc, faviconHtml, hostOf, $ } = FK;
const api = window.ferna;
$('#sicon').innerHTML = icon('search');
$('#f').onsubmit = e => { e.preventDefault(); const v = $('#q').value.trim(); if (v) api.cmd('nav:go', v); };
document.querySelectorAll('[data-run]').forEach(b => { b.onclick = () => api.cmd('run', b.dataset.run); });

api.cmd('newtab:data').then(d => {
  $('#q').placeholder = `Search with ${d.engine} or enter an address`;
  if (d.theme) {
    const v = d.theme.vars;
    const b = document.body.style;
    if (v['--th-ntp-bg']) b.background = v['--th-ntp-bg'];
    if (d.theme.images.theme_ntp_background) {
      b.backgroundImage = `url("${d.theme.images.theme_ntp_background}")`;
      b.backgroundPosition = d.theme.ntp.alignment.replace(/\b(top|bottom|left|right|center)\b/g, '$1');
      b.backgroundRepeat = d.theme.ntp.repeat;
      b.backgroundSize = d.theme.ntp.repeat === 'no-repeat' ? 'cover' : 'auto';
      b.backgroundAttachment = 'fixed';
    }
    if (v['--th-ntp-text']) {
      const r = document.documentElement.style;
      r.setProperty('--ink', v['--th-ntp-text']);
      r.setProperty('--ink-3', v['--th-ntp-text']);
      document.body.classList.add('themed');
    }
  }
  if (d.workspace) $('#ws').innerHTML = `<span class="dot" style="--c:${esc(d.workspace.color)}"></span>Workspace: ${esc(d.workspace.name)}`;
  let html = '';
  if (d.private) {
    html += `<p class="private-note"><strong>Private window.</strong> Pages you visit here are not saved to history, cookies and site data are erased when you close the window, and nothing is written to disk. Downloads and bookmarks you make are kept. Your network provider and the sites themselves can still see your visits.</p>`;
  }
  const tiles = [];
  (d.workspace ? d.workspace.pinned : []).forEach(p => tiles.push(p));
  d.common.forEach(c => tiles.push(c));
  if (tiles.length) {
    html += `<h3>${d.workspace ? `${esc(d.workspace.name)} and common sites` : 'Common sites'}</h3><div class="tiles">` +
      tiles.slice(0, 24).map(t => `<button class="tile" data-url="${esc(t.url)}" title="${esc(t.url)}"><span class="ic">${faviconHtml(t.url, '')}</span><span class="t">${esc(t.title || hostOf(t.url))}</span></button>`).join('') + '</div>';
  }
  if (d.recent.length) {
    html += '<h3>Recently visited</h3><div class="recent">' +
      d.recent.map(h => `<button data-url="${esc(h.url)}">${faviconHtml(h.url, '')}<span class="t">${esc(h.title || h.url)}</span><span class="h">${esc(hostOf(h.url))}</span></button>`).join('') + '</div>';
  }
  $('#extra').innerHTML = html;
  $('#extra').style.display = 'contents';
});
document.addEventListener('click', e => { const b = e.target.closest('[data-url]'); if (b) api.cmd('nav:go', b.dataset.url); });
