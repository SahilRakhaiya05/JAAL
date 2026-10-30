#!/usr/bin/env node
// Upsert a JAAL snapshot straight into TigerGraph through REST++.
//
//   TG_HOST=https://<workspace>.i.tgcloud.io TG_TOKEN=<token> \
//     node tigergraph/load/push-restpp.mjs [snapshot.json] [--dry-run] [--batch 500]
//
// POST {TG_HOST}/restpp/graph/{TG_GRAPH}  (Authorization: Bearer TG_TOKEN)
// Payload is the standard upsert JSON:
//   { "vertices": { "<VType>": { "<id>": { "<attr>": {"value": ...} } } },
//     "edges":    { "<FromType>": { "<fromId>": { "<EDGE>": { "<ToType>": { "<toId>": { "<attr>": {"value": ...} } } } } } } }
// Vector attributes go in the same JSON as a list value (TigerVector, 4.2+);
// set TG_VECTORS=0 to skip them on 4.1.
// Savanna serves REST++ on 443 under /restpp. A self-hosted 4.x node serves it
// on 14240/restpp (nginx) or directly on 9000 (then use TG_HOST=http://host:9000
// and TG_RESTPP_PREFIX="").

import { normalizeSnapshot, loadSnapshot, GRAPH } from './common.mjs';

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const bi = args.indexOf('--batch');
const BATCH = bi >= 0 ? Number(args[bi + 1]) : 500;
const inPath = args.find((a, i) => !a.startsWith('--') && (bi < 0 || i !== bi + 1));
const HOST = (process.env.TG_HOST || '').replace(/\/+$/, '');
const PREFIX = process.env.TG_RESTPP_PREFIX ?? '/restpp';
const TOKEN = process.env.TG_TOKEN || '';
const VECTORS = process.env.TG_VECTORS !== '0';

if (!dry && (!HOST || !TOKEN)) {
  console.error('Set TG_HOST and TG_TOKEN (or pass --dry-run to print the first payload).');
  process.exit(2);
}

const wrap = (attrs) => Object.fromEntries(
  Object.entries(attrs).filter(([, v]) => v !== '' && v !== undefined && v !== null).map(([k, v]) => [k, { value: v }]),
);

const { from, snap } = loadSnapshot(inPath);
const { vertices, edges, warnings } = normalizeSnapshot(snap);

function* chunks(arr, n) { for (let i = 0; i < arr.length; i += n) yield arr.slice(i, i + n); }

async function post(body) {
  if (dry) return { dry: true };
  const res = await fetch(`${HOST}${PREFIX}/graph/${GRAPH}?vertex_must_exist=false`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({ error: true, message: `HTTP ${res.status}` }));
  if (!res.ok || json.error) throw new Error(`upsert failed: ${res.status} ${json.message || JSON.stringify(json).slice(0, 300)}`);
  return json.results?.[0] || json;
}

const total = { vertices: 0, edges: 0 };
let first = true;

for (const part of chunks([...vertices.values()], BATCH)) {
  const body = { vertices: {} };
  for (const v of part) {
    const attrs = wrap(v.attrs);
    if (VECTORS && v.embedding) attrs.embedding = { value: v.embedding };
    (body.vertices[v.vtype] ||= {})[v.id] = attrs;
  }
  if (dry && first) { console.log(JSON.stringify(body, null, 2).slice(0, 4000)); first = false; }
  const r = await post(body);
  total.vertices += r.accepted_vertices ?? part.length;
}

for (const part of chunks(edges, BATCH)) {
  const body = { edges: {} };
  for (const e of part) {
    const byFrom = ((body.edges[e.fromType] ||= {})[e.from] ||= {});
    const byEdge = (byFrom[e.etype] ||= {});
    (byEdge[e.toType] ||= {})[e.to] = wrap({ ...e.attrs, decayed: e.attrs.weight });
  }
  if (dry && first) { console.log(JSON.stringify(body, null, 2).slice(0, 4000)); first = false; }
  const r = await post(body);
  total.edges += r.accepted_edges ?? part.length;
}

console.log(JSON.stringify({ from, graph: GRAPH, host: HOST || '(dry run)', ...total, warnings: warnings.length }, null, 2));
