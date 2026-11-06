'use strict';
const test = require('node:test');
const assert = require('node:assert');
const R = require('../../src/main/routines');
const G = require('../../src/main/guard');

// ---------- smart workspaces ----------
const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime();
function morningData() {
  const data = { days: {} };
  // Two weeks of weekdays (Mon 2 Nov 2026 …): LMS, Gmail and the timetable between 7:55 and 8:20.
  for (const d of [2, 3, 4, 5, 6, 9, 10, 11, 12, 13]) {
    const j = d % 3;
    R.record(data, 'https://lms.sjp.ac.lk/course/view.php?id=42', 'LMS', at(2026, 11, d, 7, 55 + j * 2));
    R.record(data, 'https://mail.google.com/mail/u/0/#inbox', 'Gmail', at(2026, 11, d, 8, 3 + j));
    R.record(data, 'https://docs.google.com/spreadsheets/d/abc/edit', 'Timetable', at(2026, 11, d, 8, 12 - j));
    // other browsing that is not a routine
    R.record(data, `https://site${d}.example.com/`, 'x', at(2026, 11, d, 8, 30));
    R.record(data, 'https://www.youtube.com/', 'YouTube', at(2026, 11, d, 21, d % 50));
    R.record(data, 'https://mail.google.com/mail/u/0/#inbox', 'Gmail again', at(2026, 11, d, 14, 0)); // later the same day: only counts
  }
  // Weekend evenings: news + cricket (only 2 days, not enough)
  for (const d of [7, 8]) { R.record(data, 'https://www.dailymirror.lk/', 'DM', at(2026, 11, d, 19, 0)); R.record(data, 'https://www.espncricinfo.com/', 'cricinfo', at(2026, 11, d, 19, 10)); }
  return data;
}

test('smart workspaces: finds the weekday-morning routine (LMS, Gmail, timetable)', () => {
  const data = morningData();
  const r = R.findRoutines(data, { now: at(2026, 11, 13, 18, 0) });
  assert.strictEqual(r.length, 1, JSON.stringify(r));
  assert.deepStrictEqual(r[0].sites, ['docs.google.com/spreadsheets', 'lms.sjp.ac.lk', 'mail.google.com']);
  assert.ok(r[0].weekdays && r[0].days.join() === '1,2,3,4,5');
  assert.ok(r[0].minute >= 7 * 60 + 45 && r[0].minute <= 8 * 60, r[0].time);
  assert.strictEqual(R.daysLabel(r[0].days), 'weekdays');
  assert.match(R.bestUrl(data, 'lms.sjp.ac.lk').url, /course\/view\.php\?id=42/);
  assert.strictEqual(data.days['2026-11-02']['mail.google.com'].n, 2);
  // Dismissed: not offered again
  assert.strictEqual(R.findRoutines(data, { skip: [r[0].id], now: at(2026, 11, 13, 18, 0) }).length, 0);
  // Too old: not offered
  assert.strictEqual(R.findRoutines(data, { now: at(2026, 12, 20, 18, 0) }).length, 0);
});

test('smart workspaces: two days are not a routine; a crawler is ignored; old data is pruned', () => {
  const data = { days: {} };
  for (const d of [2, 3]) { R.record(data, 'https://a.lk/', 'a', at(2026, 11, d, 9, 0)); R.record(data, 'https://b.lk/', 'b', at(2026, 11, d, 9, 5)); }
  assert.strictEqual(R.findRoutines(data, { now: at(2026, 11, 4, 9, 0) }).length, 0);
  R.record(data, 'ferna://newtab/', '', at(2026, 11, 4, 9, 0));
  R.record(data, 'file:///x', '', at(2026, 11, 4, 9, 0));
  assert.ok(!data.days['2026-11-04']);
  R.record(data, 'https://c.lk/', 'c', at(2027, 1, 30, 9, 0));
  assert.ok(!data.days['2026-11-02'] && data.days['2027-01-30']);
});

test('smart workspaces: schedules fire once a day, on the right days, up to 90 minutes late', () => {
  const s = { days: [1, 2, 3, 4, 5], time: '08:00', last: '' };
  assert.ok(!R.isDue(s, at(2026, 11, 9, 7, 59)));        // Monday, a minute early
  assert.ok(R.isDue(s, at(2026, 11, 9, 8, 0)));
  assert.ok(R.isDue(s, at(2026, 11, 9, 9, 30)));
  assert.ok(!R.isDue(s, at(2026, 11, 9, 9, 31)));
  assert.ok(!R.isDue(s, at(2026, 11, 8, 8, 10)));        // Sunday
  assert.ok(!R.isDue({ ...s, last: '2026-11-09' }, at(2026, 11, 9, 8, 10)));
  assert.ok(!R.isDue({ ...s, on: false }, at(2026, 11, 9, 8, 10)));
});

