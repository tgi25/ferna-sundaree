'use strict';
// Ferna Feeds page: streams, coverage cards, reader view, daily digest and feed management.
// Works as a full page (ferna://feeds/) and as the side panel (?panel=1). Saved articles are kept
// in IndexedDB (this page's own storage) so they can be read offline.
const { $, $$, esc, icon, hostOf } = FK;
const api = window.ferna;
const PANEL = new URLSearchParams(location.search).has('panel');
document.body.classList.toggle('panel', PANEL);

const CAT_COLOR = { local: '#16a34a', global: '#2563eb', research: '#9333ea', tech: '#ea580c' };
const state = { view: 'list', stream: 'all', channel: '', sort: 'smart', unread: false, showHidden: false, search: '', info: null, data: null, readerId: null };

// ---------- small helpers ----------
function ago(t) {
  if (!t) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString();
}
let toastT = null;
function toast(text) {
  let t = $('.toastx');
  if (!t) { t = document.createElement('div'); t.className = 'toastx'; document.body.append(t); }
  t.textContent = text; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3000);
}
const label = c => (state.info && state.info.labels[c]) || c;

// ---------- offline store (IndexedDB) ----------
const DB = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('ferna-feeds', 1);
    r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains('articles')) db.createObjectStore('articles', { keyPath: 'id' }); if (!db.objectStoreNames.contains('lists')) db.createObjectStore('lists', { keyPath: 'key' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (store, mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction(store, mode); const s = t.objectStore(store); const out = fn(s); t.oncomplete = () => res(out && out.result); t.onerror = () => rej(t.error); }); };
  return {
    get: (store, key) => tx(store, 'readonly', s => s.get(key)).catch(() => null),
    put: (store, val) => tx(store, 'readwrite', s => s.put(val)).catch(() => null),
    del: (store, key) => tx(store, 'readwrite', s => s.delete(key)).catch(() => null),
  };
})();

// ---------- reader: make an article readable, safely ----------
const ALLOWED = new Set(['P', 'A', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'EM', 'STRONG', 'B', 'I', 'U', 'BR', 'HR', 'IMG', 'FIGURE', 'FIGCAPTION', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'SPAN', 'DIV', 'SUP', 'SUB', 'SMALL', 'DL', 'DT', 'DD', 'SECTION', 'ARTICLE']);
/** Keep text, structure, links and images only: no scripts, styles, forms, frames or handlers. */
function sanitize(html, base) {
  const doc = new DOMParser().parseFromString(`<div id="r">${html}</div>`, 'text/html');
  const root = doc.getElementById('r');
  const walk = node => {
    for (const el of [...node.children]) {
      if (!ALLOWED.has(el.tagName)) { if (/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|FORM|INPUT|BUTTON|TEXTAREA|SELECT|NOSCRIPT|SVG|MATH|LINK|META|BASE|TEMPLATE|CANVAS|VIDEO|AUDIO)$/.test(el.tagName)) { el.remove(); continue; } el.replaceWith(...el.childNodes); continue; }
      for (const a of [...el.attributes]) {
        const n = a.name.toLowerCase();
        const keep = (el.tagName === 'A' && n === 'href') || (el.tagName === 'IMG' && (n === 'src' || n === 'alt')) || ((el.tagName === 'TD' || el.tagName === 'TH') && (n === 'colspan' || n === 'rowspan'));
        if (!keep) el.removeAttribute(a.name);
      }
      if (el.tagName === 'A') { try { const u = new URL(el.getAttribute('href') || '', base); if (/^https?:$/.test(u.protocol)) el.setAttribute('href', u.href); else el.removeAttribute('href'); } catch { el.removeAttribute('href'); } }
      if (el.tagName === 'IMG') { try { const u = new URL(el.getAttribute('src') || '', base); if (/^https?:$/.test(u.protocol)) { el.setAttribute('src', u.href); el.setAttribute('loading', 'lazy'); el.setAttribute('referrerpolicy', 'no-referrer'); } else el.remove(); } catch { el.remove(); } }
      walk(el);
    }
  };
  walk(root);
  return root.innerHTML;
}
/** Fetch the article (through the browser) and extract its main text with Readability. */
async function readable(id) {
  const cached = await DB.get('articles', id);
  if (cached && cached.html) return { ...cached, offline: true };
  const r = await api.cmd('feeds:article', id);
  if (!r || !r.ok) throw new Error((r && r.error) || 'Could not load the article.');
  const doc = new DOMParser().parseFromString(r.html, 'text/html');
  const baseEl = doc.createElement('base'); baseEl.href = r.url; doc.head.prepend(baseEl);
  let art = null;
  try { art = new Readability(doc, { charThreshold: 300, keepClasses: false }).parse(); } catch { art = null; }
  if (!art || !art.content) throw new Error('This page could not be made readable. Open the original instead.');
  // The headline is shown above; drop Readability's copy of it at the top of the text.
  const tmp = new DOMParser().parseFromString(`<div>${sanitize(art.content, r.url)}</div>`, 'text/html').body.firstChild;
  const h = tmp.querySelector('h1, h2');
  if (h && !h.previousElementSibling && h.textContent.trim().slice(0, 40) === String(art.title || '').trim().slice(0, 40)) h.remove();
  const out = { id, html: tmp.innerHTML, text: String(art.textContent || '').trim(), title: art.title || '', byline: art.byline || '', site: art.siteName || hostOf(r.url), url: r.url, at: Date.now() };
  api.cmd('feeds:fulltext', id, out.text.slice(0, 60000)).catch(() => {});
  return out;
}

