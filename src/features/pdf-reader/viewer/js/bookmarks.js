// Auto-Bookmark (v1.4): builds a bookmark tree the way a person would.
//  1. If the document has a printed table of contents, that is the outline people expect: its entries are
//     read (titles, page numbers, indentation/numbering → levels), mapped to physical pages and located
//     exactly on their pages.
//  2. Otherwise the headings are found from the page layout: numbering (1, 1.1, I., A.), chapter words
//     (Chapter, පරිච්ඡේදය …), front/back matter (Abstract, References, සාරාංශය, ආශ්‍රිත ග්‍රන්ථ …), font
//     size and spacing. Numbered lists, captions, running headers and title blocks are left out; slide
//     decks get one bookmark per new slide title.
//  English and Sinhala are supported. The language model can then review the result.
import { el, icon, toast } from './util.js';
import { parseJSONLoose } from './ai/engine.js';
import { siNorm, hasSinhala } from './sinhala.js';
import { inkRunTexts } from './textsel.js';

const SI_LETTER = '඀-෿';
const NUMBERED = new RegExp(`^((?:\\d{1,2}\\.){0,3}\\d{1,2})(?:\\.?\\s+|[.)]\\s*(?=[${SI_LETTER}]))(\\S.{0,110})$`);
const KEYWORD = /^(chapter|part|appendix|section|lecture|unit|module|lesson|week|topic)\s+([\dIVXLC]{1,6}|[A-Z])\b[.:\-–—]?\s*(.*)$/i;
const ROMAN = /^([IVX]{1,5})\.\s+([A-Z].{1,100})$/;
const LETTER = /^([A-H])\.\s+([A-Z].{1,100})$/;
const CAPTION = /^(fig(ure)?|table|tab\.|algorithm|listing|eq(uation)?|chart|plate|රූපය|රූප\s*සටහන|වගුව|සටහන|ප්‍රස්තාරය|සමීකරණය|ඇල්ගොරිතමය)\.?\s*[:\-]?\s*\d/i;
const SPECIAL_EN = /^(abstract|introduction|conclusions?( and future work)?|references|bibliography|works cited|acknowledg(e)?ments?|appendi(x|ces)( [A-Z\d]+)?|contents|table of contents|list of (figures|tables|abbreviations|symbols)|preface|foreword|summary|executive summary|index|glossary|discussion|related work|literature review|background|methods?|methodology|materials and methods|results( and discussion)?|future work|exercises|problems|declaration|dedication|abbreviations|nomenclature)\b[\s:.]*$/i;
// Sinhala front/back matter and common section names (compared without spaces and joiners)
const SPECIAL_SI = new Set(['සාරාංශය', 'සංක්ෂිප්තය', 'හැඳින්වීම', 'පසුබිම', 'නිගමනය', 'නිගමන', 'නිගමනසහනිර්දේශ', 'ආශ්‍රිතග්‍රන්ථ',
  'ආශ්‍රිතග්‍රන්ථනාමාවලිය', 'ග්‍රන්ථනාමාවලිය', 'මූලාශ්‍ර', 'ආශ්‍රිතමූලාශ්‍ර', 'පටුන', 'විෂයසූචිය', 'පෙරවදන', 'ප්‍රස්තාවනාව', 'ස්තුතිය',
  'කෘතඥතාව', 'කෘතඥතාපූර්වකස්තුතිය', 'උපග්‍රන්ථය', 'උපග්‍රන්ථ', 'ඇමුණුම', 'ඇමුණුම්', 'ක්‍රමවේදය', 'පර්යේෂණක්‍රමවේදය', 'ප්‍රතිඵල',
  'සාකච්ඡාව', 'ප්‍රතිඵලසහසාකච්ඡාව', 'සාහිත්‍යවිමර්ශනය', 'සාහිත්‍යසමාලෝචනය', 'අරමුණු', 'පර්යේෂණඅරමුණු', 'පාරිභාෂිකශබ්දමාලාව',
  'ශබ්දකෝෂය', 'නිර්දේශ', 'ඉදිරිපර්යේෂණ', 'රූපසටහන්ලැයිස්තුව', 'වගුලැයිස්තුව', 'කෙටියෙදුම්', 'ප්‍රකාශය', 'කැපවීම'].map((w) => siNorm(w)));
const SI_UNIT = 'පරිච්ඡේදය|කොටස|ඒකකය|පාඩම|අධ්‍යාය|උපග්‍රන්ථය|ඇමුණුම';
const SI_ORD = { 'පළමු': 1, 'පළමුවන': 1, 'පළමුවැනි': 1, 'දෙවන': 2, 'දෙවැනි': 2, 'දෙවෙනි': 2, 'තෙවන': 3, 'තෙවැනි': 3, 'තුන්වන': 3, 'තුන්වැනි': 3,
  'සිව්වන': 4, 'සිව්වැනි': 4, 'හතරවන': 4, 'හතරවැනි': 4, 'පස්වන': 5, 'පස්වැනි': 5, 'හයවන': 6, 'හයවැනි': 6, 'සයවන': 6, 'හත්වන': 7, 'හත්වැනි': 7,
  'සත්වන': 7, 'අටවන': 8, 'අටවැනි': 8, 'නවවන': 9, 'නමවන': 9, 'නවවැනි': 9, 'දහවන': 10, 'දසවන': 10, 'දහවැනි': 10 };
