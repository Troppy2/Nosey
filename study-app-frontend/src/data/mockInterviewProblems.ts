export interface InterviewProblem {
  slug: string;
  title: string;
  difficulty: "Easy" | "Medium" | "Hard";
  topics: string[];
}

export type CompanyKey = "google" | "meta" | "amazon" | "apple" | "microsoft" | "netflix" | "random";

// Source: github.com/liquidslr/interview-company-wise-problems , sorted by interview frequency
// Top ~40 problems per company; database-only problems excluded

const GOOGLE: InterviewProblem[] = [
  { slug: "two-sum", title: "Two Sum", difficulty: "Easy", topics: ["Array", "Hash Table"] },
  { slug: "add-two-numbers", title: "Add Two Numbers", difficulty: "Medium", topics: ["Linked List", "Math"] },
  { slug: "trapping-rain-water", title: "Trapping Rain Water", difficulty: "Hard", topics: ["Two Pointers", "Stack"] },
  { slug: "median-of-two-sorted-arrays", title: "Median of Two Sorted Arrays", difficulty: "Hard", topics: ["Array", "Binary Search", "Divide and Conquer"] },
  { slug: "longest-substring-without-repeating-characters", title: "Longest Substring Without Repeating Characters", difficulty: "Medium", topics: ["Sliding Window", "Hash Table"] },
  { slug: "longest-common-prefix", title: "Longest Common Prefix", difficulty: "Easy", topics: ["String", "Trie"] },
  { slug: "valid-parentheses", title: "Valid Parentheses", difficulty: "Easy", topics: ["Stack", "String"] },
  { slug: "longest-consecutive-sequence", title: "Longest Consecutive Sequence", difficulty: "Medium", topics: ["Array", "Hash Table", "Union Find"] },
  { slug: "maximum-subarray", title: "Maximum Subarray", difficulty: "Medium", topics: ["Array", "Dynamic Programming"] },
  { slug: "rotate-image", title: "Rotate Image", difficulty: "Medium", topics: ["Array", "Math", "Matrix"] },
  { slug: "search-in-rotated-sorted-array", title: "Search in Rotated Sorted Array", difficulty: "Medium", topics: ["Array", "Binary Search"] },
  { slug: "reverse-linked-list", title: "Reverse Linked List", difficulty: "Easy", topics: ["Linked List"] },
  { slug: "4sum", title: "4Sum", difficulty: "Medium", topics: ["Array", "Two Pointers", "Sorting"] },
  { slug: "jump-game", title: "Jump Game", difficulty: "Medium", topics: ["Array", "Greedy", "Dynamic Programming"] },
  { slug: "group-anagrams", title: "Group Anagrams", difficulty: "Medium", topics: ["Array", "Hash Table", "String"] },
  { slug: "find-median-from-data-stream", title: "Find Median from Data Stream", difficulty: "Hard", topics: ["Heap", "Design"] },
  { slug: "pascals-triangle", title: "Pascal's Triangle", difficulty: "Easy", topics: ["Array", "Dynamic Programming"] },
  { slug: "single-number", title: "Single Number", difficulty: "Easy", topics: ["Array", "Bit Manipulation"] },
  { slug: "maximal-rectangle", title: "Maximal Rectangle", difficulty: "Hard", topics: ["Array", "Stack", "Matrix"] },
  { slug: "valid-anagram", title: "Valid Anagram", difficulty: "Easy", topics: ["Hash Table", "String"] },
  { slug: "first-missing-positive", title: "First Missing Positive", difficulty: "Hard", topics: ["Array", "Hash Table"] },
  { slug: "jump-game-ii", title: "Jump Game II", difficulty: "Medium", topics: ["Array", "Greedy", "Dynamic Programming"] },
  { slug: "add-binary", title: "Add Binary", difficulty: "Easy", topics: ["Math", "String", "Bit Manipulation"] },
  { slug: "text-justification", title: "Text Justification", difficulty: "Hard", topics: ["Array", "String"] },
  { slug: "insert-interval", title: "Insert Interval", difficulty: "Medium", topics: ["Array", "Sorting"] },
  { slug: "maximum-product-subarray", title: "Maximum Product Subarray", difficulty: "Medium", topics: ["Array", "Dynamic Programming"] },
  { slug: "same-tree", title: "Same Tree", difficulty: "Easy", topics: ["Tree", "DFS", "BFS"] },
  { slug: "search-a-2d-matrix", title: "Search a 2D Matrix", difficulty: "Medium", topics: ["Array", "Binary Search", "Matrix"] },
  { slug: "3sum-closest", title: "3Sum Closest", difficulty: "Medium", topics: ["Array", "Two Pointers", "Sorting"] },
  { slug: "wildcard-matching", title: "Wildcard Matching", difficulty: "Hard", topics: ["String", "Dynamic Programming", "Greedy"] },
  { slug: "find-the-duplicate-number", title: "Find the Duplicate Number", difficulty: "Medium", topics: ["Array", "Two Pointers", "Binary Search"] },
  { slug: "missing-number", title: "Missing Number", difficulty: "Easy", topics: ["Array", "Math", "Bit Manipulation"] },
  { slug: "symmetric-tree", title: "Symmetric Tree", difficulty: "Easy", topics: ["Tree", "DFS", "BFS"] },
  { slug: "minimum-path-sum", title: "Minimum Path Sum", difficulty: "Medium", topics: ["Array", "Dynamic Programming", "Matrix"] },
  { slug: "kth-smallest-element-in-a-bst", title: "Kth Smallest Element in a BST", difficulty: "Medium", topics: ["Tree", "DFS", "BST"] },
  { slug: "copy-list-with-random-pointer", title: "Copy List with Random Pointer", difficulty: "Medium", topics: ["Hash Table", "Linked List"] },
  { slug: "clone-graph", title: "Clone Graph", difficulty: "Medium", topics: ["Graph", "DFS", "BFS"] },
  { slug: "word-search-ii", title: "Word Search II", difficulty: "Hard", topics: ["Backtracking", "Trie", "Matrix"] },
  { slug: "binary-tree-right-side-view", title: "Binary Tree Right Side View", difficulty: "Medium", topics: ["Tree", "BFS", "DFS"] },
  { slug: "best-time-to-buy-and-sell-stock-with-cooldown", title: "Best Time to Buy and Sell Stock with Cooldown", difficulty: "Medium", topics: ["Array", "Dynamic Programming"] },
];

