import Editor, { type Monaco } from "@monaco-editor/react";
import {
  AlertCircle,
  ArrowRight,
  Binary,
  BookOpen,
  Bot,
  Braces,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Circle,
  Eye,
  Code2,
  ExternalLink,
  Flame,
  Youtube,
  GitBranch,
  Hash,
  Layers3,
  Link2,
  ListChecks,
  Loader2,
  Network,
  PanelRightOpen,
  Play,
  Plus,
  Route,
  Search,
  Send,
  Sparkles,
  Trophy,
  Users,
  WrapText,
  X,
  type LucideIcon,
  Code,
  Timer,
  Notebook,
  Pencil,
  Trash2,
  Wand2,
  Archive,
  ArchiveRestore,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MarkdownContent } from "../components/MarkdownContent";
import { ConfirmModal } from "../components/ConfirmModal";
import CodingTabs from "../components/Tab";
import { SlashCommandMenu, type CommandOption as SlashCommand } from "../components/SlashCommandMenu";
import {
  fetchLCNotes,
  fetchLCProgress,
  fetchLCWorkspace,
  fetchLCWorkspaces,
  getStoredUser,
  isGuestSession,
  syncLCNotes,
  syncLCProgress,
  syncLCWorkspace,
  fetchLeetCodeHint,
  fetchLeetCodeProblem,
  gradeLeetCodeSubmission,
  fetchLCCustomProblems,
  syncLCCustomProblem,
  deleteLCCustomProblem,
  generateLCCustomProblem,
} from "../lib/api";
import { runPythonLeetCode, traceLeetCodeExecution, type RunnerResult, type TraceResult } from "../lib/pyodideRunner";
import { sanitizeLeetCodeHtml } from "../lib/leetcodeHtml";
import { ExecutionVisualizer } from "../components/ExecutionVisualizer";
import { Link } from "react-router-dom";
import type { LeetCodeProblemData, LCCustomProblem, LCCustomTestCase, LCGeneratedCustomProblem } from "../lib/types";
import { useSettings } from "../lib/useSettings";

type Difficulty = "Easy" | "Medium" | "Hard" | "Reference" | "Unknown";
type Filter = "all" | "todo" | "done";

type Problem = {
  categoryId: string;
  categoryLabel: string;
  title: string;
  difficulty: Difficulty;
  slug: string;
  url: string;
  isExtra: boolean;
  isOfficial: boolean;
};

type Category = {
  id: string;
  label: string;
  icon: LucideIcon;
  accent: string;
  problems: Problem[];
};

type View =
  | { type: "tree" }
  | { type: "category"; categoryId: string }
  | { type: "problem"; categoryId: string; problemSlug: string };

type CachedProblemState = {
  data?: LeetCodeProblemData;
  loading: boolean;
  error?: string;
};

type CustomCase = {
  id: string;
  inputText: string;
  expectedOutput: string;
};

type CodeTab = {
  id: string;
  name: string;
  code: string;
};

type CodeWorkspace = {
  tabs: CodeTab[];
  activeTabId: string;
};

function getUserStoragePrefix(): string {
  const user = getStoredUser();
  return user ? `u${user.id}` : "guest";
}

function getProgressKey(): string {
  return `${getUserStoragePrefix()}:nosey_lc_progress`;
}

function getActivityKey(): string {
  return `${getUserStoragePrefix()}:nosey_lc_activity_dates`;
}
const LEETCODE_BASE_URL = "https://leetcode.com/problems";
const CUSTOM_CATEGORY_ID = "custom";
const CUSTOM_CATEGORY_LABEL = "Custom Questions";
const CUSTOM_PROBLEMS_KEY_PREFIX = "nosey_lc_custom_problems";
const CUSTOM_TEST_LIMIT = 2;
const MAX_CODE_TABS = 5;
const CODE_TAB_ID_KEY = "nosey_lc_tab_id";
const CODE_WORKSPACE_KEY_PREFIX = "nosey_lc_code_tabs";
const CODE_KEY_PREFIX = "nosey_lc_code";
const TIMER_PRESETS = [15, 25, 45];
const NOTES_KEY_PREFIX = "nosey_lc_notes";

const CHAT_COMMANDS: SlashCommand[] = [
  { slash: "/hint", label: "Hint", description: "Get the next nudge without the full answer.", prompt: "Give me one focused hint. Do not give me the full solution." },
  { slash: "/approach", label: "Approach", description: "Talk through the right algorithmic direction.", prompt: "Help me think through the best high-level approach for this problem." },
  { slash: "/edge-cases", label: "Edge Cases", description: "Point out tricky inputs I should test.", prompt: "What edge cases am I likely missing here?" },
  { slash: "/complexity", label: "Complexity", description: "Discuss runtime and memory tradeoffs.", prompt: "How should I think about the time and space complexity here?" },
  { slash: "/debug", label: "Debug", description: "Review my current code for the next bug to inspect.", prompt: "Help me debug my current code. Point me to the bug without rewriting the full answer." },
  { slash: "/dry-run", label: "Dry Run", description: "Walk one example through my current logic.", prompt: "Can you dry-run one official example against my current logic and show where it goes wrong?" },
];

const CATEGORY_META: Record<string, Omit<Category, "problems">> = {
  arrays: { id: "arrays", label: "Arrays", icon: ListChecks, accent: "#16a34a" },
  strings: { id: "strings", label: "Strings", icon: Braces, accent: "#0891b2" },
  "hash-table": { id: "hash-table", label: "Hash Table", icon: Hash, accent: "#7c3aed" },
  "linked-list": { id: "linked-list", label: "Linked List", icon: Link2, accent: "#d97706" },
  stack: { id: "stack", label: "Stack", icon: Layers3, accent: "#dc2626" },
  "heap-priority-queue": { id: "heap-priority-queue", label: "Heap / Priority Queue", icon: PanelRightOpen, accent: "#2563eb" },
  tree: { id: "tree", label: "Tree", icon: GitBranch, accent: "#15803d" },
  "binary-search": { id: "binary-search", label: "Binary Search", icon: Search, accent: "#0f766e" },
  "sliding-window": { id: "sliding-window", label: "Sliding Window", icon: Route, accent: "#ea580c" },
  dp: { id: "dp", label: "Dynamic Programming", icon: Binary, accent: "#9333ea" },
  backtracking: { id: "backtracking", label: "Backtracking", icon: GitBranch, accent: "#be123c" },
  graph: { id: "graph", label: "Graph", icon: Network, accent: "#0284c7" },
  design: { id: "design", label: "Design", icon: BookOpen, accent: "#ca8a04" },
  advanced: { id: "advanced", label: "Advanced", icon: Trophy, accent: "#4f46e5" },
  math: { id: "math", label: "Math", icon: Calculator, accent: "#059669" },
  "bit-manipulation": { id: "bit-manipulation", label: "Bit Manipulation", icon: Code2, accent: "#64748b" },
  intervals: { id: "intervals", label: "Intervals", icon: PanelRightOpen, accent: "#b45309" },
  extra: { id: "extra", label: "Extra", icon: Trophy, accent: "#db2777" },
};

