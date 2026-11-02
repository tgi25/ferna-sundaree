'use strict';
// Password manager and autofill in the page, in an isolated world (7791): the page cannot see
// this code, the list it shows, or any value before it is filled.
//   SCAN: finds sign-in, sign-up, address and card fields; shows a small list under a field when
//   you click into it (saved accounts, "Suggest strong password", addresses, cards); resolves
//   with what you picked, or with the username and password when a sign-in form is submitted.
//   The browser calls SCAN again after handling each answer (one answer per call).
//   FILL_*: put values into the fields of the form you were in.

const WORLD = 7791;

const SCAN = cfg => String.raw`(() => {
  const cfg = ${JSON.stringify(cfg)};
  const st = window.__fpw || (window.__fpw = { attached: new WeakSet(), queue: [], resolve: null, target: null, last: '', host: null, mo: null });
  st.cfg = cfg;
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const ac = el => String(el.getAttribute('autocomplete') || '').toLowerCase();
  const label = el => [el.name, el.id, el.placeholder, el.getAttribute('aria-label'), (el.labels && el.labels[0] && el.labels[0].textContent) || ''].join(' ').toLowerCase();
  const ADDR = [
    ['given', /given-name/, /first.?name|fname|given/], ['family', /family-name/, /last.?name|lname|surname|family/],
    ['name', /^(.* )?name$/, /full.?name|^name$|your.?name/], ['org', /organization/, /company|organi[sz]ation/],
    ['email', /email/, /e-?mail/], ['tel', /tel/, /phone|mobile|tel/],
    ['line1', /address-line1|street-address/, /address.?(line)?.?1|street|addr1|^address$/], ['line2', /address-line2/, /address.?(line)?.?2|addr2|apartment|suite/],
    ['city', /address-level2/, /city|town/], ['state', /address-level1/, /state|province|region|county/],
    ['postal', /postal-code/, /zip|postal|post.?code/], ['country', /country/, /country/],
  ];
  const CARD = [['number', /cc-number/, /card.?(number|no)|cc.?num|cardnum/], ['name', /cc-name/, /name.?on.?card|card.?holder|cc.?name/],
    ['exp', /cc-exp$/, /expir|exp.?date|mm.?yy/], ['month', /cc-exp-month/, /exp.?month|cc.?month/], ['year', /cc-exp-year/, /exp.?year|cc.?year/]];
  const kindOf = el => {
    if (el.type === 'password') return { kind: 'login' };
    if (!/^(text|email|tel|number|search|)$/.test(el.type || '') && el.tagName !== 'SELECT') return null;
    const a = ac(el), l = label(el);
    if (a === 'off' && !l) return null;
    for (const [k, ra, rl] of CARD) if (ra.test(a) || (!a.startsWith('cc') && !a && rl.test(l))) return { kind: 'card', field: k };
    if (/username|email/.test(a) || /user.?name|login|e-?mail/.test(l)) {
      const form = el.form || document;
      if (form.querySelector('input[type=password]')) return { kind: 'login', user: true };
    }
    for (const [k, ra, rl] of ADDR) if ((a && ra.test(a)) || (!a && rl.test(l))) return { kind: 'address', field: k };
    return null;
  };
  const answer = v => {
    if (st.resolve) { const r = st.resolve; st.resolve = null; r(v); } else if (st.queue.length < 5) st.queue.push(v);
  };

  function capture(scope) {
    const root = scope && scope.querySelectorAll ? scope : document;
    const pws = [...root.querySelectorAll('input[type=password]')].filter(x => x.value);
    if (!pws.length) return;
    let password = pws[0].value;
    const fresh = pws.filter(x => ac(x) === 'new-password');
    if (fresh.length) password = fresh[0].value;
    else if (pws.length >= 2 && pws[pws.length - 1].value === pws[pws.length - 2].value) password = pws[pws.length - 1].value;
    const inputs = [...root.querySelectorAll('input')];
    let user = inputs.find(x => /username|email/.test(ac(x)) && x.value);
    if (!user) {
      const before = inputs.slice(0, inputs.indexOf(pws[0])).reverse();
      user = before.find(x => /^(text|email|tel|)$/.test(x.type || '') && x.value && visible(x));
    }
    const username = user ? user.value.trim() : '';
    const key = username + '\u0000' + password;
    if (st.last === key) return;
    st.last = key;
    setTimeout(() => { if (st.last === key) st.last = ''; }, 4000);
    answer({ type: 'submit', username, password, signup: fresh.length > 0 || pws.length >= 2 });
  }

  function hideMenu() { if (st.host) { st.host.remove(); st.host = null; } }
  function showMenu(el, k) {
    hideMenu();
    const items = [];
    if (k.kind === 'login') {
      for (const a of cfg.accounts || []) items.push({ t: a.u || '(no username)', s: a.site, v: { type: 'fill', kind: 'login', i: a.i } });
      if (el.type === 'password' && cfg.canGenerate && (ac(el) === 'new-password' || !(cfg.accounts || []).length)) items.push({ t: 'Suggest a strong password', s: 'Ferna saves it when you submit', v: { type: 'generate' }, key: true });
    } else if (k.kind === 'address') {
      for (const a of cfg.addresses || []) items.push({ t: a.label, s: a.sub, v: { type: 'fill', kind: 'address', i: a.i } });
    } else if (k.kind === 'card') {
      for (const c of cfg.cards || []) items.push({ t: c.label, s: c.sub, v: { type: 'fill', kind: 'card', i: c.i } });
    }
    if (!items.length) return;
    items.push({ t: k.kind === 'login' ? 'Manage passwords…' : 'Manage autofill…', v: { type: 'manage' }, muted: true });
    const r = el.getBoundingClientRect();
    const host = document.createElement('ferna-autofill');
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;left:' + Math.round(r.left) + 'px;top:' + Math.round(r.bottom + 4) + 'px';
    const sr = host.attachShadow({ mode: 'closed' });
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    sr.innerHTML = '<style>.m{font:13px "Segoe UI",system-ui,sans-serif;min-width:' + Math.max(240, Math.round(r.width)) + 'px;max-width:420px;background:' + (dark ? '#172033' : '#fff') + ';color:' + (dark ? '#e5eaf3' : '#0f172a') + ';border:1px solid ' + (dark ? '#34425c' : '#d8dee9') + ';border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.25);padding:4px;}' +
      '.i{display:flex;flex-direction:column;padding:7px 10px;border-radius:7px;cursor:pointer}.i:hover{background:' + (dark ? 'rgba(255,255,255,.08)' : 'rgba(15,23,42,.06)') + '}.s{font-size:11px;opacity:.65}.k{color:#2563eb;font-weight:600}.mu{opacity:.7;border-top:1px solid ' + (dark ? '#263247' : '#e2e8f0') + ';border-radius:0;margin-top:2px}.h{font-size:11px;opacity:.6;padding:4px 10px 2px}</style>' +
      '<div class="m" role="listbox"><div class="h">Ferna Sundaree</div></div>';
    const m = sr.querySelector('.m');
    items.forEach(it => {
      const d = document.createElement('div');
      d.className = 'i' + (it.key ? ' k' : '') + (it.muted ? ' mu' : '');
      d.setAttribute('role', 'option');
      const t = document.createElement('span'); t.textContent = it.t; d.appendChild(t);
      if (it.s) { const s = document.createElement('span'); s.className = 's'; s.textContent = it.s; d.appendChild(s); }
      d.addEventListener('mousedown', e => {
        e.preventDefault(); e.stopPropagation();
        if (!e.isTrusted) return;
        st.target = el; hideMenu(); answer(it.v);
      });
      m.appendChild(d);
    });
    (document.body || document.documentElement).appendChild(host);
    st.host = host;
  }

  function attach() {
    for (const el of document.querySelectorAll('input, select')) {
      if (st.attached.has(el)) continue;
      const k = kindOf(el);
      if (!k) continue;
      st.attached.add(el);
      el.addEventListener('focus', e => { if (e.isTrusted) showMenu(el, k); });
      el.addEventListener('mousedown', e => { if (e.isTrusted && document.activeElement === el && !st.host) showMenu(el, k); });
      el.addEventListener('blur', () => setTimeout(hideMenu, 150));
      el.addEventListener('input', () => hideMenu());
      if (el.type === 'password') {
        el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.isTrusted) capture(el.form || null); });
        if (el.form && !st.attached.has(el.form)) {
          st.attached.add(el.form);
          el.form.addEventListener('submit', e => { if (e.isTrusted) capture(el.form); }, true);
        }
      }
    }
  }
  if (!st.clickHooked) {
    st.clickHooked = true;
    // Sign-in buttons that are not real form submits (single-page apps).
    document.addEventListener('click', e => {
      if (!e.isTrusted) return;
      const b = e.target && e.target.closest && e.target.closest('button, input[type=submit], input[type=button], [role=button], a');
      if (!b) return;
      const text = ((b.textContent || b.value || '') + ' ' + (b.getAttribute('aria-label') || '')).toLowerCase();
      if (b.type === 'submit' || /log ?in|sign ?in|sign ?up|register|continue|next|submit|create account|save|change password|update password/.test(text)) capture(b.form || b.closest('form') || null);
    }, true);
    window.addEventListener('scroll', () => { if (st.host) hideMenu(); }, { passive: true, capture: true });
    st.mo = new MutationObserver(() => { clearTimeout(st.moT); st.moT = setTimeout(attach, 300); });
    st.mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { if (st.mo) { st.mo.disconnect(); st.mo = null; } }, 120000);
  }
  attach();
  // Field already focused when the page loaded (sign-in pages often autofocus it).
  const f = document.activeElement;
  if (f && st.attached.has(f) && !st.host && cfg.showOnFocus) { const k = kindOf(f); if (k) showMenu(f, k); }
  if (st.queue.length) return Promise.resolve(st.queue.shift());
  const counts = { login: document.querySelectorAll('input[type=password]').length };
  return new Promise(res => { st.resolve = res; if (cfg.probe) { st.resolve = null; res({ type: 'probe', counts }); } });
})()`;

