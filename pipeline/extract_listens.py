"""Stream a ListenBrainz incremental listens dump (CC0) into an anonymised
user x artist play-count table. Stdlib only.

Privacy: user names are never written. Users are re-keyed to a salted hash
whose salt is random per run and discarded, and the resulting per-user table
is written only to data/private/ (gitignored). The public site ships item-level
aggregates only.
"""
import collections, hashlib, re, json, os, secrets, sys

src = sys.argv[1]
out_dir = os.path.join(os.path.dirname(__file__), "..", "data", "private")
os.makedirs(out_dir, exist_ok=True)
salt = secrets.token_bytes(16)

plays = collections.defaultdict(collections.Counter)  # anon_user -> artist_mbid -> plays
names = collections.defaultdict(collections.Counter)  # artist_mbid -> submitted names
mbid_votes = collections.defaultdict(collections.Counter)
FEAT = re.compile(r"\s+(feat\.?|ft\.?|featuring|with|x)\s+.*$", re.I)
def norm(name):
    """Artist key: case-folded credit with featured-artist suffix removed."""
    return " ".join(FEAT.sub("", name).casefold().split())
n = with_mbid = 0
with open(src, "rb") as fh:
    for line in fh:
        n += 1
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        tm = rec.get("track_metadata", {}) or {}
        info = tm.get("additional_info", {}) or {}
        raw = (tm.get("artist_name") or "").strip()
        key = norm(raw)
        if not key:
            continue
        user = hashlib.blake2b(str(rec["user_id"]).encode(), key=salt, digest_size=8).hexdigest()
        plays[user][key] += 1
        names[key][raw] += 1
        mbids = info.get("artist_mbids") or []
        if len(mbids) == 1:  # only unambiguous single-artist credits map name -> MBID
            with_mbid += 1
            mbid_votes[key][mbids[0]] += 1

json.dump({"users": {u: dict(c) for u, c in plays.items()}}, open(os.path.join(out_dir, "user_artist.json"), "w"))
json.dump({k: {"name": c.most_common(1)[0][0], "mbid": (mbid_votes[k].most_common(1)[0][0] if mbid_votes.get(k) else None)} for k, c in names.items()}, open(os.path.join(out_dir, "artist_names.json"), "w"), ensure_ascii=False)
stats = {"listens_read": n, "single_artist_listens_with_mbid": with_mbid, "users": len(plays), "artists": len(names)}
json.dump(stats, open(os.path.join(out_dir, "extract_stats.json"), "w"), indent=1)
print(stats)
