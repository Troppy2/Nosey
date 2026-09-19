"""Reference solution for the consistent hashing project. Test-only."""
import sim

from hashring import HashRing  # noqa: F401


class ShardedStore:
    def __init__(self, ring):
        self.ring = ring
        self._shards = {name: {} for name in ring.nodes()}

    def put(self, key, value):
        node = self.ring.get_node(key)
        if node is None:
            sim.record("dropped", key=key)
            return
        self._shards.setdefault(node, {})[key] = value
        sim.record("store_put", key=key, node=node)

    def get(self, key):
        node = self.ring.get_node(key)
        if node is None:
            sim.record("store_get", key=key, node=None, found=False)
            return None
        value = self._shards.get(node, {}).get(key)
        sim.record("store_get", key=key, node=node, found=value is not None)
        return value

    def add_node(self, name):
        self.ring.add_node(name)
        self._shards.setdefault(name, {})
        moved = 0
        for source in list(self._shards):
            if source == name:
                continue
            for key in list(self._shards[source]):
                owner = self._ring_owner(key)
                if owner == source:
                    continue
                self._shards[owner][key] = self._shards[source].pop(key)
                sim.record("move_key", key=key, **{"from": source, "to": owner})
                moved += 1
        sim.snapshot("shards", counts=self.key_counts())
        return moved

    def remove_node(self, name):
        leaving = self._shards.pop(name, {})
        self.ring.remove_node(name)
        moved = 0
        for key, value in leaving.items():
            owner = self._ring_owner(key)
            if owner is None:
                sim.record("dropped", key=key)
                continue
            self._shards.setdefault(owner, {})[key] = value
            sim.record("move_key", key=key, **{"from": name, "to": owner})
            moved += 1
        sim.snapshot("shards", counts=self.key_counts())
        return moved

    def key_counts(self):
        return {name: len(self._shards.get(name, {})) for name in self.ring.nodes()}

    def _ring_owner(self, key):
        """Route without emitting a route event: rebalancing is bookkeeping, not
        a read the timeline should be flooded with."""
        events_before = len(sim.events())
        owner = self.ring.get_node(key)
        del sim.events()[events_before:]
        return owner