// Set a value the way typing would, so page frameworks (React, Angular, Vue) notice it.
const SETTER = `
  const setVal = (el, v) => {
    if (!el || v == null || v === '') return false;
    if (el.tagName === 'SELECT') {
      const want = String(v).toLowerCase();
      const o = [...el.options].find(o => o.value.toLowerCase() === want || o.textContent.trim().toLowerCase() === want);
      if (!o) return false;
      el.value = o.value;
    } else {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };`;

const FILL_LOGIN = (username, password) => String.raw`(() => {
  ${SETTER}
  const st = window.__fpw || {};
  const t = st.target && st.target.isConnected ? st.target : document.querySelector('input[type=password]');
  if (!t) return false;
  const scope = t.form || document;
  const pw = t.type === 'password' ? t : scope.querySelector('input[type=password]');
  const inputs = [...scope.querySelectorAll('input')];
  let user = inputs.find(x => /username|email/.test((x.getAttribute('autocomplete') || '').toLowerCase()));
  if (!user && pw) user = inputs.slice(0, inputs.indexOf(pw)).reverse().find(x => /^(text|email|tel|)$/.test(x.type || ''));
  if (t !== pw && t.type !== 'password') user = t;
  const u = ${JSON.stringify(username)}, p = ${JSON.stringify(password)};
  if (user && u) setVal(user, u);
  if (pw) setVal(pw, p);
  return true;
})()`;