const META: InterviewProblem[] = [
  { slug: "merge-sorted-array", title: "Merge Sorted Array", difficulty: "Easy", topics: ["Array", "Two Pointers", "Sorting"] },
  { slug: "powx-n", title: "Pow(x, n)", difficulty: "Medium", topics: ["Math", "Recursion"] },
  { slug: "simplify-path", title: "Simplify Path", difficulty: "Medium", topics: ["String", "Stack"] },
  { slug: "merge-intervals", title: "Merge Intervals", difficulty: "Medium", topics: ["Array", "Sorting"] },
  { slug: "two-sum", title: "Two Sum", difficulty: "Easy", topics: ["Array", "Hash Table"] },
  { slug: "next-permutation", title: "Next Permutation", difficulty: "Medium", topics: ["Array", "Two Pointers"] },
  { slug: "merge-k-sorted-lists", title: "Merge k Sorted Lists", difficulty: "Hard", topics: ["Linked List", "Heap", "Divide and Conquer"] },
  { slug: "3sum", title: "3Sum", difficulty: "Medium", topics: ["Array", "Two Pointers", "Sorting"] },
  { slug: "find-first-and-last-position-of-element-in-sorted-array", title: "Find First and Last Position of Element in Sorted Array", difficulty: "Medium", topics: ["Array", "Binary Search"] },
  { slug: "valid-parentheses", title: "Valid Parentheses", difficulty: "Easy", topics: ["Stack", "String"] },
  { slug: "minimum-window-substring", title: "Minimum Window Substring", difficulty: "Hard", topics: ["Sliding Window", "Hash Table"] },
  { slug: "longest-common-prefix", title: "Longest Common Prefix", difficulty: "Easy", topics: ["String", "Trie"] },
  { slug: "add-two-numbers", title: "Add Two Numbers", difficulty: "Medium", topics: ["Linked List", "Math"] },
  { slug: "letter-combinations-of-a-phone-number", title: "Letter Combinations of a Phone Number", difficulty: "Medium", topics: ["Backtracking", "String"] },
  { slug: "subsets", title: "Subsets", difficulty: "Medium", topics: ["Array", "Backtracking"] },
  { slug: "remove-nth-node-from-end-of-list", title: "Remove Nth Node From End of List", difficulty: "Medium", topics: ["Linked List", "Two Pointers"] },
  { slug: "longest-substring-without-repeating-characters", title: "Longest Substring Without Repeating Characters", difficulty: "Medium", topics: ["Sliding Window", "Hash Table"] },
  { slug: "trapping-rain-water", title: "Trapping Rain Water", difficulty: "Hard", topics: ["Two Pointers", "Stack"] },
  { slug: "longest-palindromic-substring", title: "Longest Palindromic Substring", difficulty: "Medium", topics: ["Two Pointers", "String", "Dynamic Programming"] },
  { slug: "remove-duplicates-from-sorted-array", title: "Remove Duplicates from Sorted Array", difficulty: "Easy", topics: ["Array", "Two Pointers"] },
  { slug: "median-of-two-sorted-arrays", title: "Median of Two Sorted Arrays", difficulty: "Hard", topics: ["Array", "Binary Search", "Divide and Conquer"] },
  { slug: "search-in-rotated-sorted-array", title: "Search in Rotated Sorted Array", difficulty: "Medium", topics: ["Array", "Binary Search"] },
  { slug: "group-anagrams", title: "Group Anagrams", difficulty: "Medium", topics: ["Array", "Hash Table", "String"] },
  { slug: "climbing-stairs", title: "Climbing Stairs", difficulty: "Easy", topics: ["Math", "Dynamic Programming"] },
  { slug: "maximum-subarray", title: "Maximum Subarray", difficulty: "Medium", topics: ["Array", "Dynamic Programming"] },
  { slug: "container-with-most-water", title: "Container With Most Water", difficulty: "Medium", topics: ["Array", "Two Pointers", "Greedy"] },
  { slug: "set-matrix-zeroes", title: "Set Matrix Zeroes", difficulty: "Medium", topics: ["Array", "Hash Table", "Matrix"] },
  { slug: "word-search", title: "Word Search", difficulty: "Medium", topics: ["Array", "Backtracking", "DFS"] },
  { slug: "generate-parentheses", title: "Generate Parentheses", difficulty: "Medium", topics: ["String", "Backtracking"] },
  { slug: "rotate-image", title: "Rotate Image", difficulty: "Medium", topics: ["Array", "Math", "Matrix"] },
  { slug: "spiral-matrix", title: "Spiral Matrix", difficulty: "Medium", topics: ["Array", "Matrix"] },
  { slug: "regular-expression-matching", title: "Regular Expression Matching", difficulty: "Hard", topics: ["String", "Dynamic Programming", "Recursion"] },
  { slug: "insert-interval", title: "Insert Interval", difficulty: "Medium", topics: ["Array", "Sorting"] },
  { slug: "search-a-2d-matrix", title: "Search a 2D Matrix", difficulty: "Medium", topics: ["Array", "Binary Search", "Matrix"] },
  { slug: "binary-tree-zigzag-level-order-traversal", title: "Binary Tree Zigzag Level Order Traversal", difficulty: "Medium", topics: ["Tree", "BFS"] },
  { slug: "largest-rectangle-in-histogram", title: "Largest Rectangle in Histogram", difficulty: "Hard", topics: ["Array", "Stack", "Monotonic Stack"] },
  { slug: "binary-tree-level-order-traversal", title: "Binary Tree Level Order Traversal", difficulty: "Medium", topics: ["Tree", "BFS"] },
  { slug: "decode-ways", title: "Decode Ways", difficulty: "Medium", topics: ["String", "Dynamic Programming"] },
  { slug: "combination-sum", title: "Combination Sum", difficulty: "Medium", topics: ["Array", "Backtracking"] },
  { slug: "reverse-nodes-in-k-group", title: "Reverse Nodes in k-Group", difficulty: "Hard", topics: ["Linked List", "Recursion"] },
];

