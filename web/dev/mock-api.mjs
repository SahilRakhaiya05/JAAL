// Dev-only mock of the JAAL API (SPEC.md shapes) + static server for web/ and shared/.
// Zero deps. Run: node web/dev/mock-api.mjs  ->  http://localhost:8790/
// The real server (server/, :8787) replaces this; nothing in web/ depends on it.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(here, '..');
const SHARED = path.resolve(here, '../../shared');
const { extract } = require(path.join(SHARED, 'extract.js'));
const PORT = Number(process.env.PORT || 8790);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.zip': 'application/zip', '.apk': 'application/vnd.android.package-archive'
};

// ---------- deterministic fixtures ----------
function rng(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
}
const PSP = ['ybl', 'okaxis', 'paytm', 'ibl', 'axl'];
function fakeId(r, type) {
  const n = () => Math.floor(r() * 10);
  if (type === 'phone') return { id: `phone:+91${7 + Math.floor(r() * 3)}${Array.from({ length: 9 }, n).join('')}`, label: null };
  if (type === 'upi') return { id: `upi:${['pay', 'help', 'refund', 'kyc', 'desk', 'care'][Math.floor(r() * 6)]}.${Array.from({ length: 4 }, n).join('')}@${PSP[Math.floor(r() * 5)]}` };
  if (type === 'bank_account') return { id: `bank_account:${Array.from({ length: 12 }, n).join('')}` };
  if (type === 'domain') return { id: `domain:${['sbi-kyc', 'bescom-bill', 'fedex-in', 'rewards-hdfc', 'ipo-vip'][Math.floor(r() * 5)]}-${Array.from({ length: 2 }, n).join('')}.${['in', 'xyz', 'top', 'live'][Math.floor(r() * 4)]}` };
  return { id: `apk:${['sbi_rewards', 'kyc_update', 'bill_pay', 'customs_form'][Math.floor(r() * 4)]}.apk` };
}
function mask(id) {
  const [type, v] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
  if (type === 'phone') return `+91 ${v.slice(3, 5)}xxx x${v.slice(-4)}`;
  if (type === 'bank_account') return `A/c xxxx${v.slice(-4)}`;
  return v;
}
function makeRing(centerId, seed, { hop1 = 9, hop2 = 18, confirmedShare = 0.35 } = {}) {
  const r = rng(seed);
  const t = centerId.split(':')[0];
  const nodes = [{ id: centerId, type: t, label: mask(centerId), hop: 0, reports: 40 + Math.floor(r() * 60), confirmed: true }];
  const edges = [];
  const types = ['phone', 'phone', 'phone', 'upi', 'bank_account', 'domain', 'apk', 'phone'];
  const etype = { phone: 'PAYS_TO', upi: 'PAYS_TO', bank_account: 'PAYS_TO', domain: 'RESOLVES_TO', apk: 'HOSTED_ON' };
  const h1 = [];
  for (let i = 0; i < hop1; i++) {
    const ty = types[Math.floor(r() * types.length)];
    const { id } = fakeId(r, ty);
    const reports = Math.floor(r() * 30);
    nodes.push({ id, type: ty, label: mask(id), hop: 1, reports, confirmed: r() < confirmedShare && reports > 6 });
    edges.push({ source: centerId, target: id, type: etype[ty] || 'MENTIONS' });
    h1.push(id);
  }
  for (let i = 0; i < hop2; i++) {
    const ty = types[Math.floor(r() * types.length)];
    const { id } = fakeId(r, ty);
    const reports = Math.floor(r() * 12);
    nodes.push({ id, type: ty, label: mask(id), hop: 2, reports, confirmed: r() < confirmedShare * 0.5 && reports > 5 });
    edges.push({ source: h1[Math.floor(r() * h1.length)], target: id, type: etype[ty] || 'MENTIONS' });
  }
  return { center: centerId, nodes, edges };
}

