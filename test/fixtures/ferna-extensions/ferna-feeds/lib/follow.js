// Ferna Feeds (extension) — "This page has a feed: Follow": the bar for the page in the active tab
// (the browser's address bar has no RSS button for extensions, so the feed page offers it).
(() => {
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const bar = $('#follow');
let dismissed = '';
async function show() {
  let r;
  try { r = await window.ferna.cmd('feeds:tab-feeds'); } catch { return; }
  // Only in the side panel (it sits beside the page) — or in a tab, for the tab you came from.
  if (!r || !r.tab || r.tab.url.startsWith(chrome.runtime.getURL('')) || dismissed === r.tab.url) { bar.hidden = true; return; }
  const open = r.feeds.filter(f => !f.following);
  if (!open.length) { bar.hidden = true; return; }
  let host = ''; try { host = new URL(r.tab.url).hostname.replace(/^www\./, ''); } catch { /* none */ }
  bar.hidden = false;
  bar.innerHTML = `<span class="ic">${FK.icon('rss')}</span><span class="t"><b>${esc(host)}</b> has ${open.length > 1 ? `${open.length} feeds` : 'a feed'}</span>
    ${open.slice(0, 3).map(f => `<button class="btn small primary" data-url="${esc(f.url)}" data-title="${esc(f.title)}">Follow${open.length > 1 && f.title ? ` “${esc(f.title.slice(0, 40))}”` : ''}</button>`).join('')}
    <button class="hb x" data-x title="Not now">✕</button>`;
  bar.dataset.page = r.tab.url;
}
bar.addEventListener('click', async e => {
  if (e.target.closest('[data-x]')) { dismissed = bar.dataset.page; bar.hidden = true; return; }
  const b = e.target.closest('[data-url]');
  if (!b) return;
  b.disabled = true; b.textContent = 'Following…';
  const r = await window.ferna.cmd('feeds:subscribe', b.dataset.url, { type: 'rss', title: b.dataset.title });
  if (!r.ok) { b.disabled = false; b.textContent = 'Follow'; alert(r.error); return; }
  show();
});
window.ferna.on('refresh', m => { if (m && (m.what === 'tab' || !m.quiet)) show(); });
show();
})();
