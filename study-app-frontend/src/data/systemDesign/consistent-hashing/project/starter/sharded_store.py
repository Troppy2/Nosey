"""Build a sharded key-value store on top of the provided hash ring.

The point of the exercise is rebalancing. When a node joins or leaves, the store
has to move exactly the keys whose owner changed, and nothing else. A store that
rehashes everything has thrown away the only property the ring was there to give.

Fill in the methods below. The brief lists the events to record.
"""
import sim

from hashring import HashRing  # noqa: F401  (the ring is handed to you in __init__)


class ShardedStore:
    def __init__(self, ring):
        self.ring = ring
        # Suggested shape: {node_name: {key: value}}, one bucket per node, so
        # you can find a node's keys without scanning the whole keyspace.
        raise NotImplementedError("ShardedStore.__init__")

    def put(self, key, value):
        """Store the value on the node the ring routes the key to.

        Record "store_put" with the key and the node. A put with no nodes on the
        ring is a no-op: record "dropped" with the key and store nothing.
        """
        raise NotImplementedError("ShardedStore.put")

    def get(self, key):
        """Return the value, or None when the key is not stored.

        Record "store_get" with the key, the node, and whether it was found.
        """
        raise NotImplementedError("ShardedStore.get")

    def add_node(self, name):
        """Add the node to the ring, then move only the keys it now owns.

        Return the number of keys moved. Record "move_key" for each one, with
        the key and the nodes it moved from and to. Finish with
        sim.snapshot("shards", counts=self.key_counts()).
        """
        raise NotImplementedError("ShardedStore.add_node")

    def remove_node(self, name):
        """Take the node's keys off it, drop it from the ring, then re-home them.

        Order matters: the keys have to be collected before the node leaves the
        ring, or you will have lost the ability to find them. Return the number
        of keys moved and record "move_key" for each, as above. Keys with
        nowhere to go (the last node left) are dropped: record "dropped".
        """
        raise NotImplementedError("ShardedStore.remove_node")

    def key_counts(self):
        """{node_name: number of keys held}, for every node on the ring."""
        raise NotImplementedError("ShardedStore.key_counts")
