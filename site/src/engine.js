// Hybrid artist recommender shared by the browser UI and the offline evaluator.
// Relevance = alpha * item-kNN collaborative score + (1 - alpha) * genre-profile cosine,
// optionally discounted by popularity (novelty, beta), then re-ranked with
// maximal marginal relevance (diversity, lambda) in genre space.

export function prepare(catalog) {
  const n = catalog.items.length;
  const vecs = catalog.items.map((it) => {
    const v = new Map();
    let norm = 0;
    for (const [t, w] of it.g) { v.set(t, w); norm += w * w; }
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of v) v.set(t, w / norm);
    return v;
  });
  const maxLogReach = Math.log(Math.max(...catalog.items.map((it) => it.r)) + 1);
  const popNorm = catalog.items.map((it) => Math.log(it.r + 1) / maxLogReach);
  const selfInfo = catalog.items.map((it) => -Math.log2(it.r / catalog.nUsers));
  const nbr = catalog.nbr.map((row) => row.map(([j, s, co]) => ({ j, s: s / 1000, co })));
  const byName = new Map(catalog.items.map((it, i) => [it.n.toLowerCase(), i]));
  return { catalog, n, vecs, popNorm, selfInfo, nbr, byName };
}

export function cosine(a, b) {
  if (a.size > b.size) [a, b] = [b, a];
  let s = 0;
  for (const [t, w] of a) { const o = b.get(t); if (o) s += w * o; }
  return s;
}

export function contentSim(m, i, j) { return cosine(m.vecs[i], m.vecs[j]); }

function profile(m, seeds) {
  const p = new Map();
  for (const s of seeds) for (const [t, w] of m.vecs[s]) p.set(t, (p.get(t) || 0) + w);
  let norm = 0;
  for (const w of p.values()) norm += w * w;
  norm = Math.sqrt(norm) || 1;
  for (const [t, w] of p) p.set(t, w / norm);
  return p;
}

export const DEFAULTS = { alpha: 0.75, lambda: 0.3, beta: 0.0, k: 10, pool: 150 };

export function recommend(m, seeds, opts = {}) {
  const { alpha, lambda, beta, k, pool } = { ...DEFAULTS, ...opts };
  const seedSet = new Set(seeds);
  if (!seeds.length) return [];
  const cf = new Float64Array(m.n);
  const because = new Array(m.n).fill(null);
  for (const s of seeds) {
    for (const { j, s: w, co } of m.nbr[s]) {
      cf[j] += w;
      if (!because[j] || w > because[j].w) because[j] = { seed: s, w, co };
    }
  }
  let cfMax = 0;
  for (let i = 0; i < m.n; i++) if (cf[i] > cfMax) cfMax = cf[i];
  const prof = profile(m, seeds);
  const content = new Float64Array(m.n);
  let ctMax = 0;
  for (let i = 0; i < m.n; i++) {
    if (seedSet.has(i)) continue;
    content[i] = cosine(prof, m.vecs[i]);
    if (content[i] > ctMax) ctMax = content[i];
  }
  const cand = [];
  for (let i = 0; i < m.n; i++) {
    if (seedSet.has(i)) continue;
    const c = cfMax ? cf[i] / cfMax : 0;
    const t = ctMax ? content[i] / ctMax : 0;
    const rel = (alpha * c + (1 - alpha) * t) * (1 - beta * m.popNorm[i]);
    if (rel > 0) cand.push({ i, rel, cf: c, content: t });
  }
  cand.sort((a, b) => b.rel - a.rel || a.i - b.i);
  const poolItems = cand.slice(0, pool);
  if (!poolItems.length) return [];
  const top = poolItems[0].rel;
  const out = [];
  const used = new Set();
  while (out.length < Math.min(k, poolItems.length)) {
    let best = null, bestScore = -Infinity, bestRed = 0;
    for (const c of poolItems) {
      if (used.has(c.i)) continue;
      let red = 0;
      for (const o of out) { const s = contentSim(m, c.i, o.i); if (s > red) red = s; }
      const score = (1 - lambda) * (c.rel / top) - lambda * red;
      if (score > bestScore) { bestScore = score; best = c; bestRed = red; }
    }
    used.add(best.i);
    out.push({ ...best, mmr: bestScore, redundancy: bestRed, because: because[best.i], shared: sharedTags(m, prof, best.i) });
  }
  return out;
}

function sharedTags(m, prof, i) {
  const tags = [];
  for (const [t, w] of m.vecs[i]) { const p = prof.get(t); if (p) tags.push([t, p * w]); }
  return tags.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => m.catalog.tags[t]);
}

export function listMetrics(m, items) {
  const ids = items.map((x) => (typeof x === 'number' ? x : x.i));
  let pairs = 0, sim = 0;
  for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) { sim += contentSim(m, ids[a], ids[b]); pairs++; }
  const novelty = ids.reduce((s, i) => s + m.selfInfo[i], 0) / (ids.length || 1);
  return { ild: pairs ? 1 - sim / pairs : 0, novelty };
}

export function popularity(m, seeds, k = 10) {
  const seedSet = new Set(seeds);
  return m.catalog.items.map((it, i) => [i, it.r]).filter(([i]) => !seedSet.has(i)).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, k).map(([i]) => ({ i }));
}
