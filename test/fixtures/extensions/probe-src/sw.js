importScripts('probe.js');
let fired = [];
try { chrome.alarms.onAlarm.addListener(a => { fired.push(a.name); }); } catch (e) { self.topLevelError = String(e); }
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg === 'probe') { probe().then(r => reply({ ...r, topLevelError: self.topLevelError || null, fired })); return true; }
  if (msg === 'fast-alarm') { chrome.alarms.create('fast', { when: Date.now() + 300 }); reply(true); }
  if (msg === 'fired') reply(fired);
  if (msg === 'offscreen') {
    chrome.offscreen.createDocument({ url: 'off.html', reasons: ['LOCAL_STORAGE'], justification: 'test' })
      .then(() => chrome.runtime.sendMessage({ target: 'off', q: 'ping' }))
      .then(r => reply({ ok: true, r }), e => reply({ ok: false, e: String(e) }));
    return true;
  }
});
