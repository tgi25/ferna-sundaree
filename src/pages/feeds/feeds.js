'use strict';
// Ferna Feeds page: streams, coverage cards, reader view, daily digest and feed management.
// Works as a full page (ferna://feeds/) and as the side panel (?panel=1). Saved articles are kept
// in IndexedDB (this page's own storage) so they can be read offline.
const { $, $$, esc, icon, hostOf } = FK;
const api = window.ferna;
const PANEL = new URLSearchParams(location.search).has('panel');
document.body.classList.toggle('panel', PANEL);

const CAT_COLOR = { local: '#16a34a', global: '#2563eb', research: '#9333ea', tech: '#ea580c' };
const state = { view: 'list', stream: 'all', channel: '', feedId: '', sort: 'new', unread: true, history: false, showHidden: false, search: '', info: null, data: null, counts: null, readerId: null, focus: -1, expanded: new Set(), selected: new Set(), fromTab: false };
const V = () => ({ fontSize: 15, fontFamily: 'system', readWidth: 760, density: 'cards', images: true, openMode: 'reader', buttonOpens: 'panel', markRead: 'scroll', cluster: true, listSort: 'new', unreadOnly: true, digestFont: 17, digestZoom: 100, ...((state.info && state.info.prefs.settings) || {}) });
const FONTS = {
  system: ['System', ''], serif: ['Serif', "Georgia, 'Noto Serif', 'Noto Serif Sinhala', 'Times New Roman', serif"],
  sans: ['Sans serif', "'Segoe UI', Roboto, 'Noto Sans', 'Noto Sans Sinhala', Arial, sans-serif"], sinhala: ['Sinhala-friendly', "'Noto Sans Sinhala', 'Iskoola Pota', 'Nirmala UI', 'Segoe UI', sans-serif"],
  wide: ['Wide and easy (Verdana)', "Verdana, Tahoma, 'Noto Sans Sinhala', sans-serif"], mono: ['Monospace', "Consolas, 'Cascadia Mono', 'DejaVu Sans Mono', monospace"],
};
/** Font, size, reading width, layout and pictures: applied to the page as variables and classes. */
function applyView() {
  const v = V();
  const b = document.body;
  b.style.setProperty('--fs', `${v.fontSize}px`);
  b.style.setProperty('--rw', `${v.readWidth}px`);
  if (FONTS[v.fontFamily] && FONTS[v.fontFamily][1]) b.style.setProperty('--ff', FONTS[v.fontFamily][1]); else b.style.removeProperty('--ff');
  b.classList.toggle('d-compact', v.density === 'compact');
  b.classList.toggle('d-titles', v.density === 'titles');
  b.classList.toggle('noimg', !v.images);
}

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
  const counts = state.counts || (state.data && state.data.counts) || {};
  const ch = (state.info && state.info.prefs.channels) || [];
  const feeds = (state.info && state.info.feeds) || [];
  const cur = key => state.stream === key && !state.channel && !state.feedId;
  const st = (key, name, n, color) => `<button class="st${cur(key) ? ' on' : ''}" data-stream="${key}">${color ? `<span class="dot" style="--c:${color}"></span>` : icon(key === 'saved' ? 'star' : 'feeds')}<span class="nm">${esc(name)}</span>${n ? `<span class="n">${n}</span>` : ''}</button>`;
  $('#streams').innerHTML =
    st('all', 'All', counts.all) +
    ['local', 'global', 'research', 'tech'].map(c => st(c, label(c), counts[c], CAT_COLOR[c])).join('') +
    st('saved', 'Saved', counts.saved) +
    (ch.length ? `<div class="st-label">Your channels</div>${ch.map(c => `<button class="st${state.channel === c.id ? ' on' : ''}" data-channel="${esc(c.id)}">${icon('tag')}<span class="nm">${esc(c.name)}</span>${(counts.channels || {})[c.id] ? `<span class="n">${counts.channels[c.id]}</span>` : ''}</button>`).join('')}` : '') +
    (feeds.length ? `<div class="st-label">Feeds</div>${['local', 'global', 'research', 'tech'].map(cat => feeds.filter(f => f.category === cat).map(f => `<button class="st fd${state.feedId === f.id ? ' on' : ''}${f.paused ? ' paused' : ''}" data-feed="${esc(f.id)}" title="${esc(f.title)}${f.lastError ? ` — ⚠ ${esc(f.lastError)}` : ''}"><span class="dot sm" style="--c:${CAT_COLOR[cat]}"></span><span class="nm">${esc(f.title)}</span>${f.lastError ? '<span class="warn">⚠</span>' : ''}${(counts.feeds || {})[f.id] ? `<span class="n">${counts.feeds[f.id]}</span>` : ''}</button>`).join('')).join('')}` : '');
  // The panel has no room for the feed list: a drop-down instead.
  const pick = $('#feed-pick');
  pick.innerHTML = `<option value="">All feeds</option>${feeds.map(f => `<option value="${esc(f.id)}"${state.feedId === f.id ? ' selected' : ''}>${esc(f.title)}${(counts.feeds || {})[f.id] ? ` (${counts.feeds[f.id]})` : ''}</option>`).join('')}`;
  pick.hidden = !feeds.length;
}
function pickScope({ stream = 'all', channel = '', feedId = '' }) {
  state.stream = stream; state.channel = channel; state.feedId = feedId; state.focus = -1;
  show('list');
  load();
}
$('#streams').addEventListener('click', e => {
  const b = e.target.closest('.st');
  if (!b) return;
  if (b.dataset.feed) pickScope({ feedId: b.dataset.feed });
  else if (b.dataset.channel) pickScope({ channel: b.dataset.channel });
  else pickScope({ stream: b.dataset.stream });
});
$('#feed-pick').onchange = e => pickScope({ feedId: e.target.value });

