"""Curated two-level KojoCode taxonomy: big topic (category id) -> the finer
subtopics (techniques) that live under it.

The backend owns no problem catalog, so this is the ONLY place the backend knows
the allowed subtopic vocabulary. It exists so the LLM (custom-problem generation,
daily reskin, and the classify-only backfill) always labels a problem with a
subtopic drawn from a fixed set, instead of free text that would fragment the
weakness signal ("BFS" vs "Breadth First Search" vs "breadth-first").

IMPORTANT: keep this in sync with the frontend copy, SUBTOPICS_BY_TOPIC in
study-app-frontend/src/pages/LeetCodeMode.tsx. The keys are the frontend category
ids (toId(label)), e.g. "tree", "dp", "graph" (not "trees"/"dynamic-programming").
"""
from __future__ import annotations

# topic id (the frontend category id) -> the official LeetCode subtags allowed under it.
# Sourced from LeetCode's own topic tags, provided by the product owner. The keys are the
# catalog category ids (toId of the category label): "dp", "graph", "hash-table", etc.
SUBTOPICS_BY_TOPIC: dict[str, list[str]] = {
    "arrays": [
        "Two Pointers", "Prefix Sum", "Sliding Window", "Sorting", "Matrix",
        "Counting Sort", "Radix Sort", "Merge Sort", "Quickselect",
    ],
    "strings": [
        "Two Pointers", "String Matching", "Sliding Window", "Rolling Hash",
        "Hash Function", "Trie", "Suffix Array", "KMP Algorithm",
    ],
    "hash-table": ["Counting", "Bucket Sort", "Rolling Hash", "Hash Function", "Ordered Set", "Ordered Map", "Design"],
    "linked-list": ["Doubly-Linked List", "Two Pointers", "Recursion"],
    "stack": ["Monotonic Stack", "Queue", "Design"],
    "heap-priority-queue": ["Sorting", "Simulation", "Greedy", "Merge Sort"],
    "tree": [
        "Binary Tree", "Binary Search Tree", "Depth-First Search", "Breadth-First Search",
        "Tree Multi-set", "Euler Tour Technique", "Union Find", "Divide and Conquer",
    ],
    "binary-search": ["Two Pointers", "Divide and Conquer", "Interactive"],
    "sliding-window": ["Two Pointers", "Array", "String", "Hash Table"],
    "dp": ["Memoization", "Bitmask", "Divide and Conquer", "Bit Manipulation", "Combinatorics"],
    "backtracking": ["Depth-First Search", "Recursion"],
    "graph": [
        "Depth-First Search", "Breadth-First Search", "Shortest Path", "Union Find",
        "Topological Sort", "Minimum Spanning Tree", "Eulerian Circuit", "Bipartite Graph",
        "Strongly Connected Component", "Tarjan's Algorithm", "Dijkstra's Algorithm",
    ],
    "design": ["Data Stream", "Object-Oriented Programming", "Concurrency"],
    "advanced": ["Trie", "Segment Tree", "Binary Indexed Tree", "Union Find", "Suffix Array", "Line Sweep"],
    "math": [
        "Geometry", "Combinatorics", "Number Theory", "Game Theory",
        "Probability and Statistics", "Randomized", "Brainteaser",
    ],
    "bit-manipulation": ["Bitmask"],
    "intervals": ["Array", "Line Sweep", "Ordered Set"],
    "extra": ["Greedy", "Matrix", "Simulation", "Recursion", "Brainteaser", "Shell", "Database"],
}

# Flat, de-duped union of every subtopic, for prompts where the topic is unknown
# (the model infers the topic itself, so it needs the whole menu to choose from).
ALL_SUBTOPICS: list[str] = sorted({s for subs in SUBTOPICS_BY_TOPIC.values() for s in subs})


def subtopics_for(topic: str | None) -> list[str]:
    """Allowed subtopics for a topic id, or the full union when the topic is
    unknown / not in the map (so the caller still gets a menu to constrain to)."""
    if not topic:
        return ALL_SUBTOPICS
    return SUBTOPICS_BY_TOPIC.get(topic.strip().lower(), ALL_SUBTOPICS)


# The catalog category ids the taxonomy covers, and a lowercase lookup so a topic
# returned by the LLM only counts if it's a REAL catalog category (not invented).
TOPIC_IDS: frozenset[str] = frozenset(SUBTOPICS_BY_TOPIC.keys())
_TOPIC_BY_LOWER = {t.lower(): t for t in SUBTOPICS_BY_TOPIC}
# Also map the human labels (with spaces) that the model sometimes returns instead of
# the id, e.g. "Dynamic Programming" -> "dp", "Hash Table" -> "hash-table".
_TOPIC_LABEL_ALIASES = {
    "array": "arrays",
    "string": "strings",
    "hash table": "hash-table",
    "hash map": "hash-table",
    "linked list": "linked-list",
    "heap": "heap-priority-queue",
    "priority queue": "heap-priority-queue",
    "heap (priority queue)": "heap-priority-queue",
    "heap / priority queue": "heap-priority-queue",
    "trees": "tree",
    "binary search": "binary-search",
    "sliding window": "sliding-window",
    "dynamic programming": "dp",
    "graphs": "graph",
    "advanced data structures": "advanced",
    "bit manipulation": "bit-manipulation",
    "general algorithms": "extra",
}


def canonical_topic(topic: str | None) -> str | None:
    """Snap an LLM-returned topic to a real catalog category id, or None if it isn't
    one. Accepts the id directly (any case) or a common human label; everything else
    (invented topics like "greedy-strings") is rejected so the backfill never writes
    a topic that isn't in the catalog."""
    if not topic:
        return None
    key = topic.strip().lower()
    if key in _TOPIC_BY_LOWER:
        return _TOPIC_BY_LOWER[key]
    return _TOPIC_LABEL_ALIASES.get(key)


def canonical_subtopic(topic: str | None, subtopic: str | None) -> str | None:
    """Snap an LLM-returned subtopic to one of the allowed subtopics for the given
    (already-canonical) topic, matched case-insensitively so casing drift doesn't
    fragment the signal. None if it isn't a valid subtopic for that topic."""
    if not topic or not subtopic:
        return None
    wanted = subtopic.strip().lower()
    for allowed in SUBTOPICS_BY_TOPIC.get(topic, ()):
        if allowed.lower() == wanted:
            return allowed
    return None
