"""Hidden tests for the caching visualizer. Deterministic, no clock, no network."""
import sim

from cache import LRUCache


def _case(name, body):
    try:
        body()
        return (name, True, "")
    except AssertionError as exc:
        return (name, False, str(exc) or "assertion failed")
    except Exception as exc:
        return (name, False, "{}: {}".format(type(exc).__name__, exc))


def _kinds():
    return [event["kind"] for event in sim.events()]


def _events_of(kind):
    return [event for event in sim.events() if event["kind"] == kind]


def _missing_on_an_empty_cache():
    cache = LRUCache(2)
    assert cache.get("a") is None, "get on an empty cache should return None"


def _stores_and_returns_a_value():
    cache = LRUCache(2)
    cache.put("a", 1)
    assert cache.get("a") == 1, "get should return the value that was put"


def _updating_a_key_does_not_grow_the_cache():
    cache = LRUCache(2)
    cache.put("a", 1)
    cache.put("a", 2)
    assert cache.get("a") == 2, "a second put should overwrite the value"
    assert len(cache.keys_by_recency()) == 1, "updating a key should not add an entry"


def _evicts_the_least_recently_used_key():
    cache = LRUCache(2)
    cache.put("a", 1)
    cache.put("b", 2)
    cache.put("c", 3)
    assert cache.get("a") is None, "'a' was least recently used and should have been evicted"
    assert cache.get("b") == 2, "'b' should still be cached"
    assert cache.get("c") == 3, "'c' should still be cached"


def _a_hit_refreshes_recency():
    cache = LRUCache(2)
    cache.put("a", 1)
    cache.put("b", 2)
    cache.get("a")
    cache.put("c", 3)
    assert cache.get("a") == 1, "reading 'a' should have made it the most recently used key"
    assert cache.get("b") is None, "'b' became least recently used and should have been evicted"


def _keys_by_recency_is_least_recent_first():
    cache = LRUCache(3)
    cache.put("a", 1)
    cache.put("b", 2)
    cache.put("c", 3)
    cache.get("a")
    assert cache.keys_by_recency() == ["b", "c", "a"], (
        "expected ['b', 'c', 'a'], got {}".format(cache.keys_by_recency())
    )


def _records_hits_and_misses():
    sim.reset()
    cache = LRUCache(2)
    cache.put("a", 1)
    cache.get("a")
    cache.get("zzz")
    hits = _events_of("cache_hit")
    misses = _events_of("cache_miss")
    assert len(hits) == 1, "expected one cache_hit event, got {}".format(len(hits))
    assert hits[0]["payload"].get("key") == "a", "the cache_hit event should name the key"
    assert len(misses) == 1, "expected one cache_miss event, got {}".format(len(misses))
    assert misses[0]["payload"].get("key") == "zzz", "the cache_miss event should name the key"


def _records_an_eviction():
    sim.reset()
    cache = LRUCache(1)
    cache.put("a", 1)
    cache.put("b", 2)
    evictions = _events_of("evict")
    assert len(evictions) == 1, "expected one evict event, got {}".format(len(evictions))
    assert evictions[0]["payload"].get("key") == "a", "the evict event should name the evicted key"


def _records_a_snapshot_of_the_cache():
    sim.reset()
    cache = LRUCache(2)
    cache.put("a", 1)
    snapshots = _events_of("snapshot")
    assert snapshots, "put should finish with sim.snapshot('cache', keys=...)"
    payload = snapshots[-1]["payload"]
    assert payload.get("label") == "cache", "the snapshot label should be 'cache'"
    assert payload.get("keys") == ["a"], "the snapshot should carry the cached keys"


def _time_advances():
    sim.reset()
    cache = LRUCache(2)
    cache.put("a", 1)
    cache.get("a")
    times = [event["t"] for event in sim.events()]
    assert times and max(times) >= 2, "each get and put should call sim.tick() once"


def run_tests():
    results = [
        _case("returns None for a key that was never cached", _missing_on_an_empty_cache),
        _case("returns a value that was put", _stores_and_returns_a_value),
        _case("updating a key does not grow the cache", _updating_a_key_does_not_grow_the_cache),
        _case("evicts the least recently used key", _evicts_the_least_recently_used_key),
        _case("a hit refreshes recency", _a_hit_refreshes_recency),
        _case("keys_by_recency lists least recent first", _keys_by_recency_is_least_recent_first),
        _case("records cache_hit and cache_miss", _records_hits_and_misses),
        _case("records evict with the key that left", _records_an_eviction),
        _case("records a snapshot of the cache", _records_a_snapshot_of_the_cache),
        _case("advances sim time on every operation", _time_advances),
    ]
    _leave_a_clean_trace()
    return results


def _leave_a_clean_trace():
    """The panel replays the whole run, so end on one readable sequence rather
    than whatever the last assertion happened to build. Guarded: an unfinished
    cache must show up as ten failing cases, never as a traceback."""
    try:
        sim.reset()
        cache = LRUCache(2)
        cache.put("a", 1)
        cache.put("b", 2)
        cache.get("a")
        cache.get("zzz")
        cache.put("c", 3)
    except Exception:
        sim.reset()