// ---------- streams ----------
function renderStreams() {
  const counts = (state.data && state.data.counts) || {};
  const ch = (state.info && state.info.prefs.channels) || [];
  const st = (key, name, n, color) => `<button class="st${state.stream === key && !state.channel ? ' on' : ''}" data-stream="${key}">${color ? `<span class="dot" style="--c:${color}"></span>` : icon(key === 'saved' ? 'star' : 'feeds')}<span>${esc(name)}</span>${n ? `<span class="n">${n}</span>` : ''}</button>`;
  $('#streams').innerHTML =
    st('all', 'All', counts.all) +
    ['local', 'global', 'research', 'tech'].map(c => st(c, label(c), counts[c], CAT_COLOR[c])).join('') +
    st('saved', 'Saved', counts.saved) +
    (ch.length ? `<div class="st-label">Your channels</div>${ch.map(c => `<button class="st${state.channel === c.id ? ' on' : ''}" data-channel="${esc(c.id)}">${icon('tag')}<span>${esc(c.name)}</span></button>`).join('')}` : '');
}
$('#streams').addEventListener('click', e => {
  const b = e.target.closest('.st');
  if (!b) return;
  if (b.dataset.channel) { state.channel = b.dataset.channel; state.stream = 'all'; } else { state.channel = ''; state.stream = b.dataset.stream; }
  show('list');
  load();
});

