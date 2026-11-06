'use strict';
// End-to-end steps for 0.8.0: 3D look, feeds, fact-check bubble, scam guard, smart workspaces.

module.exports = async function v080({ step, assert, main, win, page, H, base, shot, freshTab, evalActive, app }) {
  const ui = () => page('ferna://ui/');

  await step('0.8.0 3D look: raised bars and tiles; pointing lifts and tilts; pressing pushes in; can be turned off', async () => {
    const u = await ui();
    await main(() => { const c = global.__ferna; c.windows[0].switchWorkspace(null); c.setSetting('depth3d', true); c.setSetting('tabPosition', 'top'); });
    for (const q of ['one', 'two', 'three']) await freshTab(`${base}/long.html?d3-${q}`);
    await H.sleep(500);
    const pick = async (pos, theme) => {
      await main((e, a) => { e.nativeTheme.themeSource = a.theme; global.__ferna.setSetting('tabPosition', a.pos); }, { pos, theme });
      await u.emulateMedia({ colorScheme: theme });
      await H.sleep(600);
      // A tab that is not the current one.
      const box = await u.evaluate(() => { const t = [...document.querySelectorAll('#tabs .tab[data-id]:not(.active)')].pop(); const r = t.getBoundingClientRect(); return { x: r.left + r.width * 0.7, y: r.top + r.height * 0.3, id: t.dataset.id }; });
      await u.mouse.move(box.x - 30, box.y); await u.mouse.move(box.x, box.y, { steps: 4 });
      await H.sleep(400);
      return u.evaluate(id => {
        const t = document.querySelector(`#tabs .tab[data-id="${id}"]`), cs = getComputedStyle(t);
        return { d3: document.body.classList.contains('d3'), transform: cs.transform, shadow: cs.boxShadow, rx: t.style.getPropertyValue('--rx'), ry: t.style.getPropertyValue('--ry'), bar: getComputedStyle(document.querySelector('#toolbar')).boxShadow };
      }, box.id);
    };
    // At rest, buttons and tabs are flat; the current tab stays raised.
    await u.mouse.move(5, 300);
    await H.sleep(400);
    const rest = await u.evaluate(() => {
      const other = document.querySelector('#tabs .tab[data-id]:not(.active)'), cur = document.querySelector('#tabs .tab.active'), b = document.querySelector('#btn-reload');
      const cs = e => getComputedStyle(e);
      return { otherT: cs(other).transform, otherImg: cs(other).backgroundImage, btnT: cs(b).transform, btnImg: cs(b).backgroundImage, btnShadow: cs(b).boxShadow, curT: cs(cur).transform, curShadow: cs(cur).boxShadow };
    });
    assert(rest.otherT === 'none' && rest.otherImg === 'none' && rest.btnT === 'none' && rest.btnImg === 'none' && !/rgba?\([^)]*\) 0px 2px 0px/.test(rest.btnShadow) && rest.curT !== 'none' && /px/.test(rest.curShadow), JSON.stringify(rest));
    const light = await pick('top', 'light');
    assert(light.d3 && light.transform !== 'none' && /matrix3d|matrix/.test(light.transform) && light.rx && light.ry && /inset/.test(light.bar), JSON.stringify(light));
    await shot('v080-01-3d-light-top');
    const dark = await pick('left', 'dark');
    assert(dark.transform !== 'none' && dark.rx, JSON.stringify(dark));
    // Hover a toolbar button too, for the picture.
    const b = await u.evaluate(() => { const r = document.querySelector('#btn-menu').getBoundingClientRect(); return { x: r.left + r.width * 0.3, y: r.top + r.height * 0.3 }; });
    await u.mouse.move(b.x, b.y, { steps: 3 });
    await H.sleep(300);
    const btn = await u.evaluate(() => getComputedStyle(document.querySelector('#btn-menu')).transform);
    assert(btn !== 'none', `button lifts: ${btn}`);
    await shot('v080-02-3d-dark-vertical');
    // Off: flat again.
    await main(() => global.__ferna.setSetting('depth3d', false));
    await H.sleep(400);
    const flat = await u.evaluate(() => ({ d3: document.body.classList.contains('d3'), t: getComputedStyle(document.querySelector('#btn-menu')).transform }));
    assert(!flat.d3 && flat.t === 'none', JSON.stringify(flat));
    await main(() => { global.__ferna.setSetting('depth3d', true); global.__ferna.setSetting('tabPosition', 'top'); });
    await u.emulateMedia({ colorScheme: null });
    await main(e => { e.nativeTheme.themeSource = global.__ferna.settings.data.theme || 'system'; });
    await u.mouse.move(5, 5);
  });

  const lh = () => `http://localhost:${new URL(base).port}`;

  await step('0.8.0 feeds: follow RSS, Atom and RDF feeds; streams, summaries, tags and one card per story', async () => {
    const r = await main(async (_, b) => {
      const F = global.__ferna.feeds;
      for (const f of [...F.store.data.feeds]) F.unsubscribe(f.id);
      const out = {};
      const times = [];
      for (const n of ['lanka', 'world', 'research']) { const t0 = Date.now(); const f = await F.subscribe(`${b}/feeds/${n}.xml`); times.push(Date.now() - t0); out[n] = f.category; }
      out.times = times;
      // Measure how late a 10 ms timer fires in the main process while feeds are fetched and analysed.
      let worst = 0, last = Date.now();
      const iv = setInterval(() => { const now = Date.now(); worst = Math.max(worst, now - last - 10); last = now; }, 10);
      const tp = Date.now(); const p = await F.poll({ force: true }); out.pollMs = Date.now() - tp;
      clearInterval(iv);
      const list = F.list({ category: 'all', limit: 100 });
      return { cats: out, poll: p, worst, total: F.itemsStore.data.items.length, cards: list.cards.map(c => ({ t: c.title, cat: c.category, n: c.sources.length, sum: c.summary, tags: c.tags })) };
    }, lh());
    console.log('TIMES', JSON.stringify(r.cats));
    assert(r.cats.lanka === 'local' && r.cats.world === 'global' && r.cats.research === 'research', JSON.stringify(r.cats));
    assert(r.total === 8, `items ${r.total} ${JSON.stringify(r.poll)}`);
    assert(r.worst < 250, `main process waited ${r.worst} ms`);
    const imf = r.cards.find(c => /IMF/.test(c.t));
    assert(imf && imf.n === 2 && r.cards.filter(c => /IMF/.test(c.t)).length === 1, `IMF story merged: ${JSON.stringify(r.cards.map(c => [c.t, c.n]))}`);
    assert(imf.cat === 'local' && /344 million/.test(imf.sum) && imf.tags.includes('Economy'), JSON.stringify(imf));
    const pso = r.cards.find(c => /Particle Swarm/.test(c.t));
    assert(pso && pso.cat === 'research' && pso.tags.includes('Swarm intelligence') && pso.sum.split(/(?<=\.)\s/).length <= 3, JSON.stringify(pso));
    const si = r.cards.find(c => /ක්‍රිකට්/.test(c.t));
    assert(si && si.cat === 'local', `Sinhala item: ${JSON.stringify(si)}`);
  });

  await step('0.8.0 feeds: interests, filter rules and hiding low-relevance; learning from what you read', async () => {
    const r = await main(() => {
      const F = global.__ferna.feeds;
      F.setPrefs({ interests: 'swarm intelligence, Sri Lanka economy', rules: '-celebrity\n+IMF', hideLow: false });
      const before = F.list({ category: 'all', limit: 100 });
      const order = before.cards.map(c => c.title);
      const gossipHidden = !before.cards.some(c => /gossip/i.test(c.title)) && before.hiddenCount >= 1;
      F.setPrefs({ hideLow: true, threshold: 0.3 });
      const strict = F.list({ category: 'all', limit: 100 });
      const shown = F.list({ category: 'all', limit: 100, showHidden: true });
      const pso = F.itemsStore.data.items.find(i => /Particle Swarm/.test(i.title));
      F.opened(pso.id);
      const learned = F.prefs().learnedTerms;
      F.setPrefs({ hideLow: false, threshold: 0.1 });
      return { order, gossipHidden, strictN: strict.cards.length, shownN: shown.cards.length, hidden: strict.hiddenCount, learned };
    });
    assert(r.gossipHidden, 'the -celebrity rule hides the gossip item');
    const iImf = r.order.findIndex(t => /IMF/.test(t)), iPso = r.order.findIndex(t => /Particle Swarm/.test(t)), iGeneva = r.order.findIndex(t => /Geneva/.test(t));
    assert(iImf >= 0 && iPso >= 0 && iImf < iGeneva && iPso < iGeneva, `order: ${JSON.stringify(r.order)}`);
    assert(r.strictN < r.shownN && r.hidden > 0, JSON.stringify(r));
    assert(r.learned.some(t => /swarm|particle|inertia/.test(t)), `learned: ${r.learned}`);
  });

  await step('0.8.0 feeds: a page announcing a feed shows the RSS button; a site without a feed can be followed', async () => {
    await freshTab(`${lh()}/feeds/page-with-feed.html`);
    const u = await ui();
    await H.until(() => u.evaluate(() => !document.querySelector('#btn-rss').hidden), 5000, 'RSS button shown');
    const on = await u.evaluate(() => document.querySelector('#btn-rss').classList.contains('on'));
    assert(on, 'already following this feed: the button shows it');
    await shot('v080-03-rss-button');
    const r = await main(async (_, b) => {
      const F = global.__ferna.feeds;
      const f = await F.subscribe(`${b}/feeds/nofeed.html`, { type: 'scrape' });
      await F.poll({ only: [f.id] });
      const items = F.itemsStore.data.items.filter(i => i.feedId === f.id);
      return { type: f.type, titles: items.map(i => i.title), sums: items.map(i => i.summary) };
    }, lh());
    assert(r.type === 'scrape' && r.titles.length === 2 && r.titles.every(t => !/^News$/.test(t)), JSON.stringify(r));
    assert(r.sums.every(s => /Faculty of Applied Sciences/.test(s)), `summaries from the article pages: ${JSON.stringify(r.sums)}`);
  });

  await step('0.8.0 feeds: side panel and page; reader view is clean (no scripts, forms or javascript: links); saved items kept offline', async () => {
    await main((_, b) => {
      const F = global.__ferna.feeds;
      const it = F.itemsStore.data.items.find(i => /IMF approves/.test(i.title));
      it.link = `${b}/feeds/full-article.html`;
      F.togglePanel(global.__ferna.windows[0], true);
    }, lh());
    const panel = await page('ferna://feeds/?panel=1');
    await H.until(() => panel.evaluate(() => document.querySelectorAll('.fc').length >= 5), 8000, 'cards in the panel');
    const s = await panel.evaluate(() => ({ streams: [...document.querySelectorAll('.st')].map(b => b.textContent.trim()), cov: !!document.querySelector('.fc .cov') }));
    assert(s.streams.some(t => /Research & Academia/.test(t)) && s.streams.some(t => /^Local/.test(t)) && s.cov, JSON.stringify(s));
    await shot('v080-04-feeds-panel');
    // Reader
    const id = await main(() => global.__ferna.feeds.itemsStore.data.items.find(i => /IMF approves/.test(i.title)).id);
    await panel.evaluate(i => { const h = document.querySelector(`.fc[data-id="${i}"] h3`) || [...document.querySelectorAll('.fc h3')].find(x => /IMF/.test(x.textContent)); h.click(); }, id);
    await H.until(() => panel.evaluate(() => document.querySelectorAll('#r-body p').length >= 3), 10000, 'article text');
    const rd = await panel.evaluate(() => { const b = document.querySelector('#r-body'); return { script: !!b.querySelector('script'), form: !!b.querySelector('form, input'), onerr: [...b.querySelectorAll('*')].some(e => [...e.attributes].some(a => /^on/i.test(a.name))), js: [...b.querySelectorAll('a')].some(a => /^javascript:/i.test(a.getAttribute('href') || '')), text: b.textContent.slice(0, 200), imf: [...b.querySelectorAll('a[href]')].some(a => /imf\.org/.test(a.href)) }; });
    assert(!rd.script && !rd.form && !rd.onerr && !rd.js && rd.imf && /344 million/.test(rd.text), JSON.stringify(rd));
    await shot('v080-05-feeds-reader');
    // Save → kept in IndexedDB for offline reading
    await panel.evaluate(() => document.querySelector('#r-save').click());
    await H.until(() => panel.evaluate(i => new Promise(res => { const r = indexedDB.open('ferna-feeds', 1); r.onsuccess = () => { const g = r.result.transaction('articles').objectStore('articles').get(i); g.onsuccess = () => res(!!(g.result && g.result.html)); g.onerror = () => res(false); }; r.onerror = () => res(false); }), id), 8000, 'saved for offline');
    // Full page, digest
    await main(() => { const w = global.__ferna.windows[0]; global.__ferna.feeds.closePanel(w); w.newTab('ferna://feeds/#digest'); });
    const full = await page('ferna://feeds/#digest');
    await H.until(() => full.evaluate(() => /Today's digest/.test(document.body.textContent) && /Breaking/.test(document.body.textContent)), 8000, 'digest with breaking story');
    await shot('v080-06-feeds-digest');
  });

  await step('0.8.0 feeds: OPML export and import', async () => {
    const r = await main(async () => {
      const F = global.__ferna.feeds;
      const xml = F.exportOpml();
      const urls = F.store.data.feeds.filter(f => f.type === 'rss').map(f => f.url);
      for (const f of [...F.store.data.feeds]) if (f.type === 'rss') F.unsubscribe(f.id);
      const res = await F.importOpml(xml);
      return { res, back: urls.every(u => F.store.data.feeds.some(f => f.url === u)), cats: F.store.data.feeds.map(f => f.category), hasXml: /<opml version="2.0">/.test(xml) };
    });
    assert(r.hasXml && r.res.added === 3 && r.back && r.cats.includes('research') && r.cats.includes('local'), JSON.stringify(r));
    await main(() => { const F = global.__ferna.feeds; for (const f of [...F.store.data.feeds]) F.unsubscribe(f.id); F.setPrefs({ interests: '', rules: '' }); });
  });
  await step('0.8.0 scam & payment guard: fake bank login warned before typing; scam pages and messages flagged', async () => {
    await main(() => { const c = global.__ferna; c.setSetting('checkTrusted', []); c.__dlg = []; c.check.showDialog = async (w, o) => { c.__dlg.push(o); return { response: c.__dlgAnswer || 0 }; }; c.__dlgAnswer = 0; });
    // A page dressed as Sampath Bank on another address, asking for a password and OTP
    await freshTab(`${base}/check/fake-bank.html`);
    await H.until(() => main(() => global.__ferna.__dlg.length > 0), 10000, 'fake-bank warning');
    const d = await main(() => global.__ferna.__dlg[0]);
    assert(/Sampath Bank/.test(d.message) && /sampath\.lk/.test(d.detail) && /password/.test(d.detail) && /one-time code/.test(d.detail) && d.buttons[0] === 'Leave this page', JSON.stringify(d));
    // "Leave this page" took the tab away from it
    await H.until(() => main(() => { const t = global.__ferna.windows[0].active; return !/fake-bank/.test(t.url || ''); }), 6000, 'left the fake page');
    // Open again and answer "I trust this site": no more warnings for it
    await main(() => { global.__ferna.__dlgAnswer = 2; });
    await freshTab(`${base}/check/fake-bank.html?again`);
    await H.until(() => main(() => global.__ferna.__dlg.length > 1), 10000, 'second warning');
    await H.until(() => main(() => (global.__ferna.settings.data.checkTrusted || []).includes('127.0.0.1')), 4000, 'trusted');
    const n = await main(() => global.__ferna.__dlg.length);
    await freshTab(`${base}/check/fake-bank.html?third`);
    await H.sleep(3500);
    assert(await main((_, a) => global.__ferna.__dlg.length === a, n), 'no warning once trusted: ' + JSON.stringify(await main(() => [global.__ferna.__dlg.map(x => x.detail.slice(0, 40)), global.__ferna.settings.data.checkTrusted])));
    await main(() => global.__ferna.setSetting('checkTrusted', []));
    // A "parcel on hold, pay the customs fee" page: toast and a red check button
    await freshTab(`${lh()}/check/scam.html`);
    const u = await ui();
    await H.until(() => u.evaluate(() => { const b = document.querySelector('#btn-check'); return !b.hidden && b.dataset.level === 'scam'; }), 8000, 'scam level');
    const t = await u.evaluate(() => document.querySelector('#toast').textContent);
    assert(/scam/.test(t) && /Why\?/.test(t), t);
    await shot('v080-07-scam-page');
    // Messages (SMS, WhatsApp): English, Sinhala; a bank's honest warning is not flagged
    const m = await main(() => {
      const C = global.__ferna.check;
      return {
        courier: C.checkMessage('Sri Lanka Post: your parcel is on hold due to an incomplete address. Pay the Rs.150 redelivery fee: https://slpost-lk.top/pay'),
        prize: C.checkMessage('Congratulations! You have won Rs. 500,000 in the Dialog lucky draw. Pay a small processing fee to claim your prize. bit.ly/3xYz'),
        si: C.checkMessage('ඔබගේ පාර්සලය රේගු ගාස්තු නොගෙවූ නිසා රඳවා ඇත. ඉක්මනින් ක්‍රියා කරන්න'),
        honest: C.checkMessage('Commercial Bank: never share your OTP or PIN with anyone. Rs. 2,500 was debited from your account. Call 0112353353 if this was not you.'),
        official: C.checkMessage('Your HNB statement is ready. Log in at https://www.hnb.net'),
      };
    });
    assert(m.courier.level === 'danger' && m.courier.links[0].bad && /Sri Lanka Post/.test(m.courier.links[0].notes.join(' ')), JSON.stringify(m.courier));
    assert(m.prize.level === 'danger' && m.prize.scam.length >= 2 && m.prize.links.some(l => /shortened/.test(l.notes.join(' '))), JSON.stringify(m.prize));
    assert(m.si.level !== 'ok' && m.si.scam.some(x => /customs/.test(x)), JSON.stringify(m.si));
    assert(m.honest.level === 'ok', JSON.stringify(m.honest));
    assert(m.official.level === 'ok' && m.official.links[0].official, JSON.stringify(m.official));
  });

  await step('0.8.0 fact-check bubble: news article shows who else reports it, fact-checks and warning signs; check a selection', async () => {
    await main((_, b) => { process.env.FERNA_NEWS_SEARCH = `${b}/check/news.xml`; global.__ferna.setSetting('factCheckAuto', false); }, base);
    await freshTab(`${lh()}/check/article.html`);
    const u = await ui();
    await H.until(() => u.evaluate(() => { const b = document.querySelector('#btn-check'); return !b.hidden && b.dataset.level === 'warn'; }), 8000, 'article flagged');
    await u.evaluate(() => document.querySelector('#btn-check').click());
    const p = await page('ferna://check/');
    await H.until(() => p.evaluate(() => !!document.querySelector('#cov-go')), 8000, 'panel');
    const flags = await p.evaluate(() => document.querySelector('#page').textContent);
    assert(/share or forward/i.test(flags) && /IMF approves/.test(flags), flags.slice(0, 300));
    await p.evaluate(() => document.querySelector('#cov-go').click());
    await H.until(() => p.evaluate(() => document.querySelectorAll('#cov .res li').length >= 4), 10000, 'coverage');
    const cov = await p.evaluate(() => ({ sum: document.querySelector('#cov .sum').textContent, est: [...document.querySelectorAll('#cov .badge.rel')].length, fc: [...document.querySelectorAll('#cov .badge.fc')].length, other: /Lanka Gossip/.test(document.querySelector('#cov').textContent), cricket: /Cricket/.test(document.querySelector('#cov').textContent) }));
    assert(cov.est === 3 && cov.fc === 1 && cov.other && !cov.cricket && /Fact-checkers/.test(cov.sum), JSON.stringify(cov));
    await shot('v080-08-factcheck-panel');
    // The button now carries the result
    await H.until(() => u.evaluate(() => /Fact check/.test(document.querySelector('#btn-check').title)), 4000, 'button title');
    // Right-click "Check this claim or message" on a selection
    await main(() => { const w = global.__ferna.windows[0]; global.__ferna.check.checkSelection(w, 'URGENT: your BOC account will be blocked today. Update your KYC at http://boc-lk-verify.top now'); });
    await H.until(() => p.evaluate(() => /Very likely a scam/.test(document.querySelector('#msg-out').textContent)), 6000, 'selection checked');
    const sel = await p.evaluate(() => document.querySelector('#msg-out').textContent);
    assert(/Bank of Ceylon/.test(sel), sel);
    await shot('v080-09-check-message');
    await main(() => { const w = global.__ferna.windows[0]; global.__ferna.check.closePanel(w); delete process.env.FERNA_NEWS_SEARCH; });
  });
  await step('0.8.0 smart workspaces: notices sites opened together, offers a workspace, opens it on schedule', async () => {
    const port = new URL(base).port;
    const sites = ['lms', 'mail', 'timetable'].map(n => `http://${n}.localhost:${port}/long.html?${n}`);
    await main((_, a) => {
      const c = global.__ferna, SW = c.smartws;
      c.setSetting('smartWorkspaces', true); c.setSetting('wsSchedules', []);
      SW.store.data.days = {}; SW.store.data.skip = []; SW.store.data.offered = {}; SW.store.data.made = [];
      const R = c._routines;
      // Four earlier days: the same three sites, a few minutes apart, at this time of day
      for (let d = 1; d <= 4; d++) a.forEach((u, i) => R.record(SW.store.data, u, ['Dashboard | SJP LMS', 'Inbox (12) - me@gmail.com - Gmail', 'Timetable 2026 - Google Sheets'][i], Date.now() - d * 86400000 - 20 * 60000 + i * 3 * 60000));
      c.__dlg = []; SW.showDialog = async (w, o) => { c.__dlg.push(o); return { response: 0 }; };
    }, sites);
    const n0 = await main(() => global.__ferna.ws.data.workspaces.length);
    for (const u of sites) await freshTab(u);
    const u = await ui();
    await H.until(() => u.evaluate(() => /Make it a workspace that opens itself/.test(document.querySelector('#toast').textContent)), 6000, 'offer toast');
    const toast = await u.evaluate(() => document.querySelector('#toast').textContent);
    assert(/SJP LMS/.test(toast) && /Gmail/.test(toast) && /Google Sheets/.test(toast), toast);
    await shot('v080-10-smartws-offer');
    await u.evaluate(() => document.querySelector('#toast .toast-act').click());
    await H.until(() => main((_, a) => global.__ferna.ws.data.workspaces.length > a, n0), 6000, 'workspace created');
    const made = await main(() => { const c = global.__ferna; const w = c.ws.data.workspaces[c.ws.data.workspaces.length - 1]; return { w, sched: c.settings.data.wsSchedules, dlg: c.__dlg[0], cur: c.windows[0].currentWs }; });
    assert(made.w.pinned.length === 3 && made.sched.length === 1 && made.sched[0].wsId === made.w.id && made.cur === made.w.id && /Make a workspace of/.test(made.dlg.message), JSON.stringify(made));
    // Not offered again the same way
    assert(await main(() => global.__ferna.smartws.routines().length === 0), 'not suggested again');
    // The schedule: close those tabs, make it due now, let the timer run
    await main((_, id) => {
      const c = global.__ferna, w = c.windows[0];
      for (const t of [...w.tabs]) if (/\.localhost:/.test(t.url)) w.closeTab(t);
      w.switchWorkspace(null);
      const d = new Date(Date.now() - 60000);
      c.lastFocused = w; // the schedule opens in the window you used last
      c.setSetting('wsSchedules', [{ wsId: id, days: [d.getDay()], time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, on: true, last: '' }]);
      c.smartws.tick();
    }, made.w.id);
    await H.until(() => main(() => global.__ferna.windows[0].tabs.filter(t => /\.localhost:/.test(t.url || t.pendingUrl || '')).length === 3), 8000, 'scheduled tabs open');
    const after = await main((_, id) => { const c = global.__ferna; return { cur: c.windows[0].currentWs === id, last: c.settings.data.wsSchedules[0].last, again: (c.smartws.tick(), c.windows[0].tabs.filter(t => /\.localhost:/.test(t.url || '')).length) }; }, made.w.id);
    assert(after.cur && after.last && after.again === 3, JSON.stringify(after));
    await H.until(() => u.evaluate(() => /scheduled/.test(document.querySelector('#toast').textContent)), 4000, 'opened toast');
    await shot('v080-11-smartws-opened');
    // Settings lists the schedule
    await main(() => global.__ferna.windows[0].openInternal('ferna://settings/#workspaces'));
    const sp = await page('ferna://settings/');
    await sp.reload(); // an earlier step may have left it open
    await H.until(() => sp.evaluate(() => document.querySelectorAll('#wsx-sched [data-ws]').length === 1), 6000, 'schedule in settings');
    await sp.evaluate(() => document.querySelector('#wsx-sched').scrollIntoView({ block: 'center' }));
    await shot('v080-12-smartws-settings');
    await main((_, id) => { const c = global.__ferna; c.deleteWorkspace(id); const w = c.windows[0]; for (const t of [...w.tabs]) if (/\.localhost:|ferna:\/\/settings/.test(t.url)) w.closeTab(t); }, made.w.id);
    assert(await main(() => (global.__ferna.settings.data.wsSchedules || []).length === 0), 'schedule removed with its workspace');
  });
  await step('0.8.1 Ctrl+Shift+H: a bar brought back by the window edge never keeps it on screen', async () => {
    await main(() => global.__ferna.setSetting('tabPosition', 'top'));
    // Hide, bring it back with the edge, show with the key, hide with the key: it must hide.
    await main(() => global.__ferna.windows[0].run('toggleTabBar'));
    await main(() => { const w = global.__ferna.windows[0]; w.reveal.tabs = true; w.relayout(); });
    await main(() => global.__ferna.windows[0].run('toggleTabBar'));
    await main(() => global.__ferna.windows[0].run('toggleTabBar'));
    await H.sleep(200);
    assert(!(await win()).layout.showTabs, 'hidden after the key');
    // Brought back by the edge: goes away once the pointer is on the page (real pointer, if xdotool is here).
    let xdo = false;
    try { require('child_process').execSync('command -v xdotool', { stdio: 'ignore' }); xdo = true; } catch { xdo = false; }
    if (xdo) {
      const disp = await main(() => process.env.DISPLAY);
      const mv = (x, y) => require('child_process').execSync(`DISPLAY=${disp} xdotool mousemove ${x} ${y}`);
      const b = await main(() => global.__ferna.windows[0].win.getContentBounds());
      mv(b.x + 300, b.y + 5);
      await main(() => { const w = global.__ferna.windows[0]; w.reveal.tabs = true; w.relayout(); });
      await H.sleep(1000);
      assert((await win()).layout.showTabs, 'stays while the pointer is on the bars');
      mv(b.x + 500, b.y + 500);
      await H.until(async () => !(await win()).layout.showTabs, 3000, 'hides once the pointer is on the page');
    }
    await main(() => global.__ferna.windows[0].run('toggleTabBar'));
    assert((await win()).layout.showTabs, 'shown again');
  });
  await step('0.8.2 feeds: Remove works on the first click and Add ticked never adds a feed twice (however often Manage was opened)', async () => {
    const r0 = await main(async (_, b) => {
      const F = global.__ferna.feeds;
      for (const f of [...F.store.data.feeds]) F.unsubscribe(f.id);
      F.STARTERS.local.unshift(['Test Lanka', `${b}/feeds/lanka.xml`], ['Test Many', `${b}/feeds/many.xml`]);
      // The same address at once, and written differently: one feed
      const u = `${b}/feeds/research.xml`;
      const fs = await Promise.all([F.subscribe(u), F.subscribe(u), F.subscribe(`${u}/`), F.subscribe(u.replace('http://localhost', 'http://LOCALHOST'))]);
      return { ids: [...new Set(fs.map(f => f.id))].length, n: F.store.data.feeds.length };
    }, lh());
    assert(r0.ids === 1 && r0.n === 1, JSON.stringify(r0));
    await main(() => { const w = global.__ferna.windows[0]; global.__ferna.feeds.closePanel(w); w.newTab('ferna://feeds/#manage'); });
    const p = await page('ferna://feeds/#manage');
    await p.reload();
    // Open Manage several times (each used to add another set of click handlers)
    for (let i = 0; i < 4; i++) { await p.evaluate(() => document.querySelector('#b-manage').click()); await H.sleep(150); await p.evaluate(() => { if (document.querySelector('#manage').hidden) document.querySelector('#b-manage').click(); }); await H.sleep(250); }
    await H.until(() => p.evaluate(() => !!document.querySelector('[data-addpack="local"]')), 5000, 'manage');
    await p.evaluate(() => { for (const b of document.querySelectorAll('input[data-pack="local"]')) if (/Test/.test(b.dataset.name)) b.checked = true; document.querySelector('[data-addpack="local"]').click(); });
    await H.until(() => main(() => global.__ferna.feeds.store.data.feeds.length === 3), 8000, 'two added');
    await H.sleep(800);
    const urls = await main(() => global.__ferna.feeds.store.data.feeds.map(f => f.url));
    assert(urls.length === 3 && new Set(urls).size === 3, JSON.stringify(urls));
    // Remove: one click asks once, inline; "Yes" removes it
    await H.until(() => p.evaluate(() => document.querySelectorAll('[data-unsub]').length === 3), 5000, 'rows');
    await p.evaluate(() => document.querySelector('[data-unsub]').click());
    const asks = await p.evaluate(() => document.querySelectorAll('.confirm').length);
    assert(asks === 1, `asked ${asks} times`);
    await shot('v082-01-remove-confirm');
    await p.evaluate(() => document.querySelector('.confirm [data-yes]').click());
    await H.until(() => main(() => global.__ferna.feeds.store.data.feeds.length === 2), 4000, 'removed with one click');
    // Duplicates left by older versions are cleaned up
    const dd = await main(() => { const F = global.__ferna.feeds; const f = F.store.data.feeds[0]; F.store.data.feeds.push({ ...f, id: 'dup1', url: f.url.replace('http://', 'http://www.').replace('www.localhost', 'localhost') + '/' }); const n = F.dedupeFeeds(); return { n, left: F.store.data.feeds.length }; });
    assert(dd.n === 1 && dd.left === 2, JSON.stringify(dd));
    // Bulk: select all, remove both with one confirmation
    await H.until(() => p.evaluate(() => document.querySelectorAll('[data-sel]').length === 2), 5000, 'two rows');
    await p.evaluate(() => { const a = document.querySelector('#m-selall'); a.click(); });
    await H.until(() => p.evaluate(() => !document.querySelector('.bulk-acts').hidden && /2 selected/.test(document.querySelector('#m-selcount').textContent)), 3000, 'bulk bar');
    await shot('v082-02-bulk');
    await p.evaluate(() => document.querySelector('[data-bulk="remove"]').click());
    await p.evaluate(() => document.querySelector('#m-confirm [data-yes]').click());
    await H.until(() => main(() => global.__ferna.feeds.store.data.feeds.length === 0), 4000, 'bulk removed');
    await main(() => { const F = global.__ferna.feeds; F.STARTERS.local = F.STARTERS.local.filter(x => !/^Test/.test(x[0])); });
  });

  await step('0.8.2 feeds: read as you scroll, open modes, display settings, clusters with sources, export and import of everything', async () => {
    await main(async (_, b) => {
      const F = global.__ferna.feeds;
      for (const n of ['many', 'lanka', 'world']) await F.subscribe(`${b}/feeds/${n}.xml`);
      await F.poll({ force: true });
      F.setPrefs({ markRead: 'scroll', openMode: 'reader', density: 'cards', fontSize: 15, cluster: true });
    }, lh());
    await main(() => { const w = global.__ferna.windows[0]; for (const t of [...w.tabs]) if (/^ferna:\/\/feeds\//.test(t.url || '')) w.closeTab(t); w.newTab('ferna://feeds/?scrolltest'); });
    await H.sleep(600);
    const p = await page('ferna://feeds/?scrolltest'); // not the hidden panel kept for later
    await p.evaluate(() => { [...document.querySelectorAll('.st')].find(b => b.dataset.stream === 'all').click(); });
    await H.until(() => p.evaluate(() => document.querySelectorAll('.fc').length >= 30), 8000, 'many cards');
    const before = await main(() => global.__ferna.feeds.unreadCount());
    const nav0 = await p.evaluate(() => document.querySelector('.st[data-stream="all"] .n').textContent);
    // Scroll down through the list: items that pass the top become read; the counts go down
    for (let i = 0; i < 8; i++) { await p.evaluate(() => { document.querySelector('#cards').scrollBy(0, 300); }); await H.sleep(120); }
    await H.sleep(900);
    const after = await main(() => global.__ferna.feeds.unreadCount());
    const nav1 = await p.evaluate(() => document.querySelector('.st[data-stream="all"] .n').textContent);
    const readCards = await p.evaluate(() => document.querySelectorAll('.fc.read').length);
    assert(after < before && Number(nav1) === after && Number(nav0) === before && readCards >= 3, JSON.stringify({ before, after, nav0, nav1, readCards }));
    const badge = await (await ui()).evaluate(() => document.querySelector('#feeds-count').textContent);
    assert(Number(badge) === after, `toolbar ${badge} vs ${after}`);
    await shot('v082-03-read-on-scroll');
    // A story covered twice: one card, "Also reported by", expand the reports
    await p.evaluate(() => document.querySelector('#cards').scrollTo(0, 0));
    await p.evaluate(() => { [...document.querySelectorAll('.fc')].find(c => /IMF/.test(c.textContent)).querySelector('[data-act="sources"]').click(); });
    const cl = await p.evaluate(() => { const c = [...document.querySelectorAll('.fc')].find(x => /IMF/.test(x.textContent)); return { also: c.querySelector('.also').textContent, items: c.querySelectorAll('.srcs li').length, lead: !!c.querySelector('.srcs .lead') }; });
    assert(/Also reported by/.test(cl.also) && cl.items >= 2 && cl.lead, JSON.stringify(cl));
    // Grouping off: two cards for that story
    await main(() => global.__ferna.feeds.setPrefs({ cluster: false }));
    await H.until(() => p.evaluate(() => [...document.querySelectorAll('.fc')].filter(c => /IMF/.test(c.querySelector('h3').textContent)).length >= 2), 5000, 'ungrouped');
    await main(() => global.__ferna.feeds.setPrefs({ cluster: true }));
    // Display: text size, font and reading width apply at once; side-panel width
    await p.evaluate(() => document.querySelector('#b-view').click());
    await p.evaluate(() => { const r = document.querySelector('#viewpop [data-v="fontSize"]'); r.value = '19'; r.dispatchEvent(new Event('input', { bubbles: true })); const f = document.querySelector('#viewpop [data-v="fontFamily"]'); f.value = 'serif'; f.dispatchEvent(new Event('change', { bubbles: true })); });
    const dsp = await p.evaluate(() => ({ fs: document.body.style.getPropertyValue('--fs'), ff: getComputedStyle(document.querySelector('.fc h3')).fontFamily, h3: getComputedStyle(document.querySelector('.fc h3')).fontSize }));
    assert(dsp.fs === '19px' && /Georgia|Serif/i.test(dsp.ff) && dsp.h3 === '19px', JSON.stringify(dsp));
    await shot('v082-04-display');
    await H.until(() => main(() => global.__ferna.feeds.prefs().settings.fontSize === 19), 3000, 'saved');
    await main(() => global.__ferna.feeds.setPrefs({ fontSize: 15, fontFamily: 'system' }));
    await p.evaluate(() => document.querySelector('#viewpop [data-close]').click());
    // Open modes: the original page in a new tab; the reader in a new tab
    await main(() => global.__ferna.feeds.setPrefs({ openMode: 'tab' }));
    await H.sleep(500);
    const n0 = await main(() => global.__ferna.windows[0].tabs.length);
    await p.evaluate(() => [...document.querySelectorAll('.fc h3 a')].find(a => /Tea exports/.test(a.textContent)).click());
    await H.until(() => main((_, a) => global.__ferna.windows[0].tabs.length === a + 1 && /example\.lk\/many/.test(global.__ferna.windows[0].active.pendingUrl || global.__ferna.windows[0].active.url), n0), 4000, 'original in a tab');
    await main(() => { const w = global.__ferna.windows[0]; w.closeTab(w.active); });
    await main(() => global.__ferna.feeds.setPrefs({ openMode: 'reader-tab' }));
    await H.sleep(500);
    await p.evaluate(() => [...document.querySelectorAll('.fc h3 a')].find(a => /Rupee/.test(a.textContent)).click());
    await H.until(() => main(() => /^ferna:\/\/feeds\/#read\//.test(global.__ferna.windows[0].active.url || '')), 4000, 'reader in a tab');
    const rt = await page('ferna://feeds/#read/');
    await H.until(() => rt.evaluate(() => /Rupee/.test((document.querySelector('.rd h1') || {}).textContent || '')), 5000, 'reader tab shows it');
    await main(() => { const w = global.__ferna.windows[0]; w.closeTab(w.active); global.__ferna.feeds.setPrefs({ openMode: 'reader' }); });
    // Side panel width
    await main(() => { const w = global.__ferna.windows[0]; global.__ferna.setSetting('feedsPanelWidth', 600); global.__ferna.feeds.togglePanel(w, true); });
    await H.sleep(400);
    const pw = await main(() => global.__ferna.windows[0].side.view.getBounds().width);
    assert(pw === 600, `panel ${pw}`);
    await main(() => { const w = global.__ferna.windows[0]; global.__ferna.feeds.closePanel(w); global.__ferna.setSetting('feedsPanelWidth', 420); });
    // Export everything, remove all, import: feeds, channels, interests and display come back
    const ex = await main(async () => {
      const F = global.__ferna.feeds;
      F.setPrefs({ interests: 'machine learning', fontSize: 17, channels: [{ id: 'c1', name: 'Economy', keywords: '+IMF', feeds: [F.store.data.feeds[0].id] }] });
      const data = JSON.parse(JSON.stringify(F.exportAll()));
      F.unsubscribe(F.store.data.feeds.map(f => f.id)); F.setPrefs({ interests: '', fontSize: 15, channels: [] });
      const r = F.importAll(data);
      const again = F.importAll(data);
      const s = F.prefs();
      return { r, again, feeds: F.store.data.feeds.length, interests: s.interests, fs: s.settings.fontSize, ch: s.channels.length, chFeedOk: F.store.data.feeds.some(f => f.id === s.channels[0].feeds[0]) };
    });
    assert(ex.r.added === 3 && ex.again.added === 0 && ex.feeds === 3 && ex.interests === 'machine learning' && ex.fs === 17 && ex.ch === 1 && ex.chFeedOk, JSON.stringify(ex));
    await main(() => { const F = global.__ferna.feeds; F.unsubscribe(F.store.data.feeds.map(f => f.id)); F.setPrefs({ interests: '', fontSize: 15, channels: [] }); });
  });
};
