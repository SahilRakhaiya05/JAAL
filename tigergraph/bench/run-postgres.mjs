#!/usr/bin/env node
// Postgres side of the receipt: the same time-windowed k-hop blast radius as a
// recursive CTE, timed over 20 runs (p50 / p95).
//
//   PG_URL=postgres://jaal@localhost:55432/postgres \
//     node tigergraph/bench/run-postgres.mjs --edges 200000 [--hops 4] [--runs 20] [--skip-load]
//
// Loads bench/data/<edges>/ with server-side COPY (the CSV must be readable by
// the Postgres server process, i.e. same machine; for Docker mount the data dir
// and pass --copy-dir /mounted/path). Builds adj (both directions) + index
// (src, ts) INCLUDE (dst), ANALYZE, then runs the query.
// Each query has a statement_timeout (--timeout-ms, default 60000); a timeout
// is recorded as such, never as a number.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { arg, dataDir, readSeeds, readMeta, stats, machine, record, BENCH_DIR } from './lib.mjs';

const EDGES = Number(arg('--edges', 200000));
const RUNS = Number(arg('--runs', 20));
const WARMUP = Number(arg('--warmup', 3));
const TIMEOUT = Number(arg('--timeout-ms', 60000));
const SKIP_LOAD = process.argv.includes('--skip-load');
const dir = dataDir(EDGES);
const copyDir = (arg('--copy-dir', dir)).replace(/\\/g, '/');
const meta = readMeta(dir);
const { seeds, refTime, windowDays, maxHops: defHops } = readSeeds(dir);
const HOPS = Number(arg('--hops', defHops));
const cutoff = new Date(Date.parse(refTime) - windowDays * 86400_000).toISOString().slice(0, 19).replace('T', ' ');

const client = new pg.Client({ connectionString: process.env.PG_URL || 'postgres://jaal@localhost:55432/postgres' });
await client.connect();
const { rows: [{ version }] } = await client.query('select version()');

let loadS = null;
if (!SKIP_LOAD) {
  const t0 = performance.now();
  await client.query(readFileSync(resolve(BENCH_DIR, 'postgres', 'schema.sql'), 'utf8'));
  await client.query(`COPY identifiers (vid, key, vtype) FROM '${copyDir}/vertices.csv' WITH (FORMAT csv, HEADER true)`);
  await client.query(`COPY edges (src, dst, etype, ts) FROM '${copyDir}/edges.csv' WITH (FORMAT csv, HEADER true)`);
  await client.query(`INSERT INTO adj SELECT src, dst, etype, ts, weight FROM edges
                      UNION ALL SELECT dst, src, etype, ts, weight FROM edges`);
  await client.query('CREATE INDEX adj_src_ts ON adj (src, ts) INCLUDE (dst)');
  await client.query('ANALYZE');
  loadS = +((performance.now() - t0) / 1000).toFixed(2);
  console.log(`loaded ${meta.edges} edges in ${loadS}s`);
}

const SQL = `
WITH RECURSIVE walk(vid, depth) AS (
    SELECT vid, 0 FROM identifiers WHERE key = $1
  UNION
    SELECT a.dst, w.depth + 1
    FROM walk w JOIN adj a ON a.src = w.vid
    WHERE w.depth < $2 AND a.ts >= $3
)
SELECT count(DISTINCT w.vid)::int                                   AS reached,
       count(DISTINCT w.vid) FILTER (WHERE i.vtype = 'Report')::int AS reports
FROM walk w JOIN identifiers i USING (vid)`;

await client.query(`SET statement_timeout = ${TIMEOUT}`);
const run = (key) => client.query({ name: 'blast', text: SQL, values: [key, HOPS, cutoff] });

for (let w = 0; w < WARMUP; w++) await run(seeds[w % seeds.length]).catch(() => {});

const times = [];
const answers = {};
let timeouts = 0;
for (let r = 0; r < RUNS; r++) {
  const key = seeds[r % seeds.length];
  const t = performance.now();
  try {
    const { rows: [res] } = await run(key);
    times.push(performance.now() - t);
    answers[key] = res;
  } catch (e) {
    if (/statement timeout/i.test(e.message)) { timeouts++; answers[key] = { timeout: TIMEOUT }; }
    else throw e;
  }
}
await client.end();

if (!times.length) {
  console.log(`all ${RUNS} runs hit the ${TIMEOUT} ms statement_timeout; nothing recorded as a latency`);
}
const row = {
  engine: `postgres ${version.split(' ')[1]} (recursive CTE)`,
  dataset: meta.name ?? String(meta.edges), edges: meta.edges, vertices: meta.vertices,
  query: `blast radius, ${HOPS} hops, ${windowDays}-day window`,
  ...(times.length ? stats(times) : { runs: 0, p50_ms: 'timeout', p95_ms: 'timeout', mean_ms: 'timeout' }),
  load_s: loadS,
  notes: `index adj(src,ts) INCLUDE(dst); ${timeouts ? `${timeouts}/${RUNS} runs > ${TIMEOUT} ms timeout (excluded)` : 'no timeouts'}`,
  answers, machine: { ...machine(), postgres: version },
};
console.log(JSON.stringify({ ...row, answers: undefined }, null, 2));
record(row);
