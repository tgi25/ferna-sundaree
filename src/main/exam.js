'use strict';
// Secure Exam Mode: a locked-down window for online examinations.
//   • Set up by the instructor (Menu → Secure exam mode): start address, allowed sites, time limit,
//     copy/paste and spell-check, and an invigilator password (only its scrypt hash is kept, so an
//     exam file can be handed to students).
//   • The exam window fills the screen (kiosk), stays on top, cannot be closed, has no tabs,
//     address bar, menu, new windows, developer tools, downloads or other browser features, and
//     cannot be captured by screenshot or screen-sharing tools (Windows display affinity).
//   • Only the allowed sites open; everything else is blocked and logged.
//   • Leaving the window (Alt+Tab, Windows key) is noticed: the window comes straight back and the
//     event is logged. Windows reserves some keys (Ctrl+Alt+Del, Win+L) that no app can block.
//   • Ends with the invigilator's password (End exam, or Ctrl+Alt+Shift+E), or when time runs out.
//     A log (start, end, times the window was left, blocked addresses) is saved.

const fs = require('fs');
const path = require('path');
const { dialog } = require('electron');
const secret = require('./secret');

function cleanConfig(c) {
  if (!c || typeof c !== 'object') throw new Error('No exam settings');
  let url;
  try { url = new URL(String(c.url || '').trim()); } catch { throw new Error('Enter the exam address (https://…)'); }
  if (!/^https?:$/.test(url.protocol)) throw new Error('The exam address must start with https://');
  const allowed = (Array.isArray(c.allowed) ? c.allowed : String(c.allowed || '').split(/[\s,]+/))
    .map(x => String(x).trim().toLowerCase()).filter(Boolean).filter(x => /^(https?:\/\/)?(\*\.)?(([a-z0-9-]+\.)+[a-z0-9-]+|localhost)(:\d+)?(\/\S*)?$/.test(x)).slice(0, 100);
  const minutes = Math.max(0, Math.min(600, Math.round(Number(c.minutes) || 0)));
  return { format: 'ferna-exam', v: 1, title: String(c.title || 'Exam').trim().slice(0, 80) || 'Exam', url: url.href, allowed, minutes, allowCopy: !!c.allowCopy, allowSpell: !!c.allowSpell, password: c.password };
}

/** Is this address allowed in the exam? The exam's own site always is. */
function allowedUrl(cfg, u) {
  let x;
  try { x = new URL(u); } catch { return false; }
  if (x.protocol === 'about:' || x.protocol === 'data:' || x.protocol === 'blob:') return true;
  if (!/^https?:$/.test(x.protocol)) return false;
  const host = x.hostname.toLowerCase();
  const examHost = new URL(cfg.url).hostname.toLowerCase();
  if (host === examHost) return true;
  for (const p of cfg.allowed || []) {
    const m = /^(?:(https?):\/\/)?(\*\.)?([a-z0-9.-]+)(?::(\d+))?(\/\S*)?$/.exec(p);
    if (!m) continue;
    const [, scheme, wild, h, port, pathPrefix] = m;
    if (scheme && `${scheme}:` !== x.protocol) continue;
    if (port && port !== x.port) continue;
    const hostOk = wild ? (host === h || host.endsWith(`.${h}`)) : host === h || host === `www.${h}`;
    if (!hostOk) continue;
    if (pathPrefix && !x.pathname.startsWith(pathPrefix)) continue;
    return true;
  }
  return false;
}

// Browser commands that stay available in the exam window.
const ALLOWED_CMDS = new Set(['reload', 'back', 'forward', 'zoomIn', 'zoomOut', 'zoomReset', 'find', 'escape']);

