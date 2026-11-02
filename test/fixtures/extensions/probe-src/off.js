chrome.runtime.onMessage.addListener((m, s, reply) => { if (m && m.target === 'off') { localStorage.setItem('k', 'v'); reply('pong:' + localStorage.getItem('k')); } });