const AMAZON: InterviewProblem[] = [
  { slug: "two-sum", title: "Two Sum", difficulty: "Easy", topics: ["Array", "Hash Table"] },
  { slug: "trapping-rain-water", title: "Trapping Rain Water", difficulty: "Hard", topics: ["Two Pointers", "Stack"] },
  { slug: "longest-substring-without-repeating-characters", title: "Longest Substring Without Repeating Characters", difficulty: "Medium", topics: ["Sliding Window", "Hash Table"] },
  { slug: "merge-sorted-array", title: "Merge Sorted Array", difficulty: "Easy", topics: ["Array", "Two Pointers", "Sorting"] },
  { slug: "group-anagrams", title: "Group Anagrams", difficulty: "Medium", topics: ["Array", "Hash Table", "String"] },
  { slug: "add-two-numbers", title: "Add Two Numbers", difficulty: "Medium", topics: ["Linked List", "Math"] },
  { slug: "valid-parentheses", title: "Valid Parentheses", difficulty: "Easy", topics: ["Stack", "String"] },
  { slug: "longest-palindromic-substring", title: "Longest Palindromic Substring", difficulty: "Medium", topics: ["Two Pointers", "String", "Dynamic Programming"] },
  { slug: "3sum", title: "3Sum", difficulty: "Medium", topics: ["Array", "Two Pointers", "Sorting"] },
  { slug: "merge-intervals", title: "Merge Intervals", difficulty: "Medium", topics: ["Array", "Sorting"] },
  { slug: "median-of-two-sorted-arrays", title: "Median of Two Sorted Arrays", difficulty: "Hard", topics: ["Array", "Binary Search", "Divide and Conquer"] },
  { slug: "container-with-most-water", title: "Container With Most Water", difficulty: "Medium", topics: ["Array", "Two Pointers", "Greedy"] },
  { slug: "merge-k-sorted-lists", title: "Merge k Sorted Lists", difficulty: "Hard", topics: ["Linked List", "Heap", "Divide and Conquer"] },
  { slug: "maximum-subarray", title: "Maximum Subarray", difficulty: "Medium", topics: ["Array", "Dynamic Programming"] },
  { slug: "longest-common-prefix", title: "Longest Common Prefix", difficulty: "Easy", topics: ["String", "Trie"] },
  { slug: "climbing-stairs", title: "Climbing Stairs", difficulty: "Easy", topics: ["Math", "Dynamic Programming"] },
  { slug: "jump-game", title: "Jump Game", difficulty: "Medium", topics: ["Array", "Greedy", "Dynamic Programming"] },
  { slug: "generate-parentheses", title: "Generate Parentheses", difficulty: "Medium", topics: ["String", "Backtracking"] },
  { slug: "letter-combinations-of-a-phone-number", title: "Letter Combinations of a Phone Number", difficulty: "Medium", topics: ["Backtracking", "String"] },
  { slug: "spiral-matrix", title: "Spiral Matrix", difficulty: "Medium", topics: ["Array", "Matrix"] },
  { slug: "search-in-rotated-sorted-array", title: "Search in Rotated Sorted Array", difficulty: "Medium", topics: ["Array", "Binary Search"] },
  { slug: "largest-rectangle-in-histogram", title: "Largest Rectangle in Histogram", difficulty: "Hard", topics: ["Array", "Stack", "Monotonic Stack"] },
  { slug: "valid-sudoku", title: "Valid Sudoku", difficulty: "Medium", topics: ["Array", "Hash Table", "Matrix"] },
  { slug: "find-first-and-last-position-of-element-in-sorted-array", title: "Find First and Last Position of Element in Sorted Array", difficulty: "Medium", topics: ["Array", "Binary Search"] },
  { slug: "first-missing-positive", title: "First Missing Positive", difficulty: "Hard", topics: ["Array", "Hash Table"] },
  { slug: "jump-game-ii", title: "Jump Game II", difficulty: "Medium", topics: ["Array", "Greedy", "Dynamic Programming"] },
  { slug: "subsets", title: "Subsets", difficulty: "Medium", topics: ["Array", "Backtracking"] },
  { slug: "set-matrix-zeroes", title: "Set Matrix Zeroes", difficulty: "Medium", topics: ["Array", "Hash Table", "Matrix"] },
  { slug: "4sum", title: "4Sum", difficulty: "Medium", topics: ["Array", "Two Pointers", "Sorting"] },
  { slug: "reverse-nodes-in-k-group", title: "Reverse Nodes in k-Group", difficulty: "Hard", topics: ["Linked List", "Recursion"] },
  { slug: "powx-n", title: "Pow(x, n)", difficulty: "Medium", topics: ["Math", "Recursion"] },
  { slug: "unique-paths", title: "Unique Paths", difficulty: "Medium", topics: ["Math", "Dynamic Programming"] },
  { slug: "search-a-2d-matrix", title: "Search a 2D Matrix", difficulty: "Medium", topics: ["Array", "Binary Search", "Matrix"] },
  { slug: "regular-expression-matching", title: "Regular Expression Matching", difficulty: "Hard", topics: ["String", "Dynamic Programming", "Recursion"] },
  { slug: "minimum-window-substring", title: "Minimum Window Substring", difficulty: "Hard", topics: ["Sliding Window", "Hash Table"] },
  { slug: "validate-binary-search-tree", title: "Validate Binary Search Tree", difficulty: "Medium", topics: ["Tree", "DFS", "BST"] },
  { slug: "n-queens", title: "N-Queens", difficulty: "Hard", topics: ["Array", "Backtracking"] },
  { slug: "combination-sum", title: "Combination Sum", difficulty: "Medium", topics: ["Array", "Backtracking"] },
  { slug: "rotate-image", title: "Rotate Image", difficulty: "Medium", topics: ["Array", "Math", "Matrix"] },
  { slug: "next-permutation", title: "Next Permutation", difficulty: "Medium", topics: ["Array", "Two Pointers"] },
];

