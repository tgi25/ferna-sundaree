'use strict';
// Safety check panel: the current page (fake-site and scam warnings, the fact-check bubble for
// news articles) and a box to check a message you received.
const { $, esc, icon } = FK;
const api = window.ferna;
const PANEL = new URLSearchParams(location.search).has('panel');
document.body.classList.toggle('panel', PANEL);
$('#logo').innerHTML = icon('shield');
$('#b-rescan').innerHTML = icon('reload');
$('#b-close').innerHTML = icon('close');
$('#b-close').onclick = () => api.cmd('check:close-panel');

let st = null;
let lastUrl = '';
const covCache = new Map();

const list = arr => `<ul>${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
const ago = t => { if (!t) return ''; const d = (Date.now() - t) / 86400000; return d < 1 ? `${Math.max(1, Math.round(d * 24))} h ago` : `${Math.round(d)} d ago`; };
function results(cov) {
  const fc = cov.factChecks.map(r => `<li><span class="badge fc">Fact check</span><a data-u="${esc(r.link)}">${esc(r.title)}</a><span class="src">${esc(r.source || r.host)} · ${ago(r.date)}</span></li>`).join('');
  const rs = cov.results.map(r => `<li><span class="badge ${r.reliable ? 'rel' : ''}">${r.reliable ? 'Established' : 'Other site'}</span><a data-u="${esc(r.link)}">${esc(r.title)}</a><span class="src">${esc(r.source || r.host)} · ${ago(r.date)}</span></li>`).join('');
  return (fc ? `<h3>Fact-checks</h3><ul class="res">${fc}</ul>` : '') + (rs ? `<h3>Other coverage</h3><ul class="res">${rs}</ul>` : '');
}
document.addEventListener('click', e => { const a = e.target.closest('a[data-u]'); if (a) { e.preventDefault(); api.cmd('check:open-url', a.dataset.u); } });

async function runCoverage(box, text, host) {
  box.innerHTML = '<p class="muted"><span class="spin"></span>Looking for the same story in other news outlets…</p>';
  const key = `${text}|${host}`;
  const r = covCache.get(key) || await api.cmd('check:coverage', text, host || '');
  if (r.ok) covCache.set(key, r);
  if (!r.ok) { box.innerHTML = `<div class="card warn">${esc(r.error)}</div>`; return; }
  const cls = r.cov.factChecks.length ? 'warn' : r.cov.reliable >= 2 ? 'ok' : r.cov.reliable ? 'info' : 'warn';
  box.innerHTML = `<div class="card ${cls}"><span class="sum">${esc(r.line)}</span></div>${results(r.cov)}
    <p class="muted">Searched Google News for “${esc(r.cov.query)}” without cookies or your sign-in. Ferna shows the evidence; it does not decide what is true.</p>`;
}

function renderPage() {
  const box = $('#page');
  const c = st && st.check;
  const t = st && st.tab;
  if (!t || !/^https?:/.test(t.url || '')) { box.innerHTML = '<h2>This page</h2><p class="muted">Open a web page to check it.</p>'; return; }
  let h = `<h2>This page</h2><div class="host">${esc((c && c.host) || t.url)}</div>`;
  if (!c) { box.innerHTML = `${h}<p class="muted">Not checked yet.</p>`; return; }
  if (c.danger) {
    h += `<div class="card danger"><b class="t">This may be a fake ${esc(c.danger.org)} site</b>
      It looks like ${esc(c.danger.org)} and asks for your ${esc(c.danger.asks.join(', '))}, but ${esc(c.host)} is not ${esc(c.danger.org)}'s website. The official site is <b>${esc(c.danger.official)}</b>.
      <div class="row"><button class="btn primary" id="go-official">Go to ${esc(c.danger.official)}</button><button class="btn small" id="trust">I trust this site</button></div></div>`;
  } else if (c.insecure) {
    h += '<div class="card danger"><b class="t">Not a secure connection</b>This page asks for a password or card number over plain HTTP. Anyone on your network could read it.</div>';
  }
  if (c.scam && c.scam.length) h += `<div class="card danger"><b class="t">This page reads like a scam</b>${list(c.scam)}${c.danger ? '' : '<div class="row"><button class="btn small" id="trust">I trust this site</button></div>'}</div>`;
  if (c.article) {
    h += `<p class="headline">${esc(c.headline)}</p>`;
    if (c.claim && c.claim.length) h += `<div class="card warn"><b class="t">Worth checking</b>${list(c.claim)}</div>`;
    h += `<div id="cov">${st.private ? '<p class="muted">Searching other coverage is off in private windows.</p>' : '<div class="row"><button class="btn primary" id="cov-go">Who else reports this?</button></div><p class="muted">Sends the headline (not the page or who you are) to Google News search.</p>'}</div>
      <label class="chk"><input type="checkbox" id="auto" ${st.auto ? 'checked' : ''}> Search automatically on news articles</label>`;
  } else if (c.claim && c.claim.length) {
    h += `<div class="card warn"><b class="t">Worth checking</b>${list(c.claim)}</div>`;
  }
  if (!c.danger && !c.insecure && !(c.scam && c.scam.length) && !c.article && !(c.claim && c.claim.length)) h += '<div class="card ok">Nothing suspicious found on this page.</div>';
  box.innerHTML = h;
  const off = $('#go-official'); if (off) off.onclick = () => api.cmd('check:open-url', `https://www.${c.danger.official}/`);
  const tr = $('#trust'); if (tr) tr.onclick = async () => { await api.cmd('check:trust', c.host); load(); };
  const go = $('#cov-go'); if (go) go.onclick = () => runCoverage($('#cov'), c.headline, c.host);
  const au = $('#auto'); if (au) au.onchange = () => api.cmd('settings:set', 'factCheckAuto', au.checked);
  // Coverage already searched (automatic mode, or earlier in this panel): show it straight away.
  if (c.article && !st.private && (st.auto || covCache.has(`${c.headline}|${c.host}`))) runCoverage($('#cov'), c.headline, c.host);
}

