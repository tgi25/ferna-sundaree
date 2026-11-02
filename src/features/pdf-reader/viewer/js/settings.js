// Persistent settings (chrome.storage.sync when running as an extension, localStorage otherwise).
const DEFAULTS = {
  stylusDraws: true,          // Xodo mode: a stylus always writes, even in Select mode
  selectionPopup: true,       // quick-annotate popup after selecting text
  hidePaletteOnSelect: true,  // hide the annotation palette as soon as a tool is chosen
  stickyTools: true,          // keep shape/text/note tools active after one use
  defaultZoom: 'width',       // 'width' | 'page' | number
  rememberPosition: true,
  hLock: false,               // horizontal scroll lock
  refPopups: true,            // cross-references open a floating preview card
  refPopupW: 600,             // v1.5: default popup width (px)
  refPopupH: 360,             // v1.5: default popup height (px)
  refPopupZoom: 1,            // v1.5: default popup zoom (1 = page width fills the popup)
  refPopupRemember: false,
  ocrLang: 'eng',              // v1.5: OCR language — 'eng' | 'sin' | 'sin+eng'    // v1.5: keep the size/zoom last set with the mouse as the new default
  smoothSelect: true,         // v1.4: Ferna's own text selection (nearest character, line bands)
  wordSelect: true,           // v1.4: dragging selects whole words (Alt = single characters)
  aiLanguage: 'auto',         // v1.4: answer language — 'auto' | 'en' | 'si'
  aiProvider: 'webllm',       // 'webllm' (on-device) | 'chrome' (Gemini Nano) | 'server' (Ollama / LM Studio)
  aiModel: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
  aiServerUrl: 'http://localhost:11434/v1',
  aiServerModel: 'llama3.1:8b',
  aiApiKey: '',
  aiAnthropicKey: '',         // v1.6: Claude API key (stored on this device only)
  aiAnthropicModel: 'claude-sonnet-5',
  aiOpenAIKey: '',            // v1.6: OpenAI API key (stored on this device only)
  aiOpenAIModel: 'gpt-4o-mini',
  aiCloudConsent: {},         // v1.6: {anthropic: true, openai: true} once the user agreed to send text
  aiReviewField: '',          // v1.6: field of study for literature reviews
  skipOverwriteHelp: false,   // first-overwrite explanation for file:// PDFs
  author: '',
  toolProps: null
};

const hasChrome = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync;
// secrets are kept in local storage on this device, never in synced storage
const LOCAL_ONLY = new Set(['aiAnthropicKey', 'aiOpenAIKey', 'aiApiKey']);

export async function loadSettings() {
  let stored = {};
  try {
    if (hasChrome) {
      stored = await chrome.storage.sync.get(Object.keys(DEFAULTS).filter((k) => !LOCAL_ONLY.has(k)));
      Object.assign(stored, await chrome.storage.local.get([...LOCAL_ONLY]));
      if ('aiApiKey' in stored === false) { const old = await chrome.storage.sync.get('aiApiKey'); if (old.aiApiKey) stored.aiApiKey = old.aiApiKey; }
    }
    else stored = JSON.parse(localStorage.getItem('ferna-settings') || '{}');
  } catch { /* ignore */ }
  return { ...DEFAULTS, ...stored };
}

export async function saveSettings(settings, keys = Object.keys(DEFAULTS)) {
  const out = {};
  for (const k of keys) out[k] = settings[k];
  try {
    if (hasChrome) {
      const loc = {}, syn = {};
      for (const [k, v] of Object.entries(out)) (LOCAL_ONLY.has(k) ? loc : syn)[k] = v;
      if (Object.keys(syn).length) await chrome.storage.sync.set(syn);
      if (Object.keys(loc).length) { await chrome.storage.local.set(loc); await chrome.storage.sync.remove(Object.keys(loc)).catch?.(() => {}); }
    }
    else localStorage.setItem('ferna-settings', JSON.stringify({ ...JSON.parse(localStorage.getItem('ferna-settings') || '{}'), ...out }));
  } catch (e) { console.warn('settings not saved', e); }
}

// Per-document view state (last page, zoom)
export async function loadViewState(key) {
  try {
    if (hasChrome && chrome.storage.local) return (await chrome.storage.local.get('view:' + key))['view:' + key] || null;
    return JSON.parse(localStorage.getItem('view:' + key) || 'null');
  } catch { return null; }
}
export async function saveViewState(key, state) {
  try {
    if (hasChrome && chrome.storage.local) await chrome.storage.local.set({ ['view:' + key]: { ...state, t: Date.now() } });
    else localStorage.setItem('view:' + key, JSON.stringify(state));
  } catch { /* ignore */ }
}
