"""Build an LRU cache from scratch, and instrument it so the timeline can
replay what happened.

Fill in the four methods below. Every method must call the sim functions the
brief lists: the timeline panel renders whatever you record, and the hidden
tests check both the behaviour and the events.
"""
import sim


class LRUCache:
    def __init__(self, capacity):
        self.capacity = capacity
        # Your storage goes here. An ordered mapping is the easy route:
        # dict preserves insertion order, and dict.pop + reinsert moves a key
        # to the most recently used end.
        raise NotImplementedError("LRUCache.__init__")

    def get(self, key):
        """Return the value for key, or None when it is not cached.

        Call sim.tick() once. Record "cache_hit" with the key on a hit and
        "cache_miss" with the key on a miss. A hit also makes the key the most
        recently used one.
        """
        raise NotImplementedError("LRUCache.get")

    def put(self, key, value):
        """Insert or update key, making it the most recently used.

        Call sim.tick() once and record "cache_put" with the key. When the
        cache is over capacity, drop the least recently used entry and record
        "evict" with the key that left. Finish with
        sim.snapshot("cache", keys=self.keys_by_recency()).
        """
        raise NotImplementedError("LRUCache.put")

    def keys_by_recency(self):
        """The cached keys, least recently used first."""
        raise NotImplementedError("LRUCache.keys_by_recency")
