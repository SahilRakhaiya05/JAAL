// Message text is stored only as a script: identifiers become placeholders and anything
// that could belong to the person who received it (names, amounts, account digits,
// emails, OTPs) is stripped before it ever reaches the graph.
import { extract } from './graph/model.js';

const PLACEHOLDER = { phone: '<PHONE>', upi: '<UPI>', bank_account: '<ACCOUNT>', ifsc: '<IFSC>', url: '<LINK>', domain: '<LINK>', apk: '<APP>', crypto: '<WALLET>' };

export function sanitizeText(text, maxLen = 600) {
  let t = String(text || '').normalize('NFKC');
  const ids = extract(t).filter((x) => PLACEHOLDER[x.type] && x.raw);
  // Longest raw spans first so "https://x.in/a" is replaced before "x.in".
  ids.sort((a, b) => b.raw.length - a.raw.length);
  // Extractor spans can swallow a trailing separator ("A/c 123 "); keep it so words do not fuse.
  for (const id of ids) t = t.split(id.raw).join(PLACEHOLDER[id.type] + (/\s$/.test(id.raw) ? ' ' : ''));
  return t
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<EMAIL>')
    .replace(/(?:₹|rs\.?|inr|rupees?)\s?[\d,]+(?:\.\d+)?|[\d,]+(?:\.\d+)?\s?(?:₹|rs\.?|inr|rupees?|\/-)/gi, '<AMOUNT>')
    .replace(/\b([Dd]ear|[Hh]i|[Hh]ello|[Nn]amaste|[Nn]amaskar|Mrs?\.?|Ms\.?|Shri|Smt\.?)\s+(?!Customer\b|Sir\b|Madam\b)[A-Z][a-z]+(\s+[A-Z][a-z]+)?/g, '$1 <NAME>')
    .replace(/(प्रिय|श्री|श्रीमती)\s+(?!ग्राहक|उपभोक्ता)\S+/g, '$1 <NAME>')
    .replace(/\d{4,}/g, '<NUM>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}
