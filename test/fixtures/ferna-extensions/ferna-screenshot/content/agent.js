// Ferna Screenshot — page agent: measures the page, scrolls it step by step for stitching,
// hides sticky/fixed elements while capturing and puts everything back afterwards.
(() => {
  if (window.__fernaShotAgent) return;
  window.__fernaShotAgent = true;

  let saved = null;
  const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function docSize() {
    const d = document.documentElement, b = document.body;
    return {
      w: Math.max(d.scrollWidth, b ? b.scrollWidth : 0, d.clientWidth),
      h: Math.max(d.scrollHeight, b ? b.scrollHeight : 0, d.clientHeight)
    };
  }

  function viewportSize() {
    const d = document.documentElement;
    const std = document.compatMode === 'CSS1Compat';
    return {
      vw: std ? d.clientWidth : (document.body ? document.body.clientWidth : innerWidth),
      vh: std ? d.clientHeight : innerHeight
    };
  }

  // Pages such as web mail scroll an inner panel instead of the window.
  function findScroller() {
    const se = document.scrollingElement || document.documentElement;
    if (se.scrollHeight > se.clientHeight + 4) return null;
    let best = null, area = 0;
    for (const el of document.querySelectorAll('body *')) {
      if (el.scrollHeight <= el.clientHeight + 20 || el.clientHeight < 50) continue;
      const oy = getComputedStyle(el).overflowY;
      if (!/(auto|scroll|overlay)/.test(oy)) continue;
      const r = el.getBoundingClientRect();
      const a = r.width * r.height;
      if (a > area && r.width > innerWidth * 0.3 && r.height > innerHeight * 0.3) { best = el; area = a; }
    }
    return best;
  }

  function view() {
    const sc = saved && saved.scroller;
    if (sc) {
      const r = sc.getBoundingClientRect();
      return {
        scrollX: sc.scrollLeft, scrollY: sc.scrollTop, vw: sc.clientWidth, vh: sc.clientHeight,
        viewLeft: r.left + sc.clientLeft, viewTop: r.top + sc.clientTop,
        innerW: innerWidth, innerH: innerHeight, docW: sc.scrollWidth, docH: sc.scrollHeight, container: true
      };
    }
    const v = viewportSize(), ds = docSize();
    return {
      scrollX: window.scrollX, scrollY: window.scrollY, vw: v.vw, vh: v.vh, viewLeft: 0, viewTop: 0,
      innerW: innerWidth, innerH: innerHeight, docW: ds.w, docH: ds.h, container: false,
      title: document.title, url: location.href
    };
  }

  function setImportant(el, prop, value, list) {
    list.push([el, prop, el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]);
    el.style.setProperty(prop, value, 'important');
  }

  function prepare(m) {
    if (saved) restore();
    saved = { x: window.scrollX, y: window.scrollY, scroller: m.full ? findScroller() : null, props: [], fixed: [], fixedHidden: false };
    if (saved.scroller) { saved.sx = saved.scroller.scrollLeft; saved.sy = saved.scroller.scrollTop; }
    const st = document.createElement('style');
    st.textContent = 'html, body, * { scroll-behavior: auto !important; scroll-snap-type: none !important; }';
    document.documentElement.appendChild(st);
    saved.style = st;
    if (m.hideFixed) {
      const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT);
      let n = 0;
      for (let el = walker.currentNode; el && n < 60000; el = walker.nextNode(), n++) {
        const pos = getComputedStyle(el).position;
        if (pos === 'fixed') {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) saved.fixed.push(el);
        } else if (pos === 'sticky') {
          // keep it in normal flow at its natural place instead of following the scroll
          setImportant(el, 'position', 'relative', saved.props);
          for (const p of ['top', 'bottom', 'left', 'right']) setImportant(el, p, 'auto', saved.props);
        }
      }
    }
    return view();
  }

  async function scrollStep(m) {
    if (!saved) prepare({ full: false, hideFixed: false });
    if (m.hideFixed && !saved.fixedHidden) {
      for (const el of saved.fixed) setImportant(el, 'visibility', 'hidden', saved.props);
      saved.fixedHidden = true;
    }
    if (saved.scroller) saved.scroller.scrollTo(m.x, m.y);
    else window.scrollTo(m.x, m.y);
    await raf(); await raf();
    await sleep(Math.max(0, m.delay || 0));
    await raf();
    return view();
  }

  function restore() {
    if (!saved) return {};
    for (let i = saved.props.length - 1; i >= 0; i--) {
      const [el, prop, val, pri] = saved.props[i];
      if (val) el.style.setProperty(prop, val, pri); else el.style.removeProperty(prop);
    }
    if (saved.scroller) saved.scroller.scrollTo(saved.sx, saved.sy);
    window.scrollTo(saved.x, saved.y);
    if (saved.style) saved.style.remove();
    saved = null;
    return {};
  }

  async function handle(m) {
    switch (m.fsCmd) {
      case 'measure': return view();
      case 'prepare': return prepare(m);
      case 'scroll': return scrollStep(m);
      case 'restore': return restore();
      case 'toast': return toast(m.text, m.ms);
    }
    return {};
  }

  function toast(text, ms = 2600) {
    const h = document.createElement('ferna-shot-toast');
    h.style.cssText = 'all:initial;position:fixed;z-index:2147483647;left:50%;top:18px;transform:translateX(-50%);pointer-events:none;';
    const root = h.attachShadow({ mode: 'closed' });
    root.innerHTML = `<div style="font:500 13px/1.4 system-ui,Segoe UI,sans-serif;color:#fff;background:#0f172aEE;padding:9px 14px;border-radius:10px;box-shadow:0 6px 24px #0005;max-width:70vw"></div>`;
    root.firstChild.textContent = text;
    document.documentElement.appendChild(h);
    setTimeout(() => h.remove(), ms);
    return {};
  }

  chrome.runtime.onMessage.addListener((m, sender, reply) => {
    if (!m || !m.fsCmd) return;
    handle(m).then(reply, (e) => reply({ error: String(e && e.message || e) }));
    return true;
  });
})();
