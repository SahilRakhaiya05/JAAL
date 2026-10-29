// Non-graph application state: payments, guardian pairing, recent verdicts.
// Persisted to data/state.json (debounced). Device and guardian ids are client-side salted
// hashes, hashed again here with REPORTER_SALT.
import crypto from 'node:crypto';
import path from 'node:path';
import { JsonFile, saltedHash } from './util.js';

const PAIR_CODE_TTL_MS = 10 * 60_000;
const ALERTS_PER_GUARDIAN = 50;
const RECENT_VERDICTS = 1000;

export class AppState {
  constructor({ dataDir, persist = true, salt }) {
    this.salt = salt;
    this.file = new JsonFile(path.join(dataDir, 'state.json'), {}, { persist });
    const d = this.file.data;
    d.payments ||= {};
    d.webhookIds ||= [];
    d.guardian ||= { codes: {}, links: {}, alerts: {} };
    this.recent = new Map(); // verdictId -> verdict (memory only)
  }

  get data() {
    return this.file.data;
  }

  save() {
    this.file.save();
  }

  // ------------------------------------------------------------ payments

  get paying() {
    return Object.values(this.data.payments).filter((p) => p.status === 'paid').length;
  }

  /** Returns false if this webhook id was already processed (Standard Webhooks retries). */
  seenWebhook(id) {
    if (this.data.webhookIds.includes(id)) return true;
    this.data.webhookIds.push(id);
    if (this.data.webhookIds.length > 1000) this.data.webhookIds.shift();
    return false;
  }

  setPayment(userId, entry) {
    this.data.payments[userId] = { ...this.data.payments[userId], ...entry, updatedAt: new Date().toISOString() };
    this.save();
  }

  // ------------------------------------------------------------ verdict cache (for guardian fan-out)

  remember(verdict) {
    this.recent.set(verdict.id, verdict);
    if (this.recent.size > RECENT_VERDICTS) this.recent.delete(this.recent.keys().next().value);
  }

  // ------------------------------------------------------------ guardian pairing

  #h(x) {
    return saltedHash(this.salt, `guardian:${x}`);
  }

  pair(deviceHash) {
    const g = this.data.guardian;
    const now = Date.now();
    for (const [code, c] of Object.entries(g.codes)) if (c.expires < now) delete g.codes[code];
    let code;
    do code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    while (g.codes[code]);
    g.codes[code] = { device: this.#h(deviceHash), expires: now + PAIR_CODE_TTL_MS };
    this.save();
    return { code, expiresAt: new Date(now + PAIR_CODE_TTL_MS).toISOString() };
  }

  link(code, guardianHash) {
    const g = this.data.guardian;
    const c = g.codes[String(code)];
    if (!c || c.expires < Date.now()) return false;
    delete g.codes[String(code)];
    const guardian = this.#h(guardianHash);
    g.links[c.device] = [...new Set([...(g.links[c.device] || []), guardian])];
    this.save();
    return true;
  }

  alert(deviceHash, verdictId) {
    const g = this.data.guardian;
    const guardians = g.links[this.#h(deviceHash)] || [];
    const v = this.recent.get(verdictId);
    if (!v) return { delivered: 0, error: 'unknown verdictId' };
    const compact = { id: v.id, state: v.state, headline: v.headline, reason: v.reason, primary: v.primary, campaign: v.campaign, actions: v.actions?.slice(0, 2) };
    const at = new Date().toISOString();
    for (const guardian of guardians) {
      const list = (g.alerts[guardian] ||= []);
      list.unshift({ verdict: compact, at });
      list.length = Math.min(list.length, ALERTS_PER_GUARDIAN);
    }
    this.save();
    return { delivered: guardians.length };
  }

  alerts(guardianHash) {
    return this.data.guardian.alerts[this.#h(guardianHash)] || [];
  }
}
