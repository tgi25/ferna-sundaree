'use strict';
// Password hashing for the parental-control and exam passwords: scrypt with a random salt;
// compared in constant time. Only the hash is stored (or put in an exam file).
const crypto = require('crypto');
const OPTS = { N: 1 << 15, r: 8, p: 1, maxmem: 96 * 1024 * 1024 };

function hash(password) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(password).normalize('NFKC'), salt, 32, OPTS);
  return { v: 1, salt: salt.toString('base64'), hash: h.toString('base64') };
}
function verify(password, rec) {
  if (!rec || !rec.salt || !rec.hash || typeof password !== 'string') return false;
  try {
    const h = crypto.scryptSync(password.normalize('NFKC'), Buffer.from(rec.salt, 'base64'), 32, OPTS);
    const want = Buffer.from(rec.hash, 'base64');
    return want.length === h.length && crypto.timingSafeEqual(h, want);
  } catch { return false; }
}
const valid = rec => !!(rec && typeof rec.salt === 'string' && typeof rec.hash === 'string' && Buffer.from(rec.hash, 'base64').length === 32);
module.exports = { hash, verify, valid };
