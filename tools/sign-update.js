#!/usr/bin/env node
'use strict';
// Writes dist/update.json (version + SHA-256 of each installer) and dist/update.json.sig
// (Ed25519 signature) for a release. The private key comes from the environment variable
// UPDATE_SIGNING_KEY (PEM text, as stored in the GitHub secret) or from a file path argument.
//   UPDATE_SIGNING_KEY="$(cat update-signing-key.pem)" node tools/sign-update.js
//   node tools/sign-update.js update-signing-key.pem
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const pkg = require(path.join(ROOT, 'package.json'));
const pem = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : process.env.UPDATE_SIGNING_KEY;
if (!pem) { console.error('No signing key: set UPDATE_SIGNING_KEY or pass the key file.'); process.exit(1); }
const v = pkg.version;
const want = { setup: `FernaSundaree-Setup-${v}.exe`, msi: `FernaSundaree-${v}-x64.msi`, portable: `FernaSundaree-Portable-${v}.exe` };
// Linux packages (electron-builder artifactName FernaSundaree-${version}-${arch}.${ext}).
for (const arch of ['x64', 'arm64']) {
  want[`appimage-${arch}`] = `FernaSundaree-${v}-${arch}.AppImage`;
  want[`deb-${arch}`] = `FernaSundaree-${v}-${arch}.deb`;
  want[`rpm-${arch}`] = `FernaSundaree-${v}-${arch}.rpm`;
  want[`tar-${arch}`] = `FernaSundaree-${v}-${arch}.tar.gz`;
}
const files = {};
for (const [k, name] of Object.entries(want)) {
  const p = path.join(DIST, name);
  if (!fs.existsSync(p)) continue;
  files[k] = { name, size: fs.statSync(p).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') };
}
if (!Object.keys(files).length) { console.error('No installers in dist/'); process.exit(1); }
const manifest = Buffer.from(JSON.stringify({ product: 'ferna-sundaree', version: v, date: new Date().toISOString(), notes: process.env.RELEASE_NOTES || '', files }, null, 2));
const sig = crypto.sign(null, manifest, crypto.createPrivateKey(pem)).toString('base64');
const pub = require(path.join(ROOT, 'src', 'main', 'update-key.js'));
if (!crypto.verify(null, manifest, crypto.createPublicKey(pub), Buffer.from(sig, 'base64'))) { console.error('This key does not match src/main/update-key.js — refusing to sign.'); process.exit(1); }
fs.writeFileSync(path.join(DIST, 'update.json'), manifest);
fs.writeFileSync(path.join(DIST, 'update.json.sig'), sig + '\n');
console.log(`Signed update.json for ${v}: ${Object.values(files).map(f => f.name).join(', ')}`);
