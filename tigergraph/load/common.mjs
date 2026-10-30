// Shared schema metadata + snapshot normaliser for the JAAL TigerGraph lane.
// Single source of truth for: CSV column order (export-to-csv.mjs), the
// generated loading job (gen-loading-job.mjs) and REST++ upserts
// (push-restpp.mjs). Mirrors tigergraph/schema.gsql; keep them in sync.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const GRAPH = process.env.TG_GRAPH || 'JAAL';

// Attributes every vertex type carries, in schema order (after PRIMARY_ID id).
// wcc_id / community_id follow these in the schema; they are written by GDS
// algorithms, never loaded, so they are not listed here.
export const COMMON = ['value', 'state', 'report_count', 'first_seen', 'last_seen', 'source', 'trust', 'city'];

// Type-specific attributes, in schema order, after wcc_id / community_id.
export const VERTEX_TYPES = {
  Report: { extras: ['ts', 'surface', 'verdict', 'lang'], state: 'pending', reports: 1 },
  Reporter: { extras: ['cluster'], state: 'active', reports: 0 },
  Phone: { extras: ['country'], state: 'clear', reports: 0 },
  UpiHandle: { extras: ['psp'], state: 'clear', reports: 0 },
  BankAccount: { extras: ['ifsc'], state: 'clear', reports: 0 },
  Url: { extras: ['shortener'], state: 'clear', reports: 0 },
  Domain: { extras: ['brand_target'], state: 'clear', reports: 0 },
  ApkHash: { extras: ['sha256'], state: 'clear', reports: 0 },
  CryptoAddress: { extras: ['chain'], state: 'clear', reports: 0 },
  MessageText: { extras: ['lang'], state: 'clear', reports: 0 },
  ScamPattern: { extras: ['kind'], state: 'clear', reports: 0 },
  Campaign: { extras: ['name', 'pattern', 'size', 'cluster_count', 'anchor'], state: 'reported', reports: 0 },
};

const IDS = ['Phone', 'UpiHandle', 'BankAccount', 'Url', 'Domain', 'ApkHash', 'CryptoAddress'];

// Edge types: direction + allowed (FROM, TO) pairs, extras after ts/weight/decayed.
export const EDGE_TYPES = {
  REPORTED: { directed: true, pairs: [['Reporter', 'Report']] },
  MENTIONS: { directed: false, pairs: IDS.map((t) => ['Report', t]) },
  MATCHES_PATTERN: { directed: false, pairs: [['Report', 'ScamPattern']] },
  PAYS_TO: {
    directed: true,
    pairs: [
      ['Phone', 'UpiHandle'], ['Phone', 'BankAccount'], ['Phone', 'CryptoAddress'],
      ['UpiHandle', 'UpiHandle'], ['UpiHandle', 'BankAccount'], ['UpiHandle', 'CryptoAddress'],
    ],
  },
  RESOLVES_TO: { directed: false, pairs: [['Url', 'Domain']] },
  HOSTED_ON: { directed: false, pairs: [['ApkHash', 'Url'], ['ApkHash', 'Domain']] },
  SAME_TEXT_AS: { directed: false, pairs: [['Report', 'MessageText']] },
  SIMILAR_SCRIPT: { directed: false, pairs: [['MessageText', 'MessageText']] },
  NEXT: { directed: true, pairs: [['Report', 'Report']], extras: ['gap_hours'] },
  IN_CAMPAIGN: {
    directed: true,
    pairs: ['Report', 'MessageText', ...IDS].map((t) => [t, 'Campaign']),
  },
};

// Canonical key prefix (shared/extract.js types + graph-only types) -> vertex type.
export const PREFIX_TO_VTYPE = {
  phone: 'Phone', upi: 'UpiHandle', bank_account: 'BankAccount', url: 'Url', domain: 'Domain',
  apk: 'ApkHash', crypto: 'CryptoAddress', text: 'MessageText',
  pattern: 'ScamPattern', remote_app: 'ScamPattern', ifsc: 'ScamPattern',
  report: 'Report', reporter: 'Reporter', campaign: 'Campaign', ring: 'Campaign',
};

