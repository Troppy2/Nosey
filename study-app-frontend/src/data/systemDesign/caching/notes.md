# Caching

A cache is a small, fast store that sits in front of a slower one and answers
the requests it can. That is the whole idea. Everything else about caching is
consequence: what to keep, how long to keep it, what to do when it is wrong, and
what happens the moment it disappears.

## Why a cache is worth the trouble

Systems are built out of layers with wildly different speeds. Reading a value
from memory takes tens of nanoseconds. Reading it from a local SSD takes tens of
microseconds. Reading it from a database across the network, after that database
has parsed your query, walked an index and serialized a result, can take
milliseconds. The gap between those numbers is not a detail you can optimize
away with better code, it is a property of the hardware, so the only way to beat
it is to not make the slow call at all.

Caching also buys you headroom. A read that never reaches the database is a read
the database never has to plan, lock or serve. In a read-heavy system, where the
same handful of rows are requested far more often than anything else, a cache
with a modest hit rate can absorb the large majority of traffic. That is often
the difference between one database and a fleet of replicas.

The price is that you now have two copies of the truth, and the second one is
allowed to be wrong.

## Where caches live

At the edge, a CDN keeps static assets near the user, so the request never
crosses an ocean. In the browser, the HTTP cache keeps responses the server
marked as reusable. In your own process, an in-memory map keeps recently used
values with zero network cost, at the price of being per-instance: ten app
servers means ten separate caches, ten separate warmups, and ten chances to
disagree. A shared remote cache such as Redis or Memcached fixes that by giving
every instance one view, paying a network hop for it. Finally the database keeps
its own buffer pool, caching pages it has read recently.

None of these replace the others. A mature system usually has all of them, and
the interesting failures happen at the seams.

## Read patterns

**Cache aside** is the most common. The application asks the cache. On a miss it
reads the database, writes the value into the cache, and returns it. The cache
is a dumb store and the application owns the policy. It is simple, it tolerates
a cache outage, and it has one notorious flaw: every miss is a database read, so
a burst of misses becomes a burst of database load.

**Read through** hides that behind the cache client. The caller only ever asks
the cache, and the cache loads from the database on a miss. It is the same
sequence of operations with better ergonomics and one place to put the loading
logic.

## Write patterns

**Write through** writes to the cache and the database together, so the cache is
never stale. The write pays both latencies, and you have cached data that may
never be read.

**Write back** writes only to the cache and flushes to the database later. Writes
become very fast, and a node failure before the flush loses data. Use it only
where losing the last few seconds is acceptable.

**Write around** writes straight to the database and lets the value be cached on
the next read. It avoids polluting the cache with write-once data, at the cost
of one guaranteed miss.

## Eviction

A cache is finite, so something has to leave. LRU evicts the least recently used
entry and is the usual default, because recency is a decent guess at future use.
LFU evicts the least frequently used one, which survives a scan better but is
slower to adapt when access patterns change. FIFO evicts the oldest insertion and
ignores use entirely, which is cheap and often worse. Random eviction is
surprisingly competitive and trivial to implement.

The real lever is usually not the policy, it is the size. A cache that holds the
working set has a high hit rate under almost any policy. A cache that is too
small thrashes under all of them.

## Staleness and invalidation

Every cached value is a claim about the past. A TTL bounds how wrong it can be:
after the TTL expires the entry is dropped and the next reader pays for a fresh
one. It is the blunt tool, and it is the right tool far more often than people
expect, because it needs no coordination.

Explicit invalidation deletes the key when the underlying data changes. It is
precise and it is fragile: every write path has to remember every key it
affects, and one forgotten path is a value that stays wrong until something else
evicts it. Prefer deleting the key over updating it in place, because a delete is
idempotent and cannot lose a concurrent write.

## The failure modes worth knowing

A **stampede**, sometimes called a dogpile, happens when a hot key expires and
every waiting request misses at the same instant, so all of them hit the database
together. The fixes are to let one request rebuild the value while the others
wait or serve the stale copy, and to jitter the TTLs so keys do not expire in
lockstep.

**Cache penetration** is repeated lookups for a key that does not exist anywhere,
so every request falls through. Cache the negative result, briefly.

A **cold cache** is the state right after a restart or deploy: the hit rate is
zero and the database briefly carries the full load. Systems that depend on a
warm cache to survive normal traffic are systems that cannot be restarted
safely, which is worth knowing before you find out.

The instinct to reach for is this. A cache is an optimization, not a component
your correctness may depend on. If turning it off takes the system down, you do
not have a cache, you have an undocumented database.