// ---------- list ----------
async function load({ keepScroll = false } = {}) {
  const q = { category: state.stream === 'saved' || state.feedId ? 'all' : state.stream, saved: state.stream === 'saved', channel: state.channel, feedId: state.feedId, search: state.search, unreadOnly: state.unread, showHidden: state.showHidden, sort: state.sort, limit: 300, history: state.history };
  const key = JSON.stringify(q);
  if (!state.data) { const c = await DB.get('lists', key); if (c && c.data) { state.data = c.data; render(); } } // fast first paint
  const data = await api.cmd('feeds:list', q);
  state.data = data;
  DB.put('lists', { key, data, at: Date.now() });
  state.counts = data.counts;
  const top = $('#cards').scrollTop;
  render();
  if (keepScroll) $('#cards').scrollTop = top; else $('#cards').scrollTop = 0;
}
function cardHtml(c, i) {
  const srcNames = [...new Set(c.sources.map(s => s.feed).filter(Boolean))];
  const more = c.sources.length - 1;
  const aiBtn = state.info && state.info.prefs.aiReady && !c.ai ? `<button class="a" data-act="ai" title="Write a summary with your AI model">${icon('sparkle')} AI summary</button>` : '';
  const open = state.expanded.has(c.cluster);
  const others = c.sources.slice(1);
  const otherNames = [...new Set(others.map(s => s.feed).filter(Boolean))];
  // One story, several reports: the lead report, then "also reported by" (opens the list).
  const also = more > 0 ? `<button class="also" data-act="sources" aria-expanded="${open}" title="All reports of this story">${icon('layers')}<span>Also reported by <b>${esc(otherNames.slice(0, 3).join(', '))}</b>${otherNames.length > 3 ? ` and ${otherNames.length - 3} more` : ''}${otherNames.length < more ? ` (${more} reports)` : ''}</span><span class="chev">${open ? '▴' : '▾'}</span></button>` : '';
  const srcs = more > 0 && open ? srcList(c) : '';
  const readerBtn = V().openMode === 'reader' ? '' : `<button class="a" data-act="reader" title="Read it here, without clutter">${icon('book') || ''} Reader</button>`;
  return `<article class="fc${c.read ? ' read' : ''}${i === state.focus ? ' focus' : ''}" data-id="${esc(c.id)}" data-i="${i}" style="--c:${CAT_COLOR[c.category] || 'var(--ink-3)'}" tabindex="-1">
    <div class="meta"><span class="cat">${esc(label(c.category))}</span><span class="src">${esc(c.feed || srcNames[0] || '')}</span>${more > 0 ? `<span class="cov">${c.sources.length} sources</span>` : ''}<span>${esc(ago(c.date))}</span>${c.read ? '' : '<span class="new" title="Unread">●</span>'}${state.history && c.readAt ? `<span class="rdat" title="${esc(new Date(c.readAt).toLocaleString())}">read ${esc(ago(c.readAt))}</span>` : ''}</div>
    <h3 data-act="read"><a href="${esc(c.link || '#')}" data-act="read" tabindex="-1">${esc(c.title)}</a></h3>
    ${c.image ? `<img class="thumb" src="${esc(c.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
    <p class="sum">${c.ai ? '<span class="ai">AI</span>' : ''}${esc(c.summary || '')}</p>
    ${c.tags && c.tags.length ? `<div class="tags">${c.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
    ${also}${srcs}
    <div class="acts">
      <button class="a${c.saved ? ' on' : ''}" data-act="save" title="${c.saved ? 'Saved (kept for offline reading)' : 'Save (and keep for offline reading)'} (S)">${icon('star')} ${c.saved ? 'Saved' : 'Save'}</button>
      <button class="a" data-act="toggle-read" title="${c.read ? 'Mark unread' : 'Mark read'} (M)">${icon('check')} ${c.read ? 'Unread' : 'Read'}</button>
      ${readerBtn}
      <button class="a" data-act="open" title="Open the original page in a tab (V)">${icon('link')} Open</button>
      ${aiBtn}
    </div>
  </article>`;
}
function srcList(c) {
  return `<ul class="srcs">${c.sources.map((s, k) => `<li class="${s.read ? 'rd1' : ''}"><span class="f">${esc(s.feed)}</span>${k === 0 ? '<span class="lead">lead</span>' : ''}<a data-src="${esc(s.id)}" data-link="${esc(s.link)}" href="${esc(s.link || '#')}">${esc(s.title)}</a> <span class="muted">${esc(ago(s.date))}</span></li>`).join('')}</ul>`;
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
  const f = state.feedId && state.info.feeds.find(x => x.id === state.feedId);
  const sc = $('#scope');
  sc.hidden = !f && !state.history;
  document.body.classList.toggle('history', state.history);
  if (state.history) sc.innerHTML = `${icon('calendar')}<b>Reading history</b> <span class="muted">${d.total} item${d.total === 1 ? '' : 's'} you have read, the latest first${f ? ` · ${esc(f.title)}` : ''}</span><span class="grow"></span><button class="btn small" data-scope="unhistory">Back to the news</button>`;
  else if (f) sc.innerHTML = `<b>${esc(f.title)}</b> <span class="muted">${esc(f.url)}</span>${f.lastError ? ` <span class="err">⚠ ${esc(f.lastError)}</span>` : ''}<span class="grow"></span><button class="btn small" data-scope="check">Check now</button><button class="btn small" data-scope="all">Show all feeds</button>`;
  $('#cards').innerHTML = d.cards.length ? d.cards.map(cardHtml).join('') : `<div class="empty">${state.history ? 'Nothing read yet.' : state.search ? 'Nothing matches your search.' : state.unread ? 'All caught up here. <button class="btn small" data-scope="history">Show what you have read</button>' : 'Nothing here yet. New items arrive as your feeds update.'}</div>`;
  watchCards();
}
$('#scope').addEventListener('click', async e => {
  const b = e.target.closest('[data-scope]');
  if (!b) return;
  if (b.dataset.scope === 'all') pickScope({});
  else if (b.dataset.scope === 'unhistory' || b.dataset.scope === 'history') setHistory(b.dataset.scope === 'history');
  else { b.disabled = true; b.textContent = 'Checking…'; const r = await api.cmd('feeds:poll-feeds', [state.feedId]); toast(r && r.added ? `${r.added} new` : 'No new items'); load({ keepScroll: true }); }
});

// ---------- read as you go: scrolled past (or pointed at) items become read ----------
let io = null;
const queued = new Set();
let flushT = null;
function queueRead(card) {
  const c = state.data && state.data.cards.find(x => x.id === card.dataset.id);
  if (!c || c.read) return;
  c.read = true;
  card.classList.add('read');
  const dot = card.querySelector('.meta .new'); if (dot) dot.remove();
  for (const s of c.sources) { s.read = true; queued.add(s.id); }
  clearTimeout(flushT);
  flushT = setTimeout(flushRead, 350);
}
async function flushRead() {
  if (!queued.size) return;
  const ids = [...queued]; queued.clear();
  const counts = await api.cmd('feeds:read', ids, true, true);
  if (counts) { state.counts = counts; renderStreams(); }
}
function watchCards() {
  if (io) io.disconnect();
  if (V().markRead !== 'scroll') return;
  const root = $('#cards');
  io = new IntersectionObserver(entries => {
    for (const en of entries) {
      const card = en.target;
      if (en.isIntersecting) { card.dataset.seen = '1'; continue; }
      // It left the view at the top: you scrolled past it.
      if (card.dataset.seen && en.boundingClientRect.bottom <= (en.rootBounds ? en.rootBounds.top : 0) + 2) queueRead(card);
    }
  }, { root, threshold: 0 });
  for (const card of $$('.fc', root)) io.observe(card);
}
// At the very end of the list nothing scrolls past any more: what is fully in view there is read.
$('#cards').addEventListener('scroll', () => {
  if (V().markRead !== 'scroll') return;
  const root = $('#cards');
  if (root.scrollTop + root.clientHeight < root.scrollHeight - 4 || root.scrollTop < 40) return;
  const rb = root.getBoundingClientRect();
  for (const card of $$('.fc:not(.read)', root)) { const r = card.getBoundingClientRect(); if (r.top >= rb.top && r.bottom <= rb.bottom) queueRead(card); }
}, { passive: true });
// Pointing mode: an item you rest the pointer on for a second is read.
let hoverT = null;
$('#cards').addEventListener('mouseover', e => {
  if (V().markRead !== 'hover') return;
  const card = e.target.closest('.fc');
  clearTimeout(hoverT);
  if (card && !card.classList.contains('read')) hoverT = setTimeout(() => queueRead(card), 1000);
});
$('#cards').addEventListener('mouseleave', () => clearTimeout(hoverT));
$('#bar').addEventListener('click', e => {
  if (e.target.id === 'show-hidden') { state.showHidden = !state.showHidden; load(); }
  const s = e.target.closest('[data-sort]');
  if (s) { state.sort = s.dataset.sort; $$('#sort button').forEach(b => b.classList.toggle('on', b === s)); load(); api.cmd('feeds:set-prefs', { listSort: state.sort }); }
});
$('#unread').onchange = e => { state.unread = e.target.checked; load(); api.cmd('feeds:set-prefs', { unreadOnly: state.unread }); };
/** The list as you left it: Newest and Unread only unless you chose otherwise. */
function applyListPrefs() {
  const v = V();
  state.sort = v.listSort; state.unread = v.unreadOnly;
  $$('#sort button').forEach(b => b.classList.toggle('on', b.dataset.sort === state.sort));
  $('#unread').checked = state.unread;
}
const scopeQ = () => ({ feedId: state.feedId, channel: state.channel });
$('#b-allread').onclick = async () => { const n = await api.cmd('feeds:all-read', state.stream === 'saved' || state.feedId ? 'all' : state.stream, scopeQ()); toast(`${n} marked read`); load({ keepScroll: true }); };
$('#b-readmenu').onclick = e => { e.stopPropagation(); $('#readmenu').hidden = !$('#readmenu').hidden; };
document.addEventListener('click', e => { if (!e.target.closest('.mr')) $('#readmenu').hidden = true; if (!e.target.closest('#viewpop, #b-view')) $('#viewpop').hidden = true; if (!e.target.closest('#keys')) $('#keys').hidden = true; });
$('#readmenu').onclick = async e => {
  const b = e.target.closest('[data-older]');
  if (!b) return;
  $('#readmenu').hidden = true;
  const cat = state.stream === 'saved' || state.feedId ? 'all' : state.stream;
  let n = 0;
  if (b.dataset.older === 'above') {
    const root = $('#cards').getBoundingClientRect();
    const ids = [];
    for (const card of $$('#cards .fc')) { if (card.getBoundingClientRect().top >= root.top) break; const c = state.data.cards.find(x => x.id === card.dataset.id); if (c) ids.push(...c.sources.map(s => s.id)); }
    n = ids.length ? await api.cmd('feeds:all-read', 'all', { ids }) : 0;
  } else n = await api.cmd('feeds:all-read', cat, { ...scopeQ(), olderThan: Date.now() - Number(b.dataset.older) });
  toast(`${n} marked read`); load({ keepScroll: true });
};
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
  if (src) { e.preventDefault(); api.cmd('feeds:opened', src.dataset.src); api.cmd('feeds:open-url', src.dataset.link, e.ctrlKey || e.metaKey || e.button === 1); markCardRead(card, c); return; }
  const act = (e.target.closest('[data-act]') || {}).dataset?.act;
  if (!act || !c) return;
  e.preventDefault();
  state.focus = Number(card.dataset.i);
  if (act === 'read') openItem(c, card, { background: e.ctrlKey || e.metaKey });
  else if (act === 'reader') openReader(id);
  else if (act === 'open') { api.cmd('feeds:opened', id); api.cmd('feeds:open-url', c.link, e.ctrlKey || e.metaKey); markCardRead(card, c); }
  else if (act === 'save') {
    await api.cmd('feeds:save', id, !c.saved);
    if (!c.saved) readable(id).then(a => DB.put('articles', { ...a, saved: true })).catch(() => {}); // keep for offline
    else DB.del('articles', id);
    load({ keepScroll: true });
  } else if (act === 'toggle-read') { const counts = await api.cmd('feeds:read', c.sources.map(s => s.id), !c.read, true); c.read = !c.read; for (const s of c.sources) s.read = c.read; if (counts) state.counts = counts; rerenderCard(card, c); renderStreams(); }
  else if (act === 'ai') {
    const b = e.target.closest('[data-act]'); b.disabled = true; b.innerHTML = `${icon('sparkle')} Writing…`;
    const r = await api.cmd('feeds:ai-summary', id);
    if (!r.ok) toast(r.error); load({ keepScroll: true });
  } else if (act === 'sources') {
    if (state.expanded.has(c.cluster)) state.expanded.delete(c.cluster); else state.expanded.add(c.cluster);
    rerenderCard(card, c);
  }
});
$('#cards').addEventListener('click', e => { const b = e.target.closest('[data-scope="history"]'); if (b) setHistory(true); });
function setHistory(on) {
  state.history = on; state.focus = -1;
  $('#b-history').classList.toggle('on', on);
  $('#b-history').setAttribute('aria-pressed', String(on));
  load();
}
$('#b-history').onclick = () => setHistory(!state.history);
// Middle click on a headline or a source: a background tab.
$('#cards').addEventListener('auxclick', e => {
  if (e.button !== 1) return;
  const a = e.target.closest('h3 a, [data-src]');
  const card = e.target.closest('.fc');
  if (!a || !card) return;
  e.preventDefault();
  const c = state.data.cards.find(x => x.id === card.dataset.id);
  const link = a.dataset.link || (c && c.link);
  if (link) { api.cmd('feeds:opened', a.dataset.src || c.id); api.cmd('feeds:open-url', link, true); if (c) markCardRead(card, c); }
});
function rerenderCard(card, c) {
  const tmp = document.createElement('div');
  tmp.innerHTML = cardHtml(c, Number(card.dataset.i));
  const n = tmp.firstElementChild;
  card.replaceWith(n);
  if (io) io.observe(n);
  return n;
}
function markCardRead(card, c) {
  if (c.read) return;
  c.read = true; for (const s of c.sources) s.read = true;
  card.classList.add('read');
  const dot = card.querySelector('.meta .new'); if (dot) dot.remove();
  api.cmd('feeds:counts').then(x => { state.counts = x; renderStreams(); });
}
/** A headline was clicked: the reader here, the reader in a tab, or the original page (Display → Open items in). */
function openItem(c, card, { background = false } = {}) {
  const mode = background ? 'background' : V().openMode;
  if (mode === 'reader') { openReader(c.id); return; }
  api.cmd('feeds:opened', c.id);
  if (mode === 'reader-tab') api.cmd('feeds:open-page', `read/${c.id}`, true);
  else api.cmd('feeds:open-url', c.link, mode === 'background');
  if (card) markCardRead(card, c);
}

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
  $('#r-back').textContent = state.fromTab ? '← All items' : '← Back';
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
  const li = c => `<li><a data-id="${esc(c.id)}">${esc(c.title)}</a><div class="s">${esc(c.summary || '')}</div><div class="m">${esc([c.sources.map(s => s.feed).filter((v, i, a) => v && a.indexOf(v) === i).join(' · '), ago(c.date)].filter(Boolean).join(' · '))}${c.sources.length > 1 ? ` · ${c.sources.length} sources` : ''}</div></li>`;
  const sec = (title, list) => list && list.length ? `<h2>${esc(title)}</h2><ol>${list.map(li).join('')}</ol>` : '';
  const take = d.takeaways ? `<div class="box"><b>Key takeaways (AI)</b><div class="take">${esc(d.takeaways)}</div></div>` : aiReady ? '<p><button class="btn small" id="d-ai">✦ Write key takeaways with AI</button></p>' : '';
  const v = V();
  $('#digest').innerHTML = `<div class="rd dg" style="--dfs:${v.digestFont}px"><div class="rd-top"><button class="btn small" id="d-back">← Back</button><span class="grow"></span>
    <span class="dz" role="group" aria-label="Text size and zoom"><button class="btn small" data-dz="font-" title="Smaller text">A−</button><span class="dzv" id="dz-font" title="Text size">${v.digestFont}px</span><button class="btn small" data-dz="font+" title="Larger text">A+</button>
    <span class="sep"></span><button class="btn small" data-dz="zoom-" title="Zoom out (Ctrl+−)">−</button><span class="dzv" id="dz-zoom" title="Zoom">${v.digestZoom}%</span><button class="btn small" data-dz="zoom+" title="Zoom in (Ctrl++)">+</button><button class="btn small" data-dz="reset" title="Back to normal size (Ctrl+0)">Reset</button></span>
    <button class="btn small" id="d-new">Make it again</button></div><div class="dg-body" style="zoom:${v.digestZoom / 100}">
    <h1>Today's digest</h1><div class="by">${esc(new Date(d.made).toLocaleString())} · ${d.unread} unread</div>${take}
    ${sec('Breaking: covered by several sources', d.breaking)}${sec('Top research papers', d.research)}
    ${['local', 'global', 'tech'].map(c => sec(label(c), d.streams[c])).join('')}
    ${!d.breaking.length && !d.research.length && !Object.values(d.streams).some(x => x.length) ? '<p class="note">Nothing new in the last day and a half. Add feeds or check back later.</p>' : ''}</div></div>`;
  $('#d-back').onclick = () => show('list');
  $('#d-new').onclick = () => openDigest(true);
  $('#digest .dz').onclick = e => { const b = e.target.closest('[data-dz]'); if (b) digestSize(b.dataset.dz); };
  if ($('#d-ai')) $('#d-ai').onclick = async () => { $('#d-ai').disabled = true; $('#d-ai').textContent = '✦ Writing…'; const r = await api.cmd('feeds:takeaways'); if (!r.ok) toast(r.error); openDigest(false); };
  $('#digest').onclick = e => { const a = e.target.closest('a[data-id]'); if (a) openReader(a.dataset.id); };
}