const SI_KEYWORD = new RegExp(`^(${siNorm(SI_UNIT)})\\s*(\\d{1,3}|[IVX]{1,5})\\s*[.:\\-–—]?\\s*(.*)$`);
const SI_KEYWORD_ORD = new RegExp(`^(${Object.keys(SI_ORD).map(siNorm).join('|')}|\\d{1,2}\\s*(?:වන|වැනි|වෙනි))\\s*(${siNorm(SI_UNIT)})\\s*[.:\\-–—]?\\s*(.*)$`);
const TOC_TITLE = /^(table\s+of\s+)?contents$|^පටුන$|^විෂයසූචිය$|^අන්තර්ගතය$|^පටුන\/?contents$/i;
const LOF_TITLE = /^list\s+of\s+(figures|tables|illustrations|abbreviations)|^(රූපසටහන්|රූප|වගු)ලැයිස්තුව/i;

const key = (t) => siNorm(t).toLowerCase().replace(/[\s.:·…_\-–—]+/g, '');
const isSpecial = (t) => SPECIAL_EN.test(t.trim()) || SPECIAL_SI.has(siNorm(t).replace(/[\s.:]+/g, ''));

function keywordHeading(t) {
  let m = KEYWORD.exec(t);
  if (m) return { num: m[2], word: m[1], rest: m[3] };
  const n = siNorm(t);
  if ((m = SI_KEYWORD.exec(n))) return { num: m[2], word: m[1], rest: m[3], si: true };
  if ((m = SI_KEYWORD_ORD.exec(n))) return { num: String(SI_ORD[m[1]] ?? parseInt(m[1], 10)), word: m[2], rest: m[3], si: true, ordinal: m[1] };
  return null;
}

// ====================================================================== main entry
export async function detectHeadings(doctext, onProgress) {
  const n = doctext.numPages;
  const furniture = await doctext.furniture();
  const all = [];
  for (let i = 0; i < n; i++) {
    const lines = (await doctext.pageLines(i)).filter((l) => !l.vertical && !doctext.isFurniture(l, furniture));
    lines.forEach((l, k) => { l.prevBottom = k ? lines[k - 1].bottom : null; l.nextTop = k + 1 < lines.length ? lines[k + 1].top : null; l.idx = k; l.count = lines.length; });
    all.push(...lines);
    if (i % 10 === 0) onProgress?.(0.8 * (i + 1) / n);
  }
  if (!all.length) return { items: [], body: 0, source: 'none' };
  const hist = new Map();
  for (const l of all) { const k = Math.round(l.avgSize * 2) / 2; hist.set(k, (hist.get(k) || 0) + l.text.length); }
  const body = [...hist].sort((a, b) => b[1] - a[1])[0][0];

  let res = null;
  // 1. printed table of contents
  try {
    const toc = await fromTOC(doctext, all, body, (p) => onProgress?.(0.8 + 0.15 * p));
    if (toc) res = { items: toc, source: 'toc' };
  } catch (e) { console.warn('TOC parsing failed', e); }
  // 2. slide decks, 3. layout headings
  if (!res && isDeck(doctext, all)) res = { items: deckItems(doctext, all, body), source: 'slides' };
  if (!res) res = { items: layoutItems(all, body, n), source: 'layout' };
  await fixSpacingFromInk(doctext, res.items);
  return { items: number(res.items), body, source: res.source };
}

// Some PDF writers place Sinhala clusters one by one and the extracted text has missing or extra spaces.
// For such pages, render the page once and take the word spaces from the ink (as the text layer does).
async function fixSpacingFromInk(doctext, items) {
  const pages = [...new Set(items.filter((c) => hasSinhala(c.title)).map((c) => c.page))];
  let done = 0;
  for (const p of pages) {
    if (done > 60) break;
    const pv = doctext.viewer.pages[p];
    const tc = await pv.textRuns();
    if (!tc.items.some((it) => it._parts)) continue;
    try {
      const page = await pv.ensurePage();
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d', { willReadFrequently: true }), canvas, viewport, background: '#ffffff' }).promise;
      const texts = [...inkRunTexts(tc, { canvas, viewport }).values()];
      canvas.width = canvas.height = 0;
      const strip = (x) => siNorm(x).replace(/\s+/g, '');
      for (const c of items.filter((x) => x.page === p && hasSinhala(x.title))) {
        const want = strip(c.title);
        const m = /^((?:\d{1,2}\.)*\d{1,2}\.?)\s*/.exec(c.title);
        const core = m ? c.title.slice(m[0].length) : c.title;
        for (const t of texts) {
          const st = strip(t);
          if (st === want) { c.title = tidy(t); break; }
          if (st.endsWith(strip(core)) && strip(core).length >= 2) {
            // take the spacing of the matching tail
            let k = 0, cut = t.length;
            const target = st.length - strip(core).length;
            for (let i = 0; i < t.length; i++) { if (k === target) { cut = i; break; } if (!/\s/.test(t[i])) k++; }
            const tail = t.slice(cut).trim();
            if (strip(tail) === strip(core)) { c.title = (m ? m[0].trim() + ' ' : '') + tidy(tail); break; }
          }
        }
      }
      done++;
    } catch (e) { console.warn('ink spacing', e); }
  }
}

function number(items) {
  return items.slice(0, 600).map((c, i) => ({ id: i + 1, page: c.page, y: c.y ?? null, level: c.level, title: c.title, size: c.size ?? 1 }));
}

