"""Hidden tests for the caching project. Deterministic: logical time is passed
in, so nothing here sleeps or reads a clock."""
import sim

from cache_client import CacheClient
from store import SlowStore


def _case(name, body):
    try:
        body()
        return (name, True, "")
    except AssertionError as exc:
        return (name, False, str(exc) or "assertion failed")
    except Exception as exc:
        return (name, False, "{}: {}".format(type(exc).__name__, exc))


def _events_of(kind):
    return [event for event in sim.events() if event["kind"] == kind]


def _build(data=None, capacity=3, ttl=10):
    store = SlowStore(data if data is not None else {"a": 1, "b": 2, "c": 3, "d": 4})
    return store, CacheClient(store, capacity, ttl)


def _reads_through_on_the_first_get():
    store, cache = _build()
    assert cache.get("a", 0) == 1, "the first get should return the stored value"
    assert store.reads == 1, "the first get should read the store exactly once"


def _serves_a_second_get_from_the_cache():
    store, cache = _build()
    cache.get("a", 0)
    assert cache.get("a", 5) == 1, "a cached read should return the same value"
    assert store.reads == 1, "a get inside the TTL should not touch the store again"


def _re_reads_after_the_ttl_expires():
    store, cache = _build(ttl=10)
    cache.get("a", 0)
    cache.get("a", 10)
    assert store.reads == 2, "a get at or after expiry should read the store again"


def _caches_a_missing_key():
    store, cache = _build()
    assert cache.get("nope", 0) is None, "a key the store lacks should read as None"
    assert cache.get("nope", 1) is None, "the negative result should still read as None"
    assert store.reads == 1, "a cached negative result should not fall through again"


def _invalidate_forces_a_re_read():
    store, cache = _build()
    cache.get("a", 0)
    cache.invalidate("a")
    cache.get("a", 1)
    assert store.reads == 2, "invalidate should make the next get read through"


def _a_write_is_invisible_until_the_entry_goes_away():
    store, cache = _build(ttl=10)
    cache.get("a", 0)
    store.write("a", 99)
    assert cache.get("a", 1) == 1, "a cached value stays until it expires or is invalidated"
    assert cache.get("a", 10) == 99, "after expiry the fresh value should be read"


def _evicts_the_least_recently_used_entry():
    store, cache = _build(capacity=2)
    cache.get("a", 0)
    cache.get("b", 0)
    cache.get("c", 0)
    keys = cache.keys_by_recency()
    assert len(keys) == 2, "the cache should hold at most capacity entries, got {}".format(len(keys))
    assert "a" not in keys, "'a' was least recently used and should have been evicted"


def _a_hit_refreshes_recency():
    store, cache = _build(capacity=2)
    cache.get("a", 0)
    cache.get("b", 0)
    cache.get("a", 1)
    cache.get("c", 1)
    keys = cache.keys_by_recency()
    assert "a" in keys, "reading 'a' should have made it the most recently used key"
    assert "b" not in keys, "'b' became least recently used and should have been evicted"


def _records_hit_miss_and_expiry():
    sim.reset()
    store, cache = _build(ttl=5)
    cache.get("a", 0)
    cache.get("a", 1)
    cache.get("a", 5)
    assert len(_events_of("cache_miss")) == 2, "expected two cache_miss events"
    assert len(_events_of("cache_hit")) == 1, "expected one cache_hit event"
    assert len(_events_of("cache_expired")) == 1, "expected one cache_expired event"


def _records_an_eviction_and_a_snapshot():
    sim.reset()
    store, cache = _build(capacity=1)
    cache.get("a", 0)
    cache.get("b", 0)
    evictions = _events_of("evict")
    assert len(evictions) == 1, "expected one evict event, got {}".format(len(evictions))
    assert evictions[0]["payload"].get("key") == "a", "the evict event should name the evicted key"
    snapshots = _events_of("snapshot")
    assert snapshots, "get should finish with sim.snapshot('cache', keys=...)"
    assert snapshots[-1]["payload"].get("label") == "cache", "the snapshot label should be 'cache'"


def run_tests():
    results = [
        _case("reads through to the store on the first get", _reads_through_on_the_first_get),
        _case("serves a second get from the cache", _serves_a_second_get_from_the_cache),
        _case("reads through again once the TTL expires", _re_reads_after_the_ttl_expires),
        _case("caches a missing key so it is not re-read", _caches_a_missing_key),
        _case("invalidate forces the next get to read through", _invalidate_forces_a_re_read),
        _case("a store write is invisible until expiry", _a_write_is_invisible_until_the_entry_goes_away),
        _case("evicts the least recently used entry", _evicts_the_least_recently_used_entry),
        _case("a hit refreshes recency", _a_hit_refreshes_recency),
        _case("records cache_hit, cache_miss and cache_expired", _records_hit_miss_and_expiry),
        _case("records evict and a cache snapshot", _records_an_eviction_and_a_snapshot),
    ]
    _leave_a_clean_trace()
    return results


def _leave_a_clean_trace():
    """One readable sequence for the panel: a miss, a hit, an expiry and an
    eviction. Guarded so an unfinished cache shows up as failing cases rather
    than a traceback."""
    try:
        sim.reset()
        store, cache = _build(capacity=3, ttl=5)
        cache.get("a", 0)
        cache.get("a", 1)
        cache.get("b", 1)
        cache.get("c", 2)
        cache.get("a", 6)
        cache.get("d", 6)
    except Exception:
        sim.reset()
