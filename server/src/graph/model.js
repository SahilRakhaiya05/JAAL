// Graph schema shared by the memory engine and the TigerGraph adapter.
// Mirrors jaal/tigergraph schema 1:1: vertex primary id = canonical key "type:value".
import extractLib from '../../../shared/extract.js';

export const { extract, triage, canonicalKey, normPhone, normUrl, registrable, TYPES } = extractLib;

export const V = Object.freeze({
  Report: 'Report',
  Reporter: 'Reporter',
  Phone: 'Phone',
  UpiHandle: 'UpiHandle',
  BankAccount: 'BankAccount',
  Url: 'Url',
  Domain: 'Domain',
  ApkHash: 'ApkHash',
  CryptoAddress: 'CryptoAddress',
  MessageText: 'MessageText',
  ScamPattern: 'ScamPattern',
  Campaign: 'Campaign'
});

export const E = Object.freeze({
  REPORTED: 'REPORTED', // Reporter -> Report
  MENTIONS: 'MENTIONS', // Report -> identifier
  MATCHES_PATTERN: 'MATCHES_PATTERN', // Report -> ScamPattern (script family, remote-access app)
  PAYS_TO: 'PAYS_TO', // Phone|UpiHandle -> BankAccount|UpiHandle|CryptoAddress
  RESOLVES_TO: 'RESOLVES_TO', // Url -> Domain
  HOSTED_ON: 'HOSTED_ON', // ApkHash -> Domain
  SAME_TEXT_AS: 'SAME_TEXT_AS', // Report -> MessageText (the redacted script it normalises to)
  SIMILAR_SCRIPT: 'SIMILAR_SCRIPT', // MessageText <-> MessageText (vector cosine >= 0.8)
  NEXT: 'NEXT', // Report -> Report (temporal order inside a campaign)
  IN_CAMPAIGN: 'IN_CAMPAIGN' // identifier -> Campaign
});

/** Identifier type (shared/extract.js) -> vertex type. ifsc is kept as a BankAccount attribute. */
export const VERTEX_OF = Object.freeze({
  phone: V.Phone,
  upi: V.UpiHandle,
  bank_account: V.BankAccount,
  url: V.Url,
  domain: V.Domain,
  apk: V.ApkHash,
  crypto: V.CryptoAddress,
  remote_app: V.ScamPattern
});

export const IDENTIFIER_VERTICES = new Set([V.Phone, V.UpiHandle, V.BankAccount, V.Url, V.Domain, V.ApkHash, V.CryptoAddress]);
export const PAYABLE = new Set([V.UpiHandle, V.BankAccount, V.CryptoAddress]);

/** Edges that are facts (same message, same payout), as opposed to similarity guesses. */
export const DETERMINISTIC = new Set([E.MENTIONS, E.PAYS_TO, E.RESOLVES_TO, E.HOSTED_ON, E.SAME_TEXT_AS]);

/**
 * Identifiers that appear in legitimate and scam messages alike. Edges through them
 * would weld unrelated rings into one blob, so clustering and BFS never expand them.
 */
export const HUB_DOMAINS = new Set([
  'whatsapp.com', 'wa.me', 'google.com', 'goo.gl', 'youtube.com', 'youtu.be', 'facebook.com', 'instagram.com',
  't.me', 'telegram.org', 'telegram.me', 'bit.ly', 'tinyurl.com', 'gmail.com', 'linktr.ee', 'x.com', 'twitter.com',
  'razorpay.com', 'rzp.io', 'cashfree.com', 'payu.in', 'phonepe.com', 'paytm.com', 'paytm.me', 'gpay.app',
  'play.google.com', 'apple.com', 'microsoft.com', 'amazon.in', 'flipkart.com', 'drive.google.com', 'forms.gle'
]);
export const HUB_DEGREE_CAP = 250;

/** Free hosting platforms: a phishing page on x.pages.dev must never mark pages.dev itself. */
export const SHARED_HOSTING = new Set([
  'pages.dev', 'workers.dev', 'netlify.app', 'vercel.app', 'web.app', 'firebaseapp.com', 'github.io', 'gitbook.io',
  'blogspot.com', 'weebly.com', 'wixsite.com', 'webflow.io', 'glitch.me', 'repl.co', 'herokuapp.com', 'onrender.com',
  'azurewebsites.net', 'amazonaws.com', 'cloudfront.net', 'appspot.com', 'square.site', 'sites.google.com', 'ngrok.io',
  'ngrok-free.app', 'r2.dev', 'ipfs.io', 'dweb.link', 'surge.sh', 'framer.app', 'myshopify.com', 'carrd.co', 'godaddysites.com'
]);

export const keyOf = (type, value) => canonicalKey(type, value);
export const typeOfKey = (key) => key.slice(0, key.indexOf(':'));
export const valueOfKey = (key) => key.slice(key.indexOf(':') + 1);

/** Normalise a client-supplied {type, value} pair the same way extract() would. */
export function normaliseIdentifier(type, value) {
  if (!TYPES.includes(type) || value == null) return null;
  let v = String(value).trim();
  if (!v) return null;
  switch (type) {
    case 'phone': v = normPhone(v); break;
    case 'upi': v = v.toLowerCase(); break;
    case 'bank_account': v = v.replace(/\D/g, ''); if (v.length < 9 || v.length > 18) return null; break;
    case 'ifsc': v = v.toUpperCase(); break;
    case 'url': v = normUrl(v)?.url ?? null; break;
    case 'domain': { const n = normUrl(v); v = n ? registrable(n.host) : null; break; }
    case 'apk': case 'remote_app': v = v.toLowerCase(); break;
    case 'crypto': if (/^(0x|bc1)/i.test(v)) v = v.toLowerCase(); break;
  }
  return v ? { type, value: v, key: keyOf(type, v) } : null;
}

/** Human label for ring nodes. Bank accounts are masked: mule accounts often belong to victims. */
export function labelOf(key) {
  const type = typeOfKey(key);
  const value = valueOfKey(key);
  if (type === 'phone' && value.startsWith('+91')) return `+91 ${value.slice(3, 8)} ${value.slice(8)}`;
  if (type === 'bank_account') return `A/c ••${value.slice(-4)}`;
  if (type === 'crypto' && value.length > 16) return `${value.slice(0, 6)}…${value.slice(-4)}`;
  if (type === 'text') return 'Message script';
  if (type === 'url' && value.length > 36) return value.replace(/^https?:\/\//, '').slice(0, 34) + '…';
  return value.replace(/^https?:\/\//, '');
}

/** Map a triage signal to the scam pattern it names. */
export const PATTERNS = Object.freeze({
  kyc: 'Fake KYC update',
  arrest: 'Digital arrest',
  parcel: 'Seized parcel',
  bill: 'Electricity disconnection',
  job: 'Task / part-time job',
  invest: 'Investment group',
  prize: 'Lottery / prize',
  refund: 'Refund / wrong transfer',
  screenshare: 'Screen-share bank support',
  apk: 'Malicious app install'
});
