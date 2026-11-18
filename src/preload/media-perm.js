'use strict';
// Camera, microphone and speaker permission state for web pages, as Chrome reports it.
//
// Electron answers navigator.permissions.query() with only "granted" or "denied", so a site
// that has not been asked yet hears "denied". Call and mic-test sites (Zoom, Teams, Meet …)
// check that first and then show "your browser blocked the microphone" without ever asking,
// which is why they could not find your microphones and speakers. Here a "denied" that is
// really "not asked yet" is reported as "prompt", and the page hears a "change" event when you
// answer, as in Chrome.
//
// The page sees only the state of its own site's camera, microphone and speakers — what the
// query already tells it — and nothing is added to the page's globals.
const { contextBridge, ipcRenderer } = require('electron');

const watchers = new Set();
ipcRenderer.on('ferna-perm-changed', () => { for (const f of [...watchers]) { try { f(); } catch { /* page gone */ } } });

const askState = name => ipcRenderer.invoke('ferna-perm-state', String(name)).catch(() => null);
const onChange = f => { if (typeof f === 'function') watchers.add(f); };

function mainWorld(askState, onChange) {
  try {
    const P = globalThis.Permissions && Permissions.prototype;
    if (!P || typeof P.query !== 'function') return;
    const NAMES = new Set(['microphone', 'camera', 'speaker-selection']);
    const tracked = []; // [{ status, name, state }]
    const desc = Object.getOwnPropertyDescriptor(PermissionStatus.prototype, 'state');
    const realState = s => (desc && desc.get ? desc.get.call(s) : s.state);
    onChange(async () => {
      for (const t of tracked) {
        const now = await askState(t.name);
        const next = now || realState(t.status);
        if (next && next !== t.state) { t.state = next; try { t.status.dispatchEvent(new Event('change')); } catch { /* ignore */ } }
      }
    });
    P.query = new Proxy(P.query, {
      apply: async (target, self, args) => {
        const status = await Reflect.apply(target, self, args);
        const name = args && args[0] && args[0].name;
        if (!NAMES.has(name) || realState(status) !== 'denied') return status;
        const st = await askState(name);
        if (!st || st === 'denied') return status;
        const t = { status, name, state: st };
        tracked.push(t);
        Object.defineProperty(status, 'state', { get: () => t.state, configurable: true, enumerable: true });
        return status;
      },
    });
  } catch { /* leave the page as it is */ }
}

try {
  contextBridge.executeInMainWorld({ func: mainWorld, args: [askState, onChange] });
} catch { /* not available */ }
