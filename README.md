# Music Recommender Engine

Tell users when a recommendation has preference evidence versus catalog ordering.

Fit finite 1–5 ratings with SGD, exclude heard tracks, and label the new-user fallback.

See [review](docs/review.md) and [actual checks](docs/test-results.txt) for data, validation and limitations.

```sh
python -m pytest tests -q
```

No production-readiness or independent model-quality guarantee is claimed.
