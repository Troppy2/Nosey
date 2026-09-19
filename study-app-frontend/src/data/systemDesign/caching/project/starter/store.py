"""The backing store your cache sits in front of. Provided, and not editable.

It is deliberately dumb and deliberately loud: every read increments a counter
and records a store_read event, so the tests (and the timeline) can see exactly
how many times your cache fell through to it.
"""
import sim


class SlowStore:
    def __init__(self, data=None):
        self._data = dict(data or {})
        self.reads = 0

    def read(self, key):
        self.reads += 1
        sim.record("store_read", key=key)
        return self._data.get(key)

    def write(self, key, value):
        self._data[key] = value
