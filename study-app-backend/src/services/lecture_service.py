"""Kojo pattern lectures: the curated catalog and the lecture normalizer.

A lecture teaches one DSA pattern in four chapters, played by the walkthrough player:
1. Theory: spoken lines with on-screen points, plus an ink sketch of the idea.
2. Spot it: the signals in a problem statement that point at this pattern.
3. Template: a generic Python template typed line by line.
4. Walkthrough: one KojoCode catalog problem solved with the pattern (ink + code).

Lectures are shared by every user and written by an admin's MCP connector; Nosey's
own LLM is never called. normalize_lecture() is the single gate: it trims, caps and
lays out the ink (same whiteboard cleanup as walkthroughs) before anything is saved.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from src.services.solution_walkthrough import SAY_CHARS, _text, normalize_sketch

MAX_THEORY = 6
MAX_SIGNALS = 5
MAX_PROBLEM_INTRO = 4
MAX_TEMPLATE_LINES = 40
MAX_CODE_LINES = 80
POINT_CHARS = 120


@dataclass(frozen=True)
class CatalogLecture:
    slug: str
    category: str  # KojoCode category / topic id
    title: str
    problem_slug: str  # the worked example, a built-in catalog problem


CATALOG: tuple[CatalogLecture, ...] = (
    CatalogLecture("prefix-sum", "arrays", "Prefix Sums", "subarray-sum-equals-k"),
    CatalogLecture("kadane", "arrays", "Kadane's Algorithm", "maximum-subarray"),
    CatalogLecture("hash-map-counting", "hash-table", "Hash Map Counting", "group-anagrams"),
    CatalogLecture("bucket-sort", "hash-table", "Bucket Sort by Frequency", "top-k-frequent-elements"),
    CatalogLecture("two-pointers-opposite", "arrays", "Two Pointers: Opposite Ends", "container-with-most-water"),
    CatalogLecture("fast-slow-pointers", "linked-list", "Fast and Slow Pointers", "linked-list-cycle"),
    CatalogLecture("linked-list-reversal", "linked-list", "Linked List Reversal", "reverse-linked-list"),
    CatalogLecture("sliding-window-variable", "sliding-window", "Sliding Window: Variable Size",
                   "longest-substring-without-repeating-characters"),
    CatalogLecture("sliding-window-counts", "sliding-window", "Sliding Window with Counts", "longest-repeating-character-replacement"),
    CatalogLecture("stack-saving-state", "stack", "Stack: Saving State (Nesting and Pairs)",
                   "remove-all-adjacent-duplicates-in-string-ii"),
    CatalogLecture("monotonic-stack", "stack", "Monotonic Stack", "daily-temperatures"),
    CatalogLecture("monotonic-deque", "sliding-window", "Monotonic Deque", "sliding-window-maximum"),
    CatalogLecture("matrix-layers", "math", "Matrix Traversal and Layers", "spiral-matrix"),
    CatalogLecture("binary-search-index", "binary-search", "Binary Search on an Index", "search-a-2d-matrix"),
    CatalogLecture("binary-search-answer", "binary-search", "Binary Search on the Answer", "koko-eating-bananas"),
    CatalogLecture("tree-dfs", "tree", "Tree DFS (Recursion)", "maximum-depth-of-binary-tree"),
    CatalogLecture("tree-bfs", "tree", "Tree BFS: Level Order", "binary-tree-right-side-view"),
    CatalogLecture("bst-inorder", "tree", "BST Properties and Inorder", "kth-smallest-element-in-a-bst"),
    CatalogLecture("heap-basics", "heap-priority-queue", "Heaps: Min-Heap and Max-Heap", "last-stone-weight"),
    CatalogLecture("top-k-heap", "heap-priority-queue", "Top K with a Heap", "kth-largest-element-in-an-array"),
    CatalogLecture("two-heaps", "heap-priority-queue", "Two Heaps (Running Median)", "find-median-from-data-stream"),
    CatalogLecture("backtracking-subsets", "backtracking", "Backtracking: Subsets", "subsets"),
    CatalogLecture("backtracking-permutations", "backtracking", "Backtracking: Permutations", "permutations"),
    CatalogLecture("grid-dfs-bfs", "graph", "Grid DFS and BFS", "number-of-islands"),
    CatalogLecture("multi-source-bfs", "graph", "Multi-Source BFS", "rotting-oranges"),
    CatalogLecture("topological-sort", "graph", "Topological Sort", "course-schedule"),
    CatalogLecture("union-find", "graph", "Union Find (Disjoint Set)", "redundant-connection"),
    CatalogLecture("dijkstra", "graph", "Dijkstra's Shortest Path", "network-delay-time"),
    CatalogLecture("minimum-spanning-tree", "graph", "Minimum Spanning Tree (Prim's)", "min-cost-to-connect-all-points"),
    CatalogLecture("trie", "advanced", "Tries (Prefix Trees)", "implement-trie-prefix-tree"),
    CatalogLecture("dp-1d", "dp", "1D Dynamic Programming", "min-cost-climbing-stairs"),
    CatalogLecture("dp-2d-grid", "dp", "2D Grid DP", "unique-paths"),
    CatalogLecture("dp-two-strings", "dp", "DP on Two Strings", "longest-common-subsequence"),
    CatalogLecture("dp-knapsack", "dp", "0/1 Knapsack", "partition-equal-subset-sum"),
    CatalogLecture("dp-unbounded", "dp", "Unbounded Knapsack", "coin-change"),
    CatalogLecture("lis", "dp", "Longest Increasing Subsequence", "longest-increasing-subsequence"),
    CatalogLecture("merge-intervals", "intervals", "Merging Intervals", "non-overlapping-intervals"),
    CatalogLecture("bit-tricks", "bit-manipulation", "Bit Manipulation Tricks", "single-number"),
)
CATALOG_BY_SLUG = {c.slug: c for c in CATALOG}

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,118}$")


def normalize_topic(text: str) -> str:
    """Dedup key for topic requests: 'Dijkstra's algorithm' and 'dijkstras' match."""
    words = re.sub(r"[^a-z0-9 ]+", "", text.lower().replace("'", "")).split()
    stop = {"algorithm", "algorithms", "the", "a", "an", "pattern", "technique", "lecture", "on", "of"}
    return " ".join(w.rstrip("s") for w in words if w not in stop)[:120]


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:118] or "lecture"


