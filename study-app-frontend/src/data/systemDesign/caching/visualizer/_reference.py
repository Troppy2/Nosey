"""Reference solution for the caching visualizer. Test-only: never shipped to a
tab, never referenced by meta.ts."""
import sim


class LRUCache:
    def __init__(self, capacity):
        self.capacity = capacity
        self._entries = {}

    def get(self, key):
        sim.tick()
        if key not in self._entries:
            sim.record("cache_miss", key=key)
            return None
        value = self._entries.pop(key)
        self._entries[key] = value
        sim.record("cache_hit", key=key)
        return value

    def put(self, key, value):
        sim.tick()
        if key in self._entries:
            self._entries.pop(key)
        self._entries[key] = value
        sim.record("cache_put", key=key)
        while len(self._entries) > self.capacity:
            evicted = next(iter(self._entries))
            self._entries.pop(evicted)
            sim.record("evict", key=evicted)
        sim.snapshot("cache", keys=self.keys_by_recency())

    def keys_by_recency(self):
        return list(self._entries.keys())
