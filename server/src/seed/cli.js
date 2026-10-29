// npm run seed | seed:feeds | seed:demo | seed:clear-demo
// Writes straight into data/graph.json through the same pipeline the API uses.
import { loadDotEnv, readConfig } from '../config.js';
import { createApp } from '../app.js';
import { download, importCached } from './feeds.js';
import { demoReports } from './demo-india.js';

loadDotEnv();
const config = readConfig();
const command = process.argv[2] || 'all';

// A running server holds the graph in memory and would overwrite the seeded data/graph.json
// on its next save, so refuse unless --force.
if (!process.argv.includes('--force')) {
  const health = await fetch(`http://localhost:${config.port}/api/health`, { signal: AbortSignal.timeout(800) }).then((r) => r.json()).catch(() => null);
  if (health?.graph?.vertices !== undefined) {
    console.error(`[seed] a JAAL server is running on port ${config.port}; stop it first (or pass --force)`);
    process.exit(1);
  }
}

const { graph, pipeline } = await createApp(config);
const memory = graph.memory;

async function feeds() {
  await download(config.dataDir, { urlhausKey: config.urlhausKey });
  const summary = importCached(memory, config.dataDir);
  console.log('[seed] feeds imported:', summary);
}

function clearDemo() {
  const removed = memory.removeSource('demo');
  console.log(`[seed] removed ${removed} demo vertices`);
}

async function demo() {
  clearDemo();
  const started = Date.now();
  let n = 0;
  for (const r of demoReports()) {
    // Each synthetic victim reports from its own network so corroboration rules apply for real.
    await pipeline.report(
      { text: r.text, reporter: r.reporter, city: r.city, lang: r.lang, surface: 'manual', source: 'web' },
      { net: `demo-net-${r.reporter}` },
      { ts: r.ts, src: 'demo', bypassRateLimit: true, quiet: true }
    );
    n++;
  }
  const s = memory.stats();
  console.log(`[seed] ${n} demo reports in ${Date.now() - started} ms -> ${s.identifiers} identifiers, ${s.rings} campaigns`);
  for (const c of memory.campaigns()) console.log(`        campaign ${c.id}  ${c.name.padEnd(42)} ${String(c.size).padStart(3)} people  ${c.cities.join(' > ')}`);
}

if (command === 'feeds') await feeds();
else if (command === 'demo') await demo();
else if (command === 'clear-demo') clearDemo();
else if (command === 'all') {
  await feeds();
  await demo();
} else {
  console.error(`unknown command "${command}" (feeds | demo | clear-demo | all)`);
  process.exit(1);
}
await graph.flush();
process.exit(0);
