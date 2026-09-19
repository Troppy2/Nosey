"""Hidden tests for the consistent hashing project. Deterministic: the provided
ring hashes with md5, so every placement is reproducible."""
import sim

from hashring import HashRing
from sharded_store import ShardedStore


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


def _keys(count=300):
    return ["key-{}".format(i) for i in range(count)]


def _build(nodes=("a", "b", "c"), replicas=100, keys=None):
    ring = HashRing(replicas=replicas)
    for name in nodes:
        ring.add_node(name)
    store = ShardedStore(ring)
    for key in keys if keys is not None else _keys():
        store.put(key, key.upper())
    return ring, store


def _stores_and_reads_back():
    _ring, store = _build(keys=["alpha", "beta"])
    assert store.get("alpha") == "ALPHA", "get should return what put stored"
    assert store.get("beta") == "BETA", "get should return what put stored"


def _unknown_key_reads_as_none():
    _ring, store = _build(keys=["alpha"])
    assert store.get("missing") is None, "an unstored key should read as None"


def _a_key_lives_on_the_node_the_ring_picks():
    ring, store = _build(keys=_keys(50))
    counts = store.key_counts()
    for key in _keys(50):
        owner = ring.get_node(key)
        assert counts.get(owner, 0) > 0, "the owning node should be holding keys"
    assert sum(counts.values()) == 50, (
        "expected 50 keys across the shards, got {}".format(sum(counts.values()))
    )


def _a_store_with_no_nodes_drops_writes():
    ring = HashRing(replicas=10)
    store = ShardedStore(ring)
    store.put("alpha", "ALPHA")
    assert store.get("alpha") is None, "a store with no nodes has nowhere to put a key"


def _adding_a_node_moves_only_the_keys_it_now_owns():
    keys = _keys()
    ring, store = _build(keys=keys)
    before = {key: ring.get_node(key) for key in keys}

    moved = store.add_node("d")
    after = {key: ring.get_node(key) for key in keys}
    expected = sum(1 for key in keys if before[key] != after[key])

    assert moved == expected, (
        "expected {} keys to move when the new node joined, the store moved {}".format(
            expected, moved
        )
    )
    assert 0 < moved < 0.45 * len(keys), (
        "{} of {} keys moved, which is close to a full reshuffle".format(moved, len(keys))
    )


def _every_key_is_still_readable_after_a_node_joins():
    keys = _keys(200)
    _ring, store = _build(keys=keys)
    store.add_node("d")
    for key in keys:
        assert store.get(key) == key.upper(), "{} was lost when a node joined".format(key)


def _every_key_is_still_readable_after_a_node_leaves():
    keys = _keys(200)
    _ring, store = _build(keys=keys)
    store.remove_node("b")
    for key in keys:
        assert store.get(key) == key.upper(), "{} was lost when a node left".format(key)


def _removing_a_node_moves_exactly_its_own_keys():
    keys = _keys()
    ring, store = _build(keys=keys)
    held_by_b = sum(1 for key in keys if ring.get_node(key) == "b")

    moved = store.remove_node("b")
    assert moved == held_by_b, (
        "the departing node held {} keys, the store moved {}".format(held_by_b, moved)
    )
    assert "b" not in store.key_counts(), "the removed node should be gone from the shard counts"


def _removing_the_last_node_drops_its_keys():
    _ring, store = _build(nodes=("a",), keys=["alpha", "beta"])
    store.remove_node("a")
    assert store.get("alpha") is None, "with no nodes left there is nowhere to read from"
    assert store.key_counts() == {}, "an empty ring should report no shards"


def _records_moves_and_a_shard_snapshot():
    keys = _keys(120)
    _ring, store = _build(keys=keys)
    sim.reset()
    store.add_node("d")

    moves = _events_of("move_key")
    assert moves, "each rebalanced key should record a move_key event"
    payload = moves[0]["payload"]
    assert "key" in payload and "from" in payload and "to" in payload, (
        "a move_key event should carry key, from and to"
    )
    assert payload["to"] == "d", "keys should only move to the node that just joined"

    snapshots = _events_of("snapshot")
    assert snapshots, "add_node should finish with sim.snapshot('shards', counts=...)"
    assert snapshots[-1]["payload"].get("label") == "shards", (
        "the snapshot label should be 'shards'"
    )


def run_tests():
    results = [
        _case("stores a value and reads it back", _stores_and_reads_back),
        _case("an unstored key reads as None", _unknown_key_reads_as_none),
        _case("keys live on the node the ring picks", _a_key_lives_on_the_node_the_ring_picks),
        _case("a store with no nodes drops writes", _a_store_with_no_nodes_drops_writes),
        _case(
            "adding a node moves only the keys it now owns",
            _adding_a_node_moves_only_the_keys_it_now_owns,
        ),
        _case("every key survives a node joining", _every_key_is_still_readable_after_a_node_joins),
        _case("every key survives a node leaving", _every_key_is_still_readable_after_a_node_leaves),
        _case("removing a node moves exactly its own keys", _removing_a_node_moves_exactly_its_own_keys),
        _case("removing the last node drops its keys", _removing_the_last_node_drops_its_keys),
        _case("records move_key and a shard snapshot", _records_moves_and_a_shard_snapshot),
    ]
    _leave_a_clean_trace()
    return results


def _leave_a_clean_trace():
    """A short, readable rebalance for the panel. Guarded so an unfinished store
    shows up as failing cases rather than a traceback."""
    try:
        sim.reset()
        ring = HashRing(replicas=50)
        for name in ("a", "b"):
            ring.add_node(name)
        store = ShardedStore(ring)
        for key in ("alpha", "beta", "gamma", "delta", "epsilon", "zeta"):
            store.put(key, key.upper())
        store.add_node("c")
        store.get("alpha")
        store.remove_node("a")
    except Exception:
        sim.reset()
