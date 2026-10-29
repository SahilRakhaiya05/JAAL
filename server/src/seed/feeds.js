// Open threat feeds. `download()` fetches and caches to data/feeds/ (never at request time);
// `importCached()` loads the cache into the graph as confirmed identifiers, source "feed:<name>".
import fs from 'node:fs';
import path from 'node:path';
import { keyOf, normUrl, registrable, HUB_DOMAINS, SHARED_HOSTING } from '../graph/model.js';
import { BRAND_DOMAINS } from '../graph/similarity.js';
import { fetchWithTimeout } from '../util.js';

export const FEEDS = {
  openphish: { url: 'https://openphish.com/feed.txt', file: 'openphish.txt', cap: 5000 },
  // URLhaus retired its unauthenticated dumps (HTTP 410); the API needs a free abuse.ch Auth-Key.
  urlhaus: { url: 'https://urlhaus-api.abuse.ch/v1/urls/recent/limit/1000/', file: 'urlhaus.json', cap: 1000, needsKey: true },
  metamask: { url: 'https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json', file: 'metamask.json', cap: 10000 },
  scamsniffer_domains: { url: 'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/domains.json', file: 'scamsniffer-domains.json', cap: 10000 },
  scamsniffer_addresses: { url: 'https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json', file: 'scamsniffer-addresses.json', cap: 5000 }
};

// shared/extract.js registrable() only knows Indian second-level suffixes; never list a
// foreign public suffix such as com.ng or co.uk as if it were one domain.
const PUBLIC_SUFFIX_2 = /^(com|co|org|net|gov|edu|ac|or|ne|go|gob|nic|mil|biz|info).[a-z]{2}$/;

const safeDomain = (host) => {
  const reg = registrable(host);
  if (PUBLIC_SUFFIX_2.test(reg) || !reg.includes('.')) return null;
  // A phishing page on someone's free-hosting subdomain must not list the platform itself.
  if (host !== reg && SHARED_HOSTING.has(reg)) return null;
  if (HUB_DOMAINS.has(reg) || BRAND_DOMAINS.has(reg) || SHARED_HOSTING.has(reg)) return null;
  return reg;
};

function fromUrls(lines, cap) {
  const out = [];
  for (const line of lines) {
    if (out.length >= cap) break;
    const n = normUrl(String(line).trim());
    if (!n) continue;
    out.push({ type: 'url', key: keyOf('url', n.url) });
    const d = n.host === registrable(n.host) ? safeDomain(n.host) : null; // only whole-domain listings mark the domain
    if (d) out.push({ type: 'domain', key: keyOf('domain', d) });
  }
  return out;
}

function fromDomains(list, cap) {
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    if (seen.size >= cap) break;
    const host = normUrl(String(raw))?.host;
    const d = host && safeDomain(host);
    if (d && !seen.has(d)) {
      seen.add(d);
      out.push({ type: 'domain', key: keyOf('domain', d) });
    }
  }
  return out;
}

/** Parse a cached feed file into identifiers. */
export function parseFeed(name, raw) {
  const f = FEEDS[name];
  switch (name) {
    case 'openphish':
      return fromUrls(raw.split(/\r?\n/).filter(Boolean), f.cap);
    case 'urlhaus':
      return fromUrls((JSON.parse(raw).urls || []).map((u) => u.url), f.cap);
    case 'metamask':
      // The blacklist grows by appending: the tail is the most recent.
      return fromDomains((JSON.parse(raw).blacklist || []).slice(-f.cap * 2).reverse(), f.cap);
    case 'scamsniffer_domains':
      return fromDomains(JSON.parse(raw), f.cap);
    case 'scamsniffer_addresses':
      return JSON.parse(raw).filter((a) => /^0x[a-f0-9]{40}$/i.test(a)).slice(0, f.cap).map((a) => ({ type: 'crypto', key: keyOf('crypto', a.toLowerCase()) }));
    default:
      return [];
  }
}

export async function download(dataDir, { urlhausKey } = {}) {
  const dir = path.join(dataDir, 'feeds');
  fs.mkdirSync(dir, { recursive: true });
  const manifestFile = path.join(dir, 'manifest.json');
  const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
  for (const [name, f] of Object.entries(FEEDS)) {
    if (f.needsKey && !urlhausKey) {
      manifest[name] = { ...manifest[name], status: 'skipped', note: 'set URLHAUS_AUTH_KEY (free abuse.ch key); public dumps return HTTP 410' };
      console.log(`[feeds] ${name}: skipped (no URLHAUS_AUTH_KEY)`);
      continue;
    }
    try {
      const res = await fetchWithTimeout(f.url, { headers: f.needsKey ? { 'Auth-Key': urlhausKey } : {} }, 60_000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      const count = parseFeed(name, body).length; // validates before we overwrite a good cache
      fs.writeFileSync(path.join(dir, f.file), body);
      manifest[name] = { status: 'ok', url: f.url, fetchedAt: new Date().toISOString(), identifiers: count };
      console.log(`[feeds] ${name}: ${count} identifiers cached`);
    } catch (err) {
      const cached = fs.existsSync(path.join(dir, f.file));
      manifest[name] = { ...manifest[name], status: cached ? 'stale' : 'error', error: err.message };
      console.log(`[feeds] ${name}: ${err.message}${cached ? ' (keeping cached copy)' : ''}`);
    }
  }
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  return manifest;
}

export function importCached(memory, dataDir) {
  const dir = path.join(dataDir, 'feeds');
  const summary = {};
  for (const [name, f] of Object.entries(FEEDS)) {
    const file = path.join(dir, f.file);
    if (!fs.existsSync(file)) continue;
    memory.removeSource(`feed:${name}`); // re-import replaces the previous snapshot
    const ids = parseFeed(name, fs.readFileSync(file, 'utf8'));
    summary[name] = memory.importFeed(name, ids);
  }
  return summary;
}
