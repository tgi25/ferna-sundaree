#!/usr/bin/env node
'use strict';
// Fails the build on high or critical advisories in shipped (non-dev) dependencies, except
// ones listed in audit-allow.json with the reason they cannot reach users.
//   node tools/audit.js
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const allow = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'audit-allow.json'), 'utf8'));
let out;
try { out = execFileSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8', shell: process.platform === 'win32' }); } catch (e) { out = e.stdout; }
const report = JSON.parse(out || '{}');
const bad = [];
for (const [name, v] of Object.entries(report.vulnerabilities || {})) {
  if (!['high', 'critical'].includes(v.severity)) continue;
  if (allow[name]) { console.log(`allowed: ${name} (${v.severity}) — ${allow[name].reason}`); continue; }
  bad.push(`${name} (${v.severity})`);
}
if (bad.length) { console.error(`Vulnerable shipped dependencies: ${bad.join(', ')}`); process.exit(1); }
console.log('No unhandled high or critical advisories in shipped dependencies.');