const VTYPE_ALIASES = Object.fromEntries([
  ...Object.keys(VERTEX_TYPES).map((t) => [t.toLowerCase(), t]),
  ...Object.entries(PREFIX_TO_VTYPE),
  ['bankaccount', 'BankAccount'], ['upihandle', 'UpiHandle'], ['apkhash', 'ApkHash'],
  ['cryptoaddress', 'CryptoAddress'], ['messagetext', 'MessageText'], ['scampattern', 'ScamPattern'],
  ['message', 'MessageText'], ['account', 'BankAccount'],
]);

export function vtypeOf(id, hint) {
  if (hint) {
    const t = VTYPE_ALIASES[String(hint).toLowerCase()];
    if (t) return t;
  }
  const s = String(id);
  const i = s.indexOf(':');
  if (i > 0) {
    const t = PREFIX_TO_VTYPE[s.slice(0, i).toLowerCase()];
    if (t) return t;
  }
  return null;
}

/** "2026-10-30 09:15:00" (UTC) - the DATETIME literal format GSQL loaders and REST++ accept. */
export function tgDatetime(v) {
  if (v === undefined || v === null || v === '') return '';
  let d;
  if (typeof v === 'number') d = new Date(v < 1e12 ? v * 1000 : v);
  else d = new Date(String(v).includes('T') || /Z$/.test(String(v)) ? v : String(v).replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function pick(o, ...keys) {
  for (const k of keys) if (o && o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
}

/**
 * Deterministic 256-d hashed character-trigram embedding, L2-normalised.
 * FALLBACK ONLY: used when a snapshot text has no embedding. If the server
 * lane ships its own embedding in graph.json, that one wins, so query vectors
 * from the server and stored vectors always come from the same function.
 */
export function hashedEmbedding(text, dim = 256) {
  const v = new Float64Array(dim);
  const s = ` ${String(text || '').toLowerCase().replace(/\s+/g, ' ')} `;
  for (let i = 0; i + 3 <= s.length; i++) {
    let h = 0x811c9dc5;
    for (let j = i; j < i + 3; j++) { h ^= s.charCodeAt(j); h = Math.imul(h, 0x01000193) >>> 0; }
    v[h % dim] += (h & 0x80000000) ? -1 : 1;
  }
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return Array.from(v, (x) => Math.round((x / n) * 1e6) / 1e6);
}

/**
 * Normalise a memory-engine snapshot (several tolerated shapes, see README
 * "Snapshot contract") into { vertices: Map<id, {vtype, attrs, embedding?}>, edges: [] }.
 */
export function normalizeSnapshot(snap) {
  const vertices = new Map();
  const edges = [];
  const warnings = [];

  const upsertV = (id, vtypeHint, o = {}) => {
    if (!id) return null;
    const vtype = vtypeOf(id, vtypeHint);
    if (!vtype) { warnings.push(`skip vertex with unknown type: ${id}`); return null; }
    const cur = vertices.get(id) || { id, vtype, attrs: {} };
    const a = cur.attrs;
    const set = (k, v) => { if (v !== undefined && v !== null && v !== '') a[k] = v; };
    set('value', pick(o, 'value', 'label', 'text') ?? (String(id).includes(':') ? String(id).slice(String(id).indexOf(':') + 1) : id));
    set('state', pick(o, 'state'));
    set('report_count', pick(o, 'report_count', 'reportCount', 'reports'));
    set('first_seen', tgDatetime(pick(o, 'first_seen', 'firstSeen', 'ts', 'createdAt')));
    set('last_seen', tgDatetime(pick(o, 'last_seen', 'lastSeen', 'ts', 'updatedAt')));
    set('source', pick(o, 'source', 'feed'));
    set('trust', pick(o, 'trust', 'trustScore'));
    set('city', pick(o, 'city'));
    for (const x of VERTEX_TYPES[vtype].extras) {
      const camel = x.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      let v = pick(o, x, camel);
      if (x === 'ts') v = tgDatetime(v);
      if (x === 'size' && Array.isArray(o.members)) v = v ?? o.members.length;
      set(x, v);
    }
    const emb = pick(o, 'embedding', 'vector');
    if (Array.isArray(emb)) cur.embedding = emb;
    vertices.set(id, cur);
    return cur;
  };

  const addE = (etypeHint, from, to, o = {}) => {
    let a = vertices.get(from) || (vtypeOf(from) && upsertV(from));
    let b = vertices.get(to) || (vtypeOf(to) && upsertV(to));
    if (!a || !b) { warnings.push(`skip edge ${etypeHint} ${from} -> ${to}: unknown endpoint`); return; }
    let etype = etypeHint ? String(etypeHint).toUpperCase() : inferEdgeType(a.vtype, b.vtype);
    if (etype === 'MENTIONS' && (a.vtype === 'ScamPattern' || b.vtype === 'ScamPattern')) etype = 'MATCHES_PATTERN';
    const def = EDGE_TYPES[etype];
    if (!def) { warnings.push(`skip edge of unknown type ${etypeHint}`); return; }
    const ok = (x, y) => def.pairs.some(([f, t]) => f === x.vtype && t === y.vtype);
    if (!ok(a, b)) {
      if (ok(b, a) && (!def.directed || etype === 'MENTIONS' || etype === 'IN_CAMPAIGN' || etype === 'REPORTED')) [a, b] = [b, a];
      else { warnings.push(`skip edge ${etype} ${a.vtype}->${b.vtype} (not in schema)`); return; }
    }
    const attrs = {
      ts: tgDatetime(pick(o, 'ts', 'at', 'createdAt')) || a.attrs.first_seen || b.attrs.first_seen || '',
      weight: Number(pick(o, 'weight', 'w', 'cosine') ?? 1),
    };
    if (etype === 'NEXT') attrs.gap_hours = Number(pick(o, 'gap_hours', 'gapHours') ?? 0);
    edges.push({ etype, from: a.id, fromType: a.vtype, to: b.id, toType: b.vtype, attrs });
  };

  // 1. vertices: array or id-keyed map, under nodes | vertices
  const vs = pick(snap, 'vertices', 'nodes') || [];
  const vlist = Array.isArray(vs) ? vs : Object.entries(vs).map(([id, v]) => ({ id, ...v }));
  for (const v of vlist) {
    // server memory-engine snapshot (server/src/graph/memory.js toJSON):
    //   { id, type, first: epochMs, last: epochMs, checks, src: [..], a: { trust, city, ts, verdict, text, vec, net, ... } }
    const o = v.a && typeof v.a === 'object'
      ? { ...v.a, ...v, first_seen: v.first ?? v.first_seen, last_seen: v.last ?? v.last_seen,
          source: Array.isArray(v.src) ? v.src.join(',') : v.src, cluster: v.a.cluster ?? v.a.net,
          embedding: v.a.vec ?? v.a.embedding, value: v.a.text ?? v.a.value }
      : v;
    upsertV(pick(v, 'id', 'key'), pick(v, 'vtype', 'vertexType', 'type'), o);
  }

  // 2. higher-level collections the memory engine may keep instead of raw edges
  for (const r of pick(snap, 'reporters') || []) upsertV(r.id.startsWith('reporter:') ? r.id : `reporter:${r.id}`, 'Reporter', r);
  for (const t of pick(snap, 'texts', 'messages') || []) upsertV(t.id, 'MessageText', t);
  for (const r of pick(snap, 'reports') || []) {
    const rid = String(r.id).startsWith('report:') ? r.id : `report:${r.id}`;
    upsertV(rid, 'Report', { ...r, value: r.value ?? r.surface ?? 'report' });
    if (r.reporter) {
      const pid = String(r.reporter).startsWith('reporter:') ? r.reporter : `reporter:${r.reporter}`;
      if (!vertices.has(pid)) upsertV(pid, 'Reporter', { cluster: pid });
      addE('REPORTED', pid, rid, r);
    }
    for (const x of r.identifiers || []) {
      const key = typeof x === 'string' ? x : x.key || `${x.type}:${x.value}`;
      if (!vertices.has(key)) upsertV(key, null, typeof x === 'object' ? x : {});
      addE('MENTIONS', rid, key, r);
    }
    const tk = pick(r, 'textKey', 'text_key', 'textId');
    if (tk) addE('SAME_TEXT_AS', rid, tk, r);
  }
  for (const c of pick(snap, 'campaigns') || []) {
    upsertV(c.id, 'Campaign', c);
    for (const m of c.members || []) addE('IN_CAMPAIGN', typeof m === 'string' ? m : m.id, c.id, c);
  }

  // 3. raw edges
  for (const e0 of pick(snap, 'edges', 'links') || []) {
    // memory-engine tuple form: [type, source, target, ts, first, n, weight, src]
    const e = Array.isArray(e0) ? { type: e0[0], from: e0[1], to: e0[2], ts: e0[3], weight: e0[6] ?? 1 } : e0;
    addE(pick(e, 'type', 'etype', 'label'), pick(e, 'from', 'source', 'src'), pick(e, 'to', 'target', 'dst'), e);
  }

  // derive report counts / seen times / state from the evidence when the snapshot omitted them
  const derived = new Map();
  for (const e of edges) {
    if (e.etype !== 'MENTIONS' && e.etype !== 'MATCHES_PATTERN' && e.etype !== 'SAME_TEXT_AS') continue;
    const d = derived.get(e.to) || { n: 0, first: '', last: '' };
    d.n += 1;
    if (e.attrs.ts && (!d.first || e.attrs.ts < d.first)) d.first = e.attrs.ts;
    if (e.attrs.ts && e.attrs.ts > d.last) d.last = e.attrs.ts;
    derived.set(e.to, d);
  }
  const confirmedMembers = new Set();
  for (const e of edges) {
    if (e.etype === 'IN_CAMPAIGN' && vertices.get(e.to)?.attrs.state === 'confirmed') confirmedMembers.add(e.from);
  }
  for (const [id, d] of derived) {
    const v = vertices.get(id);
    if (!v) continue;
    v.attrs.report_count ??= d.n;
    v.attrs.first_seen ||= d.first;
    v.attrs.last_seen ||= d.last;
    if (v.attrs.state === undefined && d.n > 0) v.attrs.state = confirmedMembers.has(id) ? 'confirmed' : 'reported';
  }

  // fill defaults
  for (const v of vertices.values()) {
    const def = VERTEX_TYPES[v.vtype];
    v.attrs.state ??= def.state;
    v.attrs.report_count ??= def.reports;
    if (v.vtype === 'Report') v.attrs.first_seen ||= v.attrs.ts, v.attrs.last_seen ||= v.attrs.ts, v.attrs.ts ||= v.attrs.first_seen;
    if (v.vtype === 'Reporter') v.attrs.cluster ??= v.id;
    if (v.vtype === 'MessageText' && !v.embedding) v.embedding = hashedEmbedding(v.attrs.value);
  }
  return { vertices, edges, warnings };
}

function inferEdgeType(a, b) {
  const has = (et) => EDGE_TYPES[et].pairs.some(([f, t]) => (f === a && t === b) || (f === b && t === a));
  for (const et of ['REPORTED', 'MENTIONS', 'MATCHES_PATTERN', 'RESOLVES_TO', 'HOSTED_ON', 'SAME_TEXT_AS', 'SIMILAR_SCRIPT', 'IN_CAMPAIGN', 'PAYS_TO', 'NEXT']) {
    if (has(et)) return et;
  }
  return null;
}

/** Load graph.json from the server lane, else the lane's own fixture. */
export function loadSnapshot(path) {
  const candidates = path ? [path] : [
    new URL('../../server/data/graph.json', import.meta.url),
    new URL('./fixture.json', import.meta.url),
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      return { from: c instanceof URL ? fileURLToPath(c) : String(c), snap: JSON.parse(readFileSync(c, 'utf8')) };
    }
  }
  throw new Error('no snapshot found (server/data/graph.json or load/fixture.json)');
}
