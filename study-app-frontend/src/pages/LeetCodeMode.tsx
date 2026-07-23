import Editor, { type Monaco } from "@monaco-editor/react";
import {
  AlertCircle,
  ArrowRight,
  Binary,
  BookOpen,
  Braces,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
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
  Settings,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Trophy,
  Users,
  WrapText,
  X,
  type LucideIcon,
  Code,
  Notebook,
  Pencil,
  Trash2,
  Wand2,
  Archive,
  ArchiveRestore,
} from "lucide-react";
import KojoMascot from "../components/KojoMascot";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MarkdownContent } from "../components/MarkdownContent";
import { LoadingNotice } from "../components/Loaders";
import { ConfirmModal } from "../components/ConfirmModal";
import { ToggleSwitch } from "../components/ToggleSwitch";
import CodingTabs from "../components/Tab";
import { type CommandOption as SlashCommand } from "../components/SlashCommandMenu";
import { KojoHelpChat } from "../components/KojoHelpChat";
import {
  scopeKey,
  fetchLCNotes,
  fetchLCProgress,
  fetchLCWorkspace,
  fetchLCWorkspaces,
  getStoredUser,
  isGuestSession,
  syncLCNotes,
  syncLCProgress,
  syncLCWorkspace,
  fetchLeetCodeProblem,
  gradeLeetCodeSubmission,
  fetchLCCustomProblems,
  syncLCCustomProblem,
  deleteLCCustomProblem,
  generateLCCustomProblem,
  fetchLCStreakChallenge,
  createLCStreakChallenge,
  completeLCStreakChallenge,
  fetchSlashCommands,
  fetchLCDaily,
  createLCDaily,
  logLCStruggleEvent,
  fetchLCWeakness,
  fetchLCScores,
  postLCTestRun,
  fetchLCPrepBanks,
  createLCPrepBank,
  deleteLCPrepBank,
  activateLCPrepBank,
  addLCBankProblem,
  bulkAddLCBankProblems,
  removeLCBankProblem,
  fetchLCDrills,
  createLCDrill,
  advanceLCDrill,
} from "../lib/api";
import { runPythonLeetCode, traceLeetCodeExecution, type RunnerResult, type TraceResult } from "../lib/pyodideRunner";
import { sanitizeLeetCodeHtml } from "../lib/leetcodeHtml";
import { ExecutionVisualizer } from "../components/ExecutionVisualizer";
import { Link } from "react-router-dom";
import type {
  LeetCodeProblemData,
  LCCustomProblem,
  LCCustomTestCase,
  LCGeneratedCustomProblem,
  LCStreakChallenge,
  LCWeaknessTopic,
  LCImprovementTopic,
  LCPrepBank,
  LCDrillSchedule,
} from "../lib/types";
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
  | { type: "browse" }
  | { type: "category"; categoryId: string }
  | { type: "problem"; categoryId: string; problemSlug: string }
  | { type: "banks" }
  | { type: "drills" }
  | { type: "practice" };

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

function getActivityCountsKey(): string {
  return `${getUserStoragePrefix()}:nosey_lc_activity_counts`;
}

function getPracticeSessionKey(): string {
  return `${getUserStoragePrefix()}:nosey_lc_practice_session`;
}

function getLastProblemKey(): string {
  return `${getUserStoragePrefix()}:nosey_lc_last_problem`;
}

// Ring buffer of recently generated daily seed slugs, so the daily doesn't reskin
// the same problem two days running even within one weak topic.
function getRecentDailySeedsKey(): string {
  return `${getUserStoragePrefix()}:nosey_lc_recent_daily_seeds`;
}

// Timestamp (ms) after which weakness signals count. Set by "Clear weakness
// signals" in the cog; read on every weakness fetch and sent to the backend.
function getWeaknessResetKey(): string {
  return `${getUserStoragePrefix()}:nosey_lc_weakness_reset_at`;
}

// Slugs the "how hard did that feel?" prompt has already asked about, so it only
// asks once per problem, ever.
function getDifficultySurveyedKey(): string {
  return `${getUserStoragePrefix()}:nosey_lc_difficulty_surveyed`;
}

const RECENT_DAILY_SEEDS_MAX = 8;

// Reads the weakness-reset marker as an ISO string for the API, or undefined if the
// user has never cleared their signals. Stored as epoch ms; sent as ISO.
function readWeaknessResetIso(): string | undefined {
  try {
    const raw = localStorage.getItem(getWeaknessResetKey());
    if (!raw) return undefined;
    const ms = Number(raw);
    if (!Number.isFinite(ms)) return undefined;
    return new Date(ms).toISOString();
  } catch {
    return undefined;
  }
}

