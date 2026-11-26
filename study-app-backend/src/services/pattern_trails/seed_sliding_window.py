"""The reference topic for Pattern Trails: Sliding window (spec section 9).

All four paths are defined in full. `content.upsert_topic` skips any problem that
is not in the built-in catalog yet and reports it, so seeding today fills in what
exists and seeding again after the missing problems are added completes the rest.

Run from study-app-backend:  python -m src.services.pattern_trails.seed_sliding_window
"""
from __future__ import annotations

import asyncio
import json

from src.services.pattern_trails.content import TopicIn

FIXED_TEMPLATE = """total = sum(a[:k])
best = total
for right in range(k, len(a)):
    total += a[right] - a[right - k]   # slide: add one, drop one
    best = max(best, total)"""

SHORTEST_TEMPLATE = """left = 0
for right in range(len(a)):
    add(a[right])
    while valid():                     # shrink while it still holds
        best = min(best, right - left + 1)
        remove(a[left]); left += 1"""

LONGEST_TEMPLATE = """left = 0
for right in range(len(a)):
    add(a[right])
    while not valid():                 # shrink only to repair it
        remove(a[left]); left += 1
    best = max(best, right - left + 1)"""

COUNTING_TEMPLATE = """left = 0; count = 0
for right in range(len(a)):
    add(a[right])
    while not valid():
        remove(a[left]); left += 1
    count += right - left + 1          # every window ending here counts"""

SLIDING_WINDOW = {
    "slug": "sliding-window",
    "title": "Sliding window",
    "sort_order": 2,
    "icon_key": "sliding-window",
    "subtopics": [
        {
            "slug": "fixed-window",
            "title": "Fixed window",
            "summary": "The size never changes: add one on the right, drop one on the left.",
            "cues": [
                "The question names a size k: every k elements, every window of length k.",
                "You want a sum, a count or a maximum over each window of that size.",
                "Recomputing each window from scratch would repeat almost all of the work.",
            ],
            "template_code": FIXED_TEMPLATE,
            "steps": [
                {"problem_slug": "maximum-average-subarray-i"},
                {"problem_slug": "find-all-anagrams-in-a-string"},
                {"problem_slug": "permutation-in-string"},
                {"problem_slug": "maximum-points-you-can-obtain-from-cards"},
                {"problem_slug": "sliding-window-maximum"},
            ],
        },
        {
            "slug": "shortest-valid-window",
            "title": "Shortest valid window",
            "summary": "Grow the window until it is valid, then shrink it as far as you can.",
            "cues": [
                "The question asks for the shortest or smallest contiguous stretch.",
                "A condition can be checked from counts as the window grows.",
                "Once the window is valid, removing from the left can only help.",
            ],
            "template_code": SHORTEST_TEMPLATE,
            "steps": [
                {"problem_slug": "minimum-size-subarray-sum"},
                {"problem_slug": "minimum-operations-to-reduce-x-to-zero"},
                {"problem_slug": "minimum-window-substring"},
                {"problem_slug": "shortest-subarray-with-sum-at-least-k"},
                {"problem_slug": "smallest-range-covering-elements-from-k-lists"},
            ],
        },
        {
            "slug": "counting-subarrays",
            "title": "Counting subarrays",
            "summary": "Count every window that works: each right end adds as many as its valid left ends.",
            "cues": [
                "The question asks how many subarrays satisfy a condition, not the best one.",
                "Extending a valid window keeps it valid in one direction (a product stays under k).",
                "A window of length L ending at right adds L new subarrays to the count.",
            ],
            "template_code": COUNTING_TEMPLATE,
            "steps": [
                {"problem_slug": "subarray-product-less-than-k"},
                {"problem_slug": "number-of-substrings-containing-all-three-characters"},
                {"problem_slug": "binary-subarrays-with-sum"},
                {"problem_slug": "count-number-of-nice-subarrays"},
                {"problem_slug": "subarrays-with-k-different-integers"},
            ],
        },
        {
            "slug": "longest-valid-window",
            "title": "Longest valid window",
            "summary": "Keep the window valid and remember the longest one you ever held.",
            "cues": [
                "The question asks for the longest contiguous stretch with a property.",
                "Adding on the right may break the property, and removing on the left repairs it.",
                "Duplicates, a budget of changes, or a limit on distinct values bound the window.",
            ],
            "template_code": LONGEST_TEMPLATE,
            "steps": [
                {"problem_slug": "longest-substring-without-repeating-characters"},
                {"problem_slug": "longest-repeating-character-replacement"},
                {"problem_slug": "max-consecutive-ones-iii"},
                {"problem_slug": "fruit-into-baskets"},
                {"problem_slug": "frequency-of-the-most-frequent-element"},
            ],
        },
    ],
    # The recognition gate pool. Own items point at a path; the rest are distractors
    # with their own pattern, so a wrong pick is a real mix-up (spec section 4).
    "gate_items": [
        {
            "problem_slug": "find-all-anagrams-in-a-string",
            "right_subtopic_slug": "fixed-window",
            "cue": "Every window has the same length as the pattern, so slide a fixed-size window.",
        },
        {
            "problem_slug": "maximum-points-you-can-obtain-from-cards",
            "right_subtopic_slug": "fixed-window",
            "cue": "You take k cards from the ends: that is a fixed window of the cards you leave.",
        },
        {
            "problem_slug": "minimum-size-subarray-sum",
            "right_subtopic_slug": "shortest-valid-window",
            "cue": "Shortest contiguous piece, all positive: growing only raises the sum, so shrinking is safe.",
        },
        {
            "problem_slug": "minimum-window-substring",
            "right_subtopic_slug": "shortest-valid-window",
            "cue": "Smallest window that still holds every needed character: grow, then shrink while valid.",
        },
        {
            "problem_slug": "subarray-product-less-than-k",
            "right_subtopic_slug": "counting-subarrays",
            "cue": "It counts subarrays, and each right end adds one new subarray per valid left end.",
        },
        {
            "problem_slug": "longest-substring-without-repeating-characters",
            "right_subtopic_slug": "longest-valid-window",
            "cue": "Longest stretch with no repeat: shrink only to repair the window, keep the best length.",
        },
        {
            "problem_slug": "longest-repeating-character-replacement",
            "right_subtopic_slug": "longest-valid-window",
            "cue": "Longest window you can fix with at most k changes: a budget bounds the window.",
        },
        {
            "problem_slug": "continuous-subarray-sum",
            "right_pattern_key": "prefix-sum",
            "right_pattern_title": "Prefix sums",
            "cue": "It asks about a sum modulo k, and values can be negative or zero, so a window cannot shrink safely. Use prefix sums.",
        },
        {
            "problem_slug": "two-sum-ii-input-array-is-sorted",
            "right_pattern_key": "two-pointers",
            "right_pattern_title": "Two pointers",
            "cue": "The array is sorted and you want a pair: move a pointer from each end toward the middle.",
        },
        {
            "problem_slug": "koko-eating-bananas",
            "right_pattern_key": "binary-search",
            "right_pattern_title": "Binary search on the answer",
            "cue": "You are searching for the smallest speed that works, and feasibility only flips once.",
        },
    ],
}


def topic() -> TopicIn:
    return TopicIn.model_validate(SLIDING_WINDOW)


async def seed() -> dict:
    from src.database import async_session_maker
    from src.services.pattern_trails.content import upsert_topic

    async with async_session_maker() as session:
        return (await upsert_topic(session, topic())).as_dict()


if __name__ == "__main__":
    print(json.dumps(asyncio.run(seed()), indent=2))
