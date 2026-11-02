'use strict';
// AI assistant side panel: chat with the current page and other tabs as context, skills (/),
// tab mentions (@), streaming answers, settings (provider, model, key, translation, skills).
const { $, $$, esc, icon, hostOf } = FK;
const api = window.ferna;
let CFG = null;
const S = { msgs: [], page: true, tabs: [], selection: '', busy: null, menu: null, menuSel: 0 };

$('#logo').innerHTML = icon('sparkle');
$('#b-new').innerHTML = icon('plus');
$('#b-set').innerHTML = icon('menu');
$('#b-close').innerHTML = icon('close');
$('#send').innerHTML = icon('send');

async function loadCfg() {
  CFG = await api.cmd('ai:config');
  $('#model').textContent = CFG.model ? CFG.model : 'no model';
  $('#model').title = `${CFG.providers[CFG.provider].label}${CFG.model ? ` · ${CFG.model}` : ''}`;
  $('#privacy').textContent = CFG.provider === 'ollama' || (CFG.provider === 'openai-compatible' && /localhost|127\.0\.0\.1/.test(CFG.endpoint))
    ? 'Runs on this PC: pages and questions never leave it.'
    : `Questions and the pages you attach are sent to ${CFG.providers[CFG.provider].label.replace(/ \(.*/, '')}.`;
  renderQuick();
}

// ---------- quick actions ----------
function renderQuick() {
  const q = [
    ['summarize', 'Summarise this page', '5 bullet points'], ['keypoints', 'Key facts and claims', 'with quotes'],
    ['quiz', 'Quiz me on this page', '5 multiple-choice questions'], ['compare', 'Compare tabs', 'mention tabs with @'],
  ];
  $('#quick').innerHTML = q.map(([k, t, s]) => `<button data-skill="${k}"><b>${esc(t)}</b><span>${esc(s)}</span></button>`).join('');
}
$('#quick').addEventListener('click', e => { const b = e.target.closest('[data-skill]'); if (b) runSkill(b.dataset.skill); });
function runSkill(name, selection) {
  const sk = (CFG.skills || []).find(k => k.name === name);
  if (!sk) return;
  if (name === 'compare' && !S.tabs.length) { $('#input').value = '@'; $('#input').focus(); openMenu('@'); return; }
  send(sk.prompt, { selection });
}

// ---------- context chips ----------
async function renderChips() {
  const active = await api.cmd('ai:active');
  const all = await api.cmd('ai:tabs');
  const chips = [];
  if (active && active.web) chips.push(`<span class="chip2 ${S.page ? 'on' : 'off'}" title="${esc(active.url)}"><span data-toggle="page">📄 ${esc(active.title || hostOf(active.url))}</span></span>`);
  for (const id of S.tabs) { const t = all.find(x => x.id === id); if (t) chips.push(`<span class="chip2 on"><span>@ ${esc(t.title)}</span><button data-rm="${id}" title="Remove">×</button></span>`); }
  if (S.selection) chips.push(`<span class="chip2 on" title="${esc(S.selection.slice(0, 300))}"><span>✂ “${esc(S.selection.slice(0, 40))}${S.selection.length > 40 ? '…' : ''}”</span><button data-rmsel="1">×</button></span>`);
  $('#chips').innerHTML = chips.join('');
}
$('#chips').addEventListener('click', e => {
  if (e.target.closest('[data-toggle]')) { S.page = !S.page; renderChips(); }
  const rm = e.target.closest('[data-rm]'); if (rm) { S.tabs = S.tabs.filter(x => x !== Number(rm.dataset.rm)); renderChips(); }
  if (e.target.closest('[data-rmsel]')) { S.selection = ''; renderChips(); }
});
api.on('state', () => {});
setInterval(() => { if (!document.hidden) renderChips(); }, 3000);

// ---------- markdown (escaped first, then a small safe subset) ----------
function md(src) {
  const blocks = [];
  let s = esc(src).replace(/```(\w*)\n?([\s\S]*?)(```|$)/g, (m, lang, code) => { blocks.push(`<pre><code>${code}</code></pre>`); return `\u0000${blocks.length - 1}\u0000`; });
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, t, u) => `<a data-href="${u}">${t}</a>`);
  const out = [];
  let list = null;
  for (const line of s.split('\n')) {
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const li = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) { const ordered = /^\s*\d/.test(line); if (!list || list.ordered !== ordered) { if (list) out.push(list.ordered ? '</ol>' : '</ul>'); list = { ordered }; out.push(ordered ? '<ol>' : '<ul>'); } out.push(`<li>${li[1]}</li>`); continue; }
    if (list) { out.push(list.ordered ? '</ol>' : '</ul>'); list = null; }
    if (h) out.push(`<h${h[1].length + 1}>${h[2]}</h${h[1].length + 1}>`);
    else if (line.trim()) out.push(`<p>${line}</p>`);
  }
  if (list) out.push(list.ordered ? '</ol>' : '</ul>');
  return out.join('').replace(/\u0000(\d+)\u0000/g, (m, i) => blocks[+i]);
}

