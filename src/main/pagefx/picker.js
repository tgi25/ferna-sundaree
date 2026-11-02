'use strict';
// Element picker (like uBlock Origin's): point at something on the page, click it, adjust how
// broad the rule is, and press Hide. Runs in an isolated world inside a closed shadow root;
// the script's promise resolves to a CSS selector (or null), which the browser saves as
// "<site>##<selector>" in your own filters.

const WORLD = 7789;

const SCRIPT = String.raw`(at) => new Promise(resolve => {
  if (window.__fernaPicking) { resolve(null); return; }
  window.__fernaPicking = true;
  const host = document.createElement('ferna-element-picker');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;cursor:crosshair;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = '<style>' +
    ':host{all:initial}' +
    '.box{position:fixed;pointer-events:none;background:rgba(37,99,235,.18);outline:2px solid #2563eb;border-radius:2px;transition:all .05s}' +
    '.box.match{background:rgba(220,38,38,.16);outline-color:#dc2626}' +
    '.panel{position:fixed;right:16px;bottom:16px;width:380px;max-width:calc(100vw - 32px);background:#111827;color:#f9fafb;border-radius:12px;' +
    'box-shadow:0 12px 32px rgba(0,0,0,.35);font:13px/1.4 "Segoe UI",system-ui,sans-serif;padding:12px;cursor:default}' +
    '.panel b{font-weight:600}.hint{color:#9ca3af;font-size:12px;margin:2px 0 8px}' +
    'textarea{width:100%;box-sizing:border-box;height:54px;resize:vertical;border-radius:7px;border:1px solid #374151;background:#1f2937;color:#f9fafb;font:12px/1.4 Consolas,monospace;padding:6px}' +
    '.row{display:flex;gap:6px;align-items:center;margin-top:8px}.grow{flex:1;color:#9ca3af;font-size:12px}' +
    'button{all:unset;padding:6px 10px;border-radius:7px;cursor:pointer;background:#374151;color:#f9fafb}button:hover{background:#4b5563}' +
    'button.primary{background:#dc2626}button.primary:hover{background:#b91c1c}button:disabled{opacity:.4;cursor:default}' +
    '</style><div class="boxes"></div><div class="panel" hidden>' +
    '<div><b>Hide an element</b></div><div class="hint">Point at what you want to hide and click. Use Wider/Narrower to adjust. Esc cancels.</div>' +
    '<textarea spellcheck="false" aria-label="CSS selector"></textarea>' +
    '<div class="row"><span class="grow"></span><button data-a="wider" title="Choose the enclosing element">Wider</button><button data-a="narrower" title="Back to the inner element">Narrower</button></div>' +
    '<div class="row"><span class="grow"></span><button data-a="cancel">Cancel</button><button class="primary" data-a="hide">Hide</button></div></div>';
  const boxes = root.querySelector('.boxes');
  const panel = root.querySelector('.panel');
  const ta = root.querySelector('textarea');
  const info = root.querySelector('.row .grow');
  let chain = [], level = 0, picked = false;

  const stableClass = c => c.length < 32 && !/\d{4,}|[A-Za-z0-9]{12,}_|^(css|sc|jsx|svelte)-[a-z0-9]+$/i.test(c) && !/^(hover|active|focus|is-|has-)/.test(c);
  function selectorFor(el) {
    if (el.id && !/\d{3,}/.test(el.id) && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id);
    const parts = [];
    let cur = el;
    for (let depth = 0; cur && cur.nodeType === 1 && cur !== document.documentElement && depth < 5; depth++) {
      let part = cur.tagName.toLowerCase();
      if (cur.id && !/\d{3,}/.test(cur.id)) { parts.unshift('#' + CSS.escape(cur.id) + ' >'); break; }
      const cls = [...cur.classList].filter(stableClass).slice(0, 3);
      if (cls.length) part += '.' + cls.map(c => CSS.escape(c)).join('.');
      const sib = cur.parentElement ? [...cur.parentElement.children].filter(x => x.tagName === cur.tagName) : [];
      const sel = [part, ...parts].join(' > ').replace(/ > > /g, ' > ');
      if (document.querySelectorAll(sel).length === 1) { parts.unshift(part); break; }
      if (!cls.length && sib.length > 1) part += ':nth-of-type(' + (sib.indexOf(cur) + 1) + ')';
      parts.unshift(part);
      cur = cur.parentElement;
    }
    return parts.join(' > ').replace(/> >/g, '>').replace(/^> /, '');
  }
  function draw(els, cls) {
    boxes.innerHTML = '';
    for (const e of els.slice(0, 200)) {
      const r = e.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      const b = document.createElement('div');
      b.className = 'box ' + (cls || '');
      b.style.cssText = 'left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px';
      boxes.appendChild(b);
    }
  }
  function under(x, y) {
    host.style.pointerEvents = 'none';
    const el = document.elementFromPoint(x, y);
    host.style.pointerEvents = '';
    return el && el !== document.documentElement && el !== document.body ? el : null;
  }
  function preview() {
    let els = [];
    try { els = [...document.querySelectorAll(ta.value)]; } catch (e) { info.textContent = 'Not a valid selector'; draw([]); root.querySelector('[data-a=hide]').disabled = true; return; }
    root.querySelector('[data-a=hide]').disabled = !els.length;
    info.textContent = els.length === 1 ? 'Matches 1 element' : 'Matches ' + els.length + ' elements';
    draw(els, 'match');
  }
  function choose(el) {
    chain = []; for (let c = el; c && c !== document.body && c !== document.documentElement; c = c.parentElement) chain.push(c);
    level = 0; picked = true; panel.hidden = false; update();
  }
  function update() { ta.value = selectorFor(chain[level]); preview(); }
  function finish(v) {
    document.removeEventListener('keydown', onKey, true);
    host.remove(); window.__fernaPicking = false; resolve(v);
  }
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); } }

  host.addEventListener('mousemove', e => {
    if (picked || !e.isTrusted) return;
    const el = under(e.clientX, e.clientY);
    draw(el ? [el] : []);
  });
  // Panel buttons: listened to inside the closed shadow root (outside it, the path is hidden).
  panel.addEventListener('click', e => {
    e.stopPropagation();
    if (!e.isTrusted) return;
    const b = e.target.closest('[data-a]');
    if (!b) return;
    if (b.dataset.a === 'cancel') finish(null);
    else if (b.dataset.a === 'hide') { try { if (document.querySelectorAll(ta.value).length) finish(ta.value.trim()); } catch (err) { /* invalid */ } }
    else if (b.dataset.a === 'wider' && level < chain.length - 1) { level++; update(); }
    else if (b.dataset.a === 'narrower' && level > 0) { level--; update(); }
  });
  panel.addEventListener('mousemove', e => e.stopPropagation());
  // Anywhere else: pick the element under the pointer.
  host.addEventListener('click', e => {
    if (!e.isTrusted) return;
    e.preventDefault();
    const el = under(e.clientX, e.clientY);
    if (el) choose(el);
  });
  ta.addEventListener('input', preview);
  document.addEventListener('keydown', onKey, true);
  document.documentElement.appendChild(host);
  if (at && Number.isFinite(at.x)) { const el = under(at.x, at.y); if (el) choose(el); }
})`;

const script = at => `(${SCRIPT})(${JSON.stringify(at && Number.isFinite(at.x) ? { x: Math.round(at.x), y: Math.round(at.y) } : null)})`;

module.exports = { WORLD, SCRIPT, script };
