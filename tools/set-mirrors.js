#!/usr/bin/env node
'use strict';
// Writes the public update-mirror folders into package.json ("fernaUpdateMirrors") before a
// release build, so installed copies also look there for updates (not only on GitHub).
//   node tools/set-mirrors.js "https://updates.example.org/ferna-sundaree/latest/,https://…"
// Empty argument = no mirrors. Run in CI only; the repository copy stays without mirrors.
const fs = require('fs');
const path = require('path');
const PKG = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
const list = String(process.argv[2] || '').split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
const bad = list.filter(u => !/^https:\/\/[^\s/?#@]+\/[^\s?#@]*$/.test(u));
if (bad.length) { console.error(`Not a plain https folder address: ${bad.join(', ')}`); process.exit(1); }
pkg.fernaUpdateMirrors = list.map(u => (u.endsWith('/') ? u : `${u}/`));
fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n');
console.log(`Update mirrors: ${pkg.fernaUpdateMirrors.join(', ') || '(none)'}`);
