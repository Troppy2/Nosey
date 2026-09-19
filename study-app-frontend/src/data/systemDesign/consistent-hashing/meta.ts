import { normalizeSource } from "../raw";
import type { Concept } from "../types";
import { consistentHashingFrq, consistentHashingMcq } from "./quiz";

import notesRaw from "./notes.md?raw";
import visualizerStarterRaw from "./visualizer/starter/hashring.py?raw";
import visualizerTestsRaw from "./visualizer/tests.py?raw";
import projectRingRaw from "./project/starter/hashring.py?raw";
import projectStarterRaw from "./project/starter/sharded_store.py?raw";
import projectTestsRaw from "./project/tests.py?raw";

export const consistentHashing: Concept = {
  id: "consistent-hashing",
  order: 2,
  title: "Consistent Hashing",
  blurb: "How to split a keyspace across machines so that adding one does not move everything.",
  notes: normalizeSource(notesRaw),
  video: {
    title: "Consistent Hashing | Algorithms You Should Know #1",
    youtubeId: "UF9Iqmg94tk",
  },

  visualizer: {
    kind: "visualizer",
    title: "Build a hash ring with virtual nodes",
    brief: [
      "Implement `HashRing` in `hashring.py`. `ring_hash()` is provided: use it for everything, and never Python's built-in `hash()`, which is randomized per process and would make your ring different on every run.",
      "",
      "- `__init__(replicas)` sets how many virtual nodes each machine gets.",
      "- `add_node(name)` places `replicas` markers at `ring_hash(\"{name}-{i}\")` for i in 0 to replicas - 1.",
      "- `remove_node(name)` drops every marker belonging to that machine.",
      "- `get_node(key)` returns the first node clockwise from the key's position, wrapping past the top of the ring, or `None` when the ring is empty.",
      "- `nodes()` returns the distinct physical node names on the ring.",
      "",
      "A sorted list of marker positions plus `bisect` is all the machinery this needs. The hidden tests check the properties that make the ring worth building: routing is stable, adding a fourth node moves well under half the keys, and removing a node moves only its own.",
    ].join("\n"),
    simGuide: [
      "- `add_node`: `sim.tick()` once, then `sim.record(\"add_node\", node=name, virtual_nodes=<count on the ring>)`.",
      "- `remove_node`: `sim.tick()` once, then `sim.record(\"remove_node\", node=name, virtual_nodes=<count>)`.",
      "- `get_node`: `sim.record(\"route\", key=key, node=node)`, including when the node is `None`.",
      "- At the end of `add_node` and `remove_node`: `sim.snapshot(\"ring\", nodes=sorted(self.nodes()))`.",
    ].join("\n"),
    files: [{ name: "hashring.py", contents: normalizeSource(visualizerStarterRaw) }],
    mockPackages: [],
    testModule: normalizeSource(visualizerTestsRaw),
  },

  project: {
    kind: "project",
    title: "A sharded store that rebalances",
    brief: [
      "`hashring.py` is the finished ring from the visualizer. It is provided and not editable, because this exercise is about what a store does with a ring, not about the ring.",
      "",
      "Implement `ShardedStore` in `sharded_store.py`:",
      "",
      "- `put(key, value)` stores on the node the ring routes to. With no nodes on the ring there is nowhere to put it, so record `dropped` and store nothing.",
      "- `get(key)` returns the value, or `None`.",
      "- `add_node(name)` adds the node to the ring and then moves exactly the keys whose owner changed, returning how many moved.",
      "- `remove_node(name)` takes the node's keys off it first, then drops it from the ring, then re-homes them. Order matters: once the node is off the ring you can no longer find out what it was holding. Keys with nowhere to go are dropped.",
      "- `key_counts()` returns `{node: number of keys}` for every node on the ring.",
      "",
      "The tests check that a join moves exactly the keys that changed owner and no more. Rehashing every key would pass the read-back tests and fail the one that matters.",
    ].join("\n"),
    simGuide: [
      "- `put`: `sim.record(\"store_put\", key=key, node=node)`, or `sim.record(\"dropped\", key=key)` when the ring is empty.",
      "- `get`: `sim.record(\"store_get\", key=key, node=node, found=<bool>)`.",
      "- Each rebalanced key: `sim.record(\"move_key\", key=key, **{\"from\": source, \"to\": owner})`.",
      "- At the end of `add_node` and `remove_node`: `sim.snapshot(\"shards\", counts=self.key_counts())`.",
    ].join("\n"),
    files: [
      { name: "hashring.py", contents: normalizeSource(projectRingRaw), readonly: true },
      { name: "sharded_store.py", contents: normalizeSource(projectStarterRaw) },
    ],
    mockPackages: [],
    testModule: normalizeSource(projectTestsRaw),
  },

  quiz: { mcq: consistentHashingMcq, frq: consistentHashingFrq },
};
