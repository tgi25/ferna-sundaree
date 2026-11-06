'use strict';
// Safety check: the fact-check bubble and the scam & payment guard.
//
// Fact-check: on news articles (and for any text you select and right-click), Ferna looks for the
// same story in other outlets through Google News search (sent without cookies, from a separate
// in-memory session), counts how many of them are established news organisations, finds fact-
// check articles about it, and points out wording typical of misleading posts (English and
// Sinhala). It shows evidence; it does not decide what is true.
//
// Scam & payment guard: a page that asks for a password, card number, PIN or one-time code and
// presents itself as a Sri Lankan bank, wallet, courier or government office, but is not on that
// organisation's official website, gets a warning before you type. Official websites of banks are
// as listed by the Central Bank of Sri Lanka (licensed commercial and specialised banks, May
// 2026). Pages and messages using the patterns of common Sri Lankan SMS/WhatsApp scams (courier
// "customs fee", prize or lottery wins, OTP requests, account-blocking threats) are flagged too.

const N = require('./feeds/nlp');

// ---------- organisations and their official websites ----------
// [name, pattern that names it, official registrable domains]
const ORGS = [
  // Licensed commercial banks (CBSL list)
  ['Amana Bank', /\bamana\s*bank\b/i, ['amanabank.lk']],
  ['Bank of Ceylon', /\bbank\s+of\s+ceylon\b|\bboc\b(?!\s*(?:news|tv))|ලංකා\s*බැංකුව/i, ['boc.lk']],
  ['Cargills Bank', /\bcargills\s+bank\b/i, ['cargillsbank.com']],
  ['Commercial Bank of Ceylon', /\bcommercial\s+bank\s+of\s+ceylon\b|\bcombank\b|කොමර්ෂල්\s*බැංකුව/i, ['combank.lk', 'combankdigital.com']],
  ['DFCC Bank', /\bdfcc\b/i, ['dfcc.lk']],
  ['Hatton National Bank', /\bhatton\s+national\s+bank\b|\bhnb\b/i, ['hnb.net', 'hnb.lk']],
  ['National Development Bank', /\bnational\s+development\s+bank\b|\bndb\s*bank\b/i, ['ndbbank.com']],
  ['Nations Trust Bank', /\bnations\s*trust\b|\bfrimi\b/i, ['nationstrust.com', 'frimi.lk']],
  ['Pan Asia Bank', /\bpan\s*asia\s+bank(ing)?\b|\bpabc\b/i, ['pabcbank.com']],
  ["People's Bank", /\bpeople['’]?s\s+bank\b|මහජන\s*බැංකුව/i, ['peoplesbank.lk']],
  ['Sampath Bank', /\bsampath\s*(bank|vishwa)?\b|සම්පත්\s*බැංකුව/i, ['sampath.lk', 'sampathvishwa.com']],
  ['Seylan Bank', /\bseylan\b|සෙලාන්\s*බැංකුව/i, ['seylan.lk']],
  ['Union Bank of Colombo', /\bunion\s+bank\s+of\s+colombo\b/i, ['unionb.com']],
  ['HSBC Sri Lanka', /\bhsbc\b/i, ['hsbc.lk', 'hsbc.com']],
  ['Standard Chartered', /\bstandard\s+chartered\b/i, ['sc.com']],
  // Licensed specialised banks (CBSL list)
  ['National Savings Bank', /\bnational\s+savings\s+bank\b|\bnsb\b|ජාතික\s*ඉතිරි\s*කිරීමේ\s*බැංකුව/i, ['nsb.lk']],
  ['HDFC Bank Sri Lanka', /\bhdfc\s+bank\b/i, ['hdfc.lk']],
  ['Pradeshiya Sanwardhana Bank', /\bpradeshiya\s+sanwardhana\b|\bregional\s+development\s+bank\b/i, ['rdb.lk']],
  ['Sanasa Development Bank', /\bsanasa\b/i, ['sdb.lk']],
  ['State Mortgage & Investment Bank', /\bstate\s+mortgage\b/i, ['smib.lk']],
  // Payments and wallets, telecoms
  ['LankaPay', /\blankapay\b|\bjustpay\b/i, ['lankapay.net']],
  ['Dialog (eZ Cash, Genie)', /\bdialog\b|\bez\s*cash\b|\bgenie\b/i, ['dialog.lk', 'genie.lk', 'mydialog.lk']],
  ['SLT-Mobitel (mCash)', /\bmobitel\b|\bm\s*cash\b|\bsri\s+lanka\s+telecom\b|\bslt\b/i, ['mobitel.lk', 'slt.lk', 'slt.com.lk']],
  ['Hutch', /\bhutch\b/i, ['hutch.lk']],
  ['Daraz', /\bdaraz\b/i, ['daraz.lk', 'daraz.com']],
  // Couriers and post
  ['Sri Lanka Post', /\bsri\s+lanka\s+post\b|\bslpost\b|ශ්‍රී\s*ලංකා\s*තැපැල්/i, ['slpost.gov.lk', 'slpost.lk']],
  ['Domex', /\bdomex\b/i, ['domex.lk']],
  ['DHL', /\bdhl\b/i, ['dhl.com', 'dhl.lk']],
  ['FedEx', /\bfedex\b/i, ['fedex.com']],
  ['Aramex', /\baramex\b/i, ['aramex.com']],
  // Government
  ['Central Bank of Sri Lanka', /\bcentral\s+bank\s+of\s+sri\s+lanka\b|\bcbsl\b|මහ\s*බැංකුව/i, ['cbsl.gov.lk', 'cbsl.lk']],
  ['Inland Revenue Department', /\binland\s+revenue\b|දේශීය\s*ආදායම්/i, ['ird.gov.lk']],
  ['Sri Lanka Customs', /\bsri\s+lanka\s+customs\b|ශ්‍රී\s*ලංකා\s*රේගුව/i, ['customs.gov.lk']],
  ['National Lotteries Board', /\bnational\s+lotteries\s+board\b|\bnlb\b/i, ['nlb.lk']],
  ['Development Lotteries Board', /\bdevelopment\s+lotteries\s+board\b|\bdlb\b/i, ['dlb.lk']],
];
// Payment gateways that legitimately show bank names next to card fields.
const GATEWAYS = ['payhere.lk', 'lankapay.net', 'paycorp.lk', 'webxpay.com', 'onepay.lk', 'directpay.lk', 'ipay.lk', 'paypal.com', 'stripe.com', 'checkout.com', 'mastercard.com', 'visa.com', 'cybersource.com', 'genie.lk', 'koko.lk', 'mintpay.lk'];

let tld = null;
try { tld = require('tldts-experimental'); } catch { /* fallback */ }
function registrable(host) {
  host = String(host || '').toLowerCase().replace(/^www\./, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host === 'localhost' || host.includes(':')) return host;
  if (tld) { const d = tld.getDomain(host); if (d) return d; }
  const p = host.split('.');
  return p.length > 2 && /^(com|gov|ac|org|net|edu|co)$/.test(p[p.length - 2]) ? p.slice(-3).join('.') : p.slice(-2).join('.');
}
const onDomain = (host, domains) => { const h = String(host || '').toLowerCase(); return domains.some(d => h === d || h.endsWith(`.${d}`)); };

// ---------- scam patterns (English, Sinhala, Tamil, Singlish) ----------
const SCAM = [
  ['Courier or customs fee to “release” a parcel', /\b(parcel|package|shipment|courier)\b[\s\S]{0,120}\b(on hold|held|pending|undeliver|customs|clearance|re-?deliver|delivery fee|address (is )?incomplete)\b|(customs|clearance|delivery|redelivery)\s+(fee|charge|payment)|පාර්සලය|පාසලය[\s\S]{0,40}(රඳවා|ගාස්තු)|රේගු\s*ගාස්තු/i],
  ['Prize, lottery or gift you did not enter for', /\b(you('| ha)ve|you are|congratulations!?[\s\S]{0,40}) ?(won|winner|selected)\b|\b(lucky (draw|winner)|claim (your|the) (prize|reward|gift))\b|ජයග්‍රාහකයා|ත්‍යාගය(ක්)?\s*(දිනා|ලබා)|ලොතරැයි[\s\S]{0,30}(දිනා|ජය)|பரிசு\s*வென்ற/i],
  ['Asks for a one-time code (OTP) or PIN', /\b(share|send|tell|enter|provide|confirm|reply with|give)\b[\s\S]{0,30}\b(otp|one[- ]time (password|code)|verification code|pin)\b|\botp\b[\s\S]{0,40}\b(share|send|reply|give)\b|OTP\s*(අංකය|කේතය)[\s\S]{0,40}(එවන්න|දෙන්න|කියන්න)/i],
  ['Threatens to block or suspend your account', /\b(account|card|sim|number)\b[\s\S]{0,60}\b(will be|has been|is) (blocked|suspended|deactivated|closed|locked|frozen)\b|(within|in) \d+ ?(hours?|hrs|minutes)[\s\S]{0,40}(blocked|suspended|closed)|ගිණුම[\s\S]{0,40}(අවහිර|අත්හිටුව)/i],
  ['Asks you to update KYC or bank details by link', /\b(update|verify|confirm|re-?activate)\b[\s\S]{0,30}\b(kyc|bank details|account details|card details|nic details)\b|KYC\s*(යාවත්කාලීන|update)/i],
  ['Easy money: job, investment or crypto returns', /\b(earn|income of|profit of|returns? of)\b[\s\S]{0,30}(rs\.?|lkr|\$|usd)\s?[\d,]+[\s\S]{0,40}\b(daily|per day|a day|weekly|from home)\b|\bguaranteed (profit|returns?|income)\b|\b(double|triple) your (money|investment)\b|දිනකට\s*රු\.?\s*[\d,]+/i],
  ['Pressure to act now', /\b(act now|urgent(ly)?|immediately|last chance|final notice|today only|expires? (today|in \d+))\b|ඉක්මනින්\s*(ක්‍රියා|පිළිතුරු)|හදිසි/i],
  ['Pay a small fee to receive money', /\b(pay|send|transfer)\b[\s\S]{0,30}\b(small|processing|registration|handling|release|tax) fee\b|ලියාපදිංචි\s*ගාස්තුව[\s\S]{0,30}(ගෙවන්න|යවන්න)/i],
];
// Wording typical of misleading posts (it is a reason to check, not proof).
const CLAIM_FLAGS = [
  ['Asks you to share or forward it widely', /\b(share|forward|send) (this|it)?\s*(to|with)?\s*(everyone|all|all your|as many)|\bshare (this )?before (it'?s |it is |they )?(deleted|removed|delete)|\bplease (share|forward)\b|බෙදා\s*ගන්න|ෂෙයා(ර්)?\s*කරන්න|share\s*කරන්න|හැමෝටම\s*(යවන්න|කියන්න)|සැමටම\s*යවන්න|මකා\s*දැමීමට\s*පෙර/i],
  ['Sensational wording', /\b(shocking|you won'?t believe|mind[- ]blowing|exposed|secret (they|the government)|what happened next|breaking!+|100% (true|proof|guaranteed))\b|පුදුම\s*හිතෙන|හෙළිදරව්|රහස\s*එළියට/i],
  ['Miracle health claim', /\b(cures?|heals?|kills?)\b[\s\S]{0,30}\b(cancer|diabetes|covid|dengue|kidney disease|all diseases)\b|\bmiracle (cure|remedy|drink)\b|\bdoctors (hate|don'?t want)\b|පිළිකාව\s*සුව|දියවැඩියාව\s*සුව/i],
  ['No source or date given', null], // filled from the page facts below
];
const RELIABLE = [
  // international news organisations and agencies
  'reuters.com', 'apnews.com', 'afp.com', 'bbc.com', 'bbc.co.uk', 'aljazeera.com', 'theguardian.com', 'nytimes.com', 'washingtonpost.com', 'bloomberg.com',
  'ft.com', 'economist.com', 'npr.org', 'dw.com', 'france24.com', 'cnn.com', 'abc.net.au', 'cbc.ca', 'thehindu.com', 'hindustantimes.com', 'indianexpress.com',
  'scmp.com', 'straitstimes.com', 'channelnewsasia.com', 'nikkei.com', 'wsj.com', 'cnbc.com', 'nature.com', 'science.org', 'who.int', 'un.org',
  // Sri Lankan news organisations
  'dailymirror.lk', 'adaderana.lk', 'newsfirst.lk', 'economynext.com', 'island.lk', 'sundaytimes.lk', 'ft.lk', 'dailynews.lk', 'sundayobserver.lk',
  'themorning.lk', 'lankadeepa.lk', 'dinamina.lk', 'divaina.lk', 'hirunews.lk', 'lankabusinessonline.com', 'virakesari.lk', 'ceylontoday.lk',
  'colombogazette.com', 'itnnews.lk', 'newswire.lk', 'news.lk', 'gov.lk', 'pmdnews.lk',
];
const FACTCHECKERS = ['factcrescendo.com', 'srilanka.factcrescendo.com', 'factseeker.lk', 'hashtaggeneration.org', 'watchdog.team', 'factcheck.afp.com', 'reuters.com/fact-check', 'factcheck.org', 'snopes.com', 'politifact.com', 'fullfact.org', 'boomlive.in', 'altnews.in', 'leadstories.com'];
const isReliable = host => onDomain(host, RELIABLE);

// ---------- page analysis (pure; the facts come from an isolated-world probe) ----------
/**
 * facts: { url, title, h1, logoAlt, text, hasPassword, hasCard, hasOtp, hasPin, isArticle, headline, published, author, lang }
 * → { danger: { org, official } | null, scam: [reasons], claim: [reasons], article: bool, gateway: bool }
 */
function analyzePage(facts, { trusted = [] } = {}) {
  let host = '';
  try { host = new URL(facts.url).hostname.toLowerCase(); } catch { return { danger: null, scam: [], claim: [], article: false }; }
  const out = { host, danger: null, insecure: null, scam: [], claim: [], article: !!facts.isArticle, gateway: onDomain(host, GATEWAYS), orgs: [] };
  const sensitive = facts.hasPassword || facts.hasCard || facts.hasOtp || facts.hasPin;
  const brandText = `${facts.title || ''} \n ${facts.h1 || ''} \n ${facts.logoAlt || ''}`;
  for (const [name, re, domains] of ORGS) if (re.test(brandText)) out.orgs.push({ name, domains, official: onDomain(host, domains) });
  const trustedHere = trusted.includes(registrable(host));
  if (sensitive && !out.gateway && !trustedHere) {
    const fake = out.orgs.find(o => !o.official) && !out.orgs.some(o => o.official);
    if (fake) { const o = out.orgs.find(x => !x.official); out.danger = { org: o.name, official: o.domains[0], asks: [facts.hasPassword && 'password', facts.hasCard && 'card number', facts.hasPin && 'PIN', facts.hasOtp && 'one-time code'].filter(Boolean) }; }
    if (/^http:$/.test(new URL(facts.url).protocol) && (facts.hasPassword || facts.hasCard)) out.insecure = true;
  }
  const text = `${facts.title || ''}\n${facts.text || ''}`.slice(0, 20000);
  // An organisation's own website warns about scams in the same words scams use.
  const officialHere = ORGS.some(([, , d]) => onDomain(host, d)) || out.gateway;
  if (!trustedHere && !officialHere) out.scam = scanScam(text);
  if (sensitive && out.scam.length) out.scam.unshift('It also asks for a password, card or code');
  out.claim = scanClaim(text, facts);
  return out;
}
// Honest banks write "never share your OTP"; that sentence is advice, not a request.
const ADVICE = /\b(never|do not|don'?t|will not|won'?t|not)\b[\s\S]{0,30}\b(share|send|tell|ask|disclose|reveal|give)\b[\s\S]{0,40}\b(otp|pin|password|one[- ]time|code)\b|(කිසිවකු|කිසිවෙකු)[\s\S]{0,40}(නොදෙන්න|දෙන්න\s*එපා)/i;
function scamHits(text) {
  const hits = [];
  const advice = ADVICE.test(text);
  for (const [why, re] of SCAM) {
    if (!re.test(text)) continue;
    if (advice && /one-time code/.test(why) && !/\b(reply|send|share)\b[\s\S]{0,20}\b(the |your |this )?(otp|code|pin)\b[\s\S]{0,20}\b(to|with|on|via)\b/i.test(text.replace(ADVICE, ''))) continue;
    hits.push(why);
  }
  return hits;
}
function scanScam(text) {
  const hits = scamHits(text);
  // One pattern alone is common in honest pages (“act now”); scams combine several.
  return hits.length >= 2 ? hits : [];
}
function scanClaim(text, facts = {}) {
  const hits = [];
  for (const [why, re] of CLAIM_FLAGS) if (re && re.test(text)) hits.push(why);
  if (facts.isArticle && !facts.author && !facts.published) hits.push('No author or date given');
  const head = String(facts.headline || facts.title || '');
  const letters = head.replace(/[^A-Za-z]/g, '');
  if (letters.length > 20 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.6) hits.push('Headline in capital letters');
  if (/[!?]{3,}/.test(head)) hits.push('Many exclamation or question marks');
  return hits;
}

// ---------- coverage search ----------
/** Words of a headline worth searching for (names and key terms; at most 10). */
function queryFor(text) {
  const raw = String(text || '').replace(/https?:\/\/\S+/g, ' ').replace(/[“”"«»]/g, ' ').trim();
  const words = raw.split(/\s+/).filter(Boolean);
  const keep = [];
  for (const w of words) {
    const t = N.tokens(w);
    if (!t.length && !/\d{2,}/.test(w)) continue;
    keep.push(w.replace(/[^\p{L}\p{M}\p{N}'’‌‍-]/gu, ''));
    if (keep.length >= 10) break;
  }
  return keep.filter(Boolean).join(' ');
}
const sinhala = s => /[඀-෿]/.test(s || '');
function newsSearchUrl(q, { factCheck = false } = {}) {
  const base = process.env.FERNA_NEWS_SEARCH || 'https://news.google.com/rss/search';
  const si = sinhala(q);
  const params = new URLSearchParams({ q: `${q}${factCheck ? ' fact check' : ''} when:30d`, hl: si ? 'si' : 'en-LK', gl: 'LK', ceid: si ? 'LK:si' : 'LK:en' });
  return `${base}?${params}`;
}
/**
 * Other coverage of a story: Google News results that are about the same thing (headline
 * similarity), each marked reliable or not, plus fact-check articles. fetchText(url) → text.
 */
async function coverage(headline, { fetchText, selfHost = '' } = {}) {
  const q = queryFor(headline);
  if (!q || q.split(' ').length < 2) return { query: q, results: [], factChecks: [], reliable: 0 };
  const P = require('./feeds/parse');
  const parse = async url => {
    const body = await fetchText(url);
    const items = [];
    for (const blk of String(body).match(/<item\b[\s\S]*?<\/item>/gi) || []) {
      const title = P.htmlToText((/<title>([\s\S]*?)<\/title>/i.exec(blk) || [])[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '');
      const link = P.safeUrl(P.decode(((/<link>([\s\S]*?)<\/link>/i.exec(blk) || [])[1] || '').trim()));
      const srcTag = /<source\b([^>]*)>([\s\S]*?)<\/source>/i.exec(blk);
      const srcUrl = srcTag ? P.safeUrl(((/url=["']([^"']+)/i.exec(srcTag[1]) || [])[1] || '')) : '';
      const source = srcTag ? P.htmlToText(srcTag[2]) : '';
      const date = Date.parse(((/<pubDate>([\s\S]*?)<\/pubDate>/i.exec(blk) || [])[1] || '').trim()) || 0;
      let host = '';
      try { host = new URL(srcUrl).hostname; } catch { /* none */ }
      items.push({ title: title.replace(new RegExp(`\\s+-\\s+${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), ''), link, source, host, date });
    }
    return items.slice(0, 40);
  };
  const tv = N.vectorize(headline, '', null);
  const same = it => N.cosine(tv, N.vectorize(it.title, '', null)) >= 0.28;
  const [news, fc] = await Promise.all([parse(newsSearchUrl(q)).catch(() => null), parse(newsSearchUrl(q, { factCheck: true })).catch(() => [])]);
  if (!news) throw new Error('Could not reach the news search. Check your connection.');
  const self = registrable(selfHost);
  const seen = new Set();
  const results = news.filter(it => same(it) && it.host && registrable(it.host) !== self && !onDomain(it.host, FACTCHECKERS)).filter(it => { const k = registrable(it.host); if (seen.has(k)) return false; seen.add(k); return true; })
    .map(it => ({ ...it, reliable: isReliable(it.host) })).sort((a, b) => b.reliable - a.reliable || b.date - a.date).slice(0, 12);
  const factChecks = (fc || []).filter(it => onDomain(it.host, FACTCHECKERS) || /fact[- ]?check|false|misleading|fake|hoax|ව්‍යාජ|බොරු/i.test(it.title)).filter(it => N.cosine(tv, N.vectorize(it.title, '', null)) >= 0.18).slice(0, 5);
  return { query: q, results, factChecks, reliable: results.filter(r => r.reliable).length };
}

/** One line on what the search found (evidence, not a verdict). */
function summaryLine(cov, claim) {
  if (!cov) return '';
  if (cov.factChecks && cov.factChecks.length) return `Fact-checkers have written about this story (${cov.factChecks.length})${cov.reliable ? `; ${cov.reliable} established news organisation${cov.reliable > 1 ? 's' : ''} report it` : ''}. Read them before sharing.`;
  if (cov.reliable >= 3) return `Reported by ${cov.reliable} established news organisations.`;
  if (cov.reliable >= 1) return `Reported by ${cov.reliable} established news organisation${cov.reliable > 1 ? 's' : ''}; ${cov.results.length - cov.reliable} other site${cov.results.length - cov.reliable === 1 ? '' : 's'}.`;
  if (cov.results.length) return `Only lesser-known sites report this (${cov.results.length}). Be careful before sharing.`;
  return claim && claim.length ? 'No other coverage found, and the wording has warning signs. Be careful before sharing.' : 'No other coverage found yet. It may be new, local or not reported elsewhere.';
}

/** The probe run in an isolated world of the page (no page script can see or change it). */
const PROBE = `(() => {
  const q = s => document.querySelector(s);
  const meta = n => { const m = document.querySelector('meta[property="' + n + '"], meta[name="' + n + '"]'); return m ? m.content || '' : ''; };
  const inputs = [...document.querySelectorAll('input, select')].filter(i => { const r = i.getBoundingClientRect(); const st = getComputedStyle(i); return i.type !== 'hidden' && st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0; });
  const desc = i => ((i.name || '') + ' ' + (i.id || '') + ' ' + (i.placeholder || '') + ' ' + (i.getAttribute('aria-label') || '') + ' ' + (i.autocomplete || '') + ' ' + ((i.labels && i.labels[0] && i.labels[0].textContent) || '')).toLowerCase();
  let ld = '';
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) { ld += s.textContent.slice(0, 4000); if (ld.length > 12000) break; }
  const isArticle = /article/i.test(meta('og:type')) || !!meta('article:published_time') || /"@type"\\s*:\\s*"(News)?Article"/.test(ld);
  const body = (document.body && document.body.innerText || '').slice(0, 12000);
  return {
    url: location.href, title: document.title || '', h1: (q('h1') && q('h1').innerText || '').slice(0, 300),
    logoAlt: [...document.querySelectorAll('header img[alt], img[alt*="logo" i], [class*="logo" i] img[alt]')].slice(0, 4).map(i => i.alt).join(' ').slice(0, 300),
    text: body,
    hasPassword: inputs.some(i => i.type === 'password'),
    hasCard: inputs.some(i => /cc-number|card ?(no|number)|cardnumber|\\bcvv\\b|\\bcvc\\b|cc-csc|expiry|exp(iry)? date/.test(desc(i))),
    hasOtp: inputs.some(i => /\\botp\\b|one[- ]time|verification code|one-time-code/.test(desc(i))),
    hasPin: inputs.some(i => /\\bpin\\b|atm pin|card pin/.test(desc(i)) && i.type !== 'search'),
    isArticle, headline: meta('og:title') || (q('h1') && q('h1').innerText) || document.title,
    published: meta('article:published_time') || meta('datePublished') || (/"datePublished"\\s*:\\s*"([^"]+)"/.exec(ld) || [])[1] || '',
    author: meta('author') || meta('article:author') || (/"author"[\\s\\S]{0,80}?"name"\\s*:\\s*"([^"]+)"/.exec(ld) || [])[1] || '',
    lang: document.documentElement.lang || '',
  };
})()`;

module.exports = { SCAM, scamHits, CLAIM_FLAGS, ORGS, GATEWAYS, RELIABLE, FACTCHECKERS, analyzePage, scanScam, scanClaim, queryFor, newsSearchUrl, coverage, summaryLine, registrable, isReliable, PROBE };
