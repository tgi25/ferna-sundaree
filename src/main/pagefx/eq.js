'use strict';
// Audio equalizer for page media (<video>, <audio>), built on the Web Audio API in an
// isolated world: media element → 10 filters (31 Hz … 16 kHz) → pre-gain → safety limiter
// → analyser → speakers.
//
// Auto-EQ picks a genre preset from two sources and blends them:
//   • the page: title, description, keywords and YouTube's genre/category metadata, matched
//     against keyword lists;
//   • the sound: features measured on the live signal every 100 ms over a rolling 8 s window
//     (band energy shares, spectral centroid, flatness, onset rate from spectral flux, and the
//     share of low-energy frames, a classic speech/music cue — Scheirer & Slaney, 1997),
//     scored by hand-set rules.
// It is a transparent rule-based classifier, not a trained model. A new genre must win two
// evaluations in a row (about 8 s apart) before the preset changes, and gains glide over
// ~0.4 s, so the sound does not jump around.
//
// Cross-origin media served without CORS would play silently through Web Audio, so such
// elements are left alone (counted as "skipped").

const WORLD = 7786;
const BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

const PRESETS = {
  flat:       { label: 'Flat',         gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  pop:        { label: 'Pop',          gains: [-1, 0, 1, 3, 4, 4, 2, 0, -1, -1] },
  rock:       { label: 'Rock',         gains: [5, 4, 3, 1, -1, -1, 1, 3, 4, 5] },
  classical:  { label: 'Classical',    gains: [3, 2, 1, 0, 0, 0, -1, -2, -2, -3] },
  jazz:       { label: 'Jazz',         gains: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3] },
  electronic: { label: 'Electronic',   gains: [6, 5, 2, 0, -2, 1, 0, 1, 4, 5] },
  hiphop:     { label: 'Hip-hop',      gains: [6, 5, 2, 3, -1, -1, 1, -1, 1, 2] },
  acoustic:   { label: 'Acoustic',     gains: [3, 3, 2, 1, 1, 1, 2, 3, 2, 1] },
  speech:     { label: 'Speech',       gains: [-4, -3, -1, 1, 3, 4, 4, 3, 1, -1] },
  bass:       { label: 'Bass Boost',   gains: [8, 7, 5, 3, 1, 0, 0, 0, 0, 0] },
  treble:     { label: 'Treble Boost', gains: [0, 0, 0, 0, 0, 1, 3, 5, 6, 7] },
  vocal:      { label: 'Vocal',        gains: [-2, -2, -1, 1, 3, 4, 3, 2, 0, -1] },
  // 0.6: more genres, including less common ones
  reggae:     { label: 'Reggae',       gains: [5, 5, 3, 0, -2, -1, 1, 2, 1, 0] },
  dub:        { label: 'Dub',          gains: [8, 7, 4, 1, -3, -3, -1, 1, 3, 2] },
  synthwave:  { label: 'Synthwave',    gains: [5, 4, 1, -1, -1, 1, 2, 3, 4, 4] },
  bossanova:  { label: 'Bossa Nova',   gains: [2, 2, 1, 2, 1, 0, 1, 2, 1, 0] },
  afrobeats:  { label: 'Afrobeats',    gains: [6, 5, 3, 1, 0, 1, 2, 2, 2, 1] },
  bhangra:    { label: 'Bhangra',      gains: [6, 5, 2, 0, 0, 2, 3, 3, 2, 1] },
  ambient:    { label: 'Ambient',      gains: [3, 2, 1, 0, -1, -2, -1, 1, 3, 4] },
  baila:      { label: 'Baila',        gains: [4, 3, 2, 1, 1, 2, 3, 2, 1, 0] },
  metal:      { label: 'Metal',        gains: [6, 5, 1, -2, -3, -1, 2, 4, 5, 4] },
  blues:      { label: 'Blues',        gains: [3, 2, 1, 2, 2, 1, 2, 1, 0, -1] },
  country:    { label: 'Country',      gains: [1, 1, 0, 1, 2, 3, 3, 3, 2, 1] },
  latin:      { label: 'Latin',        gains: [4, 3, 1, 0, 1, 2, 3, 3, 2, 1] },
  kpop:       { label: 'K-pop',        gains: [2, 3, 1, 1, 2, 3, 3, 2, 2, 2] },
  lofi:       { label: 'Lo-fi',        gains: [4, 3, 2, 1, 0, -1, -2, -3, -4, -5] },
  indian:     { label: 'Indian classical', gains: [2, 1, 0, 1, 2, 3, 3, 2, 1, 0] },
  gospel:     { label: 'Gospel',       gains: [2, 2, 1, 2, 3, 3, 2, 1, 1, 0] },
};
// Presets Auto-EQ may choose (the "effect" presets stay manual).
const AUTO_GENRES = ['pop', 'rock', 'classical', 'jazz', 'electronic', 'hiphop', 'acoustic', 'speech',
  'reggae', 'dub', 'synthwave', 'bossanova', 'afrobeats', 'bhangra', 'ambient', 'baila', 'metal', 'blues', 'country', 'latin', 'kpop', 'lofi', 'indian', 'gospel'];
