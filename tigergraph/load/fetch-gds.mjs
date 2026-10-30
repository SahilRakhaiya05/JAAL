#!/usr/bin/env node
// Fetch the two GDS library queries ring detection uses, from the official
// repo (Apache-2.0), into tigergraph/gds/, and pin them to graph JAAL.
//   node tigergraph/load/fetch-gds.mjs [git-ref]      (default ref: master)

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ref = process.argv[2] || 'master';
const base = `https://raw.githubusercontent.com/tigergraph/gsql-graph-algorithms/${ref}/algorithms`;
const files = {
  'tg_wcc.gsql': `${base}/Community/connected_components/weakly_connected_components/standard/tg_wcc.gsql`,
  'tg_louvain.gsql': `${base}/Community/louvain/tg_louvain.gsql`,
};
const out = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'gds');
mkdirSync(out, { recursive: true });

for (const [name, url] of Object.entries(files)) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  let src = await res.text();
  // CREATE QUERY tg_x(...) -> CREATE OR REPLACE QUERY tg_x(...) FOR GRAPH JAAL
  src = src.replace(/CREATE\s+QUERY\s+(tg_\w+)\s*\(([\s\S]*?)\)\s*SYNTAX/i,
    (_, q, params) => `CREATE OR REPLACE QUERY ${q}(${params}) FOR GRAPH JAAL SYNTAX`);
  writeFileSync(resolve(out, name), `USE GRAPH JAAL\n// fetched from ${url}\n${src}`);
  console.log(`wrote gds/${name} (${src.length} bytes)`);
}
