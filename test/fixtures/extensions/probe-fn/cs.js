chrome.runtime.onMessage.addListener((m, s, r) => { if (m === 'ping') r('pong:' + location.pathname); });
