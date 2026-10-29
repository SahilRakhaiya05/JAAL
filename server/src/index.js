// JAAL API server entry point: node src/index.js
import { loadDotEnv, readConfig } from './config.js';
import { createApp } from './app.js';

loadDotEnv();
const config = readConfig();
const { app, graph, state, viasocket, dodo, wispr, llm, cake } = await createApp(config);

const server = app.listen(config.port, () => {
  const s = graph.memory.stats();
  const h = graph.health();
  console.log(`[jaal] listening on http://localhost:${config.port}  (engine: ${h.active}${h.tigergraph.lastError ? `, tigergraph fallback: ${h.tigergraph.lastError}` : ''})`);
  console.log(`[jaal] graph: ${s.vertices} vertices, ${s.edges} edges, ${s.reports} reports, ${s.rings} campaigns`);
  console.log(`[jaal] integrations: dodo=${dodo.mode} viasocket=${viasocket.mode} wispr=${wispr.mode} llm=${llm.mode} cake=${cake.mode}`);
});

const shutdown = async () => {
  server.close();
  await graph.flush();
  viasocket.log.flush();
  state.file.flush();
  dodo.meter.flush();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
