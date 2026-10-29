// Configuration: a tiny .env loader plus one frozen config object.
// Every external service is optional; a missing env var means "demo mode".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_DIR = path.resolve(SERVER_DIR, '..');

/** Load KEY=VALUE lines from server/.env without overriding variables already set. */
export function loadDotEnv(file = path.join(SERVER_DIR, '.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || line.trim().startsWith('#')) continue;
    let value = m[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

export function readConfig(env = process.env) {
  const dataDir = path.resolve(env.JAAL_DATA_DIR || path.join(SERVER_DIR, 'data'));
  const port = Number(env.PORT) || 8787;
  const dodoEnv = env.DODO_ENV === 'live_mode' ? 'live_mode' : 'test_mode';
  return Object.freeze({
    port,
    dataDir,
    webDir: path.join(REPO_DIR, 'web'),
    sharedDir: path.join(REPO_DIR, 'shared'),
    publicBaseUrl: (env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
    graphBackend: env.GRAPH_BACKEND === 'tigergraph' ? 'tigergraph' : 'memory',
    persist: env.JAAL_PERSIST !== '0',
    reporterSalt: env.REPORTER_SALT || 'jaal-dev-salt-change-me',
    tg: {
      host: (env.TG_HOST || '').replace(/\/+$/, ''),
      graph: env.TG_GRAPH || 'JAAL',
      secret: env.TG_SECRET || '',
      token: env.TG_TOKEN || ''
    },
    dodo: {
      apiKey: env.DODO_API_KEY || '',
      webhookSecret: env.DODO_WEBHOOK_SECRET || '',
      productId: env.DODO_PRODUCT_ID || '',
      env: dodoEnv,
      baseUrl: dodoEnv === 'live_mode' ? 'https://live.dodopayments.com' : 'https://test.dodopayments.com',
      // "apiKey:dodoCustomerId,..." pairs: callers of the metered API tier.
      meterKeys: Object.fromEntries((env.JAAL_API_KEYS || '').split(',').filter(Boolean).map((p) => p.split(':')))
    },
    viasocketUrl: env.VIASOCKET_WEBHOOK_URL || '',
    cake: {
      xmr: env.CAKE_XMR_ADDRESS || '',
      btc: env.CAKE_BTC_ADDRESS || '',
      moneroRpc: (env.MONERO_WALLET_RPC_URL || '').replace(/\/+$/, '')
    },
    wisprKey: env.WISPR_API_KEY || '',
    anthropicKey: env.ANTHROPIC_API_KEY || '',
    urlhausKey: env.URLHAUS_AUTH_KEY || ''
  });
}
