import type { QuizFrq, QuizMcq } from "../types";

export const consistentHashingMcq: QuizMcq[] = [
  {
    id: "consistent-hashing-mcq-1",
    prompt:
      "A cache pool shards keys with hash(key) % N. A fifth server is added to a pool of four. Roughly what share of keys now map to a different server?",
    options: ["About a fifth", "About a half", "About four fifths", "None, modulo sharding is stable"],
    correctIndex: 2,
  },
  {
    id: "consistent-hashing-mcq-2",
    prompt: "What problem do virtual nodes solve on a hash ring?",
    options: [
      "They let the ring survive a hash collision between two node names",
      "Hashing each node to a single point divides the circle into very uneven arcs, so load is lopsided and a departing node dumps its whole share on one neighbour",
      "They remove the need for every client to agree on ring membership",
      "They replicate each key onto several machines for durability",
    ],
    correctIndex: 1,
  },
  {
    id: "consistent-hashing-mcq-3",
    prompt:
      "One key in a consistently hashed cache is read a million times a second and its node is saturated. What does consistent hashing do about it?",
    options: [
      "It rebalances the ring so the hot key moves to a less busy node",
      "It splits the key across several nodes automatically",
      "Nothing. It balances keys, not load, so a hot key needs replication or a cache in front of the ring",
      "It adds virtual nodes for the hot key until the load evens out",
    ],
    correctIndex: 2,
  },
];

export const consistentHashingFrq: QuizFrq[] = [
  {
    id: "consistent-hashing-frq-1",
    prompt:
      "Explain why modulo sharding breaks when the number of nodes changes, and what consistent hashing does differently.",
    rubric: [
      "hash(key) % N depends on N, so changing N changes the destination of almost every key, not just the keys the new node should own.",
      "Adding a fifth node to four remaps roughly four fifths of the keyspace, which empties a cache or forces a near-total data migration.",
      "Consistent hashing places both nodes and keys on a circle, and a key belongs to the first node clockwise from it.",
      "Because only one arc changes owner, only the keys in that arc move: roughly K over N rather than nearly all of them.",
    ].join("\n"),
  },
  {
    id: "consistent-hashing-frq-2",
    prompt:
      "What are virtual nodes, and what two separate problems do they fix? Mention what they give you for free.",
    rubric: [
      "Each physical node is hashed to many points on the ring (for example node-a-0 through node-a-149) instead of one.",
      "Problem one: a few random points divide a circle into very uneven arcs, so one node can own a large share of the keyspace.",
      "Problem two: when a node leaves, a single point means its whole share lands on one neighbour, which can cascade the failure.",
      "For free: weighting. A bigger machine gets proportionally more markers and therefore more keys.",
    ].join("\n"),
  },
  {
    id: "consistent-hashing-frq-3",
    prompt:
      "A node is removed from a ring of five. Describe exactly which keys move and where they go, and which keys do not move.",
    rubric: [
      "Only the keys that the departing node owned move. Every other key keeps its owner.",
      "Each of those keys falls through to the next node clockwise from its position on the ring.",
      "With virtual nodes the departing node's many small arcs are absorbed by many different neighbours rather than one.",
      "The share that moves is roughly the share that node was holding, about one fifth here, not the whole keyspace.",
    ].join("\n"),
  },
  {
    id: "consistent-hashing-frq-4",
    prompt:
      "Name two things consistent hashing does not solve, and say what you would do about each.",
    rubric: [
      "Hot keys: the ring balances keys, not requests, so a single popular key still lands on one node. Replicate it, or put a small cache in front of the ring.",
      "Membership agreement: clients that disagree about which nodes exist route the same key to different places, causing duplicate work or lost writes. Membership needs a coordination service, gossip, or a configuration everyone reloads.",
      "Replication and durability: the ring only gives an ordering, so placing a key on the next R distinct physical nodes is a separate decision layered on top.",
      "Any two of these, with a concrete mitigation, is a full answer.",
    ].join("\n"),
  },
  {
    id: "consistent-hashing-frq-5",
    prompt:
      "You are sharding a key-value store across machines that will be added and removed regularly. Walk through how a read is routed and what happens on a node join.",
    rubric: [
      "Hash the key to a position on the ring and walk clockwise to the first virtual node; that marker maps back to a physical machine, which serves the read.",
      "On a join, the new node's markers are placed on the ring, taking over the arcs immediately preceding each of them.",
      "Only the keys in those arcs are copied from their previous owners to the new node; every other key stays put.",
      "Routing must stay stable while that happens, so either the move completes before the ring change is published, or reads fall back to the previous owner until it does.",
    ].join("\n"),
  },
];
