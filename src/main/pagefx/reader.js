'use strict';
// Reading mode and read aloud, in an isolated world (7792).
//   Reading mode: Mozilla Readability (as in Firefox) picks out the article; it is shown over the
//   page in a clean, adjustable view (size, font, width, light / sepia / dark) inside a closed
//   shadow root. Nothing is fetched and the page's own scripts cannot reach the view.
//   Read aloud: the article (or the selected text) is read with the voices installed in Windows;
//   the paragraph being read is highlighted. Speed and voice are remembered.
// The script resolves with what the reader changed ({type:'pref'|'close'|'state'}), and the browser
// calls WAIT again to keep listening, as the password manager does.

const fs = require('fs');

const WORLD = 7792;
let READABILITY = null;
function readabilitySource() {
  if (READABILITY === null) {
    try { READABILITY = fs.readFileSync(require.resolve('@mozilla/readability/Readability.js'), 'utf8'); } catch { READABILITY = ''; }
  }
  return READABILITY;
}

/** Article as { title, byline, siteName, html, text, lang } or null. Used by the assistant too. */
const EXTRACT = () => String.raw`(() => {
  const Readability = (() => { ${readabilitySource()}
    ; return typeof Readability === 'function' ? Readability : null; })();
  let art = null;
  try { if (Readability) art = new Readability(document.cloneNode(true), { charThreshold: 300 }).parse(); } catch (e) { art = null; }
  const text = art && art.textContent && art.textContent.trim().length > 200 ? art.textContent : (document.body ? document.body.innerText : '');
  return { title: (art && art.title) || document.title, byline: art ? art.byline || '' : '', siteName: art ? art.siteName || '' : '', html: art ? art.content : '', text: String(text || '').replace(/\n{3,}/g, '\n\n').trim(), lang: document.documentElement.lang || '', url: location.href };
})()`;