const CAMPAIGNS = [
  { id: 'c-kyc-refund', name: 'KYC refund desk', size: 214, firstSeen: '2026-08-02T09:12:00Z', pattern: 'KYC expiry SMS asks for a ₹10 "verification" payment to a UPI handle', cities: ['Jamtara', 'Pune', 'Surat', 'Ahmedabad', 'Indore'], center: 'upi:refund.desk@ybl' },
  { id: 'c-digital-arrest', name: 'Customs parcel "digital arrest"', size: 131, firstSeen: '2026-07-19T04:40:00Z', pattern: 'Video call from a fake officer about a seized parcel, then a "security deposit"', cities: ['Mumbai', 'Bengaluru', 'Hyderabad', 'Delhi'], center: 'bank_account:917020045512' },
  { id: 'c-task-job', name: 'Telegram task job', size: 96, firstSeen: '2026-09-05T11:00:00Z', pattern: 'Paid to like videos, then a "prepaid task" that needs a deposit', cities: ['Vadodara', 'Rajkot', 'Nagpur'], center: 'upi:taskpay.2210@okaxis' },
  { id: 'c-bill', name: 'Electricity disconnection', size: 77, firstSeen: '2026-09-21T06:30:00Z', pattern: 'SMS says power will be cut tonight; asks to call a number and install an app', cities: ['Bengaluru', 'Mysuru', 'Goa'], center: 'phone:+917865043321' },
  { id: 'c-ipo', name: 'VIP IPO allotment group', size: 58, firstSeen: '2026-10-01T08:00:00Z', pattern: 'WhatsApp group promises IPO allotment and 300% returns', cities: ['Mumbai', 'Kolkata'], center: 'domain:ipo-vip-desk.live' }
];
const RINGS = Object.fromEntries(CAMPAIGNS.map((c, i) => [c.id, makeRing(c.center, c.id, { hop1: 8 + (i % 3) * 2, hop2: 14 + i * 2 })]));
const campaignOut = (c) => ({ id: c.id, name: c.name, size: c.size, firstSeen: c.firstSeen, pattern: c.pattern, cities: c.cities });

const stats = { users: 12408, checks: 389214, identifiers: 48213, rings: 312, paying: 186, reports: 9120 };
setInterval(() => {
  stats.checks += 3 + Math.floor(Math.random() * 18);
  if (Math.random() < 0.3) stats.users += 1;
  if (Math.random() < 0.5) stats.identifiers += 1 + Math.floor(Math.random() * 3);
  if (Math.random() < 0.04) stats.rings += 1;
  if (Math.random() < 0.05) stats.paying += 1;
  if (Math.random() < 0.4) stats.reports += 1;
}, 2000);

const CONFIRMED_KEYS = new Set(['upi:refund.desk@ybl', 'domain:sbi-kyc-update.in', 'url:http://sbi-kyc-update.in/verify', 'phone:+917865043321', 'apk:sbi_rewards.apk', 'upi:taskpay.2210@okaxis']);
const REPORTED_KEYS = new Set(['phone:+923001234567', 'domain:bit.ly', 'url:http://bit.ly/3kyc-upd', 'phone:+919812300456', 'upi:helpdesk.4411@paytm', 'remote_app:anydesk']);
const LABEL = { phone: 'number', upi: 'UPI handle', bank_account: 'bank account', ifsc: 'IFSC', url: 'link', domain: 'website', apk: 'app file', crypto: 'wallet', remote_app: 'remote-access app' };

