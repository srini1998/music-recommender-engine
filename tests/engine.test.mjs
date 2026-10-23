import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { prepare, recommend, listMetrics, popularity } from '../site/src/engine.js';

const catalog = JSON.parse(fs.readFileSync(new URL('../site/public/data/catalog.json', import.meta.url)));
const metrics = JSON.parse(fs.readFileSync(new URL('../site/public/data/metrics.json', import.meta.url)));
const m = prepare(catalog);
const id = (name) => { const i = m.byName.get(name); assert.ok(i !== undefined, name); return i; };
const seeds = [id('radiohead'), id('portishead'), id('massive attack')];

test('catalog ships aggregates only, no per-user rows', () => {
  assert.deepEqual(Object.keys(catalog).sort(), ['items', 'meta', 'nUsers', 'nbr', 'tags']);
  assert.equal(catalog.items.length, catalog.nbr.length);
  for (const row of catalog.nbr) for (const [, , co] of row) assert.ok(co >= 3);
});

test('returns k items, never a seed, deterministic', () => {
  const a = recommend(m, seeds, { k: 10 });
  assert.equal(a.length, 10);
  for (const r of a) assert.ok(!seeds.includes(r.i));
  assert.deepEqual(a.map((r) => r.i), recommend(m, seeds, { k: 10 }).map((r) => r.i));
});

test('lambda=0 is pure relevance order', () => {
  const a = recommend(m, seeds, { lambda: 0 });
  for (let i = 1; i < a.length; i++) assert.ok(a[i - 1].rel >= a[i].rel);
});

test('diversity re-ranking raises intra-list diversity', () => {
  const lo = listMetrics(m, recommend(m, seeds, { lambda: 0 }));
  const hi = listMetrics(m, recommend(m, seeds, { lambda: 0.6 }));
  assert.ok(hi.ild > lo.ild, `${hi.ild} > ${lo.ild}`);
});

test('novelty discount lowers mean popularity', () => {
  const pop = (l) => l.reduce((s, r) => s + catalog.items[r.i].r, 0) / l.length;
  assert.ok(pop(recommend(m, seeds, { beta: 0.6 })) < pop(recommend(m, seeds, { beta: 0 })));
});

test('alpha=1 explanations cite a seed co-listened with the recommendation', () => {
  for (const r of recommend(m, seeds, { alpha: 1, lambda: 0 })) assert.ok(seeds.includes(r.because.seed) && r.because.co >= 3);
});

test('empty seed list returns nothing; popularity baseline excludes seeds', () => {
  assert.deepEqual(recommend(m, []), []);
  assert.ok(popularity(m, [0]).every((r) => r.i !== 0));
});

test('offline metrics: hybrid beats popularity and both single signals', () => {
  const g = (a, l, b) => metrics.grid.find((x) => x.alpha === a && x.lambda === l && x.beta === b);
  assert.equal(metrics.grid.length, 5 * 6 * 3);
  assert.ok(g(0.75, 0, 0).recall > metrics.baselines.popularity.recall);
  assert.ok(g(0.75, 0, 0).recall > g(1, 0, 0).recall && g(0.75, 0, 0).recall > g(0, 0, 0).recall);
});
