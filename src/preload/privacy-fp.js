'use strict';
// Fingerprinting protection, in the spirit of Brave's "standard" mode: values that sites use to
// recognise your PC without cookies get small, per-site differences, so the same PC looks
// different to different sites and from one browser session to the next, while pages still
// work and look the same.
//   • canvas read-backs (toDataURL, toBlob, getImageData): a few pixels change by ±1 in one
//     colour channel (invisible), different per site;
//   • audio fingerprinting (OfflineAudioContext rendering): tiny noise in the rendered samples
//     (real playback is untouched);
//   • WebGL: graphics card vendor/renderer reported generically;
//   • CPU cores and memory reported in coarse buckets.
// The per-session secret comes from the browser through the environment (FERNA_FP_SEED), so no
// IPC is needed. Registered only while the setting is on. Runs in every frame.
const { contextBridge } = require('electron');
const seed = (typeof process !== 'undefined' && process.env && process.env.FERNA_FP_SEED) || 'ferna';
try { contextBridge.executeInMainWorld({ func: FP, args: [seed] }); } catch (e) { /* not available */ }

function FP(sessionSeed) {
  // The top-level site decides the noise, so embedded frames match their page.
  let site = location.hostname;
  try { if (location.ancestorOrigins && location.ancestorOrigins.length) site = new URL(location.ancestorOrigins[location.ancestorOrigins.length - 1]).hostname; } catch (e) { /* keep */ }
  site = site.split('.').slice(-2).join('.');
  let h = 2166136261;
  for (const ch of sessionSeed + '|' + site) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const rand = n => { let x = (h ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0; x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b) >>> 0; x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35) >>> 0; x ^= x >>> 16; return x >>> 0; };

  const hide = (obj, name, fn) => {
    const orig = obj[name];
    if (typeof orig !== 'function') return;
    const wrapped = { [name](...args) { return fn.call(this, orig, args); } }[name];
    try { Object.defineProperty(wrapped, 'toString', { value: () => `function ${name}() { [native code] }` }); } catch (e) { /* ignore */ }
    try { Object.defineProperty(obj, name, { value: wrapped, writable: true, configurable: true }); } catch (e) { /* ignore */ }
  };

  // ---- canvas ----
  function noisy(data, w) {
    // Change about one pixel in 400, deterministically for this site and position.
    for (let i = 0; i < data.length; i += 4) {
      const r = rand(i >> 2);
      if (r % 400 !== 0) continue;
      const c = (r >>> 9) % 3;
      const v = data[i + c];
      data[i + c] = v === 255 ? 254 : v === 0 ? 1 : v + ((r >>> 12) & 1 ? 1 : -1);
    }
    return data;
  }
  const C2D = window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype;
  if (C2D) hide(C2D, 'getImageData', function (orig, args) { const img = orig.apply(this, args); noisy(img.data, img.width); return img; });
  const HCE = window.HTMLCanvasElement && HTMLCanvasElement.prototype;
  function noisyCopy(canvas) {
    if (!canvas.width || !canvas.height || canvas.width * canvas.height > 4096 * 4096) return null;
    let src = null;
    try { src = canvas.getContext('2d'); } catch (e) { src = null; }
    const copy = document.createElement('canvas');
    copy.width = canvas.width; copy.height = canvas.height;
    const ctx = copy.getContext('2d');
    ctx.drawImage(canvas, 0, 0);
    const img = C2D ? C2D.getImageData.call(ctx, 0, 0, copy.width, copy.height) : null; // already noised
    if (img) ctx.putImageData(img, 0, 0);
    return copy;
  }
  if (HCE) {
    hide(HCE, 'toDataURL', function (orig, args) { const c = noisyCopy(this); return orig.apply(c || this, args); });
    hide(HCE, 'toBlob', function (orig, args) { const c = noisyCopy(this); return orig.apply(c || this, args); });
  }

  // ---- audio (offline rendering only) ----
  const OAC = window.OfflineAudioContext && OfflineAudioContext.prototype;
  if (OAC) hide(OAC, 'startRendering', function (orig, args) {
    return orig.apply(this, args).then(buf => {
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < d.length; i += 97) d[i] += ((rand(i + ch * 7919) % 2001) - 1000) * 1e-10;
      }
      return buf;
    });
  });

  // ---- WebGL ----
  for (const G of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!G) continue;
    hide(G.prototype, 'getParameter', function (orig, args) {
      if (args[0] === 0x9245) return 'Google Inc.';                // UNMASKED_VENDOR_WEBGL
      if (args[0] === 0x9246) return 'ANGLE (Generic GPU Direct3D11)'; // UNMASKED_RENDERER_WEBGL
      return orig.apply(this, args);
    });
  }

  // ---- hardware ----
  try {
    const cores = navigator.hardwareConcurrency;
    Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => (cores <= 4 ? 4 : 8), configurable: true });
    Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 8, configurable: true });
  } catch (e) { /* ignore */ }
}
