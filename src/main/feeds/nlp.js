'use strict';
// The feed intelligence layer, all on this PC: tokenising (English and Sinhala), TF-IDF vectors,
// extractive summaries, category routing, topic tags, story clustering (de-duplication) and
// relevance scoring against your interests. No model download and no network: the vectors are
// sparse TF-IDF term vectors, compared by cosine similarity. (When an AI model is set up in the
// assistant, Ferna can also write abstractive summaries; see feeds/index.js.)

const STOP = new Set(`a about above after again against all am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves also says said say new one two three us may might must shall get got make made like many much well back even still way take year years time day days week weeks month months today yesterday tomorrow according per via mr mrs ms dr news report reports reported latest update updates read more full story article post appeared first`.split(/\s+/));
// Common Sinhala function words (and, the case endings written separately, "that", "this" …).
const STOP_SI = new Set('සහ හා ද ය යි ඇති විසින් මෙම එම ලෙස සඳහා වන කර බව නම් ගේ ට ක් තුළ ඇත නැත වූ වී සිට දක්වා පමණ තවත් අද ඊයේ හෙට මේ ඒ බවට කිරීම කළ කරන ලදී පවසයි පැවසීය එක් සියලු'.split(/\s+/));

function stem(w) {
  if (!/^[a-z]+$/.test(w) || w.length < 5) return w;
  return w.replace(/(ies)$/, 'y').replace(/(ing|edly|ed|ers|er|es|s)$/, '').replace(/(ation|ations)$/, 'ate');
}
/** Words of a text, lower-cased, without stop words; Sinhala and Tamil words are kept whole. */
function tokens(text) {
  const out = [];
  for (const raw of String(text || '').toLowerCase().normalize('NFC').match(/[\p{L}\p{M}][\p{L}\p{M}\p{N}\u200C\u200D'’-]*/gu) || []) {
    const w = raw.replace(/['’-]+$/g, '').replace(/^['’-]+/g, '');
    if (w.length < 2 || STOP.has(w) || STOP_SI.has(w)) continue;
    out.push(stem(w));
  }
  return out;
}

/** Sparse TF-IDF vector { term: weight } (unit length) from a title and body; titles count double. */
function vectorize(title, body, idf, maxTerms = 40) {
  const tf = new Map();
  const add = (t, w) => tf.set(t, (tf.get(t) || 0) + w);
  const tt = tokens(title);
  for (const t of tt) add(t, 2);
  for (let i = 0; i + 1 < tt.length; i++) add(`${tt[i]}_${tt[i + 1]}`, 1.5); // title phrases ("machine learning")
  for (const t of tokens(String(body || '').slice(0, 6000))) add(t, 1);
  const v = [];
  for (const [t, f] of tf) { const w = (1 + Math.log(f)) * (idf ? idf(t) : 1); if (w > 0) v.push([t, w]); }
  v.sort((a, b) => b[1] - a[1]);
  const top = v.slice(0, maxTerms);
  const norm = Math.sqrt(top.reduce((s, [, w]) => s + w * w, 0)) || 1;
  const out = {};
  for (const [t, w] of top) out[t] = +(w / norm).toFixed(4);
  return out;
}
function cosine(a, b) {
  if (!a || !b) return 0;
  let s = 0;
  const [x, y] = Object.keys(a).length < Object.keys(b).length ? [a, b] : [b, a];
  for (const t in x) if (y[t]) s += x[t] * y[t];
  return s;
}
/** Inverse document frequency from a set of documents (arrays of tokens), smoothed. */
function makeIdf(docs) {
  const df = new Map();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);
  const n = docs.length || 1;
  return t => Math.log(1 + (n + 1) / ((df.get(t) || 0) + 1));
}

// ---------- summaries ----------
const BOILER = /(cookies?|subscribe|newsletter|sign up|all rights reserved|click here|read more|appeared first on|the post .* appeared|follow us|share this|advertisement|©)/i;
function sentences(text) {
  return String(text || '').replace(/\s+/g, ' ')
    .split(/(?<=[.!?।])\s+(?=[\p{Lu}\p{Lo}"“‘(\d])/u)
    .map(s => s.trim()).filter(s => s.length >= 30 && s.length <= 600 && !BOILER.test(s));
}
/**
 * A 2–3 sentence summary picked from the text: sentences that share the most important words
 * of the article (and of its title), nearer the start counting a little more; kept in order.
 */
function summarize(title, text, n = 3, idf = null) {
  const sents = sentences(text).slice(0, 60);
  if (!sents.length) return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 320);
  if (sents.length <= n) return sents.join(' ');
  const freq = new Map();
  for (const s of sents) for (const t of tokens(s)) freq.set(t, (freq.get(t) || 0) + 1);
  const titleT = new Set(tokens(title));
  const scored = sents.map((s, i) => {
    const ts = tokens(s);
    if (!ts.length) return { i, s, score: 0 };
    let sc = 0;
    for (const t of new Set(ts)) sc += (freq.get(t) || 0) * (idf ? idf(t) : 1) + (titleT.has(t) ? 2 : 0);
    sc = sc / Math.sqrt(ts.length) * (1 + 0.6 / (1 + i));
    return { i, s, score: sc };
  });
  const pick = scored.slice().sort((a, b) => b.score - a.score).slice(0, n).sort((a, b) => a.i - b.i);
  let out = pick.map(p => p.s).join(' ');
  if (out.length > 520) out = `${out.slice(0, 517).replace(/\s+\S*$/, '')}…`;
  return out;
}

// ---------- categories and topics ----------
const CATEGORIES = ['local', 'global', 'research', 'tech'];
const CAT_LABEL = { local: 'Local', global: 'Global', research: 'Research & Academia', tech: 'Tech & AI' };
const RESEARCH_HOSTS = /(^|\.)(arxiv\.org|biorxiv\.org|medrxiv\.org|nature\.com|science\.org|sciencemag\.org|sciencedirect\.com|springer\.com|link\.springer\.com|ieee\.org|ieeexplore\.ieee\.org|acm\.org|plos\.org|pnas\.org|cell\.com|mdpi\.com|frontiersin\.org|ncbi\.nlm\.nih\.gov|pubmed|ssrn\.com|semanticscholar\.org|openreview\.net|aclanthology\.org|paperswithcode\.com|jmlr\.org|sciencedaily\.com|phys\.org|eurekalert\.org|wiley\.com|tandfonline\.com|sagepub\.com|researchgate\.net|scholar\.google)/i;
const TECH_HOSTS = /(^|\.)(techcrunch\.com|theverge\.com|wired\.com|arstechnica\.com|technologyreview\.com|venturebeat\.com|zdnet\.com|engadget\.com|hnrss\.org|ycombinator\.com|openai\.com|deepmind\.(com|google)|huggingface\.co|towardsdatascience\.com|kdnuggets\.com|analyticsvidhya\.com|thenextweb\.com|cnet\.com|tomshardware\.com|anandtech\.com|theregister\.com|infoq\.com|blog\.google|ai\.googleblog\.com|research\.google|developer\.nvidia\.com|stackoverflow\.blog|github\.blog|dev\.to|lwn\.net|slashdot\.org)/i;
const LOCAL_RE = /\b(sri\s*lanka|lankan?|colombo|kandy|galle|jaffna|matara|kurunegala|anuradhapura|batticaloa|trincomalee|negombo|ratnapura|badulla|nuwara eliya|cbsl|rupee|sjb|npp|slpp|jvp|parliament of sri lanka|uva|sabaragamuwa)\b|[඀-෿]{2,}/i;
const RESEARCH_RE = /\b(arxiv|preprint|peer[- ]reviewed|journal|doi:|doi\.org|abstract|we propose|our method|state[- ]of[- ]the[- ]art|experiments? show|dataset|benchmark|paper|study finds|researchers)\b/i;
const TECH_RE = /\b(artificial intelligence|machine learning|deep learning|neural networks?|large language models?|llms?|gpt|chatgpt|openai|anthropic|claude|gemini|transformer|generative ai|\bai\b|robotics?|software|startup|smartphone|apple|google|microsoft|nvidia|chips?|semiconductor|cybersecurity|cloud|programming|developer|open source|quantum computing)\b/i;

/** The stream a feed belongs to, guessed from its address and title (you can change it). */
function feedCategory(url, title = '', sample = '') {
  let host = '';
  try { host = new URL(url).hostname; } catch { /* keep '' */ }
  if (RESEARCH_HOSTS.test(host)) return 'research';
  if (TECH_HOSTS.test(host)) return 'tech';
  if (/\.lk$/i.test(host) || LOCAL_RE.test(`${title} ${host}`)) return 'local';
  const s = `${title} ${sample}`;
  if ((s.match(new RegExp(RESEARCH_RE.source, 'gi')) || []).length >= 3) return 'research';
  if ((s.match(new RegExp(TECH_RE.source, 'gi')) || []).length >= 4) return 'tech';
  return 'global';
}
/** An item's stream: its feed's, except that research papers and Sri Lankan stories in general feeds move to their own stream. */
function itemCategory(feedCat, item) {
  const s = `${item.title} ${String(item.text || '').slice(0, 1500)}`;
  if (feedCat === 'global' || feedCat === 'tech') {
    if (/arxiv\.org|doi\.org|biorxiv|medrxiv/i.test(item.link || '') || (s.match(new RegExp(RESEARCH_RE.source, 'gi')) || []).length >= 3) return 'research';
    if (feedCat === 'global' && LOCAL_RE.test(item.title || '')) return 'local';
    if (feedCat === 'global' && (s.match(new RegExp(TECH_RE.source, 'gi')) || []).length >= 3) return 'tech';
  }
  return feedCat;
}

const TOPICS = [
  ['AI', /\b(artificial intelligence|\bai\b|generative ai|chatgpt|openai|anthropic|llms?|large language models?|gemini|copilot|agents?)\b/i],
  ['Machine learning', /\b(machine learning|deep learning|neural networks?|reinforcement learning|transformers?|diffusion models?|training data|fine[- ]tun(e|ing)|classifier|gradient)\b/i],
  ['NLP', /\b(natural language|nlp|language models?|translation|speech recognition|text generation|sentiment|tokeni[sz]|sinhala nlp)\b/i],
  ['Computer vision', /\b(computer vision|image recognition|object detection|segmentation|vision models?)\b/i],
  ['Evolutionary computing', /\b(genetic algorithms?|evolutionary (algorithms?|computation|computing)|genetic programming|differential evolution)\b/i],
  ['Swarm intelligence', /\b(swarm intelligence|particle swarm|ant colony|pso\b|bee colony)\b/i],
  ['Quantum', /\b(quantum (computing|computer|algorithms?|information)|qubits?)\b/i],
  ['Bioinformatics', /\b(bioinformatics|genom(e|ics)|protein folding|sequencing|alphafold|gene expression)\b/i],
  ['Robotics', /\b(robots?|robotics|autonomous vehicles?|drones?)\b/i],
  ['Security', /\b(cyber ?security|hack(ers?|ed)|ransomware|malware|vulnerabilit(y|ies)|data breach|phishing|zero[- ]day)\b/i],
  ['Economy', /\b(economy|economic|inflation|gdp|imf|interest rates?|central bank|cbsl|rupee|budget|tax(es)?|exports?|imports?|stock market|cse)\b/i],
  ['Politics', /\b(election|president|prime minister|parliament|minister|cabinet|government|opposition|policy|vote)\b/i],
  ['Health', /\b(health|hospital|disease|vaccine|dengue|covid|medical|patients?|doctors?|cancer)\b/i],
  ['Climate & environment', /\b(climate|weather|floods?|drought|monsoon|cyclone|rain(fall)?|landslides?|emissions|renewable|environment)\b/i],
  ['Education', /\b(education|university|universities|students?|schools?|exams?|a\/l|o\/l|ugc|scholarships?)\b/i],
  ['Sport', /\b(cricket|football|rugby|olympics?|world cup|athletics|match|tournament)\b/i],
  ['Space', /\b(nasa|space|satellites?|rocket|mars|moon|telescope|astronom)\b/i],
  ['Business', /\b(compan(y|ies)|startup|ceo|profits?|revenue|merger|acquisition|investors?|market share)\b/i],
];
function topicTags(item, max = 4) {
  const s = `${item.title} ${item.title} ${String(item.text || '').slice(0, 3000)}`;
  const scored = [];
  for (const [name, re] of TOPICS) { const n = (s.match(new RegExp(re.source, 'gi')) || []).length; if (n) scored.push([name, n]); }
  return scored.sort((a, b) => b[1] - a[1]).slice(0, max).map(x => x[0]);
}

// ---------- clustering (same story from several sources) ----------
const normTitle = t => tokens(t).slice(0, 12).sort().join(' ');
const titleVecCache = new Map();
function titleVec(t) {
  const k = String(t || '');
  if (titleVecCache.has(k)) return titleVecCache.get(k);
  const ts = [...new Set(tokens(k))];
  const v = {}; for (const w of ts) v[w] = 1 / Math.sqrt(ts.length || 1);
  if (titleVecCache.size > 5000) titleVecCache.clear();
  titleVecCache.set(k, v);
  return v;
}
/**
 * Give each new item a cluster: the cluster of the most similar recent item (≥ threshold cosine
 * on TF-IDF vectors, or the same normalised title) within the time window; else its own.
 */
function assignClusters(newItems, recent, { threshold = 0.4, windowMs = 72 * 3600e3 } = {}) {
  const pool = recent.slice();
  for (const it of newItems) {
    let best = null, bestSim = 0;
    const nt = normTitle(it.title);
    const tv = titleVec(it.title);
    for (const r of pool) {
      if (r.id === it.id || Math.abs((r.date || r.added || 0) - (it.date || it.added || 0)) > windowMs) continue;
      // Whole-text similarity and headline similarity count equally: two reports of one event
      // share most headline words even when their bodies are written differently.
      const sim = nt && nt === normTitle(r.title) ? 1 : 0.5 * cosine(it.vec, r.vec) + 0.5 * cosine(tv, titleVec(r.title));
      if (sim > bestSim) { bestSim = sim; best = r; }
    }
    it.cluster = best && bestSim >= threshold ? (best.cluster || best.id) : it.id;
    it.clusterSim = best && bestSim >= threshold ? +bestSim.toFixed(3) : 0;
    pool.push(it);
  }
  return newItems;
}

// ---------- relevance ----------
/** A vector from your interests ("machine learning, Sri Lanka economy, NLP"). */
function interestVector(interests) {
  const v = {};
  for (const phrase of String(interests || '').split(/[,;\n]+/).map(s => s.trim()).filter(Boolean)) {
    const ts = tokens(phrase);
    for (const t of ts) v[t] = (v[t] || 0) + 1;
    for (let i = 0; i + 1 < ts.length; i++) v[`${ts[i]}_${ts[i + 1]}`] = (v[`${ts[i]}_${ts[i + 1]}`] || 0) + 1.5;
  }
  const norm = Math.sqrt(Object.values(v).reduce((s, w) => s + w * w, 0)) || 1;
  for (const k in v) v[k] /= norm;
  return v;
}
/** Fold an opened or saved item into what you read (decaying centroid of the top terms). */
function learn(profile, vec, rate = 0.15) {
  const out = {};
  for (const k in profile || {}) out[k] = profile[k] * (1 - rate);
  for (const k in vec || {}) out[k] = (out[k] || 0) + vec[k] * rate;
  const top = Object.entries(out).sort((a, b) => b[1] - a[1]).slice(0, 300);
  const norm = Math.sqrt(top.reduce((s, [, w]) => s + w * w, 0)) || 1;
  return Object.fromEntries(top.map(([k, w]) => [k, +(w / norm).toFixed(4)]));
}
/**
 * Compile your filter rules: one per line, "+word" to boost, "-word" to hide, "/regex/" (with a
 * leading + or -) for patterns; a bare word boosts.
 */
function compileRules(text) {
  const rules = [];
  for (const line of String(text || '').split(/\n+/).map(s => s.trim()).filter(Boolean).slice(0, 200)) {
    const sign = line[0] === '-' ? -1 : 1;
    const body = /^[+-]/.test(line) ? line.slice(1).trim() : line;
    let re = null;
    const m = /^\/(.+)\/([a-z]*)$/.exec(body);
    try { re = m ? new RegExp(m[1], m[2].replace(/[^imsu]/g, '') || 'i') : new RegExp(`\\b${body.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'); } catch { continue; }
    rules.push({ sign, re, text: line });
  }
  return rules;
}
/**
 * Relevance 0…1: similarity to your interests and to what you read, rule boosts, how many sources
 * cover the story and how fresh it is. Rule "-" hits mark it hidden.
 */
function relevance(item, { interests, learned, rules, clusterSize = 1, now = Date.now() }) {
  const s = `${item.title} ${String(item.summary || item.text || '').slice(0, 2000)}`;
  let hidden = false, ruleBoost = 0;
  for (const r of rules || []) if (r.re.test(s)) { if (r.sign < 0) hidden = true; else ruleBoost += 0.25; }
  const interest = cosine(item.vec, interests);
  const habit = cosine(item.vec, learned);
  const fresh = Math.exp(-Math.max(0, now - (item.date || item.added || now)) / (36 * 3600e3));
  const coverage = Math.min(1, (clusterSize - 1) / 4);
  let score = 0.45 * Math.min(1, interest * 2.2) + 0.25 * Math.min(1, habit * 2.2) + 0.15 * fresh + 0.15 * coverage + Math.min(0.5, ruleBoost);
  return { score: +Math.min(1, score).toFixed(3), hidden };
}

module.exports = { tokens, vectorize, cosine, makeIdf, summarize, sentences, feedCategory, itemCategory, topicTags, assignClusters, interestVector, learn, compileRules, relevance, CATEGORIES, CAT_LABEL, normTitle };
