#!/usr/bin/env node
// Smoke test with the official SDK client, over both transports.
//   node test-client.mjs [http://localhost:8788/mcp]
// Starts nothing for HTTP: run `node server.mjs --http` first (or pass a URL).
// The stdio leg spawns server.mjs itself.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] || 'http://localhost:8788/mcp';
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

async function exercise(label, transport) {
  const client = new Client({ name: 'jaal-mcp-smoke', version: '0.0.1' });
  await client.connect(transport);
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  check(names.join(',') === 'check_identifier,get_ring,graph_stats,money_chokepoints,spread_map,top_rings', `${label} tools/list -> ${names.join(', ')}`);
  check(tools.every((t) => t.annotations?.readOnlyHint === true), `${label} every tool is annotated readOnlyHint`);
  check(!names.some((n) => /report|dispute|pay/.test(n)), `${label} no write tools exposed`);

  const stats = await client.callTool({ name: 'graph_stats', arguments: {} });
  console.log(`      graph_stats -> isError=${!!stats.isError}: ${stats.content[0].text.split('\n')[0]}`);
  check(Array.isArray(stats.content) && stats.content[0].type === 'text', `${label} graph_stats returns text content (clean error if API down)`);

  const chk = await client.callTool({ name: 'check_identifier', arguments: { value: 'refund.desk@ybl' } });
  console.log(`      check_identifier -> isError=${!!chk.isError}: ${chk.content[0].text.split('\n')[0]}`);
  check(chk.content[0].type === 'text', `${label} check_identifier returns`);

  const bad = await client.callTool({ name: 'check_identifier', arguments: {} });
  check(bad.isError === true, `${label} check_identifier without args -> isError`);
  await client.close();
}

await exercise('http ', new StreamableHTTPClientTransport(new URL(url)));
await exercise('stdio', new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('./server.mjs', import.meta.url))],
  env: { ...process.env },
}));
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