async function checkMsg() {
  const text = $('#msg-text').value.trim();
  const out = $('#msg-out');
  if (!text) { out.innerHTML = ''; return; }
  const r = await api.cmd('check:message', text);
  const head = { danger: 'Very likely a scam. Do not click the links, reply or pay.', warn: 'Be careful: this message has warning signs.', ok: 'No common scam patterns found. Still, never share an OTP or PIN.' }[r.level];
  let h = `<div class="card ${r.level}"><b class="t">${esc(head)}</b>${r.scam.length ? list(r.scam) : ''}${r.claim.length ? list(r.claim) : ''}</div>`;
  if (r.links.length) h += `<h3>Links in the message</h3><div class="links">${r.links.map(l => `<div class="card ${l.bad ? 'danger' : l.official ? 'ok' : ''}"><div class="l">${esc(l.host)}</div>${l.notes.length ? list(l.notes) : l.official ? '<span class="muted">The official website of the organisation it names.</span>' : '<span class="muted">Nothing known against this address. Check it before signing in.</span>'}</div>`).join('')}</div>`;
  out.innerHTML = h;
}
$('#msg-go').onclick = checkMsg;
$('#msg-news').onclick = () => { const t = $('#msg-text').value.trim(); if (t) { $('#msg-out').innerHTML = '<div id="msg-cov"></div>'; runCoverage($('#msg-cov'), t.split(/(?<=[.!?।])\s/)[0].slice(0, 300), ''); } };
$('#msg-clear').onclick = () => { $('#msg-text').value = ''; $('#msg-out').innerHTML = ''; api.cmd('check:clear-pending'); };
$('#b-rescan').onclick = async () => { st = await api.cmd('check:rescan'); renderPage(); };

async function load() {
  st = await api.cmd('check:state');
  const url = st.check ? st.check.url : (st.tab && st.tab.url) || '';
  if (url !== lastUrl) covCache.clear();
  lastUrl = url; renderPage();
  if (st.pending) { $('#msg-text').value = st.pending; api.cmd('check:clear-pending'); checkMsg(); $('#msg').scrollIntoView({ block: 'start' }); }
}
let rT = null;
api.on('refresh', () => { clearTimeout(rT); rT = setTimeout(load, 120); });
load();
