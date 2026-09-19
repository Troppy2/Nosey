import { normalizeSource } from "../raw";
import type { Concept } from "../types";
import { cachingFrq, cachingMcq } from "./quiz";

import notesRaw from "./notes.md?raw";
import visualizerStarterRaw from "./visualizer/starter/cache.py?raw";
import visualizerTestsRaw from "./visualizer/tests.py?raw";
import projectStoreRaw from "./project/starter/store.py?raw";
import projectStarterRaw from "./project/starter/cache_client.py?raw";
import projectTestsRaw from "./project/tests.py?raw";

export const caching: Concept = {
  id: "caching",
  order: 1,
  title: "Caching",
  blurb: "Why a fast copy of the truth is worth having, and what it costs you when it is wrong.",
  notes: normalizeSource(notesRaw),
  // Set by the owner once a video is chosen. The sub-module and its checkbox
  // work either way.
  video: null,

  visualizer: {
    kind: "visualizer",
    title: "Build an LRU cache",
    brief: [
      "Implement `LRUCache` in `cache.py` from scratch. No imports beyond `sim`.",
      "",
      "- `__init__(capacity)` sets the maximum number of entries.",
      "- `get(key)` returns the value, or `None` when the key is not cached. A hit makes that key the most recently used one.",
      "- `put(key, value)` inserts or updates, making the key most recently used. When the cache is over capacity, drop the least recently used entry.",
      "- `keys_by_recency()` returns the cached keys, least recently used first.",
      "",
      "A plain `dict` is enough: it preserves insertion order, so popping a key and reinserting it moves it to the most recently used end.",
    ].join("\n"),
    simGuide: [
      "The timeline panel replays whatever you record, so the events are part of the exercise:",
      "",
      "- `get`: call `sim.tick()` once, then `sim.record(\"cache_hit\", key=key)` or `sim.record(\"cache_miss\", key=key)`.",
      "- `put`: call `sim.tick()` once, then `sim.record(\"cache_put\", key=key)`.",
      "- On an eviction: `sim.record(\"evict\", key=evicted_key)`.",
      "- At the end of `put`: `sim.snapshot(\"cache\", keys=self.keys_by_recency())`.",
    ].join("\n"),
    files: [{ name: "cache.py", contents: normalizeSource(visualizerStarterRaw) }],
    mockPackages: [],
    testModule: normalizeSource(visualizerTestsRaw),
  },

  project: {
    kind: "project",
    title: "A read-through cache with a TTL",
    brief: [
      "`store.py` is the slow backing store. It is provided and not editable, and it counts every read so you can see when your cache falls through to it.",
      "",
      "Implement `CacheClient` in `cache_client.py`:",
      "",
      "- `get(key, now)` returns the value as of logical time `now`. A live cached entry is returned without touching the store. An entry whose expiry is at or before `now` is dropped, and the value is read through to the store and cached with `expires_at = now + self.ttl`.",
      "- A key the store does not have is still an answer. Cache the `None` so a second lookup inside the TTL does not fall through again.",
      "- Evict the least recently used entry whenever the cache is over `capacity`.",
      "- `invalidate(key)` drops the key so the next `get` reads through again.",
      "- `keys_by_recency()` returns the cached keys, least recently used first.",
      "",
      "Time is passed in, never read from a clock. That is what makes the behaviour testable, and it is how you would build this for real.",
    ].join("\n"),
    simGuide: [
      "- `get`: `sim.tick()` once, then `sim.record(\"cache_hit\", key=key)`, `sim.record(\"cache_expired\", key=key)` and `sim.record(\"cache_miss\", key=key)` as each applies.",
      "- On an eviction: `sim.record(\"evict\", key=evicted_key)`.",
      "- `invalidate`: `sim.record(\"invalidate\", key=key)`.",
      "- At the end of `get`: `sim.snapshot(\"cache\", keys=self.keys_by_recency())`.",
      "",
      "`store.py` already records `store_read` for you, so the timeline shows every fall-through.",
    ].join("\n"),
    files: [
      { name: "store.py", contents: normalizeSource(projectStoreRaw), readonly: true },
      { name: "cache_client.py", contents: normalizeSource(projectStarterRaw) },
    ],
    mockPackages: [],
    testModule: normalizeSource(projectTestsRaw),
  },

  quiz: { mcq: cachingMcq, frq: cachingFrq },
};
