// Ferna Feeds — background service worker: the feed engine (lib/engine.js), the alarm that
// fetches feeds, the unread badge, the daily digest notification, the feeds a page announces,
// and the commands of the feed pages.
import { create, STARTERS } from './lib/engine.js';
import { CAT_LABEL } from './lib/nlp.js';

const PAGE = 'feeds.html';
const host = {
  broadcast(m) { chrome.runtime.sendMessage({ t: 'refresh', ...m }).catch(() => {}); },
  async badge(n) {
    try {
      await chrome.action.setBadgeText({ text: n ? (n > 999 ? '999+' : String(n)) : '' });
      await chrome.action.setBadgeBackgroundColor({ color: '#c2410c' });
      await chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
    } catch { /* ignore */ }
  },
  digestReady(d) {
    const top = [...d.breaking, ...d.research, ...Object.values(d.streams).flat()].slice(0, 3).map(c => `• ${c.title}`).join('\n');
    chrome.notifications.create('digest', { type: 'basic', iconUrl: 'icons/icon128.png', title: 'Your daily feed digest is ready', message: top || 'Today\'s main stories', priority: 0, buttons: [{ title: 'Open the digest' }] }, () => void chrome.runtime.lastError);
  },
};
let enginep = null;
const engine = () => enginep || (enginep = create(host).then(e => { host.badge(e.unreadCount()); return e; }));

// ---------- the alarm: due feeds, the digest ----------
async function ensureAlarm() {
  const a = await chrome.alarms.get('poll');
  if (!a) chrome.alarms.create('poll', { delayInMinutes: 0.5, periodInMinutes: 5 });
}
chrome.alarms.onAlarm.addListener(async a => { if (a.name === 'poll') { const e = await engine(); await e.tick(); await e.flush(); } });
chrome.runtime.onStartup.addListener(() => { ensureAlarm(); engine(); });

// ---------- the toolbar button: the side panel, or a tab (Display → "The toolbar button opens") ----------
async function buttonBehaviour() {
  const e = await engine();
  const tab = e.prefs().settings.buttonOpens === 'tab';
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: !tab }).catch(() => {});
}
chrome.action.onClicked.addListener(() => openPage(''));
async function openPage(hash, { active = true } = {}) {
  const url = chrome.runtime.getURL(`${PAGE}${hash ? `#${String(hash).replace(/[^a-z0-9/_-]/gi, '')}` : ''}`);
  const [have] = !hash ? await chrome.tabs.query({ url: chrome.runtime.getURL(`${PAGE}*`) }) : [];
  if (have && !have.url.includes('panel=1')) { await chrome.tabs.update(have.id, { active: true }); await chrome.windows.update(have.windowId, { focused: true }); return; }
  await chrome.tabs.create({ url, active });
}
chrome.notifications.onClicked.addListener(id => { if (id === 'digest') { openPage('digest'); chrome.notifications.clear(id); } });
chrome.notifications.onButtonClicked.addListener(id => { if (id === 'digest') { openPage('digest'); chrome.notifications.clear(id); } });

// ---------- the feeds a page announces (from content/discover.js) ----------
async function tabFeeds() { const { tabFeeds: t } = await chrome.storage.session.get('tabFeeds'); return t || {}; }
async function setTabFeeds(tabId, list) {
  const t = await tabFeeds();
  if (list && list.length) t[tabId] = list; else delete t[tabId];
  await chrome.storage.session.set({ tabFeeds: t });
  host.broadcast({ what: 'tab' });
}
chrome.tabs.onRemoved.addListener(id => setTabFeeds(id, null));
chrome.tabs.onActivated.addListener(() => host.broadcast({ what: 'tab' }));

// ---------- right-click: follow a page or a feed link ----------
function menus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'follow-page', title: 'Follow this page in Ferna Feeds', contexts: ['page'], documentUrlPatterns: ['http://*/*', 'https://*/*'] });
    chrome.contextMenus.create({ id: 'follow-link', title: 'Follow this link in Ferna Feeds', contexts: ['link'], targetUrlPatterns: ['http://*/*', 'https://*/*'] });
  });
}
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const e = await engine();
  const url = info.menuItemId === 'follow-link' ? info.linkUrl : info.pageUrl;
  const announced = info.menuItemId === 'follow-page' ? ((await tabFeeds())[tab && tab.id] || []) : [];
  let msg;
  try {
    let f;
    try { f = await e.subscribe(announced[0] ? announced[0].url : url, { type: 'rss', title: announced[0] ? announced[0].title : '' }); }
    catch (err) { if (err.code !== 'NOFEED') throw err; f = await e.subscribe(url, { type: 'scrape', title: tab && info.menuItemId === 'follow-page' ? tab.title : '' }); }
    msg = f.existed ? `You already follow “${f.title}”.` : `Following “${f.title}” (${CAT_LABEL[f.category]}).`;
  } catch (err) { msg = String(err.message || err); }
  chrome.notifications.create('', { type: 'basic', iconUrl: 'icons/icon128.png', title: 'Ferna Feeds', message: msg, priority: 0 }, () => void chrome.runtime.lastError);
});

