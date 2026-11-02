'use strict';
// Test harness: launches Ferna Sundaree under Playwright's Electron driver on a private
// X display, serves the fixtures over HTTP, and takes whole-window screenshots.

const { _electron: electron } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const FIX = path.join(ROOT, 'test', 'fixtures');

function serve() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const rel = req.url.startsWith('/document') ? '/test.pdf' : decodeURIComponent(req.url.split('?')[0]);
      const p = path.join(FIX, rel);
      if (!p.startsWith(FIX) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
      const type = p.endsWith('.pdf') ? 'application/pdf' : p.endsWith('.html') ? 'text/html; charset=utf-8' : p.endsWith('.webm') ? 'video/webm' : 'application/octet-stream';
      const headers = { 'content-type': type };
      if (req.url.includes('nopdfext')) headers['content-type'] = 'application/pdf';
      res.writeHead(200, headers);
      res.end(fs.readFileSync(p));
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

let xvfb = null;
function startDisplay(n = 77) {
  xvfb = spawn('Xvfb', [`:${n}`, '-screen', '0', '1400x900x24', '-nolisten', 'tcp'], { stdio: 'ignore' });
  execFileSync('sleep', ['1']);
  return `:${n}`;
}

// As root, run Electron as an unprivileged user so the Chromium sandbox stays on.
const AS_USER = process.getuid && process.getuid() === 0 && (() => { try { execFileSync('id', ['tester'], { stdio: 'ignore' }); return 'tester'; } catch { return null; } })();

/** Give the test user ownership of a path the app must write. */
function own(p) { if (AS_USER) execFileSync('chown', ['-R', AS_USER, p]); return p; }

async function launch(profileDir, extraEnv = {}) {
  const display = process.env.DISPLAY_TEST || startDisplay();
  own(profileDir);
  const sandboxed = !!AS_USER || !(process.getuid && process.getuid() === 0);
  const app = await electron.launch({
    executablePath: AS_USER ? path.join(__dirname, 'as-user.sh') : path.join(ROOT, 'node_modules', '.bin', 'electron'),
    args: sandboxed ? [ROOT] : ['--no-sandbox', ROOT],
    env: {
      ...process.env, DISPLAY: display, NODE_OPTIONS: '', FERNA_TEST: '1', FERNA_TEST_NO_SANDBOX: sandboxed ? '' : '1', HOME: AS_USER ? `/home/${AS_USER}` : process.env.HOME,
      FERNA_SUNDAREE_DATA: profileDir, FERNA_NO_RESTORE: extraEnv.restore ? '' : '1', ...extraEnv,
    },
  });
  return { app, display };
}

function screenshot(display, file) {
  execFileSync('import', ['-display', display, '-window', 'root', file]);
  return file;
}

function stop() { if (xvfb) xvfb.kill(); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Poll fn() until it returns truthy (or time out). */
async function until(fn, ms = 8000, what = 'condition') {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (e) { last = e; }
    await sleep(120);
  }
  throw new Error(`Timed out waiting for ${what}${last instanceof Error ? `: ${last.message}` : ''}`);
}

module.exports = { serve, launch, screenshot, stop, sleep, until, own, ROOT, FIX, AS_USER };
