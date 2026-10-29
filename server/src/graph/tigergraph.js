// TigerGraph adapter (TigerGraph 4.x / Savanna). Thin REST client:
//   - installed queries:  GET  {TG_HOST}/restpp/query/{graph}/{query}?params   (Bearer token)
//   - upserts:            POST {TG_HOST}/restpp/graph/{graph}
//   - token from secret:  POST {TG_HOST}/gsql/v1/tokens (4.x), falling back to /restpp/requesttoken (3.x)
// Query names and return shapes match jaal/tigergraph/queries/*.gsql.
import { V, E, IDENTIFIER_VERTICES, typeOfKey, valueOfKey } from './model.js';
import { fetchWithTimeout } from '../util.js';

const tgTime = (ts) => new Date(ts).toISOString().slice(0, 19).replace('T', ' '); // "YYYY-MM-DD hh:mm:ss"
const TOKEN_LIFETIME_S = 7 * 86_400;

export class TigerGraphClient {
  constructor({ host, graph, secret, token }, { timeoutMs = 1500 } = {}) {
    this.host = host;
    this.graph = graph;
    this.secret = secret;
    this.token = token || null;
    this.tokenExpires = token ? Infinity : 0;
    this.timeoutMs = timeoutMs;
    this.status = { configured: !!host, mode: host ? 'connecting' : 'off', lastError: null, lastOkAt: null, calls: 0, failures: 0, upserts: 0 };
    this.pending = null;
    this.flushTimer = null;
  }

  async #auth() {
    if (this.token && Date.now() < this.tokenExpires) return this.token;
    if (!this.secret) throw new Error('TG_TOKEN or TG_SECRET required');
    const attempts = [
      [`${this.host}/gsql/v1/tokens`, { secret: this.secret, lifetime: String(TOKEN_LIFETIME_S) }],
      [`${this.host}/restpp/requesttoken`, { secret: this.secret, lifetime: String(TOKEN_LIFETIME_S) }]
    ];
    let lastErr;
    for (const [url, body] of attempts) {
      try {
        const res = await fetchWithTimeout(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, 5000);
        const json = await res.json().catch(() => ({}));
        const token = json.token || json.results?.token;
        if (res.ok && token) {
          this.token = token;
          this.tokenExpires = Date.now() + (TOKEN_LIFETIME_S - 3600) * 1000;
          return token;
        }
        lastErr = new Error(`${url} -> ${res.status} ${json.message || ''}`.trim());
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  async #request(url, opts = {}) {
    this.status.calls++;
    try {
      const token = await this.#auth();
      const res = await fetchWithTimeout(url, { ...opts, headers: { ...opts.headers, authorization: `Bearer ${token}` } }, this.timeoutMs);
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.message || `HTTP ${res.status}`);
      this.status.mode = 'live';
      this.status.lastOkAt = new Date().toISOString();
      return json;
    } catch (err) {
      this.status.failures++;
      this.status.mode = 'fallback';
      this.status.lastError = err.name === 'AbortError' ? `timeout after ${this.timeoutMs}ms` : err.message;
      throw err;
    }
  }

  /** Run an installed query; list params are repeated (?v=1&v=2). Returns `results`. */
  async query(name, params = {}) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) v.forEach((x) => qs.append(k, String(x)));
      else qs.append(k, String(v));
    }
    const json = await this.#request(`${this.host}/restpp/query/${this.graph}/${name}?${qs}`);
    return json.results || [];
  }

  async ping() {
    try {
      await this.query('jaal_vtype', { id_key: 'phone:+910000000000' });
      return true;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------ mirroring writes

  /** Queue vertices and their incident edges from the memory graph; flushed in one upsert. */
  mirror(memory, vertexIds) {
    const payload = (this.pending ||= { vertices: {}, edges: {} });
    const addVertex = (id) => {
      const x = memory.v.get(id);
      if (!x) return;
      ((payload.vertices[x.type] ||= {})[id] = vertexAttributes(memory, x));
    };
    for (const id of vertexIds) {
      addVertex(id);
      for (const e of memory.edgesOf(id)) {
        if (![E.REPORTED, E.MENTIONS, E.MATCHES_PATTERN, E.PAYS_TO, E.RESOLVES_TO, E.HOSTED_ON, E.SAME_TEXT_AS, E.SIMILAR_SCRIPT].includes(e.type)) continue;
        addVertex(e.s);
        addVertex(e.t);
        const sType = memory.v.get(e.s)?.type;
        const tType = memory.v.get(e.t)?.type;
        if (!sType || !tType) continue;
        const bySrc = ((payload.edges[sType] ||= {})[e.s] ||= {});
        ((bySrc[e.type] ||= {})[tType] ||= {})[e.t] = { ts: { value: tgTime(e.ts) }, weight: { value: e.w ?? 1 } };
      }
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), 250);
      this.flushTimer.unref?.();
    }
  }

  /** Campaign vertices + IN_CAMPAIGN + NEXT, so ring_of / spread_map see the server's campaign ids. */
  mirrorCampaigns(memory, campaigns) {
    const payload = (this.pending ||= { vertices: {}, edges: {} });
    for (const c of campaigns) {
      const cid = `campaign:${c.id}`;
      (payload.vertices[V.Campaign] ||= {})[cid] = {
        value: { value: c.id }, name: { value: c.name }, pattern: { value: c.pattern }, size: { value: c.size },
        report_count: { value: c.reports }, first_seen: { value: tgTime(c.firstSeen) }, last_seen: { value: tgTime(c.lastSeen) },
        anchor: { value: c.anchor }, state: { value: 'confirmed' }, source: { value: 'server' }
      };
      for (const id of [...c.members, ...c.reportIds]) {
        const type = memory.v.get(id)?.type;
        if (!type) continue;
        (((payload.edges[type] ||= {})[id] ||= {})[E.IN_CAMPAIGN] ||= {})[V.Campaign] = { [cid]: { ts: { value: tgTime(c.lastSeen) } } };
      }
      for (const n of memory.nextEdges(c.id)) {
        const from = memory.v.get(n.source);
        const to = memory.v.get(n.target);
        ((((payload.edges[V.Report] ||= {})[n.source] ||= {})[E.NEXT] ||= {})[V.Report] ||= {})[n.target] = {
          ts: { value: tgTime(to.a.ts) }, gap_hours: { value: Math.round(((to.a.ts - from.a.ts) / 3_600_000) * 10) / 10 }
        };
      }
    }
    this.flush();
  }

  async flush() {
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
    const payload = this.pending;
    this.pending = null;
    if (!payload) return;
    try {
      await this.#request(`${this.host}/restpp/graph/${this.graph}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      this.status.upserts++;
    } catch {
      // status already records the error; the memory engine stays authoritative
    }
  }
}

