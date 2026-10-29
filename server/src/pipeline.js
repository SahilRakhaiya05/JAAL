// The request pipeline behind /api/check, /api/report, /api/dispute and /api/voice.
// Every check both reads and writes: identifiers become vertices, the check is counted,
// and the reporter (salted device hash) becomes a Reporter vertex.
import { extract, triage, normaliseIdentifier, keyOf, labelOf, typeOfKey, PAYABLE } from './graph/model.js';
import { buildVerdict, pickPrimary } from './verdict.js';
import { TRUST } from './trust.js';
import { saltedHash, randomId } from './util.js';

const MAX_IDENTIFIERS = 25;
const LANGS = new Set(['en', 'hi', 'gu']);

export class Pipeline {
  constructor({ config, graph, state, viasocket, llm }) {
    this.config = config;
    this.graph = graph;
    this.memory = graph.memory;
    this.state = state;
    this.viasocket = viasocket;
    this.llm = llm;
  }

  /** Identifiers from free text plus any the client already extracted, normalised and de-duplicated. */
  collect({ text, identifiers }) {
    const out = new Map();
    for (const id of extract(typeof text === 'string' ? text.slice(0, 20_000) : '')) {
      out.set(id.key, { type: id.type, value: id.value, key: id.key, ...(id.chain ? { chain: id.chain } : {}) });
    }
    for (const raw of Array.isArray(identifiers) ? identifiers : []) {
      const n = normaliseIdentifier(raw?.type, raw?.value);
      if (n && !out.has(n.key)) out.set(n.key, n);
    }
    return [...out.values()].slice(0, MAX_IDENTIFIERS).map((id) => this.#resolveUrlScheme(id));
  }

  /** A feed may list http://x while the message says https://x: match the stored variant. */
  #resolveUrlScheme(id) {
    if (id.type !== 'url' || this.memory.v.has(id.key)) return id;
    const alt = id.value.startsWith('https://') ? id.value.replace(/^https:/, 'http:') : id.value.replace(/^http:/, 'https:');
    const altKey = keyOf('url', alt);
    return this.memory.v.has(altKey) ? { ...id, value: alt, key: altKey } : id;
  }

  reporterHash(reporter, meta) {
    return saltedHash(this.config.reporterSalt, reporter ? `device:${String(reporter).slice(0, 128)}` : `anon:${meta.net}`);
  }

  async check(body, meta) {
    const startedAt = performance.now();
    let items = this.collect(body);
    if (!items.length && typeof body.text === 'string' && body.text.length > 40) {
      const found = await this.llm.extractIdentifiers(body.text);
      if (found.length) items = this.collect({ text: found.join('\n') });
    }
    this.graph.recordCheck(items, { reporterHash: this.reporterHash(body.reporter, meta), net: meta.net });
    const verdict = await this.evaluate(items, body, startedAt);
    if (verdict.state === 'confirmed') this.viasocket.emit('verdict.confirmed', verdict);
    return verdict;
  }

  /** Read-only part of a check: states, primary, blast radius, campaign, ring, copy, actions. */
  async evaluate(items, body, startedAt = performance.now()) {
    const lang = LANGS.has(body.lang) ? body.lang : 'en';
    const enriched = items.map((i) => ({ ...i, st: this.memory.stateOf(i.key) }));
    const primary = pickPrimary(enriched);
    const tri = triage(typeof body.text === 'string' ? body.text : '', body.context || {});

    let blast = null;
    let ring = null;
    let engine = 'memory';
    let campaign = null;
    let campaignRole = null;
    let inboundPhones = 0;
    if (primary) {
      const b = await this.graph.blastRadius(primary.key);
      blast = b.value;
      engine = b.engine;
      campaign = this.memory.campaignOf(primary.key) || enriched.map((i) => this.memory.campaignOf(i.key)).find(Boolean) || null;
      if (campaign) {
        const choke = this.memory.chokepointOf(primary.key);
        const isPayout = PAYABLE.has(this.memory.v.get(primary.key)?.type);
        if (isPayout && choke?.inboundPhones) {
          campaignRole = 'payout';
          inboundPhones = choke.inboundPhones;
        } else if (!isPayout && [...this.memory.payoutsOf(primary.key)].some((p) => campaign.members.includes(p))) {
          campaignRole = 'shares_payout';
        } else campaignRole = 'member';
      }
      if (primary.st.state !== 'clear') ring = (await this.graph.ringOf(primary.key)).value;
    }
    const domain = items.find((i) => i.type === 'domain');
    const lookalike = domain ? (await this.graph.lookalikeDomain(domain.value)).value : null;

    const verdict = buildVerdict({
      checkId: randomId('chk'),
      items: enriched,
      primary,
      blast,
      campaign,
      campaignRole,
      inboundPhones,
      ring,
      triage: tri,
      lookalike,
      lang,
      surface: body.surface,
      context: body.context || {},
      engine,
      startedAt,
      baseUrl: this.config.publicBaseUrl
    });
    verdict.reason = this.llm.polish(verdict.reason, lang);
    this.state.remember(verdict);
    return verdict;
  }

