"""A finished consistent hash ring. Provided and not editable.

This is the component you built in the visualizer. The project is about what a
store does WITH a ring when the set of nodes changes, so the ring itself is
handed to you complete."""
import bisect
import hashlib

import sim


def ring_hash(value):
    return int(hashlib.md5(str(value).encode("utf-8")).hexdigest(), 16)


class HashRing:
    def __init__(self, replicas=100):
        self.replicas = replicas
        self._positions = []
        self._owners = {}

    def add_node(self, name):
        sim.tick()
        for index in range(self.replicas):
            position = ring_hash("{}-{}".format(name, index))
            if position in self._owners:
                continue
            self._owners[position] = name
            bisect.insort(self._positions, position)
        sim.record("add_node", node=name, virtual_nodes=len(self._positions))
        sim.snapshot("ring", nodes=sorted(self.nodes()))

    def remove_node(self, name):
        sim.tick()
        keep = [p for p in self._positions if self._owners[p] != name]
        for position in self._positions:
            if self._owners[position] == name:
                del self._owners[position]
        self._positions = keep
        sim.record("remove_node", node=name, virtual_nodes=len(self._positions))
        sim.snapshot("ring", nodes=sorted(self.nodes()))

    def get_node(self, key):
        if not self._positions:
            sim.record("route", key=key, node=None)
            return None
        position = ring_hash(key)
        index = bisect.bisect_left(self._positions, position)
        if index == len(self._positions):
            index = 0
        node = self._owners[self._positions[index]]
        sim.record("route", key=key, node=node)
        return node

    def nodes(self):
        return sorted(set(self._owners.values()))
