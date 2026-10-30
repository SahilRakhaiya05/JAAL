# JAAL MCP server (public, read-only)

This lets an AI agent ask JAAL's shared scam-ring graph "has anyone reported
this UPI handle / number / link?" before a user pays, calls back, or installs
something. It wraps the JAAL HTTP API (`SPEC.md`). It is built on the official
`@modelcontextprotocol/sdk` (1.32.x) and supports stdio and Streamable HTTP.

| tool | input | calls | returns |
|---|---|---|---|
| `check_identifier` | `{ value? , text?, lang? }` | `POST /api/check` (`source: "mcp"`) | verdict summary (state, headline, reason, report counts, ring) + full Verdict JSON |
| `get_ring` | `{ campaign_id }` | `GET /api/ring/:id` | campaign + ring (<= 40 nodes) |
| `top_rings` | `{ limit? = 10 }` | `GET /api/rings/top` | ranked rings |
| `money_chokepoints` | `{ limit? = 10 }` | `GET /api/chokepoints` | accounts / handles with the most distinct inbound phones |
| `spread_map` | `{ campaign_id }` | `GET /api/spread/:id` | city, first seen, count |
| `graph_stats` | `{}` | `GET /api/stats` + `/api/health` | public counters + which engine is serving |

**Read-only by design.** There are no report, dispute, guardian or payment
tools, and every tool carries `readOnlyHint: true`. `check_identifier` is a
lookup. The server counts it as a check, but it never files a report. If the
API is down, a tool returns `isError: true` with a one-line reason (for
example `JAAL API unreachable at http://localhost:8787/api (ECONNREFUSED)`).
The process does not crash.

## Run

```bash
cd mcp && npm install
node server.mjs                 # stdio
node server.mjs --http          # http://localhost:8788/mcp  (MCP_PORT to change), GET /health
JAAL_API_BASE=https://jaal.example/api node server.mjs --http
npm test                        # SDK client smoke test over HTTP (server must be running) and stdio
```

| env | default | |
|---|---|---|
| `JAAL_API_BASE` | `http://localhost:8787/api` | JAAL server |
| `MCP_PORT` / `PORT` | `8788` | HTTP mode |
| `MCP_TRANSPORT=http` | | same as `--http` |
| `JAAL_API_TIMEOUT_MS` | `8000` | per API call |

HTTP mode is **stateless**: a fresh server and transport handle each POST to
`/mcp` (JSON responses, no session id). One process can serve any number of
public clients. GET and DELETE on `/mcp` return 405. CORS is open, and it
exposes `Mcp-Session-Id` for browser clients.

## Client config

Replace `https://jaal.example/mcp` with your deployed URL, or use
`http://localhost:8788/mcp` locally.

**Claude Code**

```bash
claude mcp add --transport http jaal https://jaal.example/mcp
# or local stdio:
claude mcp add jaal -e JAAL_API_BASE=http://localhost:8787/api -- node /abs/path/jaal/mcp/server.mjs
```

**Claude Desktop** (`claude_desktop_config.json`). Desktop launches stdio
servers. For a remote URL, add it under *Settings → Connectors* instead.

```json
{
  "mcpServers": {
    "jaal": {
      "command": "node",
      "args": ["/abs/path/jaal/mcp/server.mjs"],
      "env": { "JAAL_API_BASE": "https://jaal.example/api" }
    }
  }
}
```

**Cursor** (`~/.cursor/mcp.json` or `.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "jaal": { "url": "https://jaal.example/mcp" }
  }
}
```

or stdio: `{ "mcpServers": { "jaal": { "command": "node", "args": ["/abs/path/jaal/mcp/server.mjs"], "env": { "JAAL_API_BASE": "http://localhost:8787/api" } } } }`

Example prompt: *"Someone on WhatsApp says my parcel is seized and wants
₹25,000 at refund.desk@ybl. Check it with jaal."*

## The official TigerGraph MCP, for the operator's agent

The JAAL MCP above is the public face. It never touches the database. For
the **operator's** own agent (exploring the graph, running the GSQL queries,
checking vector index status), put TigerGraph's official MCP server
([`tigergraph-mcp`](https://pypi.org/project/tigergraph-mcp/), 1.0.4 at the
time of writing, Python >= 3.10, TigerGraph >= 4.1, 4.2+ for the vector tools)
in front of the Savanna instance:

```bash
pip install tigergraph-mcp                          # Python 3.10+
pip install uvicorn starlette                       # only for HTTP mode
```

`.env` (token auth, Savanna):

```bash
TG_HOST=https://<id>.i.tgcloud.io
TG_GRAPHNAME=JAAL
TG_API_TOKEN=<token from setup.md step 5>
TG_TGCLOUD=true
# password auth instead: TG_USERNAME=... TG_PASSWORD=...   (pyTigerGraph mints a token on 401)
# TG_RESTPP_PORT=9000  TG_GS_PORT=14240                    (self-hosted defaults)
```

Claude Code:

```bash
claude plugin marketplace add tigergraph/tigergraph-mcp     # official plugin, runs via uvx
claude plugin install tigergraph@tigergraph
# or plain stdio:
claude mcp add tigergraph -e TG_HOST=https://<id>.i.tgcloud.io -e TG_GRAPHNAME=JAAL -e TG_API_TOKEN=<token> -e TG_TGCLOUD=true -- tigergraph-mcp
```

Claude Desktop / Cursor (stdio):

```json
{
  "mcpServers": {
    "tigergraph": {
      "command": "tigergraph-mcp",
      "args": ["--env-file", "/abs/path/.env"]
    }
  }
}
```

Streamable HTTP, shared by a team:

```bash
tigergraph-mcp --transport streamable-http --host 127.0.0.1 --port 8000
claude mcp add --transport http tigergraph http://127.0.0.1:8000/mcp/   # note the trailing slash
```

It exposes tools such as `tigergraph__run_installed_query` (call
`ring_of`, `blast_radius` and the other installed queries),
`tigergraph__get_graph_schema`, `tigergraph__search_top_k_similarity` and
`tigergraph__get_vector_index_status`. It authenticates to TigerGraph but not
its own callers. **Never expose it publicly.** Keep it on localhost or behind
an authenticating proxy, and serve only the JAAL MCP to the public.
`--allowed-tools` limits which tools it serves.