const APPLE: InterviewProblem[] = [
  { slug: "two-sum", title: "Two Sum", difficulty: "Easy", topics: ["Array", "Hash Table"] },
  { slug: "longest-substring-without-repeating-characters", title: "Longest Substring Without Repeating Characters", difficulty: "Medium", topics: ["Sliding Window", "Hash Table"] },
  { slug: "longest-common-prefix", title: "Longest Common Prefix", difficulty: "Easy", topics: ["String", "Trie"] },
  { slug: "valid-parentheses", title: "Valid Parentheses", difficulty: "Easy", topics: ["Stack", "String"] },
  { slug: "median-of-two-sorted-arrays", title: "Median of Two Sorted Arrays", difficulty: "Hard", topics: ["Array", "Binary Search", "Divide and Conquer"] },
  { slug: "merge-intervals", title: "Merge Intervals", difficulty: "Medium", topics: ["Array", "Sorting"] },
  { slug: "group-anagrams", title: "Group Anagrams", difficulty: "Medium", topics: ["Array", "Hash Table", "String"] },
  { slug: "merge-sorted-array", title: "Merge Sorted Array", difficulty: "Easy", topics: ["Array", "Two Pointers", "Sorting"] },
  { slug: "trapping-rain-water", title: "Trapping Rain Water", difficulty: "Hard", topics: ["Two Pointers", "Stack"] },
  { slug: "reverse-integer", title: "Reverse Integer", difficulty: "Medium", topics: ["Math"] },
  { slug: "valid-sudoku", title: "Valid Sudoku", difficulty: "Medium", topics: ["Array", "Hash Table", "Matrix"] },
  { slug: "climbing-stairs", title: "Climbing Stairs", difficulty: "Easy", topics: ["Math", "Dynamic Programming"] },
  { slug: "longest-palindromic-substring", title: "Longest Palindromic Substring", difficulty: "Medium", topics: ["Two Pointers", "String", "Dynamic Programming"] },
  { slug: "rotate-image", title: "Rotate Image", difficulty: "Medium", topics: ["Array", "Math", "Matrix"] },
  { slug: "spiral-matrix", title: "Spiral Matrix", difficulty: "Medium", topics: ["Array", "Matrix"] },
  { slug: "add-two-numbers", title: "Add Two Numbers", difficulty: "Medium", topics: ["Linked List", "Math"] },
  { slug: "3sum", title: "3Sum", difficulty: "Medium", topics: ["Array", "Two Pointers", "Sorting"] },
  { slug: "search-in-rotated-sorted-array", title: "Search in Rotated Sorted Array", difficulty: "Medium", topics: ["Array", "Binary Search"] },
  { slug: "maximum-subarray", title: "Maximum Subarray", difficulty: "Medium", topics: ["Array", "Dynamic Programming"] },
  { slug: "merge-two-sorted-lists", title: "Merge Two Sorted Lists", difficulty: "Easy", topics: ["Linked List"] },
  { slug: "generate-parentheses", title: "Generate Parentheses", difficulty: "Medium", topics: ["String", "Backtracking"] },
  { slug: "merge-k-sorted-lists", title: "Merge k Sorted Lists", difficulty: "Hard", topics: ["Linked List", "Heap", "Divide and Conquer"] },
  { slug: "container-with-most-water", title: "Container With Most Water", difficulty: "Medium", topics: ["Array", "Two Pointers", "Greedy"] },
  { slug: "letter-combinations-of-a-phone-number", title: "Letter Combinations of a Phone Number", difficulty: "Medium", topics: ["Backtracking", "String"] },
  { slug: "regular-expression-matching", title: "Regular Expression Matching", difficulty: "Hard", topics: ["String", "Dynamic Programming", "Recursion"] },
  { slug: "remove-nth-node-from-end-of-list", title: "Remove Nth Node From End of List", difficulty: "Medium", topics: ["Linked List", "Two Pointers"] },
  { slug: "insert-interval", title: "Insert Interval", difficulty: "Medium", topics: ["Array", "Sorting"] },
  { slug: "largest-rectangle-in-histogram", title: "Largest Rectangle in Histogram", difficulty: "Hard", topics: ["Array", "Stack", "Monotonic Stack"] },
  { slug: "permutations", title: "Permutations", difficulty: "Medium", topics: ["Array", "Backtracking"] },
  { slug: "maximum-depth-of-binary-tree", title: "Maximum Depth of Binary Tree", difficulty: "Easy", topics: ["Tree", "DFS", "BFS"] },
  { slug: "binary-tree-level-order-traversal", title: "Binary Tree Level Order Traversal", difficulty: "Medium", topics: ["Tree", "BFS"] },
  { slug: "find-first-and-last-position-of-element-in-sorted-array", title: "Find First and Last Position of Element in Sorted Array", difficulty: "Medium", topics: ["Array", "Binary Search"] },
  { slug: "combination-sum", title: "Combination Sum", difficulty: "Medium", topics: ["Array", "Backtracking"] },
  { slug: "jump-game", title: "Jump Game", difficulty: "Medium", topics: ["Array", "Greedy", "Dynamic Programming"] },
  { slug: "4sum", title: "4Sum", difficulty: "Medium", topics: ["Array", "Two Pointers", "Sorting"] },
  { slug: "validate-binary-search-tree", title: "Validate Binary Search Tree", difficulty: "Medium", topics: ["Tree", "DFS", "BST"] },
  { slug: "first-missing-positive", title: "First Missing Positive", difficulty: "Hard", topics: ["Array", "Hash Table"] },
  { slug: "minimum-window-substring", title: "Minimum Window Substring", difficulty: "Hard", topics: ["Sliding Window", "Hash Table"] },
  { slug: "word-search", title: "Word Search", difficulty: "Medium", topics: ["Array", "Backtracking", "DFS"] },
  { slug: "next-permutation", title: "Next Permutation", difficulty: "Medium", topics: ["Array", "Two Pointers"] },
];