// ====================================================================== 1. table of contents
async function fromTOC(doctext, all, body, onProgress) {
  const n = doctext.numPages;
  const scanN = Math.min(n, 30, Math.max(8, Math.ceil(n * 0.2)));
  const pages = [];
  let tocTitle = null;
  for (let i = 0; i < scanN; i++) {
    const rows = await doctext.rowLines(i);
    const head = rows.slice(0, 6).find((r) => TOC_TITLE.test(key(r.text)));
    if (pages.length && rows.slice(0, 4).some((r) => LOF_TITLE.test(key(r.text)))) break;   // list of figures follows
    const cand = tocEntries(rows);
    if ((head && cand.length >= 3) || (pages.length && cand.length >= 3 && cand.length >= rows.length * 0.35) || (!pages.length && cand.length >= 8 && cand.length >= rows.length * 0.6)) {
      if (head && !tocTitle) tocTitle = { text: head.text, page: i, y: head.top };
      pages.push({ i, entries: cand });
    } else if (pages.length) break;
  }
  if (!pages.length) return null;
  let entries = pages.flatMap((p) => p.entries.map((e) => ({ ...e, tocPage: p.i })));
  if (entries.length < 4) return null;
  const lastToc = pages[pages.length - 1].i;

  // levels: numbering depth, else indentation
  const xs = [...new Set(entries.map((e) => Math.round(e.x / 5) * 5))].sort((a, b) => a - b);
  const clusters = [];
  for (const x of xs) { if (!clusters.length || x - clusters[clusters.length - 1] > 7) clusters.push(x); }
  const indentLevel = (x) => { let k = 0; clusters.forEach((c, i) => { if (x >= c - 4) k = i; }); return Math.min(4, k + 1); };
  const numbered = entries.filter((e) => e.depth);
  const depthByIndent = new Map();
  for (const e of numbered) { const il = indentLevel(e.x); depthByIndent.set(il, [...(depthByIndent.get(il) || []), e.depth]); }
  for (const e of entries) {
    if (e.keyword) e.level = 1;
    else if (e.depth) e.level = Math.min(4, e.depth);
    else {
      const il = indentLevel(e.x);
      const d = depthByIndent.get(il);
      e.level = d ? Math.round(d.reduce((a, b) => a + b, 0) / d.length) : il;
    }
  }

  // printed page numbers → physical pages: page labels, else the most common offset of found titles
  const labels = await doctext.viewer.pdf?.getPageLabels?.().catch(() => null);
  const labelIdx = new Map();
  if (labels) labels.forEach((l, i) => { if (l && !labelIdx.has(l.toLowerCase())) labelIdx.set(l.toLowerCase(), i); });
  const byPage = new Map();
  for (const l of all) (byPage.get(l.page) || byPage.set(l.page, []).get(l.page)).push(l);
  // the heading line of an entry on page p: best match first (whole heading > start of line > anywhere)
  const findOn = (e, p, minQ = 1) => {
    const want = key(e.core);
    if (want.length < 2) return null;
    const w28 = want.slice(0, 28);
    let best = null, bq = 0;
    for (const l of byPage.get(p) || []) {
      let k = key(l.text).replace(/^(\d{1,2}\.)*\d{1,2}/, '');
      const kw = keywordHeading(l.text);
      if (kw?.rest) k = key(kw.rest);
      let q = 0;
      if (k === want || (k.startsWith(w28) && k.length <= want.length + 8)) q = 3;
      else if (k.includes(w28) && k.length <= want.length * 1.5 + 8) q = 2;
      else if (k.includes(w28) || (want.length > 10 && k.length > 6 && want.startsWith(k.slice(0, 28)))) q = 1;
      if (q && l.avgSize >= body * 1.05) q += 0.5;
      if (q > bq) { bq = q; best = l; }
    }
    return bq >= minQ ? best : null;
  };
  const offsets = new Map();
  for (const e of entries.filter((x) => x.arabic).slice(0, 14)) {
    for (let p = lastToc + 1; p < n; p++) {
      if (findOn(e, p, 2)) { const o = p - e.num; offsets.set(o, (offsets.get(o) || 0) + 1); break; }
    }
    onProgress?.(0.5 * entries.indexOf(e) / entries.length);
  }
  let offset = [...offsets].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (offset == null) {
    const first = entries.find((x) => x.arabic);
    offset = first ? lastToc + 1 - first.num : 0;
  }
  const romanOffset = (() => {
    const m = new Map();
    for (const e of entries.filter((x) => x.roman)) {
      for (let p = 0; p < n && p <= e.num + 3; p++) if (findOn(e, p, 2)) { const o = p - e.num; m.set(o, (m.get(o) || 0) + 1); break; }
    }
    return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1;
  })();

  let verified = 0;
  for (const e of entries) {
    let target = labelIdx.get(e.label.toLowerCase());
    if (target == null) target = e.roman ? e.num + romanOffset : e.num + offset;
    target = Math.max(0, Math.min(n - 1, target));
    let hit = null, page = target;
    for (const d of [0, 1, -1, 2, -2]) {
      const p = target + d;
      if (p < 0 || p >= n || p <= lastToc && e.arabic) continue;
      const h = findOn(e, p);
      if (h) { hit = h; page = p; break; }
    }
    e.page = page;
    e.y = hit ? hit.top + hit.size * 0.2 : null;
    if (hit) { verified++; e.title = mergeSpacing(e.title, e.prefix, hit.text); }
  }
  onProgress?.(1);
  if (verified < Math.max(3, entries.length * 0.5)) return null;

  // keep document order; drop entries that point backwards (e.g. an index line mis-read)
  entries = entries.filter((e, i) => i === 0 || e.page >= entries[i - 1].page - 1);
  const out = entries.map((e) => ({ page: e.page, y: e.y, level: e.level, title: e.title }));
  // the contents page itself, and front matter (Preface, Acknowledgements …) that the TOC does not list
  const firstMain = entries.find((e) => e.arabic)?.page ?? entries[0].page;
  const inToc = (l) => entries.some((e) => Math.abs(e.page - l.page) <= 1 && (key(e.core) === key(l.text) || key(e.title) === key(l.text)));
  const front = all.filter((l) => l.page < firstMain && l.page !== tocTitle?.page && isSpecial(l.text) && l.avgSize >= body * 0.85 &&
    l.idx <= 2 && !inToc(l));
  // back matter after the last listed chapter (References / ආශ්‍රිත ග්‍රන්ථ are often left out of the TOC)
  const lastPage = entries[entries.length - 1].page;
  const back = all.filter((l) => l.page > lastPage && isSpecial(l.text) && l.avgSize >= body * 1.1 && l.idx <= 2 && !inToc(l));
  for (const l of [...front, ...back]) if (!out.some((o) => key(o.title) === key(l.text))) out.push({ page: l.page, y: l.top + l.size * 0.2, level: 1, title: titleCase(tidy(l.text)) });
  if (tocTitle && !out.some((o) => o.page === tocTitle.page && TOC_TITLE.test(key(o.title)))) out.push({ page: tocTitle.page, y: tocTitle.y, level: 1, title: titleCase(tidy(tocTitle.text)) });
  out.sort((a, b) => a.page - b.page || (b.y ?? 1e9) - (a.y ?? 1e9));
  fixLevels(out);
  return out;
}

