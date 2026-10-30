#!/usr/bin/env node
// TigerGraph side of the receipt: runs the installed blast_radius query
// (tigergraph/queries/blast_radius.gsql) over the same seeds, 20 runs, p50/p95.
//
//   TG_HOST=https://<workspace>.i.tgcloud.io TG_TOKEN=<token> \
//     node tigergraph/bench/run-tigergraph.mjs --edges 200000 [--data 200000] [--hops 4] [--load]
//
// --load upserts bench/data/<data>/ into graph JAAL through REST++ first
// (POST /restpp/graph/JAAL, 5000 edges per request). Use a scratch workspace
// or clear the graph afterwards: the bench keys (report:b*, phone:+9160000*)
// do not collide with real data, but they are not real reports either.
//
// Timing is client-side wall clock per REST++ call (includes network RTT to
// Savanna); the row's notes say so, and the same seeds' answers are kept so
// they can be diffed against the Postgres and memory runs.
// blast_radius cuts the window at now(); window_days is widened by the days
// elapsed since the generator's REF_TIME so all three engines use the same
// cutoff to within one day. hub_degree is set huge so the hub guard (which
// the SQL and JS baselines do not have) never fires.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { arg, dataDir, readSeeds, readMeta, stats, machine, record } from './lib.mjs';

const EDGES = Number(arg('--edges', 200000));
const RUNS = Number(arg('--runs', 20));
const WARMUP = Number(arg('--warmup', 3));
const HOST = (process.env.TG_HOST || '').replace(/\/+$/, '');
const PREFIX = process.env.TG_RESTPP_PREFIX ?? '/restpp';
const TOKEN = process.env.TG_TOKEN || '';
const GRAPH = process.env.TG_GRAPH || 'JAAL';
if (!HOST || !TOKEN) {
  console.error('TG_HOST and TG_TOKEN are required. No TigerGraph run, nothing recorded.');
  process.exit(2);
}
const dir = dataDir(EDGES);
const meta = readMeta(dir);
const { seeds, refTime, windowDays, maxHops: defHops } = readSeeds(dir);
const HOPS = Number(arg('--hops', defHops));
const WINDOW = windowDays + Math.round((Date.now() - Date.parse(refTime)) / 86400_000);
const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

let loadS = null;
if (process.argv.includes('--load')) {
  const t0 = performance.now();
  const vl = readFileSync(resolve(dir, 'vertices.csv'), 'utf8').split('\n').slice(1).filter(Boolean);
  const vt = new Map(), key = new Map();
  const VB = 5000;
  for (let i = 0; i < vl.length; i += VB) {
    const body = { vertices: {} };
    for (const l of vl.slice(i, i + VB)) {
      const [id, k, t] = l.split(',');
      vt.set(id, t); key.set(id, k);
      (body.vertices[t] ||= {})[k] = { value: { value: k.slice(k.indexOf(':') + 1) } };
    }
    await upsert(body);
  }
  const el = readFileSync(resolve(dir, 'edges.csv'), 'utf8').split('\n').slice(1).filter(Boolean);
  for (let i = 0; i < el.length; i += VB) {
    const body = { edges: {} };
    for (const l of el.slice(i, i + VB)) {
      const [s, d, et, ts] = l.split(',');
      const fromT = vt.get(s), toT = vt.get(d);
      ((((body.edges[fromT] ||= {})[key.get(s)] ||= {})[et] ||= {})[toT] ||= {})[key.get(d)] =
        { ts: { value: ts }, weight: { value: 1 }, decayed: { value: 1 } };
    }
    await upsert(body);
  }
  loadS = +((performance.now() - t0) / 1000).toFixed(2);
  console.log(`upserted ${vl.length} vertices, ${el.length} edges in ${loadS}s`);
}

async function upsert(body) {
  const res = await fetch(`${HOST}${PREFIX}/graph/${GRAPH}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const j = await res.json();
  if (j.error) throw new Error(j.message);
}

async function blast(k) {
  const qs = new URLSearchParams({ id_key: k, window_days: String(WINDOW), max_hops: String(HOPS), hub_degree: '1000000000' });
  const res = await fetch(`${HOST}${PREFIX}/query/${GRAPH}/blast_radius?${qs}`, { headers });
  const j = await res.json();
  if (j.error) throw new Error(j.message);
  const r = j.results[0];
  return { reached: r.identifiers_reached + r.reports_in_window, reports: r.reports_in_window };
}

for (let w = 0; w < WARMUP; w++) await blast(seeds[w % seeds.length]);
const times = [];
const answers = {};
for (let r = 0; r < RUNS; r++) {
  const k = seeds[r % seeds.length];
  const t = performance.now();
  answers[k] = await blast(k);
  times.push(performance.now() - t);
}

const row = {
  dataset: meta.name ?? String(meta.edges), edges: meta.edges, vertices: meta.vertices,
  engine: 'tigergraph (installed GSQL, REST++)',
  query: `blast radius, ${HOPS} hops, ${windowDays}-day window`,
  ...stats(times), load_s: loadS,
  notes: `client wall clock incl. network RTT to ${new URL(HOST).hostname}`,
  answers, machine: { ...machine(), tg_host: new URL(HOST).hostname },
};
console.log(JSON.stringify({ ...row, answers: undefined }, null, 2));
record(row);
