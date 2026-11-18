// Ferna Feeds — tells the extension which feeds this page announces (its RSS/Atom/JSON Feed links).
(() => {
  if (window.top !== window || window.__fernaFeedsDiscover) return;
  window.__fernaFeedsDiscover = true;
  const look = () => {
    const list = [...document.querySelectorAll('link[rel~="alternate"][href]')]
      .filter(l => /(rss|atom|feed)\+(xml|json)|application\/feed\+json/i.test(l.type || ''))
      .slice(0, 12).map(l => ({ url: l.href, title: (l.title || '').slice(0, 200), type: l.type || '' }))
      .filter(f => /^https?:/i.test(f.url));
    chrome.runtime.sendMessage({ t: 'page-feeds', feeds: list }).catch(() => {});
  };
  look();
  // Single-page sites change the page without loading a new one.
  let last = location.href;
  setInterval(() => { if (location.href !== last) { last = location.href; look(); } }, 2000);
})();
