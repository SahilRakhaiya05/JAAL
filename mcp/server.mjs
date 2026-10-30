#!/usr/bin/env node
/*
 * JAAL MCP server: public, read-only access to the shared scam-ring graph.
 *
 *   node server.mjs            stdio (Claude Desktop / Cursor / Claude Code spawn it)
 *   node server.mjs --http     Streamable HTTP on :8788/mcp (MCP_PORT / PORT to change)
 *
 * Every tool is a thin wrapper over the JAAL HTTP API (SPEC.md) at
 * JAAL_API_BASE (default http://localhost:8787/api). No report, dispute or
 * payment tools exist here on purpose: an agent can look, never write.
 * check_identifier does call POST /api/check (with source "mcp"); the server
 * counts the check like any other lookup but it creates no report.
 */
import http from 'node:http';
import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const API = (process.env.JAAL_API_BASE || 'http://localhost:8787/api').replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.JAAL_API_TIMEOUT_MS || 8000);
const VERSION = '0.1.0';

// shared/extract.js (CommonJS, no deps) when running inside the repo; when this
// folder is used on its own the server-side extraction in /api/check does the work.
let extract = null;
try {
  extract = createRequire(import.meta.url)('../shared/extract.js').extract;
} catch { /* standalone: fall back to sending text */ }

// ------------------------------------------------------------ API client
class ApiError extends Error {}

async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const why = e.name === 'TimeoutError' ? `timed out after ${TIMEOUT_MS} ms` : (e.cause?.code || e.message);
    throw new ApiError(`JAAL API unreachable at ${API} (${why}). Start the server (cd server && npm start) or set JAAL_API_BASE.`);
  }
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) {
    const msg = json?.error || json?.message || text.slice(0, 200) || res.statusText;
    throw new ApiError(`JAAL API ${method} ${path} -> HTTP ${res.status}: ${msg}`);
  }
  return json;
}

const ok = (summary, data) => ({
  content: [{ type: 'text', text: data === undefined ? summary : `${summary}\n\n${JSON.stringify(data, null, 2)}` }],
});
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: e instanceof ApiError ? e.message : `Error: ${e.message}` }] });
const guard = (fn) => async (args) => { try { return await fn(args || {}); } catch (e) { return fail(e); } };

// ------------------------------------------------------------ formatting
function ringLine(r) {
  const c = r?.campaign || r || {};
  const n = r?.ring?.nodes?.length;
  return `${c.name || c.id} [${c.id}]: ${c.size ?? n ?? '?'} identifiers` +
    (c.pattern ? `, pattern ${c.pattern}` : '') + (c.firstSeen ? `, first seen ${String(c.firstSeen).slice(0, 10)}` : '') +
    (c.cities?.length ? `, cities ${c.cities.join(', ')}` : '');
}

function verdictSummary(v) {
  if (!v || typeof v !== 'object') return 'No verdict returned.';
  const lines = [`State: ${v.state}${v.confidence !== undefined ? ` (confidence ${v.confidence})` : ''}`];
  if (v.headline) lines.push(v.headline);
  if (v.reason) lines.push(v.reason);
  if (v.stats) lines.push(`Reports: ${v.stats.reports}; confirmed within 2 hops: ${v.stats.confirmedWithin2Hops}; hops to confirmed: ${v.stats.hopsToConfirmed ?? 'none'}`);
  if (v.campaign) lines.push(`Ring: ${ringLine(v.campaign)}`);
  if (v.engine) lines.push(`Engine: ${v.engine}, ${v.latencyMs} ms`);
  return lines.join('\n');
}