/** Today's digest: text size (A− A+) and zoom (− + Reset), kept for next time. */
let dzT = null;
function digestSize(how) {
  const v = V();
  let font = v.digestFont, zoom = v.digestZoom;
  if (how === 'font-') font = Math.max(12, font - 1);
  else if (how === 'font+') font = Math.min(30, font + 1);
  else if (how === 'zoom-') zoom = Math.max(50, zoom - 10);
  else if (how === 'zoom+') zoom = Math.min(200, zoom + 10);
  else if (how === 'reset') { font = 17; zoom = 100; }
  state.info.prefs.settings = { ...state.info.prefs.settings, digestFont: font, digestZoom: zoom };
  const dg = $('#digest .dg');
  if (dg) { dg.style.setProperty('--dfs', `${font}px`); const b = dg.querySelector('.dg-body'); if (b) b.style.zoom = zoom / 100; }
  if ($('#dz-font')) $('#dz-font').textContent = `${font}px`;
  if ($('#dz-zoom')) $('#dz-zoom').textContent = `${zoom}%`;
  clearTimeout(dzT); dzT = setTimeout(() => api.cmd('feeds:set-prefs', { digestFont: font, digestZoom: zoom }), 300);
}
document.addEventListener('keydown', e => {
  if (state.view !== 'digest' || !(e.ctrlKey || e.metaKey)) return;
  if (e.key === '+' || e.key === '=') { e.preventDefault(); e.stopPropagation(); digestSize('zoom+'); }
  else if (e.key === '-') { e.preventDefault(); e.stopPropagation(); digestSize('zoom-'); }
  else if (e.key === '0') { e.preventDefault(); e.stopPropagation(); digestSize('reset'); }
}, true);
document.addEventListener('wheel', e => {
  if (state.view !== 'digest' || !e.ctrlKey) return;
  e.preventDefault(); digestSize(e.deltaY < 0 ? 'zoom+' : 'zoom-');
}, { passive: false });