// ---------- scam & payment guard ----------
test('scam guard: a page dressed as a Sri Lankan bank on another address is flagged; the real one is not', () => {
  const f = { url: 'https://sampath-secure-login.xyz/', title: 'Sampath Bank Online Banking', h1: 'Sampath Vishwa', text: 'Log in', hasPassword: true };
  const bad = G.analyzePage(f);
  assert.strictEqual(bad.danger.org, 'Sampath Bank');
  assert.strictEqual(bad.danger.official, 'sampath.lk');
  assert.strictEqual(G.analyzePage({ ...f, url: 'https://www.sampath.lk/login' }).danger, null);
  assert.strictEqual(G.analyzePage({ ...f, url: 'https://www.sampathvishwa.com/' }).danger, null);
  // No password, card, PIN or OTP field: only a mention, not a fake login
  assert.strictEqual(G.analyzePage({ ...f, hasPassword: false }).danger, null);
  // A payment gateway shows bank names next to card fields
  assert.strictEqual(G.analyzePage({ ...f, url: 'https://www.payhere.lk/pay', hasCard: true }).danger, null);
  // Trusted by you
  assert.strictEqual(G.analyzePage(f, { trusted: ['sampath-secure-login.xyz'] }).danger, null);
  // CBSL list: the official addresses of Pan Asia and Amana Bank
  for (const [t, d] of [['Pan Asia Banking Corporation', 'pabcbank.com'], ['Amana Bank', 'amanabank.lk'], ["People's Bank", 'peoplesbank.lk'], ['National Savings Bank', 'nsb.lk'], ['HNB', 'hnb.net']]) {
    assert.strictEqual(G.analyzePage({ url: `https://${d}/`, title: t, hasPassword: true }).danger, null, d);
    assert.ok(G.analyzePage({ url: 'https://example.top/', title: t, hasPassword: true }).danger, t);
  }
});

test('scam guard: Sri Lankan SMS and WhatsApp scam wording, English and Sinhala; honest bank advice passes', () => {
  assert.deepStrictEqual(G.scanScam('Your parcel is on hold at customs. Pay the customs fee of Rs 450 urgently.'), ['Courier or customs fee to “release” a parcel', 'Pressure to act now']);
  assert.ok(G.scanScam('Congratulations! You have won Rs. 500,000 in our lucky draw. Pay a small processing fee to claim your prize.').length >= 2);
  assert.ok(G.scanScam('ඔබගේ පාර්සලය රේගු ගාස්තු නොගෙවූ නිසා රඳවා ඇත. ඉක්මනින් ක්‍රියා කරන්න').length >= 2);
  assert.ok(G.scamHits('Your account will be suspended. Reply with the OTP to 0771234567').length === 2);
  assert.deepStrictEqual(G.scamHits('Never share your OTP or PIN with anyone. Rs. 2,500 was debited.'), []);
  assert.deepStrictEqual(G.scanScam('Act now: register for the ICT conference.'), []); // one pattern alone is not enough
  // A bank's own page is not a scam page even when it describes scams
  assert.deepStrictEqual(G.analyzePage({ url: 'https://www.combank.lk/fraud', title: 'Beware of fraud', text: 'Your account will be blocked, they say. Share your OTP, they ask. Never do it.' }).scam, []);
});

test('fact-check bubble: query words, warning signs, Google News results grouped and judged', async () => {
  assert.strictEqual(G.queryFor('IMF approves fourth review of Sri Lanka bailout, releases $344 million'), 'IMF approves fourth review Sri Lanka bailout releases 344 million');
  assert.ok(G.scanClaim('Share before it is deleted! This drink cures cancer').length === 2);
  assert.ok(G.scanClaim('', { isArticle: true, headline: 'SHOCKING TRUTH ABOUT THE NEW TAX REVEALED TODAY' }).some(x => /capital/.test(x)));
  assert.ok(G.scanClaim('මෙය හැමෝටම යවන්න').length === 1);
  const url = G.newsSearchUrl('ලංකා බැංකුව');
  assert.match(url, /hl=si/); assert.match(url, /ceid=LK%3Asi/);
  const xml = require('fs').readFileSync(require('path').join(__dirname, '..', 'fixtures', 'check', 'news.xml'), 'utf8');
  const cov = await G.coverage('IMF approves fourth review of Sri Lanka bailout, releases $344 million', { fetchText: async () => xml, selfHost: 'reuters.com' });
  assert.deepStrictEqual(cov.results.map(r => r.host).sort(), ['economynext.com', 'lankagossiphub.example', 'www.dailymirror.lk']); // own site and cricket left out
  assert.strictEqual(cov.reliable, 2);
  assert.strictEqual(cov.factChecks.length, 1);
  assert.match(G.summaryLine(cov, []), /Fact-checkers/);
  assert.match(G.summaryLine({ results: [], factChecks: [], reliable: 0 }, ['x']), /warning signs/);
});
