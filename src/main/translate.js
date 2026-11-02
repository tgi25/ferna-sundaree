'use strict';
// Translation. Two ways, your choice (asked the first time):
//   • Google Translate: the page opens through Google's translation proxy (Google sees the
//     address and the page; pages behind a sign-in cannot be translated this way);
//   • your AI assistant (Ollama / LM Studio on this PC stays private): the page's text is
//     translated in the side panel.
// Selected text: the selection menu, right-click → Translate selection.

const { dialog } = require('electron');

const LANGS = { en: 'English', si: 'Sinhala', ta: 'Tamil', hi: 'Hindi', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', ar: 'Arabic', fr: 'French', de: 'German', es: 'Spanish', pt: 'Portuguese', ru: 'Russian', it: 'Italian', nl: 'Dutch', ms: 'Malay', th: 'Thai', id: 'Indonesian', bn: 'Bengali', ur: 'Urdu' };

function install(ctx) {
  const lang = () => ctx.settings.data.translateTo || 'en';
  async function service(win) {
    const s = ctx.settings.data;
    if (s.translateService === 'google' || s.translateService === 'ai') return s.translateService === 'ai' && !ctx.assistant.configured() ? 'google' : s.translateService;
    const ai = ctx.assistant.configured();
    const r = await dialog.showMessageBox(win.win, {
      type: 'question', noLink: true, title: 'Translate',
      buttons: ai ? ['Cancel', 'Google Translate', 'My AI assistant (private)'] : ['Cancel', 'Google Translate', 'Set up a private AI assistant…'],
      defaultId: ai ? 2 : 1, cancelId: 0,
      message: `Translate into ${LANGS[lang()] || lang()} with…`,
      detail: 'Google Translate is fast and covers every language, but Google receives the page. Your own AI assistant (for example Ollama on this PC) keeps it private. Change the language and the choice in Settings → Languages.',
      checkboxLabel: 'Remember my choice', checkboxChecked: true,
    });
    if (r.response === 0) return null;
    if (r.response === 2 && !ai) { ctx.assistant.toggle(win, true); return null; }
    const pick = r.response === 2 ? 'ai' : 'google';
    if (r.checkboxChecked) ctx.settings.set('translateService', pick);
    return pick;
  }
  ctx.translatePage = async (win, tab) => {
    if (!/^https?:/i.test(tab.url || '')) return;
    if (/\.translate\.goog$/i.test(new URL(tab.url).hostname)) { win.run('back'); return; }
    const how = await service(win);
    if (how === 'google') win.navigate(tab, `https://translate.google.com/translate?sl=auto&tl=${encodeURIComponent(lang())}&u=${encodeURIComponent(tab.url)}`);
    else if (how === 'ai') ctx.assistant.ask(win, { action: 'translatePage', lang: LANGS[lang()] || lang() });
  };
  ctx.translateText = async (win, tab, text) => {
    text = String(text || '').trim().slice(0, 5000);
    if (!text) return;
    const how = await service(win);
    if (how === 'google') win.newTab(`https://translate.google.com/?sl=auto&tl=${encodeURIComponent(lang())}&text=${encodeURIComponent(text)}&op=translate`, { index: win.tabs.indexOf(tab) + 1 });
    else if (how === 'ai') ctx.assistant.ask(win, { action: 'translate', text, lang: LANGS[lang()] || lang() });
  };
  ctx.LANGS = LANGS;
}

module.exports = { install, LANGS };
