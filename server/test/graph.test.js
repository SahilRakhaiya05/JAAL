import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshApp, report, meta } from './helpers.js';
import { demoReports } from '../src/seed/demo-india.js';
import { louvain, wcc } from '../src/graph/louvain.js';
import { embed, cosine } from '../src/graph/similarity.js';

async function seededDemo() {
  const ctx = await freshApp();
  for (const r of demoReports()) {
    await ctx.pipeline.report({ text: r.text, reporter: r.reporter, city: r.city, lang: r.lang }, { net: `demo-net-${r.reporter}` }, { ts: r.ts, src: 'demo', bypassRateLimit: true, quiet: true });
  }
  return ctx;
}

test('chokepoint: 61 numbers pay into 1 account (demo refund ring)', async () => {
  const { graph, pipeline } = await seededDemo();
  const top = graph.memory.moneyChokepoint(3);
  assert.equal(top[0].type, 'bank_account');
  assert.equal(top[0].inboundPhones, 61);
  const v = await pipeline.check({ text: 'refund to refund.desk@ybl' }, meta());
  assert.equal(v.state, 'confirmed');
  assert.equal(v.headline, '61 people reported this UPI handle');
  assert.equal(v.campaign.size, 61);
  assert.match(v.reason, /payout point for 61 numbers/);
});

test('blast radius: bridge phone is 2 hops from 47 confirmed reports', async () => {
  const { pipeline } = await seededDemo();
  const v = await pipeline.check({ text: 'call 9200099001' }, meta());
  assert.equal(v.state, 'reported');
  assert.equal(v.stats.hopsToConfirmed, 2);
  assert.equal(v.stats.confirmedWithin2Hops, 47);
  assert.match(v.reason, /^This number is 2 hops from 47 confirmed reports and shares a payout account with campaign \d+, first seen 9 days ago\.$/);
});

test('web check-page examples from the demo seed', async () => {
  const { pipeline } = await seededDemo();
  assert.equal((await pipeline.check({ identifiers: [{ type: 'domain', value: 'sbi-kyc-update.in' }] }, meta())).state, 'confirmed');
  assert.equal((await pipeline.check({ text: '+923001234567' }, meta())).state, 'reported');
});

test('ring detection: eight demo campaigns, spread map moves city to city', async () => {
  const { graph } = await seededDemo();
  const { campaigns, entities } = graph.memory.ringDetection();
  assert.equal(campaigns.length, 8);
  assert.ok(entities < campaigns.length, 'shared mule account joins two campaigns into one WCC entity');
  const refund = campaigns.find((c) => c.pattern.startsWith('Refund'));
  const spread = graph.memory.spreadMap(refund.id);
  assert.deepEqual(spread.map((s) => s.city), ['Delhi', 'Noida', 'Gurugram', 'Jaipur', 'Indore', 'Bhopal']);
  assert.equal(spread.reduce((a, s) => a + s.count, 0), 61);
});

test('louvain separates two cliques joined by one edge; wcc keeps them together', () => {
  const edges = [];
  for (const base of [0, 4]) for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) edges.push([base + i, base + j, 1]);
  edges.push([3, 4, 1]);
  const comm = louvain(8, edges);
  assert.equal(new Set(comm.slice(0, 4)).size, 1);
  assert.equal(new Set(comm.slice(4)).size, 1);
  assert.notEqual(comm[0], comm[7]);
  assert.equal(new Set(wcc(8, edges)).size, 1);
});

test('hub guard: a shared popular domain does not weld rings together', async () => {
  const { pipeline, graph } = await freshApp();
  for (let i = 0; i < 4; i++) await report(pipeline, `pay a${i}@ybl via whatsapp.com call 90000100${10 + i}`, i);
  const bfs = graph.memory.blastRadius('upi:a0@ybl');
  assert.ok(!bfs.hopOf.has('domain:whatsapp.com'));
  assert.ok(!bfs.hopOf.has('upi:a1@ybl'));
});

test('lookalike domains: token, transposition, homoglyph', async () => {
  const { graph } = await freshApp();
  const best = (d) => graph.memory.lookalikeDomain(d)[0];
  assert.equal(best('sbi-kyc-update.xyz').target, 'sbi.co.in');
  assert.equal(best('hdfcbnak.com').target, 'hdfcbank.com');
  assert.equal(best('paytrn.com').target, 'paytm.com');
  assert.deepEqual(graph.memory.lookalikeDomain('sbi.co.in'), []);
});

test('script similarity: Hinglish variant of a script is close, unrelated text is not', async () => {
  const a = embed('Your SBI account will be blocked today. Update KYC at <LINK> or call <PHONE>');
  const b = embed('Your SBI account will be blocked today, update your KYC at <LINK> call <PHONE> now');
  const c = embed('Happy birthday! See you at dinner tonight');
  assert.equal(a.length, 256);
  assert.ok(cosine(a, b) > 0.8);
  assert.ok(cosine(a, c) < 0.3);
});