// Genres without their own sound model borrow half of a related genre's sound score; the page
// (title, description, YouTube genre) does most of the work for them.
const FAMILY = { reggae: 'hiphop', dub: 'electronic', synthwave: 'electronic', bossanova: 'jazz', afrobeats: 'hiphop', bhangra: 'pop', ambient: 'classical',
  baila: 'pop', metal: 'rock', blues: 'jazz', country: 'acoustic', latin: 'pop', kpop: 'pop', lofi: 'hiphop', indian: 'acoustic', gospel: 'acoustic' };

const KEYWORDS = {
  speech: ['podcast', 'lecture', 'interview', 'talk', 'news', 'tutorial', 'webinar', 'audiobook', 'sermon', 'documentary', 'explained', 'how to', 'course', 'lesson', 'debate', 'speech', 'keynote', 'conference', 'q&a', 'review', 'unboxing', 'vlog', 'comedy', 'stand-up', 'education', 'news & politics', 'science & technology', 'howto & style'],
  classical: ['symphony', 'concerto', 'sonata', 'orchestra', 'orchestral', 'philharmonic', 'quartet', 'mozart', 'beethoven', 'bach', 'chopin', 'vivaldi', 'tchaikovsky', 'brahms', 'debussy', 'handel', 'haydn', 'schubert', 'opera', 'aria', 'nocturne', 'etude', 'classical'],
  rock: ['rock', 'punk', 'grunge', 'hard rock', 'guitar solo', 'alt-rock', 'indie rock', 'live at wembley'],
  electronic: ['edm', 'techno', 'house music', 'deep house', 'trance', 'dubstep', 'drum and bass', 'dnb', 'electro', 'electronic', 'remix', 'dj set', 'rave'],
  hiphop: ['hip hop', 'hip-hop', 'rap', 'trap', 'drill', 'r&b', 'rnb', 'freestyle'],
  jazz: ['jazz', 'swing', 'bebop', 'saxophone', 'big band', 'smooth jazz'],
  acoustic: ['acoustic', 'unplugged', 'folk', 'singer-songwriter', 'fingerstyle', 'ballad'],
  pop: ['pop', 'j-pop', 'official music video', 'official video', 'lyrics', 'top hits', 'chart', 'music'],
  reggae: ['reggae', 'roots reggae', 'dancehall', 'ska', 'rocksteady', 'bob marley'],
  dub: ['dub', 'dub reggae', 'steppers', 'king tubby', 'lee scratch perry'],
  synthwave: ['synthwave', 'retrowave', 'outrun', 'darksynth', 'vaporwave', 'chillwave'],
  bossanova: ['bossa nova', 'bossa', 'samba', 'mpb', 'joao gilberto', 'jobim'],
  afrobeats: ['afrobeats', 'afrobeat', 'amapiano', 'afropop', 'burna boy', 'wizkid', 'highlife'],
  bhangra: ['bhangra', 'punjabi', 'dhol', 'giddha'],
  ambient: ['ambient', 'drone', 'meditation music', 'sleep music', 'soundscape', 'new age', 'relaxing music', 'brian eno'],
  baila: ['baila', 'sinhala songs', 'kaffringha', 'chorus baila', 'papare'],
  metal: ['metal', 'heavy metal', 'death metal', 'black metal', 'thrash', 'metalcore', 'doom metal'],
  blues: ['blues', 'delta blues', 'chicago blues', 'b.b. king', '12-bar'],
  country: ['country', 'bluegrass', 'americana', 'honky tonk', 'nashville'],
  latin: ['latin', 'salsa', 'reggaeton', 'bachata', 'cumbia', 'merengue', 'tango', 'flamenco'],
  kpop: ['k-pop', 'kpop', 'bts', 'blackpink', 'twice', 'stray kids'],
  lofi: ['lofi', 'lo-fi', 'beats to study', 'beats to relax', 'chillhop', 'study beats'],
  indian: ['raga', 'hindustani', 'carnatic', 'sitar', 'tabla', 'bharatanatyam', 'veena'],
  gospel: ['gospel', 'worship', 'hymn', 'choir', 'praise'],
};

