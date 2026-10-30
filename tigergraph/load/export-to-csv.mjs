#!/usr/bin/env node
// Export a JAAL memory-engine snapshot to the TSV files loading_job.gsql reads.
//
//   node tigergraph/load/export-to-csv.mjs [snapshot.json] [--out dir]
//
// Input  : server/data/graph.json if present, else tigergraph/load/fixture.json
//          (or the path given). Shapes tolerated: see README "Snapshot contract".
// Output : <out>/v_<VertexType>.tsv   header + one row per vertex
//          <out>/e_<EDGE>.tsv         header from_type from_id to_type to_id ts weight [gap_hours]
//          <out>/embeddings.tsv       id <TAB> f1,f2,...,f256   (no header)
// Tab-separated because redacted message text contains commas; tabs and
// newlines inside values are flattened to spaces.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMON, VERTEX_TYPES, EDGE_TYPES, normalizeSnapshot, loadSnapshot } from './common.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outDir = resolve(outIdx >= 0 ? args[outIdx + 1] : resolve(here, 'out'));
const inPath = args.find((a, i) => !a.startsWith('--') && (outIdx < 0 || i !== outIdx + 1));

const clean = (v) => (v === undefined || v === null ? '' : String(v).replace(/[\t\r\n]+/g, ' '));

const { from, snap } = loadSnapshot(inPath);
const { vertices, edges, warnings } = normalizeSnapshot(snap);
mkdirSync(outDir, { recursive: true });

const counts = {};
for (const [vtype, def] of Object.entries(VERTEX_TYPES)) {
  const cols = ['id', ...COMMON, ...def.extras];
  const rows = [cols.join('\t')];
  for (const v of vertices.values()) {
    if (v.vtype !== vtype) continue;
    rows.push(cols.map((c) => clean(c === 'id' ? v.id : v.attrs[c])).join('\t'));
  }
  writeFileSync(resolve(outDir, `v_${vtype}.tsv`), rows.join('\n') + '\n');
  counts[vtype] = rows.length - 1;
}

for (const [etype, def] of Object.entries(EDGE_TYPES)) {
  const cols = ['from_type', 'from_id', 'to_type', 'to_id', 'ts', 'weight', ...(def.extras || [])];
  const rows = [cols.join('\t')];
  for (const e of edges) {
    if (e.etype !== etype) continue;
    rows.push([e.fromType, e.from, e.toType, e.to, e.attrs.ts, e.attrs.weight, ...(def.extras || []).map((x) => e.attrs[x])]
      .map(clean).join('\t'));
  }
  writeFileSync(resolve(outDir, `e_${etype}.tsv`), rows.join('\n') + '\n');
  counts[etype] = rows.length - 1;
}

const emb = [];
for (const v of vertices.values()) if (v.vtype === 'MessageText' && v.embedding) emb.push(`${v.id}\t${v.embedding.join(',')}`);
writeFileSync(resolve(outDir, 'embeddings.tsv'), emb.join('\n') + (emb.length ? '\n' : ''));
counts.embeddings = emb.length;

console.log(JSON.stringify({ from, outDir, counts, warnings: warnings.slice(0, 20), warningCount: warnings.length }, null, 2));
