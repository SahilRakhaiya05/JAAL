# JAAL — जाल

**An ambient scam shield for India.** JAAL watches the messages, pages and pastes already on your laptop and
phone. The moment one belongs to a scam ring other people have already reported, it says so, on top of
whatever you are looking at. No account, no contacts, no KYC.

> Scammers rotate phone numbers in days. They keep payout accounts for months.
> The connection between them is the only durable signal, and only a graph can follow it.

| Try it | Where |
|---|---|
| Chrome extension (first) | `web/extension.zip` → `chrome://extensions` → Developer mode → Load unpacked. Guide: `/extension.html` |
| Web check, no install | `/check.html` |
| Android APK (sideload) | `web/jaal.apk` |
| Public read-only MCP server | [`mcp/README.md`](mcp/README.md) |
| TigerGraph schema + six GSQL queries | [`tigergraph/`](tigergraph/) |

## How it works

1. **Sensors**: the Chrome extension (WhatsApp Web, Telegram Web, Gmail, paste events, remote-access
   downloads, site checks) and the Android app (notification listener, overlay, call screening).
   No AccessibilityService.
2. **On-device triage**: [`shared/extract.js`](shared/extract.js) pulls phone numbers, UPI handles, accounts,
   links, APKs and wallet addresses out of the text and scores it in about a millisecond. Almost everything
   is discarded on the device.
3. **Private lookup**: the device holds 8-hex SHA-256 prefixes of reported identifiers (the Safe Browsing
   pattern). It only asks the server on a prefix hit or a strong signal.
4. **The graph** answers with one of three states: *clear*, *reported by others* or *confirmed ring*.
   It never gives a binary fraud label. Each answer comes with the ring, the reason in one sentence, and
   the next step: a Chakshu draft, the 1930 script, or a card for the family group.
5. **Every check writes back**, so the graph is denser after each use.

The six questions only a graph answers: blast radius, ring detection (WCC then Louvain), money chokepoint,
lookalike domain, rewritten-script match (vector) and spread over time. See
[`tigergraph/README.md`](tigergraph/README.md).

## Run it locally (zero secrets)

```bash
cd server && npm install && npm run seed && npm start
```

Then open http://localhost:8787. The server runs the in-memory engine, which mirrors the TigerGraph schema
1:1. Every external service is optional and switches on by env var (see `server/.env.example`); its current
mode shows at `/api/health`.

## Honesty notes

- **Demo seed.** The Indian campaigns (`server/src/seed/demo-india.js`) are a labelled demo set. They are
  tagged `Demo data` in the UI and **excluded from the public counter**; `npm run seed:clear-demo` removes
  them. Open-feed identifiers (OpenPhish, MetaMask, ScamSniffer) are real public data and do count.
- **Benchmark.** [`tigergraph/bench/README.md`](tigergraph/bench/README.md) has real runs only. On sparse
  data Postgres handles a 4-hop blast radius in under a millisecond. It degrades on dense, deep traversals
  (p95 ≈ 300 ms at 8–12 hops), because a recursive CTE keeps no visited set. TigerGraph rows need a
  Savanna instance (`run-tigergraph.mjs`).
- **Privacy.** Reporters are salted hashes. Contacts are never read. The personal baseline stays on the
  device. Chakshu drafts are never auto-submitted. Every verdict has a dispute link. See `/privacy.html`.

## Layout

`shared/` extractor, tokens, ring renderer · `server/` API + graph engine + integrations · `web/` site ·
`extension/` Chrome MV3 · `android/` Kotlin app · `tigergraph/` GSQL + loaders + benchmark · `mcp/` MCP server.
Contracts live in [`SPEC.md`](SPEC.md).