const SCRIPT = String.raw`(() => {
  if (window.__fernaEQ) return;
  const BANDS = ${JSON.stringify(BANDS)};
  const PRESETS = ${JSON.stringify(PRESETS)};
  const AUTO = ${JSON.stringify(AUTO_GENRES)};
  const FAMILY = ${JSON.stringify(FAMILY)};
  const KEYWORDS = ${JSON.stringify(KEYWORDS)};
  const st = { enabled: false, auto: false, preset: 'flat', gains: BANDS.map(() => 0), attached: 0, skipped: 0,
    genre: null, confidence: 0, reason: '', applied: 'flat', candidate: null, candidateHits: 0 };
  let ctx = null, input, filters, pre, limiter, analyser, freqBuf, timer = 0;
  const seen = new WeakSet();

  function chain() {
    if (ctx) return true;
    try { ctx = new AudioContext({ latencyHint: 'playback' }); } catch (e) { return false; }
    input = ctx.createGain();
    filters = BANDS.map((f, i) => {
      const b = ctx.createBiquadFilter();
      b.type = i === 0 ? 'lowshelf' : i === BANDS.length - 1 ? 'highshelf' : 'peaking';
      b.frequency.value = f; b.Q.value = 1.41; b.gain.value = 0;
      return b;
    });
    pre = ctx.createGain();
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.003; limiter.release.value = 0.25;
    analyser = ctx.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0;
    freqBuf = new Float32Array(analyser.frequencyBinCount);
    input.connect(filters[0]);
    for (let i = 0; i < filters.length - 1; i++) filters[i].connect(filters[i + 1]);
    filters[filters.length - 1].connect(pre); pre.connect(limiter); limiter.connect(analyser); analyser.connect(ctx.destination);
    return true;
  }

  function sameOriginMedia(m) {
    const src = m.currentSrc || m.src || '';
    if (!src || /^(blob|data|mediastream):/i.test(src)) return true;
    try { return new URL(src, location.href).origin === location.origin || m.crossOrigin !== null; } catch (e) { return false; }
  }
  function attach(m) {
    if (!st.enabled || seen.has(m)) return;
    if (!sameOriginMedia(m)) { if (!m.__fernaEqSkip) { m.__fernaEqSkip = 1; st.skipped++; } return; }
    if (!chain()) return;
    try { ctx.createMediaElementSource(m).connect(input); seen.add(m); st.attached++; } catch (e) { /* already routed elsewhere */ }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }
  function scan() { document.querySelectorAll('video, audio').forEach(attach); }

  const db = g => Math.max(-12, Math.min(12, Number(g) || 0));
  function setGains(gains) {
    if (!ctx) return;
    const t = ctx.currentTime;
    gains.forEach((g, i) => filters[i].gain.setTargetAtTime(db(g), t, 0.12));
    const peak = Math.max(0, ...gains.map(db));
    pre.gain.setTargetAtTime(Math.pow(10, (-peak * 0.6) / 20), t, 0.12); // headroom for boosts
  }
  function currentGains() {
    if (!st.enabled) return BANDS.map(() => 0);
    if (st.auto) return PRESETS[st.applied].gains;
    return st.preset === 'custom' ? st.gains : (PRESETS[st.preset] || PRESETS.flat).gains;
  }
  function refresh() {
    setGains(currentGains());
    if (limiter) limiter.threshold.value = st.enabled ? -1 : 0;
  }

  // ---------- Auto-EQ ----------
  function pageText() {
    const meta = n => { const e = document.querySelector('meta[name="' + n + '"],meta[property="' + n + '"],meta[itemprop="' + n + '"]'); return e ? e.content || '' : ''; };
    return [document.title, meta('og:title'), meta('description'), meta('og:description'), meta('keywords'), meta('genre'),
      (document.querySelector('#title h1, h1.ytd-watch-metadata') || {}).textContent || ''].join(' | ').toLowerCase();
  }
  function metaScores() {
    const text = pageText();
    const out = {}; const why = {};
    for (const [g, words] of Object.entries(KEYWORDS)) {
      for (const w of words) {
        const re = new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^$()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)', 'i');
        if (re.test(text)) { out[g] = (out[g] || 0) + (w.length > 5 ? 1 : 0.6); (why[g] = why[g] || []).push(w); }
      }
    }
    // "music"/"official video" only says "some music": weak.
    if (out.pop && Object.keys(out).length > 1) out.pop *= 0.4;
    return { out, why };
  }

  const frames = []; // rolling feature frames
  let prevSpec = null;
  function sample() {
    if (!analyser || !st.enabled || !st.auto) return;
    const media = [...document.querySelectorAll('video,audio')].some(m => seen.has(m) && !m.paused && !m.muted);
    if (!media) return;
    analyser.getFloatFrequencyData(freqBuf);
    const n = freqBuf.length, hz = ctx.sampleRate / 2 / n;
    let total = 0, sub = 0, low = 0, mid = 0, pres = 0, air = 0, cen = 0, logSum = 0, flux = 0;
    const mag = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      const p = Math.pow(10, freqBuf[i] / 10); // power
      mag[i] = p;
      const f = i * hz;
      total += p; cen += p * f; logSum += Math.log(p + 1e-12);
      if (f < 120) sub += p; else if (f < 500) low += p; else if (f < 2000) mid += p; else if (f < 6000) pres += p; else air += p;
      if (prevSpec) { const d = Math.sqrt(p) - Math.sqrt(prevSpec[i]); if (d > 0) flux += d; }
    }
    prevSpec = mag;
    if (total < 1e-9) { frames.push({ silent: true }); }
    else {
      const flat = Math.exp(logSum / (n - 1)) / (total / (n - 1));
      frames.push({ e: total, sub: sub / total, low: low / total, mid: mid / total, pres: pres / total, air: air / total, cen: cen / total, flat, flux });
    }
    if (frames.length > 80) frames.shift(); // 8 s at 10 Hz
  }

  function audioScores() {
    const f = frames.filter(x => !x.silent);
    if (f.length < 30) return null;
    const avg = k => f.reduce((a, x) => a + x[k], 0) / f.length;
    const energies = f.map(x => x.e).sort((a, b) => a - b);
    const meanE = energies.reduce((a, b) => a + b, 0) / energies.length;
    const lowEnergy = f.filter(x => x.e < 0.5 * meanE).length / f.length;           // speech: pauses between words
    const fluxes = f.map(x => x.flux); const mf = fluxes.reduce((a, b) => a + b, 0) / fluxes.length;
    let onsets = 0; for (let i = 1; i < fluxes.length - 1; i++) if (fluxes[i] > 1.6 * mf && fluxes[i] >= fluxes[i - 1] && fluxes[i] >= fluxes[i + 1]) onsets++;
    const onsetRate = onsets / (f.length / 10);                                        // per second
    const dyn = 10 * Math.log10((energies[Math.floor(energies.length * 0.95)] + 1e-12) / (energies[Math.floor(energies.length * 0.1)] + 1e-12));
    const F = { sub: avg('sub'), low: avg('low'), mid: avg('mid'), pres: avg('pres'), air: avg('air'), cen: avg('cen'), flat: avg('flat'), lowEnergy, onsetRate, dyn };
    const clamp = v => Math.max(0, Math.min(1, v));
    const s = {
      speech: clamp((F.lowEnergy - 0.2) * 3) * clamp((F.mid + F.pres - 0.35) * 2.5) * clamp(1 - F.sub * 2.5),
      electronic: clamp((F.sub - 0.18) * 4) * clamp(F.onsetRate / 3) * clamp(1 - F.lowEnergy * 2),
      hiphop: clamp((F.sub + F.low - 0.45) * 3) * clamp(F.onsetRate / 2.5) * clamp((0.35 - F.pres) * 4),
      rock: clamp((F.pres + F.air - 0.18) * 4) * clamp(F.flat * 6) * clamp(F.onsetRate / 3),
      classical: clamp((F.dyn - 12) / 12) * clamp((2.2 - F.onsetRate) / 2.2) * clamp((0.25 - F.sub) * 6),
      jazz: clamp((F.low + F.mid - 0.45) * 2.5) * clamp((3 - F.onsetRate) / 3) * clamp((F.dyn - 8) / 10),
      acoustic: clamp((F.mid - 0.25) * 3) * clamp((0.2 - F.sub) * 6) * clamp((F.dyn - 6) / 10),
      pop: 0.25 + 0.25 * clamp(F.onsetRate / 3) * clamp((F.mid + F.pres - 0.3) * 3),
    };
    return { s, F };
  }

  function evaluate() {
    if (!st.enabled || !st.auto) return;
    const m = metaScores();
    const a = audioScores();
    const total = {};
    const mMax = Math.max(0, ...Object.values(m.out));
    for (const g of AUTO) {
      const ms = mMax ? (m.out[g] || 0) / mMax : 0;
      const as = a ? (a.s[g] !== undefined ? a.s[g] : 0.5 * (a.s[FAMILY[g]] || 0)) : 0;
      total[g] = (mMax ? 0.6 : 0) * ms + (a ? (mMax ? 0.4 : 1) : 0) * as;
    }
    const ranked = Object.entries(total).sort((x, y) => y[1] - x[1]);
    const [best, score] = ranked[0];
    const second = ranked[1] ? ranked[1][1] : 0;
    if (!score) { st.reason = a ? 'listening…' : 'waiting for sound'; return; }
    st.genre = best;
    st.confidence = Math.round(100 * Math.min(1, score * (score - second > 0.15 ? 1 : 0.7)));
    const reasons = [];
    if (m.why[best]) reasons.push('page mentions “' + m.why[best].slice(0, 2).join('”, “') + '”');
    if (a && a.s[best] < 0.2) reasons.push('sound gives no strong cue');
    else if (a) {
      const F = a.F;
      if (best === 'speech') reasons.push(Math.round(F.lowEnergy * 100) + '% pauses, voice-band energy');
      else if (best === 'electronic' || best === 'hiphop') reasons.push('strong bass (' + Math.round((F.sub + F.low) * 100) + '%), ' + F.onsetRate.toFixed(1) + ' beats/s');
      else if (best === 'classical') reasons.push('wide dynamics (' + Math.round(F.dyn) + ' dB), few sharp onsets');
      else if (best === 'rock') reasons.push('bright, dense spectrum, ' + F.onsetRate.toFixed(1) + ' onsets/s');
      else reasons.push('balanced spectrum');
    }
    st.reason = reasons.join('; ');
    if (best === st.applied) { st.candidate = null; st.candidateHits = 0; return; }
    if (st.candidate === best) st.candidateHits++; else { st.candidate = best; st.candidateHits = 1; }
    if (st.candidateHits >= 2 || st.applied === 'flat') { st.applied = best; st.candidate = null; st.candidateHits = 0; refresh(); }
  }

  function loop() {
    clearInterval(timer);
    if (!st.enabled || !st.auto) return;
    let n = 0;
    timer = setInterval(() => { sample(); if (++n % 40 === 0) evaluate(); }, 100); // evaluate every 4 s
    setTimeout(evaluate, 1500);
  }

  document.addEventListener('play', e => { if (e.target && /^(VIDEO|AUDIO)$/.test(e.target.tagName)) attach(e.target); }, true);
  new MutationObserver(() => { if (st.enabled) scan(); }).observe(document.documentElement, { childList: true, subtree: true });

  window.__fernaEQ = {
    config(c) {
      const wasAuto = st.enabled && st.auto;
      st.enabled = !!c.enabled; st.auto = !!c.auto; st.preset = c.preset in PRESETS || c.preset === 'custom' ? c.preset : 'flat';
      if (Array.isArray(c.gains) && c.gains.length === BANDS.length) st.gains = c.gains.map(db);
      if (st.enabled) scan();
      if (st.auto && !wasAuto) { st.applied = 'flat'; frames.length = 0; }
      refresh(); loop();
      return this.status();
    },
    status() {
      return { enabled: st.enabled, auto: st.auto, attached: st.attached, skipped: st.skipped, genre: st.genre,
        applied: st.applied, confidence: st.confidence, reason: st.reason, gains: currentGains(), running: !!ctx && ctx.state === 'running' };
    },
  };
})();`;