// ---------- list ----------
async function load({ keepScroll = false } = {}) {
  const q = { category: state.stream === 'saved' ? 'all' : state.stream, saved: state.stream === 'saved', channel: state.channel, search: state.search, unreadOnly: state.unread, showHidden: state.showHidden, sort: state.sort, limit: 250 };
  const key = JSON.stringify(q);
  if (!state.data) { const c = await DB.get('lists', key); if (c && c.data) { state.data = c.data; render(); } } // fast first paint
  const data = await api.cmd('feeds:list', q);
  state.data = data;
  DB.put('lists', { key, data, at: Date.now() });
  const top = $('#cards').scrollTop;
  render();
  if (keepScroll) $('#cards').scrollTop = top;
}
function cardHtml(c) {
  const srcNames = [...new Set(c.sources.map(s => s.feed).filter(Boolean))];
  const cov = c.sources.length > 1 ? `<span class="cov" title="${esc(srcNames.join(', '))}">${c.sources.length} sources</span>` : '';
  const aiBtn = state.info && state.info.prefs.aiReady && !c.ai ? `<button class="a" data-act="ai" title="Write a summary with your AI model">${icon('sparkle')} AI summary</button>` : '';
  return `<article class="fc${c.read ? ' read' : ''}" data-id="${esc(c.id)}" style="--c:${CAT_COLOR[c.category] || 'var(--ink-3)'}">
    <div class="meta"><span class="cat">${esc(label(c.category))}</span><span>${esc(srcNames.slice(0, 2).join(' · '))}${srcNames.length > 2 ? ` +${srcNames.length - 2}` : ''}</span>${cov}<span>${esc(ago(c.date))}</span></div>
    <h3 data-act="read">${esc(c.title)}</h3>
    ${c.image ? `<img class="thumb" src="${esc(c.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
    <p class="sum">${c.ai ? '<span class="ai">AI</span>' : ''}${esc(c.summary || '')}</p>
    ${c.tags && c.tags.length ? `<div class="tags">${c.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
    <div class="acts">
      <button class="a${c.saved ? ' on' : ''}" data-act="save" title="${c.saved ? 'Saved (kept for offline reading)' : 'Save (and keep for offline reading)'}">${icon('star')} ${c.saved ? 'Saved' : 'Save'}</button>
      <button class="a" data-act="toggle-read" title="${c.read ? 'Mark unread' : 'Mark read'}">${icon('check')} ${c.read ? 'Unread' : 'Read'}</button>
      <button class="a" data-act="open" title="Open the original page">${icon('link')} Open</button>
      ${aiBtn}
      ${c.sources.length > 1 ? `<button class="a" data-act="sources" title="All reports of this story">${icon('layers')} ${c.sources.length}</button>` : ''}
    </div>
  </article>`;
}
function render() {
  renderStreams();
  const d = state.data;
  if (!d) return;
  const none = !state.info || !state.info.feeds.length;
  const hc = d.hiddenCount;
  $('#hidden-note').innerHTML = hc && !state.showHidden ? `${hc} low-relevance hidden · <button id="show-hidden">Show</button>` : state.showHidden && hc ? `<button id="show-hidden">Hide low-relevance again</button>` : '';
  if (none) {
    $('#cards').innerHTML = `<div class="welcome"><h2>Your news and research in one place</h2><p>Follow sites with the <b>RSS button</b> in the address bar, or start with a few well-known feeds.</p><p><button class="btn primary" id="w-start">Choose feeds</button></p></div>`;
    return;
  }
  $('#cards').innerHTML = d.cards.length ? d.cards.map(cardHtml).join('') : `<div class="empty">${state.search ? 'Nothing matches your search.' : state.unread ? 'All read here.' : 'Nothing here yet. New items arrive as your feeds update.'}</div>`;
}
$('#bar').addEventListener('click', e => {
  if (e.target.id === 'show-hidden') { state.showHidden = !state.showHidden; load(); }
  const s = e.target.closest('[data-sort]');
  if (s) { state.sort = s.dataset.sort; $$('#sort button').forEach(b => b.classList.toggle('on', b === s)); load(); }
});
$('#unread').onchange = e => { state.unread = e.target.checked; load(); };
$('#b-allread').onclick = async () => { await api.cmd('feeds:all-read', state.stream === 'saved' ? 'all' : state.stream); load(); };
let qT = null;
$('#q').addEventListener('input', e => { clearTimeout(qT); qT = setTimeout(() => { state.search = e.target.value.trim(); show('list'); load(); }, 220); });

// Pictures that fail to load are removed (no inline handlers: the page's security policy forbids them).
document.addEventListener('error', e => { if (e.target && e.target.tagName === 'IMG' && e.target.closest('.fc, .rd')) e.target.remove(); }, true);
$('#cards').addEventListener('click', async e => {
  if (e.target.id === 'w-start') { show('manage'); return; }
  const card = e.target.closest('.fc');
  if (!card) return;
  const id = card.dataset.id;
  const c = state.data.cards.find(x => x.id === id);
  const src = e.target.closest('[data-src]');
  if (src) { e.preventDefault(); api.cmd('feeds:opened', src.dataset.src); api.cmd('feeds:open-url', src.dataset.link); return; }
  const act = (e.target.closest('[data-act]') || {}).dataset?.act;
  if (!act || !c) return;
  if (act === 'read') openReader(id);
  else if (act === 'open') { api.cmd('feeds:opened', id); api.cmd('feeds:open-url', c.link); load({ keepScroll: true }); }
  else if (act === 'save') {
    await api.cmd('feeds:save', id, !c.saved);
    if (!c.saved) readable(id).then(a => DB.put('articles', { ...a, saved: true })).catch(() => {}); // keep for offline
    else DB.del('articles', id);
    load({ keepScroll: true });
  } else if (act === 'toggle-read') { await api.cmd('feeds:read', c.sources.map(s => s.id), !c.read); load({ keepScroll: true }); }
  else if (act === 'ai') {
    const b = e.target.closest('[data-act]'); b.disabled = true; b.innerHTML = `${icon('sparkle')} Writing…`;
    const r = await api.cmd('feeds:ai-summary', id);
    if (!r.ok) toast(r.error); load({ keepScroll: true });
  } else if (act === 'sources') {
    const ex = card.querySelector('.srcs');
    if (ex) { ex.remove(); return; }
    card.insertAdjacentHTML('beforeend', `<ul class="srcs">${c.sources.map(s => `<li><span class="f">${esc(s.feed)}</span><a data-src="${esc(s.id)}" data-link="${esc(s.link)}" href="#">${esc(s.title)}</a> <span class="muted">${esc(ago(s.date))}</span></li>`).join('')}</ul>`);
  }
});

// ---------- reader ----------
async function openReader(id) {
  state.readerId = id;
  show('reader');
  const it = await api.cmd('feeds:item', id);
  api.cmd('feeds:opened', id);
  if (!it) { $('#reader').innerHTML = '<div class="rd"><p class="note">This item is no longer here.</p></div>'; return; }
  const aiReady = state.info && state.info.prefs.aiReady;
  const top = `<div class="rd-top"><button class="btn small" id="r-back">← Back</button><span class="grow"></span>
    <button class="btn small" id="r-save">${it.saved ? '★ Saved' : '☆ Save for offline'}</button>
    ${aiReady && !it.aiSummary ? '<button class="btn small" id="r-ai">✦ AI summary</button>' : ''}
    <button class="btn small primary" id="r-open">Open original</button></div>`;
  const head = `<h1>${esc(it.title)}</h1><div class="by">${esc(it.feed || '')}${it.author ? ` · ${esc(it.author)}` : ''} · ${esc(ago(it.date))} · <span style="color:${CAT_COLOR[it.category]}">${esc(label(it.category))}</span></div>
    <div class="box" id="r-sum"><b>${it.aiSummary ? 'AI summary' : 'Summary'}</b>${esc(it.aiSummary || it.summary || '')}</div>`;
  $('#reader').innerHTML = `<div class="rd">${top}${head}<div class="body" id="r-body"><p class="note">Loading the full article…</p></div></div>`;
  $('#r-back').onclick = () => { show('list'); load({ keepScroll: true }); };
  $('#r-open').onclick = () => api.cmd('feeds:open-url', it.link);
  $('#r-save').onclick = async () => { const s = !it.saved; await api.cmd('feeds:save', id, s); it.saved = s; $('#r-save').textContent = s ? '★ Saved' : '☆ Save for offline'; if (s) readable(id).then(a => DB.put('articles', { ...a, saved: true })).catch(() => {}); else DB.del('articles', id); };
  if ($('#r-ai')) $('#r-ai').onclick = async () => { $('#r-ai').disabled = true; $('#r-ai').textContent = '✦ Writing…'; const r = await api.cmd('feeds:ai-summary', id); if (r.ok) $('#r-sum').innerHTML = `<b>AI summary</b>${esc(r.text)}`; else toast(r.error); $('#r-ai').remove(); };
  try {
    const a = await readable(id);
    if (state.readerId !== id) return;
    $('#r-body').innerHTML = `${a.offline ? '<p class="note">Saved copy (works offline).</p>' : ''}${a.html}`;
  } catch (err) {
    if (state.readerId !== id) return;
    $('#r-body').innerHTML = `<p class="note">${esc(err.message)}</p>${it.text ? `<p>${esc(it.text).replace(/\n/g, '</p><p>')}</p>` : ''}`;
  }
}
// Links inside the reader open in a tab.
$('#reader').addEventListener('click', e => { const a = e.target.closest('.body a[href]'); if (a) { e.preventDefault(); api.cmd('feeds:open-url', a.href); } });

// ---------- digest ----------
async function openDigest(fresh = false) {
  show('digest');
  $('#digest').innerHTML = '<div class="rd dg"><p class="note">Making your digest…</p></div>';
  const d = await api.cmd('feeds:digest', fresh);
  const aiReady = state.info && state.info.prefs.aiReady;
  const li = c => `<li><a data-id="${esc(c.id)}">${esc(c.title)}</a><div class="s">${esc(c.summary || '')}</div><div class="m">${esc(c.sources.map(s => s.feed).filter((v, i, a) => v && a.indexOf(v) === i).join(' · '))} · ${esc(ago(c.date))}${c.sources.length > 1 ? ` · ${c.sources.length} sources` : ''}</div></li>`;
  const sec = (title, list) => list && list.length ? `<h2>${esc(title)}</h2><ol>${list.map(li).join('')}</ol>` : '';
  const take = d.takeaways ? `<div class="box"><b>Key takeaways (AI)</b><div class="take">${esc(d.takeaways)}</div></div>` : aiReady ? '<p><button class="btn small" id="d-ai">✦ Write key takeaways with AI</button></p>' : '';
  $('#digest').innerHTML = `<div class="rd dg"><div class="rd-top"><button class="btn small" id="d-back">← Back</button><span class="grow"></span><button class="btn small" id="d-new">Make it again</button></div>
    <h1>Today's digest</h1><div class="by">${esc(new Date(d.made).toLocaleString())} · ${d.unread} unread</div>${take}
    ${sec('Breaking: covered by several sources', d.breaking)}${sec('Top research papers', d.research)}
    ${['local', 'global', 'tech'].map(c => sec(label(c), d.streams[c])).join('')}
    ${!d.breaking.length && !d.research.length && !Object.values(d.streams).some(x => x.length) ? '<p class="note">Nothing new in the last day and a half. Add feeds or check back later.</p>' : ''}</div>`;
  $('#d-back').onclick = () => show('list');
  $('#d-new').onclick = () => openDigest(true);
  if ($('#d-ai')) $('#d-ai').onclick = async () => { $('#d-ai').disabled = true; $('#d-ai').textContent = '✦ Writing…'; const r = await api.cmd('feeds:takeaways'); if (!r.ok) toast(r.error); openDigest(false); };
  $('#digest').onclick = e => { const a = e.target.closest('a[data-id]'); if (a) openReader(a.dataset.id); };
}

// ---------- manage ----------
async function openManage() {
  show('manage');
  state.info = await api.cmd('feeds:info');
  const { feeds, starters, prefs } = state.info;
  const subscribed = new Set(feeds.map(f => f.url));
  const catSel = (id, v) => `<select class="field" data-cat="${esc(id)}">${['local', 'global', 'research', 'tech'].map(c => `<option value="${c}"${c === v ? ' selected' : ''}>${esc(label(c))}</option>`).join('')}</select>`;
  const rows = feeds.map(f => `<tr><td><div class="t" title="${esc(f.title)}">${f.type === 'scrape' ? '🔎 ' : ''}${esc(f.title)}</div><div class="u">${esc(f.url)}</div>${f.lastError ? `<div class="err">⚠ ${esc(f.lastError)}</div>` : ''}</td>
    <td>${catSel(f.id, f.category)}</td><td class="hide-p muted">${f.items} items${f.unread ? ` · ${f.unread} new` : ''}<br>${f.lastFetch ? `checked ${esc(ago(f.lastFetch))}` : 'not checked yet'}</td>
    <td><button class="btn small" data-pause="${esc(f.id)}">${f.paused ? 'Resume' : 'Pause'}</button> <button class="btn small danger" data-unsub="${esc(f.id)}">Remove</button></td></tr>`).join('');
  const s = prefs.settings;
  $('#manage').innerHTML = `<div class="mg">
    <div class="rd-top"><button class="btn small" id="m-back">← Back</button><span class="grow"></span><button class="btn small" id="m-imp">Import OPML…</button><button class="btn small" id="m-exp">Export OPML…</button></div>
    <h2>Follow a feed or a site</h2>
    <div class="addrow"><input class="field" id="m-url" placeholder="Feed or site address, e.g. https://www.adaderana.lk/rss.php"><button class="btn primary" id="m-add">Follow</button></div>
    <p class="muted">A site address is enough: Ferna finds its feed. A site without a feed can be followed too — new links on the page become items.</p>
    <h2>Your feeds (${feeds.length})</h2>
    ${feeds.length ? `<table class="fl">${rows}</table>` : '<p class="muted">None yet.</p>'}
    <h2>Starter packs</h2>
    <div class="packs">${['local', 'global', 'research', 'tech'].map(c => `<div class="pack"><h3 style="color:${CAT_COLOR[c]}">${esc(label(c))}</h3>${starters[c].map(([n, u]) => `<label><input type="checkbox" data-pack="${c}" value="${esc(u)}" data-name="${esc(n)}"${subscribed.has(u) ? ' checked disabled' : ''}> ${esc(n)}</label>`).join('')}<button class="btn small" data-addpack="${c}">Add ticked</button></div>`).join('')}</div>
    <h2>What matters to you</h2>
    <p class="muted">Your interests, one per line or separated by commas. Items close to them come first (matched by meaning of the words, not only exact words).</p>
    <textarea class="field" id="m-int" rows="3" placeholder="machine learning, natural language processing, Sri Lanka economy, swarm intelligence">${esc(prefs.interests)}</textarea>
    ${prefs.learnedTerms.length ? `<p class="muted">Learned from what you read: <span class="chips">${prefs.learnedTerms.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</span> <button class="btn small" id="m-forget">Forget</button></p>` : ''}
    <h2>Filters</h2>
    <p class="muted">One rule per line: <code>+word</code> brings matching items up, <code>-word</code> hides them; <code>/regular expression/</code> works too (e.g. <code>-/horoscope|gossip/</code>).</p>
    <textarea class="field" id="m-rules" rows="4" placeholder="+machine learning&#10;+IMF&#10;-celebrity&#10;-/cricket|IPL/">${esc(prefs.rules)}</textarea>
    <div class="row"><div class="grow">Hide low-relevance items<div class="hint">Needs some interests above. Hidden items stay in search and can be shown with one click.</div></div><label class="switch"><input type="checkbox" id="m-hide"${s.hideLow ? ' checked' : ''}><span></span></label></div>
    <div class="row"><div class="grow">How strict<div class="hint">Higher hides more.</div></div><input type="range" id="m-th" min="0.02" max="0.4" step="0.02" value="${s.threshold}"></div>
    <div class="row"><div class="grow">Check feeds every</div><select class="field" id="m-int-min">${[15, 30, 60, 180, 360].map(m => `<option value="${m}"${m === s.interval ? ' selected' : ''}>${m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? 's' : ''}`}</option>`).join('')}</select></div>
    <div class="row"><div class="grow">Daily digest from<div class="hint">The digest is made at the first check after this hour.</div></div><select class="field" id="m-dh">${Array.from({ length: 24 }, (_, h) => `<option value="${h}"${h === s.digestHour ? ' selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select></div>
    <div class="row"><div class="grow">AI summaries and takeaways<div class="hint">${prefs.aiReady ? 'Uses the AI model set up in the assistant.' : 'Set up a model in the assistant (✦ button) first. Without it, summaries are made on this PC.'}</div></div><label class="switch"><input type="checkbox" id="m-ai"${s.aiSummaries ? ' checked' : ''}><span></span></label></div>
    <h2>Your channels</h2>
    <p class="muted">A channel collects items by keywords (same rules as filters, <code>+</code> lines) and/or from chosen feeds, e.g. “Thesis: swarm intelligence”.</p>
    <div id="m-chans">${prefs.channels.map(chanHtml).join('')}</div>
    <button class="btn small" id="m-addchan">New channel</button>
    <p style="margin-top:20px"><button class="btn primary" id="m-saveprefs">Save interests, filters and channels</button></p>
  </div>`;
  wireManage();
}
function chanHtml(c) {
  const feeds = (state.info && state.info.feeds) || [];
  return `<div class="chan" data-chan="${esc(c.id || '')}"><input class="field" data-k="name" placeholder="Channel name" value="${esc(c.name || '')}">
    <textarea class="field" data-k="keywords" rows="2" placeholder="+particle swarm&#10;+ant colony">${esc(c.keywords || '')}</textarea>
    <div class="chips">${feeds.map(f => `<label class="chip"><input type="checkbox" data-feed="${esc(f.id)}"${(c.feeds || []).includes(f.id) ? ' checked' : ''}> ${esc(f.title)}</label>`).join('')}</div>
    <div><button class="btn small danger" data-delchan>Delete channel</button></div></div>`;
}
function wireManage() {
  $('#m-back').onclick = () => { show('list'); load(); };
  const add = async () => {
    const url = $('#m-url').value.trim();
    if (!url) return;
    $('#m-add').disabled = true;
    let r = await api.cmd('feeds:subscribe', /^https?:/i.test(url) ? url : `https://${url}`, { type: 'rss' });
    if (!r.ok && r.code === 'NOFEED' && confirm(`${r.error}\n\nFollow the page itself? New links on it will become items.`)) r = await api.cmd('feeds:subscribe', /^https?:/i.test(url) ? url : `https://${url}`, { type: 'scrape' });
    $('#m-add').disabled = false;
    if (r.ok) { toast(`Following “${r.feed.title}” (${label(r.feed.category)})`); openManage(); } else if (r.error) toast(r.error);
  };
  $('#m-add').onclick = add;
  $('#m-url').onkeydown = e => { if (e.key === 'Enter') add(); };
  $('#m-imp').onclick = async () => { const r = await api.cmd('feeds:opml-import'); if (r.ok) { toast(`${r.added} of ${r.found} feeds added`); openManage(); } else if (r.error) toast(r.error); };
  $('#m-exp').onclick = async () => { const r = await api.cmd('feeds:opml-export'); if (r.ok) toast('Feeds exported'); };
  $('#manage').addEventListener('change', async e => {
    const c = e.target.closest('[data-cat]');
    if (c) { await api.cmd('feeds:update', c.dataset.cat, { category: c.value }); toast('Moved'); }
  });
  $('#manage').addEventListener('click', async e => {
    const t = e.target;
    if (t.dataset.unsub) { if (confirm('Stop following this feed? Its saved items are kept.')) { await api.cmd('feeds:unsubscribe', t.dataset.unsub); openManage(); } }
    else if (t.dataset.pause) { const f = state.info.feeds.find(x => x.id === t.dataset.pause); await api.cmd('feeds:update', f.id, { paused: !f.paused }); openManage(); }
    else if (t.dataset.addpack) {
      const boxes = $$(`input[data-pack="${t.dataset.addpack}"]:checked:not(:disabled)`);
      if (!boxes.length) { toast('Tick some feeds first'); return; }
      t.disabled = true; t.textContent = 'Adding…';
      let n = 0;
      for (const b of boxes) { const r = await api.cmd('feeds:subscribe', b.value, { type: 'rss', title: b.dataset.name, category: t.dataset.addpack }); if (r.ok) n++; else toast(`${b.dataset.name}: ${r.error}`); }
      toast(`${n} feed${n === 1 ? '' : 's'} added`); openManage();
    } else if (t.id === 'm-forget') { await api.cmd('feeds:set-prefs', { forgetLearned: true }); openManage(); }
    else if (t.id === 'm-addchan') { $('#m-chans').insertAdjacentHTML('beforeend', chanHtml({ id: `c${Date.now().toString(36)}`, name: '', keywords: '', feeds: [] })); }
    else if (t.hasAttribute('data-delchan')) { t.closest('.chan').remove(); }
    else if (t.id === 'm-saveprefs') {
      const channels = $$('.chan').map(el => ({ id: el.dataset.chan, name: el.querySelector('[data-k="name"]').value.trim() || 'Channel', keywords: el.querySelector('[data-k="keywords"]').value, feeds: $$('input[data-feed]:checked', el).map(x => x.dataset.feed) }));
      await api.cmd('feeds:set-prefs', { interests: $('#m-int').value, rules: $('#m-rules').value, hideLow: $('#m-hide').checked, threshold: Number($('#m-th').value), interval: Number($('#m-int-min').value), digestHour: Number($('#m-dh').value), aiSummaries: $('#m-ai').checked, channels });
      toast('Saved'); state.info = await api.cmd('feeds:info'); renderStreams();
    }
  });
}

// ---------- views and header ----------
function show(v) {
  state.view = v;
  for (const id of ['reader', 'digest', 'manage']) $(`#${id}`).hidden = v !== id;
  if (v !== 'reader') state.readerId = null;
  $('#b-digest').classList.toggle('on', v === 'digest');
  $('#b-manage').classList.toggle('on', v === 'manage');
  location.hash = v === 'list' ? '' : v;
}
$('#logo').innerHTML = icon('rss');
$('#s-ic').innerHTML = icon('search');
$('#b-refresh').innerHTML = icon('reload');
$('#b-digest').innerHTML = icon('calendar');
$('#b-manage').innerHTML = icon('edit');
$('#b-full').innerHTML = icon('right');
$('#b-close').innerHTML = icon('close');
$('#b-refresh').onclick = async () => {
  const b = $('#b-refresh'); b.classList.add('spin'); b.disabled = true;
  const r = await api.cmd('feeds:poll', true);
  b.classList.remove('spin'); b.disabled = false;
  toast(r && r.added ? `${r.added} new item${r.added === 1 ? '' : 's'}` : 'No new items');
  load({ keepScroll: true });
};
$('#b-digest').onclick = () => (state.view === 'digest' ? show('list') : openDigest());
$('#b-manage').onclick = () => (state.view === 'manage' ? (show('list'), load()) : openManage());
$('#b-full').onclick = () => api.cmd('feeds:open-page', state.view === 'list' ? '' : state.view);
$('#b-close').onclick = () => api.cmd('feeds:close-panel');
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && state.view !== 'list') { show('list'); load({ keepScroll: true }); }
  if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') { e.preventDefault(); $('#q').focus(); }
});

let refreshT = null;
api.on('refresh', m => {
  if (m && m.show === 'digest') { openDigest(); return; }
  clearTimeout(refreshT);
  refreshT = setTimeout(async () => { state.info = await api.cmd('feeds:info'); if (state.view === 'list') load({ keepScroll: true }); else renderStreams(); }, 300);
});

(async () => {
  state.info = await api.cmd('feeds:info');
  const h = location.hash.slice(1);
  load(); // the streams and the list behind any other view
  if (h === 'digest') openDigest(); else if (h === 'manage') openManage(); else show('list');
})();