function install(ctx, { dataDir }) {
  const logDir = path.join(dataDir, 'exam-logs');

  function start(cfgIn) {
    if (ctx.examWin && !ctx.examWin.win.isDestroyed()) { ctx.examWin.win.focus(); return { ok: false, error: 'An exam is already running.' }; }
    const cfg = cleanConfig(cfgIn);
    if (cfgIn.passwordHash && secret.valid(cfgIn.passwordHash)) cfg.passwordHash = cfgIn.passwordHash;
    else if (typeof cfg.password === 'string' && cfg.password.length >= 4) cfg.passwordHash = secret.hash(cfg.password);
    else throw new Error('Set an invigilator password (at least 4 characters).');
    delete cfg.password;
    const ses = ctx.newPrivateSession();
    ses.on('will-download', e => { e.preventDefault(); });
    const log = { title: cfg.title, url: cfg.url, started: new Date().toISOString(), ended: null, endedBy: null, leftWindow: [], blocked: [], wrongPasswords: 0 };
    cfg.endsAt = cfg.minutes ? Date.now() + cfg.minutes * 60000 : 0;
    // Hide every other browser window for the length of the exam.
    const hidden = ctx.windows.filter(w => !w.win.isDestroyed() && w.win.isVisible());
    for (const w of hidden) w.win.hide();
    const win = ctx.newWindow({ private: true, session: ses, url: cfg.url, exam: cfg, app: { url: cfg.url, origin: new URL(cfg.url).origin, name: cfg.title } });
    win.examLog = log;
    win.examHidden = hidden;
    ctx.examWin = win;
    const lock = () => {
      if (win.win.isDestroyed() || win.examUnlocked) return;
      win.win.setKiosk(true);
      win.win.setAlwaysOnTop(true, 'screen-saver');
      win.win.setContentProtection(true);
    };
    lock();
    win.win.on('close', e => { if (!win.examUnlocked) e.preventDefault(); });
    win.win.on('blur', () => {
      if (win.examUnlocked) return;
      log.leftWindow.push(new Date().toISOString());
      if (!ctx.testExamNoRefocus) setTimeout(() => { if (!win.win.isDestroyed() && !win.examUnlocked) { lock(); win.win.show(); win.win.moveTop(); win.win.focus(); } }, 150);
      win.sendUi('toast', { text: 'Leaving the exam window is recorded.' });
    });
    win.win.on('minimize', () => { if (!win.examUnlocked) setTimeout(() => { if (!win.win.isDestroyed()) win.win.restore(); }, 50); });
    if (cfg.endsAt) {
      win.examTimer = setInterval(() => {
        const left = cfg.endsAt - Date.now();
        if (left <= 60000 && !win.warned) { win.warned = true; win.sendUi('toast', { text: 'One minute left. Submit your answers now.' }); }
        if (left <= 0) finish(win, 'time');
      }, 1000);
    }
    return { ok: true, windowId: win.id };
  }

  function finish(win, reason) {
    if (!win || win.examUnlocked) return null;
    win.examUnlocked = true;
    clearInterval(win.examTimer);
    const log = win.examLog;
    log.ended = new Date().toISOString();
    log.endedBy = reason;
    let file = null;
    try { fs.mkdirSync(logDir, { recursive: true }); file = path.join(logDir, `exam-${log.started.replace(/[:.]/g, '-')}.json`); fs.writeFileSync(file, JSON.stringify(log, null, 2)); } catch { file = null; }
    if (!win.win.isDestroyed()) {
      win.win.setContentProtection(false);
      win.win.setAlwaysOnTop(false);
      win.win.setKiosk(false);
      win.win.close();
    }
    ctx.examWin = null;
    for (const w of win.examHidden || []) if (!w.win.isDestroyed()) w.win.show();
    const mins = Math.round((Date.parse(log.ended) - Date.parse(log.started)) / 60000);
    if (!ctx.testExamNoDialog) {
      dialog.showMessageBox({ type: 'info', title: 'Exam ended', noLink: true, buttons: ['OK'],
        message: `${log.title}: ${reason === 'time' ? 'time is up' : 'ended by the invigilator'} after ${mins} minute${mins === 1 ? '' : 's'}.`,
        detail: `Left the exam window: ${log.leftWindow.length} time${log.leftWindow.length === 1 ? '' : 's'}\nBlocked addresses: ${log.blocked.length}\nWrong passwords: ${log.wrongPasswords}${file ? `\n\nLog saved to ${file}` : ''}` }).catch(() => {});
    }
    return { log, file };
  }

  function unlock(win, password) {
    if (!win || !win.exam) return false;
    if (!secret.verify(password, win.exam.passwordHash)) { win.examLog.wrongPasswords++; return false; }
    finish(win, 'invigilator');
    return true;
  }

  /** Keys inside the exam window. Returns true when the key was dealt with (blocked). */
  ctx.examKey = (win, e, input, cmd) => {
    if (input.type !== 'keyDown' && input.type !== 'rawKeyDown') return false;
    const k = String(input.key || '').toLowerCase();
    if (input.control && input.alt && input.shift && k === 'e') { e.preventDefault(); win.openOverlay('exampw', { title: win.exam.title }); return true; }
    if (!win.exam.allowCopy && (input.control || input.meta) && ['c', 'v', 'x', 'insert'].includes(k)) { e.preventDefault(); return true; }
    if (!win.exam.allowCopy && input.shift && k === 'insert') { e.preventDefault(); return true; }
    if (k === 'f12' || (input.control && input.shift && ['i', 'j', 'c'].includes(k)) || (input.control && ['p', 's', 'o', 'u', 'n', 't', 'w', 'l', 'h', 'j', 'd', 'k'].includes(k)) || k === 'f11' || (input.alt && k === 'f4') || k === 'f6' || k === 'printscreen') { e.preventDefault(); return true; }
    if (cmd && !ALLOWED_CMDS.has(cmd)) { e.preventDefault(); return true; }
    return false;
  };
  ctx.examAllowed = (win, url) => allowedUrl(win.exam, url);
  ctx.examBlocked = (win, url) => {
    win.examLog.blocked.push({ at: new Date().toISOString(), url: String(url).slice(0, 500) });
    win.sendUi('toast', { text: 'That site is not allowed during this exam.' });
  };

  function register(C) {
    C('exam:start', ['object'], ['exam'], (c, cfg) => { try { return start(cfg); } catch (e) { return { ok: false, error: e.message }; } });
    C('exam:save-file', ['object'], ['exam'], async (c, cfgIn) => {
      let cfg;
      try { cfg = cleanConfig(cfgIn); } catch (e) { return { ok: false, error: e.message }; }
      if (typeof cfg.password !== 'string' || cfg.password.length < 4) return { ok: false, error: 'Set an invigilator password (at least 4 characters).' };
      cfg.passwordHash = secret.hash(cfg.password);
      delete cfg.password;
      const w = ctx.windowFor(c.wc);
      const r = await dialog.showSaveDialog(w.win, { title: 'Save exam file', defaultPath: `${cfg.title.replace(/[\\/:*?"<>|]/g, '')}.fernaexam`, filters: [{ name: 'Ferna exam', extensions: ['fernaexam'] }] });
      if (r.canceled || !r.filePath) return { ok: false };
      fs.writeFileSync(r.filePath, JSON.stringify(cfg, null, 2));
      return { ok: true, file: r.filePath };
    });
    C('exam:open-file', [], ['exam'], async c => {
      const w = ctx.windowFor(c.wc);
      const r = await dialog.showOpenDialog(w.win, { title: 'Open exam file', properties: ['openFile'], filters: [{ name: 'Ferna exam', extensions: ['fernaexam'] }] });
      if (r.canceled || !r.filePaths[0]) return { ok: false };
      return ctx.startExamFile(r.filePaths[0]);
    });
    C('exam:end-prompt', [], ['ui'], c => { const w = ctx.windowFor(c.wc); if (w && w.exam) w.openOverlay('exampw', { title: w.exam.title }); return true; });
    C('exam:unlock', ['string'], ['overlay'], (c, pw) => unlock(ctx.windowFor(c.wc), pw));
    C('exam:logs', [], ['exam'], () => { try { return fs.readdirSync(logDir).filter(f => f.endsWith('.json')).sort().reverse().slice(0, 30).map(f => JSON.parse(fs.readFileSync(path.join(logDir, f), 'utf8'))); } catch { return []; } });
  }

  ctx.startExamFile = file => {
    try {
      const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (cfg.format !== 'ferna-exam' || !secret.valid(cfg.passwordHash)) return { ok: false, error: 'This is not a valid Ferna exam file.' };
      return start(cfg);
    } catch (e) { return { ok: false, error: e.message }; }
  };
  ctx.exam = { start, finish, unlock, register, allowedUrl };
}

module.exports = { install, cleanConfig, allowedUrl, ALLOWED_CMDS };
