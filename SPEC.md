# JAAL build spec (the contract every lane builds against)

JAAL (जाल, "net") is an ambient scam shield for India. Sensors (Chrome extension, Android app, web, bot)
watch what already arrives on the device, a cheap on-device triage discards almost everything, and only a
triggered item reaches the shared fraud graph. The graph answers "is this part of a known ring" and every
check writes back, so the graph gets denser on the same path the user is served on.

Deadline: Devfolio submission 31 Oct 2026 09:59 IST. Everything must run locally with zero secrets
(in-memory graph, demo seed), and upgrade to real services by env vars only.

## Repo layout (each lane owns exactly one folder; do not edit other lanes' folders)

```
jaal/
  SPEC.md                 this file (owner: lead)
  shared/extract.js       identifier extraction + on-device triage (owner: lead, UMD, no deps)
  shared/tokens.css       design tokens (owner: lead)
  shared/ring.js          ring renderer, SVG, browser classic script -> globalThis.JaalRing (owner: web lane)
  server/                 Node 22 API + graph engine + seed + Dodo/Cake/viaSocket (owner: server lane)
  tigergraph/             GSQL schema, 6 queries, loading jobs, Savanna setup, Postgres benchmark (owner: graph lane)
  mcp/                    public read-only JAAL MCP server (owner: graph lane)
  web/                    landing, check page, pricing, privacy, guardian, counter (owner: web lane)
  extension/              Chrome MV3 extension (owner: extension lane)
  android/                Kotlin Android app (owner: android lane)
```

Runtime: Node 22 (ESM, `"type":"module"` in server/ and mcp/), Python 3.9 available but not used.
`shared/` is CommonJS (has its own package.json) so ESM can `import extract from '../shared/extract.js'`
and the browser can load it with a classic `<script>` (it sets `globalThis.JaalExtract`).

## Identifiers

`shared/extract.js` exports `extract(text)`, `triage(text, ctx)`, `canonicalKey(type, value)`, `hashPrefix(hex)`.
Types: `phone` (`+919876543210`), `upi` (`name@ybl`, lowercase), `bank_account` (digits), `ifsc`, `url`
(normalised, no www), `domain` (registrable), `apk` (filename, lowercase), `crypto` (with `chain`:
btc|eth|xmr|trx), `remote_app` (anydesk, teamviewer ...). Key = `type:value`. Hash = SHA-256 hex of the key.
Prefix = first 8 hex chars.

## Verdict states (never a binary fraud label; defamation-safe)

| state | meaning | rule |
|---|---|---|
| `clear` | no signal | default |
| `reported` | reported by others | >=1 report touches the identifier or a 1-hop neighbour, not yet confirmed |
| `confirmed` | confirmed ring | >=3 reports from >=2 independent reporter clusters, OR a public feed match, AND trust-weighted score >= threshold |

Copy rules: say "reported" and "ring", never "fraud/fraudster". Numbers, not adjectives. State and offer,
never command ("61 people reported this handle", not "Do not pay"). Verdict line < 12 words.

## HTTP API (server, default port 8787, base `/api`, JSON, CORS open for GET + POST from extensions)

```
POST /api/check
  body: { text?: string, identifiers?: [{type,value}], source: "extension"|"android"|"web"|"bot"|"mcp",
          surface?: "whatsapp_web"|"telegram_web"|"gmail"|"paste"|"download"|"page"|"notification"|"call"|"clipboard"|"manual"|"voice",
          context?: { onCall?: bool, unknownSender?: bool, firstTimePayee?: bool, app?: string, url?: string },
          reporter?: string /* salted device hash, never a person */, lang?: "en"|"hi"|"gu" }
  200: Verdict

Verdict = {
  id: string,                       // check id
  state: "clear"|"reported"|"confirmed",
  confidence: number,               // 0..1
  headline: string,                 // < 12 words, e.g. "61 people reported this UPI handle"
  reason: string,                   // one plain sentence with numbers
  identifiers: Identifier[],        // what was extracted / checked, each with its own state + reports
  primary: { type, value } | null,  // the identifier the verdict is about
  stats: { reports: number, hopsToConfirmed: number|null, confirmedWithin2Hops: number, firstSeen: iso|null, lastSeen: iso|null },
  campaign: { id: string, name: string, size: number, firstSeen: iso, pattern: string, cities?: string[], demo?: bool } | null,  // demo = built only from the labelled demo seed
  ring: Ring | null,
  signals: [{id,label}],            // triage triggers
  actions: Action[],                // what to do next
  latencyMs: number,
  engine: "memory"|"tigergraph"
}

Ring = { center: string /*node id*/, nodes: [{ id, type, label, hop: 0|1|2, reports: number, confirmed: bool }],
         edges: [{ source, target, type }] }   // <= 40 nodes, already pruned for drawing

Action = { id: "chakshu"|"call_1930"|"share_family"|"bank_email"|"dispute"|"report", label: string,
           href?: string, text?: string }   // chakshu = filled draft + deep link, never auto-submitted

POST /api/report   { text?, identifiers?, reporter, verdict: "scam"|"safe", note?, lang? } -> { ok, reportId, verdict: Verdict }
POST /api/dispute  { type, value, reason, contact? } -> { ok, disputeId }   // demotes pending review
GET  /api/stats    -> { users, checks, identifiers, rings, paying, reports, updatedAt }   // public counter
GET  /api/ring/:campaignId -> { campaign, ring }
GET  /api/rings/top?limit=10 -> [{ campaign, ring }]           // "ring of the day" for landing + socials
GET  /api/prefixes -> { version, prefixes: string[] }          // Safe Browsing pattern: 8-hex prefixes of confirmed+reported keys
GET  /api/bucket/:prefix -> { hashes: [{hash, state, reports}] }  // full hashes in a prefix bucket
GET  /api/chokepoints?limit=10 -> money chokepoints (accounts/UPI with most distinct inbound phones)
GET  /api/spread/:campaignId -> [{ city, firstSeen, count }]
POST /api/guardian/pair    { deviceHash } -> { code }          // 6-digit code shown on parent device
POST /api/guardian/link    { code, guardianHash } -> { ok }
POST /api/guardian/alert   { deviceHash, verdictId } -> fan-out to guardians (stored; polled)
GET  /api/guardian/alerts?guardianHash= -> [{ verdict, at }]
POST /api/checkout/dodo    { plan: "family_monthly", email? } -> { checkoutUrl }   // Dodo Checkout Sessions API
POST /api/webhooks/dodo    (Standard Webhooks signature verified) -> marks paid, bumps `paying`
GET  /api/pay/crypto?asset=xmr|btc -> { uri, address, amount, qrSvg, reference }   // BIP21 / monero: URI for Cake Wallet
POST /api/voice  multipart audio or { transcript } -> Verdict   // Wispr Flow if key, else browser SpeechRecognition transcript
GET  /api/health
```

