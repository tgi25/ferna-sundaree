// AI features: summaries, document Q&A and study-question generation.
import { DocText, tokenize } from '../doctext.js';
import { parseJSONLoose } from './engine.js';
import { hasSinhala, sinhalaShare, splitSentences } from '../sinhala.js';
import { parseHtml } from '../util.js';

const pageTag = /\[p\.\s*(\d+)\]/g;

// Language instruction appended to every system prompt.
function langRule(lang, docLang) {
  if (lang === 'si') {
    return '\n\nLanguage: write the whole answer in Sinhala (සිංහල), in natural, correct Sinhala using Sinhala script. ' +
      'Keep names, numbers, formulas, code and the [p. N] page tags unchanged. For a technical term you may add the English term in brackets once. ' +
      'පිළිතුර සම්පූර්ණයෙන්ම සිංහලෙන් ලියන්න.';
  }
  if (docLang === 'si') return '\n\nLanguage: the material is in Sinhala; write your answer in English (you may quote Sinhala terms in brackets).';
  return '';
}

// ------------------------------------------------------------------ literature review (v1.6)
// The reviewer prompt (TGI's template). {FIELD_OF_STUDY} and {PDF_TEXT} are filled in at run time.
export const LIT_REVIEW_PROMPT = `You are an expert academic researcher and peer reviewer. Your task is to analyze the provided research paper text and produce a rigorous literature review summary suitable for direct insertion into an academic journal paper, conference submission, or thesis literature review within the domain of {FIELD_OF_STUDY}.

Processing Instructions:

Thoroughly analyze the provided paper text ({PDF_TEXT}), identifying the target problem, main contributions, theoretical or empirical modeling, benchmark datasets, and performance metrics relevant to {FIELD_OF_STUDY}.

Contextualize the paper within prior art and existing foundational approaches in {FIELD_OF_STUDY} that address similar core problems or methodologies.

Adopt a neutral, scholarly, and objective academic tone tailored to {FIELD_OF_STUDY}.

Output Structure Requirements:
Synthesize your analysis into a cohesive section of 350 to 450 words formatted into four structured subsections:

Context and Core Contribution:
Frame the core research problem within {FIELD_OF_STUDY}. Position the authors work relative to prior paradigms, comparing their proposed approach against traditional, static, or conventional baselines in the field.

Methodological Breakdown and Framework:
Detail the specific algorithms, experimental setups, domain-specific frameworks, and validation procedures utilized. Highlight what distinguishes this methodology from existing literature in {FIELD_OF_STUDY}.

Empirical Results and Benchmark Performance:
Report quantitative outcomes, metric improvements, validation performance, or comparative evaluations against established baselines in {FIELD_OF_STUDY}.

Related Work and Synthesis for Literature Review:
Formally cite and summarize related prior approaches in {FIELD_OF_STUDY}. Highlight key trade-offs, scope constraints, or limitations.

Tone and Style Rules:
Write in formal, third-person academic prose suitable for direct copy-pasting.
Do NOT use markdown bolding, italics, or conversational meta-talk.
Start directly with the academic text.
Standard academic citation placeholders must be used.`;

// Plain academic prose: drop markdown the model may still produce, keep the four subsection headings.
export function cleanReview(text) {
  return text
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1$2').replace(/(^|[^_\w])_([^_\n]+)_(?!_)/g, '$1$2')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
export const wordCount = (t) => (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-.]*/gu) || []).length;

export class AIFeatures {
  constructor({ engine, doctext, viewer, getTitle, settings = {} }) {
    this.engine = engine;
    this.doctext = doctext;
    this.viewer = viewer;
    this.getTitle = getTitle;
    this.settings = settings;
  }

  // Language of the document ('si' | 'en'), from the first pages
  async docLang() {
    const d = this.doctext;
    if (d._lang) return d._lang;
    let text = '';
    const n = Math.min(d.numPages, 6);
    for (let i = 0; i < n && text.length < 6000; i++) text += (await d.pageText(i)) + ' ';
    d._lang = sinhalaShare(text) > 0.3 ? 'si' : 'en';
    return d._lang;
  }