const MICROSOFT: InterviewProblem[] = [
  { slug: "two-sum", title: "Two Sum", difficulty: "Easy", topics: ["Array", "Hash Table"] },
  { slug: "merge-sorted-array", title: "Merge Sorted Array", difficulty: "Easy", topics: ["Array", "Two Pointers", "Sorting"] },
  { slug: "longest-substring-without-repeating-characters", title: "Longest Substring Without Repeating Characters", difficulty: "Medium", topics: ["Sliding Window", "Hash Table"] },
  { slug: "add-two-numbers", title: "Add Two Numbers", difficulty: "Medium", topics: ["Linked List", "Math"] },
  { slug: "longest-palindromic-substring", title: "Longest Palindromic Substring", difficulty: "Medium", topics: ["Two Pointers", "String", "Dynamic Programming"] },
  { slug: "trapping-rain-water", title: "Trapping Rain Water", difficulty: "Hard", topics: ["Two Pointers", "Stack"] },
  { slug: "merge-intervals", title: "Merge Intervals", difficulty: "Medium", topics: ["Array", "Sorting"] },
  { slug: "valid-parentheses", title: "Valid Parentheses", difficulty: "Easy", topics: ["Stack", "String"] },
  { slug: "median-of-two-sorted-arrays", title: "Median of Two Sorted Arrays", difficulty: "Hard", topics: ["Array", "Binary Search", "Divide and Conquer"] },
  { slug: "maximum-subarray", title: "Maximum Subarray", difficulty: "Medium", topics: ["Array", "Dynamic Programming"] },
  { slug: "3sum", title: "3Sum", difficulty: "Medium", topics: ["Array", "Two Pointers", "Sorting"] },
  { slug: "group-anagrams", title: "Group Anagrams", difficulty: "Medium", topics: ["Array", "Hash Table", "String"] },
  { slug: "search-in-rotated-sorted-array", title: "Search in Rotated Sorted Array", difficulty: "Medium", topics: ["Array", "Binary Search"] },
  { slug: "reverse-nodes-in-k-group", title: "Reverse Nodes in k-Group", difficulty: "Hard", topics: ["Linked List", "Recursion"] },
  { slug: "merge-two-sorted-lists", title: "Merge Two Sorted Lists", difficulty: "Easy", topics: ["Linked List"] },
  { slug: "spiral-matrix", title: "Spiral Matrix", difficulty: "Medium", topics: ["Array", "Matrix"] },
  { slug: "climbing-stairs", title: "Climbing Stairs", difficulty: "Easy", topics: ["Math", "Dynamic Programming"] },
  { slug: "rotate-image", title: "Rotate Image", difficulty: "Medium", topics: ["Array", "Math", "Matrix"] },
  { slug: "container-with-most-water", title: "Container With Most Water", difficulty: "Medium", topics: ["Array", "Two Pointers", "Greedy"] },
  { slug: "merge-k-sorted-lists", title: "Merge k Sorted Lists", difficulty: "Hard", topics: ["Linked List", "Heap", "Divide and Conquer"] },
  { slug: "sort-colors", title: "Sort Colors", difficulty: "Medium", topics: ["Array", "Two Pointers", "Sorting"] },
  { slug: "set-matrix-zeroes", title: "Set Matrix Zeroes", difficulty: "Medium", topics: ["Array", "Hash Table", "Matrix"] },
  { slug: "letter-combinations-of-a-phone-number", title: "Letter Combinations of a Phone Number", difficulty: "Medium", topics: ["Backtracking", "String"] },
  { slug: "reverse-integer", title: "Reverse Integer", difficulty: "Medium", topics: ["Math"] },
  { slug: "word-search", title: "Word Search", difficulty: "Medium", topics: ["Array", "Backtracking", "DFS"] },
  { slug: "generate-parentheses", title: "Generate Parentheses", difficulty: "Medium", topics: ["String", "Backtracking"] },
  { slug: "jump-game", title: "Jump Game", difficulty: "Medium", topics: ["Array", "Greedy", "Dynamic Programming"] },
  { slug: "next-permutation", title: "Next Permutation", difficulty: "Medium", topics: ["Array", "Two Pointers"] },
  { slug: "minimum-path-sum", title: "Minimum Path Sum", difficulty: "Medium", topics: ["Array", "Dynamic Programming", "Matrix"] },
  { slug: "binary-tree-zigzag-level-order-traversal", title: "Binary Tree Zigzag Level Order Traversal", difficulty: "Medium", topics: ["Tree", "BFS"] },
  { slug: "validate-binary-search-tree", title: "Validate Binary Search Tree", difficulty: "Medium", topics: ["Tree", "DFS", "BST"] },
  { slug: "first-missing-positive", title: "First Missing Positive", difficulty: "Hard", topics: ["Array", "Hash Table"] },
  { slug: "combination-sum", title: "Combination Sum", difficulty: "Medium", topics: ["Array", "Backtracking"] },
  { slug: "find-first-and-last-position-of-element-in-sorted-array", title: "Find First and Last Position of Element in Sorted Array", difficulty: "Medium", topics: ["Array", "Binary Search"] },
  { slug: "largest-rectangle-in-histogram", title: "Largest Rectangle in Histogram", difficulty: "Hard", topics: ["Array", "Stack", "Monotonic Stack"] },
  { slug: "jump-game-ii", title: "Jump Game II", difficulty: "Medium", topics: ["Array", "Greedy", "Dynamic Programming"] },
  { slug: "permutations", title: "Permutations", difficulty: "Medium", topics: ["Array", "Backtracking"] },
  { slug: "unique-paths", title: "Unique Paths", difficulty: "Medium", topics: ["Math", "Dynamic Programming"] },
  { slug: "4sum", title: "4Sum", difficulty: "Medium", topics: ["Array", "Two Pointers", "Sorting"] },
  { slug: "edit-distance", title: "Edit Distance", difficulty: "Medium", topics: ["String", "Dynamic Programming"] },
];

