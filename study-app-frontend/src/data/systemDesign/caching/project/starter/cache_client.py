"""Build a read-through cache with a TTL in front of SlowStore.

The caller only ever talks to you: on a miss you read the store, remember the
answer, and return it. Time is injected, never read from a clock, so a run is
deterministic and a test never has to sleep.

Fill in the three methods below. The brief lists the events to record.
"""
import sim

from store import SlowStore  # noqa: F401  (imported so the tab is runnable on its own)


class CacheClient:
    def __init__(self, store, capacity, ttl):
        self.store = store
        self.capacity = capacity
        self.ttl = ttl
        # Suggested shape: {key: (value, expires_at)}, ordered by recency.
        raise NotImplementedError("CacheClient.__init__")

    def get(self, key, now):
        """Return the value for key as of logical time now.

        A live cached entry is returned without touching the store: record
        "cache_hit". An entry whose expires_at is at or before now is dropped
        first: record "cache_expired". Anything not answered from the cache is
        read through to the store: record "cache_miss", then store the result
        with expires_at = now + self.ttl.

        A key the store does not have is still an answer. Cache the None so a
        second lookup inside the TTL does not fall through again.

        Evict the least recently used entry whenever the cache is over
        capacity, recording "evict" with the key that left. Finish with
        sim.snapshot("cache", keys=self.keys_by_recency()).
        """
        raise NotImplementedError("CacheClient.get")

    def invalidate(self, key):
        """Drop key if it is cached, so the next get reads through again.

        Record "invalidate" with the key. Deleting is deliberate: it is
        idempotent, and it cannot lose a write that is happening concurrently
        the way an in-place update can.
        """
        raise NotImplementedError("CacheClient.invalidate")

    def keys_by_recency(self):
        """The cached keys, least recently used first."""
        raise NotImplementedError("CacheClient.keys_by_recency")