function verdictFor(text, identifiersIn, lang) {
  const t0 = performance.now();
  const ids = (identifiersIn && identifiersIn.length ? identifiersIn.map((x) => ({ ...x, key: `${x.type}:${x.value}` })) : extract(text || ''));
  const scored = ids.map((x) => {
    if (CONFIRMED_KEYS.has(x.key)) return { type: x.type, value: x.value, state: 'confirmed', reports: 61 };
    if (REPORTED_KEYS.has(x.key)) return { type: x.type, value: x.value, state: 'reported', reports: 4 };
    return { type: x.type, value: x.value, state: 'clear', reports: 0 };
  });
  const rank = { confirmed: 2, reported: 1, clear: 0 };
  const primary = [...scored].sort((a, b) => rank[b.state] - rank[a.state] || b.reports - a.reports)[0] || null;
  const state = primary ? primary.state : 'clear';
  const noun = primary ? LABEL[primary.type] || 'identifier' : 'message';
  const camp = state === 'confirmed' ? CAMPAIGNS[0] : null;
  const id = 'chk_' + crypto.randomBytes(5).toString('hex');
  const v = {
    id, state,
    confidence: state === 'confirmed' ? 0.94 : state === 'reported' ? 0.58 : 0.08,
    headline: state === 'confirmed' ? `61 people reported this ${noun}` : state === 'reported' ? `4 people reported this ${noun}` : `No reports for this ${noun} yet`,
    reason: state === 'confirmed'
      ? `It pays into the same account as 38 numbers in a ring first seen 89 days ago.`
      : state === 'reported'
        ? `4 reports in the last 21 days from 2 cities; not yet linked to a ring.`
        : `Checked against ${stats.identifiers.toLocaleString('en-IN')} identifiers in the graph.`,
    identifiers: scored,
    primary: primary ? { type: primary.type, value: primary.value } : null,
    stats: {
      reports: primary ? primary.reports : 0,
      hopsToConfirmed: state === 'confirmed' ? 0 : state === 'reported' ? 2 : null,
      confirmedWithin2Hops: state === 'confirmed' ? 11 : state === 'reported' ? 1 : 0,
      firstSeen: state === 'clear' ? null : '2026-08-02T09:12:00Z',
      lastSeen: state === 'clear' ? null : new Date(Date.now() - 3600e3 * 5).toISOString()
    },
    campaign: camp ? campaignOut(camp) : null,
    ring: state === 'confirmed' ? RINGS[camp.id] : state === 'reported' && primary ? makeRing(`${primary.type}:${primary.value}`, primary.value, { hop1: 4, hop2: 5, confirmedShare: 0.2 }) : null,
    signals: text ? (require(path.join(SHARED, 'extract.js')).triage(text).triggers) : [],
    actions: state === 'clear'
      ? [{ id: 'report', label: 'Report as scam' }]
      : [
        { id: 'chakshu', label: 'Draft Chakshu report', href: 'https://sancharsaathi.gov.in/sfc/', text: `I received a suspected scam message. Identifier: ${primary.value} (${noun}). JAAL check ${id}: ${state === 'confirmed' ? '61' : '4'} prior reports.` },
        { id: 'call_1930', label: 'Call 1930', href: 'tel:1930' },
        { id: 'share_family', label: 'Tell family', text: `JAAL: ${state === 'confirmed' ? '61' : '4'} people reported ${primary.value}.` },
        { id: 'report', label: 'Report as scam' },
        { id: 'dispute', label: 'This is mine, dispute' }
      ],
    latencyMs: 0,
    engine: 'memory'
  };
  v.latencyMs = Math.max(18, Math.round(performance.now() - t0 + 40 + Math.random() * 110));
  return v;
}