const NETFLIX: InterviewProblem[] = [
  { slug: "top-k-frequent-elements", title: "Top K Frequent Elements", difficulty: "Medium", topics: ["Heap", "Bucket Sort"] },
  { slug: "design-twitter", title: "Design Twitter", difficulty: "Medium", topics: ["Design", "Heap"] },
  { slug: "sliding-window-maximum", title: "Sliding Window Maximum", difficulty: "Hard", topics: ["Deque", "Sliding Window"] },
  { slug: "encode-and-decode-strings", title: "Encode and Decode Strings", difficulty: "Medium", topics: ["String", "Design"] },
  { slug: "find-all-duplicates-in-an-array", title: "Find All Duplicates in an Array", difficulty: "Medium", topics: ["Array", "Hash Table"] },
  { slug: "task-scheduler", title: "Task Scheduler", difficulty: "Medium", topics: ["Greedy", "Heap"] },
  { slug: "maximum-profit-in-job-scheduling", title: "Maximum Profit in Job Scheduling", difficulty: "Hard", topics: ["Dynamic Programming", "Binary Search"] },
  { slug: "lfu-cache", title: "LFU Cache", difficulty: "Hard", topics: ["Design", "Hash Table"] },
  { slug: "insert-delete-getrandom-o1", title: "Insert Delete GetRandom O(1)", difficulty: "Medium", topics: ["Design", "Hash Table", "Randomized"] },
  { slug: "lru-cache", title: "LRU Cache", difficulty: "Medium", topics: ["Hash Table", "Linked List", "Design"] },
];