def _said(items: Any, limit: int, keys: tuple[str, ...]) -> list[dict[str, str]]:
    out = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        row = {k: _text(item.get(k), SAY_CHARS if k == "say" else POINT_CHARS) for k in keys}
        if row.get("say"):
            out.append(row)
    return out[:limit]


def _code(items: Any, limit: int) -> list[dict[str, str]]:
    code = []
    for item in items or []:
        if isinstance(item, dict) and isinstance(item.get("line"), str):
            code.append({"line": item["line"].rstrip()[:300], "say": _text(item.get("say"), SAY_CHARS)})
    code = code[:limit]
    while code and not code[0]["line"].strip():
        code.pop(0)
    while code and not code[-1]["line"].strip():
        code.pop()
    return code


def normalize_lecture(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "title": _text(data.get("title"), 160),
        "summary": _text(data.get("summary"), 400),
        "theory": _said(data.get("theory"), MAX_THEORY, ("say", "point")),
        "theory_frames": normalize_sketch({"frames": data.get("theory_frames") or []}),
        "signals": _said(data.get("signals"), MAX_SIGNALS, ("signal", "example", "say")),
        "template": _code(data.get("template"), MAX_TEMPLATE_LINES),
        "problem_intro": _said(data.get("problem_intro"), MAX_PROBLEM_INTRO, ("say", "point")),
        "frames": normalize_sketch({"frames": data.get("frames") or []}),
        "code": _code(data.get("code"), MAX_CODE_LINES),
        "time_complexity": _text(data.get("time_complexity"), 40),
        "space_complexity": _text(data.get("space_complexity"), 40),
        "complexity_say": _text(data.get("complexity_say"), SAY_CHARS),
    }


def lecture_problems(lecture: dict[str, Any]) -> list[str]:
    """What a lecture still lacks to play well. Empty means publishable."""
    issues = []
    if not lecture["title"]:
        issues.append("title is empty")
    if len(lecture["theory"]) < 2:
        issues.append("theory needs at least 2 lines (each with say and point)")
    if not lecture["theory_frames"]:
        issues.append("theory_frames needs at least 1 frame with strokes or labels")
    if len(lecture["signals"]) < 2:
        issues.append("signals needs at least 2 entries (signal, example, say)")
    if len([c for c in lecture["template"] if c["line"].strip()]) < 3:
        issues.append("template needs at least 3 code lines")
    if not lecture["problem_intro"]:
        issues.append("problem_intro needs at least 1 line")
    if not lecture["frames"]:
        issues.append("frames needs at least 1 frame for the worked problem")
    if len([c for c in lecture["code"] if c["line"].strip()]) < 3:
        issues.append("code needs at least 3 lines")
    return issues


def relayout_lecture(lecture: dict[str, Any]) -> dict[str, Any]:
    """Re-run the ink cleanup when serving (idempotent), like walkthroughs."""
    for key in ("theory_frames", "frames"):
        if isinstance(lecture.get(key), list):
            lecture[key] = normalize_sketch({"frames": lecture[key]})
    return lecture


def spoken_lines(lecture: dict[str, Any]) -> set[str]:
    """Every line the player speaks for this lecture (mirrors buildLectureTimeline in
    walkthroughTimeline.ts). The audio route records only exact members of this set,
    so it cannot be used as free text-to-speech."""
    lines = {f"Let's learn {lecture.get('title', '')}."}
    for key in ("theory", "signals", "problem_intro", "template", "code"):
        lines |= {item.get("say", "") for item in lecture.get(key) or []}
    for key in ("theory_frames", "frames"):
        lines |= {f.get("say", "") for f in lecture.get(key) or []}
    lines.add(lecture.get("complexity_say") or
              f"Time {lecture.get('time_complexity', '')}, space {lecture.get('space_complexity', '')}.")
    return {line.strip() for line in lines if line and line.strip()}
