// HTTP layer: every endpoint in SPEC.md plus static hosting of web/ and shared/.
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { Graph } from './graph/index.js';
import { Pipeline } from './pipeline.js';
import { AppState } from './state.js';
import { ViaSocket } from './integrations/viasocket.js';
import { Dodo, verifyStandardWebhook } from './integrations/dodo.js';
import { CakePay } from './integrations/cake.js';
import { Wispr } from './integrations/wispr.js';
import { Llm } from './integrations/llm.js';
import { ipNetwork, saltedHash, randomId } from './util.js';

const VERSION = '1.0.0';
const POSTS_PER_MINUTE = 120;

export async function createApp(config) {
  const graph = new Graph(config);
  await graph.init();
  // Warm the derived layer (campaigns, chokepoints, hash index, lookalike index) so the first check is fast.
  graph.memory.hashIndex();
  graph.memory.campaigns();
  graph.memory.lookalikeDomain('warm-up.invalid');
  const opts = { dataDir: config.dataDir, persist: config.persist };
  const state = new AppState({ ...opts, salt: config.reporterSalt });
  const viasocket = new ViaSocket({ url: config.viasocketUrl, ...opts });
  const dodo = new Dodo(config.dodo, { ...opts, publicBaseUrl: config.publicBaseUrl });
  const cake = new CakePay(config.cake);
  const wispr = new Wispr(config.wisprKey);
  const llm = new Llm(config.anthropicKey);
  const pipeline = new Pipeline({ config, graph, state, viasocket, llm });
  const startedAt = Date.now();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  // Open API: any origin (web, chrome-extension://*, bots) may GET and POST; POSTs are rate-limited.
  app.use(cors({ origin: true, methods: ['GET', 'POST', 'OPTIONS'], maxAge: 86_400 }));

  // Per-request privacy-safe network id: salted hash of the /24 (IPv4) or /48 (IPv6).
  app.use((req, _res, next) => {
    req.net = saltedHash(config.reporterSalt, `net:${ipNetwork(req.ip)}`);
    next();
  });

  const buckets = new Map();
  const postLimiter = (req, res, next) => {
    if (req.method !== 'POST') return next();
    const now = Date.now();
    const b = buckets.get(req.net) || { tokens: POSTS_PER_MINUTE, at: now };
    b.tokens = Math.min(POSTS_PER_MINUTE, b.tokens + ((now - b.at) / 60_000) * POSTS_PER_MINUTE);
    b.at = now;
    if (b.tokens < 1) return res.status(429).json({ error: 'Too many requests; try again in a minute' });
    b.tokens -= 1;
    buckets.set(req.net, b);
    if (buckets.size > 50_000) buckets.clear();
    next();
  };

  // Webhooks need the exact raw bytes for signature verification: register before express.json.
  app.post('/api/webhooks/dodo', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
    const check = verifyStandardWebhook({ secret: config.dodo.webhookSecret, headers: req.headers, rawBody: req.body });
    if (!check.ok) return res.status(config.dodo.webhookSecret ? 401 : 503).json({ error: check.error });
    if (state.seenWebhook(check.id)) return res.json({ ok: true, duplicate: true });
    let event;
    try {
      event = JSON.parse(req.body.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'invalid JSON' });
    }
    const data = event.data || {};
    const userId = data.metadata?.jaal_uid || data.customer?.customer_id || data.subscription_id || data.payment_id || check.id;
    if (event.type === 'payment.succeeded' || event.type === 'subscription.active') {
      state.setPayment(userId, { status: 'paid', event: event.type, customerId: data.customer?.customer_id || null, mode: config.dodo.env });
    } else if (['subscription.cancelled', 'subscription.expired', 'subscription.failed', 'refund.succeeded'].includes(event.type)) {
      state.setPayment(userId, { status: 'ended', event: event.type });
    }
    res.json({ ok: true, paying: state.paying });
  });

  app.use(express.json({ limit: '256kb' }));
  app.use('/api', postLimiter);

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  const meta = (req) => ({ net: req.net });
  const limitOf = (req, def, max) => Math.max(1, Math.min(max, Number(req.query.limit) || def));

  // Metered API tier: callers presenting an API key are billed per check through Dodo usage events.
  const meter = (req, eventName) => {
    const key = req.get('x-jaal-key');
    if (key && config.dodo.meterKeys[key]) dodo.recordUsage({ customerId: config.dodo.meterKeys[key], eventName, metadata: { endpoint: req.path } });
  };

  // ---------------------------------------------------------------- core
  app.post('/api/check', wrap(async (req, res) => {
    meter(req, 'api.check');
    res.json(await pipeline.check(req.body || {}, meta(req)));
  }));

  app.post('/api/report', wrap(async (req, res) => {
    res.json(await pipeline.report(req.body || {}, meta(req)));
  }));

  app.post('/api/dispute', wrap(async (req, res) => {
    res.json(pipeline.dispute(req.body || {}));
  }));

  const voiceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }).single('audio');
  app.post('/api/voice', express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '10mb' }), voiceUpload, wrap(async (req, res) => {
    const body = Buffer.isBuffer(req.body) ? {} : req.body || {};
    let transcript = typeof body.transcript === 'string' ? body.transcript : '';
    const audio = req.file?.buffer || (Buffer.isBuffer(req.body) ? req.body : null);
    if (!transcript && audio) transcript = await wispr.transcribe(audio, body.lang || req.query.lang || 'en');
    if (!transcript) return res.status(400).json({ error: 'Send { transcript } or WAV audio' });
    const verdict = await pipeline.check({ ...body, text: transcript, surface: 'voice', source: body.source || 'web', context: { ...body.context, onCall: true } }, meta(req));
    res.json({ ...verdict, transcript });
  }));

  // ---------------------------------------------------------------- public read API
  app.get('/api/stats', (_req, res) => {
    const s = graph.memory.stats();
    res.set('cache-control', 'public, max-age=5');
    res.json({ users: s.users, checks: s.checks, identifiers: s.identifiers, rings: s.rings, paying: state.paying, reports: s.reports, demo: s.demo, updatedAt: new Date().toISOString() });
  });

  app.get('/api/ring/:campaignId', wrap(async (req, res) => {
    const id = String(req.params.campaignId).replace(/^(campaign|ring):/, '');
    const c = graph.memory.campaign(id);
    if (!c) return res.status(404).json({ error: 'No such campaign' });
    graph.syncCampaigns();
    res.json({ campaign: pipeline.publicCampaign(c), ring: (await graph.ringOf(c.anchor)).value });
  }));

  app.get('/api/rings/top', wrap(async (req, res) => {
    const top = graph.memory.campaigns().slice(0, limitOf(req, 10, 50));
    res.set('cache-control', 'public, max-age=30');
    res.json(await Promise.all(top.map(async (c) => ({ campaign: pipeline.publicCampaign(c), ring: (await graph.ringOf(c.anchor)).value }))));
  }));

  app.get('/api/prefixes', (_req, res) => {
    const { version, buckets: b } = graph.memory.hashIndex();
    res.set('cache-control', 'public, max-age=300');
    res.json({ version, prefixes: [...b.keys()].sort() });
  });

  app.get('/api/bucket/:prefix', (req, res) => {
    const prefix = String(req.params.prefix).toLowerCase();
    if (!/^[0-9a-f]{8}$/.test(prefix)) return res.status(400).json({ error: 'prefix must be 8 hex chars' });
    res.set('cache-control', 'public, max-age=300');
    res.json({ hashes: graph.memory.hashIndex().buckets.get(prefix) || [] });
  });

  app.get('/api/chokepoints', wrap(async (req, res) => {
    res.json((await graph.moneyChokepoint(limitOf(req, 10, 100))).value);
  }));

  app.get('/api/spread/:campaignId', wrap(async (req, res) => {
    const id = String(req.params.campaignId).replace(/^(campaign|ring):/, '');
    const { value } = await graph.spreadMap(id);
    if (!value) return res.status(404).json({ error: 'No such campaign' });
    res.json(value);
  }));

  // Additive endpoints for the MCP server and the web check page.
  app.get('/api/lookalike/:domain', wrap(async (req, res) => {
    res.json((await graph.lookalikeDomain(String(req.params.domain).toLowerCase(), Number(req.query.threshold) || 0.75)).value);
  }));
  app.post('/api/similar', wrap(async (req, res) => {
    if (typeof req.body?.text !== 'string') return res.status(400).json({ error: 'Send { text }' });
    res.json((await graph.scriptSimilarity(req.body.text, Math.min(20, Number(req.body.k) || 5))).value.map(({ textKey, score, campaign, text }) => ({ textKey, score, campaign, text })));
  }));

  // ---------------------------------------------------------------- guardian
  app.post('/api/guardian/pair', (req, res) => {
    if (!req.body?.deviceHash) return res.status(400).json({ error: 'deviceHash required' });
    res.json(state.pair(String(req.body.deviceHash)));
  });
  app.post('/api/guardian/link', (req, res) => {
    const { code, guardianHash } = req.body || {};
    if (!code || !guardianHash) return res.status(400).json({ error: 'code and guardianHash required' });
    const ok = state.link(code, String(guardianHash));
    res.status(ok ? 200 : 404).json(ok ? { ok } : { ok, error: 'Code expired or not found' });
  });
  app.post('/api/guardian/alert', (req, res) => {
    const { deviceHash, verdictId } = req.body || {};
    if (!deviceHash || !verdictId) return res.status(400).json({ error: 'deviceHash and verdictId required' });
    const r = state.alert(String(deviceHash), String(verdictId));
    res.status(r.error ? 404 : 200).json({ ok: !r.error, ...r });
  });
  app.get('/api/guardian/alerts', (req, res) => {
    if (!req.query.guardianHash) return res.status(400).json({ error: 'guardianHash required' });
    res.json(state.alerts(String(req.query.guardianHash)));
  });

  // ---------------------------------------------------------------- payments
  app.post('/api/checkout/dodo', wrap(async (req, res) => {
    const email = typeof req.body?.email === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(req.body.email) ? req.body.email : undefined;
    const out = await dodo.createCheckout({ plan: req.body?.plan || 'family_monthly', email });
    state.setPayment(out.userId, { status: 'pending', sessionId: out.sessionId, mode: dodo.mode });
    res.json(out);
  }));


  app.get('/api/pay/crypto', wrap(async (req, res) => {
    res.json(await cake.paymentRequest(req.query.asset === 'btc' ? 'btc' : 'xmr'));
  }));

  // ---------------------------------------------------------------- ops
  app.get('/api/integrations/viasocket/log', (req, res) => res.json({ mode: viasocket.mode, entries: viasocket.entries(limitOf(req, 50, 200)) }));

  app.get('/api/health', (_req, res) => {
    const g = graph.health();
    let feeds = null;
    try {
      feeds = JSON.parse(fs.readFileSync(path.join(config.dataDir, 'feeds', 'manifest.json'), 'utf8'));
    } catch {
      feeds = null;
    }
    const s = graph.memory.stats();
    res.json({
      ok: true,
      version: VERSION,
      uptimeS: Math.round((Date.now() - startedAt) / 1000),
      engine: g.active,
      graph: { vertices: s.vertices, edges: s.edges, campaigns: s.rings, demoLoaded: graph.memory.hasSource('demo') },
      integrations: {
        tigergraph: { mode: g.tigergraph.mode, requested: g.requested, ...g.tigergraph },
        dodo: { mode: dodo.mode },
        viasocket: { mode: viasocket.mode },
        wispr: { mode: wispr.mode },
        llm: { mode: llm.mode },
        cake: { mode: cake.mode }
      },
      feeds
    });
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // ---------------------------------------------------------------- static
  app.use('/shared', express.static(config.sharedDir, { maxAge: '5m' }));
  app.use(express.static(config.webDir, {
    extensions: ['html'],
    setHeaders: (res, file) => res.setHeader('cache-control', file.endsWith('.html') ? 'no-cache' : 'public, max-age=3600')
  }));

  // Errors: JSON for the API, never a stack trace.
  app.use((err, _req, res, _next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status === 500) console.error('[jaal]', err);
    res.status(status).json({ error: status === 500 ? 'Internal error' : err.message, ref: randomId('err', 4) });
  });

  return { app, graph, pipeline, state, viasocket, dodo, cake, wispr, llm };
}
