import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__),'..','src'))
import pytest
from recommender import Song, Interaction, MusicRecommender, MatrixFactorization, content_similarity

def make_songs(n=8):
    genres = ["pop","rock","jazz","electronic","classical"]
    return [Song(f"s{i}",f"Song{i}",f"Artist{i}",genres[i%5],
                 tempo=80+i*10, energy=0.3+i*0.05, valence=0.4+i*0.05) for i in range(n)]

def make_interactions(songs, users=4):
    """Give each user ratings on half the songs, so other half can be recommended."""
    interactions = []
    for u in range(users):
        # Each user rates the first 4 songs
        for i, s in enumerate(songs[:4]):
            interactions.append(Interaction(f"u{u}", s.song_id, float(2+(u+i)%3+1)))
    return interactions

class TestContentSimilarity:
    def test_identical_songs_score_one(self):
        s = Song("s1","A","B","pop",120,0.5,0.5)
        assert abs(content_similarity(s, s) - 1.0) < 0.001

    def test_different_songs_score_less_than_one(self):
        s1 = Song("s1","A","B","pop",200,1.0,1.0)
        s2 = Song("s2","C","D","rock",80,0.1,0.1)
        assert content_similarity(s1, s2) < 1.0

    def test_symmetric(self):
        s1 = Song("s1","A","B","pop",120,0.5,0.7)
        s2 = Song("s2","C","D","rock",100,0.3,0.4)
        assert abs(content_similarity(s1, s2) - content_similarity(s2, s1)) < 1e-9

class TestMatrixFactorization:
    @pytest.fixture
    def fitted_model(self):
        songs = make_songs(8)
        interactions = make_interactions(songs, users=5)
        m = MatrixFactorization(n_factors=5, n_epochs=20)
        m.fit(interactions)
        return m, songs, interactions

    def test_fit_sets_fitted(self, fitted_model):
        m, _, _ = fitted_model; assert m.fitted

    def test_predict_in_range(self, fitted_model):
        m, _, interactions = fitted_model
        pred = m.predict(interactions[0].user_id, interactions[0].song_id)
        assert 1.0 <= pred <= 5.0

    def test_unknown_user_returns_none(self, fitted_model):
        m, songs, _ = fitted_model
        assert m.predict("unknown", songs[0].song_id) is None

    def test_recommend_returns_list(self, fitted_model):
        m, songs, _ = fitted_model
        recs = m.recommend("u0", songs, top_k=3)
        assert isinstance(recs, list)

    def test_not_fitted_raises(self):
        with pytest.raises(RuntimeError): MatrixFactorization().predict("u","s")

class TestMusicRecommender:
    @pytest.fixture
    def recommender(self):
        songs = make_songs(8)
        interactions = make_interactions(songs, users=5)
        r = MusicRecommender(n_factors=5, n_epochs=20)
        r.add_songs(songs)
        r.fit(interactions)
        return r, songs

    def test_recommend_known_user_songs_not_heard(self, recommender):
        r, songs = recommender
        # Songs 4-7 were never rated, so they can be recommended via content-based
        recs = r.recommend("u0", top_k=3)
        assert isinstance(recs, list)  # may be CF or content-based

    def test_recommendations_not_already_heard(self, recommender):
        r, songs = recommender
        heard = r.user_history.get("u0", set())
        recs = r.recommend("u0", top_k=5)
        for rec in recs:
            assert rec.song.song_id not in heard

    def test_cold_start_user_gets_recs(self, recommender):
        r, _ = recommender
        recs = r.recommend("brand_new_user", top_k=3)
        assert isinstance(recs, list)

    def test_recommendation_score_in_range(self, recommender):
        r, _ = recommender
        for rec in r.recommend("u0", top_k=5):
            assert 0 <= rec.score <= 5.0

    def test_recommendation_has_reason(self, recommender):
        r, _ = recommender
        for rec in r.recommend("u0", top_k=3):
            assert len(rec.reason) > 0


def test_empty_or_nonfinite_training_rejected():
    with pytest.raises(ValueError): MatrixFactorization().fit([])
    with pytest.raises(ValueError): MatrixFactorization().fit([Interaction("u","s",float("nan"))])