  // Answer language: the user's choice, else the question's language, else the document's.
  async answerLang(question = '') {
    const pref = this.settings.aiLanguage;
    if (pref === 'si' || pref === 'en') return pref;
    if (question) return hasSinhala(question) ? 'si' : 'en';
    return this.docLang();
  }

  // ------------------------------------------------------------------ summary
  async summarize({ from, to, length = 'brief', onStatus, onToken }) {
    const e = this.engine;
    onStatus?.('Reading the document…');
    const parts = await this.doctext.rangeText(from, to, (p) => onStatus?.(`Reading pages… ${Math.round(p * 100)}%`));
    const total = parts.reduce((a, p) => a + p.text.length, 0);
    if (!total) throw new Error('No text found on these pages (scanned pages need OCR first).');
    const sample = parts.map((p) => p.text).join(' ').slice(0, 20000);
    const docLang = sinhalaShare(sample) > 0.3 ? 'si' : 'en';
    const lang = await this.answerLang();
    const budget = e.charBudget(sample);     // Sinhala text uses many more tokens per character
    const noteLang = docLang === 'si' ? ' The material is in Sinhala: write the notes in English and keep key Sinhala terms and names in brackets.' : '';
    let material;
    if (total <= budget) {
      material = parts.filter((p) => p.text).map((p) => `[p. ${p.page + 1}] ${p.text}`).join('\n\n');
    } else {
      // very long documents: first keep only the most informative sentences (fast, no model), so that
      // the model reads at most ~12 parts
      let src = parts;
      const cap = budget * 12;
      if (total > cap) { onStatus?.('Long document — picking the key sentences…'); src = extractive(parts, cap); }
      // map: condense each part into notes; reduce: merge notes until they fit
      let chunks = DocText.chunk(src, Math.floor(budget * 0.85));
      let notes = [];
      for (let i = 0; i < chunks.length; i++) {
        onStatus?.(`Reading part ${i + 1} of ${chunks.length}…`);
        const out = await e.complete([
          { role: 'system', content: 'You condense one part of a longer document into notes. Write 3 to 6 short bullet points with the key ideas, definitions, methods, findings and numbers. Keep the page tags such as [p. 4] after the points they support. No introduction, no conclusion.' + noteLang },
          { role: 'user', content: chunks[i].text }
        ], { maxTokens: e.outTokens(260, 'en', chunks[i].text + '     '.repeat(60)), temperature: 0.2 });
        if (e._stopped) throw abortError();
        notes.push(out.trim());
      }
      let round = 1;
      while (notes.join('\n').length > budget && notes.length > 1) {
        const groups = DocText.chunk(notes.map((t, i) => ({ page: i, text: t })), Math.floor(budget * 0.85)).map((c) => c.text.replace(/^\[p\. \d+\] /gm, ''));
        const merged = [];
        for (let i = 0; i < groups.length; i++) {
          onStatus?.(`Combining notes (round ${round}, ${i + 1}/${groups.length})…`);
          merged.push((await e.complete([
            { role: 'system', content: 'Merge these notes into at most 8 bullet points, keeping the most important facts and their [p. N] page tags.' },
            { role: 'user', content: groups[i] }
          ], { maxTokens: 320, temperature: 0.2 })).trim());
          if (e._stopped) throw abortError();
        }
        notes = merged;
        round++;
      }
      material = notes.join('\n');
    }
    onStatus?.('Writing the summary…');
    const title = this.getTitle();
    const inShort = lang === 'si' ? 'කෙටියෙන්:' : 'In short:';
    const sys = (length === 'detailed'
      ? 'You write clear, structured summaries of documents for a university reader. Use short section headings (## Heading), bullet points for key points, and cover: purpose, main ideas or methods, key results or arguments, and conclusions. Cite pages as [p. N] after the points they come from. Only use information from the material. No preamble.'
      : `You write concise summaries of documents. Give 5 to 7 bullet points with the most important ideas, then one final line starting with "${inShort}". Cite pages as [p. N] where helpful. Only use information from the material. No preamble.`) + langRule(lang, docLang);
    const scope = from === to ? `page ${from + 1}` : `pages ${from + 1}–${to + 1}`;
    const user = `Document: "${title}" (${scope})\n\nMaterial:\n${material}\n\nWrite the summary now${lang === 'si' ? ' in Sinhala (සිංහලෙන්)' : ''}.`;
    return e.complete([
      { role: 'system', content: sys },
      { role: 'user', content: user }
    ], { onToken, maxTokens: e.outTokens(length === 'detailed' ? 900 : 450, lang, sys + user), temperature: 0.3 });
  }

