#!/usr/bin/env node
// Deterministic synthetic JAAL graph for the blast-radius benchmark.
//
//   node tigergraph/bench/generate.mjs --edges 1000000 [--seed 42] [--bridge 0.03]
//   (--bridge other than 0.03 writes to data/<edges>-b<bridge>/; pass the same name as --data to runners)
//
// Writes bench/data/<edges>/
//   vertices.csv   vid,key,vtype           (vtype: Report|Phone|UpiHandle|BankAccount|Domain)
//   edges.csv      src,dst,etype,ts        (one row per logical edge; MENTIONS is
//                                          Report->identifier, PAYS_TO is Phone->UpiHandle|BankAccount)
//   seeds.json     20 seed keys + the fixed reference time and window
//   meta.json      counts and generator parameters
//
// Shape (what makes it a fraud graph and not a random graph):
//   * rings: 4..40 identifiers (phones, UPI handles, accounts, domains) shared
//     by ~1.5 reports per identifier, each report mentioning 2..4 of them,
//     phones paying into the ring's handles/accounts (PAYS_TO), and 3% of
//     reports bridging into an earlier ring (rings that share a mule account)
//   * noise: one-off reports with 1..2 fresh identifiers, 5% of which also
//     mention one of 300 popular "hub" domains (shorteners, big brands)
//   * timestamps uniform over the 150 days before REF_TIME; the benchmark
//     window is the last 90 days, so roughly 40% of edges are filtered out.

import { mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const TARGET = Number(arg('--edges', 1_000_000));
const SEED = Number(arg('--seed', 42));
const BRIDGE = Number(arg('--bridge', 0.03));   // share of ring reports that also mention a member of an earlier ring
const NAME = BRIDGE === 0.03 ? String(TARGET) : `${TARGET}-b${BRIDGE}`;
export const REF_TIME = Date.parse('2026-10-30T00:00:00Z');
const SPAN_MS = 150 * 86400_000;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const pickArr = (a) => a[Math.floor(rnd() * a.length)];

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), 'data', NAME);
mkdirSync(outDir, { recursive: true });
const vOut = createWriteStream(resolve(outDir, 'vertices.csv'));
const eOut = createWriteStream(resolve(outDir, 'edges.csv'));
vOut.write('vid,key,vtype\n');
eOut.write('src,dst,etype,ts\n');

let vid = 0;
let edges = 0;
const vtypeOf = [];
const keyOf = [];
const counter = { Report: 0, Phone: 0, UpiHandle: 0, BankAccount: 0, Domain: 0 };
const PSP = ['ybl', 'okaxis', 'ibl', 'paytm', 'okhdfcbank', 'axl'];

function newVertex(vtype) {
  const n = counter[vtype]++;
  let key;
  switch (vtype) {
    case 'Report': key = `report:b${n}`; break;
    case 'Phone': key = `phone:+91${String(6000000000 + n * 7 + ri(0, 6))}`; break;
    case 'UpiHandle': key = `upi:h${n.toString(36)}@${pickArr(PSP)}`; break;
    case 'BankAccount': key = `bank_account:${String(50100000000000 + n)}`; break;
    case 'Domain': key = `domain:d${n.toString(36)}-kyc.in`; break;
  }
  const id = vid++;
  vtypeOf[id] = vtype; keyOf[id] = key;
  vOut.write(`${id},${key},${vtype}\n`);
  return id;
}
const ts = () => new Date(REF_TIME - Math.floor(rnd() * SPAN_MS)).toISOString().slice(0, 19).replace('T', ' ');
function edge(src, dst, etype, at) { eOut.write(`${src},${dst},${etype},${at}\n`); edges++; }

function idType() {
  const r = rnd();
  return r < 0.5 ? 'Phone' : r < 0.75 ? 'UpiHandle' : r < 0.85 ? 'BankAccount' : 'Domain';
}

const hubs = Array.from({ length: 300 }, () => newVertex('Domain'));
const rings = [];       // arrays of member vids
const noiseIds = [];

while (edges < TARGET) {
  if (rnd() < 0.6) {
    const size = ri(4, 40);
    const members = Array.from({ length: size }, () => newVertex(idType()));
    const sinks = members.filter((m) => vtypeOf[m] === 'UpiHandle' || vtypeOf[m] === 'BankAccount');
    const nReports = Math.round(size * 1.5);
    for (let r = 0; r < nReports && edges < TARGET; r++) {
      const rep = newVertex('Report');
      const at = ts();
      const k = ri(2, 4);
      const seen = new Set();
      for (let j = 0; j < k; j++) {
        const m = pickArr(members);
        if (seen.has(m)) continue;
        seen.add(m); edge(rep, m, 'MENTIONS', at);
      }
      if (rings.length && rnd() < BRIDGE) edge(rep, pickArr(pickArr(rings)), 'MENTIONS', at);
    }
    if (sinks.length) {
      for (const m of members) {
        if (vtypeOf[m] === 'Phone' && rnd() < 0.5 && edges < TARGET) edge(m, pickArr(sinks), 'PAYS_TO', ts());
      }
    }
    rings.push(members);
  } else {
    for (let r = 0; r < 50 && edges < TARGET; r++) {
      const rep = newVertex('Report');
      const at = ts();
      const k = ri(1, 2);
      for (let j = 0; j < k; j++) { const id = newVertex(idType()); noiseIds.push(id); edge(rep, id, 'MENTIONS', at); }
      if (rnd() < 0.05) edge(rep, pickArr(hubs), 'MENTIONS', at);
    }
  }
}

// 20 seeds: 14 ring members (they have a blast radius) + 6 noise identifiers (they mostly do not)
const seeds = [];
for (let i = 0; i < 14; i++) seeds.push(keyOf[pickArr(pickArr(rings))]);
for (let i = 0; i < 6; i++) seeds.push(keyOf[pickArr(noiseIds)]);

await Promise.all([new Promise((r) => vOut.end(r)), new Promise((r) => eOut.end(r))]);
const meta = {
  name: NAME, edges, vertices: vid, rings: rings.length, hubs: hubs.length, counts: counter, seed: SEED, bridge: BRIDGE,
  refTime: new Date(REF_TIME).toISOString(), windowDays: 90, maxHops: 4,
};
writeFileSync(resolve(outDir, 'seeds.json'), JSON.stringify({ seeds, refTime: meta.refTime, windowDays: 90, maxHops: 4 }, null, 2));
writeFileSync(resolve(outDir, 'meta.json'), JSON.stringify(meta, null, 2));
console.log(JSON.stringify({ outDir, ...meta }, null, 2));
