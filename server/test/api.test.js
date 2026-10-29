import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshApp, listen, report } from './helpers.js';
import { verifyStandardWebhook, signStandardWebhook } from '../src/integrations/dodo.js';
import { sha256 } from '../src/util.js';

const SECRET = `whsec_${Buffer.from('jaal-test-secret-0123456789').toString('base64')}`;

test('Dodo webhook: Standard Webhooks signature on the raw body', () => {
  const body = JSON.stringify({ type: 'payment.succeeded', data: { metadata: { jaal_uid: 'u1' } } });
  const id = 'msg_1';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers = { 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': `v1,bogus ${signStandardWebhook({ secret: SECRET, id, timestamp, body })}` };
  assert.equal(verifyStandardWebhook({ secret: SECRET, headers, rawBody: Buffer.from(body) }).ok, true);
  assert.equal(verifyStandardWebhook({ secret: SECRET, headers, rawBody: Buffer.from(body + ' ') }).ok, false);
  const stale = { ...headers, 'webhook-timestamp': String(Number(timestamp) - 3600) };
  assert.equal(verifyStandardWebhook({ secret: SECRET, headers: stale, rawBody: Buffer.from(body) }).error, 'timestamp outside tolerance');
});

test('Dodo webhook endpoint marks paid once and bumps paying', async () => {
  const { app } = await freshApp({ DODO_WEBHOOK_SECRET: SECRET });
  const srv = await listen(app);
  try {
    const body = JSON.stringify({ type: 'payment.succeeded', data: { metadata: { jaal_uid: 'u42' } } });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const send = (sig) => fetch(`${srv.base}/api/webhooks/dodo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'webhook-id': 'msg_42', 'webhook-timestamp': timestamp, 'webhook-signature': sig },
      body
    });
    assert.equal((await send('v1,AAAA')).status, 401);
    const ok = await send(signStandardWebhook({ secret: SECRET, id: 'msg_42', timestamp, body }));
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).paying, 1);
    const again = await (await send(signStandardWebhook({ secret: SECRET, id: 'msg_42', timestamp, body }))).json();
    assert.equal(again.duplicate, true);
    assert.equal((await (await fetch(`${srv.base}/api/stats`)).json()).paying, 1);
  } finally {
    srv.close();
  }
});

test('prefixes and buckets use SHA-256 of the canonical key', async () => {
  const { app, pipeline } = await freshApp();
  for (let i = 1; i <= 3; i++) await report(pipeline, 'pay refund.desk@ybl now', i);
  const srv = await listen(app);
  try {
    const hash = sha256('upi:refund.desk@ybl');
    const { prefixes, version } = await (await fetch(`${srv.base}/api/prefixes`)).json();
    assert.ok(version);
    assert.ok(prefixes.includes(hash.slice(0, 8)));
    const { hashes } = await (await fetch(`${srv.base}/api/bucket/${hash.slice(0, 8)}`)).json();
    assert.deepEqual(hashes.find((h) => h.hash === hash), { hash, state: 'confirmed', reports: 3 });
    assert.equal((await fetch(`${srv.base}/api/bucket/zz`)).status, 400);
  } finally {
    srv.close();
  }
});

test('HTTP surface: check, report, dispute, rings, guardian, crypto, voice, health', async () => {
  const { app } = await freshApp();
  const srv = await listen(app);
  const post = (p, body) => fetch(`${srv.base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'chrome-extension://abc' }, body: JSON.stringify(body) });
  try {
    const clean = await post('/api/check', { text: 'hello', source: 'extension' });
    assert.equal(clean.headers.get('access-control-allow-origin'), 'chrome-extension://abc');
    assert.equal((await clean.json()).state, 'clear');

    const r = await (await post('/api/report', { text: 'refund to refund.desk@ybl call 9000012345', reporter: 'd1', verdict: 'scam' })).json();
    assert.equal(r.ok, true);
    assert.equal(r.verdict.state, 'reported');

    assert.equal((await (await post('/api/dispute', { type: 'upi', value: 'refund.desk@ybl', reason: 'mine' })).json()).ok, true);
    assert.ok(Array.isArray(await (await fetch(`${srv.base}/api/rings/top`)).json()));
    assert.ok(Array.isArray(await (await fetch(`${srv.base}/api/chokepoints`)).json()));
    assert.equal((await fetch(`${srv.base}/api/ring/999`)).status, 404);

    const { code } = await (await post('/api/guardian/pair', { deviceHash: 'parent' })).json();
    assert.match(code, /^\d{6}$/);
    assert.equal((await (await post('/api/guardian/link', { code, guardianHash: 'child' })).json()).ok, true);
    const v = await (await post('/api/check', { text: 'refund.desk@ybl' })).json();
    assert.equal((await (await post('/api/guardian/alert', { deviceHash: 'parent', verdictId: v.id })).json()).delivered, 1);
    const alerts = await (await fetch(`${srv.base}/api/guardian/alerts?guardianHash=child`)).json();
    assert.equal(alerts[0].verdict.id, v.id);

    const xmr = await (await fetch(`${srv.base}/api/pay/crypto?asset=xmr`)).json();
    assert.match(xmr.uri, /^monero:.+\?tx_amount=.+&tx_description=JAAL%20Family%20Shield/);
    assert.ok(xmr.qrSvg.startsWith('<svg') && xmr.demo === true);
    const btc = await (await fetch(`${srv.base}/api/pay/crypto?asset=btc`)).json();
    assert.match(btc.uri, /^bitcoin:.+\?amount=.+&label=JAAL/);

    const voice = await (await post('/api/voice', { transcript: 'this is CBI, you are under digital arrest, pay to refund.desk@ybl', lang: 'en' })).json();
    assert.equal(voice.state, 'reported');
    assert.equal(voice.actions[0].id, 'call_1930');
    const audio = await fetch(`${srv.base}/api/voice`, { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: Buffer.alloc(64) });
    assert.equal(audio.status, 501);

    const checkout = await (await post('/api/checkout/dodo', { plan: 'family_monthly' })).json();
    assert.equal(checkout.demo, true);
    const health = await (await fetch(`${srv.base}/api/health`)).json();
    assert.deepEqual(Object.keys(health.integrations).sort(), ['cake', 'dodo', 'llm', 'tigergraph', 'viasocket', 'wispr']);
    assert.equal(health.engine, 'memory');
    const stats = await (await fetch(`${srv.base}/api/stats`)).json();
    for (const k of ['users', 'checks', 'identifiers', 'rings', 'paying', 'reports', 'updatedAt']) assert.ok(k in stats, k);
  } finally {
    srv.close();
  }
});
