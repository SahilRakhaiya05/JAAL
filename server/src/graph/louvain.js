// Community detection for ring_detection.
//   wcc()     pass 1: weakly connected components (union-find) -> entities
//   louvain() pass 2: modularity maximisation on the weighted graph -> campaigns

/** Union-find over node indices. edges: [a, b] pairs. Returns component index per node. */
export function wcc(n, edges) {
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (const [a, b] of edges) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
  return Array.from({ length: n }, (_, i) => find(i));
}

/**
 * Louvain (Blondel et al. 2008). n nodes, edges [a, b, w] undirected (no duplicates needed;
 * parallel edges are summed). Deterministic: nodes are visited in index order.
 * Returns the community index of every original node.
 */
export function louvain(n, edges, { resolution = 1, maxLevels = 10, maxPasses = 20 } = {}) {
  let membership = Array.from({ length: n }, (_, i) => i);
  let graph = buildAdjacency(n, edges);

  for (let level = 0; level < maxLevels; level++) {
    const { community, moved } = localMoving(graph, resolution, maxPasses);
    if (!moved) break;
    // Renumber communities 0..k-1 and fold the original membership through them.
    const renumber = new Map();
    const comm = community.map((c) => {
      if (!renumber.has(c)) renumber.set(c, renumber.size);
      return renumber.get(c);
    });
    membership = membership.map((c) => comm[c]);
    graph = aggregate(graph, comm, renumber.size);
  }
  return membership;
}

function buildAdjacency(n, edges) {
  const adj = Array.from({ length: n }, () => new Map());
  const selfLoops = new Float64Array(n);
  for (const [a, b, w] of edges) {
    if (!(w > 0)) continue;
    if (a === b) selfLoops[a] += w;
    else {
      adj[a].set(b, (adj[a].get(b) || 0) + w);
      adj[b].set(a, (adj[b].get(a) || 0) + w);
    }
  }
  return { n, adj, selfLoops };
}

/** Phase 1: move each node to the neighbouring community with the best modularity gain. */
function localMoving({ n, adj, selfLoops }, resolution, maxPasses) {
  const degree = new Float64Array(n);
  let m2 = 0; // 2m: total edge weight counted from both ends
  for (let i = 0; i < n; i++) {
    for (const w of adj[i].values()) degree[i] += w;
    degree[i] += 2 * selfLoops[i];
    m2 += degree[i];
  }
  const community = Array.from({ length: n }, (_, i) => i);
  if (m2 === 0) return { community, moved: false };
  const total = Float64Array.from(degree); // sum of degrees per community
  let moved = false;

  for (let pass = 0; pass < maxPasses; pass++) {
    let changes = 0;
    for (let i = 0; i < n; i++) {
      if (adj[i].size === 0) continue;
      const own = community[i];
      // Weight from i into each neighbouring community.
      const links = new Map();
      for (const [j, w] of adj[i]) links.set(community[j], (links.get(community[j]) || 0) + w);
      total[own] -= degree[i];
      let best = own;
      let bestGain = (links.get(own) || 0) - (resolution * total[own] * degree[i]) / m2;
      for (const [c, kIn] of links) {
        const gain = kIn - (resolution * total[c] * degree[i]) / m2;
        if (gain > bestGain + 1e-12) {
          best = c;
          bestGain = gain;
        }
      }
      total[best] += degree[i];
      if (best !== own) {
        community[i] = best;
        changes++;
        moved = true;
      }
    }
    if (changes === 0) break;
  }
  return { community, moved };
}

/** Phase 2: collapse each community into one node; internal weight becomes a self-loop. */
function aggregate({ n, adj, selfLoops }, comm, k) {
  const edges = [];
  const loops = new Float64Array(k);
  for (let i = 0; i < n; i++) {
    loops[comm[i]] += selfLoops[i];
    for (const [j, w] of adj[i]) {
      if (j < i) continue; // each undirected edge once
      if (comm[i] === comm[j]) loops[comm[i]] += w;
      else edges.push([comm[i], comm[j], w]);
    }
  }
  const g = buildAdjacency(k, edges);
  for (let c = 0; c < k; c++) g.selfLoops[c] += loops[c];
  return g;
}
