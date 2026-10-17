# Engineering review / October 17, 2026

## problem
Tell users when a recommendation has preference evidence versus catalog ordering.

## example
Fit finite 1–5 ratings with SGD, exclude heard tracks, and label the new-user fallback.

## dataSource
Authored catalog and ratings, not real listening history.

## verification
14 passing model/similarity checks; no held-out ranking or user study claimed.

## limitations
Biased matrix factorization with SGD, not SVD decomposition. Catalog order is not measured popularity.

## Reproduce
Python 3.12, free project requirements and pytest: `python -m pytest tests -q`. Actual output: docs/test-results.txt. No paid API calls used. Optional local generation needs Ollama/qwen2.5:3b.