// ---------- manage ----------
// The Manage view is drawn again after each change, but its event handlers are attached ONCE
// (below, on the #manage container). Attaching them on every drawing made one click run several
// times: Remove asked repeatedly, and "Add ticked" subscribed to the same feed more than once.
let busy = false;
const catSel = (id, v) => `<select class="field" data-cat="${esc(id)}" aria-label="Stream">${['local', 'global', 'research', 'tech'].map(c => `<option value="${c}"${c === v ? ' selected' : ''}>${esc(label(c))}</option>`).join('')}</select>`;
async function openManage({ keepScroll = false } = {}) {
  const top = $('#manage').scrollTop;
  show('manage');
  state.info = await api.cmd('feeds:info');
  const { feeds, starters, prefs } = state.info;
  for (const id of [...state.selected]) if (!feeds.some(f => f.id === id)) state.selected.delete(id);
  const subscribed = new Set(feeds.map(f => f.url));
  const filter = ($('#m-filter') && $('#m-filter').value) || '';
  const rows = feeds.map(f => `<tr data-row="${esc(f.id)}"${filter && !`${f.title} ${f.url}`.toLowerCase().includes(filter.toLowerCase()) ? ' hidden' : ''}>
    <td class="ck"><input type="checkbox" data-sel="${esc(f.id)}"${state.selected.has(f.id) ? ' checked' : ''} aria-label="Select ${esc(f.title)}"></td>
    <td><div class="t" title="${esc(f.title)}">${f.type === 'scrape' ? '🔎 ' : ''}${f.paused ? '⏸ ' : ''}<span data-name="${esc(f.id)}">${esc(f.title)}</span></div><div class="u">${esc(f.url)}</div>${f.lastError ? `<div class="err">⚠ ${esc(f.lastError)}</div>` : ''}</td>
    <td>${catSel(f.id, f.category)}</td>
    <td class="hide-p muted">${f.items} items${f.unread ? ` · <b>${f.unread} unread</b>` : ''}<br>${f.lastFetch ? `checked ${esc(ago(f.lastFetch))}` : 'not checked yet'}</td>
    <td class="acts-r" data-acts="${esc(f.id)}"><button class="btn small" data-view="${esc(f.id)}" title="Show only this feed">View</button><button class="btn small" data-rename="${esc(f.id)}" title="Rename">Rename</button><button class="btn small" data-pause="${esc(f.id)}">${f.paused ? 'Resume' : 'Pause'}</button><button class="btn small danger" data-unsub="${esc(f.id)}">Remove</button></td></tr>`).join('');
  const s = prefs.settings;
  $('#manage').innerHTML = `<div class="mg">
    <div class="rd-top"><button class="btn small" id="m-back">← Back</button><span class="grow"></span>
      <button class="btn small" id="m-expall" title="Feeds, channels, interests, filters and display settings, as one file">Export feeds and settings…</button><button class="btn small" id="m-impall" title="A Ferna Feeds export (.json) or an OPML file">Import…</button>
      <button class="btn small" id="m-exp" title="The standard feed-list file other readers use">Export OPML…</button><button class="btn small" id="m-imp">Import OPML…</button></div>
    <h2>Follow a feed or a site</h2>
    <div class="addrow"><input class="field" id="m-url" placeholder="Feed or site address, e.g. https://www.adaderana.lk/rss.php"><button class="btn primary" id="m-add">Follow</button></div>
    <p class="muted">A site address is enough: Ferna finds its feed. A site without a feed can be followed too — new links on the page become items.</p>
    <h2 id="m-feeds-h">Your feeds (${feeds.length})</h2>
    ${feeds.length ? `<div class="bulk" id="m-bulk">
        <label class="chk"><input type="checkbox" id="m-selall"${feeds.length && feeds.every(f => state.selected.has(f.id)) ? ' checked' : ''}> All</label>
        <span id="m-selcount" class="muted">${state.selected.size ? `${state.selected.size} selected` : 'Tick feeds to change several at once'}</span>
        <span class="bulk-acts"${state.selected.size ? '' : ' hidden'}>
          <button class="btn small" data-bulk="read">Mark read</button><button class="btn small" data-bulk="check">Check now</button><button class="btn small" data-bulk="pause">Pause</button><button class="btn small" data-bulk="resume">Resume</button>
          <select class="field small" id="m-bulkcat" aria-label="Move to stream"><option value="">Move to…</option>${['local', 'global', 'research', 'tech'].map(c => `<option value="${c}">${esc(label(c))}</option>`).join('')}</select>
          <button class="btn small danger" data-bulk="remove">Remove</button></span>
        <span class="grow"></span><input class="field small" id="m-filter" placeholder="Filter feeds" value="${esc(filter)}">
      </div><div id="m-confirm"></div>
      <table class="fl">${rows}</table>` : '<p class="muted">None yet.</p>'}
    <h2>Starter packs</h2>
    <div class="packs">${['local', 'global', 'research', 'tech'].map(c => `<div class="pack"><h3 style="color:${CAT_COLOR[c]}">${esc(label(c))}</h3>${starters[c].map(([n, u]) => `<label><input type="checkbox" data-pack="${c}" value="${esc(u)}" data-name="${esc(n)}"${subscribed.has(u) ? ' checked disabled' : ''}> ${esc(n)}${subscribed.has(u) ? ' <span class="muted">(following)</span>' : ''}</label>`).join('')}<button class="btn small" data-addpack="${c}">Add ticked</button></div>`).join('')}</div>
    <h2>Display and reading</h2>
    <div id="m-display">${displayHtml()}</div>
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
  if (keepScroll) $('#manage').scrollTop = top;
  state.counts = await api.cmd('feeds:counts');
  renderStreams();
}
function chanHtml(c) {
  const feeds = (state.info && state.info.feeds) || [];
  return `<div class="chan" data-chan="${esc(c.id || '')}"><input class="field" data-k="name" placeholder="Channel name" value="${esc(c.name || '')}">
    <textarea class="field" data-k="keywords" rows="2" placeholder="+particle swarm&#10;+ant colony">${esc(c.keywords || '')}</textarea>
    <div class="chips">${feeds.map(f => `<label class="chip"><input type="checkbox" data-feed="${esc(f.id)}"${(c.feeds || []).includes(f.id) ? ' checked' : ''}> ${esc(f.title)}</label>`).join('')}</div>
    <div><button class="btn small danger" data-delchan>Delete channel</button></div></div>`;
}
/** Ask inline (no pop-up): "Remove 3 feeds? Yes / No". */
function askInline(where, text, yes) {
  where.innerHTML = `<div class="confirm" role="alertdialog"><span>${esc(text)}</span><button class="btn small danger" data-yes>Yes, remove</button><button class="btn small" data-no>Cancel</button></div>`;
  const box = where.firstElementChild;
  box.querySelector('[data-yes]').focus();
  box.querySelector('[data-no]').onclick = () => { where.innerHTML = ''; };
  box.querySelector('[data-yes]').onclick = async () => { box.querySelectorAll('button').forEach(b => { b.disabled = true; }); await yes(); };
}
function updateBulk() {
  const n = state.selected.size;
  const cnt = $('#m-selcount'); if (cnt) cnt.textContent = n ? `${n} selected` : 'Tick feeds to change several at once';
  const acts = $('.bulk-acts'); if (acts) acts.hidden = !n;
  const all = $('#m-selall'); if (all) { const vis = $$('tr[data-row]:not([hidden])').map(r => r.dataset.row); all.checked = !!vis.length && vis.every(id => state.selected.has(id)); }
}
async function removeFeeds(ids) {
  const r = await api.cmd('feeds:unsubscribe', ids);
  for (const id of ids) state.selected.delete(id);
  if (ids.includes(state.feedId)) state.feedId = '';
  toast(`${r.removed} feed${r.removed === 1 ? '' : 's'} removed`);
  await openManage({ keepScroll: true });
}
$('#manage').addEventListener('change', async e => {
  const t = e.target;
  if (t.dataset.cat) { await api.cmd('feeds:update', t.dataset.cat, { category: t.value }); toast('Moved'); }
  else if (t.dataset.sel) { if (t.checked) state.selected.add(t.dataset.sel); else state.selected.delete(t.dataset.sel); updateBulk(); }
  else if (t.id === 'm-selall') { for (const r of $$('tr[data-row]:not([hidden])')) { if (t.checked) state.selected.add(r.dataset.row); else state.selected.delete(r.dataset.row); r.querySelector('[data-sel]').checked = t.checked; } updateBulk(); }
  else if (t.id === 'm-bulkcat' && t.value) { const n = await api.cmd('feeds:update-many', [...state.selected], { category: t.value }); toast(`${n} moved to ${label(t.value)}`); openManage({ keepScroll: true }); }
  else if (t.dataset.v) setView(t);
});
$('#manage').addEventListener('input', e => {
  if (e.target.id === 'm-filter') { const q = e.target.value.toLowerCase(); for (const r of $$('tr[data-row]')) r.hidden = !!q && !r.textContent.toLowerCase().includes(q); updateBulk(); }
  else if (e.target.dataset.v && e.target.type === 'range') setView(e.target, true);
});
$('#manage').addEventListener('keydown', e => { if (e.target.id === 'm-url' && e.key === 'Enter') addFeed(); if (e.target.dataset.renaming && e.key === 'Enter') e.target.blur(); if (e.target.dataset.renaming && e.key === 'Escape') { e.target.value = e.target.dataset.old; e.target.blur(); } });
$('#manage').addEventListener('focusout', async e => {
  const t = e.target;
  if (!t.dataset.renaming) return;
  const name = t.value.trim();
  if (name && name !== t.dataset.old) { await api.cmd('feeds:update', t.dataset.renaming, { title: name }); toast('Renamed'); }
  openManage({ keepScroll: true });
});
async function addFeed() {
  if (busy) return;
  const url = $('#m-url').value.trim();
  if (!url) return;
  busy = true; $('#m-add').disabled = true; $('#m-add').textContent = 'Checking…';
  try {
    const u = /^https?:/i.test(url) ? url : `https://${url}`;
    let r = await api.cmd('feeds:subscribe', u, { type: 'rss' });
    if (!r.ok && r.code === 'NOFEED' && confirm(`${r.error}\n\nFollow the page itself? New links on it will become items.`)) r = await api.cmd('feeds:subscribe', u, { type: 'scrape' });
    if (r.ok) { toast(r.feed.existed ? `You already follow “${r.feed.title}”` : `Following “${r.feed.title}” (${label(r.feed.category)})`); await openManage({ keepScroll: true }); } else if (r.error) toast(r.error);
  } finally { busy = false; if ($('#m-add')) { $('#m-add').disabled = false; $('#m-add').textContent = 'Follow'; } }
}
$('#manage').addEventListener('click', async e => {
  const t = e.target.closest('button, a') || e.target;
  if (t.id === 'm-back') { show('list'); load(); }
  else if (t.id === 'm-add') addFeed();
  else if (t.id === 'm-imp' || t.id === 'm-impall') { const r = await api.cmd(t.id === 'm-imp' ? 'feeds:opml-import' : 'feeds:import-all'); if (r.ok) { toast(`${r.added} of ${r.found} feeds added${t.id === 'm-impall' ? '; settings imported' : ''}`); state.info = await api.cmd('feeds:info'); applyView(); openManage(); } else if (r.error) toast(r.error); }
  else if (t.id === 'm-exp' || t.id === 'm-expall') { const r = await api.cmd(t.id === 'm-exp' ? 'feeds:opml-export' : 'feeds:export-all'); if (r.ok) toast(t.id === 'm-exp' ? 'Feeds exported (OPML)' : 'Feeds and settings exported'); }
  else if (t.dataset.unsub) {
    const f = state.info.feeds.find(x => x.id === t.dataset.unsub);
    askInline($(`[data-acts="${CSS.escape(t.dataset.unsub)}"]`), `Remove “${f ? f.title : 'this feed'}”? Saved items are kept.`, () => removeFeeds([t.dataset.unsub]));
  } else if (t.dataset.pause) { const f = state.info.feeds.find(x => x.id === t.dataset.pause); if (f) { await api.cmd('feeds:update', f.id, { paused: !f.paused }); openManage({ keepScroll: true }); } }
  else if (t.dataset.view) { pickScope({ feedId: t.dataset.view }); }
  else if (t.dataset.rename) {
    const span = $(`[data-name="${CSS.escape(t.dataset.rename)}"]`);
    if (!span) return;
    const inp = document.createElement('input');
    inp.className = 'field small'; inp.value = span.textContent; inp.dataset.renaming = t.dataset.rename; inp.dataset.old = span.textContent;
    span.replaceWith(inp); inp.focus(); inp.select();
  } else if (t.dataset.bulk) {
    const ids = [...state.selected];
    if (!ids.length) return;
    const b = t.dataset.bulk;
    if (b === 'remove') askInline($('#m-confirm'), `Remove ${ids.length} feed${ids.length === 1 ? '' : 's'}? Saved items are kept.`, () => removeFeeds(ids));
    else if (b === 'pause' || b === 'resume') { const n = await api.cmd('feeds:update-many', ids, { paused: b === 'pause' }); toast(`${n} ${b === 'pause' ? 'paused' : 'resumed'}`); openManage({ keepScroll: true }); }
    else if (b === 'read') { let n = 0; for (const id of ids) n += await api.cmd('feeds:all-read', 'all', { feedId: id }); toast(`${n} items marked read`); openManage({ keepScroll: true }); }
    else if (b === 'check') { t.disabled = true; t.textContent = 'Checking…'; const r = await api.cmd('feeds:poll-feeds', ids); toast(r && r.added ? `${r.added} new items` : 'No new items'); openManage({ keepScroll: true }); }
  } else if (t.dataset.addpack) {
    if (busy) return;
    const boxes = $$(`input[data-pack="${t.dataset.addpack}"]:checked:not(:disabled)`);
    if (!boxes.length) { toast('Tick some feeds first'); return; }
    busy = true; t.disabled = true; t.textContent = 'Adding…';
    boxes.forEach(b => { b.disabled = true; });
    let n = 0;
    try {
      for (const b of boxes) { const r = await api.cmd('feeds:subscribe', b.value, { type: 'rss', title: b.dataset.name, category: t.dataset.addpack }); if (r.ok && !r.feed.existed) n++; else if (!r.ok) toast(`${b.dataset.name}: ${r.error}`); }
      toast(`${n} feed${n === 1 ? '' : 's'} added`);
    } finally { busy = false; await openManage({ keepScroll: true }); }
  } else if (t.id === 'm-forget') { await api.cmd('feeds:set-prefs', { forgetLearned: true }); openManage({ keepScroll: true }); }
  else if (t.id === 'm-addchan') { $('#m-chans').insertAdjacentHTML('beforeend', chanHtml({ id: `c${Date.now().toString(36)}`, name: '', keywords: '', feeds: [] })); }
  else if (t.hasAttribute && t.hasAttribute('data-delchan')) { t.closest('.chan').remove(); }
  else if (t.id === 'm-saveprefs') {
    const channels = $$('.chan').map(el => ({ id: el.dataset.chan, name: el.querySelector('[data-k="name"]').value.trim() || 'Channel', keywords: el.querySelector('[data-k="keywords"]').value, feeds: $$('input[data-feed]:checked', el).map(x => x.dataset.feed) }));
    await api.cmd('feeds:set-prefs', { interests: $('#m-int').value, rules: $('#m-rules').value, hideLow: $('#m-hide').checked, threshold: Number($('#m-th').value), interval: Number($('#m-int-min').value), digestHour: Number($('#m-dh').value), aiSummaries: $('#m-ai').checked, channels });
    toast('Saved'); state.info = await api.cmd('feeds:info'); renderStreams();
  }
});

