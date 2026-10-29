// Optional Claude assist (ANTHROPIC_API_KEY). Two narrow jobs, never on the verdict's critical path:
//   1. polish(): rewrite the template reason in plainer words. Runs in the background; the
//      polished sentence is cached and served the next time the same reason is produced.
//   2. extractIdentifiers(): only when the regex extractor found nothing in a long, messy text
//      (e.g. "nine eight seven..." spelled out). Hard 1.5 s budget, then we move on without it.
// No key -> both are silent no-ops.
import { fetchWithTimeout } from '../util.js';

const MODEL = 'claude-haiku-5-5';
const TIMEOUT_MS = 1500;
const CACHE_LIMIT = 2000;

export class Llm {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.polished = new Map();
    this.inflight = new Set();
  }

  get mode() {
    return this.apiKey ? 'live' : 'off';
  }

  async #complete(system, user, maxTokens = 200) {
    const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] })
    }, TIMEOUT_MS);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.content?.map((c) => c.text || '').join('').trim() || '';
  }

  /** Cached polish if we have one; otherwise schedule one and return the template unchanged. */
  polish(reason, lang = 'en') {
    if (!this.apiKey || !reason) return reason;
    const key = `${lang}|${reason}`;
    if (this.polished.has(key)) return this.polished.get(key);
    if (!this.inflight.has(key)) {
      this.inflight.add(key);
      this.#complete(
        'Rewrite the sentence for a non-technical Indian reader in the same language. Keep every number, campaign id and identifier exactly. One sentence, under 30 words. Never use the words fraud or fraudster, never give orders. Reply with the sentence only.',
        reason
      )
        .then((text) => {
          if (text && !/fraud/i.test(text) && text.length < 300) {
            if (this.polished.size >= CACHE_LIMIT) this.polished.delete(this.polished.keys().next().value);
            this.polished.set(key, text);
          }
        })
        .catch(() => {})
        .finally(() => this.inflight.delete(key));
    }
    return reason;
  }

  /** Returns raw candidate strings ("+91 98...", "x@ybl", "http://..."), or [] on no key / timeout / error. */
  async extractIdentifiers(text) {
    if (!this.apiKey) return [];
    try {
      const out = await this.#complete(
        'Extract scammer-side identifiers from the message: phone numbers (convert spelled-out digits), UPI handles, bank account numbers with IFSC, URLs, app file names, crypto wallet addresses. Reply with one identifier per line, nothing else. Reply NONE if there are none.',
        String(text).slice(0, 2000),
        150
      );
      return out === 'NONE' ? [] : out.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 10);
    } catch {
      return [];
    }
  }
}