// Entries on one contents page: "1.2 Title ....... 14", "Chapter 3  Methods  41", "Preface  vii"
function tocEntries(rows) {
  const raw = [];
  for (let k = 0; k < rows.length; k++) {
    const r = rows[k];
    const t = r.text.replace(/\s+/g, ' ').trim();
    const m = /^(.*?[^\s.·…_\-–])[\s.·…_\-–]*?\s*((?:\d{1,4})|(?:[ivxlcdm]{1,7}))$/i.exec(t);
    if (!m || !/\p{L}/u.test(m[1])) { raw.push({ r, t, num: null }); continue; }
    const leaders = /(\.\s?){3,}|…|_{3,}|·{3,}/.test(t);
    const label = m[2];
    raw.push({ r, t, title: m[1].replace(/[\s.·…_]+$/, ''), label, leaders });
  }
  // right edge shared by the page numbers
  const edges = raw.filter((x) => x.label).map((x) => Math.round(x.r.x2 / 3) * 3);
  const freq = new Map();
  for (const e of edges) freq.set(e, (freq.get(e) || 0) + 1);
  const edge = [...freq].sort((a, b) => b[1] - a[1])[0]?.[0];
  const out = [];
  let pending = null;
  for (const x of raw) {
    if (!x.label) {
      // a long title that wraps: the first part has no page number
      if (/\p{L}/u.test(x.t) && x.t.length < 140 && !TOC_TITLE.test(key(x.t))) pending = pending ? { ...pending, t: pending.t + ' ' + x.t } : { t: x.t, r: x.r };
      else pending = null;
      continue;
    }
    const aligned = edge != null && Math.abs(x.r.x2 - edge) <= 6;
    if (!x.leaders && !aligned) { pending = null; continue; }
    if (CAPTION.test(x.title)) { pending = null; continue; }
    let title = x.title, r = x.r;
    if (pending && pending.r.x <= x.r.x + 30 && pending.r.top - x.r.top < x.r.size * 2.6) { title = pending.t + ' ' + title; r = pending.r; }
    pending = null;
    const roman = /^[ivxlcdm]+$/i.test(x.label) && !/^\d/.test(x.label);
    const num = roman ? romanValue(x.label) : parseInt(x.label, 10);
    if (!(num > 0)) continue;
    // numbering / chapter word
    let prefix = '', core = title, depth = 0, kw = null;
    const nm = /^((?:\d{1,2}\.)*\d{1,2})(\.?)\s*(.+)$/.exec(title);
    if (nm && /^[\p{L}(]/u.test(nm[3])) { prefix = nm[1]; core = nm[3]; depth = nm[1].split('.').length; }
    else if ((kw = keywordHeading(title))) { core = kw.rest || title; }
    else {
      const rm = /^([IVX]{1,5}|[A-H])\.\s+(.+)$/.exec(title) || /^([A-H])\s+(\p{Lu}.+)$/u.exec(title);
      if (rm) { prefix = rm[1] + (title[rm[1].length] === '.' ? '.' : ''); core = rm[2]; }
    }
    const clean = tidy(prefix && depth ? `${prefix}${depth === 1 && /\./.test(nm[2]) ? '.' : ''} ${core}` : title);
    out.push({ title: clean, core, prefix: prefix && depth ? clean.slice(0, clean.length - tidy(core).length).trim() : '', label: x.label, num, roman, arabic: !roman, depth, keyword: !!kw, x: r.x, top: r.top });
  }
  return out;
}

function romanValue(s) {
  const v = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  let t = 0;
  const a = s.toLowerCase();
  for (let i = 0; i < a.length; i++) { const c = v[a[i]], d = v[a[i + 1]] || 0; t += c < d ? -c : c; }
  return t;
}

// The same title read twice (contents line and heading) — keep only the spaces both agree on.
// Some PDF writers put spaces in the wrong places; the mistakes rarely repeat in both copies.
function mergeSpacing(title, prefix, headingText) {
  const core = prefix ? title.slice(prefix.length).trim() : title;
  let h = headingText.trim();
  const hn = /^((?:\d{1,2}\.)*\d{1,2})\.?\s*/.exec(h);
  if (hn && prefix && hn[1] === prefix.replace(/\.$/, '')) h = h.slice(hn[0].length);
  const kw = keywordHeading(h);
  if (kw && kw.rest) h = kw.rest;
  const strip = (s) => s.replace(/\s+/g, '');
  if (!hasSinhala(core) || strip(core) !== strip(h)) return title;
  const spacesOf = (s) => { const set = new Set(); let k = 0; for (const ch of s) { if (/\s/.test(ch)) set.add(k); else k++; } return set; };
  const a = spacesOf(core), b = spacesOf(h);
  let out = '', k = 0;
  for (const ch of strip(core)) { if (k && a.has(k) && b.has(k)) out += ' '; out += ch; k++; }
  return (prefix ? prefix + ' ' : '') + out;
}

// ====================================================================== 2. slide decks
function isDeck(doctext, all) {
  const pages = doctext.viewer.pages;
  const n = pages.length;
  if (n < 4) return false;
  const land = pages.filter((p) => p.dispWpt > p.dispHpt * 1.15).length;
  return land >= n * 0.7 && all.length / n < 40;
}

function deckItems(doctext, all, body) {
  const pages = doctext.viewer.pages;
  const byPage = new Map();
  for (const l of all) (byPage.get(l.page) || byPage.set(l.page, []).get(l.page)).push(l);
  const out = [];
  let prevKey = null;
  for (let i = 0; i < pages.length; i++) {
    const pv = pages[i];
    const lines = (byPage.get(i) || []).filter((l) => /\p{L}/u.test(l.text));
    if (!lines.length) continue;
    const top = pv.y0 + pv.rawH;
    // the slide title: the largest line in the upper part of the slide
    const upper = lines.filter((l) => l.top > top - pv.rawH * 0.35);
    const pool = upper.length ? upper : lines;
    const maxSize = Math.max(...pool.map((l) => l.avgSize));
    let tl = pool.filter((l) => l.avgSize >= maxSize - 0.3).sort((a, b) => b.top - a.top);
    if (!tl.length || maxSize < body * 1.08) continue;
    const t = tidy(tl.slice(0, 2).filter((l) => tl[0].top - l.top < l.size * 1.8).map((l) => l.text).join(' '));
    // a section slide: little text besides a big title near the middle
    const mid = tl[0].top < top - pv.rawH * 0.3 && tl[0].top > pv.y0 + pv.rawH * 0.3;
    const section = lines.length <= 3 && mid;
    const k = key(t.replace(/\s*[(\[]?(cont(\.|inued)?|contd\.?|\d+\s*\/\s*\d+|[ivx]+)[)\]]?\s*$/i, ''));
    if (k === prevKey || k.length < 2) continue;
    prevKey = k;
    out.push({ page: i, y: tl[0].top + tl[0].size * 0.2, level: section ? 1 : 2, title: titleCase(t), section, size: +(maxSize / body).toFixed(2) });
  }
  // title slide = document title, not a bookmark; without section slides everything is level 1
  if (out.length > 3 && out[0].page === 0) out.shift();
  if (!out.some((c) => c.section)) for (const c of out) c.level = 1;
  fixLevels(out);
  return out;
}

// ====================================================================== 3. layout headings
function layoutItems(all, body, n) {
  const cands = [];
  for (const l of all) {
    const t = l.text.trim();
    if (t.length < 2 || t.length > 130) continue;
    if (CAPTION.test(t) || /^[\d\s.,;:()%\-–]+$/.test(t) || /[,;]$/.test(t)) continue;
    const words = t.split(/\s+/).length;
    const ratio = l.avgSize / body;
    const isolated = l.prevBottom == null || (l.prevBottom - l.top) > l.size * 0.6;
    const spaceBelow = l.nextTop == null || (l.bottom - l.nextTop) > l.size * 0.35;
    let m, num = null, kind = null, title = t, kw;
    if ((kw = keywordHeading(t))) { kind = 'keyword'; num = kw.num; title = t; }
    else if ((m = NUMBERED.exec(t)) && new RegExp(`^[A-ZÀ-ɏ${SI_LETTER}]`).test(m[2]) && !/^\d+(\.\d+)*\s*[-–+*/=<>×]/.test(t) && Number(m[1].split('.')[0]) <= 60) { kind = 'numbered'; num = m[1]; title = m[2]; }
    else if ((m = ROMAN.exec(t))) { kind = 'roman'; num = m[1]; title = m[2]; }
    else if ((m = LETTER.exec(t)) && ratio >= 0.98) { kind = 'letter'; num = m[1]; title = m[2]; }
    const large = ratio >= 1.12;
    const special = isSpecial(t) && ratio >= 0.85 && isolated;
    let ok = false;
    const sentence = /[.!?]\s+\S/.test(title) || (hasSinhala(title) ? /(යි|වේ|ය|ත|ද)\.$/.test(title) && words > 5 : /\.\s*$/.test(title) && words > 6);
    if (kind && isolated && words <= 16 && ratio >= 0.95 && !sentence) ok = true;
    if (large && words <= 18 && /\p{L}/u.test(t) && !sentence) ok = true;
    if (special) ok = true;
    if (!ok) continue;
    const dot = kind === 'numbered' && t.slice(num.length).startsWith('.') && !/^\d/.test(t.slice(num.length + 1));
    cands.push({ page: l.page, y: l.top, bottom: l.bottom, size: l.avgSize, ratio, text: t, title, num, kind, large, x: l.x, isolated, spaceBelow, special, dot });
  }

  // numbered lists are not headings: a body-size "1." with "2." (or the previous number) on nearby lines
  const pageLinesOf = new Map();
  for (const l of all) (pageLinesOf.get(l.page) || pageLinesOf.set(l.page, []).get(l.page)).push(l);
  for (const c of cands) {
    if (c.kind !== 'numbered' || c.ratio >= 1.08 || c.num.includes('.')) continue;
    const n0 = Number(c.num);
    const lines = pageLinesOf.get(c.page) || [];
    const at = lines.findIndex((l) => Math.abs(l.top - c.y) < 0.5);
    for (let k = Math.max(0, at - 4); k <= Math.min(lines.length - 1, at + 4); k++) {
      if (k === at) continue;
      const m = /^(\d{1,2})[.)]?\s/.exec(lines[k].text);
      if (m && Math.abs(Number(m[1]) - n0) === 1 && Math.abs(lines[k].avgSize - c.size) < 0.6) { c.drop = true; break; }
    }
  }
  let list = cands.filter((c) => !c.drop);

  // "Chapter 3" / "පරිච්ඡේදය 3" followed by the chapter title on the next line(s)
  const merged = [];
  for (const c of list) {
    const p = merged[merged.length - 1];
    if (p && p.page === c.page && p.kind === 'keyword' && !keywordHeading(p.text).rest && !c.kind && p.y - c.y > 0 && p.y - c.y < Math.max(p.size, c.size) * 4.5) {
      p.title = `${p.text}: ${c.text}`; p.chapterTitle = c.text; p.size = Math.max(p.size, c.size); continue;
    }
    if (p && p.page === c.page && Math.abs(p.size - c.size) < 0.6 && !c.kind && (p.y - c.y) < c.size * 1.9 && (p.y - c.y) > 0 && p.text.length + c.text.length < 160 && !p.special) {
      p.text += ' ' + c.text; p.title += ' ' + c.title; continue;
    }
    merged.push({ ...c });
  }
  list = merged;

  // numbering must make sense in document order (1, 2, 3 … / 2.1, 2.2 …). A body-size "3 …" between
  // 2.2 and 2.3 is a list item, not chapter 3.
  const chapNum = (c) => (c.kind === 'numbered' ? Number(c.num.split('.')[0]) : c.kind === 'keyword' && /^\d+$/.test(c.num) ? Number(c.num) : null);
  list = list.filter((c, i) => {
    if (c.kind !== 'numbered' || c.num.includes('.') || c.ratio >= 1.25) return true;
    const n0 = Number(c.num);
    if (c.ratio < 1.1 && /\.$/.test(c.title)) return false;                  // "3. Apply the operator." — a list item
    let prev = null, next = null;
    for (let k = i - 1; k >= 0 && prev == null; k--) prev = chapNum(list[k]) != null ? list[k] : null;
    for (let k = i + 1; k < list.length && next == null; k++) next = chapNum(list[k]) != null ? list[k] : null;
    if (prev && chapNum(prev) > n0) return false;                              // goes backwards
    if (next && next.kind === 'numbered' && next.num.includes('.') && chapNum(next) !== n0) return false;
    if (prev && prev.num?.includes?.('.') && next?.num?.includes?.('.') && chapNum(prev) === chapNum(next)) return false;
    return true;
  });

  // title block on the first page (title, authors, affiliations, dates) is not part of the outline
  const firstReal = list.find((c) => c.kind === 'numbered' || c.kind === 'keyword' || c.special);
  if (firstReal) {
    for (let k = list.length - 1; k >= 0; k--) {
      const c = list[k];
      if (c.page === firstReal.page && c.page <= 1 && c.y > firstReal.y && c !== firstReal && !c.special && !c.kind) list.splice(k, 1);
    }
  }
  // at most a few large lines per page (posters): keep the biggest
  const byPage = new Map();
  for (const c of list) (byPage.get(c.page) || byPage.set(c.page, []).get(c.page)).push(c);
  let items = [];
  for (const [, pl] of byPage) {
    const strong = pl.filter((c) => c.kind || c.special);
    const big = pl.filter((c) => !c.kind && !c.special).sort((a, b) => b.size - a.size).slice(0, Math.max(0, 4 - strong.length));
    items.push(...strong, ...big);
  }
  items.sort((a, b) => a.page - b.page || b.y - a.y);
  // a title page (few lines, no numbered headings) is not a bookmark
  if (n > 3) {
    const p0 = all.filter((l) => l.page === 0);
    const p0c = items.filter((c) => c.page === 0);
    if (p0.length <= 14 && p0c.length && !p0c.some((c) => c.kind || c.special) && items.some((c) => c.page > 0 && (c.kind || c.special))) items = items.filter((c) => c.page !== 0);
  }
  // the document title: the largest line on page 1 when it is clearly the biggest text
  const maxSize = Math.max(...items.map((c) => c.size));
  items = items.filter((c, i) => !(c.page === 0 && c.size === maxSize && i < 3 && !c.kind && !c.special && items.filter((x) => x.size === maxSize).length === 1 && n > 2));
  // repeated identical headings (running titles that slipped through) → keep the first
  const seen = new Map();
  items = items.filter((c) => { const k = key(c.title); const s = seen.get(k) || 0; seen.set(k, s + 1); return s === 0 || c.kind; });

  // levels
  const lvlSizes = new Map();
  for (const c of items) {
    if (c.kind === 'numbered') c.level = Math.min(4, c.num.split('.').length);
    else if (c.kind === 'keyword') c.level = 1;
    else if (c.kind === 'roman') c.level = 1;
    else if (c.kind === 'letter') c.level = 2;
    else if (c.special) c.level = 1;
    if (c.level) { const a = lvlSizes.get(c.level) || []; a.push(c.size); lvlSizes.set(c.level, a); }
  }
  const median = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const lvlMedian = [...lvlSizes].map(([lv, s]) => [lv, median(s)]);
  const sizes = [...new Set(items.filter((c) => !c.level).map((c) => Math.round(c.size * 2) / 2))].sort((a, b) => b - a);
  const byMedian = lvlMedian.slice().sort((a, b) => a[0] - b[0]);
  for (const c of items) {
    if (c.level) continue;
    if (byMedian.length) {
      // the first level whose headings are not clearly smaller; smaller than all known levels → one deeper
      const hit = byMedian.find(([, s]) => s <= c.size + 0.6);
      c.level = hit ? hit[0] : Math.min(4, byMedian[byMedian.length - 1][0] + 1);
    } else c.level = Math.min(3, sizes.indexOf(Math.round(c.size * 2) / 2) + 1);
    if (!c.level || c.level < 1) c.level = 1;
  }
  // front/back matter sits at the top level when chapters are numbered
  for (const c of items) if (c.special && !c.kind) c.level = 1;
  const out = items.map((c) => ({
    page: c.page, y: c.y + c.size * 0.2, level: c.level, size: +(c.size / body).toFixed(2),
    title: titleCase(tidy(c.kind === 'numbered' ? `${c.num}${c.dot ? '.' : ''} ${c.title}` : c.kind === 'roman' || c.kind === 'letter' ? `${c.num}. ${c.title}` : c.title))
  }));
  fixLevels(out);
  return out;
}