// ---------- display settings (Manage → Display, and the Aa button) ----------
function displayHtml() {
  const v = V();
  const sel = (k, opts) => `<select class="field small" data-v="${k}">${opts.map(([val, name]) => `<option value="${val}"${String(v[k]) === String(val) ? ' selected' : ''}>${esc(name)}</option>`).join('')}</select>`;
  const pw = (state.info && state.info.panelWidth) || 420;
  return `<div class="dsp">
    <label><span class="lh">Text size <span class="val" id="v-fs">${v.fontSize}px</span></span><input type="range" data-v="fontSize" min="11" max="26" step="1" value="${v.fontSize}"></label>
    <label>Font ${sel('fontFamily', Object.entries(FONTS).map(([k, [n]]) => [k, n]))}</label>
    <label><span class="lh">Reading width <span class="val" id="v-rw">${v.readWidth}px</span></span><input type="range" data-v="readWidth" min="480" max="1600" step="20" value="${v.readWidth}"></label>
    <label><span class="lh">Side panel width <span class="val" id="v-pw">${pw}px</span></span><input type="range" data-v="panelWidth" min="320" max="900" step="10" value="${pw}"></label>
    <label>Layout ${sel('density', [['cards', 'Cards with summaries'], ['compact', 'Compact'], ['titles', 'Headlines only']])}</label>
    <label class="chk"><input type="checkbox" data-v="images"${v.images ? ' checked' : ''}> Show pictures</label>
    <label>Open items in ${sel('openMode', [['reader', 'The reader, here'], ['reader-tab', 'The reader, in a new tab'], ['tab', 'The original page, in a new tab'], ['background', 'The original page, in a background tab']])}</label>
    <label>The toolbar Feeds button opens ${sel('buttonOpens', [['panel', 'The side panel'], ['tab', 'A tab']])}</label>
    <label>Mark items read ${sel('markRead', [['scroll', 'When I scroll past them'], ['hover', 'When I point at them for a second'], ['open', 'Only when I open them']])}</label>
    <label class="chk"><input type="checkbox" data-v="cluster"${v.cluster ? ' checked' : ''}> Group reports of the same story into one card</label>
  </div>`;
}
let viewT = null;
let pwT = null;
async function setView(el, live = false) {
  const k = el.dataset.v;
  let val = el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
  if (k === 'panelWidth') {
    $$('#v-pw').forEach(x => { x.textContent = `${val}px`; });
    clearTimeout(pwT); pwT = setTimeout(async () => { state.info.panelWidth = await api.cmd('feeds:panel-width', val); }, live ? 120 : 0);
    return;
  }
  state.info.prefs.settings = { ...state.info.prefs.settings, [k]: val };
  applyView();
  if (k === 'fontSize') $$('#v-fs').forEach(x => { x.textContent = `${val}px`; });
  if (k === 'readWidth') $$('#v-rw').forEach(x => { x.textContent = `${val}px`; });
  // Keep both copies (Manage and the Aa pop-up) in step.
  for (const other of $$(`[data-v="${k}"]`)) if (other !== el) { if (other.type === 'checkbox') other.checked = val; else other.value = val; }
  // Changes made in quick succession are saved together (none is lost).
  pendingView[k] = val;
  clearTimeout(viewT);
  viewT = setTimeout(async () => {
    const p = pendingView; pendingView = {};
    await api.cmd('feeds:set-prefs', p);
    if (('cluster' in p || 'openMode' in p) && state.view === 'list') load({ keepScroll: true });
    if ('markRead' in p) watchCards();
  }, live ? 250 : 0);
}
let pendingView = {};
$('#b-view').onclick = e => { e.stopPropagation(); const p = $('#viewpop'); p.hidden = !p.hidden; if (!p.hidden) p.innerHTML = `<div class="pop-h"><b>Display</b><span class="grow"></span><button class="hb" data-close aria-label="Close">✕</button></div>${displayHtml()}`; };
$('#viewpop').addEventListener('change', e => { if (e.target.dataset.v) setView(e.target); });
$('#viewpop').addEventListener('input', e => { if (e.target.dataset.v && e.target.type === 'range') setView(e.target, true); });
$('#viewpop').addEventListener('click', e => { if (e.target.closest('[data-close]')) $('#viewpop').hidden = true; });

