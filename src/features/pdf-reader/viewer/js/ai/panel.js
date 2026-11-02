// AI side panel: Summary, Ask (document Q&A), Quiz (study questions) and Review (literature review section).
import { IS_FIREFOX, EXT_SCHEME } from '../platform.js';
import { el, icon, toast } from '../util.js';
import { AIEngine, MODELS, CLOUD, isCloud } from './engine.js';
import { renderMarkdown, cleanReview, wordCount } from './features.js';
import { showDialog } from '../ui.js';

const opt = (value, text, sel) => { const o = el('option', { value, text }); if (sel) o.selected = true; return o; };

export class AIPanel {
  constructor({ engine, features, viewer, settings, saveSettings, download, getTitle }) {
    this.engine = engine;
    this.f = features;
    this.viewer = viewer;
    this.settings = settings;
    this.saveSettings = saveSettings;
    this.download = download;
    this.getTitle = getTitle;
    this.tab = 'summary';
    this.chat = [];
    this.busy = false;
    this.root = document.getElementById('aiPanel');
    this._build();
    engine.on('status', () => this._status());
  }

  get isOpen() { return !this.root.hidden; }
  toggle(force) {
    const open = force ?? !this.isOpen;
    this.root.hidden = !open;
    document.getElementById('btnAI')?.classList.toggle('on', open);
    this.viewer.layout();
    if (open) { this._status(); this._renderChips(); this._langHint(); }
  }

  // ------------------------------------------------------------------ layout
  _build() {
    const r = this.root;
    r.replaceChildren();
    this.statusText = el('div', { class: 'ai-status muted small' });
    const gear = el('button', { class: 'tb small', title: 'AI settings' }); gear.append(icon('gear')); gear.onclick = () => this.openSettings();
    const x = el('button', { class: 'tb small', title: 'Close' }); x.append(icon('close')); x.onclick = () => this.toggle(false);
    // answer language: automatic (question / document language), English or Sinhala
    this.langSel = el('select', { class: 'ai-lang', title: 'Answer language' }, [
      opt('auto', 'Auto', (this.settings.aiLanguage || 'auto') === 'auto'), opt('en', 'English', this.settings.aiLanguage === 'en'), opt('si', 'සිංහල', this.settings.aiLanguage === 'si')
    ]);
    this.langSel.onchange = () => {
      this.settings.aiLanguage = this.langSel.value;
      this.saveSettings(this.settings, ['aiLanguage']);
      this._renderChips();
      this._langHint();
    };
    const head = el('div', { class: 'ai-head' }, [
      el('div', { class: 'ai-titlebox' }, [el('div', { class: 'ai-title' }, [icon('sparkle'), el('span', { text: 'AI assistant' })]), this.statusText]),
      this.langSel, gear, x
    ]);
    this.langNote = el('div', { class: 'ai-langnote small', hidden: true });
    this.progress = el('div', { class: 'ai-progress', hidden: true }, [el('div', { class: 'ai-progress-bar' })]);
    const tabs = el('div', { class: 'sb-tabs' });
    for (const [k, label] of [['summary', 'Summary'], ['ask', 'Ask'], ['quiz', 'Quiz'], ['review', 'Review']]) {
      const b = el('button', { class: 'sb-tab' + (k === this.tab ? ' active' : ''), 'data-tab': k, text: label });
      b.onclick = () => this.show(k);
      tabs.append(b);
    }
    this.panes = { summary: this._summaryPane(), ask: this._askPane(), quiz: this._quizPane(), review: this._reviewPane() };
    const body = el('div', { class: 'ai-body' }, Object.values(this.panes));
    r.append(head, this.progress, this.langNote, tabs, body);
    this.show(this.tab);
  }

  show(tab) {
    this.tab = tab;
    for (const b of this.root.querySelectorAll('.sb-tab')) b.classList.toggle('active', b.dataset.tab === tab);
    for (const [k, p] of Object.entries(this.panes)) p.hidden = k !== tab;
    if (tab === 'ask') setTimeout(() => this.askInput?.focus(), 30);
  }

  _status() {
    const e = this.engine;
    const s = e.state;
    const txt = s === 'ready' ? `● ${e.label()}` : s === 'loading' ? e.detail : s === 'error' ? `⚠ ${e.detail}` : `${e.label()} · starts when you use it`;
    this.statusText.textContent = txt;
    this.statusText.classList.toggle('err', s === 'error');
    this.statusText.title = txt;
    this._syncProvSel?.();
    this.progress.hidden = s !== 'loading';
    this.progress.firstChild.style.width = Math.round((e.progress || 0) * 100) + '%';
  }