  // ------------------------------------------------------------------ literature review
  async litReview({ field = '', from, to, onStatus, onToken }) {
    const e = this.engine;
    onStatus?.('Reading the paper…');
    const parts = await this.doctext.rangeText(from, to, (p) => onStatus?.(`Reading pages… ${Math.round(p * 100)}%`));
    const total = parts.reduce((a, p) => a + p.text.length, 0);
    if (!total) throw new Error('No text found on these pages (scanned pages need OCR first: ⋮ → Recognise text).');
    const fieldText = field.trim() || 'the research field of the paper (identify it from the paper)';
    const budget = Math.floor(e.charBudget(parts.map((p) => p.text).join(' ').slice(0, 20000)) * 0.8);
    let paper;
    if (total <= budget) {
      paper = parts.filter((p) => p.text).map((p) => p.text).join('\n\n');
    } else {
      // small context (on-device / small local model): condense the paper into dense research notes first
      let src = parts;
      const cap = budget * 10;
      if (total > cap) { onStatus?.('Long paper — picking the key sentences…'); src = extractive(parts, cap); }
      const chunks = DocText.chunk(src, Math.floor(budget * 0.85));
      const notes = [];
      for (let i = 0; i < chunks.length; i++) {
        onStatus?.(`Reading part ${i + 1} of ${chunks.length}…`);
        notes.push((await e.complete([
          { role: 'system', content: 'You take research notes on one part of a scientific paper for a literature review. List, as short bullet points, everything this part states about: the research problem; contributions; methods, algorithms and models; datasets and experimental setup; evaluation metrics; quantitative results with exact numbers; baselines compared; prior work cited (author names, years, method names); limitations. Copy numbers and names exactly. Skip what is not present.' },
          { role: 'user', content: chunks[i].text.replace(/^\[p\. \d+\] /gm, '') }
        ], { maxTokens: 380, temperature: 0.1 })).trim());
        if (e._stopped) throw abortError();
      }
      paper = notes.join('\n');
    }
    onStatus?.('Writing the literature review…');
    const sys = LIT_REVIEW_PROMPT.replaceAll('{FIELD_OF_STUDY}', fieldText).replace('({PDF_TEXT})', '(given below)');
    const user = `Title of the paper: ${this.getTitle()}\nField of study: ${fieldText}\n\nPaper text${total > budget ? ' (condensed research notes)' : ''}:\n"""\n${paper}\n"""\n\nWrite the literature review section now (350 to 450 words, four subsections with the headings given, citation placeholders such as [Author et al., Year] for prior work, no markdown).`;
    return e.complete([
      { role: 'system', content: sys },
      { role: 'user', content: user }
    ], { onToken, maxTokens: e.outTokens(1100, 'en', sys + user), temperature: 0.3 });
  }