// ---------- views and header ----------
function show(v) {
  state.view = v;
  for (const id of ['reader', 'digest', 'manage']) $(`#${id}`).hidden = v !== id;
  if (v !== 'reader') state.readerId = null;
  $('#b-digest').classList.toggle('on', v === 'digest');
  $('#b-manage').classList.toggle('on', v === 'manage');
  if (v !== 'reader') history.replaceState(null, '', v === 'list' ? location.pathname + location.search : `#${v}`);
}
$('#logo').innerHTML = icon('rss');
$('#s-ic').innerHTML = icon('search');
$('#b-refresh').innerHTML = icon('reload');
$('#b-digest').innerHTML = icon('calendar');
$('#b-manage').innerHTML = icon('edit');
$('#b-full').innerHTML = icon('right');
$('#b-close').innerHTML = icon('close');
async function refreshNow() {
  const b = $('#b-refresh'); b.classList.add('spin'); b.disabled = true;
  const r = await api.cmd('feeds:poll', true);
  b.classList.remove('spin'); b.disabled = false;
  toast(r && r.added ? `${r.added} new item${r.added === 1 ? '' : 's'}` : 'No new items');
  load({ keepScroll: true });
}
$('#b-refresh').onclick = refreshNow;
$('#b-digest').onclick = () => (state.view === 'digest' ? show('list') : openDigest());
$('#b-manage').onclick = () => (state.view === 'manage' ? (show('list'), load()) : openManage());
$('#b-full').onclick = () => api.cmd('feeds:open-page', state.view === 'list' ? '' : state.view);
$('#b-close').onclick = () => api.cmd('feeds:close-panel');

