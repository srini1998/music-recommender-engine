# Music Recommender Engine

**Live demo: Side B** — a hybrid artist recommender built on one day of real, CC0 ListenBrainz listens.
Pick seed artists, tune the blend / diversity / novelty faders, and see offline recall, coverage, diversity and novelty measured on held-out listeners.

## v2: hybrid recommender (what the website runs)

```
ListenBrainz incremental dump #2736 (5.5M listens, 2026-10-21, CC0)
  └─ pipeline/extract_listens.py   anonymised user x artist table (user names dropped, ids salted; data/private, gitignored)
  └─ pipeline/fetch_metadata.py    MusicBrainz area / begin year / genre tags for the top 1,500 artists (ListenBrainz metadata API, 1 req/s)
  └─ pipeline/build_catalog.mjs    80/20 user split; item-kNN co-listening graph from train users; TF-IDF genre vectors
  └─ pipeline/evaluate.mjs         held-out users: recall@10, coverage, intra-list diversity, novelty over a 90-point grid
site/src/engine.js                 the same scoring code runs offline (evaluation) and in the browser
```

Relevance = α · co-listening (item-kNN cosine with shrinkage) + (1 − α) · genre-profile cosine, times (1 − β · log-popularity),
then maximal-marginal-relevance re-ranking (λ) in genre space.

Measured (2,143 held-out listeners, seeds = random half of their history, k = 10):

| Recommender | Recall@10 | Coverage | List diversity | Novelty (bits) |
|---|---|---|---|---|
| Most popular | 0.056 | 0.01 | 0.98 | 4.05 |
| Genre match only | 0.079 | 0.90 | 0.53 | 7.04 |
| Co-listening only | 0.181 | 0.65 | 0.83 | 5.41 |
| Hybrid α=0.75 | 0.185 | 0.70 | 0.78 | 5.57 |
| Hybrid α=0.75, λ=0.3 | 0.181 | 0.71 | 0.87 | 5.44 |

Reproduce: download and unpack the dump into `data/raw/`, then
`python3 pipeline/extract_listens.py <listens file> && python3 pipeline/fetch_metadata.py 1500 && cd site && npm run data && npm test && npm run build`.
Re-extraction re-salts user ids; the split is keyed on each user's artist set, so it is stable.

Licences: ListenBrainz listens CC0 1.0; MusicBrainz core data CC0; MusicBrainz genre tags CC BY-NC-SA 3.0 (non-commercial demo, attributed; the derived genre weights in `site/public/data/catalog.json` are shared under the same licence).

Limits: one day of self-selected ListenBrainz users (rock/indie heavy); artist-level, no audio; offline metrics, not a user study.

## v1 (preserved): matrix factorisation on an authored catalog

`src/recommender.py` — biased MF with SGD on authored ratings, content fallback for new users. `python -m pytest tests -q` (14 checks).
Authored data, not real listening history; not what the website runs.

No production-readiness or independent model-quality guarantee is claimed.
