// In-memory graph engine. The demo runs on this, so it implements the full schema and all
// six queries natively. Typed vertices, typed timestamped edges, adjacency sets, a
// 21-day half-life on every weight, 90-day query windows, and a debounced JSON snapshot.
import path from 'node:path';
import {
  V, E, VERTEX_OF, IDENTIFIER_VERTICES, PAYABLE, DETERMINISTIC, HUB_DOMAINS, HUB_DEGREE_CAP, SHARED_HOSTING, PATTERNS,
  keyOf, typeOfKey, valueOfKey, labelOf, triage, registrable, normUrl
} from './model.js';
import { wcc, louvain } from './louvain.js';
import { embed, cosine, shingles, jaccard, imitation, stem, BRANDS, BRAND_DOMAINS } from './similarity.js';
import { decideState } from '../verdict.js';
import { TRUST, REPORTS_PER_HOUR, CLUSTER_WINDOW_MS, adjustTrust } from '../trust.js';
import { sanitizeText } from '../privacy.js';
import { JsonFile, sha256, randomId, decay, withinWindow, round, DEFAULT_WINDOW_DAYS } from '../util.js';

const SCRIPT_SIMILAR = 0.8; // cosine at or above: SIMILAR_SCRIPT edge between two scripts
const RING_MAX_NODES = 40;
const EDGE_RANK = [E.PAYS_TO, E.RESOLVES_TO, E.HOSTED_ON, E.SAME_TEXT_AS, E.MENTIONS, E.SIMILAR_SCRIPT];
// Projection weights: how strongly each relation says "same operation".
const PROJ_WEIGHT = { [E.MENTIONS]: 1, [E.PAYS_TO]: 2, [E.RESOLVES_TO]: 2, [E.HOSTED_ON]: 2, [E.SAME_TEXT_AS]: 1.5, [E.SIMILAR_SCRIPT]: 1 };

/** True when every source that touched this vertex is the labelled demo seed. */
const demoOnly = (x) => Array.isArray(x.src) && x.src.length > 0 && x.src.every((t) => t === 'demo');

export class MemoryGraph {
  constructor({ dataDir, persist = true, now = () => Date.now() } = {}) {
    this.name = 'memory';
    this.now = now;
    this.store = new JsonFile(path.join(dataDir || '.', 'graph.json'), null, { persist: persist && !!dataDir, delayMs: 500 });
    this.v = new Map(); // id -> vertex
    this.e = new Map(); // "TYPE|src|dst" -> edge
    this.adj = new Map(); // id -> Set(edge keys), both directions
    this.netIndex = new Map(); // /24 network hash -> Map(reporterId -> last report ts)
    this.meta = { checks: 0, disputes: [] };
    this.structRev = 0; // bumps on anything that can change a verdict
    this.cache = { rev: -1 };
    if (this.store.data) this.#load(this.store.data);
  }

  // ---------------------------------------------------------------- storage