  // ------------------------------------------------------------------ Q&A
  async ask({ question, history = [], currentPage = 0, selection = '', onStatus, onToken }) {
    const e = this.engine;
    onStatus?.('Searching the document…');
    const index = await this.doctext.retrievalIndex((p) => onStatus?.(`Indexing the document… ${Math.round(p * 100)}%`));
    const docLang = await this.docLang();
    const lang = await this.answerLang(question);
    const near = new Set([currentPage - 1, currentPage, currentPage + 1]);
    const aboutPage = /\b(this|current)\s+(page|slide|section|figure|table)\b/i.test(question) ||
      /(මෙම|මේ|මෙහි)\s*(පිටු|කොටස|රූප|වගුව|ස්ලයිඩ)/.test(question);
    // question and document in different languages: let the model turn the question into search words
    let query = question + ' ' + selection;
    if ((docLang === 'si') !== hasSinhala(question) && !selection) {
      onStatus?.('Translating the question for the search…');
      try {
        const target = docLang === 'si' ? 'Sinhala (සිංහල)' : 'English';
        const kw = await e.complete([
          { role: 'system', content: `Translate the question into ${target} search keywords: 4 to 10 important words (nouns, technical terms, names). Reply with the keywords only, on one line, nothing else.` },
          { role: 'user', content: question }
        ], { maxTokens: e.outTokens(40, docLang), temperature: 0 });
        query += ' ' + kw.replace(/[\r\n,;]+/g, ' ');
      } catch (err) { if (e._stopped) throw abortError(); }
    }
    let hits = index.search(query, 6, near);
    const sample = hits.map((h) => h.text).join(' ').slice(0, 4000) || (await this.doctext.pageText(currentPage)).slice(0, 4000);
    const budget = Math.max(600, e.charBudget(sample + question) - 800);
    const blocks = [];
    let used = 0;
    const addBlock = (txt) => { if (used + txt.length > budget) return false; blocks.push(txt); used += txt.length; return true; };
    if (selection) addBlock(`Selected passage (p. ${currentPage + 1}): "${selection.slice(0, Math.min(1500, budget * 0.4))}"`);
    if (aboutPage || selection || !hits.length) {
      const t = await this.doctext.pageText(currentPage);
      addBlock(`[p. ${currentPage + 1}] ${t.slice(0, Math.floor(budget * 0.5))}`);
    }
    for (const h of hits) if (!addBlock(h.text)) break;
    const notFound = lang === 'si' ? '"ලේඛනයේ මෙයට පිළිතුරක් හමු නොවීය"' : 'that you could not find it in the document';
    const sys = `You answer questions about a PDF document using only the excerpts provided. After each fact, cite its page as [p. N] using the tags in the excerpts. If the excerpts do not contain the answer, say ${notFound} and suggest what to look for. Answer concisely and accurately.` + langRule(lang, docLang);
    const msgs = [{ role: 'system', content: sys }];
    for (const h of history.slice(-4)) msgs.push({ role: h.role, content: h.content.slice(0, 800) });
    const user = `Excerpts from "${this.getTitle()}":\n\n${blocks.join('\n\n---\n\n')}\n\nQuestion: ${question}`;
    msgs.push({ role: 'user', content: user });
    onStatus?.('Thinking…');
    return e.complete(msgs, { onToken, maxTokens: e.outTokens(600, lang, msgs.map((m) => m.content).join('\n')), temperature: 0.2 });
  }

