// Text and domain similarity primitives used by script_similarity and lookalike_domain.

export const EMBED_DIMS = 256;

// FNV-1a: fast, stable across runtimes, good enough spread for feature hashing.
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Hashed bag-of-words + char-trigram embedding, 256 dims, L2 normalised.
 * Signed hashing (one bit picks +/-) keeps collisions from only ever adding up.
 * Language-agnostic, so Hinglish and Devanagari scripts embed the same way.
 */
export function embed(text) {
  const vec = new Float32Array(EMBED_DIMS);
  const t = String(text || '').toLowerCase().normalize('NFKC');
  const add = (feature, weight) => {
    const h = fnv1a(feature);
    vec[h % EMBED_DIMS] += (h & 0x80000000 ? -1 : 1) * weight;
  };
  const words = t.split(/[^\p{L}\p{N}<>]+/u).filter(Boolean);
  for (const w of words) add(`w:${w}`, 1);
  for (let i = 0; i + 1 < words.length; i++) add(`b:${words[i]} ${words[i + 1]}`, 0.7);
  const squashed = ` ${words.join(' ')} `;
  for (let i = 0; i + 3 <= squashed.length; i++) add(`c:${squashed.slice(i, i + 3)}`, 0.35);
  let norm = 0;
  for (const x of vec) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return Array.from(vec, (x) => Math.round((x / norm) * 1e4) / 1e4);
}

export function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // both vectors are unit length
}

export function shingles(s, n = 3) {
  const out = new Set();
  const t = String(s);
  if (t.length <= n) out.add(t);
  for (let i = 0; i + n <= t.length; i++) out.add(t.slice(i, i + n));
  return out;
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Optimal-string-alignment distance (Levenshtein + adjacent transposition, so "hdfcbnak"
 * is one edit from "hdfcbank"), with an early exit once it exceeds `max`.
 */
export function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

// Characters scammers swap in to pass a glance test. Applied before comparison.
// Cyrillic letters that render like Latin ones, then digit/letter-pair swaps.
const CYRILLIC = { 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j', 'ѕ': 's' };
const SWAPS = [[/rn/g, 'm'], [/vv/g, 'w'], [/0/g, 'o'], [/1/g, 'l'], [/3/g, 'e'], [/5/g, 's']];
export function deHomoglyph(s) {
  let t = s.normalize('NFKC').toLowerCase().replace(/[аеорсухіјѕ]/g, (c) => CYRILLIC[c]);
  for (const [re, rep] of SWAPS) t = t.replace(re, rep);
  return t;
}

/** The brand-bearing part of a domain: "sbi-kyc-update.xyz" -> "sbi-kyc-update", "onlinesbi.sbi" -> "onlinesbi". */
export function stem(domain) {
  return domain
    .toLowerCase()
    .replace(/\.(co|gov|org|net|ac|nic)\.in$/, '')
    .replace(/\.[a-z]{2,}$/, '');
}

/**
 * Brands Indian scams impersonate most (banks, payments, government, utilities, couriers).
 * `tokens` are the short names that appear inside lookalikes ("sbi" in sbi-kyc-update.xyz).
 */
export const BRANDS = [
  ['sbi.co.in', ['sbi', 'onlinesbi', 'yonosbi', 'yono']], ['onlinesbi.sbi', ['onlinesbi']], ['hdfcbank.com', ['hdfc', 'hdfcbank']],
  ['icicibank.com', ['icici', 'icicibank']], ['axisbank.com', ['axis', 'axisbank']], ['kotak.com', ['kotak']],
  ['pnbindia.in', ['pnb', 'pnbindia']], ['bankofbaroda.in', ['bankofbaroda', 'bob']], ['canarabank.com', ['canara', 'canarabank']],
  ['unionbankofindia.co.in', ['unionbank']], ['idfcfirstbank.com', ['idfc']], ['yesbank.in', ['yesbank']], ['indusind.com', ['indusind']],
  ['paytm.com', ['paytm']], ['phonepe.com', ['phonepe']], ['npci.org.in', ['npci', 'bhim']], ['rbi.org.in', ['rbi']],
  ['incometax.gov.in', ['incometax', 'itr']], ['uidai.gov.in', ['uidai', 'aadhaar', 'aadhar']], ['epfindia.gov.in', ['epfo', 'epf']],
  ['indiapost.gov.in', ['indiapost']], ['cybercrime.gov.in', ['cybercrime']], ['sancharsaathi.gov.in', ['sancharsaathi']],
  ['irctc.co.in', ['irctc']], ['tatapower.com', ['tatapower']], ['bsesdelhi.com', ['bses']], ['mahadiscom.in', ['mahadiscom', 'mahavitaran']],
  ['torrentpower.com', ['torrentpower']], ['amazon.in', ['amazon']], ['flipkart.com', ['flipkart']], ['jio.com', ['jio']],
  ['airtel.in', ['airtel']], ['bluedart.com', ['bluedart']], ['fedex.com', ['fedex']], ['dhl.com', ['dhl']],
  ['zerodha.com', ['zerodha']], ['groww.in', ['groww']], ['nseindia.com', ['nse', 'nseindia']], ['bseindia.com', ['bseindia']],
  ['sebi.gov.in', ['sebi']], ['lic.in', ['licindia']], ['whatsapp.com', ['whatsapp']], ['google.com', ['google']]
];
export const BRAND_DOMAINS = new Set(BRANDS.map(([d]) => d));

/**
 * Score how much `domain` imitates `target`. Returns { score, how } with score in 0..1.
 *  - token: a brand short name appears as a whole hyphen/dot token ("sbi-kyc-update")
 *  - homoglyph: identical after undoing look-alike characters ("hdfcbank" vs "hdfcbαnk")
 *  - edit1: one typo away ("icicibnak")
 *  - shingle: Jaccard on 3-shingles of the stems
 */
export function imitation(domain, target, tokens = []) {
  const a = stem(domain);
  const b = stem(target);
  if (domain === target) return { score: 0, how: 'same' };
  const parts = a.split(/[-.]/);
  const da = deHomoglyph(a);
  const db = deHomoglyph(b);
  let best = { score: jaccard(shingles(a), shingles(b)), how: 'shingle' };
  const consider = (score, how) => { if (score > best.score) best = { score, how }; };
  if (da === db) consider(0.97, 'homoglyph');
  else if (b.length >= 5 && editDistance(da, db, 1) === 1) consider(0.9, 'edit1');
  for (const tok of tokens) {
    if (tok.length >= 3 && parts.some((p) => deHomoglyph(p) === tok)) consider(parts.length > 1 ? 0.88 : 0.8, 'token');
    else if (tok.length >= 5 && da.includes(tok)) consider(0.8, 'token');
  }
  return best;
}
