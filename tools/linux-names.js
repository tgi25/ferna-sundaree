#!/usr/bin/env node
'use strict';
// electron-builder names Linux packages with each format's own architecture words
// (x86_64 / amd64 / aarch64). Rename them to FernaSundaree-<version>-<x64|arm64>.<ext>,
// which is what the update manifest (tools/sign-update.js) and the updater expect.
const fs = require('fs');
const path = require('path');
const DIST = path.join(__dirname, '..', 'dist');
const ARCH = { x86_64: 'x64', amd64: 'x64', x64: 'x64', aarch64: 'arm64', arm64: 'arm64' };
const re = /^FernaSundaree-(\d+\.\d+\.\d+(?:-[\w.]+)?)-(x86_64|amd64|x64|aarch64|arm64)\.(AppImage|deb|rpm|tar\.gz)$/;
for (const f of fs.readdirSync(DIST)) {
  const m = re.exec(f);
  if (!m) continue;
  const want = `FernaSundaree-${m[1]}-${ARCH[m[2]]}.${m[3]}`;
  if (want !== f) { fs.renameSync(path.join(DIST, f), path.join(DIST, want)); console.log(`${f} → ${want}`); }
}
