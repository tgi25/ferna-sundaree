'use strict';
// Built-in password manager and autofill.
//   Vault (logins, addresses, payment cards) encrypted with Windows DPAPI like the rest of the
//   profile; offers to save or update a password when you sign in; fills from a small list under
//   the field; suggests strong passwords; warns when a password you use elsewhere is typed into
//   a site you have never visited (phishing); checkup for weak, reused and leaked passwords
//   (leak check is optional and uses k-anonymity: 5 hash characters leave the PC).
//   Showing, copying or exporting a password, and filling a card, ask for Windows Hello / your
//   Windows PIN first (when Windows Hello is set up), then stay unlocked for 5 minutes.

const path = require('path');
const { execFile } = require('child_process');
const { clipboard, dialog, Menu, shell } = require('electron');
const PW = require('./pwcore');
const fx = require('./pagefx/pwfill');
const { JsonStore } = require('./store');

function create(ctx, { dataDir }) {
  const vault = new JsonStore(path.join(dataDir, 'vault.enc'), { logins: [], addresses: [], cards: [] }, { encrypt: true });
  const save = () => { vault.save(); ctx.notifyPages('passwords'); if (ctx.sync) ctx.sync.soon(); };
  const S = () => ctx.settings.data;
  const live = tab => tab && tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed() ? tab.view.webContents : null;
  const pending = new Map(); // token → { origin, username, password, update }
  let unlockedUntil = 0;

  // ---------- page integration ----------
  function pageCfg(tab) {
    const url = tab.url;
    const site = PW.siteOf(url);
    const accounts = S().passwordManager === false ? [] : PW.forPage(vault.data.logins, url).slice(0, 20)
      .map(l => ({ i: l.id, u: l.username, site: l.origin === PW.originOf(url) ? '' : new URL(l.origin).hostname }));
    const addresses = S().autofillAddresses === false ? [] : vault.data.addresses.map(a => ({ i: a.id, label: a.name || [a.given, a.family].filter(Boolean).join(' ') || a.email || 'Address', sub: [a.line1, a.city].filter(Boolean).join(', ') }));
    const cards = S().autofillCards === false || !/^https:/.test(url) ? [] : vault.data.cards.map(c => ({ i: c.id, label: `${PW.cardBrand(c.number)} •••• ${String(c.number).slice(-4)}`, sub: `${c.name || ''}${c.month ? ` · expires ${c.month}/${String(c.year).slice(-2)}` : ''}` }));
    tab.pwCount = accounts.length;
    return { accounts, addresses, cards, canGenerate: S().passwordManager !== false, showOnFocus: true, site };
  }

  function attach(win, tab) {
    const wc = live(tab);
    if (!wc || !/^https?:/i.test(tab.url || '')) return;
    if (S().passwordManager === false && S().autofillAddresses === false && S().autofillCards === false) return;
    const gen = (tab.pwGen = (tab.pwGen || 0) + 1);
    const url = tab.url;
    const loop = async () => {
      for (let guard = 0; guard < 200; guard++) {
        if (tab.pwGen !== gen || live(tab) !== wc) return;
        let r;
        try { r = await wc.executeJavaScriptInIsolatedWorld(fx.WORLD, [{ code: fx.SCAN(pageCfg(tab)) }], true); } catch { return; }
        if (!r || typeof r !== 'object') return;
        try { await handle(win, tab, wc, url, r); } catch (e) { console.error('passwords:', e); }
        if (r.type === 'submit' && tab.pwGen !== gen) return;
      }
    };
    win.pushState();
    loop();
  }

  async function handle(win, tab, wc, url, r) {
    const origin = PW.originOf(url);
    if (r.type === 'manage') { win.openInternal('ferna://passwords/'); return; }
    if (r.type === 'generate') {
      const pw = PW.generate(16);
      tab.generated = { origin, password: pw };
      await wc.executeJavaScriptInIsolatedWorld(fx.WORLD, [{ code: fx.FILL_NEW(pw) }], true).catch(() => {});
      win.sendUi('toast', { text: 'Strong password filled in. Ferna saves it when you submit the form.' });
      return;
    }
    if (r.type === 'fill' && r.kind === 'login') {
      const l = vault.data.logins.find(x => x.id === r.i);
      if (!l) return;
      l.used = Date.now(); vault.save();
      await wc.executeJavaScriptInIsolatedWorld(fx.WORLD, [{ code: fx.FILL_LOGIN(l.username, l.password) }], true).catch(() => {});
      return;
    }
    if (r.type === 'fill' && r.kind === 'address') {
      const a = vault.data.addresses.find(x => x.id === r.i);
      if (a) await wc.executeJavaScriptInIsolatedWorld(fx.WORLD, [{ code: fx.FILL_FIELDS('address', { ...a, name: a.name || [a.given, a.family].filter(Boolean).join(' ') }) }], true).catch(() => {});
      return;
    }
    if (r.type === 'fill' && r.kind === 'card') {
      const c = vault.data.cards.find(x => x.id === r.i);
      if (!c || !(await verifyUser(win, 'fill in your card details'))) return;
      const mm = String(c.month || '').padStart(2, '0'), yy = String(c.year || '');
      await wc.executeJavaScriptInIsolatedWorld(fx.WORLD, [{ code: fx.FILL_FIELDS('card', { number: c.number, name: c.name, month: mm, year: yy.length === 2 ? `20${yy}` : yy, exp: `${mm}/${yy.slice(-2)}` }) }], true).catch(() => {});
      return;
    }
    if (r.type === 'submit') onSubmit(win, tab, origin, String(r.username || '').slice(0, 500), String(r.password || '').slice(0, 1000));
  }

  function onSubmit(win, tab, origin, username, password) {
    if (!origin || !password || S().passwordManager === false || win.private) return;
    phishingCheck(win, origin, password);
    if ((S().passwordNever || []).includes(origin)) return;
    const logins = vault.data.logins;
    const same = logins.find(l => l.origin === origin && l.username === username);
    if (same && same.password === password) { same.used = Date.now(); vault.save(); return; }
    // A password Ferna generated for this form: save straight away.
    if (tab.generated && tab.generated.origin === origin && tab.generated.password === password) {
      tab.generated = null;
      if (same) { same.password = password; same.changed = Date.now(); } else logins.push({ id: PW.newId(), origin, username, password, created: Date.now(), used: Date.now(), changed: Date.now() });
      save();
      win.sendUi('toast', { text: `Password saved for ${new URL(origin).hostname}.` });
      return;
    }
    // Only the username changed on an account with no username: treat as the same account.
    const blank = !same && logins.find(l => l.origin === origin && !l.username && l.password === password);
    if (blank) { blank.username = username; save(); return; }
    const token = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    pending.set(token, { origin, username, password, update: !!same, at: Date.now() });
    for (const [k, v] of pending) if (Date.now() - v.at > 10 * 60000) pending.delete(k);
    const show = () => win.openOverlay('pwsave', { token, origin, host: new URL(origin).hostname, username, password, update: !!same, anchor: win.defaultAnchor('key', 420) });
    // Wait for the page that follows the sign-in to start, so the prompt is not covered.
    setTimeout(show, 700);
  }

  /** A password you saved for another site, typed into a site you have never been to: warn. */
  function phishingCheck(win, origin, password) {
    if (S().passwordWarnings === false) return;
    const site = PW.siteOf(origin);
    const elsewhere = vault.data.logins.filter(l => l.password === password && PW.siteOf(l.origin) !== site);
    if (!elsewhere.length || vault.data.logins.some(l => PW.siteOf(l.origin) === site)) return;
    if (ctx.visitedBefore && ctx.visitedBefore(origin)) return;
    const where = [...new Set(elsewhere.map(l => new URL(l.origin).hostname))].slice(0, 3).join(', ');
    dialog.showMessageBox(win.win, {
      type: 'warning', buttons: ['I understand'], noLink: true, title: 'Password used on another site',
      message: `You just entered the password you use on ${where}.`,
      detail: `${new URL(origin).hostname} is a site you have not visited before. If it is pretending to be ${where}, change that password now. Reusing a password lets one stolen password open several accounts.`,
    }).catch(() => {});
  }

  function answerSave(token, action, username) {
    const p = pending.get(token);
    if (!p) return false;
    pending.delete(token);
    if (action === 'never') { ctx.settings.set('passwordNever', [...new Set([...(S().passwordNever || []), p.origin])].slice(-2000)); return true; }
    if (action !== 'save') return true;
    const u = typeof username === 'string' ? username.slice(0, 500) : p.username;
    const hit = vault.data.logins.find(l => l.origin === p.origin && l.username === u);
    if (hit) { hit.password = p.password; hit.changed = Date.now(); }
    else vault.data.logins.push({ id: PW.newId(), origin: p.origin, username: u, password: p.password, created: Date.now(), used: Date.now(), changed: Date.now() });
    save();
    for (const w of ctx.windows) for (const t of w.tabs) if (t.url && PW.originOf(t.url) === p.origin) { pageCfg(t); w.pushState(); }
    return true;
  }

  async function fillGenerated(win, tab) {
    const wc = live(tab);
    if (!wc) return;
    const pw = PW.generate(16);
    tab.generated = { origin: PW.originOf(tab.url), password: pw };
    await wc.executeJavaScriptInIsolatedWorld(fx.WORLD, [{ code: `(() => { const st = window.__fpw || (window.__fpw = {}); st.target = document.activeElement; })()` }], true).catch(() => {});
    await wc.executeJavaScriptInIsolatedWorld(fx.WORLD, [{ code: fx.FILL_NEW(pw) }], true).catch(() => {});
    win.sendUi('toast', { text: 'Strong password filled in. It is saved when you submit the form.' });
  }

  // ---------- Windows Hello ----------
  const HELLO_PS = msg => `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
$avail = Await ([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()) ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])
if ($avail -ne 'Available') { Write-Output "unavailable:$avail"; exit 0 }
$r = Await ([Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync(${JSON.stringify(msg).replace(/\$/g, '`$')})) ([Windows.Security.Credentials.UI.UserConsentVerificationResult])
Write-Output "result:$r"`;
  function hello(msg) {
    // Linux: polkit asks for your account password (pkexec runs only /bin/true).
    if (process.platform === 'linux') {
      const pk = ['/usr/bin/pkexec', '/bin/pkexec'].find(p => { try { return require('fs').statSync(p).isFile(); } catch { return false; } });
      if (!pk || (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)) return Promise.resolve('unavailable:pkexec');
      return new Promise(resolve => execFile(pk, ['/bin/true'], { timeout: 120000 }, err => {
        if (!err) return resolve('result:Verified');
        // 126 = dismissed / not authorised; 127 = no polkit agent running
        resolve(err.code === 127 ? 'unavailable:agent' : 'result:Canceled');
      }));
    }
    if (process.platform !== 'win32') return Promise.resolve('unavailable:platform');
    return new Promise(resolve => {
      const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      execFile(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', HELLO_PS(msg)], { timeout: 120000, windowsHide: true }, (err, out) => {
        resolve(err ? 'unavailable:error' : String(out || '').trim().split(/\r?\n/).pop());
      });
    });
  }
  /** Ask who is at the PC before showing secrets. True when allowed. */
  async function verifyUser(win, what) {
    if (Date.now() < unlockedUntil) return true;
    if (ctx.testVerify) return ctx.testVerify(what);
    const r = await hello(`Ferna Sundaree wants to ${what}.`);
    if (r === 'result:Verified') { unlockedUntil = Date.now() + 5 * 60000; return true; }
    if (r.startsWith('result:')) return false; // cancelled or failed
    // No Windows Hello on this PC: confirm instead.
    const b = await dialog.showMessageBox(win && win.win, { type: 'question', buttons: ['Cancel', 'Continue'], defaultId: 0, cancelId: 0, noLink: true,
      title: 'Passwords', message: `Allow Ferna Sundaree to ${what}?`, detail: process.platform === 'linux' ? 'Install a polkit authentication agent (most desktops have one) so Ferna can ask for your account password here.' : 'Set up Windows Hello (PIN, fingerprint or face) in Windows Settings → Accounts → Sign-in options to protect your passwords with it.' });
    if (b.response === 1) { unlockedUntil = Date.now() + 5 * 60000; return true; }
    return false;
  }

  // ---------- management ----------
  function list() {
    const reuse = PW.reused(vault.data.logins);
    return vault.data.logins.map(l => ({
      id: l.id, origin: l.origin, host: (() => { try { return new URL(l.origin).hostname; } catch { return l.origin; } })(), username: l.username, note: l.note || '',
      created: l.created, used: l.used, changed: l.changed, strength: PW.strength(l.password), reused: reuse.get(l.id) || [], leaked: l.leaked || 0, length: l.password.length,
    })).sort((a, b) => a.host.localeCompare(b.host));
  }
  async function leakCheck() {
    const seen = new Map();
    let checked = 0, leaked = 0;
    for (const l of vault.data.logins) {
      const h = PW.sha1(l.password);
      const prefix = h.slice(0, 5);
      if (!seen.has(prefix)) {
        try {
          const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, { headers: { 'Add-Padding': 'true', 'user-agent': 'Ferna-Sundaree' }, signal: AbortSignal.timeout(15000) });
          seen.set(prefix, res.ok ? await res.text() : '');
        } catch { seen.set(prefix, null); }
      }
      const body = seen.get(prefix);
      if (body === null) continue;
      l.leaked = PW.pwnedCount(body, h);
      l.leakChecked = Date.now();
      checked++;
      if (l.leaked) leaked++;
    }
    vault.save();
    return { checked, leaked };
  }
  function siteMenu(win) {
    const t = win.active;
    if (!t) return null;
    const accts = PW.forPage(vault.data.logins, t.url);
    const items = accts.slice(0, 15).map(l => ({
      label: l.username || '(no username)', submenu: [
        { label: 'Copy username', click: () => clipboard.writeText(l.username) },
        { label: 'Copy password', click: async () => { if (await verifyUser(win, 'copy a password')) copySecret(l.password); } },
        { label: 'Fill in', click: async () => { const wc = live(t); if (wc) await wc.executeJavaScriptInIsolatedWorld(fx.WORLD, [{ code: fx.FILL_LOGIN(l.username, l.password) }], true).catch(() => {}); } },
      ],
    }));
    items.push({ type: 'separator' }, { label: 'Manage passwords…', click: () => win.openInternal('ferna://passwords/') });
    return Menu.buildFromTemplate(items);
  }
  function copySecret(text) {
    clipboard.writeText(text);
    // Clear it after 30 s if it still holds the password (the clipboard is asynchronous here).
    setTimeout(() => { Promise.resolve(clipboard.readText()).then(v => { if (v === text) clipboard.writeText(''); }).catch(() => {}); }, 30000);
  }

  function register(C) {
    const P = ['passwords'];
    C('pw:list', [], P, () => ({ logins: list(), never: S().passwordNever || [], settings: { passwordManager: S().passwordManager !== false, leakCheck: !!S().passwordLeakCheck, addresses: S().autofillAddresses !== false, cards: S().autofillCards !== false }, encrypted: require('./store').canEncrypt() }));
    C('pw:reveal', ['string'], P, async (c, id) => { const l = vault.data.logins.find(x => x.id === id); if (!l || !(await verifyUser(ctx.windowFor(c.wc), 'show a saved password'))) return null; return l.password; });
    C('pw:copy', ['string', 'string'], P, async (c, id, what) => {
      const l = vault.data.logins.find(x => x.id === id);
      if (!l) return false;
      if (what === 'username') { clipboard.writeText(l.username); return true; }
      if (!(await verifyUser(ctx.windowFor(c.wc), 'copy a saved password'))) return false;
      copySecret(l.password); return true;
    });
    C('pw:save-login', ['object'], P, async (c, o) => {
      const origin = PW.originOf(/^[a-z]+:\/\//i.test(o.origin || '') ? o.origin : `https://${o.origin || ''}`);
      if (!origin || typeof o.password !== 'string' || !o.password || o.password.length > 1000) return { ok: false, error: 'A site address and a password are needed.' };
      const username = String(o.username || '').slice(0, 500), note = String(o.note || '').slice(0, 2000);
      if (o.id) {
        const l = vault.data.logins.find(x => x.id === o.id);
        if (!l) return { ok: false };
        if (l.password !== o.password && !(await verifyUser(ctx.windowFor(c.wc), 'change a saved password'))) return { ok: false, error: 'Not verified' };
        Object.assign(l, { origin, username, note }); if (l.password !== o.password) { l.password = o.password; l.changed = Date.now(); }
      } else vault.data.logins.push({ id: PW.newId(), origin, username, password: o.password, note, created: Date.now(), used: 0, changed: Date.now() });
      save(); return { ok: true };
    });
    C('pw:delete', ['array'], P, (c, ids) => { const n = vault.data.logins.length; vault.data.logins = vault.data.logins.filter(l => !ids.includes(l.id)); save(); return n - vault.data.logins.length; });
    C('pw:generate', ['int?'], P, (c, n) => PW.generate(n || 16));
    C('pw:import-csv', ['text'], P, (c, text) => {
      try { const r = PW.importCsv(text); const m = PW.merge(vault.data.logins, r.logins); save(); return { ok: true, ...m, skipped: r.skipped, format: r.format }; } catch (e) { return { ok: false, error: e.message }; }
    });
    C('pw:export-csv', [], P, async c => {
      const w = ctx.windowFor(c.wc);
      if (!(await verifyUser(w, 'export your passwords'))) return false;
      const r = await dialog.showSaveDialog(w.win, { title: 'Export passwords', defaultPath: `Ferna Passwords ${new Date().toISOString().slice(0, 10)}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
      if (r.canceled || !r.filePath) return false;
      require('fs').writeFileSync(r.filePath, PW.exportCsv(vault.data.logins), { mode: 0o600 });
      return true;
    });
    C('pw:leak-check', [], P, () => leakCheck());
    C('pw:never-remove', ['string'], P, (c, o) => { ctx.settings.set('passwordNever', (S().passwordNever || []).filter(x => x !== o)); return true; });
    C('pw:passkeys', [], P, () => { if (process.platform === 'win32') shell.openExternal('ms-settings:savedpasskeys').catch(() => shell.openExternal('ms-settings:signinoptions')); return process.platform; });
    C('af:list', [], P, () => ({ addresses: vault.data.addresses, cards: vault.data.cards.map(c => ({ id: c.id, name: c.name, month: c.month, year: c.year, last4: String(c.number).slice(-4), brand: PW.cardBrand(c.number), nickname: c.nickname || '' })) }));
    C('af:save-address', ['object'], P, (c, a) => {
      const keys = ['name', 'given', 'family', 'org', 'email', 'tel', 'line1', 'line2', 'city', 'state', 'postal', 'country'];
      const clean = Object.fromEntries(keys.map(k => [k, String(a[k] || '').slice(0, 300)]));
      if (a.id) { const x = vault.data.addresses.find(y => y.id === a.id); if (!x) return false; Object.assign(x, clean); } else vault.data.addresses.push({ id: PW.newId(), ...clean });
      save(); return true;
    });
    C('af:delete-address', ['string'], P, (c, id) => { vault.data.addresses = vault.data.addresses.filter(x => x.id !== id); save(); return true; });
    C('af:save-card', ['object'], P, async (c, k) => {
      const number = String(k.number || '').replace(/\D/g, '');
      if (!k.id && !PW.luhn(number)) return { ok: false, error: 'That card number is not valid.' };
      const month = Number(k.month), year = Number(k.year);
      if (!(month >= 1 && month <= 12) || !(year >= 2000 && year <= 2100)) return { ok: false, error: 'Check the expiry date.' };
      if (k.id) { const x = vault.data.cards.find(y => y.id === k.id); if (!x) return { ok: false }; Object.assign(x, { name: String(k.name || '').slice(0, 200), month, year, nickname: String(k.nickname || '').slice(0, 60) }); if (number && PW.luhn(number)) x.number = number; }
      else vault.data.cards.push({ id: PW.newId(), number, name: String(k.name || '').slice(0, 200), month, year, nickname: String(k.nickname || '').slice(0, 60) });
      save(); return { ok: true };
    });
    C('af:delete-card', ['string'], P, (c, id) => { vault.data.cards = vault.data.cards.filter(x => x.id !== id); save(); return true; });
    C('pw:answer', ['string', 'string', 'string?'], ['overlay'], (c, token, action, username) => { const ok = answerSave(token, action, username); const w = ctx.windowFor(c.wc); if (w) w.closeOverlay(); return ok; });
    C('pw:site-menu', [], ['ui'], c => { const w = ctx.windowFor(c.wc); const m = siteMenu(w); if (m) m.popup({ window: w.win }); });
  }

  return { vault, attach, pageCfg, fillGenerated, verifyUser, register, answerSave, list, onSubmit, save };
}

module.exports = { create };