  #load(data) {
    this.meta = { checks: 0, disputes: [], ...data.meta };
    for (const x of data.vertices || []) {
      this.v.set(x.id, x);
      this.adj.set(x.id, new Set());
    }
    for (const [type, s, t, ts, first, n, w, src] of data.edges || []) this.#putEdge({ type, s, t, ts, first, n, w, src });
    for (const x of this.v.values()) {
      if (x.type === V.Reporter && x.a.net) this.#netSeen(x.a.net, x.id, x.a.lastReport || 0);
    }
  }

  snapshot() {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      meta: this.meta,
      vertices: [...this.v.values()],
      edges: [...this.e.values()].map((e) => [e.type, e.s, e.t, e.ts, e.first, e.n, e.w ?? null, e.src ?? null])
    };
  }

  save() {
    if (!this.store.persist || this.store.timer) return;
    this.store.timer = setTimeout(() => this.flush(), this.store.delayMs);
    this.store.timer.unref?.();
  }

  flush() {
    this.store.flush(this.snapshot());
  }

  #touch() {
    this.structRev++;
    this.save();
  }

  // ---------------------------------------------------------------- primitives

  upsertVertex(id, type, ts, src) {
    let x = this.v.get(id);
    if (!x) {
      x = { id, type, first: ts, last: ts, checks: 0, src: [], a: {} };
      this.v.set(id, x);
      this.adj.set(id, new Set());
    } else {
      if (ts < x.first) x.first = ts;
      if (ts > x.last) x.last = ts;
    }
    if (src && !x.src.includes(src)) x.src.push(src);
    return x;
  }

  #putEdge(e) {
    const k = `${e.type}|${e.s}|${e.t}`;
    this.e.set(k, e);
    this.adj.get(e.s)?.add(k);
    this.adj.get(e.t)?.add(k);
    return e;
  }

  addEdge(type, s, t, ts, { w, src } = {}) {
    if (s === t || !this.v.has(s) || !this.v.has(t)) return null;
    const existing = this.e.get(`${type}|${s}|${t}`);
    if (existing) {
      existing.ts = Math.max(existing.ts, ts);
      existing.first = Math.min(existing.first, ts);
      existing.n++;
      if (w != null) existing.w = Math.max(existing.w ?? 0, w);
      return existing;
    }
    return this.#putEdge({ type, s, t, ts, first: ts, n: 1, w: w ?? null, src: src ?? null });
  }

  *edgesOf(id, type) {
    for (const k of this.adj.get(id) || []) {
      const e = this.e.get(k);
      if (e && (!type || e.type === type)) yield e;
    }
  }

  #removeVertex(id) {
    for (const k of this.adj.get(id) || []) {
      const e = this.e.get(k);
      if (!e) continue;
      this.e.delete(k);
      this.adj.get(e.s === id ? e.t : e.s)?.delete(k);
    }
    this.adj.delete(id);
    this.v.delete(id);
  }

  // ---------------------------------------------------------------- reporters

  reporter(hash, { net, ts = this.now(), src } = {}) {
    const id = `reporter:${hash}`;
    const isNew = !this.v.has(id);
    const r = this.upsertVertex(id, V.Reporter, ts, src);
    if (isNew) r.a = { trust: TRUST.start, parent: id, recent: [], reports: 0 };
    if (net) r.a.net = net;
    return r;
  }

  /** Union-find root: the independent cluster a reporter belongs to. */
  clusterOf(reporterId) {
    let x = this.v.get(reporterId);
    if (!x) return reporterId;
    const path = [];
    while (x.a.parent && x.a.parent !== x.id && this.v.has(x.a.parent)) {
      path.push(x);
      x = this.v.get(x.a.parent);
    }
    for (const p of path) p.a.parent = x.id;
    return x.id;
  }

  #union(a, b) {
    const ra = this.clusterOf(a);
    const rb = this.clusterOf(b);
    if (ra !== rb) this.v.get(ra > rb ? ra : rb).a.parent = ra > rb ? rb : ra;
  }

  #netSeen(net, reporterId, ts) {
    if (!this.netIndex.has(net)) this.netIndex.set(net, new Map());
    this.netIndex.get(net).set(reporterId, ts);
  }

  adjustReporterTrust(reporterIds, delta) {
    for (const id of new Set(reporterIds)) {
      const r = this.v.get(id);
      if (r) r.a.trust = adjustTrust(r.a.trust, delta);
    }
    this.#touch();
  }

  // ---------------------------------------------------------------- writes

  /** A check is a read that leaves a footprint: identifiers become vertices, counters move. */
  recordCheck(identifiers, { reporterHash, net, ts = this.now(), src = 'user' } = {}) {
    for (const id of identifiers) {
      const vt = VERTEX_OF[id.type];
      if (!vt) continue;
      if (!this.v.has(id.key)) this.cache.state?.delete(id.key); // was cached as non-existent
      const x = this.upsertVertex(id.key, vt, ts, src);
      x.checks++;
    }
    if (reporterHash) {
      const r = this.reporter(reporterHash, { net, ts, src });
      r.a.checks = (r.a.checks || 0) + 1;
    }
    this.meta.checks++;
    this.save();
  }

  /**
   * File a report. Returns { reportId, keys } or { error: 'rate_limited' }.
   * opts.bypassRateLimit is for seeding only; it never comes from HTTP.
   */
  addReport({ identifiers, text, reporterHash, net, verdict = 'scam', city, lang, surface, ts = this.now(), src = 'user', bypassRateLimit = false }) {
    const reporter = this.reporter(reporterHash, { net, ts, src });
    const hourAgo = ts - 3_600_000;
    reporter.a.recent = (reporter.a.recent || []).filter((t) => t > hourAgo);
    if (!bypassRateLimit && reporter.a.recent.length >= REPORTS_PER_HOUR) return { error: 'rate_limited' };
    reporter.a.recent.push(ts);
    reporter.a.reports = (reporter.a.reports || 0) + 1;
    reporter.a.lastReport = ts;

    // Same network, close in time -> same cluster (one office, one sybil farm, one family router).
    if (net) {
      for (const [otherId, otherTs] of this.netIndex.get(net) || []) {
        if (otherId !== reporter.id && Math.abs(ts - otherTs) <= CLUSTER_WINDOW_MS) this.#union(reporter.id, otherId);
      }
      this.#netSeen(net, reporter.id, ts);
    }

    const t = triage(text || '');
    const patterns = [...new Set(t.triggers.map((x) => x.id).filter((id) => PATTERNS[id]))];
    const reportId = `report:${randomId('r')}`;
    const report = this.upsertVertex(reportId, V.Report, ts, src);
    report.a = { verdict, reporter: reporter.id, ts, city: city || null, lang: lang || null, surface: surface || null, patterns };
    this.addEdge(E.REPORTED, reporter.id, reportId, ts, { src });

    const ids = identifiers.filter((id) => VERTEX_OF[id.type]);
    for (const id of ids) {
      this.upsertVertex(id.key, VERTEX_OF[id.type], ts, src);
      // Script families and remote-access apps are ScamPattern vertices: kept off MENTIONS so they never act as hubs.
      this.addEdge(VERTEX_OF[id.type] === V.ScamPattern ? E.MATCHES_PATTERN : E.MENTIONS, reportId, id.key, ts, { src });
    }
    for (const p of patterns) {
      this.upsertVertex(`pattern:${p}`, V.ScamPattern, ts, src).a.label = PATTERNS[p];
      this.addEdge(E.MATCHES_PATTERN, reportId, `pattern:${p}`, ts, { src });
    }
    if (text && text.trim().length >= 12) this.#addText(reportId, text, ts, src);

    if (verdict === 'scam') {
      const of = (...types) => ids.filter((id) => types.includes(id.type));
      // Money flow implied by the message: a caller/handle that asks you to pay into an account.
      for (const p of of('phone')) for (const pay of of('upi', 'bank_account', 'crypto')) this.addEdge(E.PAYS_TO, p.key, pay.key, ts, { src });
      for (const u of of('upi')) for (const acct of of('bank_account', 'crypto')) this.addEdge(E.PAYS_TO, u.key, acct.key, ts, { src });
      for (const u of of('url')) {
        const host = normUrl(u.value)?.host;
        if (host) this.addEdge(E.RESOLVES_TO, u.key, keyOf('domain', registrable(host)), ts, { src });
      }
      for (const apk of of('apk')) for (const d of of('domain')) this.addEdge(E.HOSTED_ON, apk.key, d.key, ts, { src });
      const ifsc = identifiers.find((id) => id.type === 'ifsc');
      if (ifsc) for (const acct of of('bank_account')) this.v.get(acct.key).a.ifsc = ifsc.value;
    }
    this.#touch();
    return { reportId, keys: ids.map((id) => id.key) };
  }

  #addText(reportId, text, ts, src) {
    const clean = sanitizeText(text);
    const id = `text:${sha256(clean.toLowerCase()).slice(0, 16)}`;
    const isNew = !this.v.has(id);
    const x = this.upsertVertex(id, V.MessageText, ts, src);
    this.addEdge(E.SAME_TEXT_AS, reportId, id, ts, { src }); // report body normalises to exactly this script
    if (!isNew) return;
    x.a = { text: clean, vec: embed(clean) };
    for (const other of this.v.values()) {
      if (other.type !== V.MessageText || other.id === id || !other.a.vec) continue;
      const c = cosine(x.a.vec, other.a.vec);
      if (c >= SCRIPT_SIMILAR) this.addEdge(E.SIMILAR_SCRIPT, id, other.id, ts, { w: round(c), src });
    }
  }

  /** Public feeds: identifiers listed by a feed are confirmed with source "feed:<name>". */
  importFeed(name, identifiers, ts = this.now()) {
    let added = 0;
    for (const id of identifiers) {
      const vt = VERTEX_OF[id.type];
      if (!vt) continue;
      const x = this.upsertVertex(id.key, vt, ts, `feed:${name}`);
      if (x.src.length === 1) added++;
    }
    this.#touch();
    return added;
  }

  /** Remove everything carrying a source tag ("demo", "feed:openphish"). Shared vertices just lose the tag. */
  removeSource(src) {
    let removed = 0;
    for (const [k, e] of this.e) {
      if (e.src === src) {
        this.e.delete(k);
        this.adj.get(e.s)?.delete(k);
        this.adj.get(e.t)?.delete(k);
      }
    }
    for (const x of [...this.v.values()]) {
      if (!x.src.includes(src)) continue;
      x.src = x.src.filter((s) => s !== src);
      if (x.src.length === 0) {
        this.#removeVertex(x.id);
        removed++;
      }
    }
    this.netIndex.clear();
    for (const x of this.v.values()) if (x.type === V.Reporter && x.a.net) this.#netSeen(x.a.net, x.id, x.a.lastReport || 0);
    this.#touch();
    return removed;
  }

  hasSource(src) {
    for (const x of this.v.values()) if (x.src.includes(src)) return true;
    return false;
  }

  dispute(key, { reason, contactHash } = {}) {
    const x = this.v.get(key);
    const disputeId = randomId('d');
    const before = x ? this.stateOf(key).state : 'clear';
    const entry = { id: disputeId, key, at: new Date(this.now()).toISOString(), reason: String(reason || '').slice(0, 500), contactHash: contactHash || null, before, status: 'pending' };
    this.meta.disputes.push(entry);
    if (this.meta.disputes.length > 5000) this.meta.disputes.shift();
    if (x) {
      x.a.dispute = { id: disputeId, status: 'pending', at: entry.at };
      this.adjustReporterTrust(this.reportsOf(key).map((r) => r.a.reporter), TRUST.disputed);
    }
    this.#touch();
    return entry;
  }

  // ---------------------------------------------------------------- evidence + state

  reportsOf(key, { windowDays = DEFAULT_WINDOW_DAYS, verdict = 'scam' } = {}) {
    const now = this.now();
    const out = [];
    for (const e of this.edgesOf(key, E.MENTIONS)) {
      if (e.t !== key) continue;
      const r = this.v.get(e.s);
      if (r && r.type === V.Report && (!verdict || r.a.verdict === verdict) && withinWindow(r.a.ts, windowDays, now)) out.push(r);
    }
    return out;
  }

  isAllowlisted(key) {
    const type = typeOfKey(key);
    if (type !== 'domain' && type !== 'url') return false;
    const host = type === 'domain' ? valueOfKey(key) : normUrl(valueOfKey(key))?.host || '';
    const reg = registrable(host);
    // Whole-domain allowlist; a URL on a shared host (x.pages.dev/path) stays judgeable.
    return type === 'domain' ? HUB_DOMAINS.has(reg) || BRAND_DOMAINS.has(reg) || SHARED_HOSTING.has(reg) : host === reg && (HUB_DOMAINS.has(reg) || BRAND_DOMAINS.has(reg));
  }

  /** Per-identifier state with the evidence behind it. Cached until the next structural write. */
  stateOf(key) {
    this.#fresh();
    if (this.cache.state.has(key)) return this.cache.state.get(key);
    const x = this.v.get(key);
    const now = this.now();
    let ev;
    if (!x) {
      ev = { exists: false, reports: 0, people: 0, clusters: 0, score: 0, feeds: [], firstSeen: null, lastSeen: null, checks: 0 };
    } else {
      const scam = this.reportsOf(key);
      const safe = this.reportsOf(key, { verdict: 'safe' });
      const people = new Set(scam.map((r) => r.a.reporter));
      // Trust-weighted score: one vote per independent cluster (its best, freshest reporter).
      const best = new Map();
      for (const r of scam) {
        const c = this.clusterOf(r.a.reporter);
        const w = (this.v.get(r.a.reporter)?.a.trust ?? TRUST.start) * decay(r.a.ts, now);
        best.set(c, Math.max(best.get(c) || 0, w));
      }
      let score = [...best.values()].reduce((a, b) => a + b, 0);
      for (const r of safe) score -= (this.v.get(r.a.reporter)?.a.trust ?? TRUST.start) * decay(r.a.ts, now);
      const feeds = x.src.filter((s) => s.startsWith('feed:')).map((s) => s.slice(5));
      const times = scam.map((r) => r.a.ts);
      let neighbourReports = 0;
      if (!scam.length) {
        for (const e of this.edgesOf(key)) {
          if (e.type === E.MENTIONS || e.type === E.REPORTED) continue;
          const other = e.s === key ? e.t : e.s;
          if (IDENTIFIER_VERTICES.has(this.v.get(other)?.type)) neighbourReports += this.reportsOf(other).length;
        }
      }
      ev = {
        exists: true,
        reports: scam.length,
        safeReports: safe.length,
        people: people.size,
        clusters: best.size,
        score: round(score),
        feeds,
        neighbourReports,
        disputed: x.a.dispute?.status === 'pending',
        // Brand/platform domains and remote-access apps (AnyDesk is a legitimate tool) are signals, never judged.
        allowlisted: this.isAllowlisted(key) || typeOfKey(key) === 'remote_app',
        firstSeen: times.length ? Math.min(...times) : x.first,
        lastSeen: times.length ? Math.max(...times) : x.last,
        checks: x.checks || 0
      };
    }
    const result = { key, ...ev, ...decideState(ev) };
    this.cache.state.set(key, result);
    return result;
  }

  // ---------------------------------------------------------------- derived layer

  /** Per-revision cache: identifier states now, derived structures on first use. */
  #fresh() {
    if (this.cache.rev !== this.structRev) this.cache = { rev: this.structRev, state: new Map() };
  }

  /** Projection, campaigns and chokepoints: computed lazily, once per structural revision. */
  #derived() {
    this.#fresh();
    if (!this.cache.rings) {
      this.cache.proj = this.#project();
      this.cache.rings = this.#detectRings();
    }
  }

  /**
   * Identifier-level projection used by BFS, WCC and Louvain. Two identifiers are adjacent
   * when one report mentions both, or when a direct edge (PAYS_TO, RESOLVES_TO, HOSTED_ON)
   * joins them. A report's script (SAME_TEXT_AS) joins like a mentioned identifier, and
   * scripts join each other via SIMILAR_SCRIPT (non-deterministic). Weights decay.
   */
  #project() {
    const now = this.now();
    const nb = new Map(); // id -> Map(otherId -> { w, types:Set })
    const link = (a, b, type, w) => {
      if (a === b) return;
      for (const [x, y] of [[a, b], [b, a]]) {
        if (!nb.has(x)) nb.set(x, new Map());
        const cur = nb.get(x).get(y) || { w: 0, types: new Set() };
        cur.w += w;
        cur.types.add(type);
        nb.get(x).set(y, cur);
      }
    };
    const inProjection = (id) => {
      const t = this.v.get(id)?.type;
      return IDENTIFIER_VERTICES.has(t) || t === V.MessageText;
    };
    for (const r of this.v.values()) {
      if (r.type !== V.Report || r.a.verdict !== 'scam' || !withinWindow(r.a.ts, DEFAULT_WINDOW_DAYS, now)) continue;
      const members = [];
      for (const e of this.edgesOf(r.id)) if ((e.type === E.MENTIONS || e.type === E.SAME_TEXT_AS) && e.s === r.id && inProjection(e.t)) members.push(e.t);
      const w = PROJ_WEIGHT[E.MENTIONS] * decay(r.a.ts, now);
      for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) link(members[i], members[j], E.MENTIONS, w);
    }
    for (const e of this.e.values()) {
      if (!PROJ_WEIGHT[e.type] || e.type === E.MENTIONS || !inProjection(e.s) || !inProjection(e.t)) continue;
      if (!withinWindow(e.ts, DEFAULT_WINDOW_DAYS, now)) continue;
      link(e.s, e.t, e.type, PROJ_WEIGHT[e.type] * (e.w ?? 1) * decay(e.ts, now));
    }
    const hubs = new Set();
    for (const [id, m] of nb) {
      const t = typeOfKey(id);
      const host = t === 'domain' ? valueOfKey(id) : t === 'url' ? registrable(normUrl(valueOfKey(id))?.host || '') : null;
      if (m.size > HUB_DEGREE_CAP || (host && (HUB_DOMAINS.has(host) || SHARED_HOSTING.has(host)) && t === 'domain')) hubs.add(id);
    }
    return { nb, hubs };
  }

  /** ring_detection: pass 1 WCC on deterministic edges (entities), pass 2 Louvain (campaigns). */
  #detectRings() {
    const { nb, hubs } = this.cache.proj;
    const now = this.now();
    const ids = [...nb.keys()].filter((id) => !hubs.has(id)).sort();
    const index = new Map(ids.map((id, i) => [id, i]));
    const detEdges = [];
    const wEdges = [];
    for (const [a, m] of nb) {
      if (!index.has(a)) continue;
      for (const [b, { w, types }] of m) {
        if (!index.has(b) || a > b) continue;
        if ([...types].some((t) => DETERMINISTIC.has(t))) detEdges.push([index.get(a), index.get(b)]);
        wEdges.push([index.get(a), index.get(b), w]);
      }
    }
    const entity = wcc(ids.length, detEdges);
    const community = louvain(ids.length, wEdges);

    const groups = new Map();
    ids.forEach((id, i) => {
      if (!groups.has(community[i])) groups.set(community[i], []);
      groups.get(community[i]).push(id);
    });

    const chokepoints = this.#chokepoints();
    const campaigns = [];
    const byMember = new Map();
    const usedIds = new Set();
    for (const members of groups.values()) {
      const idents = members.filter((m) => IDENTIFIER_VERTICES.has(this.v.get(m).type));
      if (idents.length < 2) continue;
      const reports = new Map();
      for (const m of idents) for (const r of this.reportsOf(m)) reports.set(r.id, r);
      if (reports.size < 3) continue;
      const sorted = [...reports.values()].sort((a, b) => a.a.ts - b.a.ts);
      const people = new Set(sorted.map((r) => r.a.reporter));
      const patternCount = new Map();
      for (const r of sorted) for (const p of r.a.patterns || []) patternCount.set(p, (patternCount.get(p) || 0) + 1);
      const topPattern = [...patternCount.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
      // Anchor = the payout most phones feed into; stable across recomputes, so is the id.
      const payouts = idents.filter((m) => PAYABLE.has(this.v.get(m).type)).sort((a, b) => (chokepoints.get(b)?.inboundPhones || 0) - (chokepoints.get(a)?.inboundPhones || 0) || (a < b ? -1 : 1));
      const anchor = payouts[0] || idents[0];
      let num = (parseInt(sha256(anchor).slice(0, 6), 16) % 900) + 100;
      while (usedIds.has(num)) num = num === 999 ? 100 : num + 1;
      usedIds.add(num);
      const cityFirst = new Map();
      for (const r of sorted) if (r.a.city && !cityFirst.has(r.a.city)) cityFirst.set(r.a.city, r.a.ts);
      const patternLabel = topPattern ? PATTERNS[topPattern] : 'Mixed';
      const c = {
        id: String(num),
        name: `${patternLabel} ring ${num}`,
        pattern: patternLabel,
        size: people.size,
        reports: sorted.length,
        identifiers: idents.length,
        firstSeen: sorted[0].a.ts,
        lastSeen: sorted.at(-1).a.ts,
        cities: [...cityFirst.keys()],
        anchor,
        entity: entity[index.get(anchor)],
        members: idents,
        reportIds: sorted.map((r) => r.id),
        heat: round(sorted.reduce((s, r) => s + decay(r.a.ts, now), 0), 2),
        demo: sorted.every(demoOnly)
      };
      campaigns.push(c);
      for (const m of members) byMember.set(m, c);
    }
    campaigns.sort((a, b) => b.heat - a.heat || b.size - a.size);
    const entities = new Set(entity).size;
    return { campaigns, byMember, byId: new Map(campaigns.map((c) => [c.id, c])), chokepoints, entities, entityOf: (id) => entity[index.get(id)] };
  }

  /**
   * money_chokepoint: for every payout (UPI handle, bank account, wallet), the distinct phones
   * and handles whose money reaches it within two PAYS_TO steps, plus degree and PageRank
   * on the PAYS_TO digraph (money sinks accumulate rank).
   */
  #chokepoints() {
    const inbound = new Map(); // payout -> Set(sources)
    const payEdges = [...this.e.values()].filter((e) => e.type === E.PAYS_TO);
    const reverse = new Map();
    for (const e of payEdges) {
      if (!reverse.has(e.t)) reverse.set(e.t, []);
      reverse.get(e.t).push(e.s);
    }
    for (const sink of reverse.keys()) {
      const seen = new Set();
      let frontier = [sink];
      for (let depth = 0; depth < 2; depth++) {
        const next = [];
        for (const n of frontier) for (const s of reverse.get(n) || []) if (!seen.has(s) && s !== sink) { seen.add(s); next.push(s); }
        frontier = next;
      }
      inbound.set(sink, seen);
    }
    const rank = pageRank(payEdges);
    const out = new Map();
    for (const [sink, sources] of inbound) {
      const srcs = [...sources];
      out.set(sink, {
        inboundPhones: srcs.filter((s) => typeOfKey(s) === 'phone').length,
        inboundHandles: srcs.filter((s) => typeOfKey(s) !== 'phone').length,
        degree: this.adj.get(sink)?.size || 0,
        pagerank: round(rank.get(sink) || 0, 4)
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- the six queries

  /** blast_radius: BFS over the identifier projection, accumulating reports per hop. */
  blastRadius(key, windowDays = DEFAULT_WINDOW_DAYS) {
    this.#derived();
    const { nb, hubs } = this.cache.proj;
    const hopOf = new Map([[key, 0]]);
    let frontier = [key];
    for (let hop = 1; hop <= 2; hop++) {
      const next = [];
      for (const id of frontier) {
        for (const other of nb.get(id)?.keys() || []) {
          if (hopOf.has(other) || hubs.has(other) || this.v.get(other)?.type === V.MessageText) continue;
          hopOf.set(other, hop);
          next.push(other);
        }
      }
      frontier = next;
    }
    const reports = new Set();
    const confirmedReports = new Set();
    let hopsToConfirmed = null;
    for (const [id, hop] of hopOf) {
      const st = this.stateOf(id);
      const rs = this.reportsOf(id, { windowDays });
      for (const r of rs) reports.add(r.id);
      if (st.state === 'confirmed') {
        for (const r of rs) confirmedReports.add(r.id);
        if (hopsToConfirmed === null || hop < hopsToConfirmed) hopsToConfirmed = hop;
      }
    }
    return { key, hopOf, reportsWithin2Hops: reports.size, confirmedWithin2Hops: confirmedReports.size, hopsToConfirmed };
  }

  /** Ring for drawing: centre + up to 2 hops, pruned to 40 nodes, strongest edge type per pair. */
  ringOf(key) {
    const { hopOf } = this.blastRadius(key);
    const nodeOf = (id, hop) => {
      const st = this.stateOf(id);
      return { id, type: typeOfKey(id), label: labelOf(id), hop, reports: st.reports, confirmed: st.state === 'confirmed' };
    };
    const byHop = [[], [], []];
    for (const [id, hop] of hopOf) byHop[hop].push(nodeOf(id, hop));
    const order = (a, b) => b.confirmed - a.confirmed || b.reports - a.reports || (a.id < b.id ? -1 : 1);
    const hop1 = byHop[1].sort(order).slice(0, 16);
    const hop2 = byHop[2].sort(order).slice(0, RING_MAX_NODES - 1 - hop1.length);
    const nodes = [...byHop[0], ...hop1, ...hop2];
    const keep = new Set(nodes.map((n) => n.id));
    const edges = [];
    for (const a of keep) {
      for (const [b, { types }] of this.cache.proj.nb.get(a) || []) {
        if (a < b && keep.has(b)) edges.push({ source: a, target: b, type: EDGE_RANK.find((t) => types.has(t)) });
      }
    }
    return { center: key, nodes, edges };
  }

  campaignOf(key) {
    this.#derived();
    return this.cache.rings.byMember.get(key) || null;
  }

  campaign(id) {
    this.#derived();
    return this.cache.rings.byId.get(String(id)) || null;
  }

  campaigns() {
    this.#derived();
    return this.cache.rings.campaigns;
  }

  ringDetection() {
    this.#derived();
    const { campaigns, entities } = this.cache.rings;
    return { entities, campaigns };
  }

  chokepointOf(key) {
    this.#derived();
    return this.cache.rings.chokepoints.get(key) || null;
  }

  /** Payouts reached from `key` by following PAYS_TO forward up to two steps. */
  payoutsOf(key) {
    const seen = new Set();
    let frontier = [key];
    for (let depth = 0; depth < 2; depth++) {
      const next = [];
      for (const id of frontier) {
        for (const e of this.edgesOf(id, E.PAYS_TO)) if (e.s === id && !seen.has(e.t)) { seen.add(e.t); next.push(e.t); }
      }
      frontier = next;
    }
    return seen;
  }

  moneyChokepoint(k = 10) {
    this.#derived();
    const rows = [];
    for (const [key, c] of this.cache.rings.chokepoints) {
      const camp = this.cache.rings.byMember.get(key);
      rows.push({
        key, type: typeOfKey(key), value: valueOfKey(key), label: labelOf(key), ...c,
        reports: this.reportsOf(key).length, state: this.stateOf(key).state,
        campaign: camp ? { id: camp.id, name: camp.name } : null
      });
    }
    return rows.sort((a, b) => b.inboundPhones - a.inboundPhones || b.pagerank - a.pagerank).slice(0, k);
  }

  /** lookalike_domain: brand impersonation (token, homoglyph, one edit, 3-shingle Jaccard) and similarity to reported domains. */
  lookalikeDomain(domain, threshold = 0.75) {
    this.#fresh();
    const d = String(domain).toLowerCase();
    const out = [];
    if (BRAND_DOMAINS.has(d) || HUB_DOMAINS.has(d)) return out;
    for (const [brand, tokens] of BRANDS) {
      const m = imitation(d, brand, tokens);
      if (m.score >= threshold) out.push({ target: brand, kind: 'brand', score: round(m.score, 2), how: m.how });
    }
    if (!this.cache.badDomains) {
      // Shingle sets never change for a domain, so they outlive the per-revision cache.
      this.shingleCache ||= new Map();
      this.cache.badDomains = [];
      for (const x of this.v.values()) {
        if (x.type !== V.Domain) continue;
        const value = valueOfKey(x.id);
        if (stem(value).length < 5 || this.stateOf(x.id).state !== 'confirmed') continue;
        if (!this.shingleCache.has(value)) this.shingleCache.set(value, shingles(stem(value)));
        this.cache.badDomains.push([value, this.shingleCache.get(value)]);
      }
    }
    const mine = shingles(stem(d));
    for (const [bad, sh] of this.cache.badDomains) {
      if (bad === d) continue;
      const s = jaccard(mine, sh);
      if (s >= threshold) out.push({ target: bad, kind: 'reported', score: round(s, 2), how: 'shingle' });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 5);
  }

  /** script_similarity: cosine over 256-d hashed embeddings of stored message scripts. */
  scriptSimilarity(text, k = 5, threshold = 0.5) {
    this.#derived();
    const vec = embed(sanitizeText(text));
    const out = [];
    for (const x of this.v.values()) {
      if (x.type !== V.MessageText || !x.a.vec) continue;
      const score = cosine(vec, x.a.vec);
      if (score >= threshold) out.push({ textKey: x.id, score: round(score), campaign: this.cache.rings.byMember.get(x.id)?.id || null, text: x.a.text });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, k);
  }

  /** spread_map: reports of a campaign ordered by NEXT (time), grouped by city. */
  spreadMap(campaignId) {
    const c = this.campaign(campaignId);
    if (!c) return null;
    const byCity = new Map();
    for (const id of c.reportIds) {
      const r = this.v.get(id);
      const city = r.a.city || 'Unknown';
      const cur = byCity.get(city) || { city, firstSeen: r.a.ts, count: 0 };
      cur.count++;
      cur.firstSeen = Math.min(cur.firstSeen, r.a.ts);
      byCity.set(city, cur);
    }
    return [...byCity.values()].sort((a, b) => a.firstSeen - b.firstSeen).map((x) => ({ ...x, firstSeen: new Date(x.firstSeen).toISOString() }));
  }

  /** NEXT edges for a campaign (temporal chain of its reports), materialised on demand. */
  nextEdges(campaignId) {
    const c = this.campaign(campaignId);
    if (!c) return [];
    return c.reportIds.slice(1).map((id, i) => ({ type: E.NEXT, source: c.reportIds[i], target: id }));
  }

  // ---------------------------------------------------------------- hash-prefix index + stats

  /** Safe Browsing style index over every reported/confirmed identifier. */
  hashIndex() {
    this.#fresh();
    if (!this.cache.hashIndex) {
      const buckets = new Map();
      for (const x of this.v.values()) {
        if (!IDENTIFIER_VERTICES.has(x.type) && !(x.type === V.ScamPattern && x.id.startsWith('remote_app:'))) continue;
        const st = this.stateOf(x.id);
        if (st.state === 'clear') continue;
        const hash = sha256(x.id);
        const prefix = hash.slice(0, 8);
        if (!buckets.has(prefix)) buckets.set(prefix, []);
        buckets.get(prefix).push({ hash, state: st.state, reports: st.reports });
      }
      this.cache.hashIndex = { version: `${this.structRev}-${buckets.size}`, buckets };
    }
    return this.cache.hashIndex;
  }

  stats() {
    this.#derived();
    // Public counters exclude the labelled demo seed, so the landing page only shows real activity.
    // Open-feed identifiers are real public data and do count.
    let users = 0;
    let identifiers = 0;
    let reports = 0;
    const demo = { users: 0, reports: 0, identifiers: 0, rings: 0 };
    for (const x of this.v.values()) {
      const d = demoOnly(x);
      if (x.type === V.Reporter) d ? demo.users++ : users++;
      else if (x.type === V.Report) d ? demo.reports++ : reports++;
      else if (IDENTIFIER_VERTICES.has(x.type)) d ? demo.identifiers++ : identifiers++;
    }
    const rings = this.cache.rings.campaigns.filter((c) => !c.demo).length;
    demo.rings = this.cache.rings.campaigns.length - rings;
    return { users, checks: this.meta.checks, identifiers, rings, reports, demo, vertices: this.v.size, edges: this.e.size };
  }
}

/** Plain PageRank on a directed edge list (damping 0.85, 30 iterations, dangling mass spread evenly). */
function pageRank(edges, damping = 0.85, iterations = 30) {
  const nodes = new Set();
  const outDeg = new Map();
  for (const e of edges) {
    nodes.add(e.s);
    nodes.add(e.t);
    outDeg.set(e.s, (outDeg.get(e.s) || 0) + 1);
  }
  const n = nodes.size;
  if (!n) return new Map();
  let rank = new Map([...nodes].map((id) => [id, 1 / n]));
  for (let it = 0; it < iterations; it++) {
    let dangling = 0;
    for (const id of nodes) if (!outDeg.has(id)) dangling += rank.get(id);
    const next = new Map([...nodes].map((id) => [id, (1 - damping) / n + (damping * dangling) / n]));
    for (const e of edges) next.set(e.t, next.get(e.t) + (damping * rank.get(e.s)) / outDeg.get(e.s));
    rank = next;
  }
  return rank;
}
