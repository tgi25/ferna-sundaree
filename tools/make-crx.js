#!/usr/bin/env node
'use strict';
// Pack a folder into a signed CRX3 file (the format the Chrome Web Store serves).
//   node tools/make-crx.js <extension-folder> <out.crx> [key.pem]
// Without key.pem a new RSA key is created next to the output (keep it to publish updates
// with the same extension id).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

function varint(n) {
  const out = [];
  while (n > 127) { out.push((n % 128) | 128); n = Math.floor(n / 128); }
  out.push(n);
  return Buffer.from(out);
}
const field = (num, buf) => Buffer.concat([varint(num * 8 + 2), varint(buf.length), buf]);

function zipFolder(dir) {
  const zip = new AdmZip();
  zip.addLocalFolder(dir);
  return zip.toBuffer();
}

/** @returns {{crx: Buffer, id: string, pem: string}} */
function packCrx(zipBuf, pem) {
  const key = pem ? crypto.createPrivateKey(pem) : crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const pubDer = crypto.createPublicKey(key).export({ type: 'spki', format: 'der' });
  const crxId = crypto.createHash('sha256').update(pubDer).digest().subarray(0, 16);
  const signedHeaderData = field(1, crxId);
  const len = Buffer.alloc(4);
  len.writeUInt32LE(signedHeaderData.length);
  const toSign = Buffer.concat([Buffer.from('CRX3 SignedData\x00', 'binary'), len, signedHeaderData, zipBuf]);
  const signature = crypto.sign('sha256', toSign, key);
  const header = Buffer.concat([field(2, Buffer.concat([field(1, pubDer), field(2, signature)])), field(10000, signedHeaderData)]);
  const head = Buffer.alloc(12);
  Buffer.from('Cr24').copy(head, 0);
  head.writeUInt32LE(3, 4);
  head.writeUInt32LE(header.length, 8);
  const id = [...crxId.toString('hex')].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
  return { crx: Buffer.concat([head, header, zipBuf]), id, pem: key.export({ type: 'pkcs8', format: 'pem' }) };
}

if (require.main === module) {
  const [dir, out, keyFile] = process.argv.slice(2);
  if (!dir || !out) { console.error('usage: make-crx.js <folder> <out.crx> [key.pem]'); process.exit(1); }
  const pem = keyFile && fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8') : null;
  const r = packCrx(zipFolder(dir), pem);
  fs.writeFileSync(out, r.crx);
  if (!pem) fs.writeFileSync(keyFile || out.replace(/\.crx$/, '.pem'), r.pem);
  console.log(`${out}  id ${r.id}`);
}

module.exports = { packCrx, zipFolder };
