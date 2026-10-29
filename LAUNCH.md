# Launch checklist: what only you can do (before 31 Oct, 09:59 IST)

The code runs end to end locally. These steps need your accounts, your devices or your judgement.

## Must do
- [ ] **Load the extension in real Chrome** (`web/extension.zip`) and run the 30-second demo in
      `extension/README.md`. Things not yet checked in real Chrome: install, side panel, notifications,
      the scam-site redirect, and live WhatsApp/Gmail pages.
- [ ] **Deploy the server** (Render, Railway, Fly or a VM; `cd server && npm start`). Set `PUBLIC_BASE_URL`
      and `REPORTER_SALT`. Then set `API_BASE_PROD` in `extension/src/core.js`, rebuild
      (`cd extension && npm run build`), and point the Android app at the URL in its Settings screen.
- [ ] **Fix the pitch benchmark line.** "180 ms vs 40 s in Postgres" is not supported: on real runs,
      Postgres does a 4-hop blast radius in about 0.3 ms on sparse data. Use the honest version, where
      Postgres degrades on dense, deep traversals, plus one query that answers ring, script similarity and
      chokepoint together. Add TigerGraph numbers only from `tigergraph/bench/run-tigergraph.mjs`.
- [ ] **TigerGraph Savanna**: follow `tigergraph/setup.md`. Expect small GSQL compile fixes: the queries
      have never been compiled against a live instance. Then set `GRAPH_BACKEND=tigergraph`, `TG_HOST` and
      `TG_TOKEN`, and take the GraphStudio screenshot of a ring.
- [ ] **Dodo**: create the product, then set `DODO_API_KEY`, `DODO_PRODUCT_ID` and `DODO_WEBHOOK_SECRET`.
      The webhook URL is `/api/webhooks/dodo`. Make one real payment. Until then the counter shows 0 paying.
- [ ] **viaSocket**: create a webhook-triggered flow (Chakshu draft → email, sheet row, Slack), set
      `VIASOCKET_WEBHOOK_URL`, and screenshot the run log (`/api/integrations/viasocket/log`).
- [ ] **Cake Wallet**: set `CAKE_XMR_ADDRESS` and `CAKE_BTC_ADDRESS` to your own receive addresses.
- [ ] **Native review** of the Hindi and Gujarati strings (search for `NATIVE-REVIEW` in server, web and Android).
- [ ] Get real users: QR codes in the house plus "forward me your junk SMS". Only real activity shows on the
      counter.
- [ ] Apply at aigrants.in. Record the 60-second backup screen capture.

## Optional
- `ANTHROPIC_API_KEY` polishes the plain-language reason (Haiku, 1.5 s timeout, never blocks a verdict).
- `URLHAUS_AUTH_KEY` adds the URLhaus feed (`npm run seed:feeds`).
- `WISPR_API_KEY` enables Wispr Flow voice (access is invite-only). Without it, voice uses browser speech-to-text.
- Remove the demo seed after launch: `npm run seed:clear-demo`.