// ---------- keyboard (as in other feed readers) ----------
const KEYS = [['J / K', 'Next / previous item'], ['O or Enter', 'Open (as set in Display)'], ['V', 'Original page in a new tab'], ['B', 'Original page in a background tab'], ['S', 'Save / unsave'], ['M', 'Mark read / unread'], ['X', 'Show / hide the other reports of a story'], ['Shift+A', 'Mark all shown as read'], ['R', 'Check feeds now'], ['/', 'Search'], ['G then M', 'Manage feeds'], ['Esc', 'Back to the list'], ['?', 'This list']];
function focusCard(i) {
  const cards = $$('#cards .fc');
  if (!cards.length) return null;
  i = Math.max(0, Math.min(cards.length - 1, i));
  const prev = cards[state.focus]; if (prev) prev.classList.remove('focus');
  // Moving down past an item is reading it, as in other readers.
  if (prev && i > state.focus && V().markRead !== 'open') queueRead(prev);
  state.focus = i;
  cards[i].classList.add('focus');
  cards[i].scrollIntoView({ block: 'nearest' });
  return cards[i];
}
let gPending = false;
document.addEventListener('keydown', e => {
  const tag = document.activeElement && document.activeElement.tagName;
  if (e.key === 'Escape') { $('#keys').hidden = true; $('#viewpop').hidden = true; if (state.view !== 'list') { show('list'); load({ keepScroll: true }); } return; }
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (k === '/') { e.preventDefault(); $('#q').focus(); return; }
  if (k === '?') { const p = $('#keys'); p.innerHTML = `<div class="pop-h"><b>Keyboard</b></div><table>${KEYS.map(([a, b]) => `<tr><td><kbd>${esc(a)}</kbd></td><td>${esc(b)}</td></tr>`).join('')}</table>`; p.hidden = !p.hidden; return; }
  if (gPending) { gPending = false; if (k === 'm') openManage(); else if (k === 'd') openDigest(); else if (k === 'a') pickScope({}); return; }
  if (k === 'g') { gPending = true; setTimeout(() => { gPending = false; }, 1200); return; }
  if (k === 'r') { refreshNow(); return; }
  if (state.view !== 'list') return;
  if (k === 'j' || k === 'n') { e.preventDefault(); focusCard(state.focus + 1); return; }
  if (k === 'k' || k === 'p') { e.preventDefault(); focusCard(state.focus - 1); return; }
  if (k === 'A' && e.shiftKey) { $('#b-allread').click(); return; }
  const card = $$('#cards .fc')[state.focus];
  if (!card) return;
  const c = state.data.cards.find(x => x.id === card.dataset.id);
  if (!c) return;
  if (k === 'o' || k === 'Enter') { e.preventDefault(); openItem(c, card); }
  else if (k === 'v' || k === 'b') { api.cmd('feeds:opened', c.id); api.cmd('feeds:open-url', c.link, k === 'b'); markCardRead(card, c); }
  else if (k === 's') card.querySelector('[data-act="save"]').click();
  else if (k === 'm') card.querySelector('[data-act="toggle-read"]').click();
  else if (k === 'x' && c.sources.length > 1) card.querySelector('[data-act="sources"]').click();
});

let refreshT = null;
api.on('refresh', m => {
  if (m && m.show === 'digest') { openDigest(); return; }
  // Only numbers changed (items read while scrolling, here or in another feeds page).
  if (m && m.quiet) { if (m.counts) { state.counts = m.counts; renderStreams(); } return; }
  clearTimeout(refreshT);
  refreshT = setTimeout(async () => {
    state.info = await api.cmd('feeds:info');
    applyView();
    if (state.view === 'list') load({ keepScroll: true }); else { state.counts = await api.cmd('feeds:counts'); renderStreams(); }
  }, 300);
});

(async () => {
  state.info = await api.cmd('feeds:info');
  applyView();
  applyListPrefs();
  const h = location.hash.slice(1);
  load(); // the streams and the list behind any other view
  if (h === 'digest') openDigest();
  else if (h === 'manage') openManage();
  else if (h.startsWith('read/')) { state.fromTab = true; openReader(h.slice(5)); }
  else show('list');
})();
