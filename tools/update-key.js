#!/usr/bin/env node
'use strict';
// Creates a new Ed25519 key pair for signing updates.
//   node tools/update-key.js            → writes update-signing-key.pem (PRIVATE, keep it secret)
//                                          and rewrites src/main/update-key.js with the public key.
// Put the private key into the GitHub secret UPDATE_SIGNING_KEY (whole PEM text) and keep an
// offline backup. Never commit it. Changing keys means copies built with the old public key
// will refuse updates signed with the new one (they would need one manual reinstall).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const out = process.argv[2] || path.join(ROOT, 'update-signing-key.pem');
if (fs.existsSync(out)) { console.error(`${out} exists; refusing to overwrite`); process.exit(1); }
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
fs.writeFileSync(out, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
const pub = publicKey.export({ type: 'spki', format: 'pem' });
fs.writeFileSync(path.join(ROOT, 'src', 'main', 'update-key.js'),
  `'use strict';\n// Public half of the update signing key (Ed25519). Created by tools/update-key.js.\n// Updates are installed only if update.json is signed by the matching private key.\nmodule.exports = ${JSON.stringify(pub)};\n`);
console.log(`Private key: ${out}\nPublic key written to src/main/update-key.js`);