  _scopeRow(prefix) {
    const sel = el('select', {}, [opt('all', 'Whole document', true), opt('page', 'Current page'), opt('range', 'Pages…')]);
    const from = el('input', { type: 'number', min: 1, value: 1, class: 'ai-num', title: 'From page' });
    const to = el('input', { type: 'number', min: 1, value: 1, class: 'ai-num', title: 'To page' });
    const rng = el('span', { class: 'ai-range', hidden: true }, [from, el('span', { text: '–' }), to]);
    sel.onchange = () => {
      rng.hidden = sel.value !== 'range';
      if (sel.value === 'range') { from.value = this.viewer.current + 1; to.value = Math.min(this.viewer.pages.length, this.viewer.current + 5); }
    };
    for (const i of [from, to]) i.addEventListener('keydown', (e) => e.stopPropagation());
    const get = () => {
      const n = this.viewer.pages.length;
      if (sel.value === 'page') return [this.viewer.current, this.viewer.current];
      if (sel.value === 'range') {
        const a = Math.max(1, Math.min(n, Number(from.value) || 1)), b = Math.max(a, Math.min(n, Number(to.value) || a));
        return [a - 1, b - 1];
      }
      return [0, n - 1];
    };
    return { row: el('label', { class: 'ai-row' }, [el('span', { class: 'ai-lbl', text: 'Pages' }), sel, rng]), get, sel, prefix };
  }

  // ------------------------------------------------------------------ Summary
  _summaryPane() {
    const scope = this._scopeRow('s');
    const len = el('select', {}, [opt('brief', 'Brief (key points)', true), opt('detailed', 'Detailed (sections)')]);
    const out = el('div', { class: 'ai-out' });
    const go = el('button', { class: 'btn primary', text: 'Summarize' });
    const tools = el('div', { class: 'ai-outtools', hidden: true });
    let lastText = '';
    const copy = el('button', { class: 'btn', text: 'Copy', onclick: () => { navigator.clipboard?.writeText(lastText); toast('Summary copied'); } });
    const save = el('button', { class: 'btn', text: 'Save .md', onclick: () => this.download(new TextEncoder().encode(`# Summary — ${this.getTitle()}\n\n${lastText}\n`), this._fileBase() + ' - summary.md', 'text/markdown') });
    tools.append(copy, save);
    go.onclick = async () => {
      if (this.busy) { this.engine.stop(); return; }
      const [from, to] = scope.get();
      if (!(await this._ensure())) return;
      this._busy(go, true, 'Summarize');
      out.replaceChildren(el('div', { class: 'ai-wait muted' }));
      tools.hidden = true;
      let md = null;
      try {
        const text = await this.f.summarize({
          from, to, length: len.value,
          onStatus: (t) => { const w = out.querySelector('.ai-wait'); if (w) w.textContent = t; },
          onToken: (d, full) => { md = full; out.replaceChildren(renderMarkdown(full, (p) => this.viewer.goToPage(p))); out.scrollTop = out.scrollHeight; }
        });
        lastText = text.trim();
        out.replaceChildren(renderMarkdown(lastText || '(no output)', (p) => this.viewer.goToPage(p)));
        tools.hidden = !lastText;
      } catch (e) {
        if (e.name === 'AbortError' || this.engine._stopped) { if (md) { lastText = md; tools.hidden = false; } else out.replaceChildren(el('p', { class: 'muted', text: 'Stopped.' })); }
        else out.replaceChildren(el('p', { class: 'err', text: e.message }));
      } finally { this._busy(go, false, 'Summarize'); }
    };
    return el('div', { class: 'ai-pane' }, [
      scope.row,
      el('label', { class: 'ai-row' }, [el('span', { class: 'ai-lbl', text: 'Length' }), len]),
      el('div', { class: 'ai-row' }, [go]),
      out, tools
    ]);
  }

