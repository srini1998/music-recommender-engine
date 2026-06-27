"""
Music Recommendation Engine
----------------------------
Collaborative filtering via matrix factorization (SVD).
Also supports content-based filtering by song features.
"""
import numpy as np
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple

@dataclass
class Song:
    song_id: str
    title: str
    artist: str
    genre: str
    tempo: float = 120.0
    energy: float = 0.5
    valence: float = 0.5   # positivity 0-1

@dataclass
class Interaction:
    user_id: str
    song_id: str
    rating: float  # 1.0 - 5.0, or implicit (play count normalized)

@dataclass
class Recommendation:
    song: Song
    score: float
    reason: str

class MatrixFactorization:
    """
    SVD-based collaborative filtering.
    Learns latent user/item factors to predict missing ratings.
    
    Concept: Every user and song can be described by k latent factors
    (e.g. "likes fast tempo", "prefers sad songs"). The dot product of
    user factors × song factors predicts the rating.
    """
    def __init__(self, n_factors: int = 10, n_epochs: int = 20,
                 lr: float = 0.005, reg: float = 0.02):
        self.n_factors = n_factors
        self.n_epochs = n_epochs
        self.lr = lr       # learning rate
        self.reg = reg     # L2 regularization
        self.user_factors: Optional[np.ndarray] = None
        self.item_factors: Optional[np.ndarray] = None
        self.user_bias: Optional[np.ndarray] = None
        self.item_bias: Optional[np.ndarray] = None
        self.global_mean: float = 0.0
        self.user_index: Dict[str, int] = {}
        self.item_index: Dict[str, int] = {}
        self.fitted = False

    def fit(self, interactions: List[Interaction]):
        users = sorted(set(i.user_id for i in interactions))
        items = sorted(set(i.song_id for i in interactions))
        self.user_index = {u: i for i, u in enumerate(users)}
        self.item_index = {s: i for i, s in enumerate(items)}
        n_users, n_items = len(users), len(items)
        ratings = [i.rating for i in interactions]
        self.global_mean = float(np.mean(ratings))

        rng = np.random.RandomState(42)
        self.user_factors = rng.normal(0, 0.1, (n_users, self.n_factors))
        self.item_factors = rng.normal(0, 0.1, (n_items, self.n_factors))
        self.user_bias = np.zeros(n_users)
        self.item_bias = np.zeros(n_items)

        for epoch in range(self.n_epochs):
            total_loss = 0.0
            for inter in interactions:
                u = self.user_index[inter.user_id]
                i = self.item_index[inter.song_id]
                pred = self._predict_raw(u, i)
                err = inter.rating - pred
                total_loss += err ** 2
                # SGD update
                self.user_bias[u] += self.lr * (err - self.reg * self.user_bias[u])
                self.item_bias[i] += self.lr * (err - self.reg * self.item_bias[i])
                uf_update = self.lr * (err * self.item_factors[i] - self.reg * self.user_factors[u])
                if_update = self.lr * (err * self.user_factors[u] - self.reg * self.item_factors[i])
                self.user_factors[u] += uf_update
                self.item_factors[i] += if_update

        self.fitted = True

    def _predict_raw(self, u_idx: int, i_idx: int) -> float:
        return (self.global_mean + self.user_bias[u_idx] + self.item_bias[i_idx]
                + np.dot(self.user_factors[u_idx], self.item_factors[i_idx]))

    def predict(self, user_id: str, song_id: str) -> Optional[float]:
        if not self.fitted: raise RuntimeError("Model not fitted")
        if user_id not in self.user_index or song_id not in self.item_index:
            return None
        u, i = self.user_index[user_id], self.item_index[song_id]
        return float(np.clip(self._predict_raw(u, i), 1.0, 5.0))

    def recommend(self, user_id: str, songs: List[Song],
                  exclude_ids: set = None, top_k: int = 10) -> List[Tuple[str, float]]:
        if not self.fitted: raise RuntimeError("Model not fitted")
        if user_id not in self.user_index: return []
        u = self.user_index[user_id]
        exclude = exclude_ids or set()
        scores = []
        for song in songs:
            if song.song_id in exclude: continue
            if song.song_id in self.item_index:
                i = self.item_index[song.song_id]
                score = float(np.clip(self._predict_raw(u, i), 1.0, 5.0))
                scores.append((song.song_id, score))
        return sorted(scores, key=lambda x: x[1], reverse=True)[:top_k]

def content_similarity(song_a: Song, song_b: Song) -> float:
    """Cosine similarity on audio features (tempo norm, energy, valence)."""
    va = np.array([song_a.tempo / 200, song_a.energy, song_a.valence])
    vb = np.array([song_b.tempo / 200, song_b.energy, song_b.valence])
    denom = np.linalg.norm(va) * np.linalg.norm(vb)
    if denom == 0: return 0.0
    return float(np.dot(va, vb) / denom)

class MusicRecommender:
    """
    Hybrid recommender: collaborative filtering + content-based fallback.
    Uses CF when user has history, content-based for cold-start users.
    """
    def __init__(self, n_factors: int = 10, n_epochs: int = 20):
        self.cf = MatrixFactorization(n_factors=n_factors, n_epochs=n_epochs)
        self.songs: Dict[str, Song] = {}
        self.user_history: Dict[str, set] = {}

    def add_songs(self, songs: List[Song]):
        for s in songs: self.songs[s.song_id] = s

    def fit(self, interactions: List[Interaction]):
        for inter in interactions:
            self.user_history.setdefault(inter.user_id, set()).add(inter.song_id)
        self.cf.fit(interactions)

    def recommend(self, user_id: str, top_k: int = 5) -> List[Recommendation]:
        already_heard = self.user_history.get(user_id, set())
        songs = list(self.songs.values())

        if user_id in self.cf.user_index:
            # Collaborative filtering path
            scored = self.cf.recommend(user_id, songs, exclude_ids=already_heard, top_k=top_k)
            return [Recommendation(song=self.songs[sid], score=round(score,3),
                                   reason="Collaborative filtering") for sid, score in scored]
        else:
            # Cold-start: content-based using most popular songs as seed
            if not already_heard or not songs:
                return [Recommendation(song=s, score=0.5, reason="Popular pick")
                        for s in songs[:top_k]]
            seed = self.songs.get(next(iter(already_heard)))
            if not seed: return []
            scored = [(s, content_similarity(seed, s)) for s in songs
                      if s.song_id not in already_heard]
            scored.sort(key=lambda x: x[1], reverse=True)
            return [Recommendation(song=s, score=round(sc,3), reason="Content-based")
                    for s, sc in scored[:top_k]]