function loadRecentDailySeeds(): string[] {
  try {
    const raw = localStorage.getItem(getRecentDailySeedsKey());
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function pushRecentDailySeed(slug: string): void {
  try {
    const next = [slug, ...loadRecentDailySeeds().filter((s) => s !== slug)].slice(0, RECENT_DAILY_SEEDS_MAX);
    localStorage.setItem(getRecentDailySeedsKey(), JSON.stringify(next));
  } catch {
    // best-effort, never blocks generation
  }
}

function loadDifficultySurveyed(): Set<string> {
  try {
    const raw = localStorage.getItem(getDifficultySurveyedKey());
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : []);
  } catch {
    return new Set();
  }
}

function markDifficultySurveyed(slug: string): void {
  try {
    const next = loadDifficultySurveyed();
    next.add(slug);
    localStorage.setItem(getDifficultySurveyedKey(), JSON.stringify([...next]));
  } catch {
    // best-effort
  }
}

// Level 1-5 -> reskin difficulty (1-2 Easy, 3 Medium, 4-5 Hard).
function difficultyForLevel(level: number): "Easy" | "Medium" | "Hard" {
  if (level <= 2) return "Easy";
  if (level === 3) return "Medium";
  return "Hard";
}

// Rotate the daily across the top few weak topics (weighted by level) instead of
// always the single worst one, so it doesn't hammer the same topic day after day.
function pickWeightedTopic(topics: LCWeaknessTopic[], n: number): LCWeaknessTopic | undefined {
  const pool = topics.slice(0, n);
  if (!pool.length) return undefined;
  const totalWeight = pool.reduce((sum, topic) => sum + Math.max(1, topic.level), 0);
  let r = Math.random() * totalWeight;
  for (const topic of pool) {
    r -= Math.max(1, topic.level);
    if (r <= 0) return topic;
  }
  return pool[pool.length - 1];
}

// Pick a seed from a pool, preferring unsolved problems the daily hasn't reskinned
// recently, so the concrete problem varies even within one topic.
function chooseDailySeed(
  pool: Problem[],
  recent: string[],
  progress: Record<string, boolean>,
): Problem | undefined {
  if (!pool.length) return undefined;
  const unsolved = pool.filter((p) => !progress[p.slug]);
  const unsolvedFresh = unsolved.filter((p) => !recent.includes(p.slug));
  const fresh = pool.filter((p) => !recent.includes(p.slug));
  const tier = unsolvedFresh.length ? unsolvedFresh : unsolved.length ? unsolved : fresh.length ? fresh : pool;
  return tier[Math.floor(Math.random() * tier.length)];
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

function saveActivityCounts(counts: Record<string, number>) {
  localStorage.setItem(getActivityCountsKey(), JSON.stringify(counts));
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

type PracticeSession = { slugs: string[]; startedAt: number; startedSolved: Set<string>; endedAt: number | null };

type StoredPracticeSession = {
  slugs: string[];
  startedAt: number;
  startedSolved: string[];
  endedAt: number | null;
  ended: boolean;
};

// Practice sets persist to localStorage so a refresh doesn't wipe an in-progress
// session, same per-user scoping as progress/custom problems.
function loadPracticeSession(): { session: PracticeSession | null; ended: boolean } {
  const raw = loadJson<StoredPracticeSession | null>(getPracticeSessionKey(), null);
  if (!raw || !Array.isArray(raw.slugs) || raw.slugs.length === 0) return { session: null, ended: false };
  return {
    session: {
      slugs: raw.slugs,
      startedAt: raw.startedAt,
      startedSolved: new Set(raw.startedSolved ?? []),
      endedAt: raw.endedAt ?? null,
    },
    ended: Boolean(raw.ended),
  };
}

function savePracticeSession(session: PracticeSession | null, ended: boolean) {
  if (!session) {
    localStorage.removeItem(getPracticeSessionKey());
    return;
  }
  const stored: StoredPracticeSession = {
    slugs: session.slugs,
    startedAt: session.startedAt,
    startedSolved: Array.from(session.startedSolved),
    endedAt: session.endedAt,
    ended,
  };
  localStorage.setItem(getPracticeSessionKey(), JSON.stringify(stored));
}

function makeCustomSlug(): string {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `custom-${id}`;
}

// Pull the problem slug out of a LeetCode URL, or accept a bare slug ("two-sum"). Returns
// null for anything that isn't a plausible LeetCode problem reference.
function parseLeetCodeSlug(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const urlMatch = text.match(/leetcode\.com\/problems\/([a-z0-9-]+)/i);
  if (urlMatch) return urlMatch[1].toLowerCase();
  if (!text.includes(" ") && /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(text)) return text.toLowerCase();
  return null;
}

// Convert LeetCode statement HTML into readable plain text for the stored description.
// DOMParser is used (not innerHTML) so no scripts run and no remote resources load.
function htmlToText(html: string): string {
  if (!html) return "";
  if (typeof DOMParser === "undefined") return html;
  const parsed = new DOMParser().parseFromString(html, "text/html");
  return (parsed.body.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
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
// A problem added to a real category via the "add by link" flow stores that category's id
// as its `topic`, so it renders inside that category (and counts toward its totals) instead
// of the catch-all Custom bucket. Free-text / "unknown" topics stay in Custom.
function customToProblem(cp: LCCustomProblem): Problem {
  const category = CATEGORIES.find((item) => item.id === cp.topic);
  return {
    categoryId: category ? category.id : CUSTOM_CATEGORY_ID,
    categoryLabel: category ? category.label : CUSTOM_CATEGORY_LABEL,
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

// Filters combine (AND): status + search + difficulty + topic all apply together.
// Empty `difficulties`/`topics` sets mean "no constraint on that dimension" so the
// per-category bar (which never passes topics) behaves exactly as before.
function filterProblems(
  problems: Problem[],
  progress: Record<string, boolean>,
  filter: Filter,
  query: string,
  difficulties?: Set<Difficulty>,
  topics?: Set<string>,
) {
  const normalizedQuery = query.trim().toLowerCase();
  return problems.filter((problem) => {
    const done = Boolean(progress[problem.slug]);
    const matchesFilter = filter === "all" || (filter === "done" ? done : !done);
    const matchesQuery = !normalizedQuery || problem.title.toLowerCase().includes(normalizedQuery);
    const matchesDifficulty = !difficulties || difficulties.size === 0 || difficulties.has(problem.difficulty);
    const matchesTopic = !topics || topics.size === 0 || topics.has(problem.categoryId);
    return matchesFilter && matchesQuery && matchesDifficulty && matchesTopic;
  });
}

function isRunnable(problemData?: LeetCodeProblemData) {
  const snippet = problemData?.python_snippet ?? "";
  // A runnable problem just needs some code and at least one example/test case. The
  // runner accepts either a `class Solution` or a bare top-level function, so custom
  // problems built from a pasted function run too.
  return Boolean(snippet.trim()) && Boolean(problemData?.examples.length);
}


// Last-resort fallback only. Normally the streak rescue problem is a random unsolved
// Medium/Hard drawn from the verified + custom catalog (see pickStreakChallengeSlug).
const STREAK_CHALLENGE_FALLBACK_SLUG = "trapping-rain-water";

function randomFrom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

// Pick the Save My Streak rescue problem from the combined verified + custom pool.
// Preference ladder so the challenge is always achievable and never a repeat:
//   1. a random unsolved Medium/Hard
//   2. any unsolved problem (so power users who cleared all Medium/Hard still get one)
//   3. a random Medium/Hard even if solved (everything is done)
//   4. the hardcoded fallback (pool somehow empty, should not happen)
function pickStreakChallengeSlug(pool: Problem[], progress: Record<string, boolean>): string {
  const isMidOrHard = (p: Problem) => p.difficulty === "Medium" || p.difficulty === "Hard";
  const unsolvedMidHard = pool.filter((p) => isMidOrHard(p) && !progress[p.slug]);
  if (unsolvedMidHard.length > 0) return randomFrom(unsolvedMidHard).slug;
  const unsolved = pool.filter((p) => !progress[p.slug]);
  if (unsolved.length > 0) return randomFrom(unsolved).slug;
  const midHard = pool.filter(isMidOrHard);
  if (midHard.length > 0) return randomFrom(midHard).slug;
  return STREAK_CHALLENGE_FALLBACK_SLUG;
}

function fillStreakGap(currentDates: string[]): string[] {
  if (currentDates.length === 0) return [todayKey()];
  const sorted = [...currentDates].sort();
  const lastDateStr = sorted[sorted.length - 1];
  const lastDate = new Date(`${lastDateStr}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dateSet = new Set(currentDates);
  const cursor = new Date(lastDate);
  cursor.setDate(cursor.getDate() + 1);
  while (cursor <= today) {
    dateSet.add(cursor.toLocaleDateString("en-CA"));
    cursor.setDate(cursor.getDate() + 1);
  }
  return [...dateSet];
}

// Number of trailing weeks shown in the dashboard contribution heatmap. Columns are
// weeks (most recent on the right), rows are weekdays (Sunday at the top), mirroring
// the GitHub-style grid the redesign calls the "cadence strip".
const HEATMAP_WEEKS = 20;

type HeatCell = { key: string; active: boolean; count: number; isToday: boolean; future: boolean; label: string };

function buildHeatmapCells(activityDates: string[], counts: Record<string, number>): HeatCell[] {
  const active = new Set(activityDates);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Back up to the Sunday that starts the earliest visible week so column-major
  // layout lands each weekday on a fixed row.
  const start = new Date(today);
  start.setDate(start.getDate() - ((HEATMAP_WEEKS - 1) * 7 + today.getDay()));
  const key = todayKey();
  const cells: HeatCell[] = [];
  for (let i = 0; i < HEATMAP_WEEKS * 7; i += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    if (day > today) {
      cells.push({ key: `future-${i}`, active: false, count: 0, isToday: false, future: true, label: "" });
      continue;
    }
    const iso = day.toLocaleDateString("en-CA");
    const isActive = active.has(iso);
    cells.push({
      key: iso,
      active: isActive,
      // A day can be active with no count entry (older data predating count tracking);
      // treat that as at least 1 so the tooltip never says "0 solved" on an active day.
      count: counts[iso] ?? (isActive ? 1 : 0),
      isToday: iso === key,
      future: false,
      label: day.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
    });
  }
  return cells;
}

// Bucket a day's solved count into a GitHub-style intensity tier (0-4) so busier
// days render a deeper green than days with a single solve.
function heatIntensity(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 5) return 3;
  return 4;
}

// The redesign's signature dashboard element: a contribution heatmap of the days the
// user solved at least one problem, now count-aware: cells deepen with the number of
// problems solved that day and a stat board calls out today's tally.
function ActivityHeatmap({
  activityDates,
  counts,
  lastProblem,
}: {
  activityDates: string[];
  counts: Record<string, number>;
  lastProblem: { title: string; onOpen: () => void } | null;
}) {
  const cells = useMemo(() => buildHeatmapCells(activityDates, counts), [activityDates, counts]);
  const solvedDays = cells.filter((cell) => cell.active).length;
  const todayCount = counts[todayKey()] ?? 0;
  return (
    <div className="lc-cadence" aria-label="Practice rhythm">
      <div className="lc-cadence-head">
        <h2>Practice rhythm</h2>
        <span className="lc-cadence-sub">{HEATMAP_WEEKS}wk / {solvedDays} active</span>
      </div>
      <div className="lc-cadence-stats">
        <div className="lc-cadence-stat">
          <strong>{todayCount}</strong>
          <small>solved today</small>
        </div>
        <div className="lc-cadence-stat">
          <strong>{solvedDays}</strong>
          <small>active days</small>
        </div>
        {lastProblem ? (
          <button type="button" className="lc-cadence-resume" onClick={lastProblem.onOpen}>
            <span className="lc-cadence-resume-copy">
              <small>Jump back in</small>
              <strong>{lastProblem.title}</strong>
            </span>
            <ArrowRight size={16} />
          </button>
        ) : null}
      </div>
      <div className="lc-cadence-scroll">
        <div className="lc-cadence-grid" role="img" aria-label={`${solvedDays} active days in the last ${HEATMAP_WEEKS} weeks`}>
          {cells.map((cell) => (
            <span
              key={cell.key}
              className={`lc-cadence-cell${cell.isToday ? " is-today" : ""}${cell.future ? " is-future" : ""}`}
              data-level={cell.future ? undefined : heatIntensity(cell.count)}
              title={cell.future ? undefined : `${cell.label}${cell.active ? ` - ${cell.count} solved` : " - no activity"}`}
            />
          ))}
        </div>
      </div>
      <div className="lc-cadence-legend">
        <span>Less</span>
        <span className="lc-cadence-cell" data-level={0} />
        <span className="lc-cadence-cell" data-level={1} />
        <span className="lc-cadence-cell" data-level={2} />
        <span className="lc-cadence-cell" data-level={3} />
        <span className="lc-cadence-cell" data-level={4} />
        <span>More</span>
      </div>
    </div>
  );
}

// Persistent left rail for the KojoCode hub. Rendered on the dashboard and the
// beta stub screens; the immersive problem editor stays full-screen without it.
const RAIL_ITEMS: { key: string; label: string; icon: LucideIcon; view: View }[] = [
  { key: "dashboard", label: "Dashboard", icon: Layers3, view: { type: "tree" } },
  { key: "problems", label: "Problems", icon: Search, view: { type: "browse" } },
  { key: "banks", label: "Prep Banks", icon: BookOpen, view: { type: "banks" } },
  { key: "drills", label: "Drills", icon: Route, view: { type: "drills" } },
  { key: "practice", label: "Practice", icon: Sparkles, view: { type: "practice" } },
];

const RAIL_COLLAPSE_KEY = "nosey_lc_rail_collapsed";
// The problem editor renders the same rail but starts icon-only and remembers its own
// preference, so collapsing it there never collapses the hub rail (and vice versa).
const EDITOR_RAIL_COLLAPSE_KEY = "nosey_lc_rail_collapsed_editor";

function LeftRail({
  active,
  streak,
  onNavigate,
  storageKey = RAIL_COLLAPSE_KEY,
  defaultCollapsed = false,
}: {
  active: string;
  streak: number;
  onNavigate: (view: View) => void;
  storageKey?: string;
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return defaultCollapsed;
    const stored = localStorage.getItem(scopeKey(storageKey));
    return stored === null ? defaultCollapsed : stored === "true";
  });

  useEffect(() => {
    localStorage.setItem(scopeKey(storageKey), String(collapsed));
  }, [storageKey, collapsed]);

  return (
    <aside className="lc-rail" data-collapsed={collapsed} aria-label="KojoCode sections">
      <div className="lc-rail-header">
        <div className="lc-rail-brand">
          <span className="lc-rail-brand-name">KojoCode</span>
          <span className="lc-rail-brand-badge">Beta</span>
        </div>
        <button
          type="button"
          className="lc-rail-collapse-btn"
          onClick={() => setCollapsed((current) => !current)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-pressed={collapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
      <nav className="lc-rail-nav">
        {RAIL_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.key;
          return (
            <button
              key={item.key}
              type="button"
              className={`lc-rail-item${isActive ? " is-active" : ""}`}
              aria-current={isActive ? "page" : undefined}
              title={collapsed ? item.label : undefined}
              onClick={() => onNavigate(item.view)}
            >
              <span className="lc-rail-item-icon"><Icon size={18} /></span>
              <span className="lc-rail-item-label">{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="lc-rail-streak" title={collapsed ? `${streak} day streak` : undefined} aria-label={`${streak} day streak`}>
        <Flame size={16} />
        <strong>{streak}</strong>
        <small className="lc-rail-item-label">day streak</small>
      </div>
    </aside>
  );
}

// A literal countdown instrument: the ring drains as time passes instead of sitting
// as inert digits, and its color runs calm -> warn -> alert with the same thresholds
// the toolbar button and the modal use, so the three surfaces read as one system.
function TimerRing({
  fraction,
  tone,
  size = 30,
  stroke = 3,
}: {
  fraction: number;
  tone: "idle" | "calm" | "warn" | "alert";
  size?: number;
  stroke?: number;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(1, fraction)));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={`lc-timer-ring lc-timer-ring--${tone}`} aria-hidden="true">
      <circle className="lc-timer-ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none" />
      {tone !== "idle" ? (
        <circle
          className="lc-timer-ring-progress"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      ) : null}
    </svg>
  );
}

// Topic multi-select used by the practice builder and the bank "add by topic" flow.
// A controlled button + panel (not a native <details>) so it closes on outside click,
// matching the KojoMode attach-menu pattern.
function TopicPicker({
  options,
  selected,
  onToggle,
}: {
  options: { id: string; label: string; count: number }[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div className="lc-topic-picker" ref={containerRef}>
      <button
        type="button"
        className="lc-topic-summary"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span>
          {selected.size ? `${selected.size} topic${selected.size === 1 ? "" : "s"} selected` : "Choose topics"}
        </span>
        <ChevronDown size={15} className={open ? "lc-topic-chevron lc-topic-chevron--open" : "lc-topic-chevron"} />
      </button>
      {open ? (
        <div className="lc-topic-panel">
          {options.map((topic) => (
            <label key={topic.id} className="lc-topic-option">
              <input type="checkbox" checked={selected.has(topic.id)} onChange={() => onToggle(topic.id)} />
              <span className="lc-topic-option-label">{topic.label}</span>
              <span className="lc-topic-option-count">{topic.count}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Honest placeholder for the beta destinations whose backend (weakness scorer,
// Daily KojoCode generator, banks, drill scheduler) lands in Phase 2.
function ComingSoonScreen({
  title,
  subtitle,
  points,
}: {
  title: string;
  subtitle: string;
  points: string[];
}) {
  return (
    <div className="lc-coming">
      <span className="lc-coming-badge">In progress / Beta</span>
      <h1 className="lc-coming-title">{title}</h1>
      <p className="lc-coming-sub">{subtitle}</p>
      <ul className="lc-coming-points">
        {points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
    </div>
  );
}

type TopicStat = { id: string; label: string; done: number; total: number; pct: number };

function computeTopicStats(progress: Record<string, boolean>): TopicStat[] {
  return CATEGORIES.map((category) => {
    const total = category.problems.length;
    const done = category.problems.filter((problem) => progress[problem.slug]).length;
    return { id: category.id, label: category.label, done, total, pct: total ? done / total : 0 };
  });
}

// Green when a topic is well covered, sage in the middle, warm amber when it needs
// work. This is a completion proxy; the real per-topic weakness score (struggle
// signals) lands with the Phase 2 backend.
function masteryColor(pct: number): string {
  if (pct >= 0.75) return "var(--green-dark)";
  if (pct >= 0.45) return "#97a97c";
  return "#c2681f";
}

function focusTopics(progress: Record<string, boolean>): TopicStat[] {
  return computeTopicStats(progress)
    .filter((topic) => topic.total > 0)
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 4);
}

// ── 3-pass escalation ramp (the one bold move: green -> amber -> red) ──────────
// Reuses the app's difficulty colors so "harder, fewer resources" reads instantly.
// Red is reserved for Pass 3 / a running timer / a drill due now, so it means "now".
const PASS_RAMP = ["#10b981", "#d97706", "#dc2626"] as const;
// Pass 3 forces a technical-interview clock (todo-kojocode-rebuild 3h).
const DRILL_PASS3_MINUTES = 35;
const PASS_RULE = [
  "resources allowed",
  "no resources until you're stuck",
  "no resources, timed off the head",
] as const;

// Weakness runs the same ramp, inverted: a hotter (redder) topic is one the struggle
// signals flag hardest, so the eye lands on what needs work now.
function weaknessColor(level: number): string {
  if (level >= 4) return PASS_RAMP[2];
  if (level === 3) return PASS_RAMP[1];
  return "var(--green-dark)";
}

// The backend sends a category-id string (e.g. "trees"); resolve it to the catalog's
// display label + id so a Focus row can open the right category.
function resolveTopic(topic: string): { id: string; label: string } {
  const cat = CATEGORIES.find(
    (c) => c.id === topic || c.label.toLowerCase() === topic.toLowerCase(),
  );
  return { id: cat?.id ?? topic, label: cat?.label ?? topic };
}

function findProblemCategory(slug: string): string {
  return ALL_PROBLEMS.find((problem) => problem.slug === slug)?.categoryId ?? CUSTOM_CATEGORY_ID;
}

// A completion ring: the fraction of a bank's problems solved, drawn as a small donut
// with the count in the machine voice at its center. Reused across the bank gallery.
function CompletionRing({ done, total, size = 46 }: { done: number; total: number; size?: number }) {
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = total ? done / total : 0;
  const offset = circumference * (1 - pct);
  return (
    <span className="lc-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="lc-ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none" />
        <circle
          className="lc-ring-fill"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="lc-ring-label">{done}/{total}</span>
    </span>
  );
}

// Shipped preset banks, assembled entirely from OUR catalog (no scraping, per the spec).
// Each preset names catalog category ids; slugs are resolved at runtime so they are always
// valid even as the catalog changes. `perCat` caps how many problems a spread pulls per
// topic; omit it to take the whole category.
const PRESET_DEFS: { key: string; name: string; target: string; ids: string[]; perCat?: number }[] = [
  { key: "sampler", name: "Interview sampler", target: "blind-75 style", perCat: 2,
    ids: ["arrays", "strings", "hash-table", "linked-list", "stack", "binary-search", "tree", "graph", "dp", "intervals"] },
  { key: "trees-graphs", name: "Trees and graphs", target: "meta / onsite", ids: ["tree", "graph", "heap-priority-queue"] },
  { key: "arrays-strings", name: "Arrays and strings", target: "phone screen", ids: ["arrays", "strings", "hash-table", "sliding-window"] },
  { key: "dp", name: "DP and backtracking", target: "senior loop", ids: ["dp", "backtracking"] },
];

function buildPresetBanks(): { key: string; name: string; target: string; slugs: string[] }[] {
  return PRESET_DEFS.map((def) => {
    const seen = new Set<string>();
    const slugs: string[] = [];
    for (const id of def.ids) {
      const cat = CATEGORIES.find((category) => category.id === id);
      if (!cat) continue;
      const picks = def.perCat ? cat.problems.slice(0, def.perCat) : cat.problems;
      for (const problem of picks) {
        if (!seen.has(problem.slug)) {
          seen.add(problem.slug);
          slugs.push(problem.slug);
        }
      }
    }
    return { key: def.key, name: def.name, target: def.target, slugs };
  }).filter((preset) => preset.slugs.length > 0);
}

// mm:ss from a millisecond duration, for the practice elapsed clock (machine voice).
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

// Pull up to `count` problem slugs from a set of catalog topics: unsolved first, spread
// round-robin across topics for a balanced mix, filtered by difficulty and skipping a
// skip-set. Shared by the bank topic-add and the Weak-Area Practice builder.
function pickProblemsFromTopics(
  topicIds: string[],
  count: number,
  opts: { progress: Record<string, boolean>; skip?: Set<string>; difficulty?: "any" | Difficulty },
): string[] {
  const skip = opts.skip ?? new Set<string>();
  const difficulty = opts.difficulty ?? "any";
  const pools = topicIds.map((topicId) => {
    const category = CATEGORIES.find((c) => c.id === topicId);
    return (category?.problems ?? [])
      .filter((problem) => !skip.has(problem.slug))
      .filter((problem) => (difficulty === "any" ? true : problem.difficulty === difficulty))
      // unsolved (false=0) sorts before solved (true=1)
      .sort((a, b) => Number(Boolean(opts.progress[a.slug])) - Number(Boolean(opts.progress[b.slug])));
  });
  const picked: string[] = [];
  for (let depth = 0; picked.length < count; depth += 1) {
    let advanced = false;
    for (const pool of pools) {
      if (picked.length >= count) break;
      const problem = pool[depth];
      if (problem && !picked.includes(problem.slug)) {
        picked.push(problem.slug);
        advanced = true;
      }
    }
    if (!advanced) break;
  }
  return picked;
}

// The recurring structural device: a compact P1 - P2 - P3 ladder where completed passes
// are filled along the escalation ramp, the current pass glows, and locked passes stay
// muted. An earned sequence, not ornamental numbering. Shared by the Drills hub and,
// later, the in-workspace pass banner.
function PassRung({ current }: { current: number }) {
  return (
    <span className="lc-rung" role="img" aria-label={`Pass ${current} of 3`}>
      {[1, 2, 3].map((pass) => {
        const state = pass < current ? "done" : pass === current ? "current" : "locked";
        return (
          <span
            key={pass}
            className={`lc-rung-step is-${state}`}
            style={{ "--rung": PASS_RAMP[pass - 1] } as CSSProperties}
          >
            P{pass}
          </span>
        );
      })}
    </span>
  );
}

function TopicMasteryCard({ progress }: { progress: Record<string, boolean> }) {
  const topics = useMemo(() => computeTopicStats(progress), [progress]);
  return (
    <div className="lc-insight-card">
      <h2 className="lc-insight-title">Topic mastery</h2>
      <ul className="lc-mastery-list">
        {topics.map((topic) => (
          <li key={topic.id} className="lc-mastery-row">
            <div className="lc-mastery-head">
              <span className="lc-mastery-label">{topic.label}</span>
              <span className="lc-mastery-count">{topic.done}/{topic.total}</span>
            </div>
            <div className="lc-mastery-bar">
              <span style={{ width: `${Math.round(topic.pct * 100)}%`, background: masteryColor(topic.pct) }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

type FocusRow = { id: string; label: string; score: string; fillPct: number; color: string };

// The Focus areas card: names the topics that need the most work. When real struggle
// signals exist (timers, hints, failed grades from the last 3 days) it ranks by those
// and shows a weakness score on the hot green -> amber -> red ramp. Until signals
// arrive it falls back to a calm completion proxy, and says so, rather than pretending
// to score struggle or painting a brand-new account entirely red.
// The "Generate today's question" control lives here (beta only). It drives the real Daily
// KojoCode generation (handleGenerateDaily): before a problem exists it reads "Generate
// today's question"; while generating it spins; once today's problem exists it becomes a
// "Complete [title]" arrow that opens it. The same onGenerate handler serves all three since
// handleGenerateDaily opens the existing problem when one is already present.
function DailyPracticeCard({
  progress,
  weakness,
  improvement,
  onOpenCategory,
  betaMode,
  dailyProblem,
  dailyLoading,
  dailyError,
  activeBankName,
  onGenerate,
}: {
  progress: Record<string, boolean>;
  weakness: LCWeaknessTopic[];
  improvement: LCImprovementTopic[];
  onOpenCategory: (categoryId: string) => void;
  betaMode: boolean;
  dailyProblem: LCCustomProblem | null;
  dailyLoading: boolean;
  dailyError: string | null;
  activeBankName: string | null;
  onGenerate: () => void;
}) {
  const bySignal = weakness.length > 0;
  const rows = useMemo<FocusRow[]>(() => {
    if (bySignal) {
      return weakness.slice(0, 4).map((topic) => {
        const resolved = resolveTopic(topic.topic);
        return {
          id: resolved.id,
          label: resolved.label,
          score: `weakness ${topic.level}`,
          fillPct: (topic.level / 5) * 100,
          color: weaknessColor(topic.level),
        };
      });
    }
    // Completion proxy: show progress in the calm mastery colors (never the pure red
    // ramp, which is reserved for real struggle) so day one doesn't read as an alarm.
    return focusTopics(progress).map((topic) => ({
      id: topic.id,
      label: topic.label,
      score: `${topic.done}/${topic.total}`,
      fillPct: topic.pct * 100,
      color: masteryColor(topic.pct),
    }));
  }, [bySignal, weakness, progress]);

  return (
    <div className="lc-insight-card lc-focus-card">
      <div className="lc-focus-head">
        <h2 className="lc-insight-title">Focus areas</h2>
        <span className="lc-focus-source">{bySignal ? "by struggle signal" : "by completion"}</span>
      </div>
      <p className="lc-focus-sub">
        {bySignal
          ? "Ranked by your last 3 days of timers, hints, and failed grades. Higher score, more to work on."
          : "Ranked by completion for now. Struggle scoring kicks in once you drill and submit."}
      </p>
      <ul className="lc-focus-rows">
        {rows.map((row) => (
          <li key={row.id}>
            <button type="button" className="lc-focus-row" onClick={() => onOpenCategory(row.id)} title={`Practice ${row.label}`}>
              <span className="lc-focus-row-label">{row.label}</span>
              <span className="lc-focus-row-score">{row.score}</span>
              <span className="lc-focus-meter" aria-hidden="true">
                <span style={{ width: `${row.fillPct}%`, background: row.color }} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      {improvement.length > 0 ? (
        <div className="lc-improvement-chips">
          {improvement.slice(0, 3).map((topic) => {
            const resolved = resolveTopic(topic.topic);
            const reason = topic.reasons[0];
            return (
              <span key={topic.topic} className="lc-improvement-chip" title={reason}>
                <TrendingUp size={13} />
                Improving in {resolved.label}
              </span>
            );
          })}
        </div>
      ) : null}
      {betaMode ? (
        <>
          {dailyProblem && !dailyLoading ? (
            <button type="button" className="lc-focus-complete" onClick={onGenerate}>
              <span className="lc-focus-complete-label">Complete "{dailyProblem.title}"</span>
              <ArrowRight size={16} />
            </button>
          ) : (
            <button
              type="button"
              className="lc-focus-generate-btn"
              onClick={onGenerate}
              disabled={dailyLoading}
            >
              {dailyLoading ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
              {dailyLoading ? "Generating today's problem..." : "Generate today's question"}
            </button>
          )}
          {activeBankName ? (
            <p className="lc-daily-source-note">
              <BookOpen size={13} />
              Today's problem is drawn from your active bank: <strong>{activeBankName}</strong>
            </p>
          ) : null}
          {dailyError ? <p className="lc-daily-error">{dailyError}</p> : null}
        </>
      ) : null}
    </div>
  );
}

function RemindersCard({
  onNavigate,
  activeBank,
  drills,
  practiceSession,
  practiceEnded,
  progress,
  onOpenProblem,
}: {
  onNavigate: (view: View) => void;
  activeBank: LCPrepBank | null;
  drills: LCDrillSchedule[];
  practiceSession: PracticeSession | null;
  practiceEnded: boolean;
  progress: Record<string, boolean>;
  onOpenProblem: (slug: string) => void;
}) {
  // Difficulty is chosen when the bank is built (see the "Add problems by topic" panel
  // in the bank view); this card just picks a fresh one. Prefer a problem not solved yet
  // so the same handful don't keep resurfacing once you're partway through the bank.
  function handleOpenRandomBankProblem() {
    if (!activeBank || !activeBank.problem_slugs.length) return;
    const unsolved = activeBank.problem_slugs.filter((slug) => !progress[slug]);
    const pool = unsolved.length ? unsolved : activeBank.problem_slugs;
    onOpenProblem(randomFrom(pool));
  }

  // Open drills are the incomplete ones; prefer those already due, else any open drill.
  const openDrills = drills.filter((drill) => !drill.completed_at);
  function handleOpenRandomDrill() {
    if (!openDrills.length) return;
    const now = Date.now();
    const due = openDrills.filter((drill) => new Date(drill.next_due_at).getTime() <= now);
    const pool = due.length ? due : openDrills;
    onOpenProblem(randomFrom(pool).problem_slug);
  }

  const practiceActive = Boolean(practiceSession && !practiceEnded);
  const practiceSolved = practiceSession
    ? practiceSession.slugs.filter((slug) => progress[slug]).length
    : 0;

  return (
    <div className="lc-insight-card lc-reminders-card">
      <h2 className="lc-insight-title">Keep on Practicing!</h2>
      <div className="lc-reminders-list">
        {openDrills.length ? (
          <div className="lc-reminder-feature lc-reminder-feature--active">
            <span className="lc-reminder-feature-top">
              <span className="lc-reminder-icon"><Route size={20} /></span>
              <span className="lc-reminder-badge lc-reminder-badge--live">Active</span>
            </span>
            <strong className="lc-reminder-feature-title">3-Pass Drills</strong>
            <p className="lc-reminder-feature-copy">
              {openDrills.length} open drill{openDrills.length === 1 ? "" : "s"}. Struggled problems
              resurface three times with tightening constraints. Recall, not memorization.
            </p>
            <div className="lc-reminder-feature-controls">
              <button type="button" className="lc-reminder-feature-cta" onClick={handleOpenRandomDrill}>
                Open a problem
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="lc-reminder-feature" onClick={() => onNavigate({ type: "drills" })}>
            <span className="lc-reminder-feature-top">
              <span className="lc-reminder-icon"><Route size={20} /></span>
              <span className="lc-reminder-badge">Beta</span>
            </span>
            <strong className="lc-reminder-feature-title">Drills</strong>
            <p className="lc-reminder-feature-copy">
              Struggled problems resurface three times with tightening constraints:
              resources allowed, then no resources, then timed. Recall, not memorization.
            </p>
            <span className="lc-reminder-feature-cta">
              Preview Drills
              <ArrowRight size={14} />
            </span>
          </button>
        )}

        {activeBank ? (
          <div className="lc-reminder-feature lc-reminder-feature--active">
            <span className="lc-reminder-feature-top">
              <span className="lc-reminder-icon"><BookOpen size={20} /></span>
              <span className="lc-reminder-badge lc-reminder-badge--live">Active</span>
            </span>
            <strong className="lc-reminder-feature-title">{activeBank.name}</strong>
            <p className="lc-reminder-feature-copy">
              {activeBank.target ? `Prepping for ${activeBank.target}. ` : ""}
              {activeBank.problem_slugs.length} problem{activeBank.problem_slugs.length === 1 ? "" : "s"} in this bank.
            </p>
            <div className="lc-reminder-feature-controls">
              <button
                type="button"
                className="lc-reminder-feature-cta"
                onClick={handleOpenRandomBankProblem}
                disabled={!activeBank.problem_slugs.length}
              >
                Open a problem
                <ArrowRight size={14} />
              </button>
            </div>
            {!activeBank.problem_slugs.length ? (
              <p className="lc-reminder-feature-note">Add problems to this bank to start pulling from it.</p>
            ) : null}
          </div>
        ) : (
          <button type="button" className="lc-reminder-feature" onClick={() => onNavigate({ type: "banks" })}>
            <span className="lc-reminder-feature-top">
              <span className="lc-reminder-icon"><BookOpen size={20} /></span>
              <span className="lc-reminder-badge">Beta</span>
            </span>
            <strong className="lc-reminder-feature-title">Prep Banks</strong>
            <p className="lc-reminder-feature-copy">
              Build a named, scoped problem set for a specific interview. Set one active
              and it takes over your daily practice until you're done with it.
            </p>
            <span className="lc-reminder-feature-cta">
              Preview Prep Banks
              <ArrowRight size={14} />
            </span>
          </button>
        )}

        {practiceActive && practiceSession ? (
          <button type="button" className="lc-reminder-feature" onClick={() => onNavigate({ type: "practice" })}>
            <span className="lc-reminder-feature-top">
              <span className="lc-reminder-icon"><Sparkles size={20} /></span>
              <span className="lc-reminder-badge lc-reminder-badge--live">In progress</span>
            </span>
            <strong className="lc-reminder-feature-title">Current practice set</strong>
            <p className="lc-reminder-feature-copy">
              {practiceSolved} of {practiceSession.slugs.length} solved. Pick back up where you left off.
            </p>
            <span className="lc-reminder-feature-cta">
              Resume practice
              <ArrowRight size={14} />
            </span>
          </button>
        ) : (
          <button type="button" className="lc-reminder-feature" onClick={() => onNavigate({ type: "practice" })}>
            <span className="lc-reminder-feature-top">
              <span className="lc-reminder-icon"><Sparkles size={20} /></span>
              <span className="lc-reminder-badge">Beta</span>
            </span>
            <strong className="lc-reminder-feature-title">Weak-Area Practice</strong>
            <p className="lc-reminder-feature-copy">
              Pick the topics that need work and run a guided queue with a session
              recap at the end.
            </p>
            <span className="lc-reminder-feature-cta">
              Preview Practice
              <ArrowRight size={14} />
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

export default function LeetCodeMode() {
  const {
    generationProvider,
    betaMode,
    weaknessSensitivity,
    setWeaknessSensitivity,
    difficultyPromptEnabled,
    setDifficultyPromptEnabled,
  } = useSettings();
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
  // Per-day solved tally keyed by YYYY-MM-DD, cached in localStorage for instant display
  // and reconciled from the backend (authoritative) on mount. Increments optimistically
  // when a problem is marked solved, then syncs.
  const [solvedDayCounts, setSolvedDayCounts] = useState<Record<string, number>>(() => loadJson(getActivityCountsKey(), {}));
  const [filter, setFilter] = useState<Filter>("all");
  const [difficultyFilter, setDifficultyFilter] = useState<Set<Difficulty>>(new Set());
  const [topicFilter, setTopicFilter] = useState<Set<string>>(new Set());
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
  // Total duration the current countdown started from, kept only to compute the ring's
  // drained fraction (remaining / total) -- not itself a source of truth for anything else.
  const [timerTotalSeconds, setTimerTotalSeconds] = useState<number | null>(null);
  const [timerPickerOpen, setTimerPickerOpen] = useState(false);
  const [timeoutModalOpen, setTimeoutModalOpen] = useState(false);
  const [timeoutModalMessage, setTimeoutModalMessage] = useState<string | null>(null);
  const [solutionOpen, setSolutionOpen] = useState(false);
  const [visualizerTrace, setVisualizerTrace] = useState<TraceResult | null>(null);
  const [visualizerLoading, setVisualizerLoading] = useState<string | null>(null);
  const [kojoOpen, setKojoOpen] = useState(false);
  const [customSlashCommands, setCustomSlashCommands] = useState<SlashCommand[]>([]);
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
  const [streakChallenge, setStreakChallenge] = useState<LCStreakChallenge | null>(null);
  const [dailyProblem, setDailyProblem] = useState<LCCustomProblem | null>(null);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [dailyError, setDailyError] = useState<string | null>(null);
  const [prepBanks, setPrepBanks] = useState<LCPrepBank[]>([]);
  const [banksLoading, setBanksLoading] = useState(false);
  const [selectedBankId, setSelectedBankId] = useState<number | null>(null);
  const [newBankName, setNewBankName] = useState("");
  const [newBankTarget, setNewBankTarget] = useState("");
  const [bankMatchText, setBankMatchText] = useState("");
  const [bankMatchUnmatched, setBankMatchUnmatched] = useState<string[]>([]);
  // Topic-based add: companies interview by topic, so the primary add flow is "pick
  // topics + how many problems", not a hand-typed problem list.
  const [bankAddTopics, setBankAddTopics] = useState<Set<string>>(new Set());
  const [bankAddCount, setBankAddCount] = useState(5);
  const [bankAddDifficulty, setBankAddDifficulty] = useState<"any" | "Easy" | "Medium" | "Hard">("any");
  const [bankAddNote, setBankAddNote] = useState<string | null>(null);
  // "Create with Kojo" (AI) generates a fresh problem; the reuse path stays AI-free so a
  // user who never wants AI can fill a bank / practice set entirely from the catalog.
  const [bankKojoLoading, setBankKojoLoading] = useState(false);
  const [practiceKojoLoading, setPracticeKojoLoading] = useState(false);
  const [drills, setDrills] = useState<LCDrillSchedule[]>([]);
  const [drillsLoading, setDrillsLoading] = useState(false);
  const [drillAddText, setDrillAddText] = useState("");
  // Add-a-problem-by-LeetCode-link modal, scoped to the category it was opened from.
  const [addLinkCategoryId, setAddLinkCategoryId] = useState<string | null>(null);
  const [addLinkUrl, setAddLinkUrl] = useState("");
  const [addLinkLoading, setAddLinkLoading] = useState(false);
  const [addLinkError, setAddLinkError] = useState<string | null>(null);
  // Real per-topic struggle scores (last 3 days) from GET /leetcode/weakness. Empty on
  // cold start; the Focus card falls back to a completion proxy until signals arrive.
  const [weakness, setWeakness] = useState<LCWeaknessTopic[]>([]);
  // Topics the user is actively getting better at (last 7 days), from the same
  // GET /leetcode/weakness call. Positive reinforcement, shown as chips on the Focus card.
  const [improvement, setImprovement] = useState<LCImprovementTopic[]>([]);
  // KojoCode settings cog: sensitivity presets + "Clear weakness signals".
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [clearWeaknessConfirm, setClearWeaknessConfirm] = useState(false);
  // "How hard did that feel?" prompt: the slug awaiting a rating (null = closed).
  const [difficultyPromptSlug, setDifficultyPromptSlug] = useState<string | null>(null);
  // Slugs whose solution reveal has already been logged this session (dedupe).
  const solutionViewedLoggedRef = useRef<Set<string>>(new Set());
  // Bank-scoped weakness for the currently selected bank detail (worst-first). Fetched
  // per selected bank; separate from the global `weakness` above.
  const [bankWeakness, setBankWeakness] = useState<LCWeaknessTopic[]>([]);
  // Weak-Area Practice: a builder (topics + difficulty + count) that spins up a stepped
  // queue of catalog problems, then a session summary. Topics start empty, the user picks
  // them. The session persists across opening/returning problems, and across page
  // refreshes via localStorage (see loadPracticeSession/savePracticeSession).
  const [practiceTopics, setPracticeTopics] = useState<Set<string>>(() => new Set());
  const [practiceDifficulty, setPracticeDifficulty] = useState<"any" | "Easy" | "Medium" | "Hard">("any");
  const [practiceCount, setPracticeCount] = useState(5);
  const [practiceInit] = useState(() => loadPracticeSession());
  const [practiceSession, setPracticeSession] = useState<PracticeSession | null>(() => practiceInit.session);
  const [practiceEnded, setPracticeEnded] = useState(() => practiceInit.ended);
  const [practiceNote, setPracticeNote] = useState<string | null>(null);
  // Bumped once a second while a session runs so the elapsed clock ticks live.
  const [, setPracticeTick] = useState(0);
  // The last problem the user opened in the editor, for a "jump back in" shortcut on the
  // dashboard. Persisted per-user so it survives refresh.
  const [lastProblemSlug, setLastProblemSlug] = useState<string | null>(
    () => loadJson<string | null>(getLastProblemKey(), null),
  );

  // Full list (active + archived) backs deep-link lookups so an archived problem can
  // still be opened directly. The active/archived splits below back the list views.
  const allCustomProblemList = useMemo(() => customProblems.map(customToProblem), [customProblems]);
  // Daily KojoCode problems are excluded from the user-authored Custom Questions list
  // (they render in their own Daily KojoCode section instead), but stay reachable by
  // direct slug via allCustomProblemList above so opening one from the dashboard works.
  const activeCustomProblems = useMemo(
    () => customProblems.filter((cp) => !cp.is_archived && cp.source !== "daily_kojo"),
    [customProblems],
  );
  const archivedCustomProblems = useMemo(
    () => customProblems.filter((cp) => cp.is_archived && cp.source !== "daily_kojo"),
    [customProblems],
  );
  const customProblemList = useMemo(() => activeCustomProblems.map(customToProblem), [activeCustomProblems]);
  const archivedProblemList = useMemo(() => archivedCustomProblems.map(customToProblem), [archivedCustomProblems]);

  // Active customs that resolve to the catch-all Custom bucket (not added into a real
  // category). Backs the Custom Questions category + its dashboard node, so a link-added
  // problem shows only under its real topic, never doubled in Custom.
  const customCategoryList = useMemo(
    () => customProblemList.filter((problem) => problem.categoryId === CUSTOM_CATEGORY_ID),
    [customProblemList],
  );
  // Problems added into a real category via "add by link", keyed by that category id.
  const addedProblemsForCategory = useMemo(() => {
    const byCategory = new Map<string, Problem[]>();
    for (const problem of customProblemList) {
      if (problem.categoryId === CUSTOM_CATEGORY_ID) continue;
      const list = byCategory.get(problem.categoryId) ?? [];
      list.push(problem);
      byCategory.set(problem.categoryId, list);
    }
    return byCategory;
  }, [customProblemList]);

  // "Browse all" pools every official problem (deduped by slug, so a problem listed in
  // two categories appears once) plus active custom problems, for cross-topic filtering.
  const browseProblems = useMemo(
    () => [...UNIQUE_PROBLEMS, ...customProblemList],
    [customProblemList],
  );
  // Topic chips for the browse view: every official category, plus a Custom chip when the
  // user has custom problems. The id matches Problem.categoryId so the topic filter works.
  const topicOptions = useMemo(() => {
    const options = CATEGORIES.map((category) => ({ id: category.id, label: category.label }));
    if (customProblemList.length > 0) {
      options.push({ id: CUSTOM_CATEGORY_ID, label: CUSTOM_CATEGORY_LABEL });
    }
    return options;
  }, [customProblemList.length]);

  // Shipped preset banks, resolved once from the catalog (stable for the session).
  const presetBanks = useMemo(() => buildPresetBanks(), []);

  // Catalog topics (with problem counts) for the bank's topic-based add dropdown.
  const bankTopicOptions = useMemo(
    () => CATEGORIES.filter((category) => category.problems.length > 0).map((category) => ({
      id: category.id,
      label: category.label,
      count: category.problems.length,
    })),
    [],
  );

  // Resolve by slug across the catalog AND the custom list. A problem added to a real
  // category by link carries that category id but a custom-* slug that only lives in the
  // custom list, so a catalog-only lookup would miss it and blank the workspace.
  const currentProblem =
    view.type === "problem"
      ? (CATEGORIES.find((category) => category.id === view.categoryId)?.problems.find((problem) => problem.slug === view.problemSlug)
          ?? allCustomProblemList.find((problem) => problem.slug === view.problemSlug)
          ?? null)
      : null;

  const currentCustomProblem = currentProblem
    ? customProblems.find((cp) => cp.slug === currentProblem.slug) ?? null
    : null;
  const isCustomProblem = Boolean(currentCustomProblem);
  const isStreakChallengeProblem =
    betaMode &&
    streakChallenge !== null &&
    streakChallenge.completed_at === null &&
    currentProblem?.slug === streakChallenge.problem_slug;
  const currentProblemState = currentProblem ? problemStates[currentProblem.slug] : undefined;
  const currentProblemData = currentCustomProblem ? customToProblemData(currentCustomProblem) : currentProblemState?.data;
  const currentCustomCases = currentProblem ? customCases[currentProblem.slug] ?? [] : [];
  const currentCodeWorkspace = currentProblem ? codeWorkspaces[currentProblem.slug] ?? null : null;
  const currentCodeTab = currentCodeWorkspace?.tabs.find((tab) => tab.id === currentCodeWorkspace.activeTabId) ?? currentCodeWorkspace?.tabs[0] ?? null;
  const currentCode = currentCodeTab?.code ?? "";
  const allKojoCommands = [...CHAT_COMMANDS, ...customSlashCommands];
  const timerButtonLabel = timerRemainingSeconds == null ? "Timer" : `${Math.floor(timerRemainingSeconds / 60)}:${String(timerRemainingSeconds % 60).padStart(2, "0")}`;
  const timerFraction = timerTotalSeconds && timerRemainingSeconds != null ? timerRemainingSeconds / timerTotalSeconds : null;
  // calm for most of the run, warn inside the last third, alert inside the last fifth --
  // same thresholds drive the ring color, the toolbar pill, and the pulse animation.
  const timerTone: "idle" | "calm" | "warn" | "alert" =
    timerFraction == null ? "idle" : timerFraction <= 0.2 ? "alert" : timerFraction <= 0.34 ? "warn" : "calm";

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
      .then(({ progress: dbProgress, activity_dates: dbDates, activity_counts: dbCounts }) => {
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
        setSolvedDayCounts((localCounts) => {
          // Backend is authoritative; take the higher of local and server per day so a
          // just-solved optimistic bump survives until the server confirms it.
          const merged = { ...localCounts };
          for (const [date, count] of Object.entries(dbCounts ?? {})) {
            merged[date] = Math.max(merged[date] ?? 0, count);
          }
          saveActivityCounts(merged);
          return merged;
        });
      })
      .catch(() => { });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On mount: fetch streak challenge for beta users.
  useEffect(() => {
    if (isGuestSession() || !betaMode) return;
    fetchLCStreakChallenge()
      .then((existing) => {
        setStreakChallenge(existing);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [betaMode]);

  // On mount (beta users): fetch today's Daily KojoCode problem if one already exists, so
  // the Focus card shows the "Complete [title]" arrow instead of the generate button after a
  // reload. No generation side effect, matches GET /leetcode/daily.
  useEffect(() => {
    if (isGuestSession() || !betaMode) return;
    fetchLCDaily()
      .then((existing) => setDailyProblem(existing))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [betaMode]);

  // On mount: fetch prep banks and open drills for beta users (both rail destinations).
  useEffect(() => {
    if (isGuestSession() || !betaMode) return;
    setBanksLoading(true);
    fetchLCPrepBanks()
      .then(setPrepBanks)
      .catch(() => {})
      .finally(() => setBanksLoading(false));
    setDrillsLoading(true);
    fetchLCDrills()
      .then(setDrills)
      .catch(() => {})
      .finally(() => setDrillsLoading(false));
    fetchLCScores(weaknessSensitivity, undefined, readWeaknessResetIso())
      .then((scores) => {
        setWeakness(scores.weakness.topics);
        setImprovement(scores.improvement.topics);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [betaMode, weaknessSensitivity]);

  // Bank-scoped weakness for the open bank detail (separate from global weakness).
  // Refetched whenever the selected bank or sensitivity changes; cleared when none.
  useEffect(() => {
    if (isGuestSession() || !betaMode || selectedBankId == null) {
      setBankWeakness([]);
      return;
    }
    let cancelled = false;
    fetchLCWeakness(weaknessSensitivity, selectedBankId, readWeaknessResetIso())
      .then((topics) => {
        if (!cancelled) setBankWeakness(topics);
      })
      .catch(() => {
        if (!cancelled) setBankWeakness([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [betaMode, selectedBankId, weaknessSensitivity]);

  // On mount: fetch user-created slash commands from settings so they appear in the Kojo modal.
  useEffect(() => {
    if (isGuestSession()) return;
    fetchSlashCommands()
      .then(setCustomSlashCommands)
      .catch(() => {});
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

  // Seed starter snippet after async fetch completes (first open when cache is cold).
  // Backfills every still-empty tab, not just tab 0, so a tab added before the fetch
  // resolved is healed the same way instead of staying blank forever.
  useEffect(() => {
    if (!currentProblem || !currentProblemData?.python_snippet) return;
    const snippet = currentProblemData.python_snippet.trimEnd();
    if (!snippet) return;

    setCodeWorkspaces((prev) => {
      const workspace = prev[currentProblem.slug] ?? loadCodeWorkspace(currentProblem.slug);
      if (!workspace.tabs.some((tab) => !tab.code.trim())) return prev;
      const nextWorkspace = {
        ...workspace,
        tabs: workspace.tabs.map((tab) => (tab.code.trim() ? tab : { ...tab, code: snippet })),
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

  // Pass 3 drills force a timer: auto-start it once when such a problem opens and no timer
  // is running. Keyed on the opened slug + drills so it fires on open (or when a pass is
  // advanced to 3 in place), not on every tick, so it never restarts after expiry or bail.
  useEffect(() => {
    if (!betaMode || view.type !== "problem") return;
    const drill = drills.find((d) => d.problem_slug === view.problemSlug && !d.completed_at);
    if ((drill?.current_pass ?? 1) >= 3 && timerRemainingSeconds == null) {
      startTimer(DRILL_PASS3_MINUTES);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, drills, betaMode]);

  // Tick the Weak-Area Practice elapsed clock once a second while a session is running.
  useEffect(() => {
    if (!practiceSession || practiceEnded) return;
    const id = window.setInterval(() => setPracticeTick((tick) => tick + 1), 1000);
    return () => window.clearInterval(id);
  }, [practiceSession, practiceEnded]);

  // Persist the practice session so a page refresh doesn't lose an in-progress set.
  useEffect(() => {
    savePracticeSession(practiceSession, practiceEnded);
  }, [practiceSession, practiceEnded]);

  const stats = useMemo(() => {
    // Built-in catalog + every active custom problem, including user-authored ones in the
    // Custom Questions bucket. Custom slugs are custom-* so they never collide with catalog
    // slugs, and the list is already filtered to active (non-archived, non-daily) problems.
    const pool = [...UNIQUE_PROBLEMS, ...customProblemList];
    const solved = pool.filter((problem) => progress[problem.slug]);
    return {
      total: pool.length,
      solved: solved.length,
      percent: pool.length ? Math.round((solved.length / pool.length) * 100) : 0,
      easy: solved.filter((problem) => problem.difficulty === "Easy").length,
      medium: solved.filter((problem) => problem.difficulty === "Medium").length,
      hard: solved.filter((problem) => problem.difficulty === "Hard").length,
      currentStreak: countStreak(activityDates),
      bestStreak: countBestStreak(activityDates),
    };
  }, [activityDates, progress, customProblemList]);

  // Show the streak rescue challenge at the bottom of the roadmap when:
  // - beta mode is on
  // - the current streak is 0 (streak has ended)
  // - the user had a streak before (so there is something to save)
  // - a challenge exists and has not been completed yet
  const showStreakChallenge =
    betaMode &&
    stats.currentStreak === 0 &&
    stats.bestStreak > 0 &&
    streakChallenge !== null &&
    streakChallenge.completed_at === null;

  // The actual rescue problem chosen for this challenge (random per streak loss).
  // Look it up across verified + all custom problems so the node can show its real
  // title/difficulty and navigate to its real category.
  const streakChallengeProblem = streakChallenge
    ? [...UNIQUE_PROBLEMS, ...allCustomProblemList].find((p) => p.slug === streakChallenge.problem_slug) ?? null
    : null;

  async function ensureStreakChallengeExists() {
    if (isGuestSession() || !betaMode) return;
    if (streakChallenge && streakChallenge.completed_at === null) return;
    // Pick a fresh random unsolved Medium/Hard from the verified + custom catalog.
    // The pick is locked in on the server row, so it stays fixed until completed.
    const slug = pickStreakChallengeSlug([...UNIQUE_PROBLEMS, ...customProblemList], progress);
    const created = await createLCStreakChallenge(slug);
    if (created) setStreakChallenge(created);
  }

  // When streak drops to 0 and the user has a prior streak, auto-create the challenge.
  useEffect(() => {
    if (!betaMode || isGuestSession()) return;
    if (stats.currentStreak === 0 && stats.bestStreak > 0) {
      void ensureStreakChallengeExists();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats.currentStreak, stats.bestStreak, betaMode]);

  // Looks a slug up across the official catalog + the user's own custom problems, for
  // displaying a real title in the Prep Banks / Drills lists (which only store slugs).
  function findProblemTitle(slug: string): string {
    return (
      UNIQUE_PROBLEMS.find((p) => p.slug === slug)?.title ??
      customProblems.find((cp) => cp.slug === slug)?.title ??
      slug
    );
  }

  // Resolve a slug to a full Problem (catalog first, then the user's custom problems) so a
  // bank row can show difficulty, a solved check, and a canonical LeetCode link.
  function findProblem(slug: string): Problem | null {
    return (
      UNIQUE_PROBLEMS.find((p) => p.slug === slug) ??
      allCustomProblemList.find((p) => p.slug === slug) ??
      null
    );
  }

  // Per-topic solved/total breakdown across a bank's problems: the bank's own weak-area
  // map, mirroring the dashboard Focus card but scoped to the bank. Weakest topic first.
  function bankTopicStats(slugs: string[]): TopicStat[] {
    const byTopic = new Map<string, { label: string; done: number; total: number }>();
    for (const slug of slugs) {
      const problem = findProblem(slug);
      const id = problem?.categoryId ?? CUSTOM_CATEGORY_ID;
      const label =
        problem?.categoryId === CUSTOM_CATEGORY_ID || !problem
          ? CUSTOM_CATEGORY_LABEL
          : CATEGORY_META[problem.categoryId]?.label ?? problem.categoryLabel;
      const row = byTopic.get(id) ?? { label, done: 0, total: 0 };
      row.total += 1;
      if (progress[slug]) row.done += 1;
      byTopic.set(id, row);
    }
    return Array.from(byTopic.entries())
      .map(([id, row]) => ({ id, label: row.label, done: row.done, total: row.total, pct: row.total ? row.done / row.total : 0 }))
      .sort((a, b) => a.pct - b.pct);
  }

  // Case-insensitive exact-title match against the catalog + the user's own custom
  // problems. The backend owns no catalog (see KOJOCODE_BACKEND_IMPLEMENTATION.md), so
  // this match happens client-side; only resolved slugs get sent to the bulk-add endpoint.
  function matchPastedTitlesToSlugs(text: string): { matched: string[]; unmatched: string[] } {
    const pool = [...UNIQUE_PROBLEMS, ...allCustomProblemList];
    const byTitle = new Map(pool.map((p) => [p.title.trim().toLowerCase(), p.slug]));
    const lines = text
      .split(/[\n,]/)
      .map((line) => line.trim())
      .filter(Boolean);
    const matched: string[] = [];
    const unmatched: string[] = [];
    for (const line of lines) {
      const slug = byTitle.get(line.toLowerCase());
      if (slug) matched.push(slug);
      else unmatched.push(line);
    }
    return { matched, unmatched };
  }

  // Daily KojoCode: reskins a random problem from the user's weakest recent topic (or a
  // random topic on cold start) at the mapped difficulty (1-2 Easy, 3 Medium, 4-5 Hard,
  // per todo-daily-kojocode.md). Re-pressing after today's problem exists just opens it.
  async function handleGenerateDaily() {
    if (dailyLoading) return;
    if (dailyProblem) {
      openProblem(CUSTOM_CATEGORY_ID, dailyProblem.slug);
      return;
    }
    setDailyLoading(true);
    setDailyError(null);
    try {
      const resetIso = readWeaknessResetIso();
      const recent = loadRecentDailySeeds();

      let seed: Problem | undefined;
      let topicLabel = "";
      let targetDifficulty: "Easy" | "Medium" | "Hard" = "Medium";

      // If a Prep Bank is active, the daily targets that bank's own weak areas
      // (bank-scoped weakness, computed separately from the global scorer). This is
      // struggle-driven, not completion-driven, so it stops pinning to whichever bank
      // topic is least complete and follows where the user actually struggles.
      const activeBank = prepBanks.find((bank) => bank.is_active);
      if (activeBank && activeBank.problem_slugs.length) {
        const bankProblems = activeBank.problem_slugs
          .map(findProblem)
          .filter((problem): problem is Problem => Boolean(problem));
        const bankScores = await fetchLCWeakness(
          weaknessSensitivity,
          activeBank.id as number,
          resetIso,
        ).catch(() => [] as LCWeaknessTopic[]);

        // Rank the bank's topics by real struggle; fall back to completion ordering
        // only on cold start (no bank signals yet).
        const bankTopicIds = new Set(bankProblems.map((p) => p.categoryId));
        const weakTopic = pickWeightedTopic(
          bankScores.filter((t) => bankTopicIds.has(resolveTopic(t.topic).id)),
          3,
        );
        const chosenTopicId = weakTopic
          ? resolveTopic(weakTopic.topic).id
          : bankTopicStats(activeBank.problem_slugs)[0]?.id;
        const topicPool = chosenTopicId
          ? bankProblems.filter((problem) => problem.categoryId === chosenTopicId)
          : [];
        const pool = topicPool.length ? topicPool : bankProblems;
        seed = chooseDailySeed(pool, recent, progress);
        if (seed) {
          topicLabel = CATEGORY_META[seed.categoryId]?.label ?? seed.categoryLabel;
          targetDifficulty = weakTopic
            ? difficultyForLevel(weakTopic.level)
            : seed.difficulty === "Easy" || seed.difficulty === "Hard"
              ? seed.difficulty
              : "Medium";
        }
      }

      // Full-catalog path: no active bank (or none of its slugs resolved). Rotate
      // across the top few globally weak topics; cold-start to a random topic.
      if (!seed) {
        const weakTopic = pickWeightedTopic(weakness, 3);
        targetDifficulty = weakTopic ? difficultyForLevel(weakTopic.level) : "Easy";
        const matchedCategory =
          (weakTopic &&
            CATEGORIES.find(
              (c) =>
                c.id === weakTopic.topic ||
                c.label.toLowerCase() === weakTopic.topic.toLowerCase(),
            )) ||
          CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
        const pool = matchedCategory.problems.length ? matchedCategory.problems : UNIQUE_PROBLEMS;
        seed = chooseDailySeed(pool, recent, progress);
        topicLabel = matchedCategory.label;
      }

      if (!seed) throw new Error("Kojo couldn't find a problem to base today's question on.");

      const created = await createLCDaily(topicLabel, targetDifficulty, seed.slug, generationProvider);
      pushRecentDailySeed(seed.slug);
      setDailyProblem(created);
      setCustomProblems((prev) => [...prev, created]);
      openProblem(CUSTOM_CATEGORY_ID, created.slug);
    } catch (error) {
      setDailyError(error instanceof Error ? error.message : "Kojo couldn't generate today's problem.");
    } finally {
      setDailyLoading(false);
    }
  }

  // Re-pulls the global weakness/improvement scores with the current sensitivity and
  // reset marker. Used after clearing signals so the UI reflects the change at once.
  async function refreshGlobalScores() {
    try {
      const scores = await fetchLCScores(weaknessSensitivity, undefined, readWeaknessResetIso());
      setWeakness(scores.weakness.topics);
      setImprovement(scores.improvement.topics);
    } catch {
      // best-effort
    }
  }

  // Clear weakness signals (soft reset): stamp "now" as the marker so signals before
  // this moment stop counting, then refetch. Non-destructive: raw events are kept for
  // streak/improvement history; only the weakness window start moves forward.
  async function handleClearWeaknessSignals() {
    setClearWeaknessConfirm(false);
    try {
      localStorage.setItem(getWeaknessResetKey(), String(Date.now()));
    } catch {
      // ignore storage failures; the refetch below simply won't change anything
    }
    setBankWeakness([]);
    await refreshGlobalScores();
    setSettingsOpen(false);
  }

  // ── Interview Prep Banks ────────────────────────────────────────────────────

  async function handleCreateBank() {
    const name = newBankName.trim();
    if (!name || banksLoading) return;
    setBanksLoading(true);
    try {
      const created = await createLCPrepBank(name, newBankTarget.trim());
      setPrepBanks((prev) => [...prev, created]);
      setNewBankName("");
      setNewBankTarget("");
      setSelectedBankId(created.id as number);
    } catch {
      // best-effort, the create button stays available to retry
    } finally {
      setBanksLoading(false);
    }
  }

  // Create a bank pre-filled from a shipped preset: create it, then bulk-add the preset's
  // catalog slugs. The bulk-add returns the updated bank (with problem_slugs), so we swap
  // the freshly created row for it and open the detail.
  async function handleCreateFromPreset(preset: { name: string; target: string; slugs: string[] }) {
    if (banksLoading) return;
    setBanksLoading(true);
    try {
      const created = await createLCPrepBank(preset.name, preset.target);
      const filled = preset.slugs.length
        ? await bulkAddLCBankProblems(created.id as number, preset.slugs).catch(() => created)
        : created;
      setPrepBanks((prev) => [...prev, filled]);
      setSelectedBankId(filled.id as number);
    } catch {
      // best-effort, the preset stays available to retry
    } finally {
      setBanksLoading(false);
    }
  }

  async function handleDeleteBank(bankId: number) {
    await deleteLCPrepBank(bankId).catch(() => {});
    setPrepBanks((prev) => prev.filter((bank) => bank.id !== bankId));
    setSelectedBankId((current) => (current === bankId ? null : current));
  }

  async function handleActivateBank(bankId: number) {
    const updated = await activateLCPrepBank(bankId).catch(() => null);
    if (!updated) return;
    setPrepBanks((prev) => prev.map((bank) => ({ ...bank, is_active: bank.id === bankId })));
  }

  async function handleMatchAndAddToBank(bankId: number) {
    const { matched, unmatched } = matchPastedTitlesToSlugs(bankMatchText);
    setBankMatchUnmatched(unmatched);
    if (!matched.length) return;
    const updated = await bulkAddLCBankProblems(bankId, matched).catch(() => null);
    if (!updated) return;
    setPrepBanks((prev) => prev.map((bank) => (bank.id === bankId ? updated : bank)));
    setBankMatchText("");
  }

  function toggleBankAddTopic(topicId: string) {
    setBankAddNote(null);
    setBankAddTopics((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) next.delete(topicId);
      else next.add(topicId);
      return next;
    });
  }

  // Pull `bankAddCount` problems from the selected topics into the bank: unsolved first,
  // spread round-robin across topics for a balanced set, skipping anything already in the
  // bank. This is the primary add flow, matching how companies scope by topic.
  async function handleAddByTopic(bankId: number) {
    const bank = prepBanks.find((b) => b.id === bankId);
    if (!bank || bankAddTopics.size === 0) return;
    const picked = pickProblemsFromTopics(Array.from(bankAddTopics), bankAddCount, {
      progress,
      skip: new Set(bank.problem_slugs),
      difficulty: bankAddDifficulty,
    });
    if (!picked.length) {
      setBankAddNote("No new problems left in those topics and difficulty.");
      return;
    }
    const updated = await bulkAddLCBankProblems(bankId, picked).catch(() => null);
    if (!updated) return;
    setPrepBanks((prev) => prev.map((b) => (b.id === bankId ? updated : b)));
    setBankAddTopics(new Set());
    setBankAddNote(`Added ${picked.length} problem${picked.length === 1 ? "" : "s"} from ${bankAddTopics.size} topic${bankAddTopics.size === 1 ? "" : "s"}.`);
  }

  // "Create with Kojo": generate ONE fresh problem (AI) from the selected topics and, for
  // difficulty, an optional target. Reuses the existing custom-problem pipeline
  // (generate -> persist -> sync) so there is no new endpoint. Returns the saved problem,
  // or null on failure. The reuse flows (handleAddByTopic / startPracticeSession) never
  // call this, so the no-AI path is fully AI-free.
  async function createKojoProblemFromTopics(
    topicIds: string[],
    difficulty: "any" | "Easy" | "Medium" | "Hard",
  ): Promise<LCCustomProblem | null> {
    const labels = topicIds
      .map((id) => CATEGORY_META[id]?.label ?? bankTopicOptions.find((t) => t.id === id)?.label ?? id)
      .filter(Boolean);
    const topicText = labels.length ? labels.join(", ") : "general coding interview";
    const difficultyText = difficulty === "any" ? "" : ` The difficulty should be ${difficulty}.`;
    const hint = `Create a brand new, original coding interview problem focused on these topics: ${topicText}.${difficultyText} Do not copy a well-known existing problem: invent a fresh scenario with a clear prompt, a function signature, and worked examples.`;
    const generated: LCGeneratedCustomProblem = await generateLCCustomProblem("", hint, generationProvider);
    const slug = makeCustomSlug();
    const payload: Omit<LCCustomProblem, "slug"> = {
      title: generated.title || "Kojo Problem",
      topic: topicIds[0] ?? "unknown",
      difficulty:
        generated.difficulty === "Easy" || generated.difficulty === "Medium" || generated.difficulty === "Hard"
          ? generated.difficulty
          : difficulty === "any"
            ? "unknown"
            : difficulty,
      description: generated.description,
      url: "",
      starter_code: generated.starter_code,
      test_cases: generated.test_cases.map((tc) => ({
        input_text: tc.input_text,
        output_text: tc.output_text,
        explanation_text: tc.explanation_text ?? null,
      })),
      is_archived: false,
    };
    const saved: LCCustomProblem = { slug, ...payload };
    persistCustomProblems([...customProblems, saved]);
    if (!isGuestSession()) {
      await syncLCCustomProblem(slug, payload).catch(() => {});
    }
    return saved;
  }

  async function handleCreateWithKojoForBank(bankId: number) {
    if (bankKojoLoading) return;
    setBankAddNote(null);
    setBankKojoLoading(true);
    try {
      const saved = await createKojoProblemFromTopics(Array.from(bankAddTopics), bankAddDifficulty);
      if (!saved) {
        setBankAddNote("Kojo couldn't generate a problem. Try again.");
        return;
      }
      const updated = await addLCBankProblem(bankId, saved.slug).catch(() => null);
      if (updated) {
        setPrepBanks((prev) => prev.map((b) => (b.id === bankId ? updated : b)));
      } else {
        // Guest or offline: reflect the add locally so the UI still updates.
        setPrepBanks((prev) =>
          prev.map((b) =>
            b.id === bankId ? { ...b, problem_slugs: [...b.problem_slugs, saved.slug] } : b,
          ),
        );
      }
      setBankAddNote(`Kojo created "${saved.title}" and added it to this bank.`);
    } catch (error) {
      setBankAddNote(error instanceof Error ? error.message : "Kojo generation failed.");
    } finally {
      setBankKojoLoading(false);
    }
  }

  async function handleRemoveBankProblem(bankId: number, slug: string) {
    await removeLCBankProblem(bankId, slug).catch(() => {});
    setPrepBanks((prev) =>
      prev.map((bank) =>
        bank.id === bankId ? { ...bank, problem_slugs: bank.problem_slugs.filter((s) => s !== slug) } : bank,
      ),
    );
  }

  // ── 3-Pass Drills ────────────────────────────────────────────────────────────

  async function handleAddDrillManual() {
    const { matched } = matchPastedTitlesToSlugs(drillAddText);
    const slug = matched[0];
    if (!slug) return;
    const created = await createLCDrill(slug).catch(() => null);
    if (!created) return;
    setDrills((prev) => (prev.some((d) => d.problem_slug === slug) ? prev : [...prev, created]));
    setDrillAddText("");
  }

  // Shared by drill advancement and timer-expiry struggle events: prefer a custom
  // problem's own topic, else the catalog category the slug belongs to. (Grading
  // resolves this itself since it already has the custom problem loaded for its
  // description too.)
  function resolveProblemTopic(slug: string): string {
    return customProblems.find((cp) => cp.slug === slug)?.topic || findProblemCategory(slug);
  }

  async function handleAdvanceDrill(slug: string) {
    const updated = await advanceLCDrill(slug, resolveProblemTopic(slug)).catch(() => null);
    if (!updated) return;
    setDrills((prev) =>
      updated.completed_at
        ? prev.filter((d) => d.problem_slug !== slug)
        : prev.map((d) => (d.problem_slug === slug ? updated : d)),
    );
  }

  // ── Weak-Area Practice ───────────────────────────────────────────────────────

  function togglePracticeTopic(topicId: string) {
    setPracticeNote(null);
    setPracticeTopics((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) next.delete(topicId);
      else next.add(topicId);
      return next;
    });
  }

  function startPracticeSession() {
    if (practiceTopics.size === 0) return;
    const slugs = pickProblemsFromTopics(Array.from(practiceTopics), practiceCount, {
      progress,
      difficulty: practiceDifficulty,
    });
    if (!slugs.length) {
      setPracticeNote("No problems match those topics and difficulty. Widen the filters.");
      return;
    }
    setPracticeNote(null);
    setPracticeEnded(false);
    setPracticeSession({
      slugs,
      startedAt: Date.now(),
      startedSolved: new Set(slugs.filter((slug) => progress[slug])),
      endedAt: null,
    });
  }

  // "Create with Kojo" for practice: generate one fresh problem (AI) from the selected
  // topics + difficulty and start a one-problem session with it. The reuse path
  // (startPracticeSession) stays catalog-only and AI-free.
  async function startKojoPracticeSession() {
    if (practiceKojoLoading || practiceTopics.size === 0) return;
    setPracticeNote(null);
    setPracticeKojoLoading(true);
    try {
      const saved = await createKojoProblemFromTopics(Array.from(practiceTopics), practiceDifficulty);
      if (!saved) {
        setPracticeNote("Kojo couldn't generate a problem. Try again.");
        return;
      }
      setPracticeEnded(false);
      setPracticeSession({
        slugs: [saved.slug],
        startedAt: Date.now(),
        startedSolved: new Set(progress[saved.slug] ? [saved.slug] : []),
        endedAt: null,
      });
    } catch (error) {
      setPracticeNote(error instanceof Error ? error.message : "Kojo generation failed.");
    } finally {
      setPracticeKojoLoading(false);
    }
  }

  function endPracticeSession() {
    setPracticeSession((prev) => (prev ? { ...prev, endedAt: Date.now() } : prev));
    setPracticeEnded(true);
  }

  function resetPracticeSession() {
    setPracticeSession(null);
    setPracticeEnded(false);
    setPracticeNote(null);
  }

  // ── Add a problem to a category by LeetCode link ─────────────────────────────

  function openAddLink(categoryId: string) {
    setAddLinkCategoryId(categoryId);
    setAddLinkUrl("");
    setAddLinkError(null);
  }

  function closeAddLink() {
    setAddLinkCategoryId(null);
    setAddLinkUrl("");
    setAddLinkError(null);
  }

  // Capture a real LeetCode problem into the current category: parse the slug, fetch the
  // statement/starter/examples once, and save it as a custom-problem row tagged with the
  // category id (so it renders + counts there). Reuses the whole custom-problem pipeline.
  async function handleAddProblemFromLink() {
    const categoryId = addLinkCategoryId;
    if (!categoryId || addLinkLoading) return;
    const slug = parseLeetCodeSlug(addLinkUrl);
    if (!slug) {
      setAddLinkError("Paste a LeetCode problem link, e.g. leetcode.com/problems/two-sum/");
      return;
    }
    const canonicalUrl = `${LEETCODE_BASE_URL}/${slug}/`;
    if (UNIQUE_PROBLEMS.some((problem) => problem.slug === slug)) {
      setAddLinkError("That problem is already in the built-in catalog.");
      return;
    }
    if (allCustomProblemList.some((problem) => problem.url === canonicalUrl)) {
      setAddLinkError("You've already added that problem.");
      return;
    }
    setAddLinkLoading(true);
    setAddLinkError(null);
    try {
      const data = await fetchLeetCodeProblem(slug);
      const customSlug = makeCustomSlug();
      const payload: Omit<LCCustomProblem, "slug"> = {
        title: data.title,
        topic: categoryId,
        difficulty:
          data.difficulty === "Easy" || data.difficulty === "Medium" || data.difficulty === "Hard"
            ? data.difficulty
            : "unknown",
        description: htmlToText(data.content_html),
        url: canonicalUrl,
        starter_code: data.python_snippet ?? "",
        test_cases: data.examples.map((example) => ({
          input_text: example.input_text,
          output_text: example.output_text,
          explanation_text: example.explanation_text ?? null,
        })),
        is_archived: false,
        source: "user",
      };
      const saved: LCCustomProblem = { slug: customSlug, ...payload };
      persistCustomProblems([...customProblems, saved]);
      if (!isGuestSession()) {
        await syncLCCustomProblem(customSlug, payload).catch(() => {});
      }
      closeAddLink();
    } catch (error) {
      setAddLinkError(error instanceof Error ? error.message : "Couldn't load that problem from LeetCode.");
    } finally {
      setAddLinkLoading(false);
    }
  }

  function pushProgressToDb(
    nextProgress: Record<string, boolean>,
    nextDates: string[],
    nextCounts: Record<string, number>,
  ) {
    if (isGuestSession()) return;
    syncLCProgress({ progress: nextProgress, activity_dates: nextDates, activity_counts: nextCounts }).catch(() => { });
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

  // Optimistically add one to today's solved tally (never decremented, matching how
  // activityDates only ever grows), persist it, and return the new map to sync.
  function bumpTodayCount(): Record<string, number> {
    const key = todayKey();
    const nextCounts = { ...solvedDayCounts, [key]: (solvedDayCounts[key] ?? 0) + 1 };
    setSolvedDayCounts(nextCounts);
    saveActivityCounts(nextCounts);
    return nextCounts;
  }

  // After finishing a problem, ask how hard it felt (once per problem). The rating
  // becomes a weakness signal, which is how we catch a topic the user quietly
  // struggled with but never asked for a hint on.
  function maybePromptDifficulty(problem: Problem) {
    if (!difficultyPromptEnabled || !betaMode || isGuestSession()) return;
    if (loadDifficultySurveyed().has(problem.slug)) return;
    setDifficultyPromptSlug(problem.slug);
  }

  function handleDifficultyRating(rating: "easy" | "medium" | "hard" | "brutal") {
    const slug = difficultyPromptSlug;
    setDifficultyPromptSlug(null);
    if (!slug) return;
    markDifficultySurveyed(slug);
    void logLCStruggleEvent(resolveProblemTopic(slug), `self_rated_${rating}`, slug);
  }

  function dismissDifficultyPrompt() {
    const slug = difficultyPromptSlug;
    setDifficultyPromptSlug(null);
    if (slug) markDifficultySurveyed(slug); // asked once, don't nag on re-mark
  }

  function toggleProgress(problem: Problem) {
    const nextDone = !progress[problem.slug];
    const next = { ...progress, [problem.slug]: nextDone };
    setProgress(next);
    saveProgress(next);
    const nextDates = nextDone ? recordSolvedToday() : activityDates;
    const nextCounts = nextDone ? bumpTodayCount() : solvedDayCounts;
    pushProgressToDb(next, nextDates, nextCounts);
    if (nextDone) maybePromptDifficulty(problem);
  }

  function markProblemDone(problem: Problem) {
    if (progress[problem.slug]) return;
    const next = { ...progress, [problem.slug]: true };
    setProgress(next);
    saveProgress(next);
    const nextCounts = bumpTodayCount();

    // If this is the streak challenge problem, bridge the activity gap so the streak
    // is restored to continuity before adding today.
    if (isStreakChallengeProblem) {
      const bridgedDates = fillStreakGap(activityDates);
      setActivityDates(bridgedDates);
      saveActivityDates(bridgedDates);
      pushProgressToDb(next, bridgedDates, nextCounts);
      completeLCStreakChallenge()
        .then(() => setStreakChallenge((prev) => prev ? { ...prev, completed_at: new Date().toISOString() } : prev))
        .catch(() => {});
    } else {
      const nextDates = recordSolvedToday();
      pushProgressToDb(next, nextDates, nextCounts);
    }
    maybePromptDifficulty(problem);
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
    setTimerTotalSeconds(null);
    closeTimerPicker();
    closeTimeoutModal();
  }

  function startTimer(minutes: number) {
    if (!currentProblem || !Number.isFinite(minutes) || minutes <= 0) return;

    timerExpiryHandledRef.current = false;
    closeTimerPicker();
    closeTimeoutModal();
    const totalSeconds = Math.round(minutes * 60);
    setTimerRemainingSeconds(totalSeconds);
    setTimerTotalSeconds(totalSeconds);
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
        const customForGrade = customProblems.find((cp) => cp.slug === problemAtRun.slug);
        void postLCTestRun(
          problemAtRun.slug,
          customForGrade?.topic || problemAtRun.categoryId,
          problemAtRun.difficulty,
          result.ok,
        );
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
          const grade = await gradeLeetCodeSubmission(
            problemAtRun.slug,
            problemAtRun.title,
            codeToRun,
            testResultsSummary,
            result.ok,
            customForGrade?.topic || problemAtRun.categoryId,
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

  async function handleTimerExpired(problemAtTimeout: Problem) {
    if (runnerLoading || gradeLoading) {
      setTimeoutModalMessage("Time ran out while Kojo was still grading your current run. You can continue without the timer or clear the active tab.");
      setTimeoutModalOpen(true);
      return;
    }

    void logLCStruggleEvent(resolveProblemTopic(problemAtTimeout.slug), "timer_expiry", problemAtTimeout.slug);

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

    setLastProblemSlug(problemSlug);
    localStorage.setItem(getLastProblemKey(), JSON.stringify(problemSlug));

    setView({ type: "problem", categoryId, problemSlug });
    setMobilePane("problem");
    setKojoOpen(false);
    setSolutionOpen(false);
    setRunnerResult(null);
    setGradeFeedback(null);
    resetTimerState();
  }

  function handleCodeChange(value: string) {
    if (!currentProblem) return;
    const slug = currentProblem.slug;
    // Derive from the functional updater's `prev`, not the outer closure's
    // `codeWorkspaces`, so rapid keystrokes never build a next-state off a
    // workspace snapshot that's already stale by the time this runs.
    setCodeWorkspaces((prev) => {
      const workspace = prev[slug] ?? loadCodeWorkspace(slug);
      const nextWorkspace = {
        ...workspace,
        tabs: workspace.tabs.map((tab) => (tab.id === workspace.activeTabId ? { ...tab, code: value } : tab)),
      };
      saveCodeWorkspace(slug, nextWorkspace);
      schedulePushWorkspaceToDb(slug, nextWorkspace);
      return { ...prev, [slug]: nextWorkspace };
    });
  }

  function handleAddCodeTab() {
    if (!currentProblem) return;
    const slug = currentProblem.slug;
    const workspace = codeWorkspaces[slug] ?? loadCodeWorkspace(slug);
    if (workspace.tabs.length >= MAX_CODE_TABS) return;

    // Seed the new tab with the same starter snippet the first tab gets, so a fresh
    // tab starts from the problem's function signature instead of a blank buffer.
    const starter = currentProblemData?.python_snippet?.trimEnd() ?? "";
    const nextTab = { id: makeTabId(), name: `Tab ${workspace.tabs.length + 1}`, code: starter };
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

    // Monaco measures glyph widths at mount using whatever font is available
    // then. JetBrains Mono loads asynchronously (Google Fonts, display=swap),
    // so the first measurement uses the fallback font. When the real font
    // swaps in, the glyphs change width but the cached metrics do not, which
    // pushes the caret out of alignment. Remeasure once the font is ready.
    if (typeof document !== "undefined" && document.fonts?.ready) {
      const remeasure = () => monaco.editor.remeasureFonts();
      document.fonts.ready.then(remeasure);
      // Also remeasure if JetBrains Mono finishes loading after fonts.ready
      // has already resolved (first paint with fallback, swap arrives later).
      document.fonts.load("14px 'JetBrains Mono'").then(remeasure).catch(() => {});
    }

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

  // Ephemeral per-turn grounding sent to Kojo alongside each message (never
  // shown as a chat bubble): the problem statement plus the student's current
  // code, so hints stay relevant as they edit. Clamped well under the
  // backend's 8000-char cap on GeneralChatRequest.context.
  function buildLeetCodeKojoContext(): string {
    if (!currentProblem) return "";
    const statement =
      currentCustomProblem?.description ||
      (currentProblemData?.content_html ? htmlToText(currentProblemData.content_html) : "");
    const parts = [
      `Problem: ${currentProblem.title}`,
      statement ? `Statement:\n${statement.slice(0, 4000)}` : "",
      currentCode ? `Student's current code:\n${currentCode.slice(0, 3500)}` : "",
    ].filter(Boolean);
    return parts.join("\n\n").slice(0, 7900);
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

  // KojoCode settings cog: weakness sensitivity + clear weakness signals. Rendered on
  // the dashboard where the cog lives.
  const settingsModalNode = settingsOpen ? (
    <>
      <div className="lc-kojo-backdrop" onClick={() => setSettingsOpen(false)} />
      <div className="lc-settings-modal" role="dialog" aria-label="KojoCode settings">
        <div className="lc-settings-modal-header">
          <div className="lc-settings-modal-title">
            <Settings size={16} />
            <span>KojoCode settings</span>
          </div>
          <button
            type="button"
            className="lc-settings-close"
            onClick={() => setSettingsOpen(false)}
            aria-label="Close settings"
          >
            <X size={16} />
          </button>
        </div>

        <div className="lc-settings-section">
          <span className="lc-settings-label">Weakness sensitivity</span>
          <p className="lc-settings-help">How aggressively KojoCode flags weak topics.</p>
          <div className="lc-settings-segmented" role="group" aria-label="Weakness sensitivity">
            {(["low", "medium", "high"] as const).map((level) => (
              <button
                key={level}
                type="button"
                className={`lc-settings-seg-btn${weaknessSensitivity === level ? " lc-settings-seg-btn--active" : ""}`}
                aria-pressed={weaknessSensitivity === level}
                onClick={() => setWeaknessSensitivity(level)}
              >
                {level.charAt(0).toUpperCase() + level.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="lc-settings-section">
          <span className="lc-settings-label">Ask how hard each problem felt</span>
          <p className="lc-settings-help">
            A quick "how hard was that?" after you finish a problem. Your answer feeds your weak areas.
          </p>
          <ToggleSwitch
            checked={difficultyPromptEnabled}
            label={difficultyPromptEnabled ? "On" : "Off"}
            onClick={() => setDifficultyPromptEnabled(!difficultyPromptEnabled)}
          />
        </div>

        <div className="lc-settings-section">
          <span className="lc-settings-label">Clear weakness signals</span>
          <p className="lc-settings-help">
            Reset your weak-area read. Your streak, heatmap, and solved history are kept.
          </p>
          <button
            type="button"
            className="lc-settings-clear-btn"
            onClick={() => setClearWeaknessConfirm(true)}
          >
            <Trash2 size={14} />
            Clear weakness signals
          </button>
        </div>
      </div>
      {clearWeaknessConfirm ? (
        <ConfirmModal
          title="Clear weakness signals?"
          message="KojoCode will forget your recent struggle signals and rebuild your weak areas from new activity. Your streak, heatmap, and solved history are not affected."
          confirmLabel="Clear"
          onConfirm={() => void handleClearWeaknessSignals()}
          onCancel={() => setClearWeaknessConfirm(false)}
        />
      ) : null}
    </>
  ) : null;

  // "How hard did that feel?" self-report, shown once after finishing a problem.
  // The answer becomes a weakness signal (hard/brutal add, easy trims the topic).
  const difficultyModalNode = difficultyPromptSlug ? (
    <div className="modal-backdrop" onMouseDown={dismissDifficultyPrompt}>
      <div
        className="modal-card survey-card lc-difficulty-card"
        role="dialog"
        aria-modal="true"
        aria-label="Problem difficulty"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="survey-head">
          <p className="survey-eyebrow">One quick thing</p>
          <h2 className="survey-title">How hard did that feel?</h2>
        </div>
        <div className="lc-difficulty-options">
          {(
            [
              { key: "easy", label: "Easy" },
              { key: "medium", label: "Just right" },
              { key: "hard", label: "Hard" },
              { key: "brutal", label: "Brutal" },
            ] as const
          ).map((option) => (
            <button
              key={option.key}
              type="button"
              className={`lc-difficulty-btn lc-difficulty-btn--${option.key}`}
              onClick={() => handleDifficultyRating(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button type="button" className="lc-difficulty-skip" onClick={dismissDifficultyPrompt}>
          Skip
        </button>
      </div>
    </div>
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

  function toggleDifficulty(value: Difficulty) {
    setDifficultyFilter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function toggleTopic(id: string) {
    setTopicFilter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearFilters(includeTopic: boolean) {
    setFilter("all");
    setDifficultyFilter(new Set());
    if (includeTopic) setTopicFilter(new Set());
  }

  // Status options share the chip idiom with difficulty/topic (single-select), each with
  // an icon so the control reads clearly instead of as a plain segmented toggle.
  const STATUS_OPTIONS: { value: Filter; label: string; Icon: LucideIcon }[] = [
    { value: "all", label: "All", Icon: ListChecks },
    { value: "todo", label: "To do", Icon: Circle },
    { value: "done", label: "Done", Icon: CheckCircle2 },
  ];

  // Shared combinable filter bar. `showTopic` adds the cross-category topic chips (browse
  // view only); category views pass false since they are already scoped to one topic.
  // Every dimension uses one unified chip system so the bar reads as a single control set.
  function renderFilterBar(showTopic: boolean) {
    const anyActive =
      filter !== "all" || difficultyFilter.size > 0 || (showTopic && topicFilter.size > 0);
    return (
      <div className="lc-filter-bar">
        <div className="lc-filter-group">
          <span className="lc-filter-label">Difficulty</span>
          <div className="lc-filter-chips">
            {(["Easy", "Medium", "Hard"] as Difficulty[]).map((value) => {
              const active = difficultyFilter.has(value);
              const tone = value.toLowerCase();
              return (
                <button
                  key={value}
                  type="button"
                  className={`lc-filter-chip${active ? ` lc-filter-chip--active lc-filter-chip--${tone}` : ""}`}
                  aria-pressed={active}
                  onClick={() => toggleDifficulty(value)}
                >
                  <span className={`lc-diff-dot lc-diff-dot--${tone}`} />
                  {value}
                </button>
              );
            })}
          </div>
        </div>
        <div className="lc-filter-group">
          <span className="lc-filter-label">Status</span>
          <div className="lc-filter-chips" role="group" aria-label="Status filter">
            {STATUS_OPTIONS.map(({ value, label, Icon }) => {
              const active = filter === value;
              return (
                <button
                  key={value}
                  type="button"
                  className={`lc-filter-chip lc-filter-chip--status${active ? " lc-filter-chip--active" : ""}`}
                  aria-pressed={active}
                  onClick={() => setFilter(value)}
                >
                  <Icon size={14} />
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        {showTopic ? (
          <div className="lc-filter-group lc-filter-group--topic">
            <span className="lc-filter-label">Topic</span>
            <div className="lc-filter-chips">
              {topicOptions.map((topic) => (
                <button
                  key={topic.id}
                  type="button"
                  className={`lc-filter-chip${topicFilter.has(topic.id) ? " lc-filter-chip--active" : ""}`}
                  aria-pressed={topicFilter.has(topic.id)}
                  onClick={() => toggleTopic(topic.id)}
                >
                  {topic.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {anyActive ? (
          <div className="lc-filter-actions">
            <button type="button" className="lc-filter-clear" onClick={() => clearFilters(showTopic)}>
              <X size={13} />
              Clear filters
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  // Friendly empty state shown whenever a filtered list has no matches, instead of an
  // empty bordered list box. `onReset` clears filters so the user can recover in one tap.
  function renderFilterEmpty(onReset: () => void) {
    return (
      <div className="lc-empty">
        <span className="lc-empty-icon"><Search size={26} /></span>
        <p className="lc-empty-title">Whoops, looks like there's nothing here...</p>
        <small className="lc-empty-sub">No problems match these filters.</small>
        <button type="button" className="lc-empty-reset" onClick={onReset}>
          <X size={14} />
          Clear filters
        </button>
      </div>
    );
  }

  if (view.type === "tree") {
    return (
      <div className="lc-shell">
        <LeftRail active="dashboard" streak={stats.currentStreak} onNavigate={setView} />
        <div className="page lc-page lc-shell-body">
        <header className="lc-hero">
          <div>
            <span className="eyebrow">Beta</span>
            <h1>KojoCode</h1>
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
            {betaMode ? (
              <button
                type="button"
                className="lc-cog-btn"
                onClick={() => setSettingsOpen(true)}
                aria-label="KojoCode settings"
                title="KojoCode settings"
              >
                <Settings size={16} />
              </button>
            ) : null}
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
            <small>Easy</small><span className="lc-split-val lc-split-val--easy">{stats.easy}</span>
            <small>Medium</small><span className="lc-split-val lc-split-val--medium">{stats.medium}</span>
            <small>Hard</small><span className="lc-split-val lc-split-val--hard">{stats.hard}</span>
          </div>
        </section>

        <div className="lc-dash-row">
          <ActivityHeatmap
            activityDates={activityDates}
            counts={solvedDayCounts}
            lastProblem={
              lastProblemSlug
                ? { title: findProblemTitle(lastProblemSlug), onOpen: () => openProblem(findProblemCategory(lastProblemSlug), lastProblemSlug) }
                : null
            }
          />
          <DailyPracticeCard
            progress={progress}
            weakness={weakness}
            improvement={improvement}
            onOpenCategory={(categoryId) => setView({ type: "category", categoryId })}
            betaMode={betaMode}
            dailyProblem={dailyProblem}
            dailyLoading={dailyLoading}
            dailyError={dailyError}
            activeBankName={prepBanks.find((bank) => bank.is_active)?.name ?? null}
            onGenerate={() => void handleGenerateDaily()}
          />
        </div>

        <div className="lc-dash-row">
          <TopicMasteryCard progress={progress} />
          <RemindersCard
            onNavigate={setView}
            activeBank={prepBanks.find((bank) => bank.is_active) ?? null}
            drills={drills}
            practiceSession={practiceSession}
            practiceEnded={practiceEnded}
            progress={progress}
            onOpenProblem={(slug) => openProblem(findProblemCategory(slug), slug)}
          />
        </div>

        <section className="lc-custom-section" aria-label="Custom questions">
          {(() => {
            const customDone = customCategoryList.filter((problem) => progress[problem.slug]).length;
            const customPct = customCategoryList.length ? Math.round((customDone / customCategoryList.length) * 100) : 0;
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
                      {customCategoryList.length
                        ? `${customDone}/${customCategoryList.length} complete`
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

        {showStreakChallenge ? (
          <section className="lc-streak-section" aria-label="Save My Streak challenge">
            <button
              type="button"
              className="lc-streak-node"
              onClick={() =>
                setView({
                  type: "problem",
                  categoryId: streakChallengeProblem?.categoryId ?? "arrays",
                  problemSlug: streakChallenge?.problem_slug ?? STREAK_CHALLENGE_FALLBACK_SLUG,
                })
              }
            >
              <span className="lc-streak-node-icon">
                <ShieldAlert size={22} />
              </span>
              <span className="lc-streak-node-copy">
                <span className="lc-streak-node-title">
                  <strong>Save My Streak</strong>
                  <span className="lc-streak-badge">Beta</span>
                </span>
                <span className="lc-streak-node-meta">
                  {streakChallengeProblem ? (
                    <span className={`lc-difficulty lc-difficulty--${difficultyClass(streakChallengeProblem.difficulty)}`}>
                      {streakChallengeProblem.difficulty}
                    </span>
                  ) : null}
                  <span className="lc-streak-node-desc">
                    {(streakChallengeProblem?.title ?? "Rescue problem")} - no Kojo, no NeetCode
                  </span>
                </span>
                {streakChallenge?.expires_at ? (
                  <small className="lc-streak-node-expires">
                    Expires {new Date(streakChallenge.expires_at).toLocaleString()}
                  </small>
                ) : (
                  <small className="lc-streak-node-expires">No expiry - solve to restore your streak</small>
                )}
              </span>
              <span className="lc-streak-node-flame"><Flame size={20} /></span>
            </button>
          </section>
        ) : null}

        {customModalNode}
        {confirmDeleteNode}
        {settingsModalNode}
        {difficultyModalNode}
        </div>
      </div>
    );
  }

  if (view.type === "practice") {
    const inSummary = Boolean(practiceSession && practiceEnded);
    const inQueue = Boolean(practiceSession && !practiceEnded);
    return (
      <div className="lc-shell">
        <LeftRail active="practice" streak={stats.currentStreak} onNavigate={setView} />
        <div className="page page-narrow lc-page lc-shell-body">
          <header className="lc-category-header">
            <div className="lc-category-title-row" style={{ "--lc-accent": "#9333ea" } as CSSProperties}>
              <span className="lc-node-icon"><Sparkles size={22} /></span>
              <div>
                <h1>Weak-Area Practice</h1>
                <p className="muted">Pick the topics that need work, run a guided queue, finish on a session recap.</p>
              </div>
            </div>
          </header>

          {!practiceSession ? (
            <div className="lc-practice-builder">
              <div className="lc-practice-field">
                <span className="lc-practice-field-label">Focus topics</span>
                <TopicPicker options={bankTopicOptions} selected={practiceTopics} onToggle={togglePracticeTopic} />
              </div>

              <div className="lc-practice-field">
                <span className="lc-practice-field-label">Difficulty</span>
                <div className="lc-practice-seg" role="group" aria-label="Difficulty">
                  {(["any", "Easy", "Medium", "Hard"] as const).map((level) => (
                    <button
                      key={level}
                      type="button"
                      className={`lc-practice-seg-btn${practiceDifficulty === level ? " is-active" : ""}`}
                      onClick={() => setPracticeDifficulty(level)}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>

              <div className="lc-practice-field">
                <span className="lc-practice-field-label">How many</span>
                <input
                  type="number"
                  className="lc-practice-count"
                  min={1}
                  max={30}
                  value={practiceCount}
                  onChange={(event) => setPracticeCount(Math.max(1, Math.min(30, Number(event.target.value) || 1)))}
                />
              </div>

              <div className="lc-practice-actions">
                <button
                  type="button"
                  className="button button-primary lc-practice-start"
                  onClick={startPracticeSession}
                  disabled={practiceTopics.size === 0 || practiceKojoLoading}
                >
                  <Plus size={16} />
                  Continue from selection
                </button>
                <button
                  type="button"
                  className="button lc-practice-start lc-bank-kojo-btn"
                  onClick={() => void startKojoPracticeSession()}
                  disabled={practiceTopics.size === 0 || practiceKojoLoading}
                >
                  <Sparkles size={16} />
                  {practiceKojoLoading ? "Creating..." : "Create with Kojo"}
                </button>
              </div>
              <p className="muted small lc-practice-note">
                Continue from selection uses our catalog only. Create with Kojo uses AI to generate a fresh problem.
              </p>
              {practiceNote ? <p className="lc-practice-note">{practiceNote}</p> : null}
            </div>
          ) : null}

          {inQueue && practiceSession ? (
            (() => {
              const solved = practiceSession.slugs.filter((slug) => progress[slug]).length;
              const elapsed = formatElapsed(Date.now() - practiceSession.startedAt);
              return (
                <div className="lc-practice-run">
                  <div className="lc-practice-run-head">
                    <span className="lc-practice-progress">{solved}/{practiceSession.slugs.length} solved</span>
                    <span className="lc-practice-clock">{elapsed}</span>
                    <button type="button" className="lc-practice-finish" onClick={endPracticeSession}>
                      Finish session
                    </button>
                  </div>
                  <ol className="lc-practice-queue">
                    {practiceSession.slugs.map((slug, index) => {
                      const problem = findProblem(slug);
                      const isSolved = Boolean(progress[slug]);
                      const difficulty = problem?.difficulty ?? "Unknown";
                      return (
                        <li key={slug} className={`lc-practice-step${isSolved ? " is-done" : ""}`}>
                          <span className="lc-practice-step-num">step {String(index + 1).padStart(2, "0")}</span>
                          <span className={`lc-practice-step-check${isSolved ? " is-done" : ""}`} aria-hidden="true">
                            {isSolved ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                          </span>
                          <button
                            type="button"
                            className="lc-practice-step-title"
                            onClick={() => openProblem(findProblemCategory(slug), slug)}
                          >
                            {findProblemTitle(slug)}
                          </button>
                          <span className={`lc-difficulty lc-difficulty--${difficultyClass(difficulty)}`}>{difficulty}</span>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              );
            })()
          ) : null}

          {inSummary && practiceSession ? (
            (() => {
              const total = practiceSession.slugs.length;
              const solved = practiceSession.slugs.filter((slug) => progress[slug]).length;
              const elapsed = formatElapsed((practiceSession.endedAt ?? Date.now()) - practiceSession.startedAt);
              const improvedSlugs = practiceSession.slugs.filter(
                (slug) => progress[slug] && !practiceSession.startedSolved.has(slug),
              );
              const improvedTopics = Array.from(
                new Set(
                  improvedSlugs.map((slug) => {
                    const problem = findProblem(slug);
                    return problem ? CATEGORY_META[problem.categoryId]?.label ?? problem.categoryLabel : CUSTOM_CATEGORY_LABEL;
                  }),
                ),
              );
              return (
                <div className="lc-practice-summary">
                  <span className="lc-practice-summary-eyebrow">session complete</span>
                  <div className="lc-practice-summary-tiles">
                    <div className="lc-practice-tile">
                      <strong>{solved}/{total}</strong>
                      <small>solved</small>
                    </div>
                    <div className="lc-practice-tile">
                      <strong>{elapsed}</strong>
                      <small>time</small>
                    </div>
                    <div className="lc-practice-tile">
                      <strong>{improvedSlugs.length}</strong>
                      <small>new this session</small>
                    </div>
                  </div>
                  {improvedTopics.length ? (
                    <p className="lc-practice-improved">Topics improved: {improvedTopics.join(", ")}</p>
                  ) : (
                    <p className="lc-practice-improved muted">No new solves logged this session. Keep at it.</p>
                  )}
                  <div className="lc-practice-summary-actions">
                    <button type="button" className="button button-primary" onClick={resetPracticeSession}>
                      New session
                    </button>
                    <button type="button" className="lc-practice-secondary" onClick={() => setView({ type: "tree" })}>
                      Back to dashboard
                    </button>
                  </div>
                </div>
              );
            })()
          ) : null}
        </div>
      </div>
    );
  }

  if (view.type === "banks") {
    const selectedBank = prepBanks.find((bank) => bank.id === selectedBankId) ?? null;
    return (
      <div className="lc-shell">
        <LeftRail active="banks" streak={stats.currentStreak} onNavigate={setView} />
        <div className="page page-narrow lc-page lc-shell-body">
          <header className="lc-category-header">
            <div className="lc-category-title-row" style={{ "--lc-accent": "#0ea5e9" } as CSSProperties}>
              <span className="lc-node-icon"><BookOpen size={22} /></span>
              <div>
                <h1>Interview Prep Banks</h1>
                <p className="muted">Named problem sets for a specific interview. The active bank feeds Daily KojoCode.</p>
              </div>
            </div>
          </header>

          <div className="lc-bank-new">
            <input
              value={newBankName}
              onChange={(event) => setNewBankName(event.target.value)}
              placeholder="Bank name, e.g. Meta Onsite"
            />
            <input
              value={newBankTarget}
              onChange={(event) => setNewBankTarget(event.target.value)}
              placeholder="Target (optional), e.g. meta / onsite"
            />
            <button type="button" onClick={() => void handleCreateBank()} disabled={!newBankName.trim() || banksLoading}>
              <Plus size={16} />
              New bank
            </button>
          </div>

          {presetBanks.length > 0 ? (
            <div className="lc-preset-row">
              <span className="lc-preset-label">Or start from a preset</span>
              <div className="lc-preset-chips">
                {presetBanks.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    className="lc-preset-chip"
                    onClick={() => void handleCreateFromPreset(preset)}
                    disabled={banksLoading}
                    title={`Create "${preset.name}" from our catalog`}
                  >
                    <Plus size={13} />
                    <span className="lc-preset-chip-name">{preset.name}</span>
                    <span className="lc-preset-chip-count">{preset.slugs.length}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {prepBanks.length === 0 && !banksLoading ? (
            <div className="lc-empty lc-bank-empty">
              <span className="lc-empty-icon"><BookOpen size={26} /></span>
              <p className="lc-empty-title">No prep banks yet</p>
              <small className="lc-empty-sub">Name one above, or start from a preset to build a scoped problem set.</small>
            </div>
          ) : (
            <div className="lc-bank-gallery">
              {prepBanks.map((bank) => {
                const total = bank.problem_slugs.length;
                const done = bank.problem_slugs.filter((slug) => progress[slug]).length;
                const isSelected = bank.id === selectedBankId;
                return (
                  <article key={bank.id} className={`lc-bank-tile${bank.is_active ? " is-active" : ""}${isSelected ? " is-open" : ""}`}>
                    <button
                      type="button"
                      className="lc-bank-tile-main"
                      onClick={() => setSelectedBankId((current) => (current === bank.id ? null : (bank.id as number)))}
                    >
                      <CompletionRing done={done} total={total} />
                      <span className="lc-bank-tile-copy">
                        <span className="lc-bank-tile-name">{bank.name}</span>
                        {bank.target ? <span className="lc-bank-tile-target">{bank.target}</span> : null}
                        <span className="lc-bank-tile-count">{total} {total === 1 ? "problem" : "problems"}</span>
                      </span>
                      {bank.is_active ? <span className="lc-bank-active-tag">active</span> : null}
                    </button>
                    <div className="lc-bank-tile-actions">
                      {bank.is_active ? (
                        <span className="lc-bank-tile-feeds">feeds your daily KojoCode</span>
                      ) : (
                        <button type="button" onClick={() => void handleActivateBank(bank.id as number)}>
                          Set active
                        </button>
                      )}
                      <button type="button" className="lc-bank-delete" onClick={() => void handleDeleteBank(bank.id as number)} aria-label={`Delete ${bank.name}`}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {selectedBank ? (
            (() => {
              const total = selectedBank.problem_slugs.length;
              const done = selectedBank.problem_slugs.filter((slug) => progress[slug]).length;
              // Show ALL of the bank's topics (not just the top few). Order by
              // bank-scoped struggle when signals exist, else by completion.
              const bankLevelByTopic = new Map(
                bankWeakness.map((topic) => [resolveTopic(topic.topic).id, topic.level]),
              );
              const weakMap = [...bankTopicStats(selectedBank.problem_slugs)].sort((a, b) => {
                const la = bankLevelByTopic.get(a.id) ?? 0;
                const lb = bankLevelByTopic.get(b.id) ?? 0;
                if (la !== lb) return lb - la;
                return a.pct - b.pct;
              });
              return (
                <div className="lc-bank-detail">
                  <div className="lc-bank-detail-head">
                    <div>
                      <h2 className="lc-bank-detail-name">{selectedBank.name}</h2>
                      {selectedBank.target ? <span className="lc-bank-detail-target">{selectedBank.target}</span> : null}
                    </div>
                    <span className="lc-bank-detail-count">{done}/{total} solved</span>
                  </div>

                  {selectedBank.is_active ? (
                    <p className="lc-bank-feeds">
                      <Sparkles size={14} />
                      Today's KojoCode is coming from this bank.
                    </p>
                  ) : (
                    <button type="button" className="lc-bank-feeds-set" onClick={() => void handleActivateBank(selectedBank.id as number)}>
                      Set active to feed your daily from this bank
                    </button>
                  )}

                  {weakMap.length > 0 ? (
                    <div className="lc-bank-weakmap">
                      <span className="lc-bank-weakmap-label">Weak areas in this bank</span>
                      <ul>
                        {weakMap.map((topic) => {
                          const level = bankLevelByTopic.get(topic.id) ?? 0;
                          return (
                            <li key={topic.id}>
                              <span className="lc-bank-weakmap-topic">{topic.label}</span>
                              {level > 0 ? (
                                <span
                                  className="lc-bank-weakmap-level"
                                  style={{ color: weaknessColor(level) }}
                                >
                                  weakness {level}
                                </span>
                              ) : null}
                              <span className="lc-bank-weakmap-count">{topic.done}/{topic.total}</span>
                              <span className="lc-bank-weakmap-bar" aria-hidden="true">
                                <span style={{ width: `${Math.round(topic.pct * 100)}%`, background: masteryColor(topic.pct) }} />
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}

                  {total === 0 ? (
                    <p className="muted">No problems in this bank yet. Paste some titles below.</p>
                  ) : (
                    <ul className="lc-bank-problem-list">
                      {selectedBank.problem_slugs.map((slug) => {
                        const problem = findProblem(slug);
                        const solved = Boolean(progress[slug]);
                        const difficulty = problem?.difficulty ?? "Unknown";
                        return (
                          <li key={slug} className="lc-bank-problem-row">
                            <span className={`lc-bank-problem-check${solved ? " is-done" : ""}`} aria-hidden="true">
                              {solved ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                            </span>
                            <button
                              type="button"
                              className="lc-bank-problem-open"
                              onClick={() => openProblem(findProblemCategory(slug), slug)}
                            >
                              {findProblemTitle(slug)}
                            </button>
                            <span className={`lc-difficulty lc-difficulty--${difficultyClass(difficulty)}`}>{difficulty}</span>
                            {problem?.isOfficial ? (
                              <a className="lc-bank-problem-link" href={`${LEETCODE_BASE_URL}/${slug}/`} target="_blank" rel="noreferrer" title="Open on LeetCode">
                                leetcode
                              </a>
                            ) : null}
                            <button type="button" className="lc-bank-problem-remove" onClick={() => void handleRemoveBankProblem(selectedBank.id as number, slug)} aria-label="Remove from bank">
                              <X size={14} />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  <div className="lc-bank-add">
                    <span className="lc-bank-add-title">Add problems by topic</span>
                    <p className="muted small lc-bank-add-hint">
                      Companies interview by topic. Pick your topics, then continue from our catalog, or have Kojo create a fresh problem. No AI is used unless you tap Create with Kojo.
                    </p>
                    <div className="lc-bank-add-controls">
                      <TopicPicker options={bankTopicOptions} selected={bankAddTopics} onToggle={toggleBankAddTopic} />
                      <label className="lc-bank-add-count">
                        <span>Difficulty</span>
                        <select
                          value={bankAddDifficulty}
                          onChange={(event) => setBankAddDifficulty(event.target.value as "any" | "Easy" | "Medium" | "Hard")}
                        >
                          <option value="any">Any</option>
                          <option value="Easy">Easy</option>
                          <option value="Medium">Medium</option>
                          <option value="Hard">Hard</option>
                        </select>
                      </label>
                      <label className="lc-bank-add-count">
                        <span>Problems</span>
                        <input
                          type="number"
                          min={1}
                          max={50}
                          value={bankAddCount}
                          onChange={(event) => setBankAddCount(Math.max(1, Math.min(50, Number(event.target.value) || 1)))}
                        />
                      </label>
                      <div className="lc-bank-add-actions">
                        <button
                          type="button"
                          className="button button-primary lc-bank-add-btn"
                          onClick={() => void handleAddByTopic(selectedBank.id as number)}
                          disabled={bankAddTopics.size === 0 || bankKojoLoading}
                        >
                          <Plus size={16} />
                          Continue from selection
                        </button>
                        <button
                          type="button"
                          className="button lc-bank-add-btn lc-bank-kojo-btn"
                          onClick={() => void handleCreateWithKojoForBank(selectedBank.id as number)}
                          disabled={bankAddTopics.size === 0 || bankKojoLoading}
                        >
                          <Sparkles size={16} />
                          {bankKojoLoading ? "Creating..." : "Create with Kojo"}
                        </button>
                      </div>
                    </div>
                    {bankAddNote ? <p className="lc-bank-add-note">{bankAddNote}</p> : null}

                    <details className="lc-bank-add-paste">
                      <summary>Or paste specific problem titles</summary>
                      <p className="muted small">One per line or comma-separated. Matched against our catalog, no scraping.</p>
                      <textarea
                        value={bankMatchText}
                        onChange={(event) => setBankMatchText(event.target.value)}
                        placeholder={"Two Sum\nValid Parentheses\n..."}
                        rows={3}
                      />
                      <button
                        type="button"
                        className="lc-bank-match-btn"
                        onClick={() => void handleMatchAndAddToBank(selectedBank.id as number)}
                        disabled={!bankMatchText.trim()}
                      >
                        Match and add
                      </button>
                      {bankMatchUnmatched.length > 0 ? (
                        <p className="lc-daily-error">No catalog match for: {bankMatchUnmatched.join(", ")}</p>
                      ) : null}
                    </details>
                  </div>
                </div>
              );
            })()
          ) : null}
        </div>
      </div>
    );
  }

  if (view.type === "drills") {
    return (
      <div className="lc-shell">
        <LeftRail active="drills" streak={stats.currentStreak} onNavigate={setView} />
        <div className="page page-narrow lc-page lc-shell-body">
          <header className="lc-category-header">
            <div className="lc-category-title-row" style={{ "--lc-accent": "#0ea5e9" } as CSSProperties}>
              <span className="lc-node-icon"><Route size={22} /></span>
              <div>
                <h1>3-Pass Drills</h1>
                <p className="muted">
                  Pass 1 resources allowed, Pass 2 no resources until stuck, Pass 3 no resources and timed.
                </p>
              </div>
            </div>
          </header>

          <div className="lc-bank-new">
            <input
              value={drillAddText}
              onChange={(event) => setDrillAddText(event.target.value)}
              placeholder="Problem title to drill, e.g. Two Sum"
            />
            <button type="button" onClick={() => void handleAddDrillManual()} disabled={!drillAddText.trim()}>
              <Plus size={16} />
              Drill this
            </button>
          </div>

          {drills.length === 0 && !drillsLoading ? (
            <p className="muted">No open drills. Struggling with a problem (a failed grade or a timer running out) adds one automatically.</p>
          ) : (
            (() => {
              const now = Date.now();
              const dueToday = drills
                .filter((drill) => new Date(drill.next_due_at).getTime() <= now)
                .sort((a, b) => a.current_pass - b.current_pass);
              const upcoming = drills
                .filter((drill) => new Date(drill.next_due_at).getTime() > now)
                .sort((a, b) => new Date(a.next_due_at).getTime() - new Date(b.next_due_at).getTime());

              const renderDrill = (drill: LCDrillSchedule, due: boolean) => {
                const dueDate = new Date(drill.next_due_at);
                const passColor = PASS_RAMP[Math.min(drill.current_pass, 3) - 1];
                return (
                  <div key={drill.problem_slug} className={`lc-drill-card${due ? " is-due" : ""}`}>
                    <div className="lc-drill-card-head">
                      <PassRung current={drill.current_pass} />
                      <span className="lc-drill-when">
                        {due ? "due now" : `due ${dueDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="lc-drill-title"
                      onClick={() => openProblem(findProblemCategory(drill.problem_slug), drill.problem_slug)}
                    >
                      {findProblemTitle(drill.problem_slug)}
                    </button>
                    <p className="lc-drill-rule" style={{ color: passColor }}>
                      Pass {drill.current_pass} // {PASS_RULE[Math.min(drill.current_pass, 3) - 1]}
                    </p>
                    <div className="lc-drill-actions">
                      <button
                        type="button"
                        className="lc-drill-open"
                        onClick={() => openProblem(findProblemCategory(drill.problem_slug), drill.problem_slug)}
                      >
                        Open
                        <ArrowRight size={14} />
                      </button>
                      <button
                        type="button"
                        className="lc-drill-advance"
                        onClick={() => void handleAdvanceDrill(drill.problem_slug)}
                        title={drill.current_pass >= 3 ? "Clear this drill for good" : "Mark this pass cleared and schedule the next"}
                      >
                        {drill.current_pass >= 3 ? "Clear drill" : "Pass cleared"}
                      </button>
                    </div>
                  </div>
                );
              };

              return (
                <div className="lc-drill-sections">
                  <section className="lc-drill-section">
                    <h2 className="lc-drill-section-title">
                      Due today
                      <span className="lc-drill-count">{dueToday.length}</span>
                    </h2>
                    {dueToday.length === 0 ? (
                      <p className="muted small">Nothing due. Come back when a drill resurfaces.</p>
                    ) : (
                      <div className="lc-drill-grid">{dueToday.map((drill) => renderDrill(drill, true))}</div>
                    )}
                  </section>
                  {upcoming.length > 0 ? (
                    <section className="lc-drill-section">
                      <h2 className="lc-drill-section-title">
                        Upcoming
                        <span className="lc-drill-count">{upcoming.length}</span>
                      </h2>
                      <div className="lc-drill-grid">{upcoming.map((drill) => renderDrill(drill, false))}</div>
                    </section>
                  ) : null}
                </div>
              );
            })()
          )}
        </div>
      </div>
    );
  }

  if (view.type === "browse") {
    const visibleProblems = filterProblems(browseProblems, progress, filter, query, difficultyFilter, topicFilter);
    const solvedCount = browseProblems.filter((problem) => progress[problem.slug]).length;
    return (
      <div className="lc-shell">
      <LeftRail active="problems" streak={stats.currentStreak} onNavigate={setView} />
      <div className="page page-narrow lc-page lc-shell-body">
        <header className="lc-category-header">
          <button type="button" className="lc-back-btn" onClick={() => setView({ type: "tree" })}>
            <ChevronLeft size={16} />
            Dashboard
          </button>
          <div className="lc-category-title-row" style={{ "--lc-accent": "#16a34a" } as CSSProperties}>
            <span className="lc-node-icon"><Search size={22} /></span>
            <div>
              <h1>Browse all problems</h1>
              <p className="muted">{visibleProblems.length} shown · {solvedCount}/{browseProblems.length} complete</p>
            </div>
          </div>
          <div className="lc-category-tools">
            <div className="lc-search">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search problems" />
            </div>
          </div>
          {renderFilterBar(true)}
        </header>

        {visibleProblems.length === 0 ? (
          renderFilterEmpty(() => clearFilters(true))
        ) : (
          <div className="lc-problem-list">
            {visibleProblems.map((problem) => {
              const solved = Boolean(progress[problem.slug]);
              const topicLabel =
                problem.categoryId === CUSTOM_CATEGORY_ID
                  ? CUSTOM_CATEGORY_LABEL
                  : CATEGORY_META[problem.categoryId]?.label ?? problem.categoryLabel;
              return (
                <div key={`${problem.categoryId}-${problem.slug}`} className={solved ? "lc-problem-row lc-problem-row--done" : "lc-problem-row"}>
                  <button type="button" className="lc-problem-check" onClick={() => toggleProgress(problem)} title={solved ? "Mark incomplete" : "Mark complete"}>
                    {solved ? <CheckCircle2 size={20} className="lc-check-done" /> : <Circle size={20} className="lc-check-empty" />}
                  </button>
                  <button type="button" className="lc-problem-title-btn" onClick={() => openProblem(problem.categoryId, problem.slug)}>
                    <span>{problem.title}</span>
                    <small>{topicLabel}</small>
                  </button>
                  <span className={`lc-difficulty lc-difficulty--${difficultyClass(problem.difficulty)}`}>{problem.difficulty}</span>
                </div>
              );
            })}
          </div>
        )}
        {customModalNode}
        {confirmDeleteNode}
        {difficultyModalNode}
      </div>
      </div>
    );
  }

  if (view.type === "category" && view.categoryId === CUSTOM_CATEGORY_ID) {
    const visibleProblems = filterProblems(customCategoryList, progress, filter, query, difficultyFilter);
    const done = customCategoryList.filter((problem) => progress[problem.slug]).length;
    const visibleArchived = filterProblems(archivedProblemList, progress, filter, query, difficultyFilter);
    return (
      <div className="lc-shell">
      <LeftRail active="problems" streak={stats.currentStreak} onNavigate={setView} />
      <div className="page page-narrow lc-page lc-shell-body">
        <header className="lc-category-header">
          <button type="button" className="lc-back-btn" onClick={() => setView({ type: "tree" })}>
            <ChevronLeft size={16} />
            Dashboard
          </button>
          <div className="lc-category-title-row" style={{ "--lc-accent": "#b45309" } as CSSProperties}>
            <span className="lc-node-icon"><Code size={22} /></span>
            <div>
              <h1>{CUSTOM_CATEGORY_LABEL}</h1>
              <p className="muted">{done}/{customCategoryList.length} complete</p>
            </div>
          </div>
          <div className="lc-category-tools">
            <div className="lc-search">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search problems" />
            </div>
            <button type="button" className="lc-custom-add-btn" onClick={() => openCustomModal()}>
              <Plus size={16} />
              Add question
            </button>
          </div>
          {renderFilterBar(false)}
        </header>

        {customCategoryList.length === 0 ? (
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
        ) : visibleProblems.length === 0 ? (
          renderFilterEmpty(() => clearFilters(false))
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
        {difficultyModalNode}
      </div>
      </div>
    );
  }

  if (view.type === "category") {
    const category = CATEGORIES.find((item) => item.id === view.categoryId) ?? CATEGORIES[0];
    // Built-in catalog problems + any the user added to this category by LeetCode link.
    const categoryProblems = [...category.problems, ...(addedProblemsForCategory.get(category.id) ?? [])];
    const visibleProblems = filterProblems(categoryProblems, progress, filter, query, difficultyFilter);
    const done = categoryProblems.filter((problem) => progress[problem.slug]).length;
    const Icon = category.icon;

    return (
      <div className="lc-shell">
      <LeftRail active="problems" streak={stats.currentStreak} onNavigate={setView} />
      <div className="page page-narrow lc-page lc-shell-body">
        <header className="lc-category-header">
          <button type="button" className="lc-back-btn" onClick={() => setView({ type: "tree" })}>
            <ChevronLeft size={16} />
            Dashboard
          </button>
          <div className="lc-category-title-row" style={{ "--lc-accent": category.accent } as CSSProperties}>
            <span className="lc-node-icon"><Icon size={22} /></span>
            <div>
              <h1>{category.label}</h1>
              <p className="muted">{done}/{categoryProblems.length} complete</p>
            </div>
          </div>
          <div className="lc-category-tools">
            <div className="lc-search">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search problems" />
            </div>
            <button
              type="button"
              className="lc-add-link-btn"
              onClick={() => openAddLink(category.id)}
              title={`Add a problem to ${category.label} by LeetCode link`}
              aria-label="Add a problem by LeetCode link"
            >
              <Plus size={18} />
            </button>
          </div>
          {renderFilterBar(false)}
        </header>

        {visibleProblems.length === 0 ? (
          renderFilterEmpty(() => clearFilters(false))
        ) : (
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
                    {problem.slug.startsWith("custom-") ? (
                      <small>Added</small>
                    ) : !problem.isOfficial ? (
                      <small>Reference drill</small>
                    ) : null}
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
        )}
        {addLinkCategoryId ? (
          <div className="lc-add-link-overlay" role="dialog" aria-modal="true" aria-label="Add a problem by LeetCode link" onClick={closeAddLink}>
            <div className="lc-add-link-modal" onClick={(event) => event.stopPropagation()}>
              <div className="lc-add-link-head">
                <h2>Add a problem</h2>
                <button type="button" className="lc-add-link-close" onClick={closeAddLink} aria-label="Close">
                  <X size={16} />
                </button>
              </div>
              <p className="muted small">Paste a LeetCode problem link. We fetch it once and add it to <strong>{category.label}</strong>, counting toward your totals.</p>
              <input
                className="lc-add-link-input"
                value={addLinkUrl}
                onChange={(event) => { setAddLinkUrl(event.target.value); setAddLinkError(null); }}
                onKeyDown={(event) => { if (event.key === "Enter") void handleAddProblemFromLink(); }}
                placeholder="https://leetcode.com/problems/two-sum/"
                autoFocus
              />
              {addLinkError ? <p className="lc-daily-error">{addLinkError}</p> : null}
              <div className="lc-add-link-actions">
                <button type="button" className="lc-add-link-cancel" onClick={closeAddLink}>Cancel</button>
                <button
                  type="button"
                  className="button button-primary lc-add-link-submit"
                  onClick={() => void handleAddProblemFromLink()}
                  disabled={addLinkLoading || !addLinkUrl.trim()}
                >
                  {addLinkLoading ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}
                  {addLinkLoading ? "Adding..." : "Add problem"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
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
    : [
        ...(CATEGORIES.find((c) => c.id === currentProblem.categoryId)?.problems ?? []),
        ...(addedProblemsForCategory.get(currentProblem.categoryId) ?? []),
      ];
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

  // 3-pass drill enforcement: if this problem has an open drill row, its current pass
  // gates the in-app assists. Pass 1 = unrestricted, Pass 2+ disables Ask Kojo + the
  // solution reveal, Pass 3 also force-starts a timer. Honor system by design (the app
  // controls only its own assists, per todo-kojocode-rebuild 3h). Beta-only, since drills
  // are only loaded for beta users.
  const activeDrill = drills.find((drill) => drill.problem_slug === currentProblem.slug && !drill.completed_at);
  const activePass = activeDrill?.current_pass ?? 1;
  const assistsLocked = betaMode && activePass >= 2;
  const timerForced = betaMode && activePass >= 3;

  return (
    <div className="lc-shell lc-shell--editor">
      {/* key forces a remount when switching hub <-> editor: React would otherwise reuse
          the hub rail's instance (same type + position), carrying its expanded state over
          and persisting it under the editor's storage key before the initializer ran. */}
      <LeftRail
        key="editor-rail"
        active=""
        streak={stats.currentStreak}
        onNavigate={setView}
        storageKey={EDITOR_RAIL_COLLAPSE_KEY}
        defaultCollapsed
      />
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
          <div className="lc-toolbar-cluster" aria-label="Reference links">
            {!isStreakChallengeProblem ? (
              <a className="lc-toolbar-btn" href={`https://www.youtube.com/results?search_query=neetcode+${encodeURIComponent(currentProblem.title)}`} target="_blank" rel="noreferrer" aria-label="Search NeetCode on YouTube">
                <Youtube size={16} />
                <span className="lc-tb-label">NeetCode</span>
              </a>
            ) : null}
            <a className="lc-toolbar-btn" href={currentProblem.url} target="_blank" rel="noreferrer" aria-label="Open on LeetCode">
              <ExternalLink size={16} />
              <span className="lc-tb-label">Open</span>
            </a>
          </div>

          <div className="lc-toolbar-cluster" data-cluster="run" aria-label="Run and submit">
            <span className="lc-toolbar-cluster-label">Run / Submit</span>
            <button type="button" className="lc-toolbar-btn" onClick={handleFormat} aria-label="Format code">
              <WrapText size={16} />
              <span className="lc-tb-label">Format</span>
            </button>
            <button type="button" className="lc-toolbar-btn" onClick={handleRunCode} disabled={!runnable || runnerLoading} aria-label="Run code">
              {runnerLoading ? <Loader2 size={16} className="spin" /> : <Play size={16} />}
              <span className="lc-tb-label">Run code</span>
            </button>
            <button type="button" className={progress[currentProblem.slug] ? "lc-toolbar-btn lc-toolbar-btn--done" : "lc-toolbar-btn"} onClick={() => toggleProgress(currentProblem)} aria-label={progress[currentProblem.slug] ? "Mark incomplete" : "Mark done"}>
              {progress[currentProblem.slug] ? <CheckCircle2 size={16} /> : <Circle size={16} />}
              <span className="lc-tb-label">{progress[currentProblem.slug] ? "Done" : "Mark done"}</span>
            </button>
          </div>

          <div className="lc-toolbar-cluster" data-cluster="timer" aria-label="Timer">
            <span className="lc-toolbar-cluster-label">Timer</span>
            <button
              type="button"
              className={`lc-toolbar-btn lc-toolbar-btn--timer lc-toolbar-btn--timer-${timerTone}`}
              onClick={openTimerPicker}
              aria-label={timerRemainingSeconds == null ? "Set timer" : `${timerButtonLabel} remaining, click to change timer`}
              title={timerRemainingSeconds == null ? "Set a problem timer" : `${timerButtonLabel} remaining — change timer`}
            >
              <TimerRing fraction={timerFraction ?? 1} tone={timerTone} size={18} stroke={2} />
              <span className="lc-tb-label lc-tb-label--timer">{timerButtonLabel}</span>
            </button>
          </div>

          <div className="lc-toolbar-cluster" data-cluster="notes" aria-label="Notes">
            <span className="lc-toolbar-cluster-label">Notes</span>
            <button type="button" className="lc-toolbar-btn" onClick={() => openNotes(currentProblem.slug)} aria-label="Open notes">
              <Notebook size={16} />
              <span className="lc-tb-label">Notes</span>
            </button>
          </div>

          {!isStreakChallengeProblem ? (
            <div className="lc-toolbar-cluster" data-cluster="kojo" aria-label="Ask Kojo">
              <span className="lc-toolbar-cluster-label">Ask Kojo</span>
              <button
                type="button"
                className="lc-toolbar-btn lc-toolbar-btn--kojo"
                onClick={() => setKojoOpen(true)}
                disabled={assistsLocked}
                aria-label="Ask Kojo for a hint"
                title={assistsLocked ? `Locked on Pass ${activePass}: no resources` : "Ask Kojo for a hint"}
              >
                <Sparkles size={16} />
                <span className="lc-tb-label">Ask Kojo</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {activeDrill ? (
        <div className={`lc-pass-banner lc-pass-banner--p${activePass}`} style={{ "--pass-color": PASS_RAMP[Math.min(activePass, 3) - 1] } as CSSProperties}>
          <PassRung current={activePass} />
          <span className="lc-pass-banner-rule">Pass {activePass} // {PASS_RULE[Math.min(activePass, 3) - 1]}</span>
          <button
            type="button"
            className="lc-pass-banner-clear"
            onClick={() => void handleAdvanceDrill(currentProblem.slug)}
            title={activePass >= 3 ? "Clear this drill for good" : "Mark this pass cleared and schedule the next"}
          >
            {activePass >= 3 ? "Clear drill" : "Pass cleared"}
          </button>
        </div>
      ) : null}

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

          {isStreakChallengeProblem ? (
            <div className="lc-streak-challenge-banner">
              <ShieldAlert size={15} />
              <span><strong>Save My Streak challenge.</strong> Kojo and NeetCode are disabled. Solve this on your own to restore your streak.</span>
            </div>
          ) : null}

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
              <LoadingNotice
                compact
                title="Kojo is grading your submission"
                estimate="Reading your solution and checking the approach. About 15 seconds."
                slowNote="Still reading. A long solution takes Kojo longer to work through."
                slowAfterMs={18000}
              />
            ) : null}

            {gradeFeedback && !gradeLoading ? (
              <div className="lc-grade-feedback">
                <div className="lc-grade-feedback-header">
                  <KojoMascot state="idle" />
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

          {!isCustomProblem && !isStreakChallengeProblem ? (
            <div className="lc-solution-panel">
              <button
                type="button"
                className="lc-solution-toggle"
                onClick={() => {
                  if (!hasAttempted || assistsLocked) return;
                  const opening = !solutionOpen;
                  setSolutionOpen(opening);
                  // Opening the solution means "I couldn't solve this": log it as a
                  // weakness signal, once per problem.
                  if (
                    opening &&
                    betaMode &&
                    !isGuestSession() &&
                    !solutionViewedLoggedRef.current.has(currentProblem.slug)
                  ) {
                    solutionViewedLoggedRef.current.add(currentProblem.slug);
                    void logLCStruggleEvent(
                      resolveProblemTopic(currentProblem.slug),
                      "solution_viewed",
                      currentProblem.slug,
                    );
                  }
                }}
                disabled={!hasAttempted || assistsLocked}
                title={
                  assistsLocked
                    ? `Locked on Pass ${activePass}: no solution reveal`
                    : hasAttempted
                      ? "Toggle NeetCode solution"
                      : "Attempt the problem to unlock"
                }
              >
                <Youtube size={15} />
                <span>NeetCode solution</span>
                {assistsLocked ? (
                  <small className="lc-solution-locked">Locked on Pass {activePass}</small>
                ) : !hasAttempted ? (
                  <small className="lc-solution-locked">Attempt first to unlock</small>
                ) : (
                  <ChevronDown size={14} className={solutionOpen ? "lc-solution-chevron lc-solution-chevron--open" : "lc-solution-chevron"} />
                )}
              </button>
              {solutionOpen && hasAttempted && !assistsLocked ? (
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
              // Give each (problem, tab) its own Monaco model via `path`, and seed
              // it with `defaultValue` instead of driving `value`. A controlled
              // `value` prop makes @monaco-editor/react replace the whole document
              // whenever the prop lags Monaco's live buffer by even one keystroke,
              // which snaps the caret to the end of the file when typing fast.
              // Uncontrolled-per-tab keeps the caret put; state still syncs via onChange.
              path={`${currentProblem?.slug ?? "none"}:${currentCodeTab?.id ?? "none"}`}
              defaultValue={currentCode}
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
                fontFamily: "Menlo, Consolas, 'Cascadia Mono', 'DejaVu Sans Mono', 'Courier New', monospace",
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

      {kojoOpen && currentProblem ? (
        <KojoHelpChat
          storageKey={`lc:${currentProblem.slug}`}
          subtitle={currentProblem.title}
          onClose={() => setKojoOpen(false)}
          buildContext={buildLeetCodeKojoContext}
          customInstruction="Give hints, debugging direction, edge cases, and complexity guidance. Never give the full solution code."
          provider={generationProvider}
          initialDraft={`I'm stuck on ${currentProblem.title}. Give me one hint without solving it for me.`}
          contractNote="Kojo can help with hints, debugging direction, edge cases, and complexity. It will not give you the full solution code here."
          slashCommands={allKojoCommands}
          disabled={assistsLocked}
          disabledNote={assistsLocked ? `Locked on Pass ${activePass}: no assists` : undefined}
          emptyTitle="Stuck on this one?"
          emptySub="Ask for a hint, a debugging nudge, or talk through your approach."
          suggestions={["Give me one hint", "What edge cases am I missing?", "Help me debug my current code"]}
        />
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
          <div className="lc-kojo-backdrop lc-timer-backdrop" />
          <div className="lc-kojo-modal lc-timer-modal" role="dialog" aria-modal="true" aria-labelledby="timer-modal-title">
            <div className="lc-kojo-modal-header lc-timer-modal-header">
              <div className="kojo-avatar lc-timer-avatar"><TimerRing fraction={1} tone="idle" size={18} stroke={2} /></div>
              <span id="timer-modal-title">Set a timer</span>
              <button type="button" className="lc-kojo-close" onClick={closeTimerPicker} aria-label="Close timer modal">
                <X size={17} />
              </button>
            </div>

            <div className="lc-kojo-contract lc-timer-modal-body">
              <p className="lc-timer-modal-copy">Choose a common interview duration, or enter exactly how much time you have.</p>
              <label className="lc-timer-modal-field">
                <span>Preset</span>
                <select
                  value={TIMER_PRESETS.includes(Number(timerMinutesInput)) ? timerMinutesInput : "custom"}
                  onChange={(event) => {
                    setTimerMinutesInput(event.target.value === "custom" ? "" : event.target.value);
                  }}
                >
                  {TIMER_PRESETS.map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
                  <option value="custom">Custom duration</option>
                </select>
              </label>
              <label className="lc-timer-modal-input">
                <span>Custom duration</span>
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
                  aria-label="Custom minutes"
                />
                <span className="lc-timer-modal-unit">min</span>
              </label>
            </div>

            <div className="lc-timeout-actions lc-timer-modal-actions">
              <button type="button" className="button lc-timeout-action lc-timeout-action--ghost" onClick={closeTimerPicker}>
                Cancel
              </button>
              <button type="button" className="button button--primary lc-timeout-action" onClick={applyTimerFromInput}>
                Set timer
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
      {difficultyModalNode}
      </div>
    </div>
  );
}
