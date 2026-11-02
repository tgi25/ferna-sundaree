// Sinhala text repair and language helpers.
//
// Text extracted from Sinhala PDFs is often damaged:
//  * visual order — the kombuva (ෙ / ෛ) is drawn before its consonant, and many PDF writers
//    (XeLaTeX/xdvipdfmx, MS Word with some fonts, printer drivers) store it first: "ෙක" instead of "කෙ";
//  * a zero-width joiner in front of the al-lakuna ("ක‍්" instead of "ක්");
//  * glyphs without a Unicode mapping (rakaransaya, touching letters) come out as control characters.
// fixSinhala() repairs these so that selection, copy, search and the AI see real Sinhala words.

export const SI_RE = /[඀-෿]/;
const CONS = 'ක-ෆ';                       // consonants ක … ෆ
const PREBASE = /[ෙෛ]/;                    // ෙ  ෛ  (drawn to the left of the consonant)
const CONS_RE = new RegExp(`[${CONS}]`);

export const hasSinhala = (s) => SI_RE.test(s);

// Is the text on this page stored in visual order? Count kombuvas that cannot occur in logical order
// (not preceded by a consonant or a joiner/al-lakuna of a conjunct).
export function detectVisualOrder(text) {
  let bad = 0, total = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c !== 'ෙ' && c !== 'ෛ') continue;
    total++;
    const p = i > 0 ? text[i - 1] : ' ';
    // in logical order a kombuva always follows a consonant; followed by a consonant → it was written first
    if (!CONS_RE.test(p) && CONS_RE.test(text[i + 1] || '')) bad++;
  }
  return bad >= 1 && bad >= total * 0.1 ? 'visual' : 'logical';
}

// Move each prebase vowel sign behind the consonant cluster it belongs to (visual → logical order).
function reorder(s) {
  const chars = [...s];
  const out = [];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (PREBASE.test(c) && CONS_RE.test(chars[i + 1] || '')) {
      // cluster: C ( ් ZWJ C )*  — touching conjuncts, rakaransaya, yansaya (ක්‍ෂ, ප්‍ර, ද්‍ය).
      // A joiner *before* the al-lakuna ("‍්") is the al-lakuna of ේ / ෝ or a visible hal, not a conjunct.
      let j = i + 1;
      const cl = [chars[j++]];
      while (chars[j] === '\u0DCA' && chars[j + 1] === '\u200D' && CONS_RE.test(chars[j + 2] || '')) { cl.push(chars[j], chars[j + 1], chars[j + 2]); j += 3; }
      out.push(...cl, c);
      i = j - 1;
      continue;
    }
    out.push(c);
  }
  return out.join('');
}

// Repair one string. mode: 'visual' | 'logical' | undefined (auto-detect on this string only)
export function fixSinhala(s, mode) {
  if (!s || !SI_RE.test(s)) return s;
  // glyphs without Unicode mapping: after a consonant it is almost always the rakaransaya (්‍ර)
  // (it may be read after the consonant's vowel sign, and a misplaced space may sit in between)
  s = s.replace(new RegExp(`([${CONS}])([\\u0DCF-\\u0DDF]?)(\\s?)(?:[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F\\uE000-\\uF8FF\\uFFFD]+|[\\u00A0-\\u00BF](?=[\\u0D85-\\u0DC6]))`, 'g'), '$1\u0DCA\u200D\u0DBB$2$3');
  s = s.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\uE000-\uF8FF\uFFFD]/g, '');
  if ((mode || detectVisualOrder(s)) === 'visual') s = reorder(s);
  // joiner in front of the al-lakuna, doubled joiners, joiner at a word edge
  s = s.replace(/‍+(?=්)/g, '').replace(/‍{2,}/g, '‍')
    .replace(/(^|\s)‍/g, '$1').replace(/‍(?=\s|$)/g, '');
  // a kombuva followed by aela-pilla / al-lakuna / gayanukitta composes to one letter (NFC): ෙ+ා → ො
  return s.normalize('NFC');
}

// ---------------------------------------------------------------- search / retrieval helpers
// Canonical form used for matching: NFC, no joiners.
export const siNorm = (s) => s.normalize('NFC').replace(/[‌‍]/g, '');

// Common Sinhala function words (particles, auxiliaries, pronouns, postpositions)
export const SI_STOP = new Set(('සහ හා ද ය යි වේ ඇත ඇති නැත නැති මෙම එම මේ ඒ ඔය අර මෙය එය ඒවා මේවා සඳහා විසින් නිසා අතර හෝ නමුත් ' +
  'බව ලෙස පමණක් වැනි කර කරන කළ කිරීම කරනු කරයි කරන ලද ලැබේ ලබයි වන වූ වෙයි වෙනවා තුළ තුල සිට දක්වා මගින් යනු හැකි හැකිය ' +
  'නො ඔවුන් ඔහු ඇය අප අපි ඔබ මම එක යම් සියලු සෑම දී ට ගේ ගෙන් වල වලට වලින් කෙරේ කෙරෙන පිළිබඳ පිළිබඳව සම්බන්ධයෙන් ' +
  'විට විටෙක ඉතා වඩා වඩාත් තවත් තව නම් නැතහොත් එනම් එබැවින් එහෙත් එසේ මෙසේ ලද දැක්වේ දක්වයි අනුව මත යටතේ ' +
  'පසු පෙර සමග සමඟ සමඟින් ඇතුළු ආදී ආදිය').split(/\s+/).map(siNorm));

// Light suffix stripping so that ඉගෙනුම / ඉගෙනුමේදී / ඉගෙනුම් match each other.
const SI_SUFFIX = ['යන්ගේ', 'වලින්', 'යන්ට', 'යෙන්', 'යේදී', 'යකට', 'යකි', 'යක්', 'යන්', 'ගෙන්', 'වලට', 'යට', 'යේ', 'වල', 'ගේ', 'දී', 'ට', 'යි', 'ය', 'ක්', 'කි', 'ේ', '්', 'ෙන්']
  .map(siNorm).sort((a, b) => b.length - a.length);
export function siStem(w) {
  for (let pass = 0; pass < 2; pass++) {
    const suf = SI_SUFFIX.find((x) => w.endsWith(x) && w.length - x.length >= 3);
    if (!suf) break;
    w = w.slice(0, -suf.length);
  }
  return w;
}

// Sentence splitting that works for Sinhala as well as English (Sinhala uses the full stop too;
// the next sentence begins with any letter, not only a capital).
export function splitSentences(text) {
  return text.split(/(?<=[.!?។॥])\s+(?=[\p{Lu}\p{N}඀-෿"“‘(])/u).map((s) => s.trim()).filter(Boolean);
}

// Share of Sinhala letters among all letters (0‥1)
export function sinhalaShare(text) {
  let si = 0, all = 0;
  for (const m of text.matchAll(/\p{L}/gu)) { all++; if (SI_RE.test(m[0])) si++; }
  return all ? si / all : 0;
}
