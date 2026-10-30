// Shared helpers for the blast-radius benchmark runners.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

export const BENCH_DIR = dirname(fileURLToPath(import.meta.url));
export const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };

export function dataDir(edges) {
  const d = resolve(BENCH_DIR, 'data', String(arg('--data', edges)));
  if (!existsSync(resolve(d, 'edges.csv'))) throw new Error(`no data in ${d}; run: node bench/generate.mjs --edges ${edges}`);
  return d;
}

export function readSeeds(dir) { return JSON.parse(readFileSync(resolve(dir, 'seeds.json'), 'utf8')); }
export function readMeta(dir) { return JSON.parse(readFileSync(resolve(dir, 'meta.json'), 'utf8')); }

export function stats(ms) {
  const s = [...ms].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
  return {
    runs: s.length,
    p50_ms: +q(50).toFixed(3),
    p95_ms: +q(95).toFixed(3),
    mean_ms: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(3),
    min_ms: +s[0].toFixed(3),
    max_ms: +s[s.length - 1].toFixed(3),
  };
}

export function machine() {
  return { cpu: os.cpus()[0]?.model, cores: os.cpus().length, ramGB: Math.round(os.totalmem() / 2 ** 30), os: `${os.platform()} ${os.release()}`, node: process.version };
}

const RESULTS = resolve(BENCH_DIR, 'results.json');

/** Append/replace one engine+size row in results.json and print the markdown table. */
export function record(row) {
  const all = existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, 'utf8')) : { runs: [] };
  all.runs = all.runs.filter((r) => !(r.engine === row.engine && r.dataset === row.dataset && r.query === row.query));
  all.runs.push({ ...row, recordedAt: new Date().toISOString() });
  const hops = (q) => Number((q.match(/(\d+) hops/) || [])[1] || 0);
  all.runs.sort((a, b) => a.edges - b.edges || String(a.dataset).localeCompare(String(b.dataset)) || hops(a.query) - hops(b.query) || a.engine.localeCompare(b.engine));
  writeFileSync(RESULTS, JSON.stringify(all, null, 2));
  console.log('\n' + markdown(all));
  return all;
}

export function markdown(all) {
  const lines = [
    '| dataset | engine | edges | vertices | query | runs | p50 ms | p95 ms | mean ms | avg reached | load s | notes |',
    '|---|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---|',
  ];
  for (const r of all.runs) {
    const reached = Object.values(r.answers || {}).filter((a) => a.reached !== undefined);
    const avg = reached.length ? (reached.reduce((x, a) => x + a.reached, 0) / reached.length).toFixed(1) : '';
    lines.push(`| ${r.dataset ?? r.edges} | ${r.engine} | ${r.edges.toLocaleString('en-US')} | ${r.vertices.toLocaleString('en-US')} | ${r.query} | ${r.runs} | ${r.p50_ms} | ${r.p95_ms} | ${r.mean_ms} | ${avg} | ${r.load_s ?? ''} | ${r.notes ?? ''} |`);
  }
  return lines.join('\n');
}
