// Verdict states (SPEC): never a binary fraud label.
//   clear      no signal
//   reported   >=1 report touches the identifier or a 1-hop neighbour, not yet confirmed
//   confirmed  (>=3 reports from >=2 independent reporter clusters, OR a public feed match)
//              AND trust-weighted score >= threshold
// A pending dispute demotes confirmed -> reported until reviewed.
import { CONFIRM } from './trust.js';
import { headline, reason } from './copy.js';
import { buildActions } from './actions.js';
import { iso, daysAgo, round } from './util.js';

export const STATE_RANK = { clear: 0, reported: 1, confirmed: 2 };

/** Pure state rule over the evidence MemoryGraph.stateOf gathers. */
export function decideState(ev) {
  if (!ev.exists) return { state: 'clear', via: null, confidence: 0.5 };
  if (ev.allowlisted) return { state: 'clear', via: 'allowlist', confidence: 0.9 };
  const feed = ev.feeds.length > 0;
  const score = ev.score + (feed ? CONFIRM.feedWeight : 0);
  const corroborated = ev.reports >= CONFIRM.minReports && ev.clusters >= CONFIRM.minClusters;
  if ((feed || corroborated) && score >= CONFIRM.threshold) {
    if (ev.disputed) return { state: 'reported', via: 'disputed', confidence: 0.5 };
    const confidence = Math.min(0.99, 0.55 + 0.1 * Math.min(ev.clusters, 4) + (feed ? 0.2 : 0));
    return { state: 'confirmed', via: feed && !corroborated ? 'feed' : 'reports', confidence: round(confidence, 2) };
  }
  if (ev.reports > 0) return { state: 'reported', via: ev.disputed ? 'disputed' : 'reports', confidence: round(Math.min(0.75, 0.3 + 0.08 * ev.clusters), 2) };
  if (ev.neighbourReports > 0) return { state: 'reported', via: 'neighbour', confidence: 0.25 };
  return { state: 'clear', via: null, confidence: 0.6 };
}

// Which identifier a verdict is "about" when a message has several: worst state first,
// then the money end of the scam, then the most reported.
const TYPE_PRIORITY = ['upi', 'bank_account', 'crypto', 'phone', 'apk', 'url', 'domain', 'remote_app', 'ifsc'];
export function pickPrimary(items) {
  return [...items].sort(
    (a, b) =>
      STATE_RANK[b.st.state] - STATE_RANK[a.st.state] ||
      b.st.people - a.st.people ||
      b.st.reports - a.st.reports ||
      TYPE_PRIORITY.indexOf(a.type) - TYPE_PRIORITY.indexOf(b.type)
  )[0] || null;
}

/**
 * Assemble the public Verdict object (SPEC "Verdict").
 * input: { checkId, items:[{type,value,key,st}], primary, blast, campaign, campaignRole, inboundPhones,
 *          ring, triage, lookalike, lang, surface, context, engine, startedAt, baseUrl }
 */
export function buildVerdict(input) {
  const { checkId, items, primary, blast, campaign, triage, lookalike, lang = 'en', surface, context, engine, baseUrl } = input;
  const st = primary?.st;
  const state = st ? st.state : 'clear';
  const stats = {
    reports: blast ? blast.reportsWithin2Hops : 0,
    hopsToConfirmed: blast ? blast.hopsToConfirmed : null,
    confirmedWithin2Hops: blast ? blast.confirmedWithin2Hops : 0,
    firstSeen: st?.reports ? iso(st.firstSeen) : null,
    lastSeen: st?.reports ? iso(st.lastSeen) : null
  };
  const firstSeenTs = campaign?.firstSeen ?? (st?.reports ? st.firstSeen : null);
  const signals = triage?.triggers || [];
  const copyCtx = {
    state,
    primaryType: primary?.type,
    hasIdentifiers: items.length > 0,
    people: st?.people || 0,
    clusters: st?.clusters || 0,
    feeds: st?.feeds || [],
    neighbourReports: st?.neighbourReports || 0,
    disputed: st?.via === 'disputed',
    signals: signals.length,
    signalLabels: signals.map((s) => s.label),
    lookalike: state === 'clear' ? lookalike?.[0] || null : null,
    stats,
    campaign,
    campaignRole: input.campaignRole,
    inboundPhones: input.inboundPhones,
    firstSeenDays: firstSeenTs != null ? daysAgo(firstSeenTs) : null
  };
  const publicCampaign = campaign
    ? { id: campaign.id, name: campaign.name, size: campaign.size, firstSeen: iso(campaign.firstSeen), pattern: campaign.pattern, cities: campaign.cities, reports: campaign.reports }
    : null;
  return {
    id: checkId,
    state,
    confidence: st ? st.confidence : signals.length ? 0.4 : 0.5,
    headline: headline(copyCtx, lang),
    reason: reason(copyCtx, lang),
    identifiers: items.map((i) => ({ type: i.type, value: i.value, state: i.st.state, reports: i.st.reports, ...(i.chain ? { chain: i.chain } : {}) })),
    primary: primary ? { type: primary.type, value: primary.value } : null,
    stats,
    campaign: publicCampaign,
    ring: state === 'clear' ? null : input.ring || null,
    signals: [...signals, ...(copyCtx.lookalike ? [{ id: 'lookalike', label: `Looks like ${copyCtx.lookalike.target}` }] : [])],
    actions: buildActions({ state, primary, surface, context, campaign: publicCampaign, people: copyCtx.people, checkId, identifiers: items, baseUrl, lang }),
    latencyMs: Math.round((performance.now() - input.startedAt) * 10) / 10,
    engine
  };
}
