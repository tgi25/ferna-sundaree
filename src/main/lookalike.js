'use strict';
// Look-alike address warnings: catches addresses made to pass for a well-known site or one of
// your bookmarks, before the page opens:
//   • letters that only look the same (Cyrillic "а" for Latin "a", "rn" for "m", 0 for o, 1 for l …),
//   • one-letter typos of a popular name (paypa1, gooogle, amazom),
//   • a real site's full address used as a prefix of another site (paypal.com.account-check.xyz).
// Sites you have visited before or bookmarked are never flagged. Runs locally.

let tld = null;
try { tld = require('tldts-experimental'); } catch { /* fallback below */ }

const POPULAR = [
  // global
  'google.com', 'youtube.com', 'gmail.com', 'facebook.com', 'instagram.com', 'whatsapp.com', 'twitter.com', 'x.com', 'linkedin.com',
  'microsoft.com', 'live.com', 'outlook.com', 'office.com', 'microsoftonline.com', 'apple.com', 'icloud.com', 'amazon.com', 'paypal.com',
  'netflix.com', 'spotify.com', 'github.com', 'gitlab.com', 'dropbox.com', 'adobe.com', 'zoom.us', 'yahoo.com', 'bing.com', 'wikipedia.org',
  'reddit.com', 'tiktok.com', 'telegram.org', 'discord.com', 'ebay.com', 'aliexpress.com', 'alibaba.com', 'booking.com', 'airbnb.com',
  'binance.com', 'coinbase.com', 'kraken.com', 'blockchain.com', 'metamask.io', 'steamcommunity.com', 'steampowered.com', 'roblox.com',
  'epicgames.com', 'docusign.com', 'wetransfer.com', 'canva.com', 'notion.so', 'slack.com', 'salesforce.com', 'shopify.com', 'stripe.com',
  'wise.com', 'revolut.com', 'westernunion.com', 'moneygram.com', 'dhl.com', 'fedex.com', 'ups.com', 'usps.com', 'chase.com',
  'bankofamerica.com', 'wellsfargo.com', 'citi.com', 'hsbc.com', 'barclays.co.uk', 'standardchartered.com', 'anthropic.com', 'claude.ai',
  'openai.com', 'chatgpt.com', 'protonmail.com', 'proton.me', 'yandex.ru', 'baidu.com', 'daraz.com', 'temu.com', 'shein.com',
  'researchgate.net', 'academia.edu', 'springer.com', 'elsevier.com', 'sciencedirect.com', 'ieee.org', 'acm.org', 'arxiv.org', 'scholar.google.com',
  // Sri Lanka
  'combank.lk', 'combankdigital.com', 'sampath.lk', 'sampathbank.com', 'hnb.lk', 'hnb.net', 'boc.lk', 'peoplesbank.lk', 'ndbbank.com',
  'seylan.lk', 'nationstrust.com', 'dfcc.lk', 'panasiabank.lk', 'unionb.com', 'amana.lk', 'cbsl.gov.lk', 'ird.gov.lk',
  'dialog.lk', 'mobitel.lk', 'slt.lk', 'hutch.lk', 'airtel.lk', 'daraz.lk', 'kapruka.com', 'ikman.lk', 'pickme.lk', 'srilankan.com',
  'sjp.ac.lk', 'ugc.ac.lk', 'mydialog.lk', 'genie.lk', 'frimi.lk', 'payhere.lk',
];

const CONFUSABLE = {
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j', 'ԁ': 'd', 'һ': 'h', 'ӏ': 'l', 'ѕ': 's', 'ԛ': 'q', 'ԝ': 'w',
  'ɡ': 'g', 'ɑ': 'a', 'ο': 'o', 'ν': 'v', 'τ': 't', 'κ': 'k', 'ρ': 'p', 'ι': 'i', 'α': 'a', 'ı': 'i', 'ł': 'l', 'ø': 'o', 'ß': 'ss',
  '0': 'o', '1': 'l', '3': 'e', '5': 's', '|': 'l', '!': 'i',
};

/** Reduce a label to how it looks: Unicode folded, confusable letters mapped, rn→m, vv→w. */
function skeleton(label) {
  let s = String(label).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  s = [...s].map(ch => CONFUSABLE[ch] || ch).join('');
  return s.replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/cl/g, 'd').replace(/i/g, 'l');
}

function editDistance1(a, b) {
  if (a === b) return false;
  // Typo-squats keep the first letter (paypa1, amazom); a different first letter is usually a
  // different word (finance / binance, ping / bing).
  if (a[0] !== b[0]) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else if (a[i + 1] === b[j] && a[i] === b[j + 1]) { i += 2; j += 2; } // swapped letters
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

const memo = new Map();
function parts(host) {
  const k = String(host || '');
  if (memo.has(k)) return memo.get(k);
  const r = partsUncached(k);
  if (memo.size > 5000) memo.clear();
  memo.set(k, r);
  return r;
}
function partsUncached(host) {
  host = String(host || '').toLowerCase().replace(/\.$/, '');
  let unicode = host;
  try { unicode = require('url').domainToUnicode(host) || host; } catch { /* keep */ }
  let domain = null, label = null, suffix = null;
  if (tld) {
    domain = tld.getDomain(unicode);
    label = tld.getDomainWithoutSuffix(unicode);
    suffix = tld.getPublicSuffix(unicode);
  }
  if (!domain) { const p = unicode.split('.'); domain = p.slice(-2).join('.'); label = p.length > 1 ? p[p.length - 2] : p[0]; suffix = p.slice(-1)[0]; }
  return { host: unicode, domain, label, suffix };
}

/**
 * Check a host against well-known sites and your own; returns { suggest, reason } or null.
 * `known` is a Set of hosts (and registrable domains) you have visited or bookmarked.
 */
function check(host, known = new Set(), extraTargets = []) {
  const p = parts(host);
  if (!p.domain || !p.label || p.label.length < 3) return null;
  if (known.has(p.host) || known.has(p.domain)) return null;
  const targets = [...new Set([...POPULAR, ...extraTargets])];
  if (targets.includes(p.domain)) return null;
  const sk = skeleton(p.label);
  for (const t of targets) {
    const tp = parts(t);
    if (!tp.label || tp.domain === p.domain) continue;
    if (tp.label === p.label) continue; // same name, other country domain (google.lk): fine
    if (skeleton(tp.label) === sk) return { suggest: tp.domain, reason: /[^\x00-\x7f]/.test(p.label) ? 'letters' : 'lookalike' };
    if (tp.label.length >= 5 && p.label.length >= 5 && editDistance1(p.label, tp.label)) return { suggest: tp.domain, reason: 'typo' };
    // netflix-login.com, combank-verify.top — a brand name plus a sign-in word.
    if (tp.label.length >= 5 && p.label.includes(tp.label) && /(^|-)(login|log-in|signin|sign-in|secure|security|verify|verification|account|accounts|update|support|wallet|bank|banking|auth|confirm|billing|recover|recovery|unlock|helpdesk|service)(-|$)/.test(p.label.replace(tp.label, ''))) return { suggest: tp.domain, reason: 'brand' };
    // paypal.com.something.xyz — a real address used as a disguise in front of another site.
    if (p.host.startsWith(`${tp.domain}.`) || p.host.includes(`.${tp.domain}.`)) return { suggest: tp.domain, reason: 'prefix' };
  }
  return null;
}

module.exports = { check, skeleton, editDistance1, parts, POPULAR };