  // ------------------------------------------------------------------ Ask
  _askPane() {
    this.log = el('div', { class: 'ai-chat' });
    this.askInput = el('textarea', { rows: 2, placeholder: 'Ask a question about this PDF…' });
    const send = el('button', { class: 'btn primary', title: 'Send (Enter)' }); send.append(icon('send'));
    this.sendBtn = send;
    this.askInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send.click(); }
    });
    send.onclick = () => {
      if (this.busy) { this.engine.stop(); return; }
      const q = this.askInput.value.trim();
      if (!q) return;
      this.askInput.value = '';
      this.ask(q);
    };
    this.chips = el('div', { class: 'ai-chips' });
    this._renderChips();
    this.log.append(this._askHint());
    return el('div', { class: 'ai-pane ai-askpane' }, [this.log, this.chips, el('div', { class: 'ai-input' }, [this.askInput, send])]);
  }

  // Suggested questions in the answer language
  async _renderChips() {
    if (!this.chips) return;
    const si = await this._siMode();
    const list = si
      ? [['පිටුවේ සාරාංශය', 'මෙම පිටුව කරුණු කිහිපයකින් සාරාංශ කරන්න.'],
        ['ප්‍රධාන පද', 'මෙම පිටුවේ ඇති ප්‍රධාන පද සහ සංකල්ප, එක් එක් පදයට කෙටි පැහැදිලි කිරීමක් සමඟ ලැයිස්තුගත කරන්න.'],
        ['ප්‍රධාන නිගමනය', 'මෙම ලේඛනයේ ප්‍රධාන දායකත්වය හෝ නිගමනය කුමක්ද?']]
      : [['Summarise this page', 'Summarise this page in a few bullet points.'], ['Key terms', 'List the key terms and concepts on this page with a one-line explanation each.'], ['Main contribution', 'What is the main contribution or conclusion of this document?']];
    this.chips.replaceChildren(...list.map(([label, q]) => el('button', { class: 'chip', text: label, onclick: () => this.ask(q) })),
      el('button', { class: 'chip', text: si ? 'සංවාදය මකන්න' : 'Clear chat', onclick: () => { this.chat = []; this.log.replaceChildren(this._askHint()); } }));
    this.askInput.placeholder = si ? 'මෙම PDF ගැන ප්‍රශ්නයක් අසන්න… (English questions work too)' : 'Ask a question about this PDF… (සිංහලෙන්ද ඇසිය හැක)';
  }

  // true when answers will be in Sinhala (chosen, or automatic with a Sinhala document)
  async _siMode() {
    const pref = this.settings.aiLanguage || 'auto';
    if (pref !== 'auto') return pref === 'si';
    if (!this.viewer.pages.length) return false;
    try { return (await this.f.docLang()) === 'si'; } catch { return false; }
  }

  // Warn when the chosen model writes Sinhala poorly
  async _langHint() {
    const e = this.engine;
    const si = await this._siMode();
    let msg = '';
    if (si && e.provider === 'webllm' && (e.modelInfo.si ?? 0) < 2) msg = `${e.modelInfo.label.replace(/\s*\(.*\)$/, '')} writes little Sinhala. For Sinhala answers choose “Qwen 3 · 4B” or “Qwen 3 · 1.7B” in AI settings ⚙, or a local server with a larger model.`;
    if (si && e.provider === 'chrome') msg = 'Chrome’s built-in AI does not support Sinhala yet. Choose an on-device model (Qwen 3) or a local server in AI settings ⚙.';
    this.langNote.textContent = msg;
    this.langNote.hidden = !msg;
  }

  _askHint() {
    return el('div', { class: 'ai-hint muted small', text: 'Answers come only from this document and cite their pages — click a page number to jump there. Select text and choose "Ask AI" to ask about a passage.' });
  }

  async ask(question, { selection = '' } = {}) {
    if (this.busy) return;
    this.toggle(true);
    this.show('ask');
    if (!(await this._ensure())) return;
    this.log.querySelector('.ai-hint')?.remove();
    this.log.append(el('div', { class: 'msg user', text: selection ? `${question}\n\n“${selection.slice(0, 300)}${selection.length > 300 ? '…' : ''}”` : question }));
    const bubble = el('div', { class: 'msg bot' }, [el('span', { class: 'muted', text: '…' })]);
    this.log.append(bubble);
    this.log.scrollTop = this.log.scrollHeight;
    this._busy(this.sendBtn, true);
    let full = '';
    try {
      const answer = await this.f.ask({
        question, selection, history: this.chat, currentPage: this.viewer.current,
        onStatus: (t) => { if (!full) bubble.firstChild.textContent = t; },
        onToken: (d, f) => { full = f; bubble.replaceChildren(renderMarkdown(f, (p) => this.viewer.goToPage(p))); this.log.scrollTop = this.log.scrollHeight; }
      });
      full = answer.trim() || full;
      bubble.replaceChildren(renderMarkdown(full || '(no answer)', (p) => this.viewer.goToPage(p)));
      this.chat.push({ role: 'user', content: selection ? `${question} (about: ${selection.slice(0, 200)})` : question }, { role: 'assistant', content: full });
    } catch (e) {
      bubble.replaceChildren(el('span', { class: e.name === 'AbortError' ? 'muted' : 'err', text: e.name === 'AbortError' ? (full ? '' : 'Stopped.') : e.message }));
      if (full) bubble.prepend(renderMarkdown(full, (p) => this.viewer.goToPage(p)));
    } finally { this._busy(this.sendBtn, false); }
  }

  async askAboutSelection(text) {
    const si = this.settings.aiLanguage === 'si' || (this.settings.aiLanguage !== 'en' && /[\u0D80-\u0DFF]/.test(text));
    this.ask(si ? 'මෙම කොටස සරලව පැහැදිලි කර, ලේඛනයේ අනෙක් කොටස් සමඟ සම්බන්ධ කරන්න.' : 'Explain this passage in simple terms and relate it to the rest of the document.', { selection: text });
  }

  // ------------------------------------------------------------------ Quiz
  _quizPane() {
    const scope = this._scopeRow('q');
    const count = el('select', {}, [5, 10, 15, 20].map((n) => opt(n, `${n} questions`, n === 10)));
    const type = el('select', {}, [opt('mixed', 'Mixed', true), opt('mcq', 'Multiple choice (MCQ)'), opt('short', 'Short answer')]);
    const diff = el('select', {}, [opt('mixed', 'Mixed (easy / moderate / hard)', true), opt('easy', 'Easy'), opt('moderate', 'Moderate'), opt('hard', 'Hard')]);
    const go = el('button', { class: 'btn primary', text: 'Generate questions' });
    const out = el('div', { class: 'ai-quiz' });
    const tools = el('div', { class: 'ai-outtools', hidden: true });
    let items = [];
    const toText = (withAnswers = true) => items.map((q, i) => {
      let s = `${i + 1}. ${q.question}  [${q.type === 'mcq' ? 'MCQ' : 'Short answer'} · ${q.difficulty} · p. ${q.page}]\n`;
      if (q.type === 'mcq') s += q.options.map((o, k) => `   ${'ABCD'[k]}. ${o}`).join('\n') + '\n';
      if (withAnswers) s += `   Answer: ${q.type === 'mcq' ? 'ABCD'[q.options.indexOf(q.answer)] + '. ' : ''}${q.answer}\n` + (q.explanation ? `   Why: ${q.explanation}\n` : '');
      return s;
    }).join('\n');
    const showAll = el('button', { class: 'btn', text: 'Show all answers', onclick: () => { const open = showAll.textContent.startsWith('Show'); out.querySelectorAll('.qa-ans').forEach((a) => { a.hidden = !open; }); showAll.textContent = open ? 'Hide answers' : 'Show all answers'; } });
    tools.append(
      showAll,
      el('button', { class: 'btn', text: 'Copy', onclick: () => { navigator.clipboard?.writeText(toText()); toast('Questions copied'); } }),
      el('button', { class: 'btn', text: 'Save .md', onclick: () => this.download(new TextEncoder().encode(`# Review questions — ${this.getTitle()}\n\n${toText()}`), this._fileBase() + ' - questions.md', 'text/markdown') })
    );
    const draw = () => {
      out.replaceChildren();
      items.forEach((q, i) => {
        const ans = el('div', { class: 'qa-ans', hidden: true }, [
          el('div', {}, [el('b', { text: 'Answer: ' }), el('span', { text: (q.type === 'mcq' ? 'ABCD'[q.options.indexOf(q.answer)] + '. ' : '') + q.answer })]),
          q.explanation ? el('div', { class: 'muted small', text: q.explanation }) : null
        ]);
        const card = el('div', { class: 'qa-card' }, [
          el('div', { class: 'qa-meta' }, [
            el('span', { class: 'qa-n', text: `Q${i + 1}` }),
            el('span', { class: 'qa-tag ' + q.difficulty, text: q.difficulty }),
            el('span', { class: 'qa-tag', text: q.type === 'mcq' ? 'MCQ' : 'Short answer' }),
            el('a', { href: '#', class: 'cite', text: `p. ${q.page}`, onclick: (e) => { e.preventDefault(); this.viewer.goToPage(q.page); } })
          ]),
          el('div', { class: 'qa-q', text: q.question }),
          q.type === 'mcq' ? el('ol', { class: 'qa-opts', type: 'A' }, q.options.map((o) => el('li', { text: o, class: o === q.answer ? 'ok' : '' }))) : null,
          el('button', { class: 'chip', text: 'Show answer', onclick: (e) => { ans.hidden = !ans.hidden; e.target.textContent = ans.hidden ? 'Show answer' : 'Hide answer'; card.classList.toggle('revealed', !ans.hidden); } }),
          ans
        ]);
        out.append(card);
      });
    };
    go.onclick = async () => {
      if (this.busy) { this.engine.stop(); return; }
      const [from, to] = scope.get();
      if (!(await this._ensure())) return;
      this._busy(go, true, 'Generate questions');
      items = [];
      out.replaceChildren(el('div', { class: 'ai-wait muted' }));
      tools.hidden = true;
      try {
        items = await this.f.quiz({
          from, to, count: Number(count.value), type: type.value, difficulty: diff.value,
          onStatus: (t) => { let w = out.querySelector('.ai-wait'); if (!w) { w = el('div', { class: 'ai-wait muted' }); out.append(w); } w.textContent = t; },
          onItems: (list) => { items = list; draw(); out.append(el('div', { class: 'ai-wait muted', text: 'Writing more…' })); }
        });
        draw();
        if (!items.length) out.append(el('p', { class: 'err', text: 'The model did not return usable questions. Try again, or choose fewer questions or different pages.' }));
        tools.hidden = !items.length;
      } catch (e) {
        draw();
        if (!(e.name === 'AbortError' || this.engine._stopped)) out.append(el('p', { class: 'err', text: e.message }));
        tools.hidden = !items.length;
      } finally { out.querySelector('.ai-wait')?.remove(); this._busy(go, false, 'Generate questions'); }
    };
    return el('div', { class: 'ai-pane' }, [
      scope.row,
      el('label', { class: 'ai-row' }, [el('span', { class: 'ai-lbl', text: 'Number' }), count]),
      el('label', { class: 'ai-row' }, [el('span', { class: 'ai-lbl', text: 'Type' }), type]),
      el('label', { class: 'ai-row' }, [el('span', { class: 'ai-lbl', text: 'Difficulty' }), diff]),
      el('div', { class: 'ai-row' }, [go]),
      out, tools
    ]);
  }

  // ------------------------------------------------------------------ Literature review
  // Model choice right in the tab: on-device, Chrome built-in, local server (Ollama / LM Studio / llama.cpp),
  // Claude API or OpenAI API — switching here changes the AI provider for the whole panel.
  _providerSelect() {
    const sel = el('select', { title: 'Which AI writes the review' }, [
      opt('webllm', 'On this device'),
      ...(IS_FIREFOX ? [] : [opt('chrome', 'Chrome built-in (Gemini Nano)')]),
      opt('server', 'Local server (Ollama, LM Studio, llama.cpp)'),
      opt('anthropic', 'Claude API (cloud)'),
      opt('openai', 'OpenAI API (cloud)')
    ]);
    const sync = () => { sel.value = this.settings.aiProvider || 'webllm'; };
    sync();
    sel.onchange = async () => {
      const prev = this.settings.aiProvider;
      this.settings.aiProvider = sel.value;
      await this.saveSettings(this.settings, ['aiProvider']);
      if (this.engine.state !== 'idle' && prev !== sel.value) await this.engine.unload();
      this._status();
      if (isCloud(sel.value) && !this.settings[CLOUD[sel.value].keyField]) this.openSettings();
    };
    return { sel, sync };
  }

  _reviewPane() {
    const scope = this._scopeRow('r');
    const field = el('input', { type: 'text', value: this.settings.aiReviewField || '', placeholder: 'e.g. Swarm Intelligence (empty = detect)', style: 'flex:1;min-width:0' });
    field.addEventListener('keydown', (e) => e.stopPropagation());
    field.addEventListener('change', () => { this.settings.aiReviewField = field.value.trim(); this.saveSettings(this.settings, ['aiReviewField']); });
    const prov = this._providerSelect();
    const syncs = [this._syncProvSel].filter(Boolean);
    this._syncProvSel = () => { prov.sync(); syncs.forEach((f) => f()); };
    const gearBtn = el('button', { class: 'tb small', title: 'Model, server address and API keys' }); gearBtn.append(icon('gear')); gearBtn.onclick = () => this.openSettings();
    const out = el('div', { class: 'ai-out ai-review' });
    const go = el('button', { class: 'btn primary', text: 'Write literature review' });
    const info = el('span', { class: 'muted small' });
    const tools = el('div', { class: 'ai-outtools', hidden: true });
    let last = '';
    const copy = el('button', { class: 'btn', text: 'Copy', onclick: () => { navigator.clipboard?.writeText(last); toast('Literature review copied'); } });
    const save = el('button', { class: 'btn', text: 'Save .txt', onclick: () => this.download(new TextEncoder().encode(last + '\n'), this._fileBase() + ' - literature review.txt', 'text/plain') });
    tools.append(copy, save, info);
    const render = (t) => {
      out.replaceChildren(...cleanReview(t).split(/\n{2,}|\n(?=(?:Context and Core Contribution|Methodological Breakdown and Framework|Empirical Results and Benchmark Performance|Related Work and Synthesis for Literature Review)\b)/)
        .map((para) => {
          const m = /^(Context and Core Contribution|Methodological Breakdown and Framework|Empirical Results and Benchmark Performance|Related Work and Synthesis for Literature Review):?\s*/.exec(para);
          if (!m) return el('p', { text: para.trim() });
          const rest = para.slice(m[0].length).trim();
          return el('div', {}, [el('h4', { text: m[1] }), rest ? el('p', { text: rest }) : null]);
        }));
    };
    go.onclick = async () => {
      if (this.busy) { this.engine.stop(); return; }
      const [from, to] = scope.get();
      this.settings.aiReviewField = field.value.trim();
      this.saveSettings(this.settings, ['aiReviewField']);
      if (!(await this._ensure())) return;
      this._busy(go, true, 'Write literature review');
      out.replaceChildren(el('div', { class: 'ai-wait muted' }));
      tools.hidden = true;
      let partial = '';
      try {
        const text = await this.f.litReview({
          field: field.value, from, to,
          onStatus: (t) => { const w = out.querySelector('.ai-wait'); if (w) w.textContent = t; },
          onToken: (d, full) => { partial = full; render(full); out.scrollTop = out.scrollHeight; }
        });
        last = cleanReview(text);
        render(last || '(no output)');
      } catch (e) {
        if (e.name === 'AbortError' || this.engine._stopped) { last = cleanReview(partial); if (!last) out.replaceChildren(el('p', { class: 'muted', text: 'Stopped.' })); }
        else out.replaceChildren(el('p', { class: 'err', text: e.message }));
      } finally {
        this._busy(go, false, 'Write literature review');
        if (last) { const n = wordCount(last); info.textContent = `${n} words${n < 350 || n > 450 ? ' (target 350–450)' : ''} · ${this.engine.label()}`; tools.hidden = false; }
      }
    };
    return el('div', { class: 'ai-pane' }, [
      el('p', { class: 'muted small', text: 'A 350–450-word literature-review section (context, method, results, related work) in formal academic prose, ready to paste into a paper or thesis.' }),
      el('label', { class: 'ai-row' }, [el('span', { class: 'ai-lbl', text: 'Field' }), field]),
      scope.row,
      el('div', { class: 'ai-row' }, [el('span', { class: 'ai-lbl', text: 'Model' }), prov.sel, gearBtn]),
      el('div', { class: 'ai-row' }, [go]),
      out, tools
    ]);
  }

  // ------------------------------------------------------------------ helpers
  _fileBase() { return (this.getTitle() || 'document').replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80); }

  _busy(btn, on, label) {
    this.busy = on;
    if (label) btn.textContent = on ? 'Stop' : label;
    else { btn.replaceChildren(icon(on ? 'stop' : 'send')); btn.title = on ? 'Stop' : 'Send (Enter)'; }
    btn.classList.toggle('danger', on);
  }

  // Make sure a model is running; ask before a first large download.
  async _ensure() {
    const e = this.engine;
    if (isCloud(e.provider) && !(await this._cloudConsent(e.provider))) return false;
    if (e.isReady()) return true;
    if (e.provider === 'webllm' && !(await e.isModelCached())) {
      const gpu = await AIEngine.webgpu();
      if (!gpu.ok) {
        const r = await showDialog('AI needs WebGPU', el('div', {}, [
          el('p', { text: gpu.why }),
          el('p', { text: IS_FIREFOX ? 'You can use a local AI server such as Ollama or LM Studio instead (AI settings → Local AI server).' : 'You can use Chrome’s built-in AI (Chrome only) or a local AI server such as Ollama or LM Studio instead.' })
        ]), [{ label: 'Close' }, { label: 'AI settings…', primary: true, value: 's' }]);
        if (r === 's') this.openSettings();
        return false;
      }
      const m = e.modelInfo;
      const r = await showDialog('Download the AI model?', el('div', {}, [
        el('p', {}, ['The AI features run entirely on this computer using ', el('b', { text: m.label }), '. It is downloaded once (', el('b', { text: m.download }), ') and then works offline, without sending your documents anywhere.']),
        el('p', { class: 'muted small', text: `Needs about ${m.vram || 'some'} of graphics memory${gpu.adapter ? ' · your GPU: ' + gpu.adapter : ''}. You can pick a smaller or larger model in AI settings.` })
      ]), [{ label: 'Cancel' }, { label: 'Settings…', value: 's' }, { label: 'Download & start', primary: true, value: 'go' }]);
      if (r === 's') { this.openSettings(); return false; }
      if (r !== 'go') return false;
    }
    try {
      await e.ensureReady();
      return true;
    } catch (err) {
      toast(err.message, 6000);
      return false;
    }
  }

  // Before any text goes to a cloud API: explain it once and ask (Firefox: also the data-collection permission).
  async _cloudConsent(p) {
    const c = CLOUD[p];
    if (!this.settings[c.keyField]) { toast(`Enter your ${c.name} key in AI settings first.`, 4000); this.openSettings(); return false; }
    if (this.settings.aiCloudConsent?.[p]) return true;
    return new Promise((resolve) => {
      const back = el('div', { class: 'dialog-backdrop' });
      const done = (ok) => { back.remove(); resolve(ok); };
      const agree = el('button', { class: 'btn primary', text: `Send to ${c.company}` });
      agree.onclick = () => {
        // must run inside the click: Firefox asks for the optional data-collection permission
        const ask = IS_FIREFOX && globalThis.browser?.permissions?.request
          ? Promise.resolve(globalThis.browser.permissions.request({ data_collection: ['websiteContent'] })).catch(() => true)
          : Promise.resolve(true);
        ask.then((granted) => {
          if (granted === false) { toast('Permission declined — nothing was sent.'); done(false); return; }
          this.settings.aiCloudConsent = { ...(this.settings.aiCloudConsent || {}), [p]: true };
          this.saveSettings(this.settings, ['aiCloudConsent']);
          done(true);
        });
      };
      back.append(el('div', { class: 'dialog', role: 'dialog' }, [
        el('h2', { text: `Use the ${c.name}?` }),
        el('p', {}, ['The text of the pages you choose will be sent to ', el('b', { text: c.company }), ` with your own API key, to generate the answer. ${c.company}’s terms and privacy policy apply, and usage is billed to your account.`]),
        el('p', { class: 'muted small', text: 'Everything else in Ferna stays on your computer. For confidential documents use “On this device” or a local server (Ollama, LM Studio, llama.cpp) instead. You can change this at any time in AI settings.' }),
        el('div', { class: 'actions' }, [el('button', { class: 'btn', text: 'Cancel', onclick: () => done(false) }), agree])
      ]));
      document.body.append(back);
    });
  }

  // ------------------------------------------------------------------ settings
  async openSettings() {
    const s = this.settings;
    const e = this.engine;
    const [gpu, chrome] = await Promise.all([AIEngine.webgpu(), AIEngine.chromeAI()]);
    const radio = (value, title, desc, disabled) => {
      const i = el('input', { type: 'radio', name: 'aiprov', value });
      i.checked = (s.aiProvider || 'webllm') === value;
      if (disabled) i.disabled = true;
      return el('label', { class: 'ai-prov' + (disabled ? ' disabled' : '') }, [i, el('div', {}, [el('div', { text: title, style: 'font-weight:600' }), el('div', { class: 'muted small', text: desc })])]);
    };
    const modelSel = el('select', { style: 'width:100%' }, MODELS.map((m) => opt(m.id, `${m.label} — download ${m.download}`, m.id === e.model)));
    const cacheInfo = el('div', { class: 'muted small' });
    const refreshCache = async () => {
      const rows = [];
      for (const m of MODELS) if (await e.isModelCached(m.id)) rows.push(m);
      cacheInfo.replaceChildren();
      if (!rows.length) cacheInfo.append(el('span', { text: 'No model downloaded yet.' }));
      for (const m of rows) {
        cacheInfo.append(el('div', { class: 'ai-cached' }, [el('span', { text: '✓ ' + m.label }), el('button', { class: 'chip', text: 'Delete', onclick: async () => { await e.deleteModel(m.id); refreshCache(); } })]));
      }
      try { const est = await navigator.storage.estimate(); cacheInfo.append(el('div', { text: `Storage used by Ferna: ${(est.usage / 1e9).toFixed(2)} GB` })); } catch { /* ignore */ }
    };
    refreshCache();
    const url = el('input', { type: 'text', value: s.aiServerUrl || 'http://localhost:11434/v1', style: 'width:100%' });
    const model = el('input', { type: 'text', value: s.aiServerModel || 'llama3.1:8b', style: 'width:100%' });
    const key = el('input', { type: 'password', value: s.aiApiKey || '', placeholder: 'only if the server needs one', style: 'width:100%' });
    const preset = (label, u) => el('button', { class: 'chip', type: 'button', text: label, onclick: () => { url.value = u; } });
    const cloudRows = {};
    for (const [id, c] of Object.entries(CLOUD)) {
      const k = el('input', { type: 'password', value: s[c.keyField] || '', placeholder: 'API key', style: 'width:100%', autocomplete: 'off' });
      const mdl = el('input', { type: 'text', value: s[c.modelField] || c.models[0], style: 'width:100%', list: 'ai-models-' + id });
      const dl = el('datalist', { id: 'ai-models-' + id }, c.models.map((m) => el('option', { value: m })));
      k.addEventListener('keydown', (ev) => ev.stopPropagation()); mdl.addEventListener('keydown', (ev) => ev.stopPropagation());
      cloudRows[id] = { k, mdl, box: el('div', { class: 'ai-sub' }, [
        el('label', {}, ['API key', k]), el('label', {}, ['Model', mdl, dl]),
        el('div', { class: 'muted small' }, ['Get a key at ', el('a', { href: c.keyUrl, target: '_blank', rel: 'noopener', text: c.keyUrl.replace('https://', '') }), '. The key is stored only on this computer. Document text is sent to ', c.company, ' only when you use an AI feature, after you agree once.'])
      ]) };
    }
    for (const i of [url, model, key]) i.addEventListener('keydown', (ev) => ev.stopPropagation());
    const body = el('div', { class: 'ai-settings' }, [
      radio('webllm', 'On this device (recommended)', gpu.ok ? `Runs on your graphics card with WebGPU${gpu.adapter ? ' · ' + gpu.adapter : ''}. Private and offline after a one-time download.` : `Not available: ${gpu.why}`, !gpu.ok),
      el('div', { class: 'ai-sub' }, [modelSel, el('div', { class: 'muted small', text: 'Sinhala: Qwen 3 · 4B writes the best Sinhala on this device; Qwen 3 · 1.7B and Gemma 2 · 2B are smaller. The other models are mainly for English.' }), cacheInfo]),
      IS_FIREFOX ? null : radio('chrome', 'Chrome built-in AI (Gemini Nano)', chrome === 'unavailable' ? 'Not available in this browser (needs Google Chrome 138+ with built-in AI enabled).' : `Provided by Chrome — status: ${chrome}.`, chrome === 'unavailable'),
      radio('server', 'Local AI server (Ollama, LM Studio…)', 'Use a larger model running on this computer through an OpenAI-compatible server.'),
      el('div', { class: 'ai-sub' }, [
        el('label', {}, ['Server address', url]),
        el('div', { class: 'ai-presets' }, [preset('Ollama', 'http://localhost:11434/v1'), preset('LM Studio', 'http://localhost:1234/v1'), preset('llama.cpp', 'http://localhost:8080/v1')]),
        el('label', {}, ['Model name', model]),
        el('label', {}, ['API key', key]),
        el('div', { class: 'muted small', text: `Ollama: install from ollama.com, run "ollama pull llama3.1:8b", keep the address http://localhost:11434/v1. If Ollama refuses the connection, set the environment variable OLLAMA_ORIGINS=${EXT_SCHEME}://* and restart it.` }),
        el('div', { class: 'muted small', text: 'For Sinhala, models such as "gemma3:12b", "gemma3:4b" or "qwen3:8b" write much better Sinhala than the small on-device models.' })
      ]),
      radio('anthropic', 'Claude API (Anthropic, cloud)', 'Best quality for literature reviews and long papers. Uses your own Anthropic API key; the text you analyse is sent to Anthropic.'),
      cloudRows.anthropic.box,
      radio('openai', 'OpenAI API (cloud)', 'Uses your own OpenAI API key; the text you analyse is sent to OpenAI.'),
      cloudRows.openai.box
    ]);
    const res = await showDialog('AI settings', body, [{ label: 'Unload model', value: 'unload' }, { label: 'Cancel' }, { label: 'Save', primary: true, value: 'save' }]);
    if (res === 'unload') { await e.unload(); toast('Model unloaded — graphics memory freed.'); return; }
    if (res !== 'save') return;
    const prov = body.querySelector('input[name=aiprov]:checked')?.value || 'webllm';
    const changed = prov !== s.aiProvider || modelSel.value !== s.aiModel || url.value !== s.aiServerUrl || model.value !== s.aiServerModel
      || Object.entries(CLOUD).some(([id, c]) => cloudRows[id].k.value.trim() !== (s[c.keyField] || '') || cloudRows[id].mdl.value.trim() !== (s[c.modelField] || ''));
    s.aiProvider = prov; s.aiModel = modelSel.value; s.aiServerUrl = url.value.trim(); s.aiServerModel = model.value.trim(); s.aiApiKey = key.value;
    const keys = ['aiProvider', 'aiModel', 'aiServerUrl', 'aiServerModel', 'aiApiKey'];
    for (const [id, c] of Object.entries(CLOUD)) { s[c.keyField] = cloudRows[id].k.value.trim(); s[c.modelField] = cloudRows[id].mdl.value.trim() || c.models[0]; keys.push(c.keyField, c.modelField); }
    await this.saveSettings(s, keys);
    if (changed && e.state !== 'idle') { await e.unload(); }
    this._status();
    this._langHint();
    toast('AI settings saved');
  }
}
