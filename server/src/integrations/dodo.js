// Dodo Payments: hosted checkout (Checkout Sessions API), Standard Webhooks verification,
// and usage metering for the API tier (Usage Events API).
//   POST {base}/checkouts       { product_cart:[{product_id,quantity}], customer?, return_url, metadata } -> { session_id, checkout_url }
//   POST {base}/events/ingest   { events:[{ event_id, customer_id, event_name, timestamp, metadata }] }
// base = https://test.dodopayments.com | https://live.dodopayments.com, auth = Bearer DODO_API_KEY.
import crypto from 'node:crypto';
import path from 'node:path';
import { JsonFile, fetchWithTimeout, randomId } from '../util.js';

const WEBHOOK_TOLERANCE_S = 5 * 60;

/**
 * Standard Webhooks signature check (https://www.standardwebhooks.com):
 * signed content = `${webhook-id}.${webhook-timestamp}.${rawBody}`, HMAC-SHA256 keyed with the
 * base64-decoded secret after "whsec_"; header holds space-separated "v1,<base64sig>" entries.
 */
export function verifyStandardWebhook({ secret, headers, rawBody, now = Date.now() }) {
  const id = headers['webhook-id'];
  const timestamp = headers['webhook-timestamp'];
  const signatures = headers['webhook-signature'];
  if (!secret) return { ok: false, error: 'webhook secret not configured' };
  if (!id || !timestamp || !signatures) return { ok: false, error: 'missing webhook headers' };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > WEBHOOK_TOLERANCE_S) return { ok: false, error: 'timestamp outside tolerance' };
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest();
  for (const part of String(signatures).split(' ')) {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) continue;
    const given = Buffer.from(sig, 'base64');
    if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return { ok: true, id };
  }
  return { ok: false, error: 'signature mismatch' };
}

/** Sign like Dodo does; used by tests and by the local demo webhook simulator. */
export function signStandardWebhook({ secret, id, timestamp, body }) {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  return `v1,${crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
}

export class Dodo {
  constructor(cfg, { dataDir, persist = true, publicBaseUrl }) {
    this.cfg = cfg;
    this.publicBaseUrl = publicBaseUrl;
    this.meter = new JsonFile(path.join(dataDir, 'meter.json'), { events: [], sent: 0, failed: 0 }, { persist });
    this.queue = [];
    this.flushTimer = null;
  }

  get mode() {
    return this.cfg.apiKey && this.cfg.productId ? this.cfg.env : 'demo';
  }

  async createCheckout({ plan = 'family_monthly', email, userId = randomId('u') }) {
    const returnUrl = `${this.publicBaseUrl}/thanks.html?ref=${encodeURIComponent(userId)}`;
    if (this.mode === 'demo') {
      // No Dodo keys: show the thank-you page in demo mode. Nothing is marked paid, so the public counter stays honest.
      return { checkoutUrl: `${this.publicBaseUrl}/thanks.html?demo=1&ref=${encodeURIComponent(userId)}`, sessionId: null, userId, demo: true };
    }
    const body = {
      product_cart: [{ product_id: this.cfg.productId, quantity: 1 }],
      return_url: returnUrl,
      metadata: { jaal_uid: userId, plan },
      ...(email ? { customer: { email } } : {})
    };
    const res = await fetchWithTimeout(`${this.cfg.baseUrl}/checkouts`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.cfg.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }, 8000);
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.checkout_url) throw Object.assign(new Error(json.message || `Dodo checkout failed (${res.status})`), { status: 502 });
    return { checkoutUrl: json.checkout_url, sessionId: json.session_id, userId, demo: false };
  }

  /**
   * Usage meter for the API tier: every metered call is recorded locally, and batched to
   * Dodo's /events/ingest when an API key and the caller's Dodo customer id are known.
   */
  recordUsage({ customerId, eventName = 'api.check', metadata = {} }) {
    const event = { event_id: randomId('evt', 8), customer_id: customerId, event_name: eventName, timestamp: new Date().toISOString(), metadata };
    this.meter.data.events.push(event);
    if (this.meter.data.events.length > 5000) this.meter.data.events.splice(0, this.meter.data.events.length - 5000);
    this.meter.save();
    if (!this.cfg.apiKey || !customerId) return;
    this.queue.push(event);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flushUsage(), 10_000);
      this.flushTimer.unref?.();
    }
  }

  async flushUsage() {
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
    const events = this.queue.splice(0, 1000);
    if (!events.length) return;
    try {
      const res = await fetchWithTimeout(`${this.cfg.baseUrl}/events/ingest`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.cfg.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ events })
      }, 8000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.meter.data.sent += events.length;
    } catch {
      this.meter.data.failed += events.length;
    }
    this.meter.save();
  }
}
