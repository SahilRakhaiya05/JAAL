# Blast-radius receipt: TigerGraph vs Postgres vs in-memory

One question, three engines, same data, same seeds, same answer checked:

> Starting from one identifier, which identifiers and reports are reachable in
> k edge hops, using only edges observed in the last 90 days?

That is `blast_radius` (`../queries/blast_radius.gsql`), the query behind every
`POST /api/check`.

## Method

| | |
|---|---|
| Data | `generate.mjs`: deterministic (mulberry32, seed 42) synthetic JAAL graph. Rings of 4..40 identifiers (phones, UPI handles, accounts, domains) tied together by reports (`MENTIONS`, 2..4 identifiers each) and `PAYS_TO`; noise reports with 1..2 one-off identifiers; 300 hub domains; timestamps uniform over 150 days before 2026-10-30, so the 90-day window drops about 40% of edges. `--bridge` sets how often a ring report also mentions a member of an earlier ring (shared mule accounts). Default 0.03; the `-b0.3` dataset is the dense variant. |
| Seeds | 20 fixed seed keys per dataset (14 ring members, 6 noise identifiers), in `data/<name>/seeds.json`. |
| Runs | 3 warm-up queries, then 20 timed runs (one per seed). p50 / p95 / mean of wall-clock time per query. |
| Memory | `run-memory.mjs`: CSR adjacency in typed arrays, BFS with a visited stamp. In-process, no I/O: a lower bound, not a database. |
| Postgres | `run-postgres.mjs` + `postgres/schema.sql`: `identifiers`, `edges`, and `adj` (edges in both directions) with `INDEX adj (src, ts) INCLUDE (dst)`, `ANALYZE`, then a `WITH RECURSIVE` walk with `UNION` dedup, as a prepared statement. 60 s statement timeout; a timeout is recorded as a timeout, never as a number. |
| TigerGraph | `run-tigergraph.mjs`: the installed `blast_radius` over REST++ (`max_hops` set to k, `hub_degree` set huge so the hub guard the other two lack never fires). Client wall clock, so it includes network RTT to Savanna. |
| Correctness | Every runner stores per-seed `{reached, reports}` in `results.json`. For every row below, memory and Postgres returned identical answers for all 20 seeds. |

## Results

Produced by the scripts on 30 Oct 2026, written to `results.json` and rendered
by `node report.mjs`. Nothing below is typed by hand.

Machine: 12th Gen Intel Core i5-12500H (16 logical cores), 16 GB RAM, Windows 11,
Node v22.15.0, PostgreSQL 18.4 (a local throwaway cluster: `shared_buffers=512MB`,
`work_mem=64MB`; the Docker daemon was not running, so this is the native Windows build).

<!-- BENCH:START -->
| dataset | engine | edges | vertices | query | runs | p50 ms | p95 ms | mean ms | avg reached | load s | notes |
|---|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---|
| 200000 | memory (Node BFS, CSR) | 200,000 | 184,068 | blast radius, 4 hops, 90-day window | 20 | 0.004 | 0.007 | 0.004 | 14.5 | 0.26 | in-process, single thread, no persistence |
| 200000 | postgres 18.4 (recursive CTE) | 200,000 | 184,068 | blast radius, 4 hops, 90-day window | 20 | 0.452 | 0.798 | 0.476 | 14.5 | 3.66 | index adj(src,ts) INCLUDE(dst); no timeouts |
| 200000 | memory (Node BFS, CSR) | 200,000 | 184,068 | blast radius, 8 hops, 90-day window | 20 | 0.006 | 0.023 | 0.01 | 39.6 | 0.26 | in-process, single thread, no persistence |
| 200000 | postgres 18.4 (recursive CTE) | 200,000 | 184,068 | blast radius, 8 hops, 90-day window | 20 | 0.65 | 1.464 | 0.754 | 39.6 |  | index adj(src,ts) INCLUDE(dst); no timeouts |
| 1000000 | memory (Node BFS, CSR) | 1,000,000 | 912,502 | blast radius, 4 hops, 90-day window | 20 | 0.005 | 0.014 | 0.007 | 19.6 | 1.57 | in-process, single thread, no persistence |
| 1000000 | postgres 18.4 (recursive CTE) | 1,000,000 | 912,502 | blast radius, 4 hops, 90-day window | 20 | 0.298 | 0.597 | 0.357 | 19.6 | 28.28 | index adj(src,ts) INCLUDE(dst); no timeouts |
| 1000000 | memory (Node BFS, CSR) | 1,000,000 | 912,502 | blast radius, 8 hops, 90-day window | 20 | 0.009 | 0.025 | 0.01 | 37.5 | 5.75 | in-process, single thread, no persistence |
| 1000000 | postgres 18.4 (recursive CTE) | 1,000,000 | 912,502 | blast radius, 8 hops, 90-day window | 20 | 0.794 | 1.966 | 0.884 | 37.5 |  | index adj(src,ts) INCLUDE(dst); no timeouts |
| 1000000-b0.3 | memory (Node BFS, CSR) | 1,000,000 | 841,564 | blast radius, 4 hops, 90-day window | 20 | 0.008 | 0.036 | 0.014 | 33.3 | 4.48 | in-process, single thread, no persistence |
| 1000000-b0.3 | postgres 18.4 (recursive CTE) | 1,000,000 | 841,564 | blast radius, 4 hops, 90-day window | 20 | 0.424 | 0.933 | 0.512 | 33.3 | 29.47 | index adj(src,ts) INCLUDE(dst); no timeouts |
| 1000000-b0.3 | memory (Node BFS, CSR) | 1,000,000 | 841,564 | blast radius, 8 hops, 90-day window | 20 | 0.034 | 0.32 | 0.1 | 641.3 | 4.83 | in-process, single thread, no persistence |
| 1000000-b0.3 | postgres 18.4 (recursive CTE) | 1,000,000 | 841,564 | blast radius, 8 hops, 90-day window | 20 | 2.47 | 308.663 | 45.303 | 641.3 |  | index adj(src,ts) INCLUDE(dst); no timeouts |
| 1000000-b0.3 | memory (Node BFS, CSR) | 1,000,000 | 841,564 | blast radius, 12 hops, 90-day window | 20 | 0.283 | 8.778 | 10.267 | 11274.9 | 2.72 | in-process, single thread, no persistence |
| 1000000-b0.3 | postgres 18.4 (recursive CTE) | 1,000,000 | 841,564 | blast radius, 12 hops, 90-day window | 20 | 24.004 | 315.968 | 101.826 | 11274.9 |  | index adj(src,ts) INCLUDE(dst); no timeouts |
<!-- BENCH:END -->

