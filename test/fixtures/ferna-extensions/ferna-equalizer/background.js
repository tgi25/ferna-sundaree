// Ferna Equalizer — background service worker: the toolbar badge, keyboard shortcuts, and the
// equalizer status of a tab (gathered from every frame, so players in embedded frames count).
import { PRESETS, clean } from './eqcore.js';

async function cfg() { const { eq } = await chrome.storage.sync.get('eq'); return clean(eq); }
async function setCfg(patch) { const c = clean({ ...(await cfg()), ...patch }); await chrome.storage.sync.set({ eq: c }); return c; }

async function badge() {
  const c = await cfg();
  const label = !c.enabled ? '' : c.auto ? 'AUTO' : c.preset === 'custom' ? (c.customName ? '★' : 'EQ') : (PRESETS[c.preset] ? PRESETS[c.preset].label.slice(0, 4) : 'EQ');
  await chrome.action.setBadgeText({ text: label });
  await chrome.action.setBadgeBackgroundColor({ color: '#6d28d9' });
  await chrome.action.setTitle({ title: c.enabled ? `Ferna Equalizer: ${c.auto ? 'Auto-EQ' : c.preset === 'custom' ? (c.customName || 'Custom') : PRESETS[c.preset].label}` : 'Ferna Equalizer: off' });
}

async function status(tabId) {
  let frames = [];
  try {
    frames = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => (window.__fernaEQ ? window.__fernaEQ.status() : null) });
  } catch { return { web: false }; }
  const list = frames.map(f => f.result).filter(Boolean);
  if (!list.length) return { web: true, attached: 0, skipped: 0, media: 0 };
  const best = list.slice().sort((a, b) => (b.attached - a.attached) || ((b.genre ? 1 : 0) - (a.genre ? 1 : 0)))[0];
  return { ...best, web: true, attached: list.reduce((n, s) => n + s.attached, 0), skipped: list.reduce((n, s) => n + s.skipped, 0), media: list.reduce((n, s) => n + (s.media || 0), 0), waiting: list.some(s => s.waiting), playing: list.some(s => s.playing) };
}

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  (async () => {
    if (m.t === 'status') return status(m.tabId);
    if (m.t === 'set') { const c = await setCfg(m.patch || {}); await new Promise(r => setTimeout(r, 120)); return { cfg: c, status: m.tabId ? await status(m.tabId) : null }; }
    return null;
  })().then(reply, () => reply(null));
  return true;
});

chrome.commands.onCommand.addListener(async cmd => {
  const c = await cfg();
  if (cmd === 'toggle') await setCfg({ enabled: !c.enabled });
  else if (cmd === 'auto') await setCfg({ enabled: true, auto: !c.auto });
  else if (cmd === 'next') {
    const keys = Object.keys(PRESETS);
    const i = keys.indexOf(c.preset);
    const k = keys[(i + 1) % keys.length];
    await setCfg({ enabled: true, auto: false, preset: k, gains: PRESETS[k].gains });
  }
});

chrome.storage.onChanged.addListener((ch, area) => { if (area === 'sync' && ch.eq) badge(); });
chrome.runtime.onStartup.addListener(badge);
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  badge();
  if (reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('options.html#welcome') });
  for (const t of await chrome.tabs.query({})) {
    if (!/^https?:/i.test(t.url || '')) continue;
    chrome.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, files: ['content.js'] }).catch(() => {});
  }
});