// All LeetCode problems in Nosey's study bank , used for the random pool.
// Format per line: slug|title|difficulty|topic1,topic2,...
const NOSEY_POOL_RAW = `
two-sum|Two Sum|Easy|Array,Hash Table
two-sum-ii-input-array-is-sorted|Two Sum II - Input Array Is Sorted|Medium|Array,Two Pointers
best-time-to-buy-and-sell-stock|Best Time to Buy and Sell Stock|Easy|Array,Dynamic Programming
maximum-subarray|Maximum Subarray|Medium|Array,Dynamic Programming
maximum-product-subarray|Maximum Product Subarray|Medium|Array,Dynamic Programming
container-with-most-water|Container With Most Water|Medium|Array,Two Pointers,Greedy
trapping-rain-water|Trapping Rain Water|Hard|Array,Two Pointers,Stack
move-zeroes|Move Zeroes|Easy|Array
find-all-numbers-disappeared-in-an-array|Find All Numbers Disappeared in an Array|Easy|Array,Hash Table
plus-one|Plus One|Easy|Array,Math
rotate-array|Rotate Array|Medium|Array
intersection-of-two-arrays-ii|Intersection of Two Arrays II|Easy|Array,Hash Table
3sum|3Sum|Medium|Array,Two Pointers,Sorting
4sum|4Sum|Medium|Array,Two Pointers,Sorting
subarray-sum-equals-k|Subarray Sum Equals K|Medium|Array,Hash Table,Prefix Sum
valid-anagram|Valid Anagram|Easy|Hash Table,String
valid-palindrome|Valid Palindrome|Easy|Two Pointers,String
valid-palindrome-ii|Valid Palindrome II|Easy|Two Pointers,String
longest-substring-without-repeating-characters|Longest Substring Without Repeating Characters|Medium|Sliding Window,Hash Table
longest-repeating-character-replacement|Longest Repeating Character Replacement|Medium|Sliding Window,String
permutation-in-string|Permutation in String|Medium|Sliding Window,Hash Table
minimum-window-substring|Minimum Window Substring|Hard|Sliding Window,Hash Table
reverse-string|Reverse String|Easy|String
group-anagrams|Group Anagrams|Medium|Array,Hash Table,String
word-pattern|Word Pattern|Easy|Hash Table,String
find-the-index-of-the-first-occurrence-in-a-string|Find the Index of the First Occurrence in a String|Easy|String
find-all-anagrams-in-a-string|Find All Anagrams in a String|Medium|Sliding Window,Hash Table
encode-and-decode-strings|Encode and Decode Strings|Medium|String,Design
decode-string|Decode String|Medium|Stack,String
decode-ways|Decode Ways|Medium|String,Dynamic Programming
interleaving-string|Interleaving String|Medium|String,Dynamic Programming
longest-palindromic-substring|Longest Palindromic Substring|Medium|Two Pointers,String,Dynamic Programming
palindromic-substrings|Palindromic Substrings|Medium|Two Pointers,Dynamic Programming
partition-labels|Partition Labels|Medium|String,Greedy
letter-combinations-of-a-phone-number|Letter Combinations of a Phone Number|Medium|Backtracking,String
regular-expression-matching|Regular Expression Matching|Hard|String,Dynamic Programming,Recursion
multiply-strings|Multiply Strings|Medium|Math,String
contains-duplicate|Contains Duplicate|Easy|Array,Hash Table
top-k-frequent-elements|Top K Frequent Elements|Medium|Hash Table,Heap
valid-sudoku|Valid Sudoku|Medium|Array,Hash Table,Matrix
happy-number|Happy Number|Easy|Hash Table,Math
design-add-and-search-words-data-structure|Design Add and Search Words Data Structure|Medium|Trie,Backtracking
find-the-duplicate-number|Find the Duplicate Number|Medium|Array,Hash Table
intersection-of-two-arrays|Intersection of Two Arrays|Easy|Array,Hash Table
first-missing-positive|First Missing Positive|Hard|Array,Hash Table
reverse-linked-list|Reverse Linked List|Easy|Linked List
reverse-linked-list-ii|Reverse Linked List II|Medium|Linked List
merge-two-sorted-lists|Merge Two Sorted Lists|Easy|Linked List
linked-list-cycle|Linked List Cycle|Easy|Linked List,Two Pointers
reorder-list|Reorder List|Medium|Linked List
remove-nth-node-from-end-of-list|Remove Nth Node From End of List|Medium|Linked List,Two Pointers
add-two-numbers|Add Two Numbers|Medium|Linked List,Math
copy-list-with-random-pointer|Copy List with Random Pointer|Medium|Hash Table,Linked List
merge-k-sorted-lists|Merge k Sorted Lists|Hard|Linked List,Heap,Divide and Conquer
reverse-nodes-in-k-group|Reverse Nodes in k-Group|Hard|Linked List,Recursion
remove-linked-list-elements|Remove Linked List Elements|Easy|Linked List
valid-parentheses|Valid Parentheses|Easy|Stack,String
min-stack|Min Stack|Medium|Stack,Design
evaluate-reverse-polish-notation|Evaluate Reverse Polish Notation|Medium|Stack,Math
daily-temperatures|Daily Temperatures|Medium|Stack,Monotonic Stack
largest-rectangle-in-histogram|Largest Rectangle in Histogram|Hard|Array,Stack,Monotonic Stack
asteroid-collision|Asteroid Collision|Medium|Array,Stack
next-greater-element-i|Next Greater Element I|Easy|Stack,Monotonic Stack
kth-largest-element-in-a-stream|Kth Largest Element in a Stream|Easy|Heap,Design
last-stone-weight|Last Stone Weight|Easy|Heap
k-closest-points-to-origin|K Closest Points to Origin|Medium|Heap,Sorting
kth-largest-element-in-an-array|Kth Largest Element in an Array|Medium|Heap,Sorting
task-scheduler|Task Scheduler|Medium|Greedy,Heap
find-median-from-data-stream|Find Median from Data Stream|Hard|Heap,Design
car-fleet|Car Fleet|Medium|Heap,Monotonic Stack
invert-binary-tree|Invert Binary Tree|Easy|Tree,DFS
maximum-depth-of-binary-tree|Maximum Depth of Binary Tree|Easy|Tree,DFS
diameter-of-binary-tree|Diameter of Binary Tree|Easy|Tree,DFS
balanced-binary-tree|Balanced Binary Tree|Easy|Tree,DFS
same-tree|Same Tree|Easy|Tree,DFS
subtree-of-another-tree|Subtree of Another Tree|Easy|Tree,DFS
lowest-common-ancestor-of-a-binary-search-tree|Lowest Common Ancestor of a Binary Search Tree|Medium|Tree,DFS,BST
binary-tree-level-order-traversal|Binary Tree Level Order Traversal|Medium|Tree,BFS
binary-tree-right-side-view|Binary Tree Right Side View|Medium|Tree,BFS,DFS
count-good-nodes-in-binary-tree|Count Good Nodes in Binary Tree|Medium|Tree,DFS
validate-binary-search-tree|Validate Binary Search Tree|Medium|Tree,DFS,BST
kth-smallest-element-in-a-bst|Kth Smallest Element in a BST|Medium|Tree,DFS,BST
construct-binary-tree-from-preorder-and-inorder-traversal|Construct Binary Tree from Preorder and Inorder Traversal|Medium|Tree,DFS,Divide and Conquer
binary-tree-maximum-path-sum|Binary Tree Maximum Path Sum|Hard|Tree,DFS
serialize-and-deserialize-binary-tree|Serialize and Deserialize Binary Tree|Hard|Tree,BFS,DFS
binary-search|Binary Search|Easy|Binary Search
search-a-2d-matrix|Search a 2D Matrix|Medium|Binary Search,Matrix
koko-eating-bananas|Koko Eating Bananas|Medium|Binary Search
find-minimum-in-rotated-sorted-array|Find Minimum in Rotated Sorted Array|Medium|Array,Binary Search
search-in-rotated-sorted-array|Search in Rotated Sorted Array|Medium|Array,Binary Search
median-of-two-sorted-arrays|Median of Two Sorted Arrays|Hard|Array,Binary Search,Divide and Conquer
find-first-and-last-position-of-element-in-sorted-array|Find First and Last Position of Element in Sorted Array|Medium|Array,Binary Search
minimum-size-subarray-sum|Minimum Size Subarray Sum|Medium|Sliding Window,Binary Search
sliding-window-maximum|Sliding Window Maximum|Hard|Sliding Window,Deque
find-k-closest-elements|Find K Closest Elements|Medium|Sliding Window,Binary Search
maximum-points-you-can-obtain-from-cards|Maximum Points You Can Obtain from Cards|Medium|Sliding Window,Array
continuous-subarray-sum|Continuous Subarray Sum|Medium|Array,Hash Table
climbing-stairs|Climbing Stairs|Easy|Dynamic Programming,Math
min-cost-climbing-stairs|Min Cost Climbing Stairs|Easy|Dynamic Programming
house-robber|House Robber|Medium|Dynamic Programming
house-robber-ii|House Robber II|Medium|Dynamic Programming
coin-change|Coin Change|Medium|Dynamic Programming
longest-increasing-subsequence|Longest Increasing Subsequence|Medium|Dynamic Programming,Binary Search
word-break|Word Break|Medium|Dynamic Programming,Trie
partition-equal-subset-sum|Partition Equal Subset Sum|Medium|Dynamic Programming
unique-paths|Unique Paths|Medium|Dynamic Programming,Math
longest-common-subsequence|Longest Common Subsequence|Medium|Dynamic Programming
best-time-to-buy-and-sell-stock-with-cooldown|Best Time to Buy and Sell Stock with Cooldown|Medium|Dynamic Programming
coin-change-ii|Coin Change II|Medium|Dynamic Programming
target-sum|Target Sum|Medium|Dynamic Programming,Backtracking
longest-increasing-path-in-a-matrix|Longest Increasing Path in a Matrix|Hard|Dynamic Programming,DFS
distinct-subsequences|Distinct Subsequences|Hard|Dynamic Programming
edit-distance|Edit Distance|Medium|Dynamic Programming
burst-balloons|Burst Balloons|Hard|Dynamic Programming
subsets|Subsets|Medium|Array,Backtracking
combination-sum|Combination Sum|Medium|Array,Backtracking
combination-sum-ii|Combination Sum II|Medium|Array,Backtracking
permutations|Permutations|Medium|Array,Backtracking
subsets-ii|Subsets II|Medium|Array,Backtracking
generate-parentheses|Generate Parentheses|Medium|String,Backtracking
word-search|Word Search|Medium|Array,Backtracking,DFS
palindrome-partitioning|Palindrome Partitioning|Medium|Backtracking,Dynamic Programming
n-queens|N-Queens|Hard|Array,Backtracking
restore-ip-addresses|Restore IP Addresses|Medium|String,Backtracking
number-of-islands|Number of Islands|Medium|Graph,BFS,DFS
max-area-of-island|Max Area of Island|Medium|Graph,DFS
clone-graph|Clone Graph|Medium|Graph,BFS,DFS
walls-and-gates|Walls and Gates|Medium|Graph,BFS
rotting-oranges|Rotting Oranges|Medium|Graph,BFS
pacific-atlantic-water-flow|Pacific Atlantic Water Flow|Medium|Graph,DFS,BFS
surrounded-regions|Surrounded Regions|Medium|Graph,DFS,Union Find
course-schedule|Course Schedule|Medium|Graph,Topological Sort
course-schedule-ii|Course Schedule II|Medium|Graph,Topological Sort
graph-valid-tree|Graph Valid Tree|Medium|Graph,Union Find
number-of-connected-components-in-an-undirected-graph|Number of Connected Components in an Undirected Graph|Medium|Graph,Union Find
redundant-connection|Redundant Connection|Medium|Graph,Union Find
word-ladder|Word Ladder|Hard|Graph,BFS
network-delay-time|Network Delay Time|Medium|Graph,Shortest Path
reconstruct-itinerary|Reconstruct Itinerary|Hard|Graph,DFS
min-cost-to-connect-all-points|Min Cost to Connect All Points|Medium|Graph,Minimum Spanning Tree
swim-in-rising-water|Swim in Rising Water|Hard|Graph,Binary Search
alien-dictionary|Alien Dictionary|Hard|Graph,Topological Sort
cheapest-flights-within-k-stops|Cheapest Flights Within K Stops|Medium|Graph,Dynamic Programming
lru-cache|LRU Cache|Medium|Design,Hash Table,Linked List
design-twitter|Design Twitter|Medium|Design,Heap
design-circular-queue|Design Circular Queue|Medium|Design
seat-reservation-manager|Seat Reservation Manager|Medium|Design,Heap
time-based-key-value-store|Time Based Key-Value Store|Medium|Design,Binary Search
implement-trie-prefix-tree|Implement Trie (Prefix Tree)|Medium|Trie,Design
word-search-ii|Word Search II|Hard|Trie,Backtracking
rotate-image|Rotate Image|Medium|Array,Math,Matrix
spiral-matrix|Spiral Matrix|Medium|Array,Matrix
set-matrix-zeroes|Set Matrix Zeroes|Medium|Array,Hash Table,Matrix
powx-n|Pow(x, n)|Medium|Math,Recursion
detect-squares|Detect Squares|Medium|Math,Design
single-number|Single Number|Easy|Array,Bit Manipulation
number-of-1-bits|Number of 1 Bits|Easy|Bit Manipulation
counting-bits|Counting Bits|Easy|Bit Manipulation
reverse-bits|Reverse Bits|Easy|Bit Manipulation
missing-number|Missing Number|Easy|Array,Bit Manipulation
sum-of-two-integers|Sum of Two Integers|Medium|Bit Manipulation,Math
reverse-integer|Reverse Integer|Medium|Math
insert-interval|Insert Interval|Medium|Array,Intervals
merge-intervals|Merge Intervals|Medium|Array,Intervals,Sorting
non-overlapping-intervals|Non-overlapping Intervals|Medium|Array,Intervals
meeting-rooms|Meeting Rooms|Easy|Array,Intervals,Sorting
meeting-rooms-ii|Meeting Rooms II|Medium|Array,Intervals,Heap
minimum-interval-to-include-each-query|Minimum Interval to Include Each Query|Hard|Array,Intervals
`.trim();

