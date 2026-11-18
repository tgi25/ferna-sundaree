const log = [];
chrome.tabs.onZoomChange && chrome.tabs.onZoomChange.addListener(e => log.push(['zoom', e.tabId, e.newZoomFactor]));
chrome.commands.onCommand.addListener((c, tab) => log.push(['cmd', c, tab && tab.id]));
chrome.alarms.onAlarm.addListener(a => log.push(['alarm', a.name]));
chrome.storage.onChanged.addListener((c, area) => log.push(['changed', area, Object.keys(c)]));
chrome.downloads.onChanged.addListener(d => log.push(['dl', d.id, d.state && d.state.current]));
chrome.sidePanel.onOpened && chrome.sidePanel.onOpened.addListener(i => log.push(['panel-opened', i.path]));
chrome.runtime.onMessage.addListener((m, s, reply) => {
  (async () => {
    const t = (p, ms = 2500) => Promise.race([Promise.resolve().then(() => p).then(v => ({ ok: true, v }), e => ({ ok: false, e: String(e && e.message || e) })), new Promise(r => setTimeout(() => r({ ok: false, e: 'timeout' }), ms))]);
    if (m.t === 'log') return log;
    if (m.t === 'run') {
      const id = m.tabId, o = {};
      o.getZoom = await t(chrome.tabs.getZoom(id));
      o.setZoomSettings = await t(chrome.tabs.setZoomSettings(id, { mode: 'automatic', scope: 'per-tab' }));
      o.getZoomSettings = await t(chrome.tabs.getZoomSettings(id));
      o.setZoom = await t(chrome.tabs.setZoom(id, 1.5));
      o.getZoom2 = await t(chrome.tabs.getZoom(id));
      o.sendMessage = await t(chrome.tabs.sendMessage(id, 'ping'));
      o.exec = await t(chrome.scripting.executeScript({ target: { tabId: id, allFrames: true }, func: () => document.title }));
      o.sessionSet = await t(chrome.storage.session.set({ a: 1 }).then(() => chrome.storage.session.get('a')));
      o.syncSet = await t(chrome.storage.sync.set({ b: 2 }).then(() => chrome.storage.sync.get('b')));
      o.alarm = await t(chrome.alarms.create('x', { delayInMinutes: 0.02 }).then(() => chrome.alarms.get('x')));
      o.badge = await t(chrome.action.setBadgeText({ tabId: id, text: '42' }).then(() => chrome.action.getBadgeText({ tabId: id })));
      o.notif = await t(chrome.notifications.create('n1', { type: 'basic', iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', title: 'T', message: 'M' }));
      o.menu = await t(new Promise(r => chrome.contextMenus.create({ id: 'm1', title: 'Probe', contexts: ['page'] }, () => r(chrome.runtime.lastError ? chrome.runtime.lastError.message : 'ok'))));
      o.query = await t(chrome.tabs.query({ active: true, currentWindow: true }).then(x => x.map(y => y.id + ' ' + y.url)));
      o.idb = await t(new Promise((res, rej) => { const q = indexedDB.open('p', 1); q.onupgradeneeded = () => q.result.createObjectStore('s'); q.onsuccess = () => res('ok'); q.onerror = () => rej(q.error); }));
      o.syncArea = await t(chrome.storage.sync.set({ s1: 5 }).then(() => Promise.all([chrome.storage.sync.get('s1'), chrome.storage.local.get(null)])));
      o.capture = await t(chrome.tabs.captureVisibleTab({ format: 'png' }).then(u => u.slice(0, 22) + ' len ' + u.length));
      o.download = await t(chrome.downloads.download({ url: 'data:text/plain;base64,aGVsbG8=', filename: 'Probe/hello.txt' }));
      o.panelBehaviour = await t(chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).then(() => chrome.sidePanel.getPanelBehavior()));
      o.panelOptions = await t(chrome.sidePanel.getOptions({}));
      o.cmds = await t(chrome.commands.getAll());
      return o;
    }
  })().then(reply, e => reply({ error: String(e) }));
  return true;
});
