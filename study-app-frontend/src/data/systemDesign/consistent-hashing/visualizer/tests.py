"""Hidden tests for the consistent hashing visualizer. Deterministic: ring_hash
is md5-based, so placements are identical on every run."""
import sim

from hashring import HashRing


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


def _keys(count=600):
    return ["key-{}".format(i) for i in range(count)]


def _owners(ring, keys):
    return {key: ring.get_node(key) for key in keys}


def _empty_ring_routes_nowhere():
    ring = HashRing(replicas=10)
    assert ring.get_node("anything") is None, "an empty ring should route to None"
    assert ring.nodes() == [], "an empty ring should have no nodes"


def _one_node_owns_everything():
    ring = HashRing(replicas=10)
    ring.add_node("a")
    assert all(ring.get_node(key) == "a" for key in _keys(50)), (
        "with one node on the ring every key should route to it"
    )


def _routing_is_stable():
    ring = HashRing(replicas=50)
    for name in ("a", "b", "c"):
        ring.add_node(name)
    first = _owners(ring, _keys(100))
    second = _owners(ring, _keys(100))
    assert first == second, "the same key must always route to the same node"


def _keys_spread_across_nodes():
    ring = HashRing(replicas=100)
    for name in ("a", "b", "c"):
        ring.add_node(name)
    owners = _owners(ring, _keys())
    counts = {name: sum(1 for node in owners.values() if node == name) for name in ("a", "b", "c")}
    assert all(count > 0 for count in counts.values()), (
        "every node should own some keys, got {}".format(counts)
    )
    assert max(counts.values()) < 0.6 * len(owners), (
        "one node owns more than 60 percent of the keys: {}".format(counts)
    )


def _adding_a_node_moves_few_keys():
    ring = HashRing(replicas=100)
    for name in ("a", "b", "c"):
        ring.add_node(name)
    keys = _keys()
    before = _owners(ring, keys)
    ring.add_node("d")
    after = _owners(ring, keys)

    moved = sum(1 for key in keys if before[key] != after[key])
    assert moved > 0, "adding a node should take over some keys"
    assert moved < 0.45 * len(keys), (
        "adding a fourth node moved {} of {} keys, which is close to a reshuffle".format(
            moved, len(keys)
        )
    )
    assert all(after[key] == "d" for key in keys if before[key] != after[key]), (
        "only the new node should have gained keys"
    )


def _removing_a_node_only_moves_its_own_keys():
    ring = HashRing(replicas=100)
    for name in ("a", "b", "c"):
        ring.add_node(name)
    keys = _keys()
    before = _owners(ring, keys)
    ring.remove_node("b")
    after = _owners(ring, keys)

    assert "b" not in ring.nodes(), "the removed node should be gone from the ring"
    for key in keys:
        if before[key] != "b":
            assert after[key] == before[key], (
                "removing 'b' moved a key that belonged to {}".format(before[key])
            )
        else:
            assert after[key] in ("a", "c"), "'b' keys should fall through to a neighbour"


def _more_replicas_spread_more_evenly():
    keys = _keys(900)

    def spread(replicas):
        ring = HashRing(replicas=replicas)
        for name in ("a", "b", "c"):
            ring.add_node(name)
        owners = _owners(ring, keys)
        counts = [sum(1 for node in owners.values() if node == name) for name in ("a", "b", "c")]
        return max(counts) - min(counts)

    assert spread(200) < spread(1), (
        "200 virtual nodes per machine should divide the keyspace more evenly than 1"
    )


def _records_ring_membership_changes():
    sim.reset()
    ring = HashRing(replicas=10)
    ring.add_node("a")
    ring.add_node("b")
    ring.remove_node("a")
    assert len(_events_of("add_node")) == 2, "expected two add_node events"
    assert len(_events_of("remove_node")) == 1, "expected one remove_node event"
    assert _events_of("remove_node")[0]["payload"].get("node") == "a", (
        "the remove_node event should name the node"
    )


def _records_routing():
    sim.reset()
    ring = HashRing(replicas=10)
    ring.add_node("a")
    ring.get_node("key-1")
    routes = _events_of("route")
    assert len(routes) == 1, "expected one route event, got {}".format(len(routes))
    assert routes[0]["payload"].get("key") == "key-1", "the route event should name the key"
    assert routes[0]["payload"].get("node") == "a", "the route event should name the node"


def _records_a_snapshot_of_the_ring():
    sim.reset()
    ring = HashRing(replicas=10)
    ring.add_node("a")
    ring.add_node("b")
    snapshots = _events_of("snapshot")
    assert snapshots, "add_node should finish with sim.snapshot('ring', nodes=...)"
    payload = snapshots[-1]["payload"]
    assert payload.get("label") == "ring", "the snapshot label should be 'ring'"
    assert payload.get("nodes") == ["a", "b"], "the snapshot should carry the ring's nodes"


def run_tests():
    results = [
        _case("an empty ring routes to None", _empty_ring_routes_nowhere),
        _case("a single node owns every key", _one_node_owns_everything),
        _case("the same key always routes to the same node", _routing_is_stable),
        _case("keys spread across every node", _keys_spread_across_nodes),
        _case("adding a node moves only a fraction of keys", _adding_a_node_moves_few_keys),
        _case("removing a node moves only its own keys", _removing_a_node_only_moves_its_own_keys),
        _case("more virtual nodes spread keys more evenly", _more_replicas_spread_more_evenly),
        _case("records add_node and remove_node", _records_ring_membership_changes),
        _case("records route with the key and the node", _records_routing),
        _case("records a snapshot of the ring", _records_a_snapshot_of_the_ring),
    ]
    _leave_a_clean_trace()
    return results


def _leave_a_clean_trace():
    """One short readable sequence for the panel. Guarded so an unfinished ring
    shows up as failing cases rather than a traceback."""
    try:
        sim.reset()
        ring = HashRing(replicas=50)
        ring.add_node("a")
        ring.add_node("b")
        for key in ("alpha", "beta", "gamma", "delta"):
            ring.get_node(key)
        ring.add_node("c")
        for key in ("alpha", "beta", "gamma", "delta"):
            ring.get_node(key)
        ring.remove_node("a")
    except Exception:
        sim.reset()