const NOSEY_PROBLEMS: InterviewProblem[] = NOSEY_POOL_RAW.split("\n").map((line) => {
  const [slug, title, difficulty, topicsStr] = line.split("|");
  return {
    slug,
    title,
    difficulty: difficulty as "Easy" | "Medium" | "Hard",
    topics: topicsStr.split(","),
  };
});

const PROBLEM_POOLS: Record<CompanyKey, InterviewProblem[]> = {
  google: GOOGLE,
  meta: META,
  amazon: AMAZON,
  apple: APPLE,
  microsoft: MICROSOFT,
  netflix: NETFLIX,
  random: NOSEY_PROBLEMS,
};

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pickProblems(company: CompanyKey, count = 3): InterviewProblem[] {
  const pool = PROBLEM_POOLS[company] ?? PROBLEM_POOLS.random;
  const hard = pool.filter((p) => p.difficulty === "Hard");
  const medium = pool.filter((p) => p.difficulty === "Medium");
  const easy = pool.filter((p) => p.difficulty === "Easy");
  const candidates = [...shuffled(hard), ...shuffled(medium), ...shuffled(easy)];
  return candidates.slice(0, count);
}

export const COMPANY_OPTIONS = [
  { key: "google" as CompanyKey, label: "Google" },
  { key: "meta" as CompanyKey, label: "Meta" },
  { key: "amazon" as CompanyKey, label: "Amazon" },
  { key: "apple" as CompanyKey, label: "Apple" },
  { key: "microsoft" as CompanyKey, label: "Microsoft" },
  { key: "netflix" as CompanyKey, label: "Netflix" },
  { key: "random" as CompanyKey, label: "Random" },
];