// ---------- messages ----------
function render() {
  $('#empty').hidden = S.msgs.length > 0;
  $('#msgs').innerHTML = S.msgs.map((m, i) => m.role === 'user'
    ? `<div class="msg user">${esc(m.shown || m.content)}</div>`
    : `<div class="msg assistant">${m.ctx ? `<div class="ctx">${esc(m.ctx)}</div>` : ''}<div class="${m.streaming ? 'cursor' : ''}">${m.error ? `<span class="err">${esc(m.error)}</span>` : md(m.content || '')}</div>${!m.streaming && m.content ? `<div class="tools"><button data-copy="${i}">Copy</button><button data-retry="${i}">Retry</button></div>` : ''}</div>`).join('');
  const c = $('#chat');
  c.scrollTop = c.scrollHeight;
  $('#send').innerHTML = icon(S.busy ? 'stop' : 'send');
  $('#send').title = S.busy ? 'Stop' : 'Send (Enter)';
}
$('#msgs').addEventListener('click', e => {
  const a = e.target.closest('a[data-href]'); if (a) { api.cmd('ai:open-url', a.dataset.href); return; }
  const cp = e.target.closest('[data-copy]'); if (cp) { navigator.clipboard.writeText(S.msgs[+cp.dataset.copy].content); cp.textContent = 'Copied'; return; }
  const rt = e.target.closest('[data-retry]');
  if (rt) { const i = +rt.dataset.retry; const prev = S.msgs.slice(0, i).reverse().find(m => m.role === 'user'); S.msgs = S.msgs.slice(0, S.msgs.lastIndexOf(prev)); if (prev) send(prev.content, { shown: prev.shown }); }
});

function expand(text, selection) {
  let out = text;
  const sk = /^\/(\w+)\s*([\s\S]*)$/.exec(text);
  if (sk) { const k = (CFG.skills || []).find(x => x.name === sk[1]); if (k) out = k.prompt + (sk[2] ? `\n\n${sk[2]}` : ''); }
  const sel = selection || S.selection;
  out = out.replace(/\{\{page\}\}/g, S.page ? 'the attached page' : 'the page').replace(/\{\{selection\}\}/g, sel || '(nothing selected)');
  return out;
}

async function send(text, o = {}) {
  text = String(text || '').trim();
  if (!text || S.busy) return;
  if (!CFG.configured) { openSettings('Choose a model provider and a model to start.'); return; }
  const content = expand(text, o.selection);
  S.msgs.push({ role: 'user', content, shown: o.shown || text });
  const id = `r${Date.now().toString(36)}`;
  const reply = { role: 'assistant', content: '', streaming: true, id };
  S.msgs.push(reply);
  S.busy = id;
  render();
  $('#input').value = '';
  autosize();
  const ok = await api.cmd('ai:chat', { id, messages: S.msgs.filter(m => !m.streaming && !m.error).map(m => ({ role: m.role, content: m.content })), page: S.page && !o.noPage, tabs: S.tabs, selection: o.selection || S.selection || '' });
  if (!ok) { reply.streaming = false; reply.error = 'Could not start.'; S.busy = null; render(); }
}

let pendingRender = 0;
api.on('assistant', m => {
  if (m.type === 'ask') { onAsk(m); return; }
  const r = S.msgs.find(x => x.id === m.id);
  if (!r) return;
  if (m.type === 'context') r.ctx = m.pages.length ? `Read: ${m.pages.map(p => p.title || hostOf(p.url)).join(', ')}` : '';
  if (m.type === 'delta') { r.content += m.text; if (!pendingRender) pendingRender = requestAnimationFrame(() => { pendingRender = 0; render(); }); return; }
  if (m.type === 'done' || m.type === 'error') { r.streaming = false; if (m.type === 'error') r.error = m.error; if (S.busy === m.id) S.busy = null; S.selection = ''; renderChips(); }
  render();
});

async function onAsk(m) {
  await loadCfg();
  if (!m.configured) { if (m.text) S.selection = m.text; renderChips(); openSettings('Set up a model to use the assistant. Ollama runs free and private on this PC.'); return; }
  if (m.action === 'summarize') { S.page = true; runSkill('summarize'); }
  else if (m.action === 'explain') { S.selection = m.text || ''; renderChips(); send('/explain', { selection: m.text, noPage: true, shown: `Explain: “${(m.text || '').slice(0, 80)}”` }); }
  else if (m.action === 'translate') send(`Translate into ${m.lang}. Reply with the translation only:\n\n${m.text}`, { noPage: true, shown: `Translate into ${m.lang}: “${(m.text || '').slice(0, 80)}”` });
  else if (m.action === 'translatePage') { S.page = true; send(`Translate the attached page into ${m.lang}. Keep headings and paragraphs; reply with the translation only.`, { shown: `Translate this page into ${m.lang}` }); }
  else if (m.text) { S.selection = m.text; renderChips(); $('#input').focus(); }
}