  // ------------------------------------------------------------------ study questions
  async quiz({ from, to, count = 10, type = 'mixed', difficulty = 'mixed', onStatus, onItems }) {
    const e = this.engine;
    onStatus?.('Reading the pages…');
    const parts = await this.doctext.rangeText(from, to);
    const sample = parts.map((p) => p.text).join(' ').slice(0, 20000);
    const docLang = sinhalaShare(sample) > 0.3 ? 'si' : 'en';
    const lang = await this.answerLang();
    const budget = e.charBudget(sample);
    let chunks = DocText.chunk(parts, Math.floor(budget * 0.6)).filter((c) => c.text.length > Math.min(300, budget * 0.15));
    if (!chunks.length) throw new Error('Not enough text on these pages to write questions.');
    const perCall = lang === 'si' ? 2 : 4;       // Sinhala output is long in tokens: fewer questions per request
    const calls = Math.min(chunks.length, Math.max(1, Math.ceil(count / perCall)));
    const picked = [];
    for (let k = 0; k < calls; k++) picked.push(chunks[Math.floor((k + 0.5) * chunks.length / calls)]);
    const per = picked.map((_, k) => Math.floor(count / calls) + (k < count % calls ? 1 : 0));
    const typeText = { mcq: 'multiple-choice questions (MCQ) with exactly 4 options', short: 'short-answer questions', mixed: 'a mix of multiple-choice questions (exactly 4 options) and short-answer questions' }[type];
    const diffText = difficulty === 'mixed' ? 'a balanced mix of easy, moderate and hard questions' : `${difficulty} questions`;
    const schema = {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['mcq', 'short'] },
              difficulty: { type: 'string', enum: ['easy', 'moderate', 'hard'] },
              question: { type: 'string' },
              options: { type: 'array', items: { type: 'string' } },
              answer: { type: 'string' },
              explanation: { type: 'string' },
              page: { type: 'integer' }
            },
            required: ['type', 'difficulty', 'question', 'answer', 'explanation', 'page']
          }
        }
      },
      required: ['questions']
    };
    const sys = `You are an experienced university examiner writing study and review questions from course material.
Rules:
- Every question must be answerable from the material, and each must test a different fact or idea (no overlap).
- Prefer understanding and application ("what happens if…", "which approach…", worked examples) over pure definition recall.
- MCQ: exactly 4 options, one correct; the 3 wrong options must be plausible and reflect common student misconceptions; no "all/none of the above"; the answer field repeats the correct option text exactly.
- Short answer: the answer is one or two sentences.
- Do not mention "the text", "the passage" or slide/page numbers inside the question.
- explanation: one sentence on why the answer is correct.
- page: the page number from the [p. N] tag where the answer is found.
- difficulty: easy, moderate or hard.
Reply with JSON only: {"questions":[...]}.` + (lang === 'si'
      ? '\n- Language: write question, options, answer and explanation in Sinhala (සිංහල). The JSON keys and the values of "type" and "difficulty" stay in English.'
      : docLang === 'si' ? '\n- Language: the material is in Sinhala; write the questions and answers in English.' : '');
    const all = [];
    const seen = new Set();
    for (let k = 0; k < picked.length; k++) {
      if (!per[k]) continue;
      onStatus?.(`Writing questions ${all.length + 1}–${Math.min(count, all.length + per[k])} of ${count}…`);
      const out = await e.complete([
        { role: 'system', content: sys },
        { role: 'user', content: `Material:\n${picked[k].text}\n\nWrite ${per[k]} ${typeText}, ${diffText}${lang === 'si' ? ', in Sinhala' : ''}. JSON only.` }
      ], { schema, maxTokens: e.outTokens(260 * per[k] + 200, lang, sys + picked[k].text), temperature: 0.5 });
      if (e._stopped) break;
      const data = parseJSONLoose(out);
      const list = Array.isArray(data) ? data : data?.questions || [];
      const fresh = [];
      for (const q of list) {
        const item = normalizeQuestion(q, picked[k].pages, type);
        if (!item) continue;
        const key = item.question.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
        if (seen.has(key)) continue;
        seen.add(key);
        fresh.push(item);
      }
      all.push(...fresh);
      onItems?.(all.slice());
    }
    return all.slice(0, count);
  }
}

function normalizeQuestion(q, pages, wanted) {
  if (!q || typeof q.question !== 'string' || !q.question.trim()) return null;
  let type = q.type === 'mcq' || (Array.isArray(q.options) && q.options.length >= 3) ? 'mcq' : 'short';
  if (wanted === 'mcq' && type !== 'mcq') return null;
  let options = Array.isArray(q.options) ? q.options.map((o) => String(o).replace(/^\s*[A-Da-d][).:]\s+/, '').trim()).filter(Boolean) : [];
  let answer = String(q.answer ?? '').trim();
  if (type === 'mcq') {
    if (options.length < 3) return null;
    options = options.slice(0, 4);
    const letter = /^\(?([A-Da-d])\)?(?:[).:]\s*|\s*$)/.exec(answer);
    if (letter && (answer.length <= 3 || !options.some((o) => o.toLowerCase() === answer.toLowerCase()))) {
      const i = 'abcd'.indexOf(letter[1].toLowerCase());
      if (options[i] && (answer.length <= 3 || options[i].toLowerCase().startsWith(answer.slice(letter[0].length).toLowerCase().slice(0, 12)))) answer = options[i];
    }
    const clean = (s) => s.toLowerCase().replace(/^\s*[a-d][).:]\s+/, '').replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').normalize('NFC').replace(/[\u200C\u200D]/g, '').trim();
    const idx = options.findIndex((o) => clean(o) === clean(answer));
    if (idx < 0) {
      const partial = options.findIndex((o) => clean(o).includes(clean(answer)) || clean(answer).includes(clean(o)));
      if (partial < 0) return null;
      answer = options[partial];
    } else answer = options[idx];
  }
  let page = Number(q.page);
  if (!(page >= 1) || (pages.length && !pages.includes(page - 1))) page = (pages[0] ?? 0) + 1;
  const difficulty = ['easy', 'moderate', 'hard'].includes(q.difficulty) ? q.difficulty : 'moderate';
  return { type, difficulty, question: q.question.trim(), options, answer, explanation: String(q.explanation || '').trim(), page };
}

