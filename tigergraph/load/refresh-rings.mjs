#!/usr/bin/env node
// Batch ring detection over REST++ (run after loading, then on a schedule):
//   refresh_decay -> tg_wcc -> tg_louvain -> materialize_campaigns -> link_next
//
//   TG_HOST=... TG_TOKEN=... node tigergraph/load/refresh-rings.mjs [--window 90]
//
// tg_wcc / tg_louvain are the GDS library queries (setup.md step 5).
// Their SET<STRING> parameters are passed as repeated query-string keys.

import { GRAPH } from './common.mjs';

const HOST = (process.env.TG_HOST || '').replace(/\/+$/, '');
const PREFIX = process.env.TG_RESTPP_PREFIX ?? '/restpp';
const TOKEN = process.env.TG_TOKEN || '';
const wi = process.argv.indexOf('--window');
const WINDOW = wi >= 0 ? Number(process.argv[wi + 1]) : 90;
if (!HOST || !TOKEN) { console.error('Set TG_HOST and TG_TOKEN.'); process.exit(2); }

// Vertices that take part in community detection. Reporter is excluded on
// purpose (one reporter must not glue rings together); Campaign is output.
const V = ['Report', 'Phone', 'UpiHandle', 'BankAccount', 'Url', 'Domain', 'ApkHash', 'CryptoAddress', 'MessageText'];
// Deterministic links only -> WCC "entities".
const E_HARD = ['MENTIONS', 'PAYS_TO', 'reverse_PAYS_TO', 'RESOLVES_TO', 'HOSTED_ON', 'SAME_TEXT_AS'];
// Plus fuzzy script similarity, decay-weighted -> Louvain "campaigns".
const E_SOFT = [...E_HARD, 'SIMILAR_SCRIPT'];

async function run(query, params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    for (const x of Array.isArray(v) ? v : [v]) qs.append(k, String(x));
  }
  const t0 = performance.now();
  const res = await fetch(`${HOST}${PREFIX}/query/${GRAPH}/${query}?${qs}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, 'GSQL-TIMEOUT': '600000' },
  });
  const json = await res.json().catch(() => ({ error: true, message: `HTTP ${res.status}` }));
  if (json.error) throw new Error(`${query}: ${json.message}`);
  const ms = Math.round(performance.now() - t0);
  console.log(`${query.padEnd(22)} ${String(ms).padStart(6)} ms  ${JSON.stringify(json.results?.[0] ?? {}).slice(0, 160)}`);
  return json.results;
}

await run('refresh_decay', { window_days: WINDOW });
await run('tg_wcc', { v_type_set: V, e_type_set: E_HARD, print_limit: 0, print_results: false, result_attribute: 'wcc_id' });
await run('tg_louvain', { v_type_set: V, e_type_set: E_SOFT, weight_attribute: 'decayed', maximum_iteration: 10, result_attribute: 'community_id', print_stats: false });
await run('materialize_campaigns', {});
await run('link_next', { window_days: 365 });
