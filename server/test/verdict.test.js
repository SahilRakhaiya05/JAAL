import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshApp, report, meta } from './helpers.js';
import { DAY_MS } from '../src/util.js';

const SCAM = 'Refund pending. Pay to refund.desk@ybl urgent, call 9000012345';

test('extraction -> check -> clear for a clean message', async () => {
  const { pipeline } = await freshApp();
  const v = await pipeline.check({ text: 'Lunch at 1pm? Call me on 9876543210', lang: 'en' }, meta());
  assert.equal(v.state, 'clear');
  assert.deepEqual(v.identifiers, [{ type: 'phone', value: '+919876543210', state: 'clear', reports: 0 }]);
  assert.equal(v.ring, null);
  assert.ok(v.headline.split(/\s+/).length < 12);
  assert.ok(!/fraud/i.test(v.headline + v.reason));
});

test('a check writes: identifiers become vertices and checks are counted', async () => {
  const { pipeline, graph } = await freshApp();
  await pipeline.check({ text: 'pay to new.handle@ybl', reporter: 'dev-a' }, meta());
  assert.ok(graph.memory.v.has('upi:new.handle@ybl'));
  assert.equal(graph.memory.stats().checks, 1);
  assert.equal(graph.memory.stats().users, 1);
});

test('one report -> reported; three from independent clusters -> confirmed', async () => {
  const { pipeline } = await freshApp();
  await report(pipeline, SCAM, 1);
  let v = await pipeline.check({ text: 'refund.desk@ybl' }, meta(9));
  assert.equal(v.state, 'reported');
  assert.equal(v.headline, '1 person reported this UPI handle');
  await report(pipeline, SCAM, 2);
  await report(pipeline, SCAM, 3);
  v = await pipeline.check({ text: 'refund.desk@ybl' }, meta(9));
  assert.equal(v.state, 'confirmed');
  assert.equal(v.headline, '3 people reported this UPI handle');
  assert.match(v.reason, /3 people in 3 independent groups/);
  assert.ok(v.ring.nodes.length >= 2 && v.ring.nodes.length <= 40);
  assert.ok(v.actions.some((a) => a.id === 'chakshu' && a.href === 'https://sancharsaathi.gov.in/sfc/' && a.text.includes('refund.desk@ybl')));
  assert.ok(v.actions.some((a) => a.id === 'share_family' && a.href.startsWith('https://wa.me/?text=')));
});

test('corroboration: one reporter (or one /24 network) cannot confirm alone', async () => {
  const { pipeline } = await freshApp();
  for (let i = 0; i < 10; i++) await pipeline.report({ text: SCAM, reporter: 'same-device' }, meta(1), { quiet: true });
  assert.equal((await pipeline.check({ text: 'refund.desk@ybl' }, meta(9))).state, 'reported');

  // Five different devices behind the same network within minutes = one cluster.
  const { pipeline: p2, graph } = await freshApp();
  for (let i = 0; i < 5; i++) await p2.report({ text: SCAM, reporter: `sybil-${i}` }, meta(7), { quiet: true });
  const st = graph.memory.stateOf('upi:refund.desk@ybl');
  assert.equal(st.reports, 5);
  assert.equal(st.clusters, 1);
  assert.equal(st.state, 'reported');
});

test('per-reporter rate limit: 30 reports per hour', async () => {
  const { pipeline } = await freshApp();
  for (let i = 0; i < 30; i++) await pipeline.report({ text: `pay x${i}@ybl`, reporter: 'busy' }, meta(1), { quiet: true });
  await assert.rejects(pipeline.report({ text: 'pay yy@ybl', reporter: 'busy' }, meta(1)), (e) => e.status === 429);
});

test('reporting an allow-listed bank domain is a contradiction and costs trust', async () => {
  const { pipeline, graph } = await freshApp();
  await pipeline.report({ text: 'scam site https://sbi.co.in/login', reporter: 'poisoner' }, meta(1), { quiet: true });
  assert.equal(graph.memory.stateOf('domain:sbi.co.in').state, 'clear');
  const r = [...graph.memory.v.values()].find((x) => x.type === 'Reporter');
  assert.ok(r.a.trust < 0.5);
});

test('dispute demotes confirmed -> reported pending review and is logged', async () => {
  const { pipeline, graph } = await freshApp();
  for (let i = 1; i <= 3; i++) await report(pipeline, SCAM, i);
  assert.equal(graph.memory.stateOf('upi:refund.desk@ybl').state, 'confirmed');
  const d = pipeline.dispute({ type: 'upi', value: 'refund.desk@ybl', reason: 'This is my shop handle' });
  assert.equal(d.ok, true);
  assert.equal(d.state, 'reported');
  const v = await pipeline.check({ text: 'refund.desk@ybl' }, meta(9));
  assert.equal(v.state, 'reported');
  assert.match(v.headline, /under review/);
  assert.equal(graph.memory.meta.disputes.at(-1).before, 'confirmed');
});

test('decay: 21-day half-life pushes old corroboration below the threshold', async () => {
  const { pipeline, graph } = await freshApp();
  const old = Date.now() - 42 * DAY_MS; // two half-lives: each vote weighs 0.5 * 0.25
  for (let i = 1; i <= 3; i++) await report(pipeline, SCAM, i, { ts: old + i });
  const st = graph.memory.stateOf('upi:refund.desk@ybl');
  assert.equal(st.reports, 3);
  assert.ok(Math.abs(st.score - 0.375) < 0.01, `score ${st.score}`);
  assert.equal(st.state, 'reported');
  // Outside the 90-day window reports stop counting at all.
  const { pipeline: p2, graph: g2 } = await freshApp();
  await report(p2, SCAM, 1, { ts: Date.now() - 120 * DAY_MS });
  assert.equal(g2.memory.stateOf('upi:refund.desk@ybl').reports, 0);
});

test('public feed match confirms without reports', async () => {
  const { pipeline, graph } = await freshApp();
  graph.memory.importFeed('openphish', [{ type: 'url', key: 'url:http://bad-login.example.xyz/a' }]);
  const v = await pipeline.check({ text: 'open https://bad-login.example.xyz/a' }, meta());
  assert.equal(v.identifiers.find((i) => i.type === 'url').state, 'confirmed');
  assert.equal(v.state, 'confirmed');
});

test('hi and gu headlines', async () => {
  const { pipeline } = await freshApp();
  for (let i = 1; i <= 3; i++) await report(pipeline, SCAM, i);
  assert.equal((await pipeline.check({ text: 'refund.desk@ybl', lang: 'hi' }, meta())).headline, '3 लोगों ने इस UPI हैंडल को रिपोर्ट किया है');
  assert.equal((await pipeline.check({ text: 'refund.desk@ybl', lang: 'gu' }, meta())).headline, '3 લોકોએ આ UPI હેન્ડલની જાણ કરી છે');
});