/** Inject (once per document) and configure; returns the page's EQ status. */
async function apply(wc, cfg) {
  if (!wc || wc.isDestroyed()) return null;
  await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: SCRIPT }]);
  return wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: `window.__fernaEQ.config(${JSON.stringify(cfg)})` }]);
}
async function status(wc) {
  if (!wc || wc.isDestroyed()) return null;
  return wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: 'window.__fernaEQ ? window.__fernaEQ.status() : null' }]);
}

/** Validate a stored EQ configuration. */
function clean(c) {
  c = c && typeof c === 'object' ? c : {};
  const preset = c.preset in PRESETS || c.preset === 'custom' ? c.preset : 'flat';
  const gains = Array.isArray(c.gains) && c.gains.length === BANDS.length ? c.gains.map(g => Math.max(-12, Math.min(12, Math.round(Number(g) * 2) / 2 || 0))) : BANDS.map(() => 0);
  const out = { enabled: !!c.enabled, auto: !!c.auto, preset, gains };
  if (preset === 'custom' && typeof c.customName === 'string' && c.customName.trim()) out.customName = c.customName.trim().slice(0, 40);
  return out;
}

/** Your saved presets: [{ id, name, gains }] (max 50). */
function cleanUserPresets(list) {
  return (Array.isArray(list) ? list : []).filter(p => p && typeof p.name === 'string' && p.name.trim() && Array.isArray(p.gains) && p.gains.length === BANDS.length).slice(0, 50)
    .map(p => ({ id: typeof p.id === 'string' && /^u[\w-]{1,30}$/.test(p.id) ? p.id : `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: p.name.trim().slice(0, 40), gains: p.gains.map(g => Math.max(-12, Math.min(12, Math.round(Number(g) * 2) / 2 || 0))) }));
}

module.exports = { WORLD, BANDS, PRESETS, AUTO_GENRES, FAMILY, KEYWORDS, SCRIPT, apply, status, clean, cleanUserPresets };
