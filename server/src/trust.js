// Poisoning defences: reporter trust, independent clusters, rate limits.
// A scammer with one phone (or one office on one /24) cannot confirm anything alone,
// and cannot get a competitor or a bank's domain listed by mass-reporting it.

export const TRUST = Object.freeze({
  start: 0.5,
  min: 0.05,
  max: 1,
  corroborated: 0.05, // your report was later confirmed by independent clusters
  disputed: -0.1, // an identifier you reported was disputed by its owner
  contradicted: -0.25 // you reported an allow-listed brand/platform domain
});

export const REPORTS_PER_HOUR = 30;
// Reports from different devices on the same /24 network within this window are one cluster.
export const CLUSTER_WINDOW_MS = 30 * 60_000;

export const CONFIRM = Object.freeze({
  minReports: 3,
  minClusters: 2,
  // Two fresh reports from independent new reporters (2 x 0.5) just reach it; old or
  // low-trust reports need more company. A public feed match contributes FEED_WEIGHT.
  threshold: 1.0,
  feedWeight: 1.0
});

export const adjustTrust = (trust, delta) => Math.min(TRUST.max, Math.max(TRUST.min, Math.round((trust + delta) * 1000) / 1000));
