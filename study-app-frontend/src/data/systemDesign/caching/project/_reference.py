"""Reference solution for the caching project. Test-only."""
import sim

from store import SlowStore  # noqa: F401


class CacheClient:
    def __init__(self, store, capacity, ttl):
        self.store = store
        self.capacity = capacity
        self.ttl = ttl
        self._entries = {}

    def get(self, key, now):
        sim.tick()
        if key in self._entries:
            value, expires_at = self._entries[key]
            if expires_at > now:
                self._entries.pop(key)
                self._entries[key] = (value, expires_at)
                sim.record("cache_hit", key=key)
                return value
            self._entries.pop(key)
            sim.record("cache_expired", key=key)

        sim.record("cache_miss", key=key)
        value = self.store.read(key)
        self._entries[key] = (value, now + self.ttl)
        while len(self._entries) > self.capacity:
            evicted = next(iter(self._entries))
            self._entries.pop(evicted)
            sim.record("evict", key=evicted)
        sim.snapshot("cache", keys=self.keys_by_recency())
        return value

    def invalidate(self, key):
        self._entries.pop(key, None)
        sim.record("invalidate", key=key)

    def keys_by_recency(self):
        return list(self._entries.keys())