// No level may jump more than one step below the previous one.
function fixLevels(list) {
  let prev = 0;
  for (const c of list) { if (c.level > prev + 1) c.level = prev + 1; prev = c.level; }
}

function tidy(t) {
  return t.replace(/\s*(\.\s?){3,}\s*\S*$/, '').replace(/\s*…+\s*\S*$/, '').replace(/([a-z])- ([a-z])/g, '$1$2')
    .replace(/^((?:\d{1,2}\.)*\d{1,2})(\.?)(?=[\u0D80-\u0DFF])/, '$1$2 ').replace(/\s+/g, ' ').replace(/[\s:.–-]+$/, '').trim();
}

// "RESULTS AND DISCUSSION" → "Results and Discussion" (acronyms such as PSO stay)
const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'via', 'with', 'from', 'into']);
function titleCase(t) {
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length < 4 || letters !== letters.toUpperCase()) return t;
  let first = true;
  return t.replace(/[A-Za-z][A-Za-z'’]*/g, (w) => {
    const lw = w.toLowerCase();
    let r;
    if (!first && SMALL.has(lw)) r = lw;
    else if (w.length <= 3 && !SMALL.has(lw) && !/^(ONE|TWO|NEW|OLD|USE|ALL|KEY|WHY|HOW|OUR|ITS|LAB|MAP|SET|TOP|END|LOW|NOT|ARE|CAN|WAY|DAY|AGE|CAR|OUT)$/.test(w)) r = w;   // acronym
    else r = lw[0].toUpperCase() + lw.slice(1);
    first = false;
    return r;
  });
}