// ---------- composer: / skills and @ tabs ----------
function autosize() { const t = $('#input'); t.style.height = 'auto'; t.style.height = `${Math.min(180, t.scrollHeight)}px`; }
async function openMenu(kind) {
  const t = $('#input');
  const word = kind === '/' ? t.value.slice(1).split(/\s/)[0].toLowerCase() : (t.value.slice(t.value.lastIndexOf('@') + 1) || '').toLowerCase();
  let items;
  if (kind === '/') items = (CFG.skills || []).filter(k => k.name.toLowerCase().startsWith(word)).map(k => ({ v: k.name, t: `/${k.name}`, s: k.prompt.replace(/\s+/g, ' ').slice(0, 70) }));
  else items = (await api.cmd('ai:tabs')).filter(x => !S.tabs.includes(x.id) && (`${x.title} ${x.url}`).toLowerCase().includes(word)).slice(0, 20).map(x => ({ v: x.id, t: x.title, s: hostOf(x.url) }));
  if (!items.length) { closeMenu(); return; }
  S.menu = { kind, items }; S.menuSel = Math.min(S.menuSel, items.length - 1);
  $('#menu').hidden = false;
  $('#menu').innerHTML = items.map((it, i) => `<div class="it${i === S.menuSel ? ' sel' : ''}" data-i="${i}"><b>${esc(it.t)}</b><small>${esc(it.s)}</small></div>`).join('');
}
function closeMenu() { S.menu = null; S.menuSel = 0; $('#menu').hidden = true; }
function pickMenu(i) {
  const it = S.menu.items[i];
  const t = $('#input');
  if (S.menu.kind === '/') t.value = `/${it.v} `;
  else { S.tabs.push(it.v); t.value = t.value.slice(0, t.value.lastIndexOf('@')); renderChips(); }
  closeMenu(); t.focus();
}
$('#menu').addEventListener('mousedown', e => { const it = e.target.closest('[data-i]'); if (it) { e.preventDefault(); pickMenu(+it.dataset.i); } });
$('#input').addEventListener('input', () => {
  autosize();
  const v = $('#input').value;
  if (/^\/\w*$/.test(v)) openMenu('/');
  else if (/(^|\s)@[^\s@]*$/.test(v)) openMenu('@');
  else closeMenu();
});
$('#input').addEventListener('keydown', e => {
  if (S.menu) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); S.menuSel = (S.menuSel + (e.key === 'ArrowDown' ? 1 : -1) + S.menu.items.length) % S.menu.items.length; openMenu(S.menu.kind); return; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMenu(S.menuSel); return; }
    if (e.key === 'Escape') { closeMenu(); return; }
  }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send($('#input').value); }
});
$('#send').onclick = () => { if (S.busy) api.cmd('ai:stop', S.busy); else send($('#input').value); };
$('#b-new').onclick = () => { if (S.busy) api.cmd('ai:stop', S.busy); S.msgs = []; S.tabs = []; S.selection = ''; S.busy = null; render(); renderChips(); $('#input').focus(); };
$('#b-close').onclick = () => api.cmd('ai:close');

// ---------- resize ----------
(() => {
  const r = $('#resize');
  let start = null;
  r.addEventListener('pointerdown', e => { start = { x: e.screenX, w: innerWidth }; r.setPointerCapture(e.pointerId); });
  r.addEventListener('pointerup', e => { if (!start) return; const w = Math.round(start.w + (start.x - e.screenX)); start = null; api.cmd('ai:width', Math.max(300, Math.min(560, w))); });
})();

