import type { QuizFrq, QuizMcq } from "../types";

export const cachingMcq: QuizMcq[] = [
  {
    id: "caching-mcq-1",
    prompt:
      "An application reads the cache, and on a miss reads the database and writes the value back into the cache itself. Which pattern is this?",
    options: ["Cache aside", "Write through", "Write back", "Write around"],
    correctIndex: 0,
  },
  {
    id: "caching-mcq-2",
    prompt:
      "A single very popular key expires and thousands of in-flight requests all miss at the same instant, so every one of them queries the database. What is this failure called, and which fix addresses it directly?",
    options: [
      "Cache penetration, fixed by caching the negative result",
      "A stampede, fixed by letting one request rebuild the value while the rest wait or serve the stale copy",
      "A cold cache, fixed by increasing the cache size",
      "Write amplification, fixed by switching to write back",
    ],
    correctIndex: 1,
  },
  {
    id: "caching-mcq-3",
    prompt:
      "A row changes in the database and the cached copy must not be served again. Why is deleting the cache key usually safer than writing the new value over it?",
    options: [
      "Deleting is faster than writing in every cache implementation",
      "A delete is idempotent and cannot overwrite a concurrent writer's newer value, whereas an in-place update can",
      "Deleting frees memory that the cache would otherwise never reclaim",
      "An in-place update is not supported by most remote caches",
    ],
    correctIndex: 1,
  },
];

export const cachingFrq: QuizFrq[] = [
  {
    id: "caching-frq-1",
    prompt:
      "Explain the difference between cache aside and read through, and give one reason a team might pick each.",
    rubric: [
      "Cache aside: the application checks the cache, and on a miss reads the database and populates the cache itself. The application owns the policy.",
      "Read through: the caller only talks to the cache, and the cache client loads from the database on a miss. The loading logic lives in one place.",
      "A reason for cache aside: it is simple, and the system keeps working if the cache is unavailable because the application can still read the database.",
      "A reason for read through: callers cannot forget to populate the cache, and the loading path is consistent across every caller.",
    ].join("\n"),
  },
  {
    id: "caching-frq-2",
    prompt:
      "Compare write through, write back and write around. For each, state what it costs and when you would choose it.",
    rubric: [
      "Write through writes the cache and the database together: the cache is never stale, but every write pays both latencies and may cache data nobody reads.",
      "Write back writes only the cache and flushes later: writes are very fast, but a node failure before the flush loses data, so it suits only workloads that tolerate losing recent writes.",
      "Write around writes straight to the database: the cache is not polluted with write-once data, at the cost of a guaranteed miss on the first read.",
      "The choice follows the read/write mix and the tolerance for staleness and data loss.",
    ].join("\n"),
  },
  {
    id: "caching-frq-3",
    prompt:
      "A TTL and explicit invalidation both bound how stale a cached value can be. Describe the trade-off, and explain when you would use each.",
    rubric: [
      "A TTL bounds staleness by time and needs no coordination: it is simple and self-healing, but the value can be wrong for up to the TTL.",
      "Explicit invalidation deletes the key when the data changes: it is precise and immediate, but every write path has to know every key it affects.",
      "A missed invalidation leaves a value wrong indefinitely, which is why invalidation is fragile in a system with many write paths.",
      "They are commonly combined: invalidate on the paths you know about, and keep a TTL as the backstop for the ones you forgot.",
    ].join("\n"),
  },
  {
    id: "caching-frq-4",
    prompt:
      "Explain what a cache stampede is, why jittering TTLs helps, and name one other mitigation.",
    rubric: [
      "A stampede is many concurrent requests missing on the same key at the same moment, usually right after that key expires, so all of them hit the database together.",
      "Uniform TTLs make many keys expire in lockstep, so adding random jitter spreads expiries out over time and flattens the load spike.",
      "Another mitigation: a lock or single-flight so only one request rebuilds the value while the others wait for it.",
      "Another mitigation: serve the stale value while a background refresh runs, or refresh shortly before expiry.",
    ].join("\n"),
  },
  {
    id: "caching-frq-5",
    prompt:
      "A service keeps an in-process cache on each of its twenty application servers. What problems does that create compared with one shared Redis cache, and what does it buy you?",
    rubric: [
      "Each server has its own copy, so the same value is loaded twenty times and the effective hit rate is lower for the same total memory.",
      "The copies can disagree, and an invalidation has to reach every server rather than one place, so staleness is harder to reason about.",
      "Every deploy or restart leaves a cold cache on that server, briefly pushing load onto the database.",
      "What it buys: no network hop and no extra dependency, so lookups are far faster and there is no shared cache to fail or to scale.",
    ].join("\n"),
  },
];