// Ask the language model to keep the real headings, fix their text and choose levels.
export async function refineWithAI(engine, items, title, onStatus) {
  const out = [];
  const si = items.some((c) => hasSinhala(c.title));
  const batch = si && engine.provider !== 'server' ? 20 : 40;   // Sinhala titles cost more tokens
  const schema = {
    type: 'object',
    properties: { items: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, level: { type: 'integer' }, title: { type: 'string' } }, required: ['id', 'level', 'title'] } } },
    required: ['items']
  };
  const sys = `You build the bookmark (outline) tree of a PDF from heading candidates found by layout analysis.
Each candidate line is: id | page | relative font size | text.
Keep only real headings (chapters, sections, subsections, front/back matter such as Abstract, Contents or References). Drop body sentences, list items, captions, author names, dates, page headers and duplicates.
For each kept heading give: id, level (1 = chapter/top section, 2 = subsection, 3 = sub-subsection) and a clean title: fix broken words and wrong spaces, keep section numbers, remove trailing dots or page numbers, do not invent words.
Keep every title in its original language and script (Sinhala stays Sinhala, English stays English) — never translate.
Keep the original order. Reply with JSON only: {"items":[{"id":..,"level":..,"title":".."}]}`;
  for (let s = 0; s < items.length; s += batch) {
    const part = items.slice(s, s + batch);
    onStatus?.(`AI is reviewing headings ${s + 1}–${s + part.length} of ${items.length}…`);
    const listing = part.map((c) => `${c.id} | ${c.page + 1} | ${c.size} | ${c.title}`).join('\n');
    const prev = out.slice(-3).map((c) => `(level ${c.level}) ${c.title}`).join('; ');
    const txt = await engine.complete([
      { role: 'system', content: sys },
      { role: 'user', content: `Document: "${title}"${prev ? `\nPrevious headings: ${prev}` : ''}\n\nCandidates:\n${listing}\n\nJSON only.` }
    ], { schema, maxTokens: engine.outTokens ? engine.outTokens(Math.min(3000, 40 * part.length + 100), si ? 'si' : 'en', listing + sys) : Math.min(3000, 40 * part.length + 100), temperature: 0.1 });
    if (engine._stopped) break;
    const data = parseJSONLoose(txt);
    const list = Array.isArray(data) ? data : data?.items;
    if (!Array.isArray(list)) { out.push(...part); continue; } // keep heuristics for this batch
    const byId = new Map(part.map((c) => [c.id, c]));
    for (const r of list) {
      const c = byId.get(Number(r.id));
      if (!c) continue;
      const t = String(r.title || c.title).trim();
      out.push({ ...c, level: Math.min(4, Math.max(1, Number(r.level) || c.level)), title: t.length > 2 ? t : c.title });
      byId.delete(c.id);
    }
  }
  // no level may jump more than one step below its parent
  let prevLevel = 0;
  for (const c of out) { if (c.level > prevLevel + 1) c.level = prevLevel + 1; prevLevel = c.level; }
  return out;
}