Everything in the API that names an external service is optional: missing env var -> feature runs in demo
mode and says so in `/api/health` (`integrations: { tigergraph, dodo, viasocket, wispr, llm }`).

Env vars (server/.env.example): `PORT`, `GRAPH_BACKEND=memory|tigergraph`, `TG_HOST`, `TG_GRAPH=JAAL`,
`TG_SECRET`/`TG_TOKEN`, `DODO_API_KEY`, `DODO_WEBHOOK_SECRET`, `DODO_PRODUCT_ID`, `DODO_ENV=test_mode|live_mode`,
`VIASOCKET_WEBHOOK_URL`, `CAKE_XMR_ADDRESS`, `CAKE_BTC_ADDRESS`, `WISPR_API_KEY`, `ANTHROPIC_API_KEY`,
`REPORTER_SALT`, `PUBLIC_BASE_URL`.

## Graph model (memory engine mirrors TigerGraph schema 1:1)

Vertices: Report, Reporter (salted hash), Phone, UpiHandle, BankAccount, Url, Domain, ApkHash, CryptoAddress,
MessageText, ScamPattern, Campaign.
Edges: REPORTED (Reporter->Report), MENTIONS (Report->identifier), PAYS_TO (Phone/Upi->BankAccount|Upi),
RESOLVES_TO (Url->Domain), HOSTED_ON, SAME_TEXT_AS, SIMILAR_SCRIPT (vector cosine), NEXT (temporal), IN_CAMPAIGN.
Every edge has `ts`; weights decay with a 21-day half-life; queries are time-windowed (default 90 days).

Six queries: `blast_radius`, `ring_detection` (WCC on deterministic edges -> entities, Louvain on weighted ->
campaigns), `money_chokepoint`, `lookalike_domain` (Jaccard on 3-shingles), `script_similarity` (vector),
`spread_map` (NEXT + window). Poisoning defences: reporter trust score, independent-cluster corroboration,
per-reporter rate limit, dispute demotion.

Privacy: reporter = salted hash; message text stored only after stripping the reporter's own names, amounts,
account numbers; contacts never read; device baseline never uploaded. `/api/prefixes` lets clients check
locally and only ask about a bucket.

## Design system (shared/tokens.css is the source of truth)

Dark first. ink-900 #0A0C0F card bg, ink-700 #16191D raised, ink-500 #2A2F35 hairlines (1px, never shadows),
paper #FBFAF7, text-hi #F4F3F0, text-lo #9BA1A8, brand #6E5BFF (ring, links, primary action - never a verdict),
state-caution #F2A93B (reported only), state-confirmed #E5484D (confirmed only).
Type: Inter (600/400) + Noto Sans Devanagari + Noto Sans Gujarati. Sizes: display 28/32 600, verdict 22/26 600,
body 15/22 400, caption 13/18 400, micro 11/14 400. Indic line-height 1.6.
States: clear = no card at all (silence); reported = 2px caution rule on the left, no fill, headline led by the count;
confirmed = confirmed colour, 12% tint fill, ring animation, the only state allowed to animate.
Card: width min(100vw-32, 400), radius 20, padding 20, 1px hairline, anchored top. Rows: StateChip 24 tall +
source app 13; verdict 22 (<=2 lines); reason 15 (<=2 lines); ring thumbnail 72 tall; <=2 actions 48 tall.
Ring: centre node, hop1 r=64, hop2 r=128 (scale for larger canvases), node d 6..18 by reports, only centre +
confirmed nodes coloured, others text-lo @40%, edges 1px @20%. Reveal: centre 0ms, hop1 staggered 24ms from
150ms, edges draw 200ms, hop2 from 500ms, confirmed pulse at 900ms. Export 1200x675 PNG from the same code.
Motion: card enter translateY 24->0 + opacity over 220ms cubic-bezier(0.2,0.8,0.2,1); exit 140ms ease-in.
prefers-reduced-motion: render complete, no stagger. Accessibility: 200% font scale, 7:1 verdict contrast,
48px targets, never colour alone (word + icon shape per state).
Seven components only: StateChip, VerdictCard, RingCanvas, ReasonLine, ActionPair, CounterTile, DisputeLink.
