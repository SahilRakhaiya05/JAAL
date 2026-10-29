// viaSocket: on a confirmed verdict (or a new report), POST a JSON event to a viaSocket
// webhook trigger. The flow on the viaSocket side fans it out (Slack/Telegram alert to a
// moderator, Google Sheet row, email to a bank nodal officer...). Fire-and-forget; every
// run is logged to data/viasocket-log.json and served at /api/integrations/viasocket/log.
import path from 'node:path';
import { JsonFile, fetchWithTimeout } from '../util.js';

const LOG_LIMIT = 200;
const DEDUPE_MS = 60 * 60_000; // one event per identifier per hour

export class ViaSocket {
  constructor({ url, dataDir, persist = true }) {
    this.url = url;
    this.log = new JsonFile(path.join(dataDir, 'viasocket-log.json'), [], { persist });
    this.lastSent = new Map();
  }

  get mode() {
    return this.url ? 'live' : 'demo';
  }

  static severity(verdict) {
    const reports = verdict.stats?.reports || 0;
    if (verdict.state === 'confirmed' && (reports >= 20 || verdict.campaign?.size >= 20)) return 'high';
    if (verdict.state === 'confirmed') return 'medium';
    return 'low';
  }

  /** Build the event from a Verdict; actions carry the Chakshu draft and family share text. */
  static eventFrom(kind, verdict) {
    const action = (id) => verdict.actions?.find((a) => a.id === id);
    return {
      event: kind, // "verdict.confirmed" | "report.created"
      at: new Date().toISOString(),
      severity: ViaSocket.severity(verdict),
      verdict: {
        id: verdict.id, state: verdict.state, headline: verdict.headline, reason: verdict.reason,
        primary: verdict.primary, stats: verdict.stats, confidence: verdict.confidence
      },
      campaign: verdict.campaign,
      chakshuDraft: action('chakshu')?.text || null,
      chakshuUrl: action('chakshu')?.href || null,
      familyShareText: action('share_family')?.text || null,
      familyShareUrl: action('share_family')?.href || null
    };
  }

  /** Never awaited on the request path. */
  emit(kind, verdict) {
    const dedupeKey = `${kind}:${verdict.primary?.type}:${verdict.primary?.value}`;
    const now = Date.now();
    if (now - (this.lastSent.get(dedupeKey) || 0) < DEDUPE_MS) return;
    this.lastSent.set(dedupeKey, now);
    const event = ViaSocket.eventFrom(kind, verdict);
    const started = Date.now();
    const record = (entry) => {
      this.log.data.unshift({ at: event.at, event: kind, severity: event.severity, primary: verdict.primary, ...entry, ms: Date.now() - started });
      this.log.data.length = Math.min(this.log.data.length, LOG_LIMIT);
      this.log.save();
    };
    if (!this.url) {
      record({ status: 'demo', note: 'VIASOCKET_WEBHOOK_URL not set; event built but not sent', payload: event });
      return;
    }
    fetchWithTimeout(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) }, 5000)
      .then((res) => record({ status: res.ok ? 'sent' : 'error', http: res.status }))
      .catch((err) => record({ status: 'error', error: err.name === 'AbortError' ? 'timeout' : err.message }));
  }

  entries(limit = 50) {
    return this.log.data.slice(0, limit);
  }
}