const FILL_NEW = password => String.raw`(() => {
  ${SETTER}
  const st = window.__fpw || {};
  const t = st.target && st.target.isConnected ? st.target : document.querySelector('input[type=password]');
  if (!t) return false;
  const scope = t.form || document;
  const all = [...scope.querySelectorAll('input[type=password]')];
  const fresh = all.filter(x => (x.getAttribute('autocomplete') || '').toLowerCase() === 'new-password');
  const targets = fresh.length ? fresh : all.length >= 2 ? all.slice(-2) : [t];
  targets.forEach(x => setVal(x, ${JSON.stringify(password)}));
  return targets.length;
})()`;

const FILL_FIELDS = (kind, values) => String.raw`(() => {
  ${SETTER}
  const st = window.__fpw || {};
  const t = st.target && st.target.isConnected ? st.target : null;
  const scope = (t && t.form) || document;
  const v = ${JSON.stringify(values)};
  const ac = el => String(el.getAttribute('autocomplete') || '').toLowerCase();
  const label = el => [el.name, el.id, el.placeholder, el.getAttribute('aria-label'), (el.labels && el.labels[0] && el.labels[0].textContent) || ''].join(' ').toLowerCase();
  const MAP = ${kind === 'card'
    ? `[['number', /cc-number/, /card.?(number|no)|cc.?num|cardnum/], ['name', /cc-name/, /name.?on.?card|card.?holder|cc.?name/], ['exp', /cc-exp$/, /expir|exp.?date|mm.?yy/], ['month', /cc-exp-month/, /exp.?month|cc.?month/], ['year', /cc-exp-year/, /exp.?year|cc.?year/]]`
    : `[['given', /given-name/, /first.?name|fname|given/], ['family', /family-name/, /last.?name|lname|surname|family/], ['name', /^(.* )?name$/, /full.?name|^name$|your.?name/], ['org', /organization/, /company|organi[sz]ation/], ['email', /email/, /e-?mail/], ['tel', /tel/, /phone|mobile|tel/], ['line1', /address-line1|street-address/, /address.?(line)?.?1|street|addr1|^address$/], ['line2', /address-line2/, /address.?(line)?.?2|addr2|apartment|suite/], ['city', /address-level2/, /city|town/], ['state', /address-level1/, /state|province|region|county/], ['postal', /postal-code/, /zip|postal|post.?code/], ['country', /country/, /country/]]`};
  let n = 0;
  for (const el of scope.querySelectorAll('input, select')) {
    if (el.type === 'hidden' || el.type === 'password' || el.disabled || el.readOnly) continue;
    if (/cc-csc|cvc|cvv|security.?code/.test(ac(el) + ' ' + label(el))) continue; // never the security code
    const a = ac(el), l = label(el);
    for (const [k, ra, rl] of MAP) {
      if ((a && ra.test(a)) || (!a && rl.test(l))) { if (setVal(el, v[k])) n++; break; }
    }
  }
  return n;
})()`;

module.exports = { WORLD, SCAN, FILL_LOGIN, FILL_NEW, FILL_FIELDS };
