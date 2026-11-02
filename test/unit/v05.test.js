'use strict';
// 0.5: bookmark manager tools, password manager core, sync core, Group Policy, web-app icons,
// app-window layout, split-view geometry, and that the page scripts compile.
const test = require('node:test');
const assert = require('node:assert');
const BM = require('../../src/main/bookmarks');
const T = require('../../src/main/bmtools');
const PW = require('../../src/main/pwcore');
const SC = require('../../src/main/synccore');
const GP = require('../../src/main/grouppolicy');
const { computeLayout } = require('../../src/main/layout');

function sample() {
  const items = [];
  const f = BM.addFolder(items, { parent: 'bar', title: 'Research' });
  const sub = BM.addFolder(items, { parent: f.id, title: 'NLP' });
  const a = BM.addBookmark(items, { parent: f.id, url: 'https://arxiv.org/abs/1', title: 'Paper 1' });
  const b = BM.addBookmark(items, { parent: sub.id, url: 'https://aclanthology.org/x', title: 'ACL' });
  const c = BM.addBookmark(items, { parent: 'other', url: 'https://www.arxiv.org/abs/1/', title: 'Paper 1 again' });
  const d = BM.addBookmark(items, { parent: 'other', url: 'https://example.com/', title: 'Example' });
  return { items, f, sub, a, b, c, d };
}

test('bookmarks: bulk delete returns an undo that restores positions and folders', () => {
  const { items, f, d } = sample();
  const before = JSON.stringify(items);
  const r = T.bulkRemove(items, [f.id, d.id]);
  assert.strictEqual(r.items.length, 1); // only the "Paper 1 again" bookmark is left
  assert.strictEqual(r.removed.length, 5); // folder, sub-folder, 2 inside, plus d
  const back = T.restore(r.items, r.removed);
  assert.strictEqual(JSON.stringify(back), before);
});

test('bookmarks: bulk move keeps order and moves folders with their contents', () => {
  const { items, sub, b, c, d } = sample();
  const n = T.bulkMove(items, [sub.id, b.id, d.id, c.id], 'reading');
  assert.strictEqual(n, 3); // b travels with its folder
  assert.deepStrictEqual(BM.children(items, 'reading').map(x => x.id), [sub.id, c.id, d.id]);
  assert.strictEqual(BM.byId(items, b.id).folder, sub.id);
  assert.strictEqual(T.bulkMove(items, [sub.id], sub.id), 0); // not into itself
});

test('bookmarks: tags added and removed in bulk, counted, case-insensitive', () => {
  const { items, a, b, d } = sample();
  assert.strictEqual(T.bulkTag(items, [a.id, b.id], ['ML', ' to read ', '#ml']), 2);
  assert.deepStrictEqual(BM.byId(items, a.id).tags, ['ML', 'to read']);
  assert.strictEqual(T.bulkTag(items, [a.id, d.id], [], ['ml']), 1);
  assert.deepStrictEqual(BM.byId(items, a.id).tags, ['to read']);
  assert.deepStrictEqual(T.allTags(items).map(t => [t.tag, t.count]), [['to read', 2], ['ML', 1]]);
});

test('bookmarks: duplicates found across folders and merged with their tags', () => {
  const { items, a, c } = sample();
  BM.byId(items, c.id).tags = ['x'];
  BM.byId(items, a.id).ts = 1; BM.byId(items, c.id).ts = 2;
  const g = T.duplicates(items);
  assert.strictEqual(g.length, 1);
  assert.deepStrictEqual(g[0].ids, [a.id, c.id]);
  const r = T.mergeDuplicates(items, g);
  assert.strictEqual(r.merged, 1);
  assert.ok(!r.items.some(n => n.id === c.id));
  assert.deepStrictEqual(r.items.find(n => n.id === a.id).tags, ['x']);
  assert.strictEqual(T.normalizeUrl('https://WWW.Example.com:443/a/?b=2&a=1'), 'example.com/a?a=1&b=2');
});

test('bookmarks: filter by text, folder (with sub-folders), tag, site, date, read and link status', () => {
  const { items, f, a, b, d } = sample();
  BM.byId(items, a.id).tags = ['ml'];
  BM.byId(items, b.id).visited = 5;
  BM.byId(items, d.id).check = { s: 'dead', code: 404 };
  BM.byId(items, d.id).ts = 1000;
  assert.deepStrictEqual(T.filter(items, { folder: f.id }).map(n => n.id).sort(), [a.id, b.id].sort());
  assert.deepStrictEqual(T.filter(items, { q: 'acl' }).map(n => n.id), [b.id]);
  assert.deepStrictEqual(T.filter(items, { tags: ['ML'] }).map(n => n.id), [a.id]);
  assert.strictEqual(T.filter(items, { domain: 'arxiv.org' }).length, 2);
  assert.deepStrictEqual(T.filter(items, { read: 'read' }).map(n => n.id), [b.id]);
  assert.deepStrictEqual(T.filter(items, { status: 'dead' }).map(n => n.id), [d.id]);
  assert.deepStrictEqual(T.filter(items, { to: 2000 }).map(n => n.id), [d.id]);
});

