# Savanna setup for JAAL (about 20 minutes)

Everything here also works on a self-hosted TigerGraph 4.x (Docker
`tigergraph/community`). Differences are noted inline. Savanna / GraphStudio
menu names move a little between releases; the GSQL and REST calls are the
stable part. **Use 4.2 or later**:
`script_similarity` needs TigerVector (vector attributes + `vectorSearch()`).
On 4.1, skip the vector job and the `script_similarity` file; the other
queries do not depend on it.

## 1. Create a workspace

1. Sign in at <https://savanna.tgcloud.io>, then **Create Workspace**.
2. Pick the smallest size (TG-00 / free tier is enough for the demo) and the
   newest 4.x version offered (4.2 or later).
3. Wait until it shows **Ready**. Copy the workspace host from
   **Connect → REST/GSQL**. It looks like `https://<id>.i.tgcloud.io`.
   That value is `TG_HOST` everywhere below.

## 2. Create the schema and graph

Open **GSQL Editor** (or **GraphStudio → Design Schema → GSQL**), then paste
and run `tigergraph/schema.gsql`. It:

* creates 12 vertex types and 11 edge types (10 from the SPEC plus
  `MATCHES_PATTERN`, explained in the schema header)
* creates graph `JAAL`
* runs `GLOBAL SCHEMA_CHANGE JOB jaal_add_vectors`, which adds
  `MessageText.embedding` (DIMENSION=256, METRIC="COSINE")

Check: `USE GRAPH JAAL` then `LS` lists the vertex types, the edge types
including `reverse_PAYS_TO`, and the vector attribute.

From a laptop with the GSQL client instead (`pip install pyTigerGraph` also
works; see section 9):

```bash
gsql -ip <host> -u <user> -p <password> tigergraph/schema.gsql      # self-hosted
```

## 3. Install the GDS algorithms

