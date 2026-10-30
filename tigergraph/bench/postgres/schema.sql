-- Relational equivalent of the JAAL graph, for the blast-radius benchmark.
-- Same entities as tigergraph/schema.gsql, modelled the way a team would
-- reasonably do it in Postgres: one identifiers table (all vertex types,
-- discriminated by vtype) and one edge table, plus a both-directions
-- adjacency table so the recursive walk is a single indexed join per hop.

DROP TABLE IF EXISTS adj;
DROP TABLE IF EXISTS edges;
DROP TABLE IF EXISTS identifiers;

CREATE TABLE identifiers (
  vid          BIGINT PRIMARY KEY,
  key          TEXT   NOT NULL UNIQUE,          -- canonical "type:value"
  vtype        TEXT   NOT NULL,                 -- Report | Phone | UpiHandle | BankAccount | Domain ...
  state        TEXT   NOT NULL DEFAULT 'clear',
  report_count INT    NOT NULL DEFAULT 0,
  first_seen   TIMESTAMP,
  last_seen    TIMESTAMP
);

CREATE TABLE edges (
  src    BIGINT    NOT NULL REFERENCES identifiers(vid),
  dst    BIGINT    NOT NULL REFERENCES identifiers(vid),
  etype  TEXT      NOT NULL,                    -- MENTIONS | PAYS_TO | ...
  ts     TIMESTAMP NOT NULL,
  weight REAL      NOT NULL DEFAULT 1.0
);

-- Undirected view of the evidence edges, materialised (both directions).
CREATE TABLE adj (
  src    BIGINT    NOT NULL,
  dst    BIGINT    NOT NULL,
  etype  TEXT      NOT NULL,
  ts     TIMESTAMP NOT NULL,
  weight REAL      NOT NULL
);

-- Indexes are created after bulk load by run-postgres.mjs:
--   CREATE INDEX adj_src_ts ON adj (src, ts) INCLUDE (dst);
--   ANALYZE;

-- The query (run-postgres.mjs), parameters: $1 seed key, $2 max hops, $3 window start
--
-- WITH RECURSIVE walk(vid, depth) AS (
--     SELECT vid, 0 FROM identifiers WHERE key = $1
--   UNION
--     SELECT a.dst, w.depth + 1
--     FROM walk w JOIN adj a ON a.src = w.vid
--     WHERE w.depth < $2 AND a.ts >= $3
-- )
-- SELECT count(DISTINCT w.vid)                                       AS reached,
--        count(DISTINCT w.vid) FILTER (WHERE i.vtype = 'Report')     AS reports
-- FROM walk w JOIN identifiers i USING (vid);
--
-- Note the relational limitation this exposes: UNION in a recursive CTE only
-- removes duplicate (vid, depth) rows, so a vertex reachable at depth 1 and
-- depth 3 is expanded twice; there is no way to say "visited" across
-- iterations, which is exactly what a GSQL OrAccum @visited does.
