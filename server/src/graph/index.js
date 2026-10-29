// Graph engine selection: GRAPH_BACKEND=memory|tigergraph.
//
// The memory engine is always present and authoritative for writes, verdict evidence and
// poisoning defences (it answers in well under a millisecond on the hot path). With
// GRAPH_BACKEND=tigergraph every write is mirrored to TigerGraph and the six analytical
// queries run there first; any TigerGraph failure falls back to memory for that call and
// is surfaced in /api/health.
import { MemoryGraph } from './memory.js';
import { TigerGraphClient, fromTG } from './tigergraph.js';
import { embed } from './similarity.js';
import { sanitizeText } from '../privacy.js';
import { DEFAULT_WINDOW_DAYS } from '../util.js';

export class Graph {
  constructor(config) {
    this.memory = new MemoryGraph({ dataDir: config.dataDir, persist: config.persist });
    this.tg = config.graphBackend === 'tigergraph' && config.tg.host ? new TigerGraphClient(config.tg) : null;
    this.requested = config.graphBackend;
    this.campaignRevMirrored = -1;
  }

  async init() {
    if (!this.tg) return;
    const ok = await this.tg.ping();
    if (ok) this.mirrorAll();
  }

  get engine() {
    return this.tg && this.tg.status.mode === 'live' ? 'tigergraph' : 'memory';
  }

  /** Run on TigerGraph when live, otherwise (or on error) on memory. Returns { value, engine }. */
  async #run(tgCall, memoryCall) {
    if (this.tg && this.tg.status.mode !== 'off') {
      try {
        const value = await tgCall();
        if (value != null) return { value, engine: 'tigergraph' };
      } catch {
        // recorded in tg.status; fall through to memory
      }
    }
    return { value: memoryCall(), engine: 'memory' };
  }

  // ---------------------------------------------------------------- writes (memory + mirror)

  recordCheck(identifiers, opts) {
    this.memory.recordCheck(identifiers, opts);
    this.tg?.mirror(this.memory, identifiers.map((i) => i.key).filter((k) => this.memory.v.has(k)));
  }

  addReport(input) {
    const result = this.memory.addReport(input);
    if (!result.error) this.tg?.mirror(this.memory, [result.reportId, ...result.keys]);
    return result;
  }

  dispute(key, opts) {
    const entry = this.memory.dispute(key, opts);
    if (this.memory.v.has(key)) this.tg?.mirror(this.memory, [key]);
    return entry;
  }

  /** Push campaign membership to TigerGraph whenever ring detection produced a new result. */
  syncCampaigns() {
    if (!this.tg || this.tg.status.mode !== 'live') return;
    const campaigns = this.memory.campaigns();
    if (this.campaignRevMirrored === this.memory.structRev) return;
    this.campaignRevMirrored = this.memory.structRev;
    this.tg.mirrorCampaigns(this.memory, campaigns);
  }

  /** Bulk upload of the whole memory graph (first connection to an empty TigerGraph). */
  mirrorAll() {
    const ids = [...this.memory.v.keys()];
    for (let i = 0; i < ids.length; i += 500) this.tg.mirror(this.memory, ids.slice(i, i + 500));
    this.tg.flush();
    this.syncCampaigns();
  }

  // ---------------------------------------------------------------- the six queries

  blastRadius(key, windowDays = DEFAULT_WINDOW_DAYS) {
    return this.#run(
      async () => fromTG.blastRadius(await this.tg.query('blast_radius', { id_key: key, window_days: windowDays })),
      () => this.memory.blastRadius(key, windowDays)
    );
  }

  ringOf(key) {
    return this.#run(async () => fromTG.ring(await this.tg.query('ring_of', { id_key: key })), () => this.memory.ringOf(key));
  }

  moneyChokepoint(k = 10) {
    return this.#run(async () => fromTG.chokepoints(await this.tg.query('money_chokepoint', { k })), () => this.memory.moneyChokepoint(k));
  }

  /** Brand impersonation is computed locally; similarity to reported domains can come from TigerGraph. */
  async lookalikeDomain(domain, threshold = 0.75) {
    const local = this.memory.lookalikeDomain(domain, threshold);
    if (!this.tg) return { value: local, engine: 'memory' };
    const { value, engine } = await this.#run(
      async () => fromTG.lookalike(await this.tg.query('lookalike_domain', { domain, threshold })),
      () => local.filter((m) => m.kind === 'reported')
    );
    const merged = [...local.filter((m) => m.kind === 'brand'), ...value].sort((a, b) => b.score - a.score).slice(0, 5);
    return { value: merged, engine };
  }

  scriptSimilarity(text, k = 5) {
    return this.#run(
      async () => fromTG.scripts(await this.tg.query('script_similarity_vec', { query_vector: embed(sanitizeText(text)), k, confirmed_only: false })),
      () => this.memory.scriptSimilarity(text, k)
    );
  }

  spreadMap(campaignId) {
    return this.#run(async () => fromTG.spread(await this.tg.query('spread_map', { campaign_id: `campaign:${campaignId}` })), () => this.memory.spreadMap(campaignId));
  }

  health() {
    return {
      requested: this.requested,
      active: this.engine,
      tigergraph: this.tg ? { ...this.tg.status } : { configured: false, mode: this.requested === 'tigergraph' ? 'fallback' : 'off', lastError: this.requested === 'tigergraph' ? 'TG_HOST not set' : null }
    };
  }

  flush() {
    this.memory.flush();
    return this.tg?.flush();
  }
}