const PROBLEM_ROWS = `
Arrays|Two Sum|Easy|two-sum|
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

function toId(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function buildCategories(): Category[] {
  const grouped = new Map<string, Problem[]>();
  PROBLEM_ROWS.trim().split("\n").forEach((line) => {
    const [categoryLabel, title, difficulty, slug, extra] = line.split("|");
    const categoryId = toId(categoryLabel);
    const isOfficial = Boolean(slug);
    const problem: Problem = {
      categoryId,
      categoryLabel,
      title,
      difficulty: difficulty as Difficulty,
      slug: slug || toId(title),
      url: isOfficial ? `${LEETCODE_BASE_URL}/${slug}/` : "https://leetcode.com/tag/shortest-path/",
      isExtra: extra === "extra",
      isOfficial,
    };
    grouped.set(categoryId, [...(grouped.get(categoryId) ?? []), problem]);
  });

  return Array.from(grouped.entries()).map(([id, problems]) => {
    const meta = CATEGORY_META[id] ?? { id, label: problems[0]?.categoryLabel ?? id, icon: Code2, accent: "#718355" };
    return { ...meta, problems };
  });
}

const CATEGORIES = buildCategories();
const ALL_PROBLEMS = CATEGORIES.flatMap((category) => category.problems);
const UNIQUE_PROBLEMS = Array.from(new Map(ALL_PROBLEMS.map((problem) => [problem.slug, problem])).values());

function loadJson<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "") as T;
  } catch {
    return fallback;
  }
}

function saveProgress(progress: Record<string, boolean>) {
  localStorage.setItem(getProgressKey(), JSON.stringify(progress));
}

function saveActivityDates(dates: string[]) {
  localStorage.setItem(getActivityKey(), JSON.stringify(dates));
}

function getCustomProblemsKey(): string {
  return `${CUSTOM_PROBLEMS_KEY_PREFIX}:${getUserStoragePrefix()}`;
}

function loadCustomProblems(): LCCustomProblem[] {
  const raw = loadJson<LCCustomProblem[]>(getCustomProblemsKey(), []);
  return Array.isArray(raw) ? raw.filter((item) => item && typeof item.slug === "string") : [];
}

function saveCustomProblems(problems: LCCustomProblem[]) {
  localStorage.setItem(getCustomProblemsKey(), JSON.stringify(problems));
}

function makeCustomSlug(): string {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `custom-${id}`;
}

function customDifficulty(value: string): Difficulty {
  return value === "Easy" || value === "Medium" || value === "Hard" ? value : "Unknown";
}

// A custom problem's topic is a comma-separated list of patterns (e.g. "Sliding Window,
// Hash Map"). Split it into trimmed, de-duped, non-"unknown" labels for chip display.
function splitTopics(topic: string | undefined): string[] {
  if (!topic) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of topic.split(",")) {
    const name = part.trim();
    const key = name.toLowerCase();
    if (!name || key === "unknown" || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

// Turn a stored custom problem into the local Problem shape the views already render.
function customToProblem(cp: LCCustomProblem): Problem {
  return {
    categoryId: CUSTOM_CATEGORY_ID,
    categoryLabel: CUSTOM_CATEGORY_LABEL,
    title: cp.title,
    difficulty: customDifficulty(cp.difficulty),
    slug: cp.slug,
    url: cp.url || "https://leetcode.com/problemset/",
    isExtra: false,
    isOfficial: false,
  };
}

// Synthesize the LeetCodeProblemData the problem view expects (examples from the
// user's test cases, starter code as the runnable snippet) so custom problems run
// through the exact same Run/Grade/Visualize path as official ones.
function customToProblemData(cp: LCCustomProblem): LeetCodeProblemData {
  return {
    title: cp.title,
    title_slug: cp.slug,
    difficulty: cp.difficulty === "unknown" ? "" : cp.difficulty,
    content_html: "",
    examples: cp.test_cases.map((tc, index) => ({
      index: index + 1,
      input_text: tc.input_text,
      output_text: tc.output_text,
      explanation_text: tc.explanation_text ?? null,
    })),
    example_testcases: [],
    python_snippet: cp.starter_code,
    topic_tags: splitTopics(cp.topic).map((name) => ({ name, slug: name })),
  };
}

type CustomFormState = {
  title: string;
  topic: string;
  difficulty: LCCustomProblem["difficulty"];
  description: string;
  url: string;
  starterCode: string;
  testCases: LCCustomTestCase[];
};

const EMPTY_CUSTOM_FORM: CustomFormState = {
  title: "",
  topic: "unknown",
  difficulty: "unknown",
  description: "",
  url: "",
  starterCode: "",
  testCases: [],
};

function getTabStorageId() {
  if (typeof window === "undefined") return "server";

  const existing = sessionStorage.getItem(CODE_TAB_ID_KEY);
  if (existing) return existing;

  const tabId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  sessionStorage.setItem(CODE_TAB_ID_KEY, tabId);
  return tabId;
}

function makeTabId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getCodeWorkspaceKey(problemSlug: string) {
  return `${CODE_WORKSPACE_KEY_PREFIX}:${getUserStoragePrefix()}:${problemSlug}`;
}

function createDefaultWorkspace(initialCode = ""): CodeWorkspace {
  const firstTab = {
    id: makeTabId(),
    name: "Tab 1",
    code: initialCode,
  };

  return {
    tabs: [firstTab],
    activeTabId: firstTab.id,
  };
}

function normalizeCodeWorkspace(value: unknown): CodeWorkspace | null {
  if (!value || typeof value !== "object") return null;

  const rawWorkspace = value as Partial<CodeWorkspace>;
  const tabs = Array.isArray(rawWorkspace.tabs)
    ? rawWorkspace.tabs
      .filter((tab): tab is CodeTab => Boolean(tab) && typeof tab.id === "string" && typeof tab.name === "string" && typeof tab.code === "string")
      .map((tab) => ({ id: tab.id, name: tab.name, code: tab.code }))
    : [];

  if (!tabs.length) return null;

  const activeTabId = typeof rawWorkspace.activeTabId === "string" && tabs.some((tab) => tab.id === rawWorkspace.activeTabId)
    ? rawWorkspace.activeTabId
    : tabs[0].id;

  return { tabs, activeTabId };
}

function saveCodeWorkspace(problemSlug: string, workspace: CodeWorkspace) {
  localStorage.setItem(getCodeWorkspaceKey(problemSlug), JSON.stringify(workspace));
}

function loadCodeWorkspace(problemSlug: string): CodeWorkspace {
  const userPrefix = getUserStoragePrefix();
  const stableKey = `${CODE_WORKSPACE_KEY_PREFIX}:${userPrefix}:${problemSlug}`;

  // 1. New stable key (no tabId)
  const stableRaw = localStorage.getItem(stableKey);
  if (stableRaw) {
    try {
      const parsed = normalizeCodeWorkspace(JSON.parse(stableRaw));
      if (parsed) return parsed;
    } catch { /* fall through */ }
  }

  // 2. Legacy tabId-scoped workspace keys (scan for longest code)
  const wsPrefix = `${CODE_WORKSPACE_KEY_PREFIX}:${userPrefix}:`;
  const slugSuffix = `:${problemSlug}`;
  let bestWorkspace: CodeWorkspace | null = null;
  let bestCodeLen = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || key === stableKey) continue;
    if (key.startsWith(wsPrefix) && key.endsWith(slugSuffix)) {
      try {
        const parsed = normalizeCodeWorkspace(JSON.parse(localStorage.getItem(key) ?? ""));
        if (parsed) {
          const totalCode = parsed.tabs.reduce((sum, tab) => sum + tab.code.length, 0);
          if (totalCode > bestCodeLen) {
            bestCodeLen = totalCode;
            bestWorkspace = parsed;
          }
        }
      } catch { /* skip */ }
    }
  }
  if (bestWorkspace) return bestWorkspace;

  // 3. Legacy single-code keys (pre-workspace format, any tabId variant)
  const codePrefix = `${CODE_KEY_PREFIX}:${userPrefix}:`;
  let bestCode = "";
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(codePrefix)) continue;
    if (key.endsWith(`:${problemSlug}`) || key === `${codePrefix}${problemSlug}`) {
      const val = localStorage.getItem(key) ?? "";
      if (val.length > bestCode.length) bestCode = val;
    }
  }
  if (bestCode) return createDefaultWorkspace(bestCode);

  return createDefaultWorkspace();
}

function todayKey() {
  return new Date().toLocaleDateString("en-CA");
}

function countStreak(dates: string[]) {
  const dateSet = new Set(dates);
  let count = 0;
  const cursor = new Date();
  // If today isn't solved yet, count from yesterday , user has until midnight to maintain streak
  if (!dateSet.has(cursor.toLocaleDateString("en-CA"))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (dateSet.has(cursor.toLocaleDateString("en-CA"))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

function streakExpiresIn(): string {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const msLeft = midnight.getTime() - now.getTime();
  const hours = Math.floor(msLeft / 3600000);
  const minutes = Math.floor((msLeft % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function countBestStreak(dates: string[]) {
  const sorted = Array.from(new Set(dates)).sort();
  let best = 0;
  let current = 0;
  let previous: Date | null = null;
  sorted.forEach((date) => {
    const next = new Date(`${date}T00:00:00`);
    if (previous) {
      const diff = Math.round((next.getTime() - previous.getTime()) / 86400000);
      current = diff === 1 ? current + 1 : 1;
    } else {
      current = 1;
    }
    best = Math.max(best, current);
    previous = next;
  });
  return best;
}

function difficultyClass(difficulty: Difficulty) {
  return difficulty.toLowerCase();
}

function filterProblems(problems: Problem[], progress: Record<string, boolean>, filter: Filter, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  return problems.filter((problem) => {
    const done = Boolean(progress[problem.slug]);
    const matchesFilter = filter === "all" || (filter === "done" ? done : !done);
    const matchesQuery = !normalizedQuery || problem.title.toLowerCase().includes(normalizedQuery);
    return matchesFilter && matchesQuery;
  });
}

function isRunnable(problemData?: LeetCodeProblemData) {
  const snippet = problemData?.python_snippet ?? "";
  // A runnable problem just needs some code and at least one example/test case. The
  // runner accepts either a `class Solution` or a bare top-level function, so custom
  // problems built from a pasted function run too.
  return Boolean(snippet.trim()) && Boolean(problemData?.examples.length);
}


export default function LeetCodeMode() {
  const { generationProvider } = useSettings();
  const [view, setView] = useState<View>({ type: "tree" });
  const [customProblems, setCustomProblems] = useState<LCCustomProblem[]>(() => loadCustomProblems());
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [customForm, setCustomForm] = useState<CustomFormState>(EMPTY_CUSTOM_FORM);
  const [customSaving, setCustomSaving] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);
  const [pendingDeleteSlug, setPendingDeleteSlug] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [aiCode, setAiCode] = useState("");
  const [aiHint, setAiHint] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<"problem" | "code">("problem");
  const [progress, setProgress] = useState<Record<string, boolean>>(() => loadJson(getProgressKey(), {}));
  const [activityDates, setActivityDates] = useState<string[]>(() => loadJson(getActivityKey(), []));
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [codeWorkspaces, setCodeWorkspaces] = useState<Record<string, CodeWorkspace>>({});
  const [problemStates, setProblemStates] = useState<Record<string, CachedProblemState>>({});
  const [customCases, setCustomCases] = useState<Record<string, CustomCase[]>>({});
  const [runnerLoading, setRunnerLoading] = useState(false);
  const [runnerResult, setRunnerResult] = useState<RunnerResult | null>(null);
  const [gradeLoading, setGradeLoading] = useState(false);
  const [gradeFeedback, setGradeFeedback] = useState<string | null>(null);
  const [timerMinutesInput, setTimerMinutesInput] = useState("25");
  const [timerRemainingSeconds, setTimerRemainingSeconds] = useState<number | null>(null);
  const [timerPickerOpen, setTimerPickerOpen] = useState(false);
  const [timeoutModalOpen, setTimeoutModalOpen] = useState(false);
  const [timeoutModalMessage, setTimeoutModalMessage] = useState<string | null>(null);
  const [solutionOpen, setSolutionOpen] = useState(false);
  const [visualizerTrace, setVisualizerTrace] = useState<TraceResult | null>(null);
  const [visualizerLoading, setVisualizerLoading] = useState<string | null>(null);
  const [kojoOpen, setKojoOpen] = useState(false);
  const [kojoInput, setKojoInput] = useState("");
  const [kojoResponse, setKojoResponse] = useState<string | null>(null);
  const [kojoLoading, setKojoLoading] = useState(false);
  const [kojoError, setKojoError] = useState<string | null>(null);
  const editorRef = useRef<any>(null);
  const currentCodeRef = useRef("");
  const currentProblemDataRef = useRef<LeetCodeProblemData | undefined>(undefined);
  const currentCustomCasesRef = useRef<CustomCase[]>([]);
  const timerExpiryHandledRef = useRef(false);
  const workspaceSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingWorkspaceSyncRef = useRef<{ slug: string; workspace: CodeWorkspace } | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesContent, setNotesContent] = useState("");
  const [notesPos, setNotesPos] = useState<{ x: number; y: number } | null>(null);
  const notesSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notesDragOffset = useRef<{ x: number; y: number } | null>(null);

  // Full list (active + archived) backs deep-link lookups so an archived problem can
  // still be opened directly. The active/archived splits below back the list views.
  const allCustomProblemList = useMemo(() => customProblems.map(customToProblem), [customProblems]);
  const activeCustomProblems = useMemo(() => customProblems.filter((cp) => !cp.is_archived), [customProblems]);
  const archivedCustomProblems = useMemo(() => customProblems.filter((cp) => cp.is_archived), [customProblems]);
  const customProblemList = useMemo(() => activeCustomProblems.map(customToProblem), [activeCustomProblems]);
  const archivedProblemList = useMemo(() => archivedCustomProblems.map(customToProblem), [archivedCustomProblems]);

  const currentProblem =
    view.type === "problem"
      ? (view.categoryId === CUSTOM_CATEGORY_ID
          ? allCustomProblemList.find((problem) => problem.slug === view.problemSlug) ?? null
          : CATEGORIES.find((category) => category.id === view.categoryId)?.problems.find((problem) => problem.slug === view.problemSlug) ?? null)
      : null;

  const currentCustomProblem = currentProblem
    ? customProblems.find((cp) => cp.slug === currentProblem.slug) ?? null
    : null;
  const isCustomProblem = Boolean(currentCustomProblem);
  const currentProblemState = currentProblem ? problemStates[currentProblem.slug] : undefined;
  const currentProblemData = currentCustomProblem ? customToProblemData(currentCustomProblem) : currentProblemState?.data;
  const currentCustomCases = currentProblem ? customCases[currentProblem.slug] ?? [] : [];
  const currentCodeWorkspace = currentProblem ? codeWorkspaces[currentProblem.slug] ?? null : null;
  const currentCodeTab = currentCodeWorkspace?.tabs.find((tab) => tab.id === currentCodeWorkspace.activeTabId) ?? currentCodeWorkspace?.tabs[0] ?? null;
  const currentCode = currentCodeTab?.code ?? "";
  const kojoShowsCommands = kojoOpen && kojoInput.trimStart().startsWith("/");
  const timerButtonLabel = timerRemainingSeconds == null ? "Timer" : `${Math.floor(timerRemainingSeconds / 60)}:${String(timerRemainingSeconds % 60).padStart(2, "0")}`;

  useEffect(() => {
    currentCodeRef.current = currentCode;
  }, [currentCode]);

  useEffect(() => {
    currentProblemDataRef.current = currentProblemData;
  }, [currentProblemData]);

  // Flush any pending debounced workspace sync on unmount, page hide, or tab close
  useEffect(() => {
    function flushPending() {
      if (!pendingWorkspaceSyncRef.current || isGuestSession()) return;
      const { slug, workspace } = pendingWorkspaceSyncRef.current;
      syncLCWorkspace(slug, workspace).catch(() => {});
      pendingWorkspaceSyncRef.current = null;
      if (workspaceSyncTimerRef.current) {
        clearTimeout(workspaceSyncTimerRef.current);
        workspaceSyncTimerRef.current = null;
      }
    }
    const handleBeforeUnload = () => flushPending();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushPending();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      flushPending();
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // On mount: bulk-fetch all DB workspaces and reconcile with localStorage.
  // This pre-populates the stable per-slug localStorage keys so that code
  // survives closing a browser tab (which previously cleared sessionStorage,
  // orphaning the tabId-scoped key and losing the save).
  useEffect(() => {
    if (isGuestSession()) return;
    fetchLCWorkspaces()
      .then((dbMap) => {
        const userPrefix = getUserStoragePrefix();
        const wsKeyPrefix = `${CODE_WORKSPACE_KEY_PREFIX}:${userPrefix}:`;

        // Build best-per-slug workspace from all localStorage keys for this user
        const localBestBySlug = new Map<string, CodeWorkspace>();
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key || !key.startsWith(wsKeyPrefix)) continue;
          const after = key.slice(wsKeyPrefix.length);
          // slug is the last colon-separated segment (legacy keys have tabId before slug)
          const lastColon = after.lastIndexOf(":");
          const slug = lastColon >= 0 ? after.slice(lastColon + 1) : after;
          if (!slug) continue;
          try {
            const parsed = normalizeCodeWorkspace(JSON.parse(localStorage.getItem(key) ?? ""));
            if (!parsed) continue;
            const newLen = parsed.tabs.reduce((s, t) => s + t.code.length, 0);
            const existingBest = localBestBySlug.get(slug);
            const existingLen = existingBest ? existingBest.tabs.reduce((s, t) => s + t.code.length, 0) : 0;
            if (newLen > existingLen) localBestBySlug.set(slug, parsed);
          } catch { /* skip */ }
        }

        const allSlugs = new Set([...Object.keys(dbMap), ...localBestBySlug.keys()]);
        for (const slug of allSlugs) {
          const stableKey = `${wsKeyPrefix}${slug}`;
          const localBest = localBestBySlug.get(slug);
          const dbWorkspace = dbMap[slug] ? normalizeCodeWorkspace(dbMap[slug]) : null;
          const localLen = localBest ? localBest.tabs.reduce((s, t) => s + t.code.length, 0) : 0;
          const dbLen = dbWorkspace ? dbWorkspace.tabs.reduce((s, t) => s + t.code.length, 0) : 0;

          if (dbLen > 0 && localLen === 0) {
            // DB has code, local empty: write DB to stable localStorage key
            localStorage.setItem(stableKey, JSON.stringify(dbWorkspace));
          } else if (localLen > 0 && localBest) {
            // Local has code: ensure stable key is populated
            if (!localStorage.getItem(stableKey)) {
              localStorage.setItem(stableKey, JSON.stringify(localBest));
            }
            // Push to DB if local has more code than DB (covers orphaned tabId-scoped code)
            if (localLen > dbLen) {
              syncLCWorkspace(slug, localBest).catch(() => {});
            }
          }
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On mount: fetch DB progress/dates, merge with localStorage, push merged result back
  useEffect(() => {
    if (isGuestSession()) return;
    fetchLCProgress()
      .then(({ progress: dbProgress, activity_dates: dbDates }) => {
        setProgress((localProgress) => {
          const merged: Record<string, boolean> = { ...localProgress };
          for (const [slug, done] of Object.entries(dbProgress)) {
            merged[slug] = (merged[slug] ?? false) || done;
          }
          saveProgress(merged);
          return merged;
        });
        setActivityDates((localDates) => {
          const merged = Array.from(new Set([...localDates, ...dbDates]));
          saveActivityDates(merged);
          return merged;
        });
      })
      .catch(() => { });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On mount: pull custom problems from DB and reconcile with localStorage. DB wins on
  // overlap; any local-only entries (created while a prior sync failed) get pushed up.
  useEffect(() => {
    if (isGuestSession()) return;
    fetchLCCustomProblems()
      .then((dbProblems) => {
        setCustomProblems((local) => {
          const bySlug = new Map<string, LCCustomProblem>();
          for (const item of local) bySlug.set(item.slug, item);
          const localOnly: LCCustomProblem[] = [];
          for (const item of local) {
            if (!dbProblems.some((db) => db.slug === item.slug)) localOnly.push(item);
          }
          for (const db of dbProblems) bySlug.set(db.slug, db);
          for (const item of localOnly) {
            const { slug, ...rest } = item;
            syncLCCustomProblem(slug, rest).catch(() => {});
          }
          const merged = Array.from(bySlug.values());
          saveCustomProblems(merged);
          return merged;
        });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Seed starter snippet after async fetch completes (first open when cache is cold)
  useEffect(() => {
    if (!currentProblem || !currentProblemData?.python_snippet) return;
    const snippet = currentProblemData.python_snippet.trimEnd();
    if (!snippet) return;

    setCodeWorkspaces((prev) => {
      const workspace = prev[currentProblem.slug] ?? loadCodeWorkspace(currentProblem.slug);
      const firstTab = workspace.tabs[0];
      if (!firstTab || firstTab.code.trim()) return prev;
      const nextWorkspace = {
        ...workspace,
        tabs: workspace.tabs.map((tab, i) => (i === 0 ? { ...tab, code: snippet } : tab)),
      };
      saveCodeWorkspace(currentProblem.slug, nextWorkspace);
      return { ...prev, [currentProblem.slug]: nextWorkspace };
    });
  }, [currentProblemData?.python_snippet, currentProblem?.slug]);

  useEffect(() => {
    currentCustomCasesRef.current = currentCustomCases;
  }, [currentCustomCases]);

  useEffect(() => {
    if (!currentProblem || !currentProblem.isOfficial) return;
    if (problemStates[currentProblem.slug]?.data || problemStates[currentProblem.slug]?.loading) return;

    setProblemStates((prev) => ({ ...prev, [currentProblem.slug]: { loading: true } }));
    fetchLeetCodeProblem(currentProblem.slug)
      .then((data) => {
        setProblemStates((prev) => ({ ...prev, [currentProblem.slug]: { loading: false, data } }));
      })
      .catch((error) => {
        setProblemStates((prev) => ({
          ...prev,
          [currentProblem.slug]: {
            loading: false,
            error: error instanceof Error ? error.message : "Unable to load the official problem statement.",
          },
        }));
      });
  }, [currentProblem, problemStates]);

  useEffect(() => {
    if (!currentProblem || timerRemainingSeconds == null || timeoutModalOpen) return;
    if (timerRemainingSeconds <= 0) return;

    const timeoutId = window.setTimeout(() => {
      setTimerRemainingSeconds((previous) => (previous == null ? previous : Math.max(previous - 1, 0)));
    }, 1000);

    return () => window.clearTimeout(timeoutId);
  }, [currentProblem?.slug, timerRemainingSeconds, timeoutModalOpen]);

  useEffect(() => {
    if (!currentProblem || timerRemainingSeconds == null || timerRemainingSeconds > 0 || timeoutModalOpen) return;
    if (timerExpiryHandledRef.current) return;

    timerExpiryHandledRef.current = true;
    void handleTimerExpired(currentProblem);
  }, [currentProblem?.slug, timerRemainingSeconds, timeoutModalOpen]);

  const stats = useMemo(() => {
    const solved = UNIQUE_PROBLEMS.filter((problem) => progress[problem.slug]);
    return {
      total: UNIQUE_PROBLEMS.length,
      solved: solved.length,
      percent: UNIQUE_PROBLEMS.length ? Math.round((solved.length / UNIQUE_PROBLEMS.length) * 100) : 0,
      easy: solved.filter((problem) => problem.difficulty === "Easy").length,
      medium: solved.filter((problem) => problem.difficulty === "Medium").length,
      hard: solved.filter((problem) => problem.difficulty === "Hard").length,
      currentStreak: countStreak(activityDates),
      bestStreak: countBestStreak(activityDates),
    };
  }, [activityDates, progress]);

  function pushProgressToDb(nextProgress: Record<string, boolean>, nextDates: string[]) {
    if (isGuestSession()) return;
    syncLCProgress({ progress: nextProgress, activity_dates: nextDates }).catch(() => { });
  }

  function pushWorkspaceToDb(problemSlug: string, workspace: CodeWorkspace) {
    if (isGuestSession()) return;
    syncLCWorkspace(problemSlug, workspace).catch(() => { });
  }

  function schedulePushWorkspaceToDb(problemSlug: string, workspace: CodeWorkspace) {
    if (isGuestSession()) return;
    pendingWorkspaceSyncRef.current = { slug: problemSlug, workspace };
    if (workspaceSyncTimerRef.current) clearTimeout(workspaceSyncTimerRef.current);
    workspaceSyncTimerRef.current = setTimeout(() => {
      syncLCWorkspace(problemSlug, workspace).catch(() => { });
      pendingWorkspaceSyncRef.current = null;
    }, 1500);
  }

  function recordSolvedToday(): string[] {
    const nextDates = [...activityDates, todayKey()];
    setActivityDates(nextDates);
    saveActivityDates(nextDates);
    return nextDates;
  }

  function toggleProgress(problem: Problem) {
    const nextDone = !progress[problem.slug];
    const next = { ...progress, [problem.slug]: nextDone };
    setProgress(next);
    saveProgress(next);
    const nextDates = nextDone ? recordSolvedToday() : activityDates;
    pushProgressToDb(next, nextDates);
  }

  function markProblemDone(problem: Problem) {
    if (progress[problem.slug]) return;
    const next = { ...progress, [problem.slug]: true };
    setProgress(next);
    saveProgress(next);
    const nextDates = recordSolvedToday();
    pushProgressToDb(next, nextDates);
  }

  // ── Custom problem handlers ─────────────────────────────────────────────────

  function openCustomModal(existing?: LCCustomProblem) {
    setCustomError(null);
    setAiError(null);
    setAiHint("");
    if (existing) {
      setEditingSlug(existing.slug);
      setCustomForm({
        title: existing.title,
        topic: existing.topic || "unknown",
        difficulty: existing.difficulty || "unknown",
        description: existing.description,
        url: existing.url,
        starterCode: existing.starter_code,
        testCases: existing.test_cases.map((tc) => ({ ...tc })),
      });
      setAiCode(existing.starter_code);
    } else {
      setEditingSlug(null);
      setCustomForm(EMPTY_CUSTOM_FORM);
      setAiCode("");
    }
    setCustomModalOpen(true);
  }

  function closeCustomModal() {
    setCustomModalOpen(false);
    setEditingSlug(null);
    setCustomForm(EMPTY_CUSTOM_FORM);
    setAiCode("");
    setAiHint("");
    setAiError(null);
    setCustomError(null);
    setCustomSaving(false);
    setAiLoading(false);
  }

  function persistCustomProblems(next: LCCustomProblem[]) {
    setCustomProblems(next);
    saveCustomProblems(next);
  }

  async function runCustomAiGenerate() {
    if (aiLoading) return;
    if (!aiCode.trim() && !aiHint.trim()) {
      setAiError("Paste your function (or describe the problem) first.");
      return;
    }
    setAiLoading(true);
    setAiError(null);
    try {
      const generated: LCGeneratedCustomProblem = await generateLCCustomProblem(aiCode, aiHint, generationProvider);
      setCustomForm((prev) => ({
        title: generated.title || prev.title,
        topic: generated.topic || prev.topic || "unknown",
        difficulty: generated.difficulty || prev.difficulty || "unknown",
        description: generated.description || prev.description,
        url: prev.url,
        starterCode: generated.starter_code || aiCode || prev.starterCode,
        testCases: generated.test_cases.length ? generated.test_cases.map((tc) => ({ ...tc })) : prev.testCases,
      }));
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "Generation failed. Try again.");
    } finally {
      setAiLoading(false);
    }
  }

  function updateCustomForm<K extends keyof CustomFormState>(field: K, value: CustomFormState[K]) {
    setCustomForm((prev) => ({ ...prev, [field]: value }));
  }

  function addFormTestCase() {
    setCustomForm((prev) => ({
      ...prev,
      testCases: [...prev.testCases, { input_text: "", output_text: "", explanation_text: "" }],
    }));
  }

  function updateFormTestCase(index: number, field: keyof LCCustomTestCase, value: string) {
    setCustomForm((prev) => ({
      ...prev,
      testCases: prev.testCases.map((tc, i) => (i === index ? { ...tc, [field]: value } : tc)),
    }));
  }

  function removeFormTestCase(index: number) {
    setCustomForm((prev) => ({ ...prev, testCases: prev.testCases.filter((_, i) => i !== index) }));
  }

  async function saveCustomProblem() {
    if (customSaving) return;
    const title = customForm.title.trim();
    if (!title) {
      setCustomError("Give the problem a title.");
      return;
    }
    setCustomSaving(true);
    setCustomError(null);

    const slug = editingSlug ?? makeCustomSlug();
    // Editing must not silently un-archive: preserve the existing flag.
    const existingArchived = editingSlug
      ? customProblems.find((cp) => cp.slug === slug)?.is_archived ?? false
      : false;
    const payload: Omit<LCCustomProblem, "slug"> = {
      title,
      topic: customForm.topic.trim() || "unknown",
      difficulty: customForm.difficulty || "unknown",
      description: customForm.description,
      url: customForm.url.trim(),
      starter_code: customForm.starterCode,
      test_cases: customForm.testCases
        .filter((tc) => tc.input_text.trim() || tc.output_text.trim())
        .map((tc) => ({
          input_text: tc.input_text,
          output_text: tc.output_text,
          explanation_text: tc.explanation_text || null,
        })),
      is_archived: existingArchived,
    };

    const saved: LCCustomProblem = { slug, ...payload };
    const next = editingSlug
      ? customProblems.map((cp) => (cp.slug === slug ? saved : cp))
      : [...customProblems, saved];
    persistCustomProblems(next);

    if (!isGuestSession()) {
      try {
        await syncLCCustomProblem(slug, payload);
      } catch {
        // Best-effort like the rest of LC sync; localStorage already holds it.
      }
    }
    setCustomSaving(false);
    closeCustomModal();
  }

  function handleDeleteCustomProblem(slug: string) {
    setPendingDeleteSlug(slug);
  }

  function confirmDeleteCustomProblem() {
    const slug = pendingDeleteSlug;
    if (!slug) return;
    persistCustomProblems(customProblems.filter((cp) => cp.slug !== slug));
    if (!isGuestSession()) {
      deleteLCCustomProblem(slug).catch(() => {});
    }
    setPendingDeleteSlug(null);
    if (view.type === "problem" && view.problemSlug === slug) {
      setView({ type: "category", categoryId: CUSTOM_CATEGORY_ID });
    }
  }

  // Soft-archive: keep the problem (and its progress/workspace) but hide it from the
  // active list. Reuses the existing full-object sync so no new endpoint is needed.
  function setCustomProblemArchived(slug: string, archived: boolean) {
    const target = customProblems.find((cp) => cp.slug === slug);
    if (!target) return;
    const updated: LCCustomProblem = { ...target, is_archived: archived };
    persistCustomProblems(customProblems.map((cp) => (cp.slug === slug ? updated : cp)));
    if (!isGuestSession()) {
      const { slug: _slug, ...rest } = updated;
      syncLCCustomProblem(slug, rest).catch(() => {});
    }
    // If the archived problem is open, drop back to the custom list.
    if (archived && view.type === "problem" && view.problemSlug === slug) {
      setView({ type: "category", categoryId: CUSTOM_CATEGORY_ID });
    }
  }

  function closeTimerPicker() {
    setTimerPickerOpen(false);
  }

  function closeTimeoutModal() {
    setTimeoutModalOpen(false);
    setTimeoutModalMessage(null);
  }

  function resetTimerState() {
    timerExpiryHandledRef.current = false;
    setTimerRemainingSeconds(null);
    closeTimerPicker();
    closeTimeoutModal();
  }

  function startTimer(minutes: number) {
    if (!currentProblem || !Number.isFinite(minutes) || minutes <= 0) return;

    timerExpiryHandledRef.current = false;
    closeTimerPicker();
    closeTimeoutModal();
    setTimerRemainingSeconds(Math.round(minutes * 60));
  }

  function openTimerPicker() {
    setTimerPickerOpen(true);
  }

  function applyTimerFromInput() {
    const parsed = Number(timerMinutesInput);
    if (!Number.isFinite(parsed) || parsed <= 0) return;

    startTimer(parsed);
    setTimerMinutesInput(String(Math.round(parsed)));
  }

  function getNotesKey(problemSlug: string) {
    return `${NOTES_KEY_PREFIX}:${getUserStoragePrefix()}:${problemSlug}`;
  }

  function openNotes(problemSlug: string) {
    const local = localStorage.getItem(getNotesKey(problemSlug)) ?? "";
    setNotesContent(local);
    setNotesPos({ x: window.innerWidth - 520, y: Math.max(24, window.innerHeight - 580) });
    setNotesOpen(true);
    if (!local && !isGuestSession()) {
      fetchLCNotes(problemSlug).then((remote) => {
        if (!remote) return;
        localStorage.setItem(getNotesKey(problemSlug), remote);
        setNotesContent(remote);
      }).catch(() => {});
    }
  }

  function handleNotesDragStart(event: React.MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    const modal = (event.currentTarget as HTMLElement).closest(".lc-notes-modal") as HTMLElement | null;
    if (!modal) return;
    const rect = modal.getBoundingClientRect();
    notesDragOffset.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };

    function onMove(moveEvent: MouseEvent) {
      if (!notesDragOffset.current) return;
      const x = Math.max(0, Math.min(window.innerWidth - rect.width, moveEvent.clientX - notesDragOffset.current.x));
      const y = Math.max(0, Math.min(window.innerHeight - 60, moveEvent.clientY - notesDragOffset.current.y));
      setNotesPos({ x, y });
    }

    function onUp() {
      notesDragOffset.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function handleNotesChange(problemSlug: string, value: string) {
    setNotesContent(value);
    localStorage.setItem(getNotesKey(problemSlug), value);
    if (!isGuestSession()) {
      if (notesSyncTimerRef.current) clearTimeout(notesSyncTimerRef.current);
      notesSyncTimerRef.current = setTimeout(() => {
        syncLCNotes(problemSlug, value).catch(() => {});
      }, 1500);
    }
  }

  function clearActiveTabWork() {
    if (!currentProblem) return;
    const slug = currentProblem.slug;
    const workspace = codeWorkspaces[slug] ?? loadCodeWorkspace(slug);
    const nextWorkspace = {
      ...workspace,
      tabs: workspace.tabs.map((tab) => (tab.id === workspace.activeTabId ? { ...tab, code: "" } : tab)),
    };
    saveCodeWorkspace(slug, nextWorkspace);
    pushWorkspaceToDb(slug, nextWorkspace);
    setCodeWorkspaces((prev) => ({ ...prev, [slug]: nextWorkspace }));
  }

  async function runAndGradeCurrentCode(
    problemAtRun: Problem,
    codeToRun: string,
    problemDataAtRun: LeetCodeProblemData | undefined,
    customCasesAtRun: CustomCase[],
  ) {
    if (!problemDataAtRun || !isRunnable(problemDataAtRun)) return null;

    const officialCases = problemDataAtRun.examples.map((example) => ({
      label: `Official ${example.index}`,
      inputText: example.input_text,
      expectedOutput: example.output_text,
    }));
    const validCustomCases = customCasesAtRun
      .filter((item) => item.inputText.trim() && item.expectedOutput.trim())
      .map((item, index) => ({
        label: `Custom ${index + 1}`,
        inputText: item.inputText.trim(),
        expectedOutput: item.expectedOutput.trim(),
      }));

    setRunnerLoading(true);
    setRunnerResult(null);
    setGradeFeedback(null);
    try {
      const result = await runPythonLeetCode(codeToRun, [...officialCases, ...validCustomCases]);
      setRunnerResult(result);

      if (result.cases?.length) {
        setGradeLoading(true);
        const testResultsSummary = JSON.stringify(
          result.cases.map((c) => ({
            label: c.label,
            passed: c.passed,
            actual: c.actual,
            expected: c.expected,
          })),
        );
        try {
          const customForGrade = customProblems.find((cp) => cp.slug === problemAtRun.slug);
          const grade = await gradeLeetCodeSubmission(
            problemAtRun.slug,
            problemAtRun.title,
            codeToRun,
            testResultsSummary,
            result.ok,
            generationProvider,
            customForGrade?.description || undefined,
          );
          setGradeFeedback(grade.feedback);
        } catch {
          // grading is best-effort , don't block the run result
        } finally {
          setGradeLoading(false);
        }
      }

      if (result.ok) {
        markProblemDone(problemAtRun);
      }

      return result;
    } finally {
      setRunnerLoading(false);
    }
  }

  function renderTimerPreset(minutes: number) {
    return (
      <button
        key={minutes}
        type="button"
        className="lc-timer-modal-preset"
        onClick={() => {
          setTimerMinutesInput(String(minutes));
          startTimer(minutes);
        }}
      >
        {minutes}m
      </button>
    );
  }

  async function handleTimerExpired(problemAtTimeout: Problem) {
    if (runnerLoading || gradeLoading) {
      setTimeoutModalMessage("Time ran out while Kojo was still grading your current run. You can continue without the timer or clear the active tab.");
      setTimeoutModalOpen(true);
      return;
    }

    const result = await runAndGradeCurrentCode(
      problemAtTimeout,
      currentCodeRef.current,
      currentProblemDataRef.current,
      currentCustomCasesRef.current,
    );

    if (result?.ok) {
      resetTimerState();
      return;
    }

    setTimeoutModalMessage("Time's up. Kojo graded your attempt and it still needs more work.");
    setTimeoutModalOpen(true);
  }

  function openProblem(categoryId: string, problemSlug: string) {
    const cached = problemStates[problemSlug]?.data;
    const initialCode = cached?.python_snippet?.trimEnd() ?? "";
    const workspace = loadCodeWorkspace(problemSlug);
    const hasLocalCode = workspace.tabs.some((tab) => tab.code.trim());

    if (!workspace.tabs.length || (!workspace.tabs[0].code.trim() && initialCode.trim())) {
      const starter = initialCode;
      const nextWorkspace = {
        tabs: [{ id: workspace.tabs[0]?.id ?? makeTabId(), name: workspace.tabs[0]?.name ?? "Tab 1", code: starter }, ...workspace.tabs.slice(1)],
        activeTabId: workspace.activeTabId,
      };
      const normalizedWorkspace = normalizeCodeWorkspace(nextWorkspace) ?? createDefaultWorkspace(starter);
      setCodeWorkspaces((prev) => ({ ...prev, [problemSlug]: normalizedWorkspace }));
      saveCodeWorkspace(problemSlug, normalizedWorkspace);
    } else {
      setCodeWorkspaces((prev) => ({ ...prev, [problemSlug]: workspace }));
    }

    // DB fallback: if localStorage has no user code, fetch from DB (cross-device restore).
    // When hasLocalCode is false, any code in the editor at callback time is app-seeded
    // (starter code or empty), not user-typed. DB wins unconditionally to prevent the
    // seeding effect from shadowing a saved solution.
    if (!hasLocalCode && !initialCode.trim() && !isGuestSession()) {
      fetchLCWorkspace(problemSlug)
        .then((result) => {
          if (!result?.workspace) return;
          const parsed = normalizeCodeWorkspace(result.workspace);
          if (!parsed || !parsed.tabs.some((tab) => tab.code.trim())) return;
          setCodeWorkspaces((prev) => {
            saveCodeWorkspace(problemSlug, parsed);
            return { ...prev, [problemSlug]: parsed };
          });
        })
        .catch(() => { });
    }

    setView({ type: "problem", categoryId, problemSlug });
    setMobilePane("problem");
    setKojoOpen(false);
    setSolutionOpen(false);
    setRunnerResult(null);
    setGradeFeedback(null);
    setKojoResponse(null);
    setKojoError(null);
    resetTimerState();
  }

  function handleCodeChange(value: string) {
    if (!currentProblem) return;
    const slug = currentProblem.slug;
    const workspace = codeWorkspaces[slug] ?? loadCodeWorkspace(slug);
    const nextWorkspace = {
      ...workspace,
      tabs: workspace.tabs.map((tab) => (tab.id === workspace.activeTabId ? { ...tab, code: value } : tab)),
    };
    saveCodeWorkspace(slug, nextWorkspace);
    schedulePushWorkspaceToDb(slug, nextWorkspace);
    setCodeWorkspaces((prev) => ({ ...prev, [slug]: nextWorkspace }));
  }

  function handleAddCodeTab() {
    if (!currentProblem) return;
    const slug = currentProblem.slug;
    const workspace = codeWorkspaces[slug] ?? loadCodeWorkspace(slug);
    if (workspace.tabs.length >= MAX_CODE_TABS) return;

    const nextTab = { id: makeTabId(), name: `Tab ${workspace.tabs.length + 1}`, code: "" };
    const nextWorkspace = { tabs: [...workspace.tabs, nextTab], activeTabId: nextTab.id };
    saveCodeWorkspace(slug, nextWorkspace);
    pushWorkspaceToDb(slug, nextWorkspace);
    setCodeWorkspaces((prev) => ({ ...prev, [slug]: nextWorkspace }));
  }

  function handleDeleteCodeTab(tabId: string) {
    if (!currentProblem) return;
    const slug = currentProblem.slug;
    const workspace = codeWorkspaces[slug] ?? loadCodeWorkspace(slug);

    let nextWorkspace: CodeWorkspace;
    if (workspace.tabs.length <= 1) {
      nextWorkspace = createDefaultWorkspace("");
    } else {
      const tabIndex = workspace.tabs.findIndex((tab) => tab.id === tabId);
      if (tabIndex < 0) return;
      const nextTabs = workspace.tabs.filter((tab) => tab.id !== tabId);
      const nextActiveTabId = workspace.activeTabId === tabId
        ? nextTabs[Math.max(0, tabIndex - 1)]?.id ?? nextTabs[0].id
        : workspace.activeTabId;
      nextWorkspace = { tabs: nextTabs, activeTabId: nextActiveTabId };
    }

    saveCodeWorkspace(slug, nextWorkspace);
    pushWorkspaceToDb(slug, nextWorkspace);
    setCodeWorkspaces((prev) => ({ ...prev, [slug]: nextWorkspace }));
  }

  function handleSelectCodeTab(tabId: string) {
    if (!currentProblem) return;
    const slug = currentProblem.slug;
    const workspace = codeWorkspaces[slug] ?? loadCodeWorkspace(slug);
    if (workspace.activeTabId === tabId) return;
    const nextWorkspace = { ...workspace, activeTabId: tabId };
    saveCodeWorkspace(slug, nextWorkspace);
    pushWorkspaceToDb(slug, nextWorkspace);
    setCodeWorkspaces((prev) => ({ ...prev, [slug]: nextWorkspace }));
  }

  function handleFormat() {
    editorRef.current?.getAction("editor.action.formatDocument")?.run();
  }

  function handleMonacoMount(editor: any, monaco: Monaco) {
    editorRef.current = editor;
    monaco.languages.registerDocumentFormattingEditProvider("python", {
      provideDocumentFormattingEdits(model: Monaco['editor']['ITextModel']) {
        const lines = model.getValue().split("\n").map((l: string) => l.trimEnd());
        const result: string[] = [];
        let blanks = 0;
        for (const line of lines) {
          if (line === "") {
            blanks++;
            if (blanks <= 2) result.push(line);
          } else {
            blanks = 0;
            result.push(line);
          }
        }
        while (result.length > 0 && result[result.length - 1] === "") result.pop();
        result.push("");
        return [{ range: model.getFullModelRange(), text: result.join("\n") }];
      },
    });
  }

  function openKojo(problem: Problem) {
    setKojoOpen(true);
    setKojoResponse(null);
    setKojoError(null);
    setKojoInput(`I'm stuck on ${problem.title}. Give me one hint without solving it for me.`);
  }

  function selectKojoCommand(command: SlashCommand) {
    setKojoInput("");
    void handleKojoSend(command.prompt);
  }

  async function handleKojoSend(messageOverride?: string) {
    const message = (messageOverride ?? kojoInput).trim();
    if (!currentProblem || !message || kojoLoading) return;
    setKojoLoading(true);
    setKojoError(null);
    setKojoResponse(null);
    try {
      const result = await fetchLeetCodeHint(
        currentProblem.slug,
        currentProblem.title,
        message,
        currentCode,
        generationProvider,
        currentCustomProblem?.description || undefined,
      );
      setKojoResponse(result.response);
    } catch (error) {
      setKojoError(error instanceof Error ? error.message : "Kojo failed to respond.");
    } finally {
      setKojoLoading(false);
    }
  }

  function addCustomCase() {
    if (!currentProblem) return;
    const existing = customCases[currentProblem.slug] ?? [];
    if (existing.length >= CUSTOM_TEST_LIMIT) return;
    const next = [...existing, { id: `${Date.now()}-${existing.length}`, inputText: "", expectedOutput: "" }];
    setCustomCases((prev) => ({ ...prev, [currentProblem.slug]: next }));
  }

  function updateCustomCase(caseId: string, field: "inputText" | "expectedOutput", value: string) {
    if (!currentProblem) return;
    const next = (customCases[currentProblem.slug] ?? []).map((item) => (item.id === caseId ? { ...item, [field]: value } : item));
    setCustomCases((prev) => ({ ...prev, [currentProblem.slug]: next }));
  }

  function removeCustomCase(caseId: string) {
    if (!currentProblem) return;
    const next = (customCases[currentProblem.slug] ?? []).filter((item) => item.id !== caseId);
    setCustomCases((prev) => ({ ...prev, [currentProblem.slug]: next }));
  }

  async function handleVisualize(inputText: string) {
    if (!currentProblem || !currentCode.trim() || visualizerLoading) return;
    setVisualizerLoading(inputText);
    try {
      const trace = await traceLeetCodeExecution(currentCode, inputText);
      setVisualizerTrace(trace);
    } finally {
      setVisualizerLoading(null);
    }
  }

  async function handleRunCode() {
    if (!currentProblem || !currentProblemData || !isRunnable(currentProblemData)) return;
    const problemAtRun = currentProblem;
    await runAndGradeCurrentCode(problemAtRun, currentCode, currentProblemData, currentCustomCases);
  }

  const pendingDeleteProblem = pendingDeleteSlug
    ? customProblems.find((cp) => cp.slug === pendingDeleteSlug) ?? null
    : null;
  const confirmDeleteNode = pendingDeleteSlug ? (
    <ConfirmModal
      title="Delete custom question?"
      message={
        pendingDeleteProblem
          ? `"${pendingDeleteProblem.title}" and your saved work on it will be removed. This cannot be undone.`
          : "This custom question will be removed. This cannot be undone."
      }
      confirmLabel="Delete"
      danger
      onConfirm={confirmDeleteCustomProblem}
      onCancel={() => setPendingDeleteSlug(null)}
    />
  ) : null;

  // Rendered in every view (tree, custom category, problem) so "Add question" works everywhere.
  const customModalNode = customModalOpen ? (
    <>
      <div className="lc-kojo-backdrop" onClick={closeCustomModal} />
      <div className="lc-kojo-modal lc-custom-modal" role="dialog" aria-label="Custom question editor">
        <div className="lc-kojo-modal-header lc-custom-modal-header">
          <div className="kojo-avatar lc-custom-avatar"><Code size={16} /></div>
          <span>{editingSlug ? "Edit custom question" : "Add custom question"}</span>
          <button type="button" className="lc-kojo-close" onClick={closeCustomModal} aria-label="Close">
            <X size={17} />
          </button>
        </div>

        <div className="lc-custom-modal-body">
          <div className="lc-custom-ai">
            <div className="lc-custom-ai-head">
              <Wand2 size={15} />
              <span>Generate from your code</span>
            </div>
            <p className="muted small">Paste a function (or any code). Kojo writes the title, a walkthrough, and runnable test cases. You can edit everything below.</p>
            <textarea
              className="lc-custom-ai-code"
              value={aiCode}
              onChange={(event) => setAiCode(event.target.value)}
              rows={6}
              placeholder={"def two_sum(nums, target):\n    # your code"}
              spellCheck={false}
            />
            <input
              className="lc-custom-input"
              value={aiHint}
              onChange={(event) => setAiHint(event.target.value)}
              placeholder="Optional: one line on what it should do"
            />
            {aiError ? <div className="kojo-error"><AlertCircle size={14} /><span>{aiError}</span></div> : null}
            <button type="button" className="button lc-custom-ai-btn" onClick={() => void runCustomAiGenerate()} disabled={aiLoading}>
              {aiLoading ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
              {aiLoading ? "Generating…" : "Generate with AI"}
            </button>
          </div>

          <div className="lc-custom-divider"><span>then review</span></div>

          <label className="lc-custom-field">
            <span>Title</span>
            <input
              className="lc-custom-input"
              value={customForm.title}
              onChange={(event) => updateCustomForm("title", event.target.value)}
              placeholder="Two Sum"
            />
          </label>

          <div className="lc-custom-field-row">
            <label className="lc-custom-field">
              <span>Topic</span>
              <input
                className="lc-custom-input"
                value={customForm.topic}
                onChange={(event) => updateCustomForm("topic", event.target.value)}
                placeholder="unknown"
              />
            </label>
            <label className="lc-custom-field">
              <span>Difficulty</span>
              <select
                className="lc-custom-input"
                value={customForm.difficulty}
                onChange={(event) => updateCustomForm("difficulty", event.target.value as CustomFormState["difficulty"])}
              >
                <option value="unknown">Unknown</option>
                <option value="Easy">Easy</option>
                <option value="Medium">Medium</option>
                <option value="Hard">Hard</option>
              </select>
            </label>
          </div>

          <label className="lc-custom-field">
            <span>LeetCode URL <small className="muted">(optional)</small></span>
            <input
              className="lc-custom-input"
              value={customForm.url}
              onChange={(event) => updateCustomForm("url", event.target.value)}
              placeholder="https://leetcode.com/problems/..."
            />
          </label>

          <label className="lc-custom-field">
            <span>Problem statement <small className="muted">(Markdown)</small></span>
            <textarea
              className="lc-custom-textarea"
              value={customForm.description}
              onChange={(event) => updateCustomForm("description", event.target.value)}
              rows={6}
              placeholder="Describe the task, constraints, and a couple of worked examples."
            />
          </label>

          <label className="lc-custom-field">
            <span>Starter code</span>
            <textarea
              className="lc-custom-ai-code"
              value={customForm.starterCode}
              onChange={(event) => updateCustomForm("starterCode", event.target.value)}
              rows={6}
              placeholder={"def two_sum(nums, target):\n    ..."}
              spellCheck={false}
            />
          </label>

          <div className="lc-custom-cases">
            <div className="lc-custom-cases-head">
              <span>Test cases</span>
              <button type="button" className="lc-add-test-btn" onClick={addFormTestCase}>
                <Plus size={14} />
                Add case
              </button>
            </div>
            <p className="muted small">Input uses named arguments, e.g. <code>nums = [2,7,11,15], target = 9</code>. Expected is a Python value, e.g. <code>[0, 1]</code>.</p>
            {customForm.testCases.length === 0 ? (
              <p className="muted small">No test cases yet. Add some so this problem can run.</p>
            ) : (
              customForm.testCases.map((tc, index) => (
                <div key={index} className="lc-custom-case">
                  <div className="lc-custom-case-top">
                    <strong>Case {index + 1}</strong>
                    <button type="button" className="lc-inline-icon-btn" onClick={() => removeFormTestCase(index)} aria-label="Remove test case">
                      <X size={14} />
                    </button>
                  </div>
                  <label>
                    <span>Input</span>
                    <textarea
                      value={tc.input_text}
                      onChange={(event) => updateFormTestCase(index, "input_text", event.target.value)}
                      rows={2}
                      placeholder="nums = [2,7,11,15], target = 9"
                      spellCheck={false}
                    />
                  </label>
                  <label>
                    <span>Expected</span>
                    <textarea
                      value={tc.output_text}
                      onChange={(event) => updateFormTestCase(index, "output_text", event.target.value)}
                      rows={1}
                      placeholder="[0, 1]"
                      spellCheck={false}
                    />
                  </label>
                  <label>
                    <span>Explanation <small className="muted">(optional)</small></span>
                    <textarea
                      value={tc.explanation_text ?? ""}
                      onChange={(event) => updateFormTestCase(index, "explanation_text", event.target.value)}
                      rows={1}
                      placeholder="Why this output"
                    />
                  </label>
                </div>
              ))
            )}
          </div>

          {customError ? <div className="kojo-error"><AlertCircle size={14} /><span>{customError}</span></div> : null}
        </div>

        <div className="lc-custom-modal-footer">
          <button type="button" className="button lc-timeout-action lc-timeout-action--ghost" onClick={closeCustomModal}>
            Cancel
          </button>
          <button type="button" className="lc-custom-add-btn lc-custom-modal-save" onClick={() => void saveCustomProblem()} disabled={customSaving}>
            {customSaving ? <Loader2 size={15} className="spin" /> : null}
            {editingSlug ? "Save changes" : "Add question"}
          </button>
        </div>
      </div>
    </>
  ) : null;

  if (view.type === "tree") {
    return (
      <div className="page lc-page">
        <header className="lc-hero">
          <div>
            <span className="eyebrow">Beta</span>
            <h1>LeetCode roadmap</h1>
            <p className="muted">Official problems, a better practice surface, streaks, and Kojo as a coach instead of a code dump.</p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <Link to="/mock-interview" className="lc-official-link">
              <Users size={16} />
              Mock Interview
            </Link>
            <a className="lc-official-link" href="https://leetcode.com/problemset/" target="_blank" rel="noreferrer">
              <ExternalLink size={16} />
              Open LeetCode
            </a>
          </div>
        </header>

        <section className="lc-dashboard" aria-label="LeetCode progress dashboard">
          <div className="lc-dashboard-main">
            <span className="lc-stat-label">Total solved</span>
            <strong>{stats.solved}/{stats.total}</strong>
            <div className="lc-master-bar" aria-hidden="true">
              <span style={{ width: `${stats.percent}%` }} />
            </div>
          </div>
          <div
            className="lc-stat-tile lc-stat-tile--streak"
            data-tooltip={
              activityDates.includes(todayKey())
                ? "Streak safe, solved today!"
                : `${streakExpiresIn()} left to keep your streak`
            }
          >
            <Flame size={18} />
            <span>{stats.currentStreak}</span>
            <small>day streak</small>
          </div>
          <div className="lc-stat-tile">
            <Trophy size={18} />
            <span>{stats.bestStreak}</span>
            <small>best streak</small>
          </div>
          <div className="lc-stat-tile lc-stat-tile--split">
            <small>Easy</small><span>{stats.easy}</span>
            <small>Medium</small><span>{stats.medium}</span>
            <small>Hard</small><span>{stats.hard}</span>
          </div>
        </section>

        <section className="lc-roadmap" aria-label="Skill tree">
          {CATEGORIES.map((category, index) => {
            const done = category.problems.filter((problem) => progress[problem.slug]).length;
            const pct = category.problems.length ? Math.round((done / category.problems.length) * 100) : 0;
            const Icon = category.icon;
            return (
              <button
                key={category.id}
                type="button"
                className="lc-node"
                style={{ "--lc-accent": category.accent } as CSSProperties}
                data-side={index % 2 === 0 ? "left" : "right"}
                onClick={() => setView({ type: "category", categoryId: category.id })}
              >
                <span className="lc-node-icon"><Icon size={22} /></span>
                <span className="lc-node-copy">
                  <strong>{category.label}</strong>
                  <small>{done}/{category.problems.length} complete</small>
                </span>
                <span className="lc-node-progress"><span style={{ width: `${pct}%` }} /></span>
              </button>
            );
          })}
        </section>

        <section className="lc-custom-section" aria-label="Custom questions">
          {(() => {
            const customDone = customProblemList.filter((problem) => progress[problem.slug]).length;
            const customPct = customProblemList.length ? Math.round((customDone / customProblemList.length) * 100) : 0;
            return (
              <div className="lc-custom-node" style={{ "--lc-accent": "#b45309" } as CSSProperties}>
                <button
                  type="button"
                  className="lc-custom-node-main"
                  onClick={() => setView({ type: "category", categoryId: CUSTOM_CATEGORY_ID })}
                >
                  <span className="lc-node-icon"><Code size={22} /></span>
                  <span className="lc-node-copy">
                    <strong>{CUSTOM_CATEGORY_LABEL}</strong>
                    <small>
                      {customProblemList.length
                        ? `${customDone}/${customProblemList.length} complete`
                        : "Add your own problems"}
                    </small>
                  </span>
                  <span className="lc-node-progress"><span style={{ width: `${customPct}%` }} /></span>
                </button>
                <button type="button" className="lc-custom-add-btn" onClick={() => openCustomModal()}>
                  <Plus size={16} />
                  Add question
                </button>
              </div>
            );
          })()}
        </section>
        {customModalNode}
        {confirmDeleteNode}
      </div>
    );
  }

  if (view.type === "category" && view.categoryId === CUSTOM_CATEGORY_ID) {
    const visibleProblems = filterProblems(customProblemList, progress, filter, query);
    const done = customProblemList.filter((problem) => progress[problem.slug]).length;
    const visibleArchived = filterProblems(archivedProblemList, progress, filter, query);
    return (
      <div className="page page-narrow lc-page">
        <header className="lc-category-header">
          <button type="button" className="lc-back-btn" onClick={() => setView({ type: "tree" })}>
            <ChevronLeft size={16} />
            Roadmap
          </button>
          <div className="lc-category-title-row" style={{ "--lc-accent": "#b45309" } as CSSProperties}>
            <span className="lc-node-icon"><Code size={22} /></span>
            <div>
              <h1>{CUSTOM_CATEGORY_LABEL}</h1>
              <p className="muted">{done}/{customProblemList.length} complete</p>
            </div>
          </div>
          <div className="lc-category-tools">
            <div className="lc-search">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search problems" />
            </div>
            <div className="lc-filter-tabs" role="group" aria-label="Problem filter">
              {(["all", "todo", "done"] as Filter[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={filter === item ? "lc-filter-tab lc-filter-tab--active" : "lc-filter-tab"}
                  onClick={() => setFilter(item)}
                >
                  {item === "all" ? "All" : item === "todo" ? "To do" : "Done"}
                </button>
              ))}
            </div>
            <button type="button" className="lc-custom-add-btn" onClick={() => openCustomModal()}>
              <Plus size={16} />
              Add question
            </button>
          </div>
        </header>

        {customProblemList.length === 0 ? (
          <div className="lc-custom-empty">
            <p>
              {archivedProblemList.length > 0
                ? "No active custom questions. Add a new one, or restore an archived question below."
                : "No custom questions yet. Paste a function and let Kojo turn it into a full problem with a walkthrough and test cases, or write one by hand."}
            </p>
            <button type="button" className="lc-custom-add-btn" onClick={() => openCustomModal()}>
              <Plus size={16} />
              {archivedProblemList.length > 0 ? "Add a question" : "Add your first question"}
            </button>
          </div>
        ) : (
          <div className="lc-problem-list">
            {visibleProblems.map((problem) => {
              const solved = Boolean(progress[problem.slug]);
              const cp = customProblems.find((item) => item.slug === problem.slug);
              return (
                <div key={problem.slug} className={solved ? "lc-problem-row lc-problem-row--done" : "lc-problem-row"}>
                  <button type="button" className="lc-problem-check" onClick={() => toggleProgress(problem)} title={solved ? "Mark incomplete" : "Mark complete"}>
                    {solved ? <CheckCircle2 size={20} className="lc-check-done" /> : <Circle size={20} className="lc-check-empty" />}
                  </button>
                  <button type="button" className="lc-problem-title-btn" onClick={() => openProblem(CUSTOM_CATEGORY_ID, problem.slug)}>
                    <span>{problem.title}</span>
                    <small>{cp && cp.topic !== "unknown" ? cp.topic : "Custom problem"}</small>
                  </button>
                  <span className={`lc-difficulty lc-difficulty--${difficultyClass(problem.difficulty)}`}>{problem.difficulty}</span>
                  <div className="lc-row-actions">
                    <button type="button" className="lc-inline-icon-btn" onClick={() => cp && openCustomModal(cp)} aria-label="Edit custom question" title="Edit">
                      <Pencil size={16} />
                    </button>
                    <button type="button" className="lc-inline-icon-btn" onClick={() => setCustomProblemArchived(problem.slug, true)} aria-label="Archive custom question" title="Archive">
                      <Archive size={16} />
                    </button>
                    <button type="button" className="lc-inline-icon-btn lc-inline-icon-btn--danger" onClick={() => handleDeleteCustomProblem(problem.slug)} aria-label="Delete custom question" title="Delete permanently">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {archivedProblemList.length > 0 ? (
          <div className="lc-archived-section">
            <button
              type="button"
              className="lc-archived-toggle"
              onClick={() => setShowArchived((prev) => !prev)}
              aria-expanded={showArchived}
            >
              <Archive size={15} />
              {showArchived ? "Hide" : "Show"} archived ({archivedProblemList.length})
            </button>
            {showArchived ? (
              visibleArchived.length === 0 ? (
                <p className="muted small lc-archived-empty">No archived questions match your search.</p>
              ) : (
                <div className="lc-problem-list lc-problem-list--archived">
                  {visibleArchived.map((problem) => {
                    const cp = archivedCustomProblems.find((item) => item.slug === problem.slug);
                    return (
                      <div key={problem.slug} className="lc-problem-row lc-problem-row--archived">
                        <button type="button" className="lc-problem-title-btn" onClick={() => openProblem(CUSTOM_CATEGORY_ID, problem.slug)}>
                          <span>{problem.title}</span>
                          <small>{cp && cp.topic !== "unknown" ? cp.topic : "Archived"}</small>
                        </button>
                        <span className={`lc-difficulty lc-difficulty--${difficultyClass(problem.difficulty)}`}>{problem.difficulty}</span>
                        <div className="lc-row-actions">
                          <button type="button" className="lc-inline-icon-btn" onClick={() => setCustomProblemArchived(problem.slug, false)} aria-label="Restore custom question" title="Restore">
                            <ArchiveRestore size={16} />
                          </button>
                          <button type="button" className="lc-inline-icon-btn lc-inline-icon-btn--danger" onClick={() => handleDeleteCustomProblem(problem.slug)} aria-label="Delete custom question" title="Delete permanently">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            ) : null}
          </div>
        ) : null}
        {customModalNode}
        {confirmDeleteNode}
      </div>
    );
  }

  if (view.type === "category") {
    const category = CATEGORIES.find((item) => item.id === view.categoryId) ?? CATEGORIES[0];
    const visibleProblems = filterProblems(category.problems, progress, filter, query);
    const done = category.problems.filter((problem) => progress[problem.slug]).length;
    const Icon = category.icon;

    return (
      <div className="page page-narrow lc-page">
        <header className="lc-category-header">
          <button type="button" className="lc-back-btn" onClick={() => setView({ type: "tree" })}>
            <ChevronLeft size={16} />
            Roadmap
          </button>
          <div className="lc-category-title-row" style={{ "--lc-accent": category.accent } as CSSProperties}>
            <span className="lc-node-icon"><Icon size={22} /></span>
            <div>
              <h1>{category.label}</h1>
              <p className="muted">{done}/{category.problems.length} complete</p>
            </div>
          </div>
          <div className="lc-category-tools">
            <div className="lc-search">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search problems" />
            </div>
            <div className="lc-filter-tabs" role="group" aria-label="Problem filter">
              {(["all", "todo", "done"] as Filter[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={filter === item ? "lc-filter-tab lc-filter-tab--active" : "lc-filter-tab"}
                  onClick={() => setFilter(item)}
                >
                  {item === "all" ? "All" : item === "todo" ? "To do" : "Done"}
                </button>
              ))}
            </div>
          </div>
        </header>

        <div className="lc-problem-list">
          {visibleProblems.map((problem) => {
            const solved = Boolean(progress[problem.slug]);
            return (
              <div key={`${problem.categoryId}-${problem.slug}`} className={solved ? "lc-problem-row lc-problem-row--done" : "lc-problem-row"}>
                <button type="button" className="lc-problem-check" onClick={() => toggleProgress(problem)} title={solved ? "Mark incomplete" : "Mark complete"}>
                  {solved ? <CheckCircle2 size={20} className="lc-check-done" /> : <Circle size={20} className="lc-check-empty" />}
                </button>
                <button type="button" className="lc-problem-title-btn" onClick={() => openProblem(category.id, problem.slug)}>
                  <span>{problem.title}</span>
                  {!problem.isOfficial ? <small>Reference drill</small> : null}
                </button>
                {problem.isExtra ? <span className="lc-extra-pill">Extra</span> : null}
                <span className={`lc-difficulty lc-difficulty--${difficultyClass(problem.difficulty)}`}>{problem.difficulty}</span>
                <a className="lc-row-link" href={problem.url} target="_blank" rel="noreferrer" title="Open official problem">
                  <ExternalLink size={16} />
                </a>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (!currentProblem) return null;

  // Custom questions are their own "category" (not in CATEGORIES), so navigation has to
  // walk the active custom list. Without this, the fallback below scanned the official
  // CATEGORIES and sent the user to an unrelated verified LeetCode problem.
  const isCustomNav = currentProblem.categoryId === CUSTOM_CATEGORY_ID;
  const navProblems: Problem[] = isCustomNav
    ? customProblemList
    : CATEGORIES.find((c) => c.id === currentProblem.categoryId)?.problems ?? [];
  const currentProblemIndexInCategory = navProblems.findIndex((p) => p.slug === currentProblem.slug);
  const nextProblemInCategory =
    currentProblemIndexInCategory >= 0 && currentProblemIndexInCategory < navProblems.length - 1
      ? navProblems[currentProblemIndexInCategory + 1]
      : null;

  let suggestedNext: { problem: Problem; category: Category } | null = null;
  if (!nextProblemInCategory && !isCustomNav) {
    const catIdx = CATEGORIES.findIndex((c) => c.id === currentProblem.categoryId);
    for (let i = catIdx + 1; i < CATEGORIES.length; i++) {
      const undone = CATEGORIES[i].problems.find((p) => !progress[p.slug]);
      if (undone) {
        suggestedNext = { problem: undone, category: CATEGORIES[i] };
        break;
      }
    }
  }

  const showNextButton = Boolean(progress[currentProblem.slug]) || Boolean(runnerResult?.ok);
  const hasAttempted = runnerResult !== null || Boolean(progress[currentProblem.slug]);

  const problemLoading = currentProblem.isOfficial && currentProblemState?.loading;
  const problemError = currentProblemState?.error;
  const runnable = isRunnable(currentProblemData);
  const officialExamples = currentProblemData?.examples ?? [];
  return (
    <div className="lc-editor-shell">
      <div className="lc-editor-topbar">
        <button type="button" className="lc-back-btn" onClick={() => setView({ type: "category", categoryId: currentProblem.categoryId })} aria-label={`Back to ${currentProblem.categoryLabel}`}>
          <ChevronLeft size={16} />
          <span className="lc-tb-label">{currentProblem.categoryLabel}</span>
        </button>
        <div className="lc-editor-title">
          <span>{currentProblem.title}</span>
          <span className={`lc-difficulty lc-difficulty--${difficultyClass(currentProblem.difficulty)}`}>{currentProblem.difficulty}</span>
        </div>
        <div className="lc-editor-actions">
          <button type="button" className="lc-toolbar-btn lc-toolbar-btn--timer" onClick={openTimerPicker} aria-label="Set timer">
            <Timer size={16} />
            <span className="lc-tb-label lc-tb-label--timer">{timerButtonLabel}</span>
          </button>
          <a className="lc-toolbar-btn" href={`https://www.youtube.com/results?search_query=neetcode+${encodeURIComponent(currentProblem.title)}`} target="_blank" rel="noreferrer" aria-label="Search NeetCode on YouTube">
            <Youtube size={16} />
            <span className="lc-tb-label">NeetCode</span>
          </a>
          <a className="lc-toolbar-btn" href={currentProblem.url} target="_blank" rel="noreferrer" aria-label="Open on LeetCode">
            <ExternalLink size={16} />
            <span className="lc-tb-label">Open</span>
          </a>
          <button type="button" className="lc-toolbar-btn" onClick={handleFormat} aria-label="Format code">
            <WrapText size={16} />
            <span className="lc-tb-label">Format</span>
          </button>
          <button type="button" className="lc-toolbar-btn" onClick={handleRunCode} disabled={!runnable || runnerLoading} aria-label="Run code">
            {runnerLoading ? <Loader2 size={16} className="spin" /> : <Play size={16} />}
            <span className="lc-tb-label">Run code</span>
          </button>
          <button type="button" className="lc-toolbar-btn" onClick={() => openNotes(currentProblem.slug)} aria-label="Open notes">
            <Notebook size={16} />
            <span className="lc-tb-label">Notes</span>
          </button>
          <button type="button" className="lc-toolbar-btn lc-toolbar-btn--kojo" onClick={() => openKojo(currentProblem)} aria-label="Ask Kojo for a hint">
            <Sparkles size={16} />
            <span className="lc-tb-label">Ask Kojo</span>
          </button>
          <button type="button" className={progress[currentProblem.slug] ? "lc-toolbar-btn lc-toolbar-btn--done" : "lc-toolbar-btn"} onClick={() => toggleProgress(currentProblem)} aria-label={progress[currentProblem.slug] ? "Mark incomplete" : "Mark done"}>
            {progress[currentProblem.slug] ? <CheckCircle2 size={16} /> : <Circle size={16} />}
            <span className="lc-tb-label">{progress[currentProblem.slug] ? "Done" : "Mark done"}</span>
          </button>
        </div>
      </div>

      <div className="lc-mobile-pane-toggle" role="group" aria-label="Switch between problem and code">
        <button
          type="button"
          className={mobilePane === "problem" ? "lc-mobile-pane-btn lc-mobile-pane-btn--active" : "lc-mobile-pane-btn"}
          onClick={() => setMobilePane("problem")}
          aria-pressed={mobilePane === "problem"}
        >
          <BookOpen size={15} />
          Problem
        </button>
        <button
          type="button"
          className={mobilePane === "code" ? "lc-mobile-pane-btn lc-mobile-pane-btn--active" : "lc-mobile-pane-btn"}
          onClick={() => setMobilePane("code")}
          aria-pressed={mobilePane === "code"}
        >
          <Code2 size={15} />
          Code
        </button>
      </div>

      <div className="lc-editor-body" data-mobile-pane={mobilePane}>
        <aside className="lc-problem-pane">
          <div className="lc-problem-source">
            <span>{isCustomProblem ? "Custom problem" : currentProblem.isOfficial ? "Official LeetCode statement" : "Reference-only topic"}</span>
            <div className="lc-row-actions">
              {!isCustomProblem || currentCustomProblem?.url ? (
                <a href={currentProblem.url} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Source</a>
              ) : null}
              {isCustomProblem && currentCustomProblem ? (
                <>
                  <button type="button" className="lc-inline-icon-btn" onClick={() => openCustomModal(currentCustomProblem)} aria-label="Edit custom question" title="Edit">
                    <Pencil size={15} />
                  </button>
                  {currentCustomProblem.is_archived ? (
                    <button type="button" className="lc-inline-icon-btn" onClick={() => setCustomProblemArchived(currentCustomProblem.slug, false)} aria-label="Restore custom question" title="Restore">
                      <ArchiveRestore size={15} />
                    </button>
                  ) : (
                    <button type="button" className="lc-inline-icon-btn" onClick={() => setCustomProblemArchived(currentCustomProblem.slug, true)} aria-label="Archive custom question" title="Archive">
                      <Archive size={15} />
                    </button>
                  )}
                </>
              ) : null}
            </div>
          </div>

          <h2 className="lc-problem-heading">{currentProblem.title}</h2>
          <div className="lc-problem-meta">
            <span className={`lc-difficulty lc-difficulty--${difficultyClass(currentProblem.difficulty)}`}>{currentProblem.difficulty}</span>
            <span>{currentProblem.categoryLabel}</span>
            {currentProblem.isExtra ? <span>Extra</span> : null}
          </div>

          {problemLoading ? (
            <div className="lc-statement-state"><Loader2 size={18} className="spin" /><span>Loading official statement…</span></div>
          ) : null}

          {problemError ? (
            <div className="lc-statement-state lc-statement-state--error"><AlertCircle size={18} /><span>{problemError}</span></div>
          ) : null}

          {!currentProblem.isOfficial && !isCustomProblem ? (
            <div className="lc-source-note">
              <p>This item is kept as a reference drill because it is not an official LeetCode problem title. The editor and Kojo coach still work here, but there is no official statement to render.</p>
            </div>
          ) : null}

          {isCustomProblem && currentCustomProblem ? (
            currentCustomProblem.description.trim() ? (
              <div className="lc-custom-statement">
                <MarkdownContent content={currentCustomProblem.description} />
              </div>
            ) : (
              <div className="lc-source-note">
                <p>No write-up yet. Edit this problem and use Generate with AI to add a walkthrough and test cases, or just start coding.</p>
              </div>
            )
          ) : null}

          {currentProblemData && !isCustomProblem ? (
            <>
              <div className="lc-topic-tags">
                {currentProblemData.topic_tags.slice(0, 4).map((tag) => (
                  <span key={tag.slug}>{tag.name}</span>
                ))}
              </div>
              <div className="lc-official-statement" dangerouslySetInnerHTML={{ __html: sanitizeLeetCodeHtml(currentProblemData.content_html) }} />
            </>
          ) : null}

          <div className="lc-tests-panel">
            <div className="lc-tests-header">
              <h3>Tests</h3>
              <button type="button" className="lc-add-test-btn" onClick={addCustomCase} disabled={currentCustomCases.length >= CUSTOM_TEST_LIMIT}>
                <Plus size={14} />
                Add custom
              </button>
            </div>
            <p className="muted small">
              {isCustomProblem
                ? "These cases come from this problem. You can add up to 2 ad-hoc cases for a quick run."
                : "You can add up to 2 custom cases on top of the official LeetCode examples."}
            </p>

            <div className="lc-test-list">
              {officialExamples.map((example) => (
                <div key={example.index} className="lc-test-card">
                  <div className="lc-test-card-top">
                    <strong>{isCustomProblem ? "Test" : "Official"} {example.index}</strong>
                    {currentCode.trim() && runnable ? (
                      <button
                        type="button"
                        className="lc-visualize-btn"
                        onClick={() => handleVisualize(example.input_text)}
                        disabled={visualizerLoading === example.input_text}
                        title="Step through this test case"
                      >
                        {visualizerLoading === example.input_text ? <Loader2 size={12} className="spin" /> : <Eye size={12} />}
                        Visualize
                      </button>
                    ) : null}
                  </div>
                  <label>
                    <span>Input</span>
                    <textarea value={example.input_text} readOnly rows={Math.min(5, Math.max(2, example.input_text.split("\n").length))} />
                  </label>
                  <label>
                    <span>Expected</span>
                    <textarea value={example.output_text} readOnly rows={Math.min(4, Math.max(2, example.output_text.split("\n").length))} />
                  </label>
                </div>
              ))}

              {currentCustomCases.map((testCase, index) => (
                <div key={testCase.id} className="lc-test-card lc-test-card--custom">
                  <div className="lc-test-card-top">
                    <strong>Custom {index + 1}</strong>
                    <div className="lc-test-card-actions">
                      {currentCode.trim() && runnable && testCase.inputText.trim() ? (
                        <button
                          type="button"
                          className="lc-visualize-btn"
                          onClick={() => handleVisualize(testCase.inputText)}
                          disabled={visualizerLoading === testCase.inputText}
                          title="Step through this test case"
                        >
                          {visualizerLoading === testCase.inputText ? <Loader2 size={12} className="spin" /> : <Eye size={12} />}
                          Visualize
                        </button>
                      ) : null}
                      <button type="button" className="lc-inline-icon-btn" onClick={() => removeCustomCase(testCase.id)} aria-label="Remove custom test case">
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                  <label>
                    <span>Input</span>
                    <textarea
                      value={testCase.inputText}
                      onChange={(event) => updateCustomCase(testCase.id, "inputText", event.target.value)}
                      rows={3}
                      placeholder='nums = [1,2,3], target = 4'
                    />
                  </label>
                  <label>
                    <span>Expected</span>
                    <textarea
                      value={testCase.expectedOutput}
                      onChange={(event) => updateCustomCase(testCase.id, "expectedOutput", event.target.value)}
                      rows={2}
                      placeholder="[0,2]"
                    />
                  </label>
                </div>
              ))}
            </div>

            {!runnable && currentProblem.isOfficial ? (
              <p className="lc-runner-note">Automatic running currently supports Python `class Solution` problems with official example inputs. Design-style problems still open with the official statement and editor, but they do not auto-run yet.</p>
            ) : null}

            {!runnable && isCustomProblem ? (
              <p className="lc-runner-note">Add starter code and at least one test case to run this problem. Editing it and using Generate with AI fills both in automatically.</p>
            ) : null}

            {runnerResult ? (
              <div className={runnerResult.ok ? "lc-runner-result lc-runner-result--ok" : "lc-runner-result lc-runner-result--error"}>
                <strong>{runnerResult.output}</strong>
                {runnerResult.error ? <pre>{runnerResult.error}</pre> : null}
                {runnerResult.cases?.length ? (
                  <div className="lc-runner-case-list">
                    {runnerResult.cases.map((testCase) => (
                      <div key={testCase.label} className="lc-runner-case">
                        <span>{testCase.label}</span>
                        <span>{testCase.passed ? "Pass" : "Fail"}</span>
                        {!testCase.passed ? <small>Expected {testCase.expected} but got {testCase.actual}</small> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {gradeLoading ? (
              <div className="lc-grade-loading">
                <Loader2 size={14} className="spin" />
                <span>Kojo is grading your submission…</span>
              </div>
            ) : null}

            {gradeFeedback && !gradeLoading ? (
              <div className="lc-grade-feedback">
                <div className="lc-grade-feedback-header">
                  <Bot size={14} />
                  <span>Kojo's feedback</span>
                </div>
                <MarkdownContent content={gradeFeedback} />
              </div>
            ) : null}

            {showNextButton && (nextProblemInCategory || suggestedNext) ? (
              <div className="lc-next-problem">
                <span className="lc-next-problem-eyebrow">
                  {nextProblemInCategory ? "Up next" : `Continue , ${suggestedNext!.category.label}`}
                </span>
                <button
                  type="button"
                  className="lc-next-problem-btn"
                  onClick={() => {
                    const target = nextProblemInCategory ?? suggestedNext!.problem;
                    const targetCategoryId = nextProblemInCategory
                      ? currentProblem.categoryId
                      : suggestedNext!.category.id;
                    openProblem(targetCategoryId, target.slug);
                  }}
                >
                  <div className="lc-next-problem-info">
                    <span className="lc-next-problem-title">
                      {nextProblemInCategory ? nextProblemInCategory.title : suggestedNext!.problem.title}
                    </span>
                  </div>
                  <span className={`lc-difficulty lc-difficulty--${difficultyClass(
                    nextProblemInCategory ? nextProblemInCategory.difficulty : suggestedNext!.problem.difficulty
                  )}`}>
                    {nextProblemInCategory ? nextProblemInCategory.difficulty : suggestedNext!.problem.difficulty}
                  </span>
                  <ArrowRight size={16} className="lc-next-arrow" />
                </button>
              </div>
            ) : null}
          </div>

          {!isCustomProblem ? (
            <div className="lc-solution-panel">
              <button
                type="button"
                className="lc-solution-toggle"
                onClick={() => hasAttempted && setSolutionOpen((prev) => !prev)}
                disabled={!hasAttempted}
                title={hasAttempted ? "Toggle NeetCode solution" : "Attempt the problem to unlock"}
              >
                <Youtube size={15} />
                <span>NeetCode solution</span>
                {!hasAttempted ? (
                  <small className="lc-solution-locked">Attempt first to unlock</small>
                ) : (
                  <ChevronDown size={14} className={solutionOpen ? "lc-solution-chevron lc-solution-chevron--open" : "lc-solution-chevron"} />
                )}
              </button>
              {solutionOpen && hasAttempted ? (
                <div className="lc-solution-frame-wrap">
                  <iframe
                    src={`https://neetcode.io/solutions/${currentProblem.slug}`}
                    title={`NeetCode solution for ${currentProblem.title}`}
                    className="lc-solution-iframe"
                    allow="autoplay; encrypted-media"
                    allowFullScreen
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </aside>

        <div className="lc-editor-pane">
          <CodingTabs
            tabs={(currentCodeWorkspace?.tabs ?? []).map((tab) => ({ id: tab.id, name: tab.name }))}
            activeTabId={currentCodeWorkspace?.activeTabId ?? ""}
            onSelectTab={handleSelectCodeTab}
            onAddTab={handleAddCodeTab}
            onDeleteTab={handleDeleteCodeTab}
            canAddTab={(currentCodeWorkspace?.tabs?.length ?? 0) < MAX_CODE_TABS}
          />

          <div className="lc-editor-surface">
            <Editor
              height="100%"
              defaultLanguage="python"
              value={currentCode}
              onChange={(value) => handleCodeChange(value ?? "")}
              onMount={handleMonacoMount}
              theme="vs-dark"
              options={{
                // The code pane starts hidden (display:none) behind the mobile
                // problem/code toggle, so Monaco first measures a 0-size container.
                // automaticLayout makes it re-measure when it becomes visible,
                // otherwise it paints a collapsed black box you cannot type into.
                automaticLayout: true,
                fontSize: 14,
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                minimap: { enabled: false },
                quickSuggestions: false,
                suggestOnTriggerCharacters: false,
                parameterHints: { enabled: false },
                wordBasedSuggestions: "off",
                tabSize: 4,
                scrollBeyondLastLine: false,
                lineNumbers: "on",
                renderLineHighlight: "line",
                padding: { top: 16, bottom: 16 },
              }}
            />
          </div>
        </div>
      </div>

      {kojoOpen ? (
        <>
          <div className="lc-kojo-backdrop" onClick={() => { setKojoOpen(false); setKojoResponse(null); }} />
          <div className="lc-kojo-modal">
            <div className="lc-kojo-modal-header">
              <div className="kojo-avatar"><Bot size={16} /></div>
              <span><Sparkles size={13} className="kojo-title-icon" /> Ask Kojo for a hint</span>
              <button type="button" className="lc-kojo-close" onClick={() => { setKojoOpen(false); setKojoResponse(null); }} aria-label="Close">
                <X size={17} />
              </button>
            </div>

            <div className="lc-kojo-contract">
              <p>Kojo can help with hints, debugging direction, edge cases, and complexity. It will not give you the full solution code here.</p>
            </div>

            <div className="lc-kojo-input-wrap">
              <label className="lc-kojo-input-label" htmlFor="lc-kojo-textarea">Your question</label>
              <textarea
                id="lc-kojo-textarea"
                className="lc-kojo-input"
                rows={5}
                value={kojoInput}
                onChange={(event) => setKojoInput(event.target.value)}
                placeholder="Ask for a hint or type / for commands"
                disabled={kojoLoading}
              />
              {kojoShowsCommands ? (
                <SlashCommandMenu commands={CHAT_COMMANDS} onSelect={selectKojoCommand} />
              ) : null}
            </div>

            {kojoResponse ? <div className="lc-kojo-response"><MarkdownContent content={kojoResponse} /></div> : null}
            {kojoError ? <div className="kojo-error"><AlertCircle size={14} /><span>{kojoError}</span></div> : null}

            <div className="lc-kojo-modal-footer">
              {kojoLoading ? (
                <div className="kojo-thinking"><span /><span /><span /></div>
              ) : (
                <button type="button" className="button button--primary lc-kojo-send" onClick={() => handleKojoSend()} disabled={!kojoInput.trim()}>
                  <Send size={15} />
                  {kojoResponse ? "Ask again" : "Ask Kojo"}
                </button>
              )}
            </div>
          </div>
        </>
      ) : null}

      {visualizerTrace ? (
        <ExecutionVisualizer
          code={currentCode}
          trace={visualizerTrace}
          onClose={() => setVisualizerTrace(null)}
        />
      ) : null}

      {timerPickerOpen ? (
        <>
          <div className="lc-kojo-backdrop" onClick={closeTimerPicker} />
          <div className="lc-kojo-modal lc-timer-modal">
            <div className="lc-kojo-modal-header lc-timer-modal-header">
              <div className="kojo-avatar lc-timer-avatar"><Timer size={16} /></div>
              <span>Set timer</span>
              <button type="button" className="lc-kojo-close" onClick={closeTimerPicker} aria-label="Close timer modal">
                <X size={17} />
              </button>
            </div>

            <div className="lc-timer-modal-body">
              <div className="lc-timer-modal-presets" role="group" aria-label="Problem timer presets">
                {TIMER_PRESETS.map(renderTimerPreset)}
              </div>

              <label className="lc-timer-modal-input">
                <span>Custom minutes</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={timerMinutesInput}
                  onChange={(event) => setTimerMinutesInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      applyTimerFromInput();
                    }
                  }}
                />
              </label>
            </div>

            <div className="lc-timer-modal-actions">
              <button type="button" className="button lc-timeout-action lc-timeout-action--ghost" onClick={closeTimerPicker}>
                Cancel
              </button>
              <button type="button" className="button button--primary lc-timeout-action" onClick={applyTimerFromInput}>
                Start timer
              </button>
            </div>
          </div>
        </>
      ) : null}

      {notesOpen ? (
        <>
          <div className="lc-kojo-backdrop" onClick={() => setNotesOpen(false)} />
          <div
            className="lc-kojo-modal lc-notes-modal"
            style={notesPos ? { left: notesPos.x, top: notesPos.y, right: "unset", bottom: "unset" } : undefined}
          >
            <div className="lc-kojo-modal-header lc-notes-modal-header" onMouseDown={handleNotesDragStart}>
              <div className="kojo-avatar"><Notebook size={16} /></div>
              <span>Notes</span>
              <button type="button" className="lc-kojo-close" onClick={() => setNotesOpen(false)} aria-label="Close notes">
                <X size={17} />
              </button>
            </div>
            <div className="lc-notes-body">
              <textarea
                className="lc-notes-textarea"
                value={notesContent}
                onChange={(event) => handleNotesChange(currentProblem.slug, event.target.value)}
                placeholder="Jot down your approach, key observations, or edge cases..."
                rows={14}
              />
            </div>
          </div>
        </>
      ) : null}

      {timeoutModalOpen ? (
        <>
          <div className="lc-kojo-backdrop" onClick={closeTimeoutModal} />
          <div className="lc-kojo-modal lc-timeout-modal">
            <div className="lc-kojo-modal-header lc-timeout-modal-header">
              <div className="kojo-avatar lc-timeout-avatar"><AlertCircle size={16} /></div>
              <span>Time&apos;s up</span>
              <button
                type="button"
                className="lc-kojo-close"
                onClick={closeTimeoutModal}
                aria-label="Close timeout modal"
              >
                <X size={17} />
              </button>
            </div>

            <div className="lc-kojo-contract lc-timeout-copy">
              <p>{timeoutModalMessage ?? "You ran out of time before finishing this problem."}</p>
              <p>Kojo graded your current attempt. You can clear the active tab or keep working without the timer.</p>
            </div>

            <div className="lc-timeout-actions">
              <button
                type="button"
                className="button lc-timeout-action lc-timeout-action--ghost"
                onClick={() => {
                  clearActiveTabWork();
                  resetTimerState();
                }}
              >
                Clear all work
              </button>
              <button
                type="button"
                className="button button--primary lc-timeout-action"
                onClick={resetTimerState}
              >
                Continue without timer
              </button>
            </div>
          </div>
        </>
      ) : null}

      {customModalNode}
      {confirmDeleteNode}
    </div>
  );
}
