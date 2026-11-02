'use strict';
const { icon, esc, hostOf, $ } = FK;
const api = window.ferna;
const p = new URLSearchParams(location.search);
const kind = p.get('kind');
const url = p.get('url') || '';
const code = p.get('code') || '';
const desc = p.get('desc') || '';
const host = hostOf(url) || url;
const suggest = (p.get('suggest') || '').replace(/[^a-z0-9.-]/gi, '');
const WHY = {
  letters: 'Its name uses letters from another alphabet that look like the real ones.',
  lookalike: 'Its name swaps letters for look-alikes (such as 1 for l, 0 for o, or rn for m).',
  typo: 'Its name differs from the real one by a single letter.',
  prefix: `It puts the real address in front of a different site's address.`,
  brand: 'It adds a sign-in or security word to a well-known name.',
}[p.get('reason')] || '';

const PAGES = {
  https: {
    cls: 'warn', ic: 'warn', title: `${esc(host)} does not support a secure connection`,
    body: `<p>Ferna Sundaree tried to open this site over HTTPS first, but the secure connection failed. If you continue, the page loads over plain HTTP: anyone on your network could read or change what you send and receive.</p>
           <p class="url">${esc(url)}</p>`,
    acts: [['Go back', 'back', 'primary'], ['Continue to the HTTP site', 'proceed', '']],
  },
  cert: {
    cls: 'danger', ic: 'lock', title: 'Your connection is not private',
    body: `<p>The security certificate of <strong>${esc(host)}</strong> could not be trusted. Someone may be trying to impersonate the site or intercept your data. For your safety, Ferna Sundaree does not offer a way to continue.</p>
           <p class="url">${esc(url)}</p>`,
    acts: [['Go back', 'back', 'primary'], ['Try again', 'retry', '']],
  },
  blocked: {
    cls: 'danger', ic: 'shield', title: 'This page was blocked',
    body: `<p>The address <strong>${esc(host)}</strong> is on a malware, tracker or ad filter list, so Ferna Sundaree did not load it.</p><p class="url">${esc(url)}</p>
           <p>If you trust this site, turn blocking off for it from the shield button in the toolbar.</p>`,
    acts: [['Go back', 'back', 'primary']],
  },
  lookalike: {
    cls: 'warn', ic: 'warn', title: `Did you mean ${esc(suggest)}?`,
    body: `<p>The site you are opening, <strong>${esc(host)}</strong>, looks like <strong>${esc(suggest)}</strong> but is a different site. ${esc(WHY)}</p>
           <p>Fake sites use names like this to collect passwords and card numbers. You have not visited this site before.</p>
           <p class="url">${esc(url)}</p>`,
    acts: [[`Go to ${esc(suggest)}`, 'suggest', 'primary'], ['Go back', 'back', ''], [`Continue to ${esc(host)}`, 'lookalike-ok', '']],
  },
  phishing: {
    cls: 'danger red', ic: 'warn', title: 'Deceptive site ahead',
    body: `<p><strong>${esc(host)}</strong> is on a list of phishing sites. Pages like this pretend to be your bank, email, or another site you trust, to trick you into typing a password or card number, or into installing software.</p>
           <p class="url">${esc(url)}</p>
           <p class="muted">Reported to PhishTank or OpenPhish and listed by the Phishing URL Blocklist. The check happened on this PC; the address was not sent anywhere.</p>`,
    acts: [['Back to safety', 'back', 'primary']],
    unsafe: true,
  },
  malware: {
    cls: 'danger red', ic: 'warn', title: 'Dangerous site ahead',
    body: `<p><strong>${esc(host)}</strong> is on a list of sites that spread malware. Visiting it could install software that steals your data or damages your PC.</p>
           <p class="url">${esc(url)}</p>
           <p class="muted">Listed by abuse.ch URLhaus (Malicious URL Blocklist). The check happened on this PC; the address was not sent anywhere.</p>`,
    acts: [['Back to safety', 'back', 'primary']],
    unsafe: true,
  },
  parental: {
    cls: 'warn', ic: 'shield', title: 'This site is blocked by parental controls',
    body: `<p><strong>${esc(host)}</strong> is ${{ adult: 'on the list of adult sites', gambling: 'a gambling site', social: 'a social media site', yours: 'on the blocked list set by your parent or guardian' }[p.get('why')] || 'blocked'}.</p>
           <p class="url">${esc(url)}</p>
           <details class="parent"><summary>Ask a parent</summary><p>A parent or guardian can allow this site with the parental-controls password.</p>
           <p><input type="password" id="pp" placeholder="Parent password" autocomplete="off" style="padding:7px 9px;border:1px solid var(--line-strong);border-radius:7px;width:240px"></p>
           <p><label><input type="checkbox" id="pp-always"> Always allow ${esc(host)}</label></p>
           <button class="btn" data-act="parent">Allow</button> <span id="pp-msg" class="muted"></span></details>`,
    acts: [['Go back', 'back', 'primary']],
  },
  crashed: {
    cls: 'warn', ic: 'warn', title: 'This page stopped working',
    body: `<p>The page's process ended unexpectedly (${esc(desc)}). Other tabs are not affected, because every site runs in its own sandboxed process.</p><p class="url">${esc(url)}</p>`,
    acts: [['Reload', 'retry', 'primary'], ['Go back', 'back', '']],
  },
  error: {
    cls: '', ic: 'globe', title: code === '-105' ? `Cannot find ${esc(host)}` : code === '-106' ? 'You are offline' : 'This page cannot be reached',
    body: `<p>${code === '-105' ? 'Check the address for typos. If secure DNS is on and your network blocks it, change it in Settings → Privacy and security.' : code === '-106' ? 'Check your network connection, then try again.' : 'The site may be down, or your connection was interrupted.'}</p><p class="url">${esc(url)}</p>`,
    acts: [['Try again', 'retry', 'primary'], ['Go back', 'back', '']],
  },
};

const page = PAGES[kind] || PAGES.error;
document.title = page.title.replace(/<[^>]+>/g, '');
const m = $('#m');
m.className = page.cls;
m.innerHTML = `<div class="ic">${icon(page.ic)}</div><h1>${page.title}</h1>${page.body}
  <div class="acts">${page.acts.map(([label, act, cls]) => `<button class="btn ${cls}" data-act="${act}">${label}</button>`).join('')}</div>
  ${page.unsafe ? `<details class="unsafe"><summary>Details</summary><p>If you are sure this listing is a mistake, you can open the site anyway. Ferna Sundaree will allow ${esc(host)} until you close the browser.</p><button class="btn danger" data-act="unsafe">Visit this unsafe site</button></details>`
    : code && code !== '0' ? `<details><summary>Technical details</summary>Error ${esc(code)} ${esc(desc)}</details>` : ''}`;
m.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'parent') {
    api.cmd('parental:allow', url, $('#pp').value, $('#pp-always').checked).then(ok => { if (!ok) { $('#pp-msg').textContent = 'Wrong password.'; $('#pp').value = ''; } });
    return;
  }
  if (act === 'proceed') api.cmd('inter:proceed', url);
  else if (act === 'unsafe') api.cmd('inter:unsafe', url);
  else if (act === 'lookalike-ok') api.cmd('inter:lookalike-ok', url);
  else if (act === 'suggest' && suggest) api.cmd('inter:go', `https://${suggest}/`);
  else if (act === 'retry') api.cmd('inter:go', url);
  else api.cmd('inter:go', 'back');
});