**TigerGraph rows: not run yet.** No Savanna workspace was attached while this
was written. Once one is, `run-tigergraph.mjs --load` adds its rows to the
table above. Until then the table makes no TigerGraph latency claim.

## What the numbers say (and what they don't)

* At the production depth (4 edge hops = 2 identifier hops) on sparse data,
  **Postgres is fine**: under 1 ms p95 at 1M edges with a good covering index.
  We are not going to pretend otherwise.
* Cost grows with how much of the graph is reachable, not with how big it is.
  On the dense dataset Postgres p95 goes from 0.9 ms (4 hops) to 309 ms
  (8 hops, about 640 vertices reached) and 316 ms (12 hops, about 11k reached),
  while the plain BFS stays at 0.3 ms and 8.8 ms. The gap comes from the
  `UNION` recursive CTE: it can only drop duplicate `(vertex, depth)` rows, so
  a vertex reachable at several depths is expanded again at each one. There is
  no "visited" state that carries across iterations. GSQL has one: the
  `OrAccum @visited` in `blast_radius`.
* The in-memory BFS is a floor, not a competitor. It has no persistence, no
  concurrent writers, no second machine, and it is the engine the demo runs on
  when no TigerGraph is configured.
* The case for TigerGraph in JAAL is the other five queries more than this
  one: Louvain/WCC community detection over the same edges, PageRank over a
  heterogeneous money subgraph, and hybrid `vectorSearch()` restricted to a
  graph-derived candidate set. In SQL each of those is an export to another
  system. See `../README.md`.

## Reproduce

```bash
cd tigergraph/bench && npm install
node generate.mjs --edges 200000
node generate.mjs --edges 1000000
node generate.mjs --edges 1000000 --bridge 0.3          # -> data/1000000-b0.3

node run-memory.mjs --edges 1000000 --hops 4
# Postgres: any 14+ server that can read the CSV path (server-side COPY).
#   docker run -d --name jaal-pg -e POSTGRES_HOST_AUTH_METHOD=trust -p 55432:5432 \
#     -v "$PWD/data:/data" postgres:16
#   PG_URL=postgres://postgres@localhost:55432/postgres node run-postgres.mjs --edges 1000000 --copy-dir /data/1000000
# (the run above used a native PostgreSQL 18 cluster: initdb -U jaal -A trust; pg_ctl -o "-p 55432")
PG_URL=postgres://jaal@localhost:55432/postgres node run-postgres.mjs --edges 1000000 --hops 4
node run-postgres.mjs --edges 1000000 --hops 8 --skip-load

TG_HOST=https://<workspace>.i.tgcloud.io TG_TOKEN=... node run-tigergraph.mjs --edges 200000 --load
node report.mjs        # re-render the table above from results.json
```

`--data <name>` picks a dataset folder (for example `--data 1000000-b0.3`).
`--hops`, `--runs` and `--warmup` override the defaults.
