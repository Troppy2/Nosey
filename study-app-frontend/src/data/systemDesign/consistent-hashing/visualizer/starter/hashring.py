"""Build a consistent hash ring with virtual nodes.

ring_hash() is provided so every run is deterministic: Python's built-in hash()
is randomized per process and would make your results change between runs.

Fill in the five methods below. The brief lists the events to record.
"""
import bisect  # noqa: F401  (a sorted list of ring positions is the easy route)
import hashlib

import sim


def ring_hash(value):
    """A stable 128-bit position on the ring for any string."""
    return int(hashlib.md5(str(value).encode("utf-8")).hexdigest(), 16)


class HashRing:
    def __init__(self, replicas=100):
        self.replicas = replicas
        # Suggested shape: a sorted list of virtual-node positions, plus a map
        # from position to the physical node name that owns it.
        raise NotImplementedError("HashRing.__init__")

    def add_node(self, name):
        """Place self.replicas virtual nodes for name.

        Position i is ring_hash("{name}-{i}"). Call sim.tick() once and record
        "add_node" with the name and the number of virtual nodes now on the ring.
        Finish with sim.snapshot("ring", nodes=sorted(self.nodes())).
        """
        raise NotImplementedError("HashRing.add_node")

    def remove_node(self, name):
        """Drop every virtual node belonging to name.

        Call sim.tick() once and record "remove_node" with the name. Finish with
        sim.snapshot("ring", nodes=sorted(self.nodes())).
        """
        raise NotImplementedError("HashRing.remove_node")

    def get_node(self, key):
        """The first node clockwise from the key's position, or None on an empty ring.

        Clockwise means the first virtual node at a position greater than or
        equal to the key's, wrapping back to the lowest position at the end of
        the ring. Record "route" with the key and the node it resolved to.
        """
        raise NotImplementedError("HashRing.get_node")

    def nodes(self):
        """The distinct physical node names currently on the ring."""
        raise NotImplementedError("HashRing.nodes")