// ---------- commands of the feed pages ----------
const str = x => typeof x === 'string';
const COMMANDS = {
  'feeds:list': (e, q) => e.list(q || {}),
  'feeds:item': (e, id) => { const it = e.item(id); return it ? { ...it, vec: undefined, feed: (e.feedsInfo().find(f => f.id === it.feedId) || {}).title || '' } : null; },
  'feeds:info': e => ({ feeds: e.feedsInfo(), starters: STARTERS, prefs: e.prefs(), labels: CAT_LABEL, panelWidth: 420 }),
  'feeds:subscribe': async (e, url, o) => { try { const f = await e.subscribe(url, o || {}); return { ok: true, feed: { id: f.id, title: f.title, category: f.category, existed: !!f.existed } }; } catch (err) { return { ok: false, error: String(err.message || err), code: err.code || '' }; } },
  'feeds:unsubscribe': (e, ids) => ({ removed: e.unsubscribe([].concat(ids).filter(str).slice(0, 2000)) }),
  'feeds:update-many': (e, ids, p) => { let n = 0; for (const id of (ids || []).filter(str).slice(0, 2000)) if (e.updateFeed(id, p || {})) n++; return n; },
  'feeds:poll-feeds': (e, ids) => e.poll({ only: (ids || []).filter(str).slice(0, 200) }),
  'feeds:counts': e => e.counts(),
  'feeds:recent': (e, n) => e.recent(Number(n) || 5),
  'feeds:unmark-last': e => e.unmarkLast(),
  'feeds:panel-width': (e, w) => w,
  'feeds:update': (e, id, p) => !!e.updateFeed(id, p || {}),
  'feeds:poll': (e, force) => e.poll({ force: !!force }),
  'feeds:read': (e, ids, read, quiet) => e.setRead((ids || []).filter(str), !!read, { quiet: !!quiet }),
  'feeds:all-read': (e, cat, o) => e.markAllRead(str(cat) ? cat : 'all', { feedId: str(o && o.feedId) ? o.feedId : '', channel: str(o && o.channel) ? o.channel : '', olderThan: Number(o && o.olderThan) || 0, ids: Array.isArray(o && o.ids) ? o.ids.filter(str) : null }),
  'feeds:opened': (e, id) => !!e.opened(id),
  'feeds:save': (e, id, v) => !!e.setSaved(id, !!v),
  'feeds:ai-summary': async (e, id) => { try { return { ok: true, text: await e.aiSummary(id) }; } catch (err) { return { ok: false, error: String(err.message || err) }; } },
  'feeds:digest': (e, fresh) => { let d = e.digests()[0]; if (fresh || !d) d = e.buildDigest(); return d; },
  'feeds:takeaways': () => ({ ok: false, error: 'AI takeaways are part of the Ferna Sundaree browser.' }),
  'feeds:article': async (e, id) => { try { return { ok: true, ...(await e.articleHtml(id)) }; } catch (err) { return { ok: false, error: String(err.message || err) }; } },
  'feeds:fulltext': (e, id, t) => { e.storeFullText(id, t); return true; },
  'feeds:prefs': e => e.prefs(),
  'feeds:set-prefs': async (e, p) => { const r = e.setPrefs(p || {}); if (p && 'buttonOpens' in p) buttonBehaviour(); return r; },
  'feeds:export-data': e => e.exportAll(),
  'feeds:opml-data': e => e.exportOpml(),
  'feeds:import-text': async (e, text) => {
    try {
      if (/^\s*</.test(text)) return { ok: true, ...(await e.importOpml(text)) };
      const r = await e.importAll(JSON.parse(text));
      buttonBehaviour();
      return { ok: true, ...r };
    } catch (err) { return { ok: false, error: String(err.message || err) }; }
  },
  'feeds:open-url': async (e, url, bg) => { if (/^https?:/i.test(url)) await chrome.tabs.create({ url, active: !bg }); return true; },
  'feeds:open-page': async (e, hash) => { await openPage(hash || ''); return true; },
  // The extension's own: the feeds the page in the active tab announces
  'feeds:tab-feeds': async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || !/^https?:/i.test(tab.url || '')) return { tab: null, feeds: [] };
    const list = (await tabFeeds())[tab.id] || [];
    const e = await engine();
    return { tab: { id: tab.id, url: tab.url, title: tab.title }, feeds: list.map(f => ({ ...f, following: !!e.findFeed(f.url) })), pageFollowed: !!e.findFeed(tab.url) };
  },
};

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'page-feeds') { if (sender.tab && sender.frameId === 0) setTabFeeds(sender.tab.id, (m.feeds || []).slice(0, 12)); return; }
  if (m.t !== 'cmd') return;
  // Only the extension's own pages may give commands.
  if (!sender.url || !sender.url.startsWith(chrome.runtime.getURL(''))) return;
  const fn = COMMANDS[m.name];
  if (!fn) { reply({ __error: `Unknown command ${m.name}` }); return; }
  (async () => {
    const e = await engine();
    const r = await fn(e, ...(Array.isArray(m.args) ? m.args : []));
    return r === undefined ? null : r;
  })().then(reply, err => reply({ __error: String(err && err.message || err) }));
  return true;
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  ensureAlarm(); menus(); buttonBehaviour();
  if (reason === 'install') openPage('manage');
  for (const t of await chrome.tabs.query({})) {
    if (!/^https?:/i.test(t.url || '')) continue;
    chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['content/discover.js'] }).catch(() => {});
  }
});