const OPEN = prefs => String.raw`(() => {
  const P = ${JSON.stringify(prefs)};
  const st = window.__frd || (window.__frd = { host: null, resolve: null, queue: [] });
  const answer = v => { if (st.resolve) { const r = st.resolve; st.resolve = null; r(v); } else st.queue.push(v); };
  if (st.host) { if (P.toggle && !P.speakText) { st.close(); return Promise.resolve({ type: 'close' }); } st.quiet = true; st.close(); st.quiet = false; st.queue = []; }
  const Readability = (() => { ${readabilitySource()}
    ; return typeof Readability === 'function' ? Readability : null; })();

  function clean(html) {
    const t = document.createElement('template');
    t.innerHTML = html;
    t.content.querySelectorAll('script, style, iframe, object, embed, form, input, button, link, meta, noscript').forEach(x => x.remove());
    for (const el of t.content.querySelectorAll('*')) {
      for (const a of [...el.attributes]) {
        if (/^on/i.test(a.name) || a.name === 'style' || a.name === 'class' || a.name === 'id') el.removeAttribute(a.name);
        else if (/^(href|src|xlink:href|action|formaction)$/i.test(a.name) && /^\s*(javascript|data:text|vbscript):/i.test(a.value)) el.removeAttribute(a.name);
      }
      if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
      if (el.tagName === 'IMG') { el.setAttribute('loading', 'lazy'); el.removeAttribute('srcset'); }
    }
    return t;
  }

  let art = null;
  if (!P.speakText) {
    try { if (Readability) art = new Readability(document.cloneNode(true), { charThreshold: 300 }).parse(); } catch (e) { art = null; }
    if (!art || !art.content) return Promise.resolve({ type: 'none' });
  }

  // ---------- speech ----------
  const synth = window.speechSynthesis;
  const sp = { on: false, paused: false, idx: 0, parts: [] };
  function voices() { return synth ? synth.getVoices() : []; }
  function pickVoice() {
    const vs = voices();
    return vs.find(v => v.name === P.voice) || vs.find(v => (v.lang || '').toLowerCase().startsWith((P.lang || document.documentElement.lang || 'en').slice(0, 2).toLowerCase())) || vs.find(v => v.default) || vs[0] || null;
  }
  function speakFrom(i) {
    if (!synth) return;
    synth.cancel();
    sp.on = true; sp.paused = false; sp.idx = i;
    const next = () => {
      if (!sp.on) return;
      if (sp.idx >= sp.parts.length) { stopSpeech(); return; }
      const part = sp.parts[sp.idx];
      sp.parts.forEach(p => p.el && p.el.classList.toggle('reading', p === part));
      if (part.el && st.box) part.el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const u = new SpeechSynthesisUtterance(part.text);
      const v = pickVoice(); if (v) { u.voice = v; u.lang = v.lang; }
      u.rate = P.rate || 1;
      u.onend = () => { if (sp.on && !sp.paused) { sp.idx++; next(); } };
      u.onerror = () => { if (sp.on) { sp.idx++; next(); } };
      synth.speak(u);
    };
    next();
    syncButtons();
    answer({ type: 'state', speaking: true });
  }
  function stopSpeech() {
    sp.on = false; sp.paused = false;
    if (synth) synth.cancel();
    sp.parts.forEach(p => p.el && p.el.classList.remove('reading'));
    syncButtons();
    answer({ type: 'state', speaking: false });
  }
  function pauseSpeech() { if (!synth || !sp.on) return; if (sp.paused) { synth.resume(); sp.paused = false; } else { synth.pause(); sp.paused = true; } syncButtons(); }

  // ---------- view ----------
  const host = document.createElement('ferna-reader');
  host.style.cssText = P.speakText ? 'all:initial;position:fixed;z-index:2147483647;right:16px;bottom:16px' : 'all:initial;position:fixed;inset:0;z-index:2147483647';
  const sr = host.attachShadow({ mode: 'closed' });
  const themes = { light: ['#fbfbfa', '#1f2328', '#57606a'], sepia: ['#f4ecd8', '#5b4636', '#7a6450'], dark: ['#15181d', '#d6dae0', '#98a1ad'] };
  const css = () => { const th = themes[P.theme] || themes.light; return '' +
    ':host{all:initial}*{box-sizing:border-box}' +
    '.wrap{position:fixed;inset:0;overflow:auto;background:' + th[0] + ';color:' + th[1] + '}' +
    '.bar{position:sticky;top:0;display:flex;gap:6px;align-items:center;padding:8px 14px;background:' + th[0] + 'ee;backdrop-filter:blur(6px);border-bottom:1px solid ' + th[2] + '33;font:13px "Segoe UI",system-ui,sans-serif;z-index:2;flex-wrap:wrap}' +
    '.bar b{margin-right:auto;font-weight:600;opacity:.8}' +
    'button,select{font:inherit;color:inherit;background:transparent;border:1px solid ' + th[2] + '55;border-radius:7px;padding:4px 9px;cursor:pointer}button:hover{background:' + th[2] + '22}button.on{background:#2563eb;color:#fff;border-color:#2563eb}' +
    'article{margin:0 auto;padding:28px 22px 120px;max-width:' + (P.width || 700) + 'px;font-family:' + (P.font === 'sans' ? '"Segoe UI",system-ui,"Noto Sans Sinhala",sans-serif' : 'Georgia,"Iskoola Pota","Noto Serif Sinhala",serif') + ';font-size:' + (P.size || 20) + 'px;line-height:1.65}' +
    'article h1{font-size:1.7em;line-height:1.2;margin:0 0 .3em}.by{color:' + th[2] + ';font-size:.8em;margin-bottom:1.6em;font-family:"Segoe UI",system-ui,sans-serif}' +
    'article img,article video,article figure{max-width:100%;height:auto}article a{color:#2563eb}article pre{white-space:pre-wrap;font-size:.8em;background:' + th[2] + '18;padding:10px;border-radius:6px}' +
    'article blockquote{border-left:3px solid ' + th[2] + '66;margin:1em 0;padding-left:1em;color:' + th[2] + '}article table{border-collapse:collapse;font-size:.85em}article td,article th{border:1px solid ' + th[2] + '44;padding:4px 8px}' +
    '.reading{background:#2563eb26;border-radius:4px;box-shadow:0 0 0 4px #2563eb26}' +
    '.mini{display:flex;gap:6px;align-items:center;padding:8px 10px;background:' + th[0] + ';color:' + th[1] + ';border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.28);font:13px "Segoe UI",system-ui,sans-serif}'; };
  const styleEl = document.createElement('style');
  styleEl.textContent = css();
  sr.appendChild(styleEl);
  const bar = document.createElement('div');
  bar.className = P.speakText ? 'mini' : 'bar';
  bar.innerHTML = (P.speakText ? '<span>🔊 Read aloud</span>' : '<b>Reading mode</b>') +
    '<button data-a="play" title="Read aloud">▶ Read aloud</button><button data-a="pause" title="Pause / resume" hidden>⏸</button><button data-a="stop" title="Stop" hidden>■</button>' +
    '<select data-a="rate" title="Speed">' + [0.75, 1, 1.25, 1.5, 1.75, 2].map(r => '<option value="' + r + '"' + (Math.abs((P.rate || 1) - r) < 0.01 ? ' selected' : '') + '>' + r + '×</option>').join('') + '</select>' +
    '<select data-a="voice" title="Voice"></select>' +
    (P.speakText ? '' : '<button data-a="smaller" title="Smaller text">A−</button><button data-a="bigger" title="Bigger text">A+</button><button data-a="font" title="Serif / sans-serif">' + (P.font === 'sans' ? 'Serif' : 'Sans') + '</button><button data-a="theme" title="Light / sepia / dark">◐</button><button data-a="wide" title="Line width">↔</button>') +
    '<button data-a="close" title="Close (Esc)">✕</button>';
  const wrap = document.createElement('div');
  if (P.speakText) sr.appendChild(bar);
  else { wrap.className = 'wrap'; wrap.appendChild(bar); sr.appendChild(wrap); }
  if (!P.speakText) {
    const a = document.createElement('article');
    const h = document.createElement('h1'); h.textContent = art.title || document.title; a.appendChild(h);
    const by = document.createElement('div'); by.className = 'by'; by.textContent = [art.byline, art.siteName || location.hostname, Math.max(1, Math.round((art.length || 0) / 1100)) + ' min read'].filter(Boolean).join(' · '); a.appendChild(by);
    a.appendChild(clean(art.content).content);
    wrap.appendChild(a);
    st.box = wrap;
    sp.parts = [...a.querySelectorAll('h1, h2, h3, h4, p, li, blockquote, figcaption, td')].filter(el => el.textContent.trim().length > 1 && !el.querySelector('p, li')).map(el => ({ el, text: el.textContent.trim() }));
  } else {
    sp.parts = String(P.speakText).split(/(?<=[.!?।])\s+|\n+/).map(t => t.trim()).filter(Boolean).map(text => ({ el: null, text }));
  }
  const vsel = bar.querySelector('[data-a=voice]');
  const fillVoices = () => { const vs = voices(); const cur = pickVoice(); vsel.innerHTML = vs.map(v => '<option' + (cur && v.name === cur.name ? ' selected' : '') + '>' + v.name.replace(/[<>&]/g, '') + '</option>').join(''); vsel.hidden = !vs.length; };
  fillVoices();
  if (synth) synth.onvoiceschanged = fillVoices;
  function syncButtons() {
    bar.querySelector('[data-a=play]').hidden = sp.on;
    bar.querySelector('[data-a=pause]').hidden = !sp.on;
    bar.querySelector('[data-a=stop]').hidden = !sp.on;
    bar.querySelector('[data-a=pause]').textContent = sp.paused ? '▶' : '⏸';
  }
  const restyle = () => { const a = sr.querySelector('article'); if (a) { a.style.fontSize = P.size + 'px'; a.style.maxWidth = P.width + 'px'; a.style.fontFamily = P.font === 'sans' ? '"Segoe UI",system-ui,"Noto Sans Sinhala",sans-serif' : 'Georgia,"Iskoola Pota","Noto Serif Sinhala",serif'; } };
  bar.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !e.isTrusted) return;
    const a = b.dataset.a;
    if (a === 'play') speakFrom(0);
    else if (a === 'pause') pauseSpeech();
    else if (a === 'stop') stopSpeech();
    else if (a === 'close') st.close();
    else if (a === 'smaller' || a === 'bigger') { P.size = Math.max(14, Math.min(34, (P.size || 20) + (a === 'bigger' ? 2 : -2))); restyle(); answer({ type: 'pref', size: P.size }); }
    else if (a === 'font') { P.font = P.font === 'sans' ? 'serif' : 'sans'; b.textContent = P.font === 'sans' ? 'Serif' : 'Sans'; restyle(); answer({ type: 'pref', font: P.font }); }
    else if (a === 'wide') { P.width = P.width >= 900 ? 560 : (P.width || 700) + 170; restyle(); answer({ type: 'pref', width: P.width }); }
    else if (a === 'theme') { const order = ['light', 'sepia', 'dark']; P.theme = order[(order.indexOf(P.theme || 'light') + 1) % 3]; styleEl.textContent = css(); restyle(); answer({ type: 'pref', theme: P.theme }); }
  });
  bar.addEventListener('change', e => {
    if (e.target.dataset.a === 'rate') { P.rate = Number(e.target.value); if (sp.on) speakFrom(sp.idx); answer({ type: 'pref', rate: P.rate }); }
    if (e.target.dataset.a === 'voice') { P.voice = e.target.value; if (sp.on) speakFrom(sp.idx); answer({ type: 'pref', voice: P.voice }); }
  });
  // Click a paragraph while reading aloud: continue from there.
  wrap.addEventListener('dblclick', e => { const i = sp.parts.findIndex(p => p.el && p.el.contains(e.target)); if (i >= 0) speakFrom(i); });
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); st.close(); } };
  document.addEventListener('keydown', onKey, true);
  const prevOverflow = document.documentElement.style.overflow;
  if (!P.speakText) document.documentElement.style.overflow = 'hidden';
  st.close = () => {
    stopSpeech();
    document.removeEventListener('keydown', onKey, true);
    document.documentElement.style.overflow = prevOverflow;
    host.remove(); st.host = null; st.box = null;
    if (!st.quiet) answer({ type: 'close' });
  };
  st.host = host;
  (document.body || document.documentElement).appendChild(host);
  if (P.speak || P.speakText) setTimeout(() => speakFrom(0), 50);
  return new Promise(res => { st.resolve = res; });
})()`;

const WAIT = String.raw`(() => {
  const st = window.__frd;
  if (!st || !st.host) return Promise.resolve({ type: 'close' });
  if (st.queue.length) return Promise.resolve(st.queue.shift());
  return new Promise(res => { st.resolve = res; });
})()`;

const CLOSE = `(() => { const st = window.__frd; if (st && st.host) st.close(); return true; })()`;

module.exports = { WORLD, EXTRACT, OPEN, WAIT, CLOSE, readabilitySource };
