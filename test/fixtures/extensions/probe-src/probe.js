// Runs in the worker and in probe.html; reports which chrome.* APIs answer.
async function probe() {
  const t = (p, ms = 1500) => Promise.race([Promise.resolve(p).then(v => ({ ok: true, v }), e => ({ ok: false, e: String(e && e.message || e) })), new Promise(r => setTimeout(() => r({ ok: false, e: 'timeout' }), ms))]);
  const out = { ua: navigator.userAgent, keys: Object.keys(chrome).sort().join(','), browser: typeof browser, same: typeof browser !== 'undefined' && browser === chrome, bkeys: typeof browser !== 'undefined' ? Object.keys(browser).sort().join(',') : null };
  out.types = Object.fromEntries(['alarms', 'offscreen', 'idle', 'privacy', 'permissions', 'storage'].map(k => [k, typeof chrome[k]]));
  out.session = typeof (chrome.storage && chrome.storage.session);
  if (chrome.storage && chrome.storage.session) out.sessionRT = await t(chrome.storage.session.set({ a: 1 }).then(() => chrome.storage.session.get('a')));
  if (chrome.privacy) out.privacy = await t(new Promise(r => chrome.privacy.services.passwordSavingEnabled.get({}, r)));
  if (chrome.privacy) out.privacyP = await t(chrome.privacy.services.passwordSavingEnabled.get({}));
  if (chrome.permissions) out.perm = await t(chrome.permissions.contains({ permissions: ['clipboardWrite'] }));
  if (chrome.idle) out.idle = await t(chrome.idle.queryState(60));
  if (chrome.alarms) out.alarm = await t(chrome.alarms.create('x', { delayInMinutes: 1 }).then(() => chrome.alarms.get('x')));
  return out;
}
