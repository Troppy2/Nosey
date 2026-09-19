# Consistent Hashing

You have more data than one machine can hold, so you split it across several.
The only question that matters is: given a key, which machine owns it? Every
answer to that question is a sharding scheme, and consistent hashing is the one
that survives the machines changing.

## The obvious answer, and why it fails

Number the machines 0 to N-1 and send each key to `hash(key) % N`. This is
simple, it is fast, and the distribution is excellent. It is also the wrong
answer, and the reason is what makes this topic worth a page.

Add one machine. N goes from 4 to 5, so `hash(key) % 4` becomes
`hash(key) % 5`, and almost every key now maps somewhere else. Not some keys.
Roughly four out of five of them. If those machines are a cache, you have just
invalidated nearly the entire cache and handed the database the full read load
at the exact moment you were trying to add capacity. If they are a database, you
have just scheduled a migration of nearly all your data.

The same thing happens when a machine fails, which is not a thing you schedule.

So the requirement is not "spread keys evenly". It is "spread keys evenly, and
when the set of machines changes, move as few keys as possible".

## The ring

Consistent hashing gets there by hashing the machines too.

Picture the output of your hash function bent into a circle, from zero round to
the maximum value and back to zero. Hash each node's name and place it at that
point on the circle. Hash each key and place it on the circle the same way. A key
belongs to the first node you meet walking clockwise from where the key landed.

Now add a node. It lands at one point on the circle, and it takes over only the
keys that sit between the previous node and itself. Everything else is untouched.
Remove a node and its keys fall through to the next node clockwise, and again,
nothing else moves. In both cases the number of keys that move is roughly
K over N: the share that one node was holding, not the whole keyspace.

That is the entire idea. The rest is making it work in practice.

## Virtual nodes

Hashing three node names gives you three effectively random points on a circle,
and three random points do not divide a circle into three equal arcs. One node
can easily end up owning half the keyspace while another owns a tenth. Worse,
when a node leaves, its entire share lands on exactly one neighbour, which is a
very good way to turn one failure into two.

The fix is to place each node at many points instead of one. Hash
`node-a-0`, `node-a-1`, up through `node-a-149`, and put a marker at each. These
markers are virtual nodes, or vnodes, and they all point back to the same
physical machine. With a hundred or so markers per node the arcs average out and
the distribution gets close to even. When a node leaves, its many small arcs are
absorbed by many different neighbours instead of one.

Virtual nodes also give you weighting for free. A machine with twice the memory
gets twice the markers and therefore roughly twice the keys.

## What it does not solve

Consistent hashing balances keys, not load. If one key is read a million times a
second, the ring will faithfully send all million requests to a single node.
That is a hot key, and the answers are elsewhere: replicate the key across
several nodes, or put a small cache in front of the ring.

It also assumes every participant agrees on the ring. If two clients disagree
about which nodes exist, they will route the same key to different places, which
in a cache means duplicate work and in a store means lost writes. Membership has
to come from somewhere trustworthy: a coordination service, a gossip protocol, or
a configuration everyone reloads.

And it says nothing about replication. In a real store you do not place a key on
one node, you place it on the next R distinct physical nodes walking clockwise,
skipping repeat markers of a machine you already picked. Consistent hashing gives
you the ordering. Durability is a separate decision layered on top.

## Where you will meet it

Amazon's Dynamo paper put the ring with virtual nodes in front of a lot of
engineers, and Cassandra and Riak took the design more or less directly.
Memcached clients have used it for years to shard across a pool without a
coordinator. It is the standard answer whenever a system has to redistribute a
keyspace across a changing set of machines.

Two rules of thumb are worth carrying away. First, when someone proposes modulo
sharding, the question to ask is what happens when a node is added or dies, not
whether the distribution is even today. Second, if a design uses a bare ring with
one point per node, ask how the keyspace is actually divided. The answer is
usually worse than anyone expects.