// Keep the highest-scoring sentences (TF-IDF over the document) up to maxChars, in reading order.
function extractive(parts, maxChars) {
  const sents = [];
  for (const { page, text } of parts) {
    for (const s of splitSentences(text.replace(/\n+/g, ' '))) {
      let t = s.trim();
      // text without sentence punctuation (slides, tables): cut into ~300-character pieces
      while (t.length > 600) {
        const cut = t.lastIndexOf(' ', 300) > 150 ? t.lastIndexOf(' ', 300) : 300;
        sents.push({ page, t: t.slice(0, cut), words: tokenize(t.slice(0, cut)) });
        t = t.slice(cut).trim();
      }
      if (t.length > 30) sents.push({ page, t, words: tokenize(t) });
    }
  }
  const df = new Map();
  for (const s of sents) for (const w of new Set(s.words)) df.set(w, (df.get(w) || 0) + 1);
  const N = sents.length || 1;
  for (const s of sents) {
    const tf = new Map();
    for (const w of s.words) tf.set(w, (tf.get(w) || 0) + 1);
    let sc = 0;
    for (const [w, c] of tf) { const d = df.get(w); if (d > 1) sc += c * Math.log(N / d); } // ignore words used only once
    s.score = sc / Math.sqrt(s.words.length + 4);
  }
  const keep = new Set();
  let used = 0;
  for (const s of sents.slice().sort((a, b) => b.score - a.score)) {
    if (used + s.t.length > maxChars) continue;
    keep.add(s); used += s.t.length + 1;
  }
  const out = new Map();
  for (const s of sents) if (keep.has(s)) out.set(s.page, (out.get(s.page) || '') + s.t + ' ');
  return [...out].map(([page, text]) => ({ page, text: text.trim() }));
}

function abortError() { const e = new Error('Stopped'); e.name = 'AbortError'; return e; }

// Very small Markdown renderer for model output (headings, lists, bold/italic, page citations).
export function renderMarkdown(md, onPage) {
  const escHtml = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const inline = (s) => escHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<i>$2</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(pageTag, (m, n) => `<a href="#" class="cite" data-page="${n}">p. ${n}</a>`)
    .replace(/\[(?:pp?\.|pages?)\s*(\d+)\s*[–-]\s*(\d+)\]/g, (m, a, b) => `<a href="#" class="cite" data-page="${a}">pp. ${a}–${b}</a>`);
  const lines = md.replace(/\r/g, '').split('\n');
  let html = '', list = null;
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if ((m = /^\s*#{1,6}\s+(.*)$/.exec(line))) { close(); html += `<h4>${inline(m[1])}</h4>`; }
    else if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) { if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; }
    else if (!line.trim()) { close(); }
    else { close(); html += `<p>${inline(line)}</p>`; }
  }
  close();
  const div = document.createElement('div');
  div.className = 'md';
  div.append(...parseHtml(html));   // html holds only escaped model text and our own tags
  div.addEventListener('click', (e) => {
    const a = e.target.closest('a.cite');
    if (a) { e.preventDefault(); onPage?.(Number(a.dataset.page)); }
  });
  return div;
}
