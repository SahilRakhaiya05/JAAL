#!/usr/bin/env node
// Baseline: the same 4-hop, time-windowed blast radius as a plain BFS in
// Node over a CSR adjacency (what the server's memory engine does).
//
//   node tigergraph/bench/run-memory.mjs --edges 200000 [--runs 20] [--warmup 3]
//
// Edges are walked in both directions (MENTIONS is undirected, PAYS_TO is
// walked forwards and backwards, exactly like blast_radius in GSQL).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { arg, dataDir, readSeeds, readMeta, stats, machine, record } from './lib.mjs';

const EDGES = Number(arg('--edges', 200000));
const RUNS = Number(arg('--runs', 20));
const WARMUP = Number(arg('--warmup', 3));
const dir = dataDir(EDGES);
const meta = readMeta(dir);
const { seeds, refTime, windowDays, maxHops: defHops } = readSeeds(dir);
const maxHops = Number(arg('--hops', defHops));
const cutoff = Date.parse(refTime) - windowDays * 86400_000;

const t0 = performance.now();
const vlines = readFileSync(resolve(dir, 'vertices.csv'), 'utf8').split('\n');
const N = meta.vertices;
const keyToVid = new Map();
const isReport = new Uint8Array(N);
for (let i = 1; i < vlines.length; i++) {
  const l = vlines[i];
  if (!l) continue;
  const a = l.indexOf(','), b = l.lastIndexOf(',');
  const id = +l.slice(0, a);
  keyToVid.set(l.slice(a + 1, b), id);
  if (l.slice(b + 1) === 'Report') isReport[id] = 1;
}
const elines = readFileSync(resolve(dir, 'edges.csv'), 'utf8').split('\n');
const M = elines.length - 2;
const src = new Int32Array(M), dst = new Int32Array(M), tms = new Float64Array(M);
const deg = new Int32Array(N + 1);
let m = 0;
for (let i = 1; i < elines.length; i++) {
  const l = elines[i];
  if (!l) continue;
  const p = l.split(',');
  src[m] = +p[0]; dst[m] = +p[1]; tms[m] = Date.parse(p[3].replace(' ', 'T') + 'Z');
  deg[src[m] + 1]++; deg[dst[m] + 1]++;
  m++;
}
for (let i = 0; i < N; i++) deg[i + 1] += deg[i];
const adj = new Int32Array(2 * m), adjT = new Float64Array(2 * m), fill = deg.slice(0, N);
for (let i = 0; i < m; i++) {
  let k = fill[src[i]]++; adj[k] = dst[i]; adjT[k] = tms[i];
  k = fill[dst[i]]++; adj[k] = src[i]; adjT[k] = tms[i];
}
const loadS = (performance.now() - t0) / 1000;

const seen = new Int32Array(N).fill(-1);
let epoch = 0;
function blast(key) {
  const s = keyToVid.get(key);
  if (s === undefined) return { reached: 0, reports: 0 };
  epoch++;
  let frontier = [s];
  seen[s] = epoch;
  let reached = 1, reports = isReport[s];
  for (let h = 0; h < maxHops && frontier.length; h++) {
    const next = [];
    for (const u of frontier) {
      for (let k = deg[u]; k < deg[u + 1]; k++) {
        if (adjT[k] < cutoff) continue;
        const v = adj[k];
        if (seen[v] === epoch) continue;
        seen[v] = epoch;
        next.push(v);
        reached++; reports += isReport[v];
      }
    }
    frontier = next;
  }
  return { reached, reports };
}

for (let w = 0; w < WARMUP; w++) blast(seeds[w % seeds.length]);
const times = [];
const answers = {};
for (let r = 0; r < RUNS; r++) {
  const key = seeds[r % seeds.length];
  const t = performance.now();
  const res = blast(key);
  times.push(performance.now() - t);
  answers[key] = res;
}

const row = {
  engine: 'memory (Node BFS, CSR)',
  dataset: meta.name ?? String(meta.edges), edges: meta.edges, vertices: meta.vertices,
  query: `blast radius, ${maxHops} hops, ${windowDays}-day window`,
  ...stats(times),
  load_s: +loadS.toFixed(2),
  notes: 'in-process, single thread, no persistence',
  answers, machine: machine(),
};
console.log(JSON.stringify({ ...row, answers: undefined }, null, 2));
record(row);
