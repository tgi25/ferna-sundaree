// Ferna Equalizer — presets and checks shared by the pop-up and the background (from Ferna Sundaree).
export const BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const PRESETS = {
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
export const AUTO_GENRES = ['pop', 'rock', 'classical', 'jazz', 'electronic', 'hiphop', 'acoustic', 'speech',
  'reggae', 'dub', 'synthwave', 'bossanova', 'afrobeats', 'bhangra', 'ambient', 'baila', 'metal', 'blues', 'country', 'latin', 'kpop', 'lofi', 'indian', 'gospel'];
// Genres without their own sound model borrow half of a related genre's sound score; the page
// (title, description, YouTube genre) does most of the work for them.
export const FAMILY = { reggae: 'hiphop', dub: 'electronic', synthwave: 'electronic', bossanova: 'jazz', afrobeats: 'hiphop', bhangra: 'pop', ambient: 'classical',
  baila: 'pop', metal: 'rock', blues: 'jazz', country: 'acoustic', latin: 'pop', kpop: 'pop', lofi: 'hiphop', indian: 'acoustic', gospel: 'acoustic' };

export const KEYWORDS = {
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

/** Validate a stored EQ configuration. */
export function clean(c) {
  c = c && typeof c === 'object' ? c : {};
  const preset = c.preset in PRESETS || c.preset === 'custom' ? c.preset : 'flat';
  const gains = Array.isArray(c.gains) && c.gains.length === BANDS.length ? c.gains.map(g => Math.max(-12, Math.min(12, Math.round(Number(g) * 2) / 2 || 0))) : BANDS.map(() => 0);
  const out = { enabled: !!c.enabled, auto: !!c.auto, preset, gains };
  if (preset === 'custom' && typeof c.customName === 'string' && c.customName.trim()) out.customName = c.customName.trim().slice(0, 40);
  return out;
}

/** Your saved presets: [{ id, name, gains }] (max 50). */
export function cleanUserPresets(list) {
  return (Array.isArray(list) ? list : []).filter(p => p && typeof p.name === 'string' && p.name.trim() && Array.isArray(p.gains) && p.gains.length === BANDS.length).slice(0, 50)
    .map(p => ({ id: typeof p.id === 'string' && /^u[\w-]{1,30}$/.test(p.id) ? p.id : `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: p.name.trim().slice(0, 40), gains: p.gains.map(g => Math.max(-12, Math.min(12, Math.round(Number(g) * 2) / 2 || 0))) }));
}

