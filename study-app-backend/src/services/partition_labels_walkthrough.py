"""Authored Partition Labels lesson. Served ahead of older generated caches.

The content uses the player's existing declarative scenes. No generation or DB
mutation is needed, and every request gets fresh data for the layout pass.
"""
from __future__ import annotations

from typing import Any

from src.services.solution_walkthrough import layout_frames


def partition_labels_walkthrough() -> dict[str, Any]:
    def label(x, y, text, color="ink"):
        return {"x": x, "y": y, "text": text, "color": color}

    def stroke(points, color="ink"):
        return {"points": points, "color": color}

    def frame(say, notes, *, text="abacbcde", end=None, cut=None, current=None):
        # Separate rows for indexes, characters, intervals, pointers and notes.
        labels = [label(7 + i * 10, 8, str(i)) for i in range(len(text))]
        labels += [label(7 + i * 10, 19, c) for i, c in enumerate(text)]
        labels += [label(5, 45 + i * 7, note, color) for i, (note, color) in enumerate(notes)]
        strokes = [stroke([4, 23, 4 + len(text) * 10, 23])]
        if end is not None:
            strokes.append(stroke([5, 27, 5, 31, 12 + end * 10, 31, 12 + end * 10, 27], "blue"))
        if cut is not None:
            strokes.append(stroke([14 + cut * 10, 13, 14 + cut * 10, 35], "green"))
        if current is not None:
            x = 9 + current * 10
            strokes += [stroke([x, 39, x, 25], "red"), stroke([x - 2, 28, x, 25, x + 2, 28], "red")]
        return {"say": say, "clear": True, "strokes": strokes, "labels": labels}

    frames = [
        frame(
            "Here are eight characters, indexed zero through seven: a, b, a, c, b, c, d, e. Every occurrence of a letter must belong to one piece. The green line will mark a cut; the blue bracket shows how far our piece must reach. A required boundary is a promise we still have to satisfy, not permission to cut immediately.",
            [("Keep letters together", "ink"), ("Maximize pieces", "green")]),
        frame(
            "Try cutting after index zero. That fails: another a remains at index two, so a would live in two pieces. The first piece must include index two. Every valid answer, even one using a different algorithm, must respect that requirement. Our boundary starts at two because a forces it there. The greedy choice is not an arbitrary guess.",
            [("last[a] = 2", "blue"), ("Cut after 0: invalid", "red")], end=2, current=0),
        frame(
            "Index one is b. Our bracket reaches the last a at two, but b also belongs to this piece. Its last occurrence is four. Cutting at two would separate the two b characters, so we must extend to four. Including a forced us to include b, and b brings another obligation. This chain of obligations is the algorithm's central idea.",
            [("last[b] = 4", "blue"), ("end: 2 -> 4", "red")], end=4, current=1),
        frame(
            "Index two is a again. Its last occurrence is two, but we keep our boundary at four. Moving backward would forget b, which still needs its partner at four. That is why we take the maximum of the existing boundary and this letter's last position. Finishing one letter does not finish the entire partition.",
            [("last[a] = 2", "ink"), ("end stays 4", "blue")], end=4, current=2),
        frame(
            "At index three, c ends at five, so the boundary moves from four to five. Checking only the first letter's last occurrence would miss this. We must inspect every letter pulled into the expanding piece. There is no restart: the scan continues forward while the boundary remembers our farthest obligation.",
            [("last[c] = 5", "blue"), ("end: 4 -> 5", "red")], end=5, current=3),
        frame(
            "Index four is b. We still cannot cut: c at three needs c at five. At index five we meet that last c, and updating the boundary leaves it at five. Now the scan position equals the boundary. Every letter inside this piece has been inspected, and none of its occurrences extends past this ending.",
            [("i = end = 5", "green"), ("abacbc is closed", "green")], end=5, cut=5, current=5),
        frame(
            "Cut after five. The first piece, abacbc, has length six: five minus zero plus one. Both endpoints count. Next, d ends at six, so it forms a one-character piece. E does the same at seven. Our answer is six, one, one. These are lengths, not indexes or substring texts.",
            [("abacbc | d | e", "green"), ("lengths: [6, 1, 1]", "green")], cut=5),
        frame(
            "First, prove safety. After processing i, end is the greatest last occurrence among letters scanned in this piece. If i equals end, every included letter finishes at or before i. None occurs in the remaining suffix, so cutting is valid. We check equality after updating end because the current letter must be included in this evidence.",
            [("i == end: safe cut", "green"), ("No letter crosses it", "blue")], end=5, cut=5),
        frame(
            "Why is this the earliest safe cut? At every earlier scan position, the recorded boundary was farther right. Some included letter still had a later occurrence, so cutting there would split it. The boundary records these witnesses. A last occurrence constrains this piece only because that letter already belongs to it.",
            [("i < end: must wait", "red"), ("A letter crosses cut", "red")], end=5, current=4),
        frame(
            "For optimality, take any valid partitioning whose first cut is later than ours. Insert our cut into its first piece. No letter crosses our cut, so splitting preserves validity and adds a piece. If its first cut matches ours, keep it. Thus an optimal answer must use our first cut. Repeat the argument on the remaining suffix: earliest safe cuts maximize the total number of pieces.",
            [("Insert earliest cut", "green"), ("Repeat on suffix", "blue")], end=5, cut=5),
        frame(
            "For a, b, c, d, every letter is unique. Its last index equals its current index, so we cut on every step and get four lengths of one. Returning the whole string would also keep letters together, but it would miss the optimization requirement. Validity alone is not enough.",
            [("a | b | c | d", "green"), ("[1, 1, 1, 1]", "green")], text="abcd", cut=0, current=0),
        frame(
            "With four copies of a, the first character forces the boundary to three. Every earlier cut leaves a on both sides. We reach three and record one piece of length four. A single character returns length one. Empty input is outside the usual constraints, but our code naturally returns an empty list too.",
            [("aaaa: one piece", "blue"), ("lengths: [4]", "green")], text="aaaa", end=3, cut=3, current=3),
    ]
    code = [
        ("class Solution:", "The platform expects a Solution class. This line supplies that wrapper; the greedy algorithm itself lives in the method below. You do not need to construct an object or read input manually on the coding platform."),
        ("    def partitionLabels(self, s: str) -> list[int]:", "Define partitionLabels with the input string s. The return annotation says we produce a list of integers: the partition lengths. Self is the instance parameter required for a method. The scan will read s without modifying it."),
        ("        last = {}", "Create an empty dictionary called last. It will map each distinct character to its final index in the entire input, not just its latest position in the current partition. We need that future information before making safe cuts."),
        ("        for i, char in enumerate(s):", "Our first pass visits every character with its zero-based index. Enumerate yields pairs such as zero and a, then one and b. This loop builds the information needed by the greedy pass; it does not make any cuts yet."),
        ("            last[char] = i", "Overwrite the character's entry each time it appears. Because indexes arrive in increasing order, the final stored value is its last occurrence. On abacbcde, a finishes at two, b at four, c at five, d at six, and e at seven."),
        ("        sizes = []", "Create the result list. Each time we prove a partition is closed, we append its length. Keeping this separate from the dictionary matters: the dictionary describes the input, while sizes describes the answer accumulated so far."),
        ("        start = 0", "Start marks the first index of the current unfinished piece. Initially that is zero. Once we make a cut, start moves to the following character. It stays unchanged while the boundary expands, so we can calculate the entire piece's length."),
        ("        end = 0", "End holds the farthest last occurrence required by the current piece. Initially zero is enough as a starting value, because the first loop iteration will update it before checking for a cut. End is an index, not a length or a count."),
        ("        for i, char in enumerate(s):", "Begin the second pass. This time i is the scan position, and char is the letter whose obligation we are incorporating. Both loops are sequential, not nested. We process each character once to build last and once to decide the partitions."),
        ("            end = max(end, last[char])", "Extend the boundary if this letter ends farther right. The maximum preserves obligations from earlier letters. In our example, end grows from two to four to five. A repeated a must never shrink it back to two. This single line maintains the invariant used in the proof."),
        ("            if i == end:", "Check whether we have reached the boundary after including the current character's obligation. Equality means every character in the current piece is finished globally, so this is the earliest safe cut. Before equality, a known letter still crosses a proposed cut. That is the proof expressed as a condition."),
        ("                sizes.append(end - start + 1)", "Record the inclusive length. For start zero and end five, the difference is five, but there are six positions, so add one. Appending end itself would confuse an index with a length and would fail especially on later partitions."),
        ("                start = i + 1", "Move the next piece's start past the cut. We do not reset end: its old value is behind the next scan position, and the next character's last occurrence is at least that new position. The next maximum therefore establishes the new piece's boundary correctly."),
        ("        return sizes", "After the scan, return every recorded length. The final character always has last occurrence equal to its own index, so the final piece closes naturally. We need no separate append after the loop; adding one there would duplicate the final partition."),
    ]
    return {
        "title": "Partition Labels: why the earliest safe cut is optimal",
        "breakdown": [
            "You already know the algorithm. This lesson focuses on why it works: which cuts are impossible, when a cut becomes safe, and why choosing that first safe cut maximizes the number of partitions. Then we will connect that proof to every line of Python.",
            "The rule is that every occurrence of any letter must stay inside a single partition. Partitions are contiguous, cover the original string, and preserve its order. A partition may contain several different letters. The objective is the greatest number of partitions, not the greatest number of characters per partition.",
        ],
        "key_points": ["Follow forced boundary extensions", "Prove safety, then optimality", "Connect the proof to Python"],
        "approaches": [{
            "name": "Cut at the earliest closed boundary", "time": "O(n)", "space": "O(1) auxiliary",
            "verdict": "optimal", "idea": "Track the farthest last occurrence of every letter scanned in the current piece.",
            "why": "An earlier cut splits a letter; a later cut merges pieces unnecessarily.",
            "say": "Our greedy choice is to end a piece at the earliest position where no included letter appears again later. The dictionary tells us where letters finish. The moving boundary combines those requirements. We will first watch a chain of dependencies form, then prove that satisfying the chain gives a safe cut and that cutting immediately cannot sacrifice a better answer.",
        }],
        "frames": layout_frames(frames),
        "code": [{"line": line, "say": say} for line, say in code],
        "time_complexity": "O(n)", "space_complexity": "O(1) auxiliary; O(n) output",
        "complexity_say": "Two full passes take linear time: adding their work gives two times n, which is O of n, not n squared. The dictionary contains at most twenty-six entries for lowercase English letters, so auxiliary space is constant under this problem's alphabet constraint. The output can contain n partition lengths, so counting the returned list takes linear space in the worst case. The main takeaway is that end records obligations, equality proves safety, and taking the earliest safe cut preserves the most opportunities to split the suffix.",
    }
