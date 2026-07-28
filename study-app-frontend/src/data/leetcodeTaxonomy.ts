// Shared LeetCode problem taxonomy.
//
// The canonical problem catalog lives here as PROBLEM_ROWS (category|title|
// difficulty|slug|extra|subtopics), the single source of truth used by both
// KojoCode (LeetCodeMode.tsx layers icons on top to build its CATEGORIES) and the
// Mock Interview custom-company flow (topic + difficulty problem selection). The
// category labels toId() to the same ids as the backend taxonomy in
// study-app-backend/src/services/lc_taxonomy.py (e.g. "DP" -> "dp").

export type TaxonomyDifficulty = "Easy" | "Medium" | "Hard";

export type TaxonomyProblem = {
  slug: string;
  title: string;
  difficulty: TaxonomyDifficulty;
  topicId: string;
  topicLabel: string;
};

export function toTopicId(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Curated two-level taxonomy: topic id -> the finer subtopics (techniques) under it,
// drawn from LeetCode's tag set. Kept in sync with the backend copy in
// study-app-backend/src/services/lc_taxonomy.py. Used to author official-problem
// subtopics, constrain the AI's labels, render the subtopic picker (KojoCode), and
// let the Mock Interview custom flow choose finer focus areas.
export const SUBTOPICS_BY_TOPIC: Record<string, string[]> = {
  arrays: [
    "Two Pointers", "Prefix Sum", "Sliding Window", "Sorting", "Matrix",
    "Counting Sort", "Radix Sort", "Merge Sort", "Quickselect",
  ],
  strings: [
    "Two Pointers", "String Matching", "Sliding Window", "Rolling Hash",
    "Hash Function", "Trie", "Suffix Array", "KMP Algorithm",
  ],
  "hash-table": ["Counting", "Bucket Sort", "Rolling Hash", "Hash Function", "Ordered Set", "Ordered Map", "Design"],
  "linked-list": ["Doubly-Linked List", "Two Pointers", "Recursion"],
  stack: ["Monotonic Stack", "Queue", "Design"],
  "heap-priority-queue": ["Sorting", "Simulation", "Greedy", "Merge Sort"],
  tree: [
    "Binary Tree", "Binary Search Tree", "Depth-First Search", "Breadth-First Search",
    "Tree Multi-set", "Euler Tour Technique", "Union Find", "Divide and Conquer",
  ],
  "binary-search": ["Two Pointers", "Divide and Conquer", "Interactive"],
  "sliding-window": ["Two Pointers", "Array", "String", "Hash Table"],
  dp: ["Memoization", "Bitmask", "Divide and Conquer", "Bit Manipulation", "Combinatorics"],
  backtracking: ["Depth-First Search", "Recursion"],
  graph: [
    "Depth-First Search", "Breadth-First Search", "Shortest Path", "Union Find",
    "Topological Sort", "Minimum Spanning Tree", "Eulerian Circuit", "Bipartite Graph",
    "Strongly Connected Component", "Tarjan's Algorithm", "Dijkstra's Algorithm",
  ],
  design: ["Data Stream", "Object-Oriented Programming", "Concurrency"],
  advanced: ["Trie", "Segment Tree", "Binary Indexed Tree", "Union Find", "Suffix Array", "Line Sweep"],
  math: [
    "Geometry", "Combinatorics", "Number Theory", "Game Theory",
    "Probability and Statistics", "Randomized", "Brainteaser",
  ],
  "bit-manipulation": ["Bitmask"],
  intervals: ["Array", "Line Sweep", "Ordered Set"],
  extra: ["Greedy", "Matrix", "Simulation", "Recursion", "Brainteaser", "Shell", "Database"],
};

// The distinct subtopics under the given topics, each with the topic it belongs to,
// for a grouped subtopic picker. De-duped by (topic, subtopic).
export function subtopicsForTopics(topicIds: string[]): { topicId: string; label: string }[] {
  const out: { topicId: string; label: string }[] = [];
  for (const id of topicIds) {
    for (const sub of SUBTOPICS_BY_TOPIC[id] ?? []) {
      out.push({ topicId: id, label: sub });
    }
  }
  return out;
}

export const PROBLEM_ROWS = `Arrays|Two Sum|Easy|two-sum|
Arrays|Two Sum II - Input Array Is Sorted|Medium|two-sum-ii-input-array-is-sorted|
Arrays|Best Time to Buy and Sell Stock|Easy|best-time-to-buy-and-sell-stock|
Arrays|Maximum Subarray|Medium|maximum-subarray|
Arrays|Maximum Product Subarray|Medium|maximum-product-subarray|
Arrays|Container With Most Water|Medium|container-with-most-water|
Arrays|Trapping Rain Water|Hard|trapping-rain-water|
Arrays|Move Zeroes|Easy|move-zeroes|
Arrays|Find All Numbers Disappeared in an Array|Easy|find-all-numbers-disappeared-in-an-array|
Arrays|Plus One|Easy|plus-one|
Arrays|Rotate Array|Medium|rotate-array|
Arrays|Intersection of Two Arrays II|Easy|intersection-of-two-arrays-ii|
Arrays|3Sum|Medium|3sum|
Arrays|4Sum|Medium|4sum|
Arrays|Subarray Sum Equals K|Medium|subarray-sum-equals-k|
Arrays|Maximum Subarray Min-Product|Medium|maximum-subarray-min-product|extra
Strings|Valid Anagram|Easy|valid-anagram|
Strings|Valid Palindrome|Easy|valid-palindrome|
Strings|Valid Palindrome II|Easy|valid-palindrome-ii|
Strings|Longest Substring Without Repeating Characters|Medium|longest-substring-without-repeating-characters|
Strings|Longest Repeating Character Replacement|Medium|longest-repeating-character-replacement|
Strings|Permutation in String|Medium|permutation-in-string|
Strings|Minimum Window Substring|Hard|minimum-window-substring|
Strings|Reverse String|Easy|reverse-string|
Strings|Group Anagrams|Medium|group-anagrams|
Strings|Word Pattern|Easy|word-pattern|
Strings|Find the Index of the First Occurrence in a String|Easy|find-the-index-of-the-first-occurrence-in-a-string|
Strings|Find All Anagrams in a String|Medium|find-all-anagrams-in-a-string|
Strings|Encode and Decode Strings|Medium|encode-and-decode-strings|
Strings|Decode String|Medium|decode-string|
Strings|Decode Ways|Medium|decode-ways|
Strings|Interleaving String|Medium|interleaving-string|
Strings|Longest Palindromic Substring|Medium|longest-palindromic-substring|
Strings|Palindromic Substrings|Medium|palindromic-substrings|
Strings|Partition Labels|Medium|partition-labels|
Strings|Letter Combinations of a Phone Number|Medium|letter-combinations-of-a-phone-number|
Strings|Regular Expression Matching|Hard|regular-expression-matching|
Strings|Reverse Integer|Medium|reverse-integer|
Strings|Multiply Strings|Medium|multiply-strings|
Strings|Remove All Adjacent Duplicates in String II|Medium|remove-all-adjacent-duplicates-in-string-ii|
Strings|Longest Happy String|Medium|longest-happy-string|extra
Hash Table|Contains Duplicate|Easy|contains-duplicate|
Hash Table|Top K Frequent Elements|Medium|top-k-frequent-elements|
Hash Table|Valid Sudoku|Medium|valid-sudoku|
Hash Table|Happy Number|Easy|happy-number|
Hash Table|Number of 1 Bits|Easy|number-of-1-bits|
Hash Table|Counting Bits|Easy|counting-bits|
Hash Table|Single Number|Easy|single-number|
Hash Table|Design Add and Search Words Data Structure|Medium|design-add-and-search-words-data-structure|
Hash Table|Find the Duplicate Number|Medium|find-the-duplicate-number|
Hash Table|Intersection of Two Arrays|Easy|intersection-of-two-arrays|
Hash Table|First Missing Positive|Hard|first-missing-positive|
Linked List|Reverse Linked List|Easy|reverse-linked-list|
Linked List|Reverse Linked List II|Medium|reverse-linked-list-ii|
Linked List|Merge Two Sorted Lists|Easy|merge-two-sorted-lists|
Linked List|Linked List Cycle|Easy|linked-list-cycle|
Linked List|Reorder List|Medium|reorder-list|
Linked List|Remove Nth Node From End of List|Medium|remove-nth-node-from-end-of-list|
Linked List|Add Two Numbers|Medium|add-two-numbers|
Linked List|Copy List with Random Pointer|Medium|copy-list-with-random-pointer|
Linked List|Merge k Sorted Lists|Hard|merge-k-sorted-lists|
Linked List|Reverse Nodes in k-Group|Hard|reverse-nodes-in-k-group|
Linked List|Remove Linked List Elements|Easy|remove-linked-list-elements|
Stack|Valid Parentheses|Easy|valid-parentheses|
Stack|Min Stack|Medium|min-stack|
Stack|Evaluate Reverse Polish Notation|Medium|evaluate-reverse-polish-notation|
Stack|Daily Temperatures|Medium|daily-temperatures|
Stack|Largest Rectangle in Histogram|Hard|largest-rectangle-in-histogram|
Stack|Asteroid Collision|Medium|asteroid-collision|
Stack|Next Greater Element I|Easy|next-greater-element-i|
Heap / Priority Queue|Kth Largest Element in a Stream|Easy|kth-largest-element-in-a-stream|
Heap / Priority Queue|Last Stone Weight|Easy|last-stone-weight|
Heap / Priority Queue|K Closest Points to Origin|Medium|k-closest-points-to-origin|
Heap / Priority Queue|Kth Largest Element in an Array|Medium|kth-largest-element-in-an-array|
Heap / Priority Queue|Task Scheduler|Medium|task-scheduler|
Heap / Priority Queue|Find Median from Data Stream|Hard|find-median-from-data-stream|
Heap / Priority Queue|Car Fleet|Medium|car-fleet|
Heap / Priority Queue|Maximum Frequency Stack|Hard|maximum-frequency-stack|extra
Heap / Priority Queue|Process Tasks Using Servers|Medium|process-tasks-using-servers|extra
Tree|Invert Binary Tree|Easy|invert-binary-tree|
Tree|Maximum Depth of Binary Tree|Easy|maximum-depth-of-binary-tree|
Tree|Diameter of Binary Tree|Easy|diameter-of-binary-tree|
Tree|Balanced Binary Tree|Easy|balanced-binary-tree|
Tree|Same Tree|Easy|same-tree|
Tree|Subtree of Another Tree|Easy|subtree-of-another-tree|
Tree|Lowest Common Ancestor of a Binary Search Tree|Medium|lowest-common-ancestor-of-a-binary-search-tree|
Tree|Binary Tree Level Order Traversal|Medium|binary-tree-level-order-traversal|
Tree|Binary Tree Right Side View|Medium|binary-tree-right-side-view|
Tree|Count Good Nodes in Binary Tree|Medium|count-good-nodes-in-binary-tree|
Tree|Validate Binary Search Tree|Medium|validate-binary-search-tree|
Tree|Kth Smallest Element in a BST|Medium|kth-smallest-element-in-a-bst|
Tree|Construct Binary Tree from Preorder and Inorder Traversal|Medium|construct-binary-tree-from-preorder-and-inorder-traversal|
Tree|Binary Tree Maximum Path Sum|Hard|binary-tree-maximum-path-sum|
Tree|Serialize and Deserialize Binary Tree|Hard|serialize-and-deserialize-binary-tree|
Tree|Flatten Binary Tree to Linked List|Medium|flatten-binary-tree-to-linked-list|extra
Binary Search|Binary Search|Easy|binary-search|
Binary Search|Search a 2D Matrix|Medium|search-a-2d-matrix|
Binary Search|Koko Eating Bananas|Medium|koko-eating-bananas|
Binary Search|Find Minimum in Rotated Sorted Array|Medium|find-minimum-in-rotated-sorted-array|
Binary Search|Search in Rotated Sorted Array|Medium|search-in-rotated-sorted-array|
Binary Search|Median of Two Sorted Arrays|Hard|median-of-two-sorted-arrays|
Binary Search|Find First and Last Position of Element in Sorted Array|Medium|find-first-and-last-position-of-element-in-sorted-array|
Binary Search|Minimum Size Subarray Sum|Medium|minimum-size-subarray-sum|
Binary Search|Kth Smallest Element in a Sorted Matrix|Medium|kth-smallest-element-in-a-sorted-matrix|extra
Sliding Window|Sliding Window Maximum|Hard|sliding-window-maximum|
Sliding Window|Find K Closest Elements|Medium|find-k-closest-elements|
Sliding Window|Maximum Points You Can Obtain from Cards|Medium|maximum-points-you-can-obtain-from-cards|
Sliding Window|Continuous Subarray Sum|Medium|continuous-subarray-sum|
Sliding Window|Frequency of the Most Frequent Element|Medium|frequency-of-the-most-frequent-element|extra
DP|Climbing Stairs|Easy|climbing-stairs|
DP|Min Cost Climbing Stairs|Easy|min-cost-climbing-stairs|
DP|House Robber|Medium|house-robber|
DP|House Robber II|Medium|house-robber-ii|
DP|Coin Change|Medium|coin-change|
DP|Longest Increasing Subsequence|Medium|longest-increasing-subsequence|
DP|Word Break|Medium|word-break|
DP|Partition Equal Subset Sum|Medium|partition-equal-subset-sum|
DP|Unique Paths|Medium|unique-paths|
DP|Longest Common Subsequence|Medium|longest-common-subsequence|
DP|Best Time to Buy and Sell Stock with Cooldown|Medium|best-time-to-buy-and-sell-stock-with-cooldown|
DP|Coin Change II|Medium|coin-change-ii|
DP|Target Sum|Medium|target-sum|
DP|Longest Increasing Path in a Matrix|Hard|longest-increasing-path-in-a-matrix|
DP|Distinct Subsequences|Hard|distinct-subsequences|
DP|Edit Distance|Medium|edit-distance|
DP|Burst Balloons|Hard|burst-balloons|
DP|Maximum Alternating Subsequence Sum|Medium|maximum-alternating-subsequence-sum|extra
DP|Integer Break|Medium|integer-break|extra
Backtracking|Subsets|Medium|subsets|
Backtracking|Combination Sum|Medium|combination-sum|
Backtracking|Combination Sum II|Medium|combination-sum-ii|
Backtracking|Permutations|Medium|permutations|
Backtracking|Subsets II|Medium|subsets-ii|
Backtracking|Generate Parentheses|Medium|generate-parentheses|
Backtracking|Word Search|Medium|word-search|
Backtracking|Palindrome Partitioning|Medium|palindrome-partitioning|
Backtracking|N-Queens|Hard|n-queens|
Backtracking|Restore IP Addresses|Medium|restore-ip-addresses|
Graph|Number of Islands|Medium|number-of-islands|
Graph|Max Area of Island|Medium|max-area-of-island|
Graph|Clone Graph|Medium|clone-graph|
Graph|Walls and Gates|Medium|walls-and-gates|
Graph|Rotting Oranges|Medium|rotting-oranges|
Graph|Pacific Atlantic Water Flow|Medium|pacific-atlantic-water-flow|
Graph|Surrounded Regions|Medium|surrounded-regions|
Graph|Course Schedule|Medium|course-schedule|
Graph|Course Schedule II|Medium|course-schedule-ii|
Graph|Graph Valid Tree|Medium|graph-valid-tree|
Graph|Number of Connected Components in an Undirected Graph|Medium|number-of-connected-components-in-an-undirected-graph|
Graph|Redundant Connection|Medium|redundant-connection|
Graph|Word Ladder|Hard|word-ladder|
Graph|Network Delay Time|Medium|network-delay-time|
Graph|Reconstruct Itinerary|Hard|reconstruct-itinerary|
Graph|Min Cost to Connect All Points|Medium|min-cost-to-connect-all-points|
Graph|Swim in Rising Water|Hard|swim-in-rising-water|
Graph|Alien Dictionary|Hard|alien-dictionary|
Graph|Cheapest Flights Within K Stops|Medium|cheapest-flights-within-k-stops|
Graph|Dijkstra Algorithm|Reference||extra
Design|LRU Cache|Medium|lru-cache|
Design|Design Twitter|Medium|design-twitter|
Design|Design Circular Queue|Medium|design-circular-queue|
Design|Seat Reservation Manager|Medium|seat-reservation-manager|
Design|Time Based Key-Value Store|Medium|time-based-key-value-store|
Advanced|Implement Trie (Prefix Tree)|Medium|implement-trie-prefix-tree|
Advanced|Word Search II|Hard|word-search-ii|
Math|Rotate Image|Medium|rotate-image|
Math|Spiral Matrix|Medium|spiral-matrix|
Math|Set Matrix Zeroes|Medium|set-matrix-zeroes|
Math|Pow(x, n)|Medium|powx-n|
Math|Multiply Strings|Medium|multiply-strings|
Math|Detect Squares|Medium|detect-squares|
Bit Manipulation|Single Number|Easy|single-number|
Bit Manipulation|Number of 1 Bits|Easy|number-of-1-bits|
Bit Manipulation|Counting Bits|Easy|counting-bits|
Bit Manipulation|Reverse Bits|Easy|reverse-bits|
Bit Manipulation|Missing Number|Easy|missing-number|
Bit Manipulation|Sum of Two Integers|Medium|sum-of-two-integers|
Bit Manipulation|Reverse Integer|Medium|reverse-integer|
Intervals|Insert Interval|Medium|insert-interval|
Intervals|Merge Intervals|Medium|merge-intervals|
Intervals|Non-overlapping Intervals|Medium|non-overlapping-intervals|
Intervals|Meeting Rooms|Easy|meeting-rooms|
Intervals|Meeting Rooms II|Medium|meeting-rooms-ii|
Intervals|Minimum Interval to Include Each Query|Hard|minimum-interval-to-include-each-query|
Extra|4Sum|Medium|4sum|
Extra|Maximum Subarray Min-Product|Medium|maximum-subarray-min-product|
Extra|Longest Happy String|Medium|longest-happy-string|
Extra|Restore IP Addresses|Medium|restore-ip-addresses|
Extra|Bellman-Ford Algorithm|Reference||
Extra|Flatten Binary Tree to Linked List|Medium|flatten-binary-tree-to-linked-list|
Extra|Seat Reservation Manager|Medium|seat-reservation-manager|
Extra|Integer Break|Medium|integer-break|
Extra|Maximum Alternating Subsequence Sum|Medium|maximum-alternating-subsequence-sum|
Extra|Process Tasks Using Servers|Medium|process-tasks-using-servers|
Extra|Frequency of the Most Frequent Element|Medium|frequency-of-the-most-frequent-element|
Extra|Maximum Points You Can Obtain from Cards|Medium|maximum-points-you-can-obtain-from-cards|
Extra|Continuous Subarray Sum|Medium|continuous-subarray-sum|
Extra|Minimum Size Subarray Sum|Medium|minimum-size-subarray-sum|
Extra|Find K Closest Elements|Medium|find-k-closest-elements|
Extra|Kth Smallest Element in a Sorted Matrix|Medium|kth-smallest-element-in-a-sorted-matrix|
Extra|Find First and Last Position of Element in Sorted Array|Medium|find-first-and-last-position-of-element-in-sorted-array|
Extra|Asteroid Collision|Medium|asteroid-collision|
Extra|Next Greater Element I|Easy|next-greater-element-i|
Extra|Maximum Frequency Stack|Hard|maximum-frequency-stack|
`;

// Parse the pipe-delimited rows once into a flat, typed catalog. Rows without a
// slug (author placeholders) are skipped since Mock Interview needs a real slug.
export const TAXONOMY_PROBLEMS: TaxonomyProblem[] = PROBLEM_ROWS.trim()
  .split("\n")
  .map((line) => {
    const [categoryLabel, title, difficulty, slug] = line.split("|");
    return { categoryLabel, title, difficulty, slug };
  })
  .filter((r) => r.slug && r.title && (r.difficulty === "Easy" || r.difficulty === "Medium" || r.difficulty === "Hard"))
  .map((r) => ({
    slug: r.slug,
    title: r.title,
    difficulty: r.difficulty as TaxonomyDifficulty,
    topicId: toTopicId(r.categoryLabel),
    topicLabel: r.categoryLabel,
  }));

// Distinct topics in catalog order, with a problem count for the picker UI.
export const TAXONOMY_TOPICS: { id: string; label: string; count: number }[] = (() => {
  const order: string[] = [];
  const byId = new Map<string, { id: string; label: string; count: number }>();
  for (const p of TAXONOMY_PROBLEMS) {
    let entry = byId.get(p.topicId);
    if (!entry) {
      entry = { id: p.topicId, label: p.topicLabel, count: 0 };
      byId.set(p.topicId, entry);
      order.push(p.topicId);
    }
    entry.count += 1;
  }
  return order.map((id) => byId.get(id)!);
})();

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Select up to `count` problems drawn from the chosen topics, keeping only the
// chosen difficulties. Round-robins across topics so a multi-topic selection is
// spread evenly rather than exhausting the first topic. Empty topics -> all topics;
// empty difficulties -> all difficulties.
export function selectTaxonomyProblems(
  topicIds: string[],
  difficulties: TaxonomyDifficulty[],
  count: number,
): TaxonomyProblem[] {
  const topics = topicIds.length ? topicIds : TAXONOMY_TOPICS.map((t) => t.id);
  const diffSet = new Set(difficulties.length ? difficulties : ["Easy", "Medium", "Hard"]);
  const pools = topics.map((id) =>
    shuffle(TAXONOMY_PROBLEMS.filter((p) => p.topicId === id && diffSet.has(p.difficulty))),
  );
  const picked: TaxonomyProblem[] = [];
  const seen = new Set<string>();
  for (let depth = 0; picked.length < count; depth += 1) {
    let advanced = false;
    for (const pool of pools) {
      if (picked.length >= count) break;
      const p = pool[depth];
      if (p && !seen.has(p.slug)) {
        picked.push(p);
        seen.add(p.slug);
        advanced = true;
      }
    }
    if (!advanced) break;
  }
  return picked;
}

const BY_SLUG = new Map(TAXONOMY_PROBLEMS.map((p) => [p.slug, p]));
const BY_TITLE = new Map(TAXONOMY_PROBLEMS.map((p) => [p.title.toLowerCase(), p]));

// Turn one pasted line (a LeetCode URL, a slug, or a problem title) into a catalog
// problem. Unknown-but-parseable entries still resolve to a slug so the Stage 1
// runner can fetch them; difficulty falls back to Medium and the title to the slug.
export function resolvePastedProblem(line: string): TaxonomyProblem | null {
  const raw = line.trim();
  if (!raw) return null;
  const urlMatch = raw.match(/leetcode\.com\/problems\/([a-z0-9-]+)/i);
  let slug = urlMatch ? urlMatch[1].toLowerCase() : "";
  if (!slug && /^[a-z0-9-]+$/.test(raw) && raw.includes("-")) slug = raw.toLowerCase();
  if (slug && BY_SLUG.has(slug)) return BY_SLUG.get(slug)!;
  const byTitle = BY_TITLE.get(raw.toLowerCase());
  if (byTitle) return byTitle;
  if (!slug) slug = toTopicId(raw);
  if (!slug) return null;
  return { slug, title: raw, difficulty: "Medium", topicId: "", topicLabel: "" };
}

export function resolvePastedProblems(text: string): TaxonomyProblem[] {
  const out: TaxonomyProblem[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/[\n,]/)) {
    const p = resolvePastedProblem(line);
    if (p && !seen.has(p.slug)) {
      out.push(p);
      seen.add(p.slug);
    }
  }
  return out;
}
