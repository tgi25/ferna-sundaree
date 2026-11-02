// Popover / menu helpers.
import { el, icon, clamp } from './util.js';

const pop = () => document.getElementById('popover');
let onHide = null;
let currentKind = '';

export function popoverKind() { return pop().hidden ? '' : currentKind; }

export function hidePopover() {
  const p = pop();
  if (p.hidden) return;
  p.hidden = true;
  p.replaceChildren();
  currentKind = '';
  const cb = onHide; onHide = null;
  cb?.();
}

// anchor: {x, y} point or DOMRect; place: 'above' | 'below' | 'point'
export function showPopover(content, anchor, { place = 'above', kind = '', hide = null } = {}) {
  hidePopover();
  const p = pop();
  p.replaceChildren(content);
  p.hidden = false;
  currentKind = kind;
  onHide = hide;
  p.style.left = '0px'; p.style.top = '0px';
  const pr = p.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  let x, y;
  if (anchor instanceof DOMRect || ('width' in anchor && 'height' in anchor)) {
    x = anchor.left + anchor.width / 2 - pr.width / 2;
    y = place === 'below' ? anchor.bottom + 8 : anchor.top - pr.height - 8;
    if (y < 50) y = anchor.bottom + 8;
    if (y + pr.height > vh - 8) y = Math.max(50, anchor.top - pr.height - 8);
  } else {
    x = anchor.x; y = anchor.y;
    if (x + pr.width > vw - 8) x = anchor.x - pr.width;
    if (y + pr.height > vh - 8) y = anchor.y - pr.height;
  }
  p.style.left = clamp(x, 8, vw - pr.width - 8) + 'px';
  p.style.top = clamp(y, 8, vh - pr.height - 8) + 'px';
  return p;
}

document.addEventListener('pointerdown', (e) => {
  const p = pop();
  if (!p.hidden && !p.contains(e.target)) hidePopover();
}, true);

export function popBtn(iconName, title, onClick, cls = '', label = '') {
  const b = el('button', { class: 'pop-btn ' + cls, title });
  if (iconName) b.append(icon(iconName));
  if (label) b.append(el('span', { text: label }));
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); });
  return b;
}

export function swatchBtn(color, title, onClick, active = false) {
  const b = el('button', { class: 'pop-swatch' + (active ? ' active' : ''), title, style: `background:${color}` });
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(color); });
  return b;
}

// Menu: items = [{icon, label, kb, action} | '-' | {title}]
export function buildMenu(items) {
  const m = el('div', { class: 'menu' });
  for (const it of items) {
    if (it === '-') { m.append(el('div', { class: 'menu-sep' })); continue; }
    if (it.title) { m.append(el('div', { class: 'menu-title', text: it.title })); continue; }
    const b = el('button', { class: 'menu-item' });
    if (it.icon) b.append(icon(it.icon)); else b.append(el('span', { style: 'width:18px' }));
    b.append(el('span', { text: it.label }));
    if (it.kb) b.append(el('span', { class: 'kb', text: it.kb }));
    b.addEventListener('click', (e) => { e.stopPropagation(); hidePopover(); it.action(); });
    m.append(b);
  }
  return m;
}

export function showMenu(items, anchor, opts = {}) {
  return showPopover(buildMenu(items), anchor, { place: 'below', ...opts });
}

// Comment editor. Resolves with {text} | {remove:true} | null
export function editComment({ title, text = '', meta = '', anchor, allowDelete = true }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; hidePopover(); resolve(v); };
    const ta = el('textarea', { placeholder: 'Write a comment…' });
    ta.value = text;
    const box = el('div', { class: 'comment-box' }, [
      el('div', { style: 'font-weight:600', text: title }),
      meta ? el('div', { class: 'meta', text: meta }) : null,
      ta,
      el('div', { class: 'actions' }, [
        allowDelete ? el('button', { class: 'btn', text: 'Delete', style: 'margin-right:auto;color:var(--danger)', onclick: () => finish({ remove: true }) }) : null,
        el('button', { class: 'btn', text: 'Cancel', onclick: () => finish(null) }),
        el('button', { class: 'btn primary', text: 'Save', onclick: () => finish({ text: ta.value }) })
      ])
    ]);
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) finish({ text: ta.value });
      if (e.key === 'Escape') finish(null);
    });
    showPopover(box, anchor, { place: 'below', kind: 'comment', hide: () => { if (!done) { done = true; resolve({ text: ta.value, implicit: true }); } } });
    setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
  });
}

export function showDialog(title, body, buttons = [{ label: 'Close', primary: true }]) {
  return new Promise((resolve) => {
    const back = el('div', { class: 'dialog-backdrop' });
    const close = (v) => { back.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
    document.addEventListener('keydown', onKey, true);
    const d = el('div', { class: 'dialog', role: 'dialog' }, [el('h2', { text: title }), body,
      el('div', { class: 'actions' }, buttons.map((b) => el('button', { class: 'btn' + (b.primary ? ' primary' : ''), text: b.label, onclick: () => close(b.value ?? b.label) })))]);
    back.append(d);
    back.addEventListener('pointerdown', (e) => { if (e.target === back) close(null); });
    document.body.append(back);
  });
}
