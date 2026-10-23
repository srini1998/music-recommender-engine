"""Fetch MusicBrainz artist metadata (area, begin year, genre tags) for the
catalog via the public ListenBrainz metadata API, batched and rate-limited
(1 request/second). Output: data/private/artist_meta.json (raw cache)."""
import collections, json, os, sys, time, urllib.request

CATALOG_SIZE = int(sys.argv[1]) if len(sys.argv) > 1 else 1500
here = os.path.dirname(__file__)
priv = os.path.join(here, "..", "data", "private")
users = json.load(open(os.path.join(priv, "user_artist.json")))["users"]
names = json.load(open(os.path.join(priv, "artist_names.json")))
reach = collections.Counter(a for c in users.values() for a in c)
catalog = [a for a, _ in reach.most_common() if names[a]["mbid"]][:CATALOG_SIZE]
cache_path = os.path.join(priv, "artist_meta.json")
cache = json.load(open(cache_path)) if os.path.exists(cache_path) else {}
todo = [names[a]["mbid"] for a in catalog if names[a]["mbid"] not in cache]
UA = "music-recommender-engine/0.2 (github.com/srini1998/music-recommender-engine)"
for i in range(0, len(todo), 25):
    batch = todo[i:i + 25]
    url = "https://api.listenbrainz.org/1/metadata/artist/?inc=tag&artist_mbids=" + ",".join(batch)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            rows = json.load(urllib.request.urlopen(req, timeout=30))
            break
        except Exception as e:  # rate limit or transient error: back off
            print("retry", attempt, e, file=sys.stderr); time.sleep(5 * (attempt + 1))
    else:
        raise SystemExit("metadata fetch failed")
    for r in rows:
        tags = [{"tag": t["tag"], "count": t["count"], "genre": bool(t.get("genre_mbid"))} for t in (r.get("tag") or {}).get("artist", [])]
        cache[r["artist_mbid"]] = {"name": r.get("name"), "area": r.get("area"), "begin_year": r.get("begin_year"), "tags": tags}
    for m in batch:
        cache.setdefault(m, {"missing": True})
    json.dump(cache, open(cache_path, "w"), ensure_ascii=False)
    print(f"{min(i + 25, len(todo))}/{len(todo)}", flush=True)
    time.sleep(1.0)
json.dump(catalog, open(os.path.join(priv, "catalog_keys.json"), "w"), ensure_ascii=False)
