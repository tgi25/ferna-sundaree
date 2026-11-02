// Language-model engine with three interchangeable providers:
//   • 'webllm'  – embedded, on-device model running on the GPU through WebGPU (default; works in Brave and Chrome)
//   • 'chrome'  – Chrome's built-in Gemini Nano (Prompt API), when the browser provides it
//   • 'server'  – any OpenAI-compatible server, e.g. Ollama, LM Studio or llama.cpp on this computer (offline)
//   • 'anthropic' – Anthropic Claude API (cloud, the user's own API key; only after the user agrees)
//   • 'openai'  – OpenAI API (cloud, the user's own API key; only after the user agrees)
import { IS_FIREFOX } from '../platform.js';
import { Emitter } from '../util.js';

// si: how well the model writes Sinhala (0 none … 3 good); siTpc: tokens per Sinhala character (estimate).
const loadWebLLM = () => import('../../../lib/web-llm/index.js');

export const MODELS = [
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen 2.5 · 1.5B (recommended for English)', download: '≈ 1.0 GB', vram: '1.7 GB', si: 1, siTpc: 1.0 },
  { id: 'Qwen3-1.7B-q4f16_1-MLC', label: 'Qwen 3 · 1.7B (Sinhala + English)', download: '≈ 1.1 GB', vram: '2.0 GB', si: 2, siTpc: 1.0, thinking: true },
  { id: 'Qwen3-4B-q4f16_1-MLC', label: 'Qwen 3 · 4B (best Sinhala on this device)', download: '≈ 2.3 GB', vram: '3.4 GB', si: 3, siTpc: 1.0, thinking: true },
  { id: 'gemma-2-2b-it-q4f16_1-MLC', label: 'Gemma 2 · 2B (multilingual)', download: '≈ 1.4 GB', vram: '1.9 GB', si: 2, siTpc: 0.5 },
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 · 1B (fastest, English)', download: '≈ 0.7 GB', vram: '0.9 GB', si: 0, siTpc: 1.0 },
  { id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', label: 'Qwen 2.5 · 3B (better answers)', download: '≈ 1.8 GB', vram: '2.5 GB', si: 1, siTpc: 1.0 },
  { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 · 3B (better answers, English)', download: '≈ 1.8 GB', vram: '2.3 GB', si: 1, siTpc: 1.0 },
  { id: 'Phi-3.5-mini-instruct-q4f16_1-MLC', label: 'Phi 3.5 mini · 3.8B (English, needs a strong GPU)', download: '≈ 2.2 GB', vram: '3.7 GB', si: 0, siTpc: 2.6 }
];

const SI = /[\u0D80-\u0DFF]/g;
const EN_TPC = 0.27;           // tokens per character of English / Latin text


export const CLOUD = {
  anthropic: { name: 'Claude API', company: 'Anthropic', keyField: 'aiAnthropicKey', modelField: 'aiAnthropicModel',
    models: ['claude-sonnet-5', 'claude-opus-5-5', 'claude-haiku-4-5-20251001'], keyUrl: 'https://console.anthropic.com/settings/keys' },
  openai: { name: 'OpenAI API', company: 'OpenAI', keyField: 'aiOpenAIKey', modelField: 'aiOpenAIModel',
    models: ['gpt-4o-mini', 'gpt-4o'], keyUrl: 'https://platform.openai.com/api-keys' }
};
export const isCloud = (p) => p === 'anthropic' || p === 'openai';

export class AIEngine extends Emitter {
  constructor(settings) {
    super();
    this.settings = settings;
    this.state = 'idle';      // idle | loading | ready | error
    this.detail = '';
    this.progress = 0;
    this._engine = null;      // WebLLM engine
    this._engineModel = null;
    this._loading = null;
    this._queue = Promise.resolve();
    this._abort = null;
  }

  get provider() { return this.settings.aiProvider || 'webllm'; }
  get model() { return this.settings.aiModel || MODELS[0].id; }
  get modelInfo() { return MODELS.find((m) => m.id === this.model) || { id: this.model, label: this.model }; }

  // Characters of (English) document text that fit comfortably into one request.
  get inputBudget() {
    if (this.provider === 'anthropic') return 400000;   // 200k-token context
    if (this.provider === 'openai') return 300000;      // 128k-token context
    if (this.provider === 'server') return Number(this.settings.aiServerContextChars) || 16000;
    if (this.provider === 'chrome') return 7000;
    return 7500; // 4k-token context of the embedded models
  }

  // Context window in tokens (null = unknown / large)
  get contextTokens() { return this.provider === 'webllm' ? 4096 : this.provider === 'chrome' ? 6000 : null; }

  // Estimated tokens per Sinhala character for the current model
  get siTpc() {
    if (this.provider === 'webllm') return this.modelInfo.siTpc ?? 1.0;
    if (this.provider === 'server') return /gemma|aya|command/i.test(this.settings.aiServerModel || '') ? 0.5 : 0.9;
    return 1.0;
  }

  tokensFor(text) {
    const si = (text.match(SI) || []).length;
    return Math.ceil((text.length - si) * EN_TPC + si * this.siTpc);
  }

  // Characters of *this kind of* text that fit: Sinhala costs several times more tokens than English.
  charBudget(sample = '') {
    const n = sample.length || 1;
    const si = (sample.match(SI) || []).length / n;
    const tpc = (1 - si) * EN_TPC + si * this.siTpc;
    return Math.floor(this.inputBudget * EN_TPC / Math.max(EN_TPC, tpc));
  }

  // Output tokens for an answer of about `n` English tokens in the given language, within the context window.
  outTokens(n, lang, inputText = '') {
    let t = lang === 'si' ? Math.ceil(n * 0.9 * this.siTpc / EN_TPC) : n;
    const ctx = this.contextTokens;
    if (ctx) t = Math.max(128, Math.min(t, ctx - this.tokensFor(inputText) - 96));
    return t;
  }

  get cloudModel() { const c = CLOUD[this.provider]; return c ? (this.settings[c.modelField] || c.models[0]) : null; }

  label() {
    if (isCloud(this.provider)) return `${this.cloudModel} · ${CLOUD[this.provider].name}`;
    if (this.provider === 'chrome') return 'Gemini Nano · built into Chrome';
    if (this.provider === 'server') return `${this.settings.aiServerModel || 'model'} · local server`;
    return this.modelInfo.label.replace(/\s*\(.*\)$/, '') + ' · on this device';
  }

  _set(state, detail = '', progress = this.progress) {
    this.state = state; this.detail = detail; this.progress = progress;
    this.emit('status', { state, detail, progress });
  }

  // ------------------------------------------------------------------ capability checks
  static async webgpu() {
    try {
      if (!navigator.gpu) return { ok: false, why: IS_FIREFOX ? 'WebGPU is not available in this Firefox (it is on by default in Firefox 141+ on Windows; update Firefox).' : 'This browser has no WebGPU.' };
      const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!a) return { ok: false, why: 'WebGPU is available but no suitable graphics adapter was found.' };
      return { ok: true, adapter: a.info?.description || a.info?.vendor || '' };
    } catch (e) { return { ok: false, why: e.message }; }
  }

  static async chromeAI() {
    try {
      if (!globalThis.LanguageModel?.availability) return 'unavailable';
      return await globalThis.LanguageModel.availability({ expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] });
    } catch { return 'unavailable'; }
  }

  async isModelCached(id = this.model) {
    try { const w = await loadWebLLM(); return await w.hasModelInCache(id); } catch { return false; }
  }

  async deleteModel(id) {
    const w = await loadWebLLM();
    if (this._engineModel === id) await this.unload();
    await w.deleteModelAllInfoInCache(id);
  }

  async unload() {
    try { await this._engine?.unload(); } catch { /* ignore */ }
    try { this._worker?.terminate(); } catch { /* ignore */ }
    this._engine = null; this._engineModel = null; this._worker = null;
    this._set('idle', '');
  }

  // ------------------------------------------------------------------ loading
  isReady() {
    if (this.provider === 'webllm') return this.state === 'ready' && this._engineModel === this.model;
    return this.state === 'ready' && this._readyFor === this._readyKey();
  }

  _readyKey() {
    if (isCloud(this.provider)) return this.provider + '|' + this.cloudModel + '|' + !!this.settings[CLOUD[this.provider].keyField];
    return this.provider + '|' + (this.settings.aiServerUrl || '');
  }

  ensureReady() {
    if (this.isReady()) return Promise.resolve();
    if (this._loading) return this._loading;
    this._loading = this._load().finally(() => { this._loading = null; });
    return this._loading;
  }

  async _load() {
    try {
      if (this.provider === 'webllm') {
        const gpu = await AIEngine.webgpu();
        if (!gpu.ok) throw new Error(gpu.why + (IS_FIREFOX ? ' Use "Local AI server" in AI settings instead.' : ' Use "Local server" or "Chrome built-in" in AI settings instead.'));
        if (this._engine && this._engineModel !== this.model) await this.unload();
        this._set('loading', 'Preparing the model…', 0);
        const w = await loadWebLLM();
        this._worker = new Worker(new URL('./llm-worker.js', import.meta.url), { type: 'module' });
        this._engine = await w.CreateWebWorkerMLCEngine(this._worker, this.model, {
          initProgressCallback: (r) => this._set('loading', r.text || 'Loading…', r.progress || 0)
        }, { context_window_size: 4096 });
        this._engineModel = this.model;
      } else if (this.provider === 'chrome') {
        const av = await AIEngine.chromeAI();
        if (av === 'unavailable') throw new Error('Chrome’s built-in AI is not available in this browser.');
        this._set('loading', av === 'available' ? 'Starting Gemini Nano…' : 'Downloading Gemini Nano (done by Chrome)…', 0);
        const s = await globalThis.LanguageModel.create({
          expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }],
          monitor: (m) => m.addEventListener('downloadprogress', (e) => this._set('loading', 'Downloading Gemini Nano…', e.loaded))
        });
        s.destroy?.();
      } else if (isCloud(this.provider)) {
        const c = CLOUD[this.provider];
        if (!this.settings[c.keyField]) throw new Error(`Enter your ${c.name} key in AI settings first.`);
      } else {
        this._set('loading', 'Connecting to the local server…', 0);
        const r = await fetch(this._url('/models'), { headers: this._headers() }).catch(() => null);
        if (!r || !r.ok) throw new Error(`No answer from ${this.settings.aiServerUrl}. Is Ollama / LM Studio running?`);
      }
      this._readyFor = this._readyKey();
      this._set('ready', this.label(), 1);
    } catch (e) {
      let msg = (e && e.message) || String(e);
      if (/failed to fetch|networkerror|network error/i.test(msg)) msg = 'Could not download the model — check the internet connection (only needed the first time), then try again.';
      if (/out of memory|OOM|device lost|allocation/i.test(msg)) msg = 'The graphics card ran out of memory. Choose a smaller model in AI settings.';
      if (this.provider === 'webllm') { try { this._worker?.terminate(); } catch { /* ignore */ } this._engine = null; this._engineModel = null; this._worker = null; }
      this._set('error', msg, 0);
      throw new Error(msg);
    }
  }

  // ------------------------------------------------------------------ generation
  // messages: [{role:'system'|'user'|'assistant', content}]
  // opts: {onToken(delta, full), schema (JSON schema object → JSON output), maxTokens, temperature}
  complete(messages, opts = {}) {
    const run = () => this._complete(messages, opts);
    const p = this._queue.then(run, run);
    this._queue = p.catch(() => {});
    return p;
  }

  stop() {
    this._stopped = true;
    try { this._abort?.abort(); } catch { /* ignore */ }
    try { this._engine?.interruptGenerate(); } catch { /* ignore */ }
  }

  async _complete(messages, { onToken, schema, maxTokens = 512, temperature = 0.3 } = {}) {
    await this.ensureReady();
    this._stopped = false;
    let full = '';
    const add = (d) => { if (!d) return; full += d; onToken?.(d, full); };
    // Qwen 3 and other "thinking" models: drop <think>…</think> from the visible output
    let raw = '';
    const addRaw = (d) => {
      if (!d) return;
      raw += d;
      let vis = raw.replace(/<think>[\s\S]*?<\/think>\s*/g, '');
      const open = vis.indexOf('<think>');
      if (open >= 0) vis = vis.slice(0, open);                      // still thinking
      else {
        const m = /<t?h?i?n?k?$/.exec(vis);                           // a tag may be arriving
        if (m && '<think>'.startsWith(m[0])) vis = vis.slice(0, m.index);
      }
      vis = vis.replace(/^\s+/, '');
      if (vis.length > full.length && vis.startsWith(full)) add(vis.slice(full.length));
    };
    if (this.provider === 'webllm') {
      const req = { messages, stream: true, temperature, max_tokens: maxTokens };
      if (schema) req.response_format = { type: 'json_object', schema: JSON.stringify(schema) };
      if (this.modelInfo.thinking) req.extra_body = { enable_thinking: false };
      const chunks = await this._engine.chat.completions.create(req);
      for await (const c of chunks) {
        addRaw(c.choices?.[0]?.delta?.content || '');
        if (this._stopped) break;
      }
    } else if (this.provider === 'chrome') {
      const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
      const rest = messages.filter((m) => m.role !== 'system');
      const last = rest.pop();
      const initialPrompts = [];
      if (sys) initialPrompts.push({ role: 'system', content: sys });
      initialPrompts.push(...rest);
      const session = await globalThis.LanguageModel.create({ initialPrompts, temperature: Math.max(0.1, temperature), topK: 3,
        expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] });
      this._abort = new AbortController();
      try {
        const stream = session.promptStreaming(last.content, { signal: this._abort.signal, ...(schema ? { responseConstraint: schema } : {}) });
        for await (const chunk of stream) {
          // older Chrome versions stream the whole text so far, newer ones only the new part
          if (raw && chunk.startsWith(raw)) addRaw(chunk.slice(raw.length)); else addRaw(chunk);
        }
      } catch (e) { if (e.name !== 'AbortError') throw e; } finally { session.destroy?.(); }
    } else if (this.provider === 'anthropic') {
      // Anthropic Messages API, streamed (server-sent events: content_block_delta → text_delta)
      this._abort = new AbortController();
      const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
      const msgs = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content }));
      if (schema) msgs[msgs.length - 1].content += '\n\nReply with JSON only.';
      const body = { model: this.cloudModel, max_tokens: Math.max(256, maxTokens), temperature, stream: true, messages: msgs, ...(sys ? { system: sys } : {}) };
      let r;
      try {
        r = await fetch(this._anthropicUrl(), {
          method: 'POST', signal: this._abort.signal, body: JSON.stringify(body),
          headers: {
            'content-type': 'application/json', 'x-api-key': this.settings.aiAnthropicKey,
            'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true'
          }
        });
      } catch (e) { if (e.name === 'AbortError') return full; throw new Error('Could not reach the Claude API: ' + e.message); }
      if (!r.ok) throw new Error(cloudError('Claude API', r.status, await r.text()));
      await readSSE(r, (ev) => {
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') addRaw(ev.delta.text || '');
        else if (ev.type === 'error') throw new Error('Claude API: ' + (ev.error?.message || 'error'));
      });
    } else {
      // OpenAI API, or any OpenAI-compatible local server (Ollama, LM Studio, llama.cpp)
      const openai = this.provider === 'openai';
      this._abort = new AbortController();
      const body = { model: openai ? this.cloudModel : (this.settings.aiServerModel || 'llama3.1'), messages, stream: true, temperature, max_tokens: maxTokens };
      if (schema) body.response_format = { type: 'json_object' };
      const who = openai ? 'OpenAI API' : 'The local server';
      let r;
      try {
        r = await fetch(openai ? this._openaiUrl() : this._url('/chat/completions'), { method: 'POST', headers: { 'Content-Type': 'application/json', ...(openai ? { Authorization: 'Bearer ' + this.settings.aiOpenAIKey } : this._headers()) }, body: JSON.stringify(body), signal: this._abort.signal });
      } catch (e) { if (e.name === 'AbortError') return full; throw new Error(`${who} did not answer: ` + e.message); }
      if (!r.ok) throw new Error(openai ? cloudError('OpenAI API', r.status, await r.text()) : `Local server error ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') continue;
            try { addRaw(JSON.parse(data).choices?.[0]?.delta?.content || ''); } catch { /* keep going */ }
          }
        }
      } catch (e) { if (e.name !== 'AbortError') throw e; }
    }
    this._abort = null;
    // flush text held back as a possible tag start
    const rest = raw.replace(/<think>[\s\S]*?(<\/think>|$)\s*/g, '').replace(/^\s+/, '');
    if (rest.length > full.length && rest.startsWith(full)) add(rest.slice(full.length));
    return full;
  }

  _url(path) { return (this.settings.aiServerUrl || 'http://localhost:11434/v1').replace(/\/+$/, '') + path; }
  _anthropicUrl() { return (this.settings.aiAnthropicBase || 'https://api.anthropic.com') + '/v1/messages'; }
  _openaiUrl() { return (this.settings.aiOpenAIBase || 'https://api.openai.com') + '/v1/chat/completions'; }
  _headers() { return this.settings.aiApiKey ? { Authorization: 'Bearer ' + this.settings.aiApiKey } : {}; }
}

// Read a server-sent-events stream and hand each JSON event to fn.
async function readSSE(r, fn) {
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let ev; try { ev = JSON.parse(data); } catch { continue; }
        fn(ev);
      }
    }
  } catch (e) { if (e.name !== 'AbortError') throw e; }
}

function cloudError(name, status, text) {
  let msg = '';
  try { const j = JSON.parse(text); msg = j.error?.message || j.message || ''; } catch { msg = text.slice(0, 200); }
  if (status === 401 || status === 403) return `${name}: the API key was not accepted (${status}). Check it in AI settings.`;
  if (status === 404) return `${name}: model not found — check the model name in AI settings. ${msg}`;
  if (status === 429) return `${name}: rate limit or quota reached (429). ${msg}`;
  if (status === 529 || status === 503) return `${name} is overloaded right now (${status}). Try again in a minute.`;
  return `${name} error ${status}: ${msg}`;
}

// Parse JSON produced by a small model, tolerating code fences, trailing commas and extra text.
export function parseJSONLoose(text) {
  if (!text) return null;
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch { /* try harder */ }
  const start = t.search(/[[{]/);
  if (start < 0) return null;
  const open = t[start], close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) { end = i; break; } }
  }
  let body = end > 0 ? t.slice(start, end + 1) : t.slice(start);
  body = body.replace(/,\s*([}\]])/g, '$1');
  try { return JSON.parse(body); } catch { /* truncated output: close brackets */ }
  if (end < 0) {
    // close an unfinished array/object at the last complete element
    const lastObj = body.lastIndexOf('}');
    if (lastObj > 0) {
      const cut = body.slice(0, lastObj + 1);
      for (const tail of [']}', ']', '}]}', '}']) { try { return JSON.parse(cut + tail); } catch { /* next */ } }
    }
  }
  return null;
}