// ----------------------------------------------------------------------- review dialog
export function bookmarkEditor({ items, onApply, onRegenerate = null, viewer, aiAvailable, usedAI, source = 'layout', title = 'Auto-Bookmark' }) {
  let list = items.map((c) => ({ ...c }));
  const back = el('div', { class: 'dialog-backdrop' });
  const box = el('div', { class: 'dialog bm-dialog', role: 'dialog' });
  const rows = el('div', { class: 'bm-rows' });
  const count = el('span', { class: 'muted small' });
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);

  const draw = () => {
    rows.replaceChildren();
    list.forEach((c, i) => {
      const input = el('input', { type: 'text', value: c.title, class: 'bm-title' });
      input.addEventListener('input', () => { c.title = input.value; });
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Tab') { e.preventDefault(); c.level = Math.max(1, Math.min(4, c.level + (e.shiftKey ? -1 : 1))); draw(); rows.querySelectorAll('.bm-title')[i]?.focus(); }
      });
      const b = (ic, tip, fn) => { const x = el('button', { class: 'tb small', title: tip }); x.append(icon(ic)); x.onclick = fn; return x; };
      const row = el('div', { class: 'bm-row' + (c.level === 1 ? ' l1' : ''), style: `padding-left:${(c.level - 1) * 22 + 6}px` }, [
        input,
        el('a', { href: '#', class: 'bm-page', text: 'p. ' + (c.page + 1), title: 'Show this page', onclick: (e) => { e.preventDefault(); viewer.goToResolved({ index: c.page, y: c.y }); } }),
        b('up', 'Move up', () => { if (i > 0) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; draw(); } }),
        b('down', 'Move down', () => { if (i < list.length - 1) { [list[i + 1], list[i]] = [list[i], list[i + 1]]; draw(); } }),
        b('outdent', 'Move left (Shift+Tab)', () => { c.level = Math.max(1, c.level - 1); draw(); }),
        b('indent', 'Move right (Tab)', () => { c.level = Math.min(4, c.level + 1); draw(); }),
        b('trash', 'Remove', () => { list.splice(i, 1); draw(); })
      ]);
      rows.append(row);
    });
    count.textContent = `${list.length} bookmark${list.length === 1 ? '' : 's'}${source === 'manual' ? '' : usedAI ? ' · refined by AI' : source === 'toc' ? ' · from the table of contents' : source === 'slides' ? ' · from slide titles' : ' · from page layout'}`;
    if (!list.length) rows.append(el('div', { class: 'empty', text: 'No headings found. Add bookmarks with the button below.' }));
  };

  const addBtn = el('button', { class: 'btn', text: '+ Add at current page', onclick: () => {
    const p = viewer.current;
    const at = list.findIndex((c) => c.page > p);
    const prev = list[(at < 0 ? list.length : at) - 1];
    const item = { id: Date.now(), page: p, y: null, level: prev?.level || 1, title: `Page ${p + 1}` };
    if (at < 0) list.push(item); else list.splice(at, 0, item);
    draw();
    rows.querySelectorAll('.bm-title')[at < 0 ? list.length - 1 : at]?.select();
  } });
  const regen = onRegenerate ? el('button', { class: 'btn', text: usedAI ? 'Redo without AI' : (aiAvailable ? 'Refine with AI' : 'Redo'), onclick: () => { close(); onRegenerate(!usedAI && aiAvailable); } }) : null;
  box.append(
    el('h2', { text: title }),
    el('p', { class: 'muted small', text: 'Fix titles, reorder with the up/down arrows, and use Tab / Shift+Tab (or the left/right arrows) to change levels. Apply shows them in the sidebar; Save writes them into the PDF.' }),
    rows,
    el('div', { class: 'bm-foot' }, [addBtn, regen, count]),
    el('div', { class: 'actions' }, [
      el('button', { class: 'btn', text: 'Cancel', onclick: close }),
      el('button', { class: 'btn primary', text: 'Apply bookmarks', onclick: () => { close(); onApply(list.filter((c) => c.title.trim())); } })
    ])
  );
  back.append(box);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  document.body.append(back);
  draw();
}

// Flat list [{title, page, y, level}] → nested tree for display
export function toTree(list) {
  list = list.map((c, i) => ({ ...c, _idx: i }));
  const root = { items: [] };
  const stack = [{ level: 0, node: root }];
  for (const c of list) {
    while (stack.length > 1 && stack[stack.length - 1].level >= c.level) stack.pop();
    const node = { title: c.title, goto: c.url ? null : { index: c.page, y: c.y }, url: c.url || null, idx: c._idx, bold: c.bold, italic: c.italic, items: [] };
    stack[stack.length - 1].node.items.push(node);
    stack.push({ level: c.level, node });
  }
  return root.items;
}

export { toast };
