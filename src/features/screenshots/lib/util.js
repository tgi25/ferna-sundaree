// Ferna Screenshots — small shared helpers (no DOM)

const pad = (n, w = 2) => String(n).padStart(w, '0');

export function tzLabel(date) {
  const off = -date.getTimezoneOffset();
  const s = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `UTC${s}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatTime(ts, fmt = 'local') {
  const d = new Date(ts);
  if (fmt === 'utc') {
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
      `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`;
  }
  if (fmt === 'iso') {
    const off = -d.getTimezoneOffset(), a = Math.abs(off);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
      `${off >= 0 ? '+' : '-'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
  }
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} (${tzLabel(d)})`;
}

export function domainOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'file:') return 'local-file';
    return u.hostname.replace(/^www\./, '') || u.protocol.replace(':', '');
  } catch { return 'page'; }
}

export const MODE_NAMES = {
  visible: 'Visible area', full: 'Entire page', region: 'Selected region', element: 'Selected element'
};

function clean(s) {
  return String(s || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|~]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.-]+|[\s.-]+$/g, '');
}

export function buildFilename(pattern, meta, ext, folder) {
  const d = new Date(meta.ts);
  const tok = {
    domain: domainOf(meta.url), title: (meta.title || 'screenshot').slice(0, 80),
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`,
    yyyy: d.getFullYear(), mm: pad(d.getMonth() + 1), dd: pad(d.getDate()),
    HH: pad(d.getHours()), MM: pad(d.getMinutes()), SS: pad(d.getSeconds()),
    mode: (meta.mode || 'capture')
  };
  let name = String(pattern || '{domain}_{date}_{time}').replace(/\{(\w+)\}/g, (m, k) => (k in tok ? tok[k] : m));
  name = clean(name).slice(0, 140) || 'screenshot';
  const dir = String(folder || '').split(/[\\/]+/).map(clean).filter(Boolean).join('/');
  return (dir ? dir + '/' : '') + name + '.' + ext;
}

export function middleEllipsis(text, fits) {
  if (fits(text)) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {               // longest k such that head+…+tail fits
    const k = Math.ceil((lo + hi) / 2);
    const t = text.slice(0, Math.ceil(k * 0.62)) + '…' + text.slice(text.length - Math.floor(k * 0.38));
    if (fits(t)) lo = k; else hi = k - 1;
  }
  return text.slice(0, Math.ceil(lo * 0.62)) + '…' + text.slice(text.length - Math.floor(lo * 0.38));
}

export function endEllipsis(text, fits) {
  if (fits(text)) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const k = Math.ceil((lo + hi) / 2);
    if (fits(text.slice(0, k) + '…')) lo = k; else hi = k - 1;
  }
  return text.slice(0, lo).trimEnd() + '…';
}
