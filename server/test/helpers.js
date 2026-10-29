import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readConfig } from '../src/config.js';
import { createApp } from '../src/app.js';

/** A fresh app on an empty temp data dir, no persistence, no external services. */
export async function freshApp(env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaal-test-'));
  const config = readConfig({ JAAL_DATA_DIR: dataDir, JAAL_PERSIST: '0', PUBLIC_BASE_URL: 'http://jaal.test', ...env });
  return { ...(await createApp(config)), config };
}

/** Start the HTTP server on an ephemeral port; returns { base, close }. */
export function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }));
  });
}

export const meta = (n = 1) => ({ net: `net-${n}` });

/** File one scam report from a distinct reporter on a distinct network. */
export const report = (pipeline, text, i, opts = {}) =>
  pipeline.report({ text, reporter: `device-${i}` }, meta(i), { quiet: true, ...opts });
