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
Arrays|Apply Operations to an Array|Easy|apply-operations-to-an-array|
Arrays|Count Pairs Whose Sum is Less than Target|Easy|count-pairs-whose-sum-is-less-than-target|
Arrays|Find Pivot Index|Easy|find-pivot-index|
Arrays|Find the Distance Value Between Two Arrays|Easy|find-the-distance-value-between-two-arrays|
Arrays|Find the Highest Altitude|Easy|find-the-highest-altitude|
Arrays|Is Subsequence|Easy|is-subsequence|
Arrays|Max Consecutive Ones|Easy|max-consecutive-ones|
Arrays|Maximum Ascending Subarray Sum|Easy|maximum-ascending-subarray-sum|
Arrays|Maximum Difference Between Increasing Elements|Easy|maximum-difference-between-increasing-elements|
Arrays|Merge Strings Alternately|Easy|merge-strings-alternately|
Arrays|Minimum Common Value|Easy|minimum-common-value|
Arrays|Minimum Value to Get Positive Step by Step Sum|Easy|minimum-value-to-get-positive-step-by-step-sum|
Arrays|Remove Duplicates from Sorted Array|Easy|remove-duplicates-from-sorted-array|
Arrays|Remove Element|Easy|remove-element|
Arrays|Reverse Only Letters|Easy|reverse-only-letters|
Arrays|Reverse Prefix of Word|Easy|reverse-prefix-of-word|
Arrays|Reverse String II|Easy|reverse-string-ii|
Arrays|Reverse Vowels of a String|Easy|reverse-vowels-of-a-string|
Arrays|Reverse Words in a String III|Easy|reverse-words-in-a-string-iii|
Arrays|Rotate String|Easy|rotate-string|
Arrays|Running Sum of 1d Array|Easy|running-sum-of-1d-array|
Arrays|Sort Array By Parity|Easy|sort-array-by-parity|
Arrays|Sort Array By Parity II|Easy|sort-array-by-parity-ii|
Arrays|Squares of a Sorted Array|Easy|squares-of-a-sorted-array|
Arrays|Sum of All Odd Length Subarrays|Easy|sum-of-all-odd-length-subarrays|
Arrays|Two Sum IV - Input is a BST|Easy|two-sum-iv-input-is-a-bst|
Arrays|3Sum Closest|Medium|3sum-closest|
Arrays|Best Sightseeing Pair|Medium|best-sightseeing-pair|
Arrays|Best Time to Buy and Sell Stock II|Medium|best-time-to-buy-and-sell-stock-ii|
Arrays|Boats to Save People|Medium|boats-to-save-people|
Arrays|Compare Version Numbers|Medium|compare-version-numbers|
Arrays|Contiguous Array|Medium|contiguous-array|
Arrays|Count Square Submatrices with All Ones|Medium|count-square-submatrices-with-all-ones|
Arrays|Increasing Triplet Subsequence|Medium|increasing-triplet-subsequence|
Arrays|Interval List Intersections|Medium|interval-list-intersections|
Arrays|Longest Word in Dictionary through Deleting|Medium|longest-word-in-dictionary-through-deleting|
Arrays|Maximum Subarray Sum with One Deletion|Medium|maximum-subarray-sum-with-one-deletion|
Arrays|Maximum Sum Circular Subarray|Medium|maximum-sum-circular-subarray|
Arrays|Minimum Length of String After Deleting Similar Ends|Medium|minimum-length-of-string-after-deleting-similar-ends|
Arrays|Number of Sub-arrays With Odd Sum|Medium|number-of-sub-arrays-with-odd-sum|
Arrays|Product of Array Except Self|Medium|product-of-array-except-self|
Arrays|Remove Duplicates from Sorted Array II|Medium|remove-duplicates-from-sorted-array-ii|
Arrays|Remove Zero Sum Consecutive Nodes from Linked List|Medium|remove-zero-sum-consecutive-nodes-from-linked-list|
Arrays|Reverse Substrings Between Each Pair of Parentheses|Medium|reverse-substrings-between-each-pair-of-parentheses|
Arrays|Reverse Words in a String|Medium|reverse-words-in-a-string|
Arrays|String Compression|Medium|string-compression|
Arrays|Subarray Sums Divisible by K|Medium|subarray-sums-divisible-by-k|
Arrays|Best Time to Buy and Sell Stock III|Hard|best-time-to-buy-and-sell-stock-iii|
Arrays|Best Time to Buy and Sell Stock IV|Hard|best-time-to-buy-and-sell-stock-iv|
Arrays|Maximum Sum of 3 Non-Overlapping Subarrays|Hard|maximum-sum-of-3-non-overlapping-subarrays|
Arrays|Number of Submatrices That Sum to Target|Hard|number-of-submatrices-that-sum-to-target|
Arrays|Duplicate Zeros|Easy|duplicate-zeros|
Arrays|Merge Sorted Array|Easy|merge-sorted-array|
Arrays|Range Sum Query - Immutable|Easy|range-sum-query-immutable|
Arrays|Next Permutation|Medium|next-permutation|
Arrays|Range Sum Query 2D - Immutable|Medium|range-sum-query-2d-immutable|
Arrays|Sort Colors|Medium|sort-colors|
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
Strings|Check if Word Equals Summation of Two Words|Easy|check-if-word-equals-summation-of-two-words|
Strings|Decode the Message|Easy|decode-the-message|
Strings|Goal Parser Interpretation|Easy|goal-parser-interpretation|
Strings|Isomorphic Strings|Easy|isomorphic-strings|
Strings|Maximum Nesting Depth of the Parentheses|Easy|maximum-nesting-depth-of-the-parentheses|
Strings|Number of Different Integers in a String|Easy|number-of-different-integers-in-a-string|
Strings|Reformat Date|Easy|reformat-date|
Strings|Split a String in Balanced Strings|Easy|split-a-string-in-balanced-strings|
Strings|Verifying an Alien Dictionary|Easy|verifying-an-alien-dictionary|
Strings|Basic Calculator II|Medium|basic-calculator-ii|
Strings|Count and Say|Medium|count-and-say|
Strings|Determine if Two Strings Are Close|Medium|determine-if-two-strings-are-close|
Strings|Find and Replace Pattern|Medium|find-and-replace-pattern|
Strings|Simplify Path|Medium|simplify-path|
Strings|String to Integer (atoi)|Medium|string-to-integer-atoi|
Strings|Basic Calculator|Hard|basic-calculator|
Strings|Number of Atoms|Hard|number-of-atoms|
Strings|Parsing A Boolean Expression|Hard|parsing-a-boolean-expression|
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
Hash Table|Find Common Characters|Easy|find-common-characters|
Hash Table|Find Lucky Integer in an Array|Easy|find-lucky-integer-in-an-array|
Hash Table|First Unique Character in a String|Easy|first-unique-character-in-a-string|
Hash Table|Lucky Numbers in a Matrix|Easy|lucky-numbers-in-a-matrix|
Hash Table|Majority Element|Easy|majority-element|
Hash Table|Number of Good Pairs|Easy|number-of-good-pairs|
Hash Table|Ransom Note|Easy|ransom-note|
Hash Table|Sort Array by Increasing Frequency|Easy|sort-array-by-increasing-frequency|
Hash Table|Uncommon Words from Two Sentences|Easy|uncommon-words-from-two-sentences|
Hash Table|Unique Number of Occurrences|Easy|unique-number-of-occurrences|
Hash Table|4Sum II|Medium|4sum-ii|
Hash Table|Brick Wall|Medium|brick-wall|
Hash Table|Linked List Components|Medium|linked-list-components|
Hash Table|Longest Consecutive Sequence|Medium|longest-consecutive-sequence|
Hash Table|Sort Characters By Frequency|Medium|sort-characters-by-frequency|
Hash Table|Word Subsets|Medium|word-subsets|
Hash Table|Max Points on a Line|Hard|max-points-on-a-line|
Hash Table|Substring with Concatenation of All Words|Hard|substring-with-concatenation-of-all-words|
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
Linked List|Add Binary|Easy|add-binary|
Linked List|Add Strings|Easy|add-strings|
Linked List|Add to Array-Form of Integer|Easy|add-to-array-form-of-integer|
Linked List|Convert Binary Number in a Linked List to Integer|Easy|convert-binary-number-in-a-linked-list-to-integer|
Linked List|Middle of the Linked List|Easy|middle-of-the-linked-list|
Linked List|Palindrome Linked List|Easy|palindrome-linked-list|
Linked List|Remove Duplicates from Sorted List|Easy|remove-duplicates-from-sorted-list|
Linked List|Add Two Numbers II|Medium|add-two-numbers-ii|
Linked List|Circular Array Loop|Medium|circular-array-loop|
Linked List|Delete the Middle Node of a Linked List|Medium|delete-the-middle-node-of-a-linked-list|
Linked List|Insert Greatest Common Divisors in Linked List|Medium|insert-greatest-common-divisors-in-linked-list|
Linked List|Insertion Sort List|Medium|insertion-sort-list|
Linked List|Maximum Twin Sum of a Linked List|Medium|maximum-twin-sum-of-a-linked-list|
Linked List|Odd Even Linked List|Medium|odd-even-linked-list|
Linked List|Partition List|Medium|partition-list|
Linked List|Remove Duplicates from Sorted List II|Medium|remove-duplicates-from-sorted-list-ii|
Linked List|Rotate List|Medium|rotate-list|
Linked List|Split Linked List in Parts|Medium|split-linked-list-in-parts|
Linked List|Swap Nodes in Pairs|Medium|swap-nodes-in-pairs|
Linked List|Swapping Nodes in a Linked List|Medium|swapping-nodes-in-a-linked-list|
Linked List|All O'one Data Structure|Hard|all-oone-data-structure|
Linked List|LFU Cache|Hard|lfu-cache|
Stack|Valid Parentheses|Easy|valid-parentheses|
Stack|Min Stack|Medium|min-stack|
Stack|Evaluate Reverse Polish Notation|Medium|evaluate-reverse-polish-notation|
Stack|Daily Temperatures|Medium|daily-temperatures|
Stack|Largest Rectangle in Histogram|Hard|largest-rectangle-in-histogram|
Stack|Asteroid Collision|Medium|asteroid-collision|
Stack|Next Greater Element I|Easy|next-greater-element-i|
Stack|Backspace String Compare|Easy|backspace-string-compare|
Stack|Baseball Game|Easy|baseball-game|
Stack|Crawler Log Folder|Easy|crawler-log-folder|
Stack|Final Prices With a Special Discount in a Shop|Easy|final-prices-with-a-special-discount-in-a-shop|
Stack|Make The String Great|Easy|make-the-string-great|
Stack|Remove All Adjacent Duplicates In String|Easy|remove-all-adjacent-duplicates-in-string|
Stack|132 Pattern|Medium|132-pattern|
Stack|Build an Array With Stack Operations|Medium|build-an-array-with-stack-operations|
Stack|Find the Most Competitive Subsequence|Medium|find-the-most-competitive-subsequence|
Stack|Minimum Remove to Make Valid Parentheses|Medium|minimum-remove-to-make-valid-parentheses|
Stack|Next Greater Element II|Medium|next-greater-element-ii|
Stack|Next Greater Node In Linked List|Medium|next-greater-node-in-linked-list|
Stack|Remove Duplicate Letters|Medium|remove-duplicate-letters|
Stack|Remove K Digits|Medium|remove-k-digits|
Stack|Remove Nodes From Linked List|Medium|remove-nodes-from-linked-list|
Stack|Removing Stars From a String|Medium|removing-stars-from-a-string|
Stack|Score of Parentheses|Medium|score-of-parentheses|
Stack|Sum of Subarray Minimums|Medium|sum-of-subarray-minimums|
Stack|Longest Valid Parentheses|Hard|longest-valid-parentheses|
Stack|Maximal Rectangle|Hard|maximal-rectangle|
Stack|Online Stock Span|Medium|online-stock-span|
Heap / Priority Queue|Kth Largest Element in a Stream|Easy|kth-largest-element-in-a-stream|
Heap / Priority Queue|Last Stone Weight|Easy|last-stone-weight|
Heap / Priority Queue|K Closest Points to Origin|Medium|k-closest-points-to-origin|
Heap / Priority Queue|Kth Largest Element in an Array|Medium|kth-largest-element-in-an-array|
Heap / Priority Queue|Task Scheduler|Medium|task-scheduler|
Heap / Priority Queue|Find Median from Data Stream|Hard|find-median-from-data-stream|
Heap / Priority Queue|Car Fleet|Medium|car-fleet|
Heap / Priority Queue|Maximum Frequency Stack|Hard|maximum-frequency-stack|extra
Heap / Priority Queue|Process Tasks Using Servers|Medium|process-tasks-using-servers|extra
Heap / Priority Queue|Find Subsequence of Length K With the Largest Sum|Easy|find-subsequence-of-length-k-with-the-largest-sum|
Heap / Priority Queue|Maximum Product of Two Elements in an Array|Easy|maximum-product-of-two-elements-in-an-array|
Heap / Priority Queue|Minimum Amount of Time to Fill Cups|Easy|minimum-amount-of-time-to-fill-cups|
Heap / Priority Queue|Relative Ranks|Easy|relative-ranks|
Heap / Priority Queue|Take Gifts From the Richest Pile|Easy|take-gifts-from-the-richest-pile|
Heap / Priority Queue|The K Weakest Rows in a Matrix|Easy|the-k-weakest-rows-in-a-matrix|
Heap / Priority Queue|Find K Pairs with Smallest Sums|Medium|find-k-pairs-with-smallest-sums|
Heap / Priority Queue|Find the Kth Largest Integer in the Array|Medium|find-the-kth-largest-integer-in-the-array|
Heap / Priority Queue|Furthest Building You Can Reach|Medium|furthest-building-you-can-reach|
Heap / Priority Queue|K-th Smallest Prime Fraction|Medium|k-th-smallest-prime-fraction|
Heap / Priority Queue|Last Stone Weight II|Medium|last-stone-weight-ii|
Heap / Priority Queue|Maximal Score After Applying K Operations|Medium|maximal-score-after-applying-k-operations|
Heap / Priority Queue|Maximum Subsequence Score|Medium|maximum-subsequence-score|
Heap / Priority Queue|Reorganize String|Medium|reorganize-string|
Heap / Priority Queue|Single-Threaded CPU|Medium|single-threaded-cpu|
Heap / Priority Queue|Top K Frequent Words|Medium|top-k-frequent-words|
Heap / Priority Queue|Total Cost to Hire K Workers|Medium|total-cost-to-hire-k-workers|
Heap / Priority Queue|IPO|Hard|ipo|
Heap / Priority Queue|Maximum Performance of a Team|Hard|maximum-performance-of-a-team|
Heap / Priority Queue|Minimum Cost to Hire K Workers|Hard|minimum-cost-to-hire-k-workers|
Heap / Priority Queue|Minimum Number of Refueling Stops|Hard|minimum-number-of-refueling-stops|
Heap / Priority Queue|Sliding Window Median|Hard|sliding-window-median|
Heap / Priority Queue|Trapping Rain Water II|Hard|trapping-rain-water-ii|
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
Tree|Minimum Depth of Binary Tree|Easy|minimum-depth-of-binary-tree|
Tree|Path Sum|Easy|path-sum|
Tree|Sum of Left Leaves|Easy|sum-of-left-leaves|
Tree|Symmetric Tree|Easy|symmetric-tree|
Tree|House Robber III|Medium|house-robber-iii|
Tree|Path Sum II|Medium|path-sum-ii|
Tree|Sum Root to Leaf Numbers|Medium|sum-root-to-leaf-numbers|
Tree|Lowest Common Ancestor of a Binary Tree|Medium|lowest-common-ancestor-of-a-binary-tree|
Binary Search|Binary Search|Easy|binary-search|
Binary Search|Search a 2D Matrix|Medium|search-a-2d-matrix|
Binary Search|Koko Eating Bananas|Medium|koko-eating-bananas|
Binary Search|Find Minimum in Rotated Sorted Array|Medium|find-minimum-in-rotated-sorted-array|
Binary Search|Search in Rotated Sorted Array|Medium|search-in-rotated-sorted-array|
Binary Search|Median of Two Sorted Arrays|Hard|median-of-two-sorted-arrays|
Binary Search|Find First and Last Position of Element in Sorted Array|Medium|find-first-and-last-position-of-element-in-sorted-array|
Binary Search|Minimum Size Subarray Sum|Medium|minimum-size-subarray-sum|
Binary Search|Kth Smallest Element in a Sorted Matrix|Medium|kth-smallest-element-in-a-sorted-matrix|extra
Binary Search|Arranging Coins|Easy|arranging-coins|
Binary Search|Count Negative Numbers in a Sorted Matrix|Easy|count-negative-numbers-in-a-sorted-matrix|
Binary Search|Find Smallest Letter Greater Than Target|Easy|find-smallest-letter-greater-than-target|
Binary Search|Search Insert Position|Easy|search-insert-position|
Binary Search|Sqrt(x)|Easy|sqrtx|
Binary Search|Find Peak Element|Medium|find-peak-element|
Binary Search|Peak Index in a Mountain Array|Medium|peak-index-in-a-mountain-array|
Binary Search|Search in Rotated Sorted Array II|Medium|search-in-rotated-sorted-array-ii|
Binary Search|Single Element in a Sorted Array|Medium|single-element-in-a-sorted-array|
Binary Search|Find Minimum in Rotated Sorted Array II|Hard|find-minimum-in-rotated-sorted-array-ii|
Sliding Window|Sliding Window Maximum|Hard|sliding-window-maximum|
Sliding Window|Find K Closest Elements|Medium|find-k-closest-elements|
Sliding Window|Maximum Points You Can Obtain from Cards|Medium|maximum-points-you-can-obtain-from-cards|
Sliding Window|Continuous Subarray Sum|Medium|continuous-subarray-sum|
Sliding Window|Frequency of the Most Frequent Element|Medium|frequency-of-the-most-frequent-element|extra
Sliding Window|Contains Duplicate II|Easy|contains-duplicate-ii|
Sliding Window|Defuse the Bomb|Easy|defuse-the-bomb|
Sliding Window|Find the K-Beauty of a Number|Easy|find-the-k-beauty-of-a-number|
Sliding Window|Maximum Average Subarray I|Easy|maximum-average-subarray-i|
Sliding Window|Minimum Difference Between Highest and Lowest of K Scores|Easy|minimum-difference-between-highest-and-lowest-of-k-scores|
Sliding Window|Minimum Recolors to Get K Consecutive Black Blocks|Easy|minimum-recolors-to-get-k-consecutive-black-blocks|
Sliding Window|Count Number of Nice Subarrays|Medium|count-number-of-nice-subarrays|
Sliding Window|Fruit Into Baskets|Medium|fruit-into-baskets|
Sliding Window|Grumpy Bookstore Owner|Medium|grumpy-bookstore-owner|
Sliding Window|Jump Game VI|Medium|jump-game-vi|
Sliding Window|Longest Continuous Subarray With Absolute Diff Less Than or Equal to Limit|Medium|longest-continuous-subarray-with-absolute-diff-less-than-or-equal-to-limit|
Sliding Window|Longest Nice Subarray|Medium|longest-nice-subarray|
Sliding Window|Longest Subarray of 1's After Deleting One Element|Medium|longest-subarray-of-1s-after-deleting-one-element|
Sliding Window|Max Consecutive Ones III|Medium|max-consecutive-ones-iii|
Sliding Window|Maximum Erasure Value|Medium|maximum-erasure-value|
Sliding Window|Maximum Number of Vowels in a Substring of Given Length|Medium|maximum-number-of-vowels-in-a-substring-of-given-length|
Sliding Window|Maximum Sum of Distinct Subarrays With Length K|Medium|maximum-sum-of-distinct-subarrays-with-length-k|
Sliding Window|Minimum Consecutive Cards to Pick Up|Medium|minimum-consecutive-cards-to-pick-up|
Sliding Window|Minimum Operations to Reduce X to Zero|Medium|minimum-operations-to-reduce-x-to-zero|
Sliding Window|Minimum Size Subarray in Infinite Array|Medium|minimum-size-subarray-in-infinite-array|
Sliding Window|Replace the Substring for Balanced String|Medium|replace-the-substring-for-balanced-string|
Sliding Window|Shortest Subarray With OR at Least K II|Medium|shortest-subarray-with-or-at-least-k-ii|
Sliding Window|Subarray Product Less Than K|Medium|subarray-product-less-than-k|
Sliding Window|Take K of Each Character From Left and Right|Medium|take-k-of-each-character-from-left-and-right|
Sliding Window|Constrained Subsequence Sum|Hard|constrained-subsequence-sum|
Sliding Window|Count Subarrays With Fixed Bounds|Hard|count-subarrays-with-fixed-bounds|
Sliding Window|Max Value of Equation|Hard|max-value-of-equation|
Sliding Window|Minimum Number of K Consecutive Bit Flips|Hard|minimum-number-of-k-consecutive-bit-flips|
Sliding Window|Shortest Subarray with Sum at Least K|Hard|shortest-subarray-with-sum-at-least-k|
Sliding Window|Smallest Range Covering Elements from K Lists|Hard|smallest-range-covering-elements-from-k-lists|
Sliding Window|Subarrays with K Different Integers|Hard|subarrays-with-k-different-integers|
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
Graph|Average of Levels in Binary Tree|Easy|average-of-levels-in-binary-tree|
Graph|Find if Path Exists in Graph|Easy|find-if-path-exists-in-graph|
Graph|Flood Fill|Easy|flood-fill|
Graph|Island Perimeter|Easy|island-perimeter|
Graph|01 Matrix|Medium|01-matrix|
Graph|Accounts Merge|Medium|accounts-merge|
Graph|All Paths From Source to Target|Medium|all-paths-from-source-to-target|
Graph|As Far from Land as Possible|Medium|as-far-from-land-as-possible|
Graph|Check if There is a Valid Path in a Grid|Medium|check-if-there-is-a-valid-path-in-a-grid|
Graph|Coloring A Border|Medium|coloring-a-border|
Graph|Count Sub Islands|Medium|count-sub-islands|
Graph|Count the Number of Complete Components|Medium|count-the-number-of-complete-components|
Graph|Detonate the Maximum Bombs|Medium|detonate-the-maximum-bombs|
Graph|Evaluate Division|Medium|evaluate-division|
Graph|Find All Possible Recipes from Given Supplies|Medium|find-all-possible-recipes-from-given-supplies|
Graph|Find Eventual Safe States|Medium|find-eventual-safe-states|
Graph|Find the City With the Smallest Number of Neighbors at a Threshold Distance|Medium|find-the-city-with-the-smallest-number-of-neighbors-at-a-threshold-distance|
Graph|Find the Safest Path in a Grid|Medium|find-the-safest-path-in-a-grid|
Graph|Jump Game III|Medium|jump-game-iii|
Graph|Keys and Rooms|Medium|keys-and-rooms|
Graph|Lexicographically Smallest Equivalent String|Medium|lexicographically-smallest-equivalent-string|
Graph|Loud and Rich|Medium|loud-and-rich|
Graph|Map of Highest Peak|Medium|map-of-highest-peak|
Graph|Minimum Genetic Mutation|Medium|minimum-genetic-mutation|
Graph|Minimum Height Trees|Medium|minimum-height-trees|
Graph|Minimum Jumps to Reach Home|Medium|minimum-jumps-to-reach-home|
Graph|Minimum Number of Vertices to Reach All Nodes|Medium|minimum-number-of-vertices-to-reach-all-nodes|
Graph|Most Stones Removed with Same Row or Column|Medium|most-stones-removed-with-same-row-or-column|
Graph|Nearest Exit from Entrance in Maze|Medium|nearest-exit-from-entrance-in-maze|
Graph|Number of Closed Islands|Medium|number-of-closed-islands|
Graph|Number of Enclaves|Medium|number-of-enclaves|
Graph|Number of Operations to Make Network Connected|Medium|number-of-operations-to-make-network-connected|
Graph|Number of Provinces|Medium|number-of-provinces|
Graph|Number of Ways to Arrive at Destination|Medium|number-of-ways-to-arrive-at-destination|
Graph|Open the Lock|Medium|open-the-lock|
Graph|Path With Minimum Effort|Medium|path-with-minimum-effort|
Graph|Path with Maximum Probability|Medium|path-with-maximum-probability|
Graph|Reorder Routes to Make All Paths Lead to the City Zero|Medium|reorder-routes-to-make-all-paths-lead-to-the-city-zero|
Graph|Satisfiability of Equality Equations|Medium|satisfiability-of-equality-equations|
Graph|Shortest Bridge|Medium|shortest-bridge|
Graph|Shortest Path in Binary Matrix|Medium|shortest-path-in-binary-matrix|
Graph|Shortest Path with Alternating Colors|Medium|shortest-path-with-alternating-colors|
Graph|Smallest String With Swaps|Medium|smallest-string-with-swaps|
Graph|Snakes and Ladders|Medium|snakes-and-ladders|
Graph|The Time When the Network Becomes Idle|Medium|the-time-when-the-network-becomes-idle|
Graph|Bus Routes|Hard|bus-routes|
Graph|Checking Existence of Edge Length Limited Paths|Hard|checking-existence-of-edge-length-limited-paths|
Graph|Critical Connections in a Network|Hard|critical-connections-in-a-network|
Graph|Escape the Spreading Fire|Hard|escape-the-spreading-fire|
Graph|Find Critical and Pseudo-Critical Edges in Minimum Spanning Tree|Hard|find-critical-and-pseudo-critical-edges-in-minimum-spanning-tree|
Graph|Making A Large Island|Hard|making-a-large-island|
Graph|Minimum Cost to Make at Least One Valid Path in a Grid|Hard|minimum-cost-to-make-at-least-one-valid-path-in-a-grid|
Graph|Minimum Cost to Reach Destination in Time|Hard|minimum-cost-to-reach-destination-in-time|
Graph|Minimum Moves to Move a Box to Their Target Location|Hard|minimum-moves-to-move-a-box-to-their-target-location|
Graph|Minimum Obstacle Removal to Reach Corner|Hard|minimum-obstacle-removal-to-reach-corner|
Graph|Parallel Courses III|Hard|parallel-courses-iii|
Graph|Redundant Connection II|Hard|redundant-connection-ii|
Graph|Remove Max Number of Edges to Keep Graph Fully Traversable|Hard|remove-max-number-of-edges-to-keep-graph-fully-traversable|
Graph|Shortest Path in a Grid with Obstacles Elimination|Hard|shortest-path-in-a-grid-with-obstacles-elimination|
Graph|Similar String Groups|Hard|similar-string-groups|
Graph|Sort Items by Groups Respecting Dependencies|Hard|sort-items-by-groups-respecting-dependencies|
Graph|Word Ladder II|Hard|word-ladder-ii|
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
Math|Determine Whether Matrix Can Be Obtained By Rotation|Easy|determine-whether-matrix-can-be-obtained-by-rotation|
Math|Flipping an Image|Easy|flipping-an-image|
Math|Matrix Diagonal Sum|Easy|matrix-diagonal-sum|
Math|Reshape the Matrix|Easy|reshape-the-matrix|
Math|Toeplitz Matrix|Easy|toeplitz-matrix|
Math|Transpose Matrix|Easy|transpose-matrix|
Math|Diagonal Traverse|Medium|diagonal-traverse|
Math|Spiral Matrix II|Medium|spiral-matrix-ii|
Math|Spiral Matrix III|Medium|spiral-matrix-iii|
Math|Spiral Matrix IV|Medium|spiral-matrix-iv|
Math|Game of Life|Medium|game-of-life|
Bit Manipulation|Single Number|Easy|single-number|
Bit Manipulation|Number of 1 Bits|Easy|number-of-1-bits|
Bit Manipulation|Counting Bits|Easy|counting-bits|
Bit Manipulation|Reverse Bits|Easy|reverse-bits|
Bit Manipulation|Missing Number|Easy|missing-number|
Bit Manipulation|Sum of Two Integers|Medium|sum-of-two-integers|
Bit Manipulation|Reverse Integer|Medium|reverse-integer|
Bit Manipulation|Count the Number of Consistent Strings|Easy|count-the-number-of-consistent-strings|
Bit Manipulation|Decode XORed Array|Easy|decode-xored-array|
Bit Manipulation|Find the Difference|Easy|find-the-difference|
Bit Manipulation|Hamming Distance|Easy|hamming-distance|
Bit Manipulation|Minimum Bit Flips to Convert Number|Easy|minimum-bit-flips-to-convert-number|
Bit Manipulation|Number Complement|Easy|number-complement|
Bit Manipulation|Power of Four|Easy|power-of-four|
Bit Manipulation|Power of Two|Easy|power-of-two|
Bit Manipulation|Set Mismatch|Easy|set-mismatch|
Bit Manipulation|XOR Operation in an Array|Easy|xor-operation-in-an-array|
Bit Manipulation|Bitwise AND of Numbers Range|Medium|bitwise-and-of-numbers-range|
Bit Manipulation|Count Triplets That Can Form Two Arrays of Equal XOR|Medium|count-triplets-that-can-form-two-arrays-of-equal-xor|
Bit Manipulation|Find The Original Array of Prefix Xor|Medium|find-the-original-array-of-prefix-xor|
Bit Manipulation|Maximum XOR of Two Numbers in an Array|Medium|maximum-xor-of-two-numbers-in-an-array|
Bit Manipulation|Single Number II|Medium|single-number-ii|
Bit Manipulation|Single Number III|Medium|single-number-iii|
Bit Manipulation|XOR Queries of a Subarray|Medium|xor-queries-of-a-subarray|
Intervals|Insert Interval|Medium|insert-interval|
Intervals|Merge Intervals|Medium|merge-intervals|
Intervals|Non-overlapping Intervals|Medium|non-overlapping-intervals|
Intervals|Meeting Rooms|Easy|meeting-rooms|
Intervals|Meeting Rooms II|Medium|meeting-rooms-ii|
Intervals|Minimum Interval to Include Each Query|Hard|minimum-interval-to-include-each-query|
Intervals|Maximum Population Year|Easy|maximum-population-year|
Intervals|Summary Ranges|Easy|summary-ranges|
Intervals|Car Pooling|Medium|car-pooling|
Intervals|Corporate Flight Bookings|Medium|corporate-flight-bookings|
Intervals|Describe the Painting|Medium|describe-the-painting|
Intervals|Maximum Length of Pair Chain|Medium|maximum-length-of-pair-chain|
Intervals|Minimum Number of Arrows to Burst Balloons|Medium|minimum-number-of-arrows-to-burst-balloons|
Intervals|Remove Covered Intervals|Medium|remove-covered-intervals|
Intervals|Video Stitching|Medium|video-stitching|
Intervals|Number of Flowers in Full Bloom|Hard|number-of-flowers-in-full-bloom|
Intervals|Russian Doll Envelopes|Hard|russian-doll-envelopes|
Intervals|The Skyline Problem|Hard|the-skyline-problem|
Intervals|My Calendar I|Medium|my-calendar-i|
Intervals|Data Stream as Disjoint Intervals|Hard|data-stream-as-disjoint-intervals|
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