Ring detection uses two library queries from
[tigergraph/gsql-graph-algorithms](https://github.com/tigergraph/gsql-graph-algorithms)
(Apache-2.0): `tg_wcc` and `tg_louvain`. Copies already pinned to `JAAL` are in
`tigergraph/gds/`. To refresh them:

```bash
node tigergraph/load/fetch-gds.mjs          # writes gds/tg_wcc.gsql, gds/tg_louvain.gsql
```

In the Savanna GSQL editor, paste and run the two files, or use
**GraphStudio → Write Queries → + → From Algorithm Library**, choose
*Community → Weakly Connected Components* and *Louvain*, and save them under
their library names (`tg_wcc`, `tg_louvain`).

pyTigerGraph alternative, run where Python 3.9+ is available:

```python
import pyTigerGraph as tg
conn = tg.TigerGraphConnection(host=TG_HOST, graphname="JAAL", gsqlSecret=SECRET, tgCloud=True)
conn.getToken(SECRET)
f = conn.gds.featurizer()
f.installAlgorithm("tg_wcc")
f.installAlgorithm("tg_louvain")
```

**PageRank is not taken from the library.** `tg_pagerank` takes a single vertex
type and a single edge type. The money graph is heterogeneous, so
`money_chokepoint` runs its own power iteration (see that file).

## 4. Create and install the JAAL queries

Paste the files into the GSQL editor **in this order**. `jaal_vtype` is a
subquery the others call, so it has to come first.

1. `queries/jaal_vtype.gsql`
2. `queries/blast_radius.gsql`, `ring_of.gsql`, `money_chokepoint.gsql`,
   `lookalike_domain.gsql`, `script_similarity.gsql`, `spread_map.gsql`
3. `queries/refresh_decay.gsql`, `queries/materialize_campaigns.gsql`
   (that file also defines `link_next`)
4. `loading_job.gsql`
5. `INSTALL QUERY ALL`. This takes a few minutes on the smallest workspace.

With the GSQL shell, `install_all.gsql` does steps 1 to 5 in one go:
`cd tigergraph && gsql install_all.gsql`.

## 5. Get a REST++ token

Savanna REST++ endpoints need a bearer token, and a token is minted from a
secret.

1. **GraphStudio → Admin Portal → Management → Users → (your user) → Secrets**:
   create a secret with alias `jaal`. Or in GSQL: `CREATE SECRET jaal`.
2. Exchange it for a token (4.x endpoint):

```bash
curl -s -X POST "$TG_HOST/gsql/v1/tokens" \
  -H 'Content-Type: application/json' \
  -d '{"secret":"<SECRET>","graph":"JAAL","lifetime":"604800"}'
# -> {"token":"..."}       (3.x used POST /restpp/requesttoken; the server adapter tries both)
```

Check it:

```bash
curl -s -H "Authorization: Bearer $TG_TOKEN" \
  "$TG_HOST/restpp/query/JAAL/jaal_vtype?id_key=upi:refund.desk@ybl"
# -> {"error":false, ...}   any non-error response proves auth + install (the server's ping() uses this exact call)
```

Self-hosted: REST++ is at `http://<host>:14240/restpp/...` behind nginx, or
directly at `:9000` (then set `TG_RESTPP_PREFIX=""`).

## 6. Load data

Pick one of three ways:

```bash
# a) the server's live snapshot (server/data/graph.json), or the lane fixture when absent
TG_HOST=... TG_TOKEN=... node tigergraph/load/push-restpp.mjs
node tigergraph/load/push-restpp.mjs --dry-run            # print the first payload, send nothing

# b) TSV + loading job (large snapshots)
node tigergraph/load/export-to-csv.mjs                    # -> tigergraph/load/out/*.tsv
#    then GraphStudio → Load Data → upload the files and map them to job load_jaal,
#    or on the server: RUN LOADING JOB load_jaal USING v_Phone="out/v_Phone.tsv", ...

# c) let the server mirror writes as they happen (step 8)
```

## 7. Detect rings (batch)

```bash
TG_HOST=... TG_TOKEN=... node tigergraph/load/refresh-rings.mjs --window 90
```

This runs, in order: `refresh_decay` (materialises the 21-day half-life
weights), then `tg_wcc` (`wcc_id` over the deterministic edges), then
`tg_louvain` (`community_id` over decay-weighted edges plus `SIMILAR_SCRIPT`),
then `materialize_campaigns` (Campaign vertices for corroborated communities
only), then `link_next` (`NEXT` chains for `spread_map`). Run it after each bulk
load. A cron every 15 minutes is plenty.

## 8. Point the server at TigerGraph

In `server/.env`:

```
GRAPH_BACKEND=tigergraph
TG_HOST=https://<id>.i.tgcloud.io
TG_GRAPH=JAAL
TG_TOKEN=<token>            # or TG_SECRET=<secret> and the server mints tokens itself
```

Restart the server. `GET /api/health` then shows
`integrations.tigergraph.mode: "live"`, and verdicts carry `engine: "tigergraph"`.
If TigerGraph is unreachable, the server falls back to the memory engine and
`/api/health` reports the error. The server never blocks on the graph.

## 9. Screenshot a ring in GraphStudio (for the submission)

1. **GraphStudio → Explore Graph**. Pick graph `JAAL`.
2. In **Search vertices**, type a confirmed key, for example `upi:refund.desk@ybl`
   (type `UpiHandle`), and add it to the canvas.
3. Right-click it, choose **Expand**, and set the edge types to `MENTIONS`,
   `PAYS_TO`, `reverse_PAYS_TO`, `RESOLVES_TO`, `HOSTED_ON`, `SAME_TEXT_AS`,
   `IN_CAMPAIGN`. Do this twice (2 levels).
4. Or run the installed query from **Write Queries → ring_of → Run** with
   `id_key = upi:refund.desk@ybl`. The **Graph** result tab draws the
   `Campaign` vertex. For the full ring picture, expand from it with
   `reverse_IN_CAMPAIGN`.
5. Layout **Force**, colour by vertex type, then screenshot. Hide
   `Reporter` vertices before you share it: they are salted hashes, but a
   screenshot does not need them.

## 10. Agent access (optional)

`pip install tigergraph-mcp` gives an agent schema, query and vector tools over
the same instance. See `../mcp/README.md` for the config block.