  /**
   * File a report. HTTP callers never pass `opts`; the seeder uses it to backdate reports
   * (`ts`), tag them (`src: 'demo'`) and skip the per-reporter rate limit.
   */
  async report(body, meta, opts = {}) {
    const items = this.collect(body);
    if (!items.length) throw Object.assign(new Error('No identifiers found to report'), { status: 400 });
    const verdictKind = body.verdict === 'safe' ? 'safe' : 'scam';
    const reporterHash = this.reporterHash(body.reporter, meta);
    const before = new Map(items.map((i) => [i.key, this.memory.stateOf(i.key).state]));
    const res = this.graph.addReport({
      identifiers: items,
      text: typeof body.text === 'string' ? body.text : '',
      reporterHash,
      net: meta.net,
      verdict: verdictKind,
      city: typeof body.city === 'string' ? body.city.slice(0, 60) : body.context?.city,
      lang: body.lang,
      surface: body.surface,
      ts: opts.ts,
      src: opts.src || 'user',
      bypassRateLimit: !!opts.bypassRateLimit
    });
    if (res.error) throw Object.assign(new Error('Too many reports from this device in the last hour'), { status: 429 });

    // Trust: reporting an allow-listed brand or platform as a scam is a contradiction;
    // having a report corroborated into "confirmed" by independent clusters earns trust.
    const reporterId = `reporter:${reporterHash}`;
    if (verdictKind === 'scam' && items.some((i) => this.memory.isAllowlisted(i.key))) this.memory.adjustReporterTrust([reporterId], TRUST.contradicted);
    for (const i of items) {
      if (before.get(i.key) !== 'confirmed' && this.memory.stateOf(i.key).state === 'confirmed') {
        this.memory.adjustReporterTrust(this.memory.reportsOf(i.key).map((r) => r.a.reporter), TRUST.corroborated);
      }
    }
    if (opts.quiet) return { ok: true, reportId: res.reportId.replace(/^report:/, '') };
    const verdict = await this.evaluate(items, body);
    this.viasocket.emit(verdict.state === 'confirmed' ? 'verdict.confirmed' : 'report.created', verdict);
    return { ok: true, reportId: res.reportId.replace(/^report:/, ''), verdict };
  }

  dispute(body) {
    const n = normaliseIdentifier(body.type, body.value);
    if (!n) throw Object.assign(new Error('Send { type, value } of the identifier you are disputing'), { status: 400 });
    const id = this.#resolveUrlScheme(n);
    const entry = this.graph.dispute(id.key, {
      reason: body.reason,
      contactHash: body.contact ? saltedHash(this.config.reporterSalt, `contact:${body.contact}`) : null
    });
    return { ok: true, disputeId: entry.id, state: this.memory.stateOf(id.key).state, status: 'pending_review' };
  }

  /** Public campaign shape used by /api/ring, /api/rings/top. */
  publicCampaign(c) {
    if (!c) return null;
    const anchorType = this.memory.v.get(c.anchor)?.type;
    const choke = this.memory.chokepointOf(c.anchor);
    return {
      id: c.id, name: c.name, size: c.size, reports: c.reports, identifiers: c.identifiers, pattern: c.pattern,
      firstSeen: new Date(c.firstSeen).toISOString(), lastSeen: new Date(c.lastSeen).toISOString(), cities: c.cities, demo: Boolean(c.demo),
      chokepoint: PAYABLE.has(anchorType) ? { type: typeOfKey(c.anchor), label: labelOf(c.anchor), inboundPhones: choke?.inboundPhones || 0 } : null
    };
  }
}