// ---------- server ----------
const pairs = new Map();
function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({ _raw: d }); } });
  });
}
function qrSvg(seed) {
  const r = rng(seed); const n = 25; const s = 8; let rects = '';
  const finder = (x, y) => `<rect x="${x * s}" y="${y * s}" width="${7 * s}" height="${7 * s}" fill="#0A0C0F"/><rect x="${(x + 1) * s}" y="${(y + 1) * s}" width="${5 * s}" height="${5 * s}" fill="#fff"/><rect x="${(x + 2) * s}" y="${(y + 2) * s}" width="${3 * s}" height="${3 * s}" fill="#0A0C0F"/>`;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const inF = (x < 8 && y < 8) || (x > 16 && y < 8) || (x < 8 && y > 16);
    if (!inF && r() > 0.52) rects += `<rect x="${x * s}" y="${y * s}" width="${s}" height="${s}" fill="#0A0C0F"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-16 -16 232 232" shape-rendering="crispEdges"><rect x="-16" y="-16" width="232" height="232" fill="#fff"/>${rects}${finder(0, 0)}${finder(18, 0)}${finder(0, 18)}</svg>`;
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const p = u.pathname;
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (p.startsWith('/api/')) {
    await new Promise((r) => setTimeout(r, 60 + Math.random() * 120));
    if (p === '/api/stats') return send(res, 200, { ...stats, updatedAt: new Date().toISOString() });
    if (p === '/api/health') return send(res, 200, { ok: true, engine: 'memory', integrations: { tigergraph: false, dodo: false, viasocket: false, wispr: false, llm: false } });
    if (p === '/api/rings/top') {
      const limit = Number(u.searchParams.get('limit') || 10);
      return send(res, 200, CAMPAIGNS.slice(0, limit).map((c) => ({ campaign: campaignOut(c), ring: RINGS[c.id] })));
    }
    if (p.startsWith('/api/ring/')) {
      const c = CAMPAIGNS.find((x) => x.id === decodeURIComponent(p.slice(10)));
      return c ? send(res, 200, { campaign: campaignOut(c), ring: RINGS[c.id] }) : send(res, 404, { error: 'not_found' });
    }
    if (p.startsWith('/api/spread/')) {
      const c = CAMPAIGNS.find((x) => x.id === decodeURIComponent(p.slice(12)));
      if (!c) return send(res, 404, { error: 'not_found' });
      const r = rng(c.id); let t = Date.parse(c.firstSeen);
      return send(res, 200, c.cities.map((city, i) => { t += (3 + Math.floor(r() * 9)) * 86400e3; return { city, firstSeen: new Date(t).toISOString(), count: Math.max(3, Math.round(c.size / (i + 1.6) * (0.6 + r() * 0.4))) }; }));
    }
    if (req.method === 'POST') {
      const b = await readBody(req);
      if (p === '/api/check') { stats.checks++; return send(res, 200, verdictFor(b.text, b.identifiers, b.lang)); }
      if (p === '/api/voice') { stats.checks++; return send(res, 200, verdictFor(b.transcript, null, b.lang)); }
      if (p === '/api/report') { stats.reports++; const v = verdictFor(b.text, b.identifiers, b.lang); if (b.verdict === 'scam' && v.state === 'clear') { v.state = 'reported'; v.headline = '1 person reported this ' + (v.primary ? LABEL[v.primary.type] : 'message'); v.reason = 'Your report is the first. It counts once 2 more people from other places report it.'; v.stats.reports = 1; } return send(res, 200, { ok: true, reportId: 'rep_' + crypto.randomBytes(4).toString('hex'), verdict: v }); }
      if (p === '/api/dispute') return send(res, 200, { ok: true, disputeId: 'dsp_' + crypto.randomBytes(4).toString('hex') });
      if (p === '/api/guardian/pair') { const code = String(100000 + Math.floor(Math.random() * 900000)); pairs.set(code, b.deviceHash); return send(res, 200, { code }); }
      if (p === '/api/guardian/link') return send(res, 200, { ok: pairs.has(b.code) || /^\d{6}$/.test(b.code || '') });
      if (p === '/api/checkout/dodo') return send(res, 200, { checkoutUrl: `/thanks.html?demo=1&plan=${encodeURIComponent(b.plan || '')}` });
    }
    if (p === '/api/guardian/alerts') {
      const v = verdictFor('Your KYC expired. Pay Rs 10 to refund.desk@ybl', null);
      return send(res, 200, [{ verdict: v, at: new Date(Date.now() - 7 * 60e3).toISOString() }]);
    }
    if (p === '/api/pay/crypto') {
      const asset = u.searchParams.get('asset') === 'btc' ? 'btc' : 'xmr';
      const address = asset === 'xmr' ? '48edfHu7V9Z84YzzMa6fUueoELZ9ZRXq9VetWzYGzKt52XU5xvqgzYnDK9URnRoJMk1j8nLwEVsaSWJ4fhdUyZijBGUicoD' : 'bc1qjaal0demo6y8k4p3w9xq2t7m5n0r8s6v4c2d0';
      const amount = asset === 'xmr' ? '0.0112' : '0.000021';
      const uri = asset === 'xmr' ? `monero:${address}?tx_amount=${amount}&tx_description=JAAL%20Family%20Shield` : `bitcoin:${address}?amount=${amount}&label=JAAL%20Family%20Shield`;
      return send(res, 200, { uri, address, amount, qrSvg: qrSvg(address), reference: 'JAAL-' + crypto.randomBytes(3).toString('hex').toUpperCase() });
    }
    return send(res, 404, { error: 'not_found' });
  }
  // dev helper: save a generated OG png into web/
  if (p === '/dev/save-og' && req.method === 'POST') {
    const b = await readBody(req);
    const m = /^data:image\/png;base64,(.+)$/.exec(b.dataUrl || '');
    if (!m) return send(res, 400, { error: 'bad' });
    fs.writeFileSync(path.join(WEB, 'og.png'), Buffer.from(m[1], 'base64'));
    return send(res, 200, { ok: true });
  }
  let root = WEB; let rel = p;
  if (p.startsWith('/shared/')) { root = SHARED; rel = p.slice(7); }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(root, '.' + decodeURIComponent(rel));
  if (!file.startsWith(root)) return send(res, 403, 'forbidden', 'text/plain');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`JAAL mock on http://localhost:${PORT}/`));
