'use strict';
// Downloads and parses the filter lists in a separate utility process, so the browser's main
// process (which every web request passes through) never stalls while big lists are parsed.
// A stall of a few seconds froze pages that load as you scroll, such as the Facebook feed.
// Messages: { kind: 'blocker', lists } → { ok, bytes }   (serialized ad-blocking engine)
//           { kind: 'safety', mirrors, lists } → { ok, out } (parsed safe-browsing lists)

// Chromium's network stack when available (uses the system's proxy settings and certificates,
// as the browser does); else Node's fetch.
function getFetch() {
  try { const { net } = require('electron'); if (net && typeof net.fetch === 'function') return (u, o) => net.fetch(u, o); } catch { /* plain Node */ }
  return fetch;
}

async function run(msg) {
  const fetch = getFetch();
  if (msg.kind === 'blocker') {
    const { ElectronBlocker } = require('@ghostery/adblocker-electron');
    const config = { loadCosmeticFilters: true, loadNetworkFilters: true, enableCompression: true };
    let engine;
    if (msg.offline) {
      // Tests: lists from the local test server, without the library's online resources.
      const texts = await Promise.all(msg.lists.map(u => fetch(u).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })));
      engine = ElectronBlocker.parse(texts.join('\n'), config);
    } else engine = await ElectronBlocker.fromLists(fetch, msg.lists, config);
    return { ok: true, bytes: engine.serialize() };
  }
  if (msg.kind === 'safety') {
    const { parseList } = require('./safety');
    const out = {};
    for (const [k, name] of Object.entries(msg.lists)) {
      let text = null, last = null;
      for (const m of msg.mirrors) {
        try {
          const r = await fetch(m + name, { signal: AbortSignal.timeout(30000) });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const t = await r.text();
          if (t.length < 1000) throw new Error('list too short');
          text = t; break;
        } catch (e) { last = e; }
      }
      if (text === null) throw last || new Error('list unavailable');
      const list = parseList(text);
      out[k] = { hosts: [...list.hosts], pages: [...list.pages] };
    }
    return { ok: true, out, json: JSON.stringify(out) };
  }
  if (msg.kind === 'feeds') return require('./feeds/worker').run(msg, fetch);
  if (msg.kind === 'page') {
    // One page for the feed reader: its text (reader view) or the feeds it announces.
    const W = require('./feeds/worker'), P = require('./feeds/parse');
    const r = await W.getText(fetch, msg.url, { ua: msg.ua });
    return { ok: true, url: r.url, html: msg.html ? String(r.text || '').slice(0, 3 * 1024 * 1024) : '', meta: P.pageMeta(r.text, r.url), feeds: P.discoverFeeds(r.text, r.url), isFeed: /^\s*(<\?xml|<rss|<feed|<rdf|\{)/i.test(r.text || '') };
  }
  throw new Error('unknown job');
}

if (process.parentPort) {
  process.parentPort.once('message', async e => {
    let reply;
    try { reply = await run(e.data); } catch (err) { reply = { ok: false, error: String(err && err.message || err) + (err && err.cause ? ` (${err.cause.code || err.cause.message || err.cause})` : '') }; }
    process.parentPort.postMessage(reply);
    setTimeout(() => process.exit(0), 50);
  });
}

/**
 * Run a job in a utility process (Electron), or here when that is not available (unit tests).
 * Resolves with the job's reply; rejects on failure or after 3 minutes.
 */
function runJob(msg) {
  let utilityProcess = null;
  try { ({ utilityProcess } = require('electron')); } catch { /* plain Node */ }
  if (!utilityProcess || typeof utilityProcess.fork !== 'function') {
    return run(msg).then(r => { if (!r.ok) throw new Error(r.error); return r; });
  }
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(__filename, [], { serviceName: 'Ferna filter lists', stdio: 'ignore' });
    let done = false;
    const finish = (err, r) => { if (done) return; done = true; clearTimeout(timer); try { child.kill(); } catch { /* gone */ } if (err) reject(err); else resolve(r); };
    const timer = setTimeout(() => finish(new Error('filter list update timed out')), 180000);
    child.on('message', r => (r && r.ok ? finish(null, r) : finish(new Error((r && r.error) || 'filter list update failed'))));
    child.on('exit', code => finish(new Error(`filter list process ended (${code})`)));
    child.postMessage(msg);
  });
}

module.exports = { runJob };
