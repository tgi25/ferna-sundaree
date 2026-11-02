// Ferna Screenshots — settings with defaults (stored in chrome.storage.sync)

export const DEFAULTS = {
  afterCapture: 'editor',      // 'editor' | 'save'
  quickFormat: 'png',          // format used by "save immediately": png | jpg | pdf
  jpegQuality: 0.92,
  saveAs: false,               // ask where to save each time
  folder: 'Ferna Screenshots', // sub-folder inside the Downloads folder
  filePattern: '{domain}_{date}_{time}',
  hideFixed: true,             // hide fixed headers/chat bubbles after the first screen
  scrollDelay: 250,            // ms to wait after each scroll (lazy images, animations)
  maxHeight: 30000,            // longest page captured, in CSS px
  resolution: 'device',        // 'device' (sharp, HiDPI) | 'css' (1 image px per CSS px)
  historyLimit: 40,
  delay: 0,                    // seconds before visible / full-page captures
  pdfPage: 'a4',               // 'a4' | 'single'
  stamp: {
    enabled: true,
    placement: 'corner',       // 'corner' | 'footer' | 'header'
    corner: 'auto',            // 'auto' | 'tl' | 'tr' | 'bl' | 'br'
    title: true,
    url: true,
    time: true,
    details: false,            // capture mode and page size
    note: '',
    theme: 'dark',             // 'dark' | 'light'
    size: 1,                   // 0.75 … 1.6
    timeFormat: 'local',       // 'local' | 'iso' | 'utc'
    brand: false
  }
};

function merge(base, over) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k of Object.keys(over || {})) {
    if (!(k in base)) continue;
    const b = base[k], o = over[k];
    out[k] = (b && typeof b === 'object' && !Array.isArray(b)) ? merge(b, o) : o;
  }
  return out;
}

export async function getSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return merge(DEFAULTS, settings || {});
}

export async function setSettings(patch) {
  const cur = await getSettings();
  const next = merge(cur, patch);
  if (patch.stamp) next.stamp = merge(cur.stamp, patch.stamp);
  await chrome.storage.sync.set({ settings: next });
  return next;
}
