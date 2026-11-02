'use strict';
// Password warning: when you click into a password field on a page that is not encrypted, or
// on a site you have never visited before, a small note appears above the field. New phishing
// sites are usually both new to you and not yet on any list. Isolated world, closed shadow root.

const WORLD = 7790;

const SCRIPT = String.raw`(() => {
  if (window.__fernaPw) return;
  const S = { on: true, insecure: false, firstVisit: false, host: location.hostname };
  let shown = false, host = null;
  function note(field) {
    if (!S.on || shown || (!S.insecure && !S.firstVisit)) return;
    shown = true;
    host = document.createElement('ferna-password-note');
    host.style.cssText = 'all:initial;position:absolute;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'closed' });
    const danger = S.insecure;
    const text = danger
      ? '<b>This page is not secure.</b> Your password would be sent unencrypted, so others on the network could read it. Do not enter it here.'
      : '<b>First visit to ' + S.host.replace(/[<&"]/g, '') + '.</b> Check the address carefully before you sign in. Fake sites copy real sign-in pages.';
    root.innerHTML = '<style>:host{all:initial}.n{max-width:340px;display:flex;gap:8px;align-items:flex-start;padding:9px 11px;border-radius:9px;' +
      'font:12.5px/1.45 "Segoe UI",system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.22);color:#fff;background:' + (danger ? '#b3261e' : '#1f2937') + '}' +
      'b{font-weight:600}button{all:unset;cursor:pointer;opacity:.8;padding:0 2px;font-size:15px;line-height:1}button:hover{opacity:1}' +
      '.a{position:absolute;left:18px;bottom:-6px;width:12px;height:12px;transform:rotate(45deg);background:' + (danger ? '#b3261e' : '#1f2937') + '}</style>' +
      '<div class="n" role="alert"><span>' + text + '</span><button aria-label="Dismiss">×</button></div><div class="a"></div>';
    root.querySelector('button').addEventListener('click', e => { if (e.isTrusted) host.remove(); });
    (document.body || document.documentElement).appendChild(host);
    const r = field.getBoundingClientRect();
    const h = host.offsetHeight || 60;
    host.style.left = Math.max(4, r.left + scrollX) + 'px';
    host.style.top = Math.max(4, r.top + scrollY - h - 10) + 'px';
    setTimeout(() => { if (host && host.isConnected) host.remove(); }, 15000);
  }
  document.addEventListener('focusin', e => {
    const t = e.target;
    if (e.isTrusted && t && t.tagName === 'INPUT' && t.type === 'password') note(t);
  }, true);
  window.__fernaPw = { config(c) { Object.assign(S, c); } };
})();`;

async function apply(wc, cfg) {
  if (!wc || wc.isDestroyed()) return;
  await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: SCRIPT }]);
  await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: `window.__fernaPw.config(${JSON.stringify(cfg)})` }]);
}

module.exports = { WORLD, SCRIPT, apply };