// ---------- settings ----------
const HELP = {
  ollama: 'Free and private. Install Ollama from ollama.com, then in a terminal run <code>ollama pull llama3.2</code> (or qwen2.5, gemma3, mistral). Press "Load list" to pick the model.',
  'openai-compatible': 'For LM Studio: open its Developer tab and start the server (default http://localhost:1234/v1). Also works with llama.cpp server, Jan, vLLM and others. A key is only needed if your server asks for one.',
  anthropic: 'Get a key at console.anthropic.com. Pages you attach are sent to Anthropic with your question. Press "Load list" to choose a Claude model.',
  openai: 'Get a key at platform.openai.com. Pages you attach are sent to OpenAI with your question.',
};
async function openSettings(note) {
  await loadCfg();
  const st = $('#settings');
  st.hidden = false;
  $('#s-provider').innerHTML = Object.entries(CFG.providers).map(([k, p]) => `<option value="${k}" ${k === CFG.provider ? 'selected' : ''}>${esc(p.label)}</option>`).join('');
  $('#s-endpoint').value = CFG.endpoint;
  $('#s-model').value = CFG.model;
  $('#s-key').value = '';
  $('#s-status').textContent = note || '';
  const langs = { en: 'English', si: 'Sinhala', ta: 'Tamil', hi: 'Hindi', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', ar: 'Arabic', fr: 'French', de: 'German', es: 'Spanish', pt: 'Portuguese', ru: 'Russian', it: 'Italian', nl: 'Dutch', ms: 'Malay', th: 'Thai', id: 'Indonesian', bn: 'Bengali', ur: 'Urdu' };
  $('#s-lang').innerHTML = Object.entries(langs).map(([k, v]) => `<option value="${k}" ${k === CFG.translateTo ? 'selected' : ''}>${v}</option>`).join('');
  const sv = await api.cmd('settings:get');
  $('#s-tsvc').value = sv.translateService || '';
  renderSkills(CFG.skills);
  onProvider();
}
function onProvider() {
  const p = $('#s-provider').value;
  const meta = CFG.providers[p];
  if (!$('#s-endpoint').value || Object.values(CFG.providers).some(x => x.endpoint === $('#s-endpoint').value)) $('#s-endpoint').value = meta.endpoint;
  $('#l-endpoint').hidden = p === 'anthropic' || p === 'openai';
  $('#l-key').hidden = !meta.key;
  $('#s-key').placeholder = CFG.hasKey[p] ? 'Saved (type to replace)' : meta.key === 'optional' ? 'Optional' : 'Paste your API key';
  $('#s-help').innerHTML = HELP[p];
}
$('#s-provider').onchange = onProvider;
$('#s-load').onclick = async () => {
  const p = $('#s-provider').value;
  if ($('#s-key').value) await api.cmd('ai:set-key', p, $('#s-key').value);
  $('#s-status').textContent = 'Loading models…';
  const r = await api.cmd('ai:models', p, $('#s-endpoint').value);
  if (!r.ok) { $('#s-status').textContent = r.error; return; }
  $('#s-models').innerHTML = r.models.map(m => `<option value="${esc(m)}">`).join('');
  $('#s-status').textContent = r.models.length ? `${r.models.length} models found. Click the Model box to choose.` : 'No models found.';
  if (!$('#s-model').value && r.models[0]) $('#s-model').value = r.models[0];
};
function renderSkills(skills) {
  $('#s-skills').innerHTML = skills.map(k => `<div class="skill"><div class="top"><input class="sk-n" value="${esc(k.name)}" maxlength="40" placeholder="name"><button class="btn small" data-del>Remove</button></div><textarea class="sk-p" maxlength="4000">${esc(k.prompt)}</textarea></div>`).join('');
}
$('#s-skills').addEventListener('click', e => { if (e.target.closest('[data-del]')) e.target.closest('.skill').remove(); });
$('#s-addskill').onclick = () => { const d = document.createElement('div'); d.className = 'skill'; d.innerHTML = '<div class="top"><input class="sk-n" maxlength="40" placeholder="name"><button class="btn small" data-del>Remove</button></div><textarea class="sk-p" maxlength="4000" placeholder="Prompt. Use {{page}} and {{selection}}."></textarea>'; $('#s-skills').append(d); };
$('#s-cancel').onclick = () => { $('#settings').hidden = true; };
$('#s-save').onclick = async () => {
  const provider = $('#s-provider').value;
  if ($('#s-key').value) await api.cmd('ai:set-key', provider, $('#s-key').value);
  const skills = $$('.skill').map(d => ({ name: d.querySelector('.sk-n').value.trim().replace(/[^\w-]/g, '').slice(0, 40), prompt: d.querySelector('.sk-p').value.trim().slice(0, 4000) })).filter(k => k.name && k.prompt);
  try {
    await api.cmd('settings:set', 'assistant', { provider, model: $('#s-model').value.trim(), endpoint: $('#l-endpoint').hidden ? '' : $('#s-endpoint').value.trim(), skills });
    await api.cmd('settings:set', 'translateTo', $('#s-lang').value);
    await api.cmd('settings:set', 'translateService', $('#s-tsvc').value);
  } catch (e) { $('#s-status').textContent = 'Could not save these settings.'; return; }
  $('#settings').hidden = true;
  await loadCfg();
};
$('#b-set').onclick = () => { if ($('#settings').hidden) openSettings(); else $('#settings').hidden = true; };

loadCfg().then(() => { render(); renderChips(); $('#input').focus(); });