function vertexAttributes(memory, x) {
  const attrs = { first_seen: { value: tgTime(x.first) }, last_seen: { value: tgTime(x.last) }, source: { value: x.src.join(',') } };
  if (IDENTIFIER_VERTICES.has(x.type)) {
    const st = memory.stateOf(x.id);
    Object.assign(attrs, { value: { value: valueOfKey(x.id) }, state: { value: st.state }, report_count: { value: st.reports } });
  } else if (x.type === V.Report) {
    const reporter = memory.v.get(x.a.reporter);
    Object.assign(attrs, {
      ts: { value: tgTime(x.a.ts) }, verdict: { value: x.a.verdict }, city: { value: x.a.city || '' }, surface: { value: x.a.surface || '' },
      lang: { value: x.a.lang || 'en' }, trust: { value: reporter?.a.trust ?? 0.5 }, state: { value: x.a.verdict === 'scam' ? 'pending' : 'safe' }
    });
  } else if (x.type === V.Reporter) {
    Object.assign(attrs, { trust: { value: x.a.trust }, report_count: { value: x.a.reports || 0 }, cluster: { value: memory.clusterOf(x.id) } });
  } else if (x.type === V.MessageText) {
    Object.assign(attrs, { value: { value: x.a.text || '' } });
    if (x.a.vec) attrs.embedding = { value: x.a.vec };
  } else if (x.type === V.ScamPattern) {
    Object.assign(attrs, { value: { value: valueOfKey(x.id) }, kind: { value: typeOfKey(x.id) } });
  }
  return attrs;
}

// ------------------------------------------------------------ result mappers (GSQL PRINT -> server shapes)

const first = (results) => Object.assign({}, ...(results || []));

export const fromTG = {
  blastRadius(results) {
    const r = first(results);
    if (!r.found) return null;
    return {
      reportsWithin2Hops: r.reports_in_window ?? 0,
      // NB: the GSQL query counts confirmed *identifiers* within 2 hops; the memory engine counts confirmed *reports*.
      confirmedWithin2Hops: r.confirmed_within_2_hops ?? 0,
      hopsToConfirmed: r.hops_to_confirmed >= 0 ? r.hops_to_confirmed : null
    };
  },
  ring(results) {
    const r = first(results);
    if (!r.found) return null;
    return {
      center: r.center,
      nodes: (r.nodes || []).map((n) => ({ id: n.id, type: typeOfKey(n.id), label: n.label, hop: n.hop, reports: n.reports, confirmed: !!n.confirmed })),
      edges: (r.edges || []).map((e) => ({ source: e.src, target: e.dst, type: e.etype }))
    };
  },
  chokepoints(results) {
    return (first(results).chokepoints || []).map((c) => ({
      key: c.id, type: typeOfKey(c.id), value: valueOfKey(c.id), label: c.label, inboundPhones: c.inbound_phones, inboundHandles: c.inbound_handles,
      pagerank: c.pagerank, reports: c.reports, state: c.state, campaign: c.campaign ? { id: c.campaign.replace(/^campaign:/, ''), name: c.campaign } : null
    }));
  },
  lookalike(results) {
    return (first(results).matches || []).map((m) => ({ target: valueOfKey(m.id), kind: 'reported', score: m.jaccard, how: 'shingle' }));
  },
  scripts(results) {
    return (first(results).matches || []).map((m) => ({ textKey: m.id, score: m.similarity, campaign: m.campaign ? m.campaign.replace(/^campaign:/, '') : null, text: m.label }));
  },
  spread(results) {
    const r = first(results);
    if (!r.found) return null;
    return (r.cities || []).map((c) => ({ city: c.city, firstSeen: new Date(`${c.first_seen.replace(' ', 'T')}Z`).toISOString(), count: c.reports }));
  }
};
