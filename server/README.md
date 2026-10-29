# JAAL server

Node 22 API for JAAL: the shared scam-ring graph, verdicts, seeds, and the Dodo / Cake Wallet /
viaSocket / Wispr / Claude integrations. It runs locally with no secrets: in-memory graph,
demo seed, and demo mode for every external service. Env vars switch each service to the real one.

```bash
npm install
npm run seed      # cache open feeds to data/feeds/ and load the Indian demo dataset into data/graph.json
npm start         # http://localhost:8787  (also serves ../web at / and ../shared at /shared)
npm test          # node:test suite
```

| script | what it does |
|---|---|
| `start` / `dev` | run the server (`dev` restarts on file changes) |
| `seed` | `seed:feeds` then `seed:demo` |
| `seed:feeds` | download OpenPhish, MetaMask eth-phishing-detect, ScamSniffer (and URLhaus with a key) to `data/feeds/`, then import them as confirmed identifiers (`source: feed:<name>`) |
| `seed:demo` | load 8 synthetic Indian campaigns tagged `source: demo` (replaces any earlier demo data) |
| `seed:clear-demo` | remove everything tagged `demo` |

Stop the server before you seed. A running server holds the graph in memory and would overwrite
`data/graph.json` the next time it saves; the seeder refuses to run while it finds one on `PORT`.

## Environment (`.env`, see `.env.example`)

| var | default | effect |
|---|---|---|
| `PORT` | 8787 | HTTP port |
| `PUBLIC_BASE_URL` | `http://localhost:PORT` | used in share links, action hrefs, checkout return URLs |
| `REPORTER_SALT` | dev salt | salt for re-hashing device ids, contacts and /24 networks |
| `GRAPH_BACKEND` | `memory` | `tigergraph` mirrors writes to TigerGraph and runs the 6 GSQL queries there, falling back to memory per call |
| `TG_HOST`, `TG_GRAPH`, `TG_TOKEN` / `TG_SECRET` | – | TigerGraph 4.x / Savanna REST++ (token from secret via `/gsql/v1/tokens`, falling back to `/restpp/requesttoken`) |
| `DODO_API_KEY`, `DODO_PRODUCT_ID`, `DODO_ENV` | demo | hosted checkout via `POST /checkouts` on test./live.dodopayments.com |
| `DODO_WEBHOOK_SECRET` | – | `whsec_…`, Standard Webhooks verification for `/api/webhooks/dodo` |
| `JAAL_API_KEYS` | – | `key:dodoCustomerId,…`; `/api/check` calls with `x-jaal-key` are metered to `data/meter.json` and Dodo `POST /events/ingest` |
| `VIASOCKET_WEBHOOK_URL` | demo | confirmed verdicts and new reports are POSTed here; runs are logged either way |
| `CAKE_XMR_ADDRESS`, `CAKE_BTC_ADDRESS`, `MONERO_WALLET_RPC_URL` | placeholder | `monero:` / `bitcoin:` payment URIs + QR; wallet-rpc `create_address` gives each customer a fresh subaddress |
| `WISPR_API_KEY` | – | Wispr Flow WebSocket STT for WAV uploads to `/api/voice`; without it, send `{ transcript }` |
| `ANTHROPIC_API_KEY` | – | `claude-haiku-5-5` polishes reasons in the background and extracts identifiers from messy text (1.5 s cap) |
| `URLHAUS_AUTH_KEY` | – | seed only; URLhaus public dumps now return HTTP 410 |
| `JAAL_DATA_DIR`, `JAAL_PERSIST=0` | `data/`, on | test and ops overrides |

## Endpoints

SPEC.md is the contract. Implemented: `POST /api/check`, `/api/report`, `/api/dispute`, `/api/voice`,
`GET /api/stats`, `/api/ring/:campaignId`, `/api/rings/top`, `/api/prefixes`, `/api/bucket/:prefix`,
`/api/chokepoints`, `/api/spread/:campaignId`, guardian `pair | link | alert | alerts`,
`POST /api/checkout/dodo`, `POST /api/webhooks/dodo`, `GET /api/pay/crypto?asset=xmr|btc`, `GET /api/health`.

Additive endpoints, not in SPEC:

- `GET /api/lookalike/:domain`: brand and reported-domain lookalikes.
- `POST /api/similar { text }`: nearest stored scam scripts.
- `GET /api/integrations/viasocket/log`: the viaSocket run log.

## Layout

```
src/
  index.js            entry; app.js wires routes, CORS, rate limits, static hosting
  pipeline.js         check / report / dispute: extraction -> graph writes -> verdict
  verdict.js          state rule (clear | reported | confirmed), primary pick, Verdict assembly
  trust.js            poisoning defences: trust deltas, cluster window, rate limit, confirm threshold
  copy.js actions.js  en/hi/gu copy; Chakshu, 1930, WhatsApp, bank email drafts
  privacy.js          message text -> redacted script before storage
  state.js            payments, guardian pairing, recent verdicts (data/state.json)
  graph/
    index.js          backend selection + TigerGraph fallback
    memory.js         typed graph, decay, persistence, all six queries
    louvain.js        WCC + Louvain
    similarity.js     256-d hashed embedding, shingles, lookalike scoring, brand list
    tigergraph.js     REST++ client, upsert mirroring, GSQL result mappers
  integrations/       dodo, cake, viasocket, wispr, llm
  seed/               feeds.js, demo-india.js, cli.js
test/                 node:test suites
```

## Graph engine notes

- Schema mirrors `tigergraph/schema.gsql`, with vertex id = canonical key `type:value`.
  `ifsc` is stored as a BankAccount attribute. `remote_app` maps to ScamPattern and is never judged.
- Hops are counted between identifiers, so a report linking two identifiers is one hop.
  `stats.confirmedWithin2Hops` counts distinct reports that touch a confirmed identifier within 2 hops.
- `ring_detection` runs in two passes. WCC over deterministic edges gives entities. Louvain over
  decayed weights gives campaigns, and a campaign needs at least 2 identifiers and 3 reports.
  Identifiers with more than 250 neighbours, and popular platform domains, are never expanded.
- `confirmed` needs both of these:
  - 3 or more reports from 2 or more independent clusters, or a public-feed match.
  - A trust-weighted score of at least 1.0. Each cluster contributes its best `trust × 0.5^(age/21d)`,
    a feed contributes 1.0, and "safe" votes subtract.

  A cluster is one reporter, or several reporters on the same /24 within 30 minutes.
  A pending dispute demotes `confirmed` to `reported`.
