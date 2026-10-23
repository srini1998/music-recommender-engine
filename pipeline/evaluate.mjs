// Offline evaluation on held-out ListenBrainz users (never used to build the
// item-item similarities). For each test user, a seeded random half of their
// catalog artists is the seed list, the other half the hidden targets.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepare, recommend, popularity, listMetrics } from '../site/src/engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pubDir = path.join(here, '..', 'site', 'public', 'data');
const catalog = JSON.parse(fs.readFileSync(path.join(pubDir, 'catalog.json'), 'utf8'));
const { test } = JSON.parse(fs.readFileSync(path.join(here, '..', 'data', 'private', 'eval_split.json'), 'utf8'));
const m = prepare(catalog);
const K = 10;

function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = rng(16);
const cases = test.map((h) => {
  const a = [...h];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  const cut = Math.max(2, Math.floor(a.length / 2));
  return { seeds: a.slice(0, Math.min(cut, 20)), targets: new Set(a.slice(cut)) };
}).filter((c) => c.targets.size >= 2);

function score(fn) {
  let recall = 0, ild = 0, nov = 0;
  const seen = new Set();
  for (const c of cases) {
    const recs = fn(c.seeds);
    const hits = recs.filter((r) => c.targets.has(r.i)).length;
    recall += hits / Math.min(K, c.targets.size);
    const lm = listMetrics(m, recs);
    ild += lm.ild; nov += lm.novelty;
    for (const r of recs) seen.add(r.i);
  }
  const N = cases.length;
  const r4 = (x) => Math.round(x * 10000) / 10000;
  return { recall: r4(recall / N), coverage: r4(seen.size / m.n), ild: r4(ild / N), novelty: r4(nov / N) };
}

const t0 = Date.now();
const baselines = { popularity: score((s) => popularity(m, s, K)) };
const ALPHAS = [0, 0.25, 0.5, 0.75, 1];
const LAMBDAS = [0, 0.15, 0.3, 0.45, 0.6, 0.75];
const BETAS = [0, 0.3, 0.6];
const grid = [];
for (const alpha of ALPHAS) for (const lambda of LAMBDAS) for (const beta of BETAS) {
  grid.push({ alpha, lambda, beta, ...score((s) => recommend(m, s, { alpha, lambda, beta, k: K })) });
}
const out = {
  generatedAt: new Date().toISOString(),
  protocol: `Held-out users: ${cases.length} (test split; not used for similarities). Seeds = random half of each user's catalog artists (max 20), targets = the other half. Recall@${K} = hits / min(${K}, |targets|). Coverage = distinct recommended artists / catalog. ILD = 1 - mean pairwise genre cosine within a list. Novelty = mean -log2(listener share).`,
  k: K, cases: cases.length, axes: { alpha: ALPHAS, lambda: LAMBDAS, beta: BETAS },
  baselines, grid, seconds: Math.round((Date.now() - t0) / 1000),
};
fs.writeFileSync(path.join(pubDir, 'metrics.json'), JSON.stringify(out));
const best = [...grid].sort((a, b) => b.recall - a.recall)[0];
console.log('cases', cases.length, 'baseline', baselines.popularity, 'best', best, 'seconds', out.seconds);
for (const g of grid.filter((g) => g.beta === 0 && (g.lambda === 0 || g.lambda === 0.3))) console.log(JSON.stringify(g));