// ------------------------------------------------------------ server factory
function buildServer() {
  const server = new McpServer(
    { name: 'jaal', title: 'JAAL scam-ring graph (read-only)', version: VERSION },
    {
      instructions:
        'JAAL is a shared graph of reported scam identifiers in India (phones, UPI handles, bank accounts, URLs, APKs, crypto). ' +
        'Use check_identifier before paying or calling an unknown party. States: clear (no signal), reported (others reported it), ' +
        'confirmed (corroborated ring). Say "reported" and "ring", never "fraudster". These tools are read-only.',
    },
  );
  const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

  server.registerTool('check_identifier', {
    title: 'Check an identifier or message',
    description:
      'Check a phone number, UPI handle, bank account, URL/domain, APK name or crypto address, or a whole suspicious message, ' +
      'against the JAAL graph. Returns clear / reported / confirmed with report counts and the ring it belongs to, if any.',
    inputSchema: {
      value: z.string().min(3).max(512).optional().describe('One identifier, e.g. "refund.desk@ybl" or "+919812300001"'),
      text: z.string().min(3).max(8000).optional().describe('A full message to extract identifiers from'),
      lang: z.enum(['en', 'hi', 'gu']).optional(),
    },
    annotations: { ...RO, idempotentHint: false },
  }, guard(async ({ value, text, lang }) => {
    if (!value && !text) return fail(new Error('Pass either value or text.'));
    const body = { source: 'mcp', surface: 'manual', lang };
    if (text) body.text = text;
    else {
      const ids = extract ? extract(value) : [];
      if (ids.length) body.identifiers = ids.map(({ type, value: v }) => ({ type, value: v }));
      else body.text = value;
    }
    const v = await api('/check', { method: 'POST', body });
    return ok(verdictSummary(v), v);
  }));

  server.registerTool('get_ring', {
    title: 'Get a ring',
    description: 'Fetch one campaign (ring) and its pruned subgraph (<= 40 nodes with hop 0/1/2, report counts, edges).',
    inputSchema: { campaign_id: z.string().min(1).max(256).describe('Campaign id, e.g. from check_identifier or top_rings') },
    annotations: RO,
  }, guard(async ({ campaign_id }) => {
    const r = await api(`/ring/${encodeURIComponent(campaign_id)}`);
    return ok(ringLine(r), r);
  }));

  server.registerTool('top_rings', {
    title: 'Top rings',
    description: 'The largest / most active rings right now ("ring of the day").',
    inputSchema: { limit: z.number().int().min(1).max(50).default(10).optional() },
    annotations: RO,
  }, guard(async ({ limit = 10 }) => {
    const rows = await api(`/rings/top?limit=${limit}`);
    const list = Array.isArray(rows) ? rows : rows?.rings || [];
    return ok(list.length ? list.map((r, i) => `${i + 1}. ${ringLine(r)}`).join('\n') : 'No rings yet.', list);
  }));

  server.registerTool('money_chokepoints', {
    title: 'Money chokepoints',
    description: 'Bank accounts / UPI handles / wallets that the most distinct reported phones route money to: the best freeze targets.',
    inputSchema: { limit: z.number().int().min(1).max(50).default(10).optional() },
    annotations: RO,
  }, guard(async ({ limit = 10 }) => {
    const rows = await api(`/chokepoints?limit=${limit}`);
    const list = Array.isArray(rows) ? rows : rows?.chokepoints || [];
    const fmt = (c) => `${c.id || c.key || `${c.type}:${c.value}`}: ${c.inboundPhones ?? c.inbound_phones ?? c.inbound_total ?? c.inbound ?? '?'} inbound phones`;
    return ok(list.length ? list.map((c, i) => `${i + 1}. ${fmt(c)}`).join('\n') : 'No chokepoints yet.', list);
  }));

  server.registerTool('spread_map', {
    title: 'Spread map',
    description: 'How a ring spread across Indian cities over time: first sighting and report count per city.',
    inputSchema: { campaign_id: z.string().min(1).max(256) },
    annotations: RO,
  }, guard(async ({ campaign_id }) => {
    const rows = await api(`/spread/${encodeURIComponent(campaign_id)}`);
    const list = Array.isArray(rows) ? rows : rows?.cities || [];
    return ok(list.length ? list.map((c) => `${String(c.firstSeen ?? c.first_seen).slice(0, 10)}  ${c.city}: ${c.count ?? c.reports}`).join('\n') : 'No city data for this ring.', list);
  }));

  server.registerTool('graph_stats', {
    title: 'Graph stats',
    description: 'Public counters: users, checks, identifiers, rings, reports; plus which graph engine is serving.',
    inputSchema: {},
    annotations: RO,
  }, guard(async () => {
    const [stats, health] = await Promise.all([api('/stats'), api('/health').catch(() => null)]);
    const engine = health?.engine || health?.graphBackend || (health?.integrations?.tigergraph ? 'tigergraph' : health ? 'memory' : 'unknown');
    return ok(`${stats.identifiers} identifiers, ${stats.rings} rings, ${stats.reports} reports, ${stats.checks} checks (engine: ${engine})`, { stats, health });
  }));

  return server;
}

// ------------------------------------------------------------ transports
async function startStdio() {
  await buildServer().connect(new StdioServerTransport());
  console.error(`jaal-mcp ${VERSION} on stdio -> ${API}`);   // stderr: stdout is the protocol
}

function startHttp() {
  const port = Number(process.env.MCP_PORT || process.env.PORT || 8788);
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id',
  };
  const httpServer = http.createServer(async (req, res) => {
    for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    if (url.pathname === '/health' || url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ ok: true, name: 'jaal-mcp', version: VERSION, mcp: '/mcp', api: API }));
      return;
    }
    if (url.pathname !== '/mcp' && url.pathname !== '/mcp/') { res.writeHead(404).end(); return; }
    if (req.method !== 'POST') {
      // stateless server: no server-initiated SSE stream, no sessions to delete
      res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' })
        .end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed (stateless server, use POST)' }, id: null }));
      return;
    }
    // Stateless mode: a fresh server + transport per request, so any number of
    // public clients can hit one process with no session bookkeeping.
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null }));
      }
      console.error('mcp request failed:', e);
    }
  });
  httpServer.listen(port, () => console.error(`jaal-mcp ${VERSION} streamable HTTP on http://localhost:${port}/mcp -> ${API}`));
}

if (process.argv.includes('--http') || process.env.MCP_TRANSPORT === 'http') startHttp();
else await startStdio();