test('bookmarks: export of a selection keeps its folders; JSON round trip keeps tags and visits', () => {
  const { items, b } = sample();
  BM.byId(items, b.id).tags = ['nlp']; BM.byId(items, b.id).visited = 42;
  const json = JSON.parse(T.exportJson(items, [b.id]));
  assert.deepStrictEqual(json.items.map(n => n.title), ['Research', 'NLP', 'ACL']);
  const html = T.exportHtml(items, [b.id]);
  assert.ok(html.includes('>Research</H3>') && html.includes('>ACL</A>') && !html.includes('Example'));
  const into = [];
  assert.strictEqual(T.importFernaJson(into, json), 1);
  const acl = into.find(n => n.url === 'https://aclanthology.org/x');
  assert.deepStrictEqual([acl.tags, acl.visited, BM.byId(into, acl.folder).title], [['nlp'], 42, 'NLP']);
});

test('bookmarks: imports from Chrome JSON, Firefox backup and HTML (with Reading list)', () => {
  const chrome = { roots: { bookmark_bar: { children: [{ type: 'folder', name: 'Uni', children: [{ type: 'url', name: 'SJP', url: 'https://sjp.ac.lk/', date_added: '13300000000000000' }] }] }, other: { children: [{ type: 'url', name: 'X', url: 'https://x.com/' }] } } };
  const items = [];
  assert.deepStrictEqual(T.importAny(items, JSON.stringify(chrome)), { added: 2, kind: 'Chrome / Edge / Brave' });
  const sjp = items.find(n => n.url === 'https://sjp.ac.lk/');
  assert.strictEqual(BM.byId(items, sjp.folder).title, 'Uni');
  assert.ok(Math.abs(sjp.ts - (13300000000000000 / 1000 - 11644473600000)) < 2);
  const ff = { type: 'text/x-moz-place-container', children: [{ type: 'text/x-moz-place-container', root: 'toolbarFolder', children: [{ type: 'text/x-moz-place', title: 'MDN', uri: 'https://developer.mozilla.org/', tags: 'web,docs', dateAdded: 1700000000000000 }] }, { type: 'text/x-moz-place-container', root: 'unfiledBookmarksFolder', children: [{ type: 'text/x-moz-place', title: 'P', uri: 'place:sort=8' }] }] };
  assert.strictEqual(T.importAny(items, JSON.stringify(ff)).added, 1);
  const mdn = items.find(n => n.url === 'https://developer.mozilla.org/');
  assert.deepStrictEqual([mdn.folder, mdn.tags, mdn.ts], ['bar', ['web', 'docs'], 1700000000000]);
  const html = '<DL><p><DT><H3>Reading list</H3><DL><p><DT><A HREF="https://read.me/">Later</A></DL><p></DL>';
  assert.strictEqual(T.importAny(items, html).added, 1);
  assert.strictEqual(items.find(n => n.url === 'https://read.me/').folder, 'reading');
  assert.throws(() => T.importAny(items, '{"a":1}'), /Unknown/);
});

test('bookmarks: link check results classified', () => {
  assert.strictEqual(T.classify({ code: 200 }), 'ok');
  assert.strictEqual(T.classify({ code: 404 }), 'dead');
  assert.strictEqual(T.classify({ code: 403 }), 'ok');
  assert.strictEqual(T.classify({ code: 503 }), 'error');
  assert.strictEqual(T.classify({ error: 'net::ERR_NAME_NOT_RESOLVED' }), 'dead');
  assert.strictEqual(T.classify({ error: 'net::ERR_TIMED_OUT' }), 'error');
});

