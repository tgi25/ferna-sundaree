import { getSettings, setSettings } from './lib/settings.js';

const $ = (id) => document.getElementById(id);
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const st = await getSettings();

$('stamp').checked = st.stamp.enabled;
$('placement').value = st.stamp.placement === 'corner' ? `corner:${st.stamp.corner}` : st.stamp.placement;
$('delay').value = String(st.delay);
$('after').value = st.afterCapture;
$('fmt').value = st.quickFormat;
const syncFmt = () => { $('fmtRow').style.display = $('after').value === 'save' ? '' : 'none'; $('placement').disabled = !$('stamp').checked; };
syncFmt();

$('stamp').onchange = () => { setSettings({ stamp: { enabled: $('stamp').checked } }); syncFmt(); };
$('placement').onchange = () => {
  const [placement, corner] = $('placement').value.split(':');
  setSettings({ stamp: corner ? { placement, corner } : { placement } });
};
$('delay').onchange = () => setSettings({ delay: Number($('delay').value) });
$('after').onchange = () => { setSettings({ afterCapture: $('after').value }); syncFmt(); };
$('fmt').onchange = () => setSettings({ quickFormat: $('fmt').value });

// shortcut labels
const cmds = await chrome.commands.getAll();
for (const k of document.querySelectorAll('kbd[data-cmd]')) {
  const c = cmds.find((x) => x.name === k.dataset.cmd);
  if (c && c.shortcut) k.textContent = c.shortcut; else k.remove();
}

const restricted = !tab || !/^(https?|file):/.test(tab.url || '') || /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/.test(tab.url || '');
if (restricted) {
  $('warn').style.display = 'block';
  for (const b of document.querySelectorAll('.cap')) if (b.dataset.mode !== 'visible') b.style.opacity = '.55';
}

for (const b of document.querySelectorAll('.cap')) {
  b.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'capture', mode: b.dataset.mode, tabId: tab.id, delay: Number($('delay').value) });
    window.close();
  });
}

$('history').onclick = () => { chrome.tabs.create({ url: chrome.runtime.getURL('history.html') }); window.close(); };
$('settings').onclick = () => { chrome.runtime.openOptionsPage(); window.close(); };
$('keys').onclick = () => { chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); window.close(); };
