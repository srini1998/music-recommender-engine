// Builds the public catalog (item-level aggregates only) and the private
// evaluation split from the anonymised ListenBrainz table.
// Split: users are ordered by a hash of their (sorted) artist set, so the split is
// stable even though anonymous ids are re-salted on every extraction run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const priv = path.join(here, '..', 'data', 'private');
const pub = path.join(here, '..', 'site', 'public', 'data');
const read = (f) => JSON.parse(fs.readFileSync(path.join(priv, f), 'utf8'));

const { users } = read('user_artist.json');
const names = read('artist_names.json');
const meta = read('artist_meta.json');
const keys = read('catalog_keys.json');
const stats = read('extract_stats.json');

const idx = new Map(keys.map((k, i) => [k, i]));
const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h; };

const MAX_PER_USER = 200;
const histories = [];
for (const plays of Object.values(users)) {
  const items = Object.entries(plays).filter(([a]) => idx.has(a)).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, MAX_PER_USER).map(([a]) => idx.get(a));
  if (items.length >= 4) histories.push(items.sort((a, b) => a - b));
}
histories.sort((a, b) => fnv(a.join(',')) - fnv(b.join(',')) || (a.join(',') < b.join(',') ? -1 : 1));
const nTest = Math.round(histories.length * 0.2);
const test = histories.slice(0, nTest);
const train = histories.slice(nTest);

const n = keys.length;
const reach = new Array(n).fill(0);
const co = Array.from({ length: n }, () => new Map());
for (const h of train) {
  for (const a of h) reach[a]++;
  for (let x = 0; x < h.length; x++) for (let y = x + 1; y < h.length; y++) {
    const a = h[x], b = h[y];
    co[a].set(b, (co[a].get(b) || 0) + 1);
    co[b].set(a, (co[b].get(a) || 0) + 1);
  }
}
const SHRINK = 5, TOPN = 50, MIN_CO = 3;
const nbr = co.map((row, a) => [...row].filter(([, c]) => c >= MIN_CO).map(([b, c]) => [b, (c / Math.sqrt(reach[a] * reach[b])) * (c / (c + SHRINK)), c]).sort((p, q) => q[1] - p[1] || p[0] - q[0]).slice(0, TOPN).map(([b, s, c]) => [b, Math.round(s * 1000), c]).filter(([, s]) => s > 0));

// Genre vectors: MusicBrainz genre tags (TF-IDF), falling back to all tags if an artist has no genre tag.
const tagRows = keys.map((k) => { const m = meta[names[k].mbid] || {}; const t = (m.tags || []).filter((x) => x.count > 0); const g = t.filter((x) => x.genre); return g.length ? g : t; });
const df = new Map();
for (const row of tagRows) for (const t of new Set(row.map((x) => x.tag))) df.set(t, (df.get(t) || 0) + 1);
const tagList = [...df.keys()].sort();
const tagIdx = new Map(tagList.map((t, i) => [t, i]));
const items = keys.map((k, i) => {
  const m = meta[names[k].mbid] || {};
  const row = tagRows[i];
  const maxC = Math.max(1, ...row.map((x) => x.count));
  const g = row.map((x) => [tagIdx.get(x.tag), (0.5 + 0.5 * x.count / maxC) * Math.log(n / df.get(x.tag))]).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, w]) => [t, Math.round(w * 100) / 100]);
  return { n: m.name || names[k].name, a: m.area || null, y: m.begin_year || null, r: Math.max(reach[i], 1), g, mbid: names[k].mbid };
});
// Drop tags no longer referenced after top-8 truncation and re-index.
const used = [...new Set(items.flatMap((it) => it.g.map(([t]) => t)))].sort((a, b) => a - b);
const remap = new Map(used.map((t, i) => [t, i]));
for (const it of items) it.g = it.g.map(([t, w]) => [remap.get(t), w]);

const catalog = {
  meta: {
    source: 'ListenBrainz incremental listens dump #2736 (2026-10-21 00:00 to 2026-10-22 00:00 UTC), CC0 1.0',
    metadata: 'Artist names/areas/begin years: MusicBrainz core data (CC0). Genre tags: MusicBrainz supplementary data (CC BY-NC-SA 3.0), via the ListenBrainz metadata API.',
    listensRead: stats.listens_read,
    usersInDump: stats.users,
    catalogArtists: n,
    usersKept: histories.length,
    trainUsers: train.length,
    testUsers: test.length,
    simFormula: `cosine on binary user-artist sets x co/(co+${SHRINK}); top ${TOPN} neighbours with >= ${MIN_CO} co-listeners; train users only`,
  },
  nUsers: train.length,
  tags: used.map((t) => tagList[t]),
  items,
  nbr,
};
fs.mkdirSync(pub, { recursive: true });
fs.writeFileSync(path.join(pub, 'catalog.json'), JSON.stringify(catalog));
fs.writeFileSync(path.join(priv, 'eval_split.json'), JSON.stringify({ test }));
console.log(catalog.meta, 'tags', catalog.tags.length, 'bytes', fs.statSync(path.join(pub, 'catalog.json')).size);