test('passwords: generator has every class, no look-alikes, right length; strength', () => {
  for (let i = 0; i < 50; i++) {
    const p = PW.generate(16);
    assert.strictEqual(p.length, 16);
    assert.ok(/[a-z]/.test(p) && /[A-Z]/.test(p) && /[2-9]/.test(p) && /[-_.!@#$%*+=?]/.test(p));
    assert.ok(!/[lIO01]/.test(p));
  }
  assert.strictEqual(PW.strength('password').score, 0);
  assert.strictEqual(PW.strength('abc').score, 1);
  assert.ok(PW.strength(PW.generate(16)).score >= 3);
});

test('passwords: reuse across sites (not sub-domains), page matching, merge', () => {
  const L = [
    { id: '1', origin: 'https://mail.google.com', username: 'a', password: 'same1234' },
    { id: '2', origin: 'https://accounts.google.com', username: 'a', password: 'same1234' },
    { id: '3', origin: 'https://facebook.com', username: 'a', password: 'same1234' },
    { id: '4', origin: 'http://intranet.local', username: 'b', password: 'other' },
  ];
  const r = PW.reused(L);
  assert.deepStrictEqual(r.get('3'), ['google.com']);
  assert.deepStrictEqual(r.get('1'), ['facebook.com']);
  assert.ok(!r.has('4'));
  assert.deepStrictEqual(PW.forPage(L, 'https://mail.google.com/x').map(l => l.id), ['1', '2']);
  assert.deepStrictEqual(PW.forPage(L, 'https://intranet.local/').map(l => l.id), []); // http login not offered on https
  const m = PW.merge(L, [{ origin: 'https://facebook.com', username: 'a', password: 'new' }, { origin: 'https://x.com', username: 'z', password: 'p' }]);
  assert.deepStrictEqual(m, { added: 1, updated: 1 });
});

test('passwords: CSV import from Chrome, Bitwarden and Firefox; export round trip', () => {
  const chrome = 'name,url,username,password,note\r\nG,https://accounts.google.com/signin,me@x.com,"p,""1",\r\nbad,,u,p,\r\n';
  const r1 = PW.importCsv(chrome);
  assert.deepStrictEqual([r1.format, r1.logins.length, r1.skipped, r1.logins[0].password, r1.logins[0].origin], ['Chrome-compatible', 1, 1, 'p,"1', 'https://accounts.google.com']);
  const bw = 'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n,,login,GitHub,,,0,github.com,octo,s3cret,\n';
  const r2 = PW.importCsv(bw);
  assert.deepStrictEqual([r2.format, r2.logins[0].origin, r2.logins[0].username], ['Bitwarden', 'https://github.com', 'octo']);
  const ff = '"url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"\n"https://moodle.sjp.ac.lk","t","pw",,"https://moodle.sjp.ac.lk","{x}","1","1","1"\n';
  assert.strictEqual(PW.importCsv(ff).format, 'Firefox');
  const out = PW.exportCsv(r1.logins);
  assert.strictEqual(PW.importCsv(out).logins[0].password, 'p,"1');
  assert.throws(() => PW.importCsv('a,b\n1,2\n'), /no url and password/);
});

test('passwords: Luhn, card brand, breach range parsing', () => {
  assert.ok(PW.luhn('4111 1111 1111 1111'));
  assert.ok(!PW.luhn('4111 1111 1111 1112'));
  assert.strictEqual(PW.cardBrand('5555555555554444'), 'Mastercard');
  const h = PW.sha1('password');
  assert.strictEqual(h.slice(0, 5), '5BAA6');
  assert.strictEqual(PW.pwnedCount(`0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n${h.slice(5)}:9545824\r\n`, h), 9545824);
});

test('sync: encrypted with the passphrase; wrong passphrase refused; salt read from file', () => {
  const salt = require('crypto').randomBytes(16);
  const key = SC.deriveKey('correct horse battery', salt);
  const text = SC.seal({ hello: 'world' }, key, salt);
  assert.ok(!text.includes('world'));
  assert.deepStrictEqual(SC.open(text, SC.deriveKey('correct horse battery', SC.header(text).salt)), { hello: 'world' });
  assert.throws(() => SC.open(text, SC.deriveKey('wrong passphrase!', salt)), /Wrong passphrase/);
});

test('sync: three-way merge keeps both sides\' changes, deletions and additions', () => {
  const base = [{ id: 'a', t: 1 }, { id: 'b', t: 1 }, { id: 'c', t: 1 }, { id: 'd', t: 1 }];
  const local = [{ id: 'a', t: 2 }, { id: 'b', t: 1 }, { id: 'd', t: 1 }, { id: 'l', t: 1 }];   // a changed, c deleted, l added
  const remote = [{ id: 'a', t: 1 }, { id: 'b', t: 3 }, { id: 'c', t: 1 }, { id: 'r', t: 1 }]; // b changed, d deleted, r added
  const m = SC.merge3(base, local, remote);
  assert.deepStrictEqual(m, [{ id: 'a', t: 2 }, { id: 'b', t: 3 }, { id: 'l', t: 1 }, { id: 'r', t: 1 }]);
  // Both changed: the newer change wins.
  const both = SC.merge3([{ id: 'x', v: 0, changed: 1 }], [{ id: 'x', v: 1, changed: 5 }], [{ id: 'x', v: 2, changed: 9 }]);
  assert.strictEqual(both[0].v, 2);
  // First sync (no base): union, nothing deleted.
  assert.strictEqual(SC.merge3(null, [{ id: 'p' }], [{ id: 'q' }]).length, 2);
  // Deleted here but edited there: kept.
  assert.deepStrictEqual(SC.merge3([{ id: 'k', v: 1 }], [], [{ id: 'k', v: 2 }]), [{ id: 'k', v: 2 }]);
  assert.deepStrictEqual(SC.mergeSettings({ theme: 'light' }, { theme: 'light', accent: '#111111' }, { theme: 'dark', accent: '#111111' }), { theme: 'dark', accent: '#111111' });
  assert.strictEqual(SC.mergeHistory([{ url: 'a', ts: 1 }], [{ url: 'a', ts: 1 }, { url: 'b', ts: 2 }]).length, 2);
});

test('Group Policy: registry output parsed, settings forced with types', () => {
  const out = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\FernaSundaree\r\n    AdBlocker    REG_DWORD    0x1\r\n    SearchEngine    REG_SZ    duckduckgo\r\n    HistoryDays    REG_DWORD    0x1e\r\n    AssistantAllowed    REG_DWORD    0x0\r\n';
  const pol = GP.parseReg(out);
  assert.deepStrictEqual(pol, { AdBlocker: 1, SearchEngine: 'duckduckgo', HistoryDays: 30, AssistantAllowed: 0 });
  assert.deepStrictEqual(GP.settingsFrom(pol), { blocker: true, searchEngine: 'duckduckgo', historyDays: 30 });
  const ctx = { settings: { data: { blocker: false }, save() {} } };
  GP.install(ctx, pol, { blocker: v => typeof v === 'boolean', searchEngine: v => v === 'duckduckgo', historyDays: v => v > 0 });
  assert.strictEqual(ctx.settings.data.blocker, true);
  assert.ok(ctx.policyLocked('blocker') && !ctx.policyLocked('theme'));
  assert.strictEqual(ctx.policyAllows('AssistantAllowed'), false);
  assert.strictEqual(ctx.policyAllows('SyncAllowed'), true);
});

test('web apps: icon file is a valid ICO with PNG entries', () => {
  let ico;
  try { ico = require('../../src/main/webapps').pngsToIco; } catch { ico = null; }
  if (!ico) return; // needs electron
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const b = ico([{ size: 16, data: png }, { size: 256, data: png }]);
  assert.deepStrictEqual([b.readUInt16LE(2), b.readUInt16LE(4), b[6], b[22], b.readUInt32LE(18), b.readUInt32LE(22 + 12)], [1, 2, 16, 0, 38, 46]);
});

test('layout: installed app window has one bar with the window controls and no tab strip', () => {
  const L = computeLayout(1000, 700, { position: 'left', appMode: true, tabBarHidden: true });
  assert.deepStrictEqual([L.tabs, L.windowControls, L.content], [null, 'toolbar', { x: 0, y: 44, width: 1000, height: 656 }]);
});

test('split view: halves fill the page area with a divider, ratio clamped', () => {
  const { mixin } = require('../../src/main/tabfx');
  const fake = { ctx: { settings: { data: { splitRatio: 0.5 } } } };
  const r = mixin.splitRects.call(fake, { x: 10, y: 100, width: 1006, height: 500 });
  assert.deepStrictEqual(r.a, { x: 10, y: 100, width: 500, height: 500 });
  assert.deepStrictEqual(r.b, { x: 516, y: 100, width: 500, height: 500 });
  fake.ctx.settings.data.splitRatio = 0.95;
  assert.strictEqual(mixin.splitRects.call(fake, { x: 0, y: 0, width: 1006, height: 10 }).a.width, 800);
});

test('page scripts (password manager, reader, media) compile', () => {
  const fx = require('../../src/main/pagefx/pwfill');
  for (const code of [fx.SCAN({ accounts: [{ i: 'x', u: 'a"b' }], addresses: [], cards: [] }), fx.FILL_LOGIN('u', 'p"\'`${x}'), fx.FILL_NEW('p'), fx.FILL_FIELDS('card', { number: '4111' }), fx.FILL_FIELDS('address', { city: 'Colombo' })]) assert.doesNotThrow(() => new Function(code));
  const rd = require('../../src/main/pagefx/reader');
  assert.ok(rd.readabilitySource().length > 10000);
  for (const code of [rd.OPEN({ theme: 'dark' }), rd.OPEN({ speakText: 'Hello. World.' }), rd.EXTRACT(), rd.WAIT, rd.CLOSE]) assert.doesNotThrow(() => new Function(code));
  const md = require('../../src/main/pagefx/media');
  for (const code of [md.STATUS, md.TOGGLE, md.PIP_ENTER]) assert.doesNotThrow(() => new Function(code));
});
