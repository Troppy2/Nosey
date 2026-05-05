import Editor, { type Monaco } from "@monaco-editor/react";
import {
  AlertCircle,
  Binary,
  BookOpen,
  Bot,
  Braces,
  Calculator,
  CheckCircle2,
  ChevronLeft,
  Circle,
  Code2,
  ExternalLink,
  Flame,
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
  WrapText,
  X,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MarkdownContent } from "../components/MarkdownContent";
import { SlashCommandMenu, type SlashCommand } from "../components/SlashCommandMenu";
import { fetchLeetCodeHint, fetchLeetCodeProblem } from "../lib/api";
import { runPythonLeetCode, type RunnerResult } from "../lib/pyodideRunner";
import type { LeetCodeProblemData } from "../lib/types";
import { useSettings } from "../lib/useSettings";

type Difficulty = "Easy" | "Medium" | "Hard" | "Reference";
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

const PROGRESS_KEY = "nosey_lc_progress";
const ACTIVITY_KEY = "nosey_lc_activity_dates";
const LEETCODE_BASE_URL = "https://leetcode.com/problems";
const CUSTOM_TEST_LIMIT = 2;

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
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
}

function saveActivityDates(dates: string[]) {
  localStorage.setItem(ACTIVITY_KEY, JSON.stringify(dates));
}

function getCodeKey(problemSlug: string) {
  return `nosey_lc_code_${problemSlug}`;
}

function loadSavedCode(problemSlug: string) {
  return localStorage.getItem(getCodeKey(problemSlug)) ?? "";
}

function saveCode(problemSlug: string, value: string) {
  localStorage.setItem(getCodeKey(problemSlug), value);
}

function todayKey() {
  return new Date().toLocaleDateString("en-CA");
}

function countStreak(dates: string[]) {
  const dateSet = new Set(dates);
  let count = 0;
  const cursor = new Date();
  while (dateSet.has(cursor.toLocaleDateString("en-CA"))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
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

function sanitizeLeetCodeHtml(html: string) {
  if (typeof window === "undefined") return html;
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const allowed = new Set(["p", "pre", "code", "strong", "em", "ul", "ol", "li", "sup", "sub"]);

  const clean = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      const tag = element.tagName.toLowerCase();
      if (!allowed.has(tag)) {
        const fragment = document.createDocumentFragment();
        while (element.firstChild) fragment.appendChild(element.firstChild);
        element.replaceWith(fragment);
        return;
      }
      Array.from(element.attributes).forEach((attribute) => element.removeAttribute(attribute.name));
    }
    Array.from(node.childNodes).forEach(clean);
  };

  Array.from(doc.body.childNodes).forEach(clean);
  return doc.body.innerHTML;
}

function isRunnable(problemData?: LeetCodeProblemData) {
  const snippet = problemData?.python_snippet ?? "";
  return snippet.includes("class Solution") && problemData?.examples.length;
}

export default function LeetCodeMode() {
  const { generationProvider, isBetaEnabled } = useSettings();
  const [view, setView] = useState<View>({ type: "tree" });
  const [progress, setProgress] = useState<Record<string, boolean>>(() => loadJson(PROGRESS_KEY, {}));
  const [activityDates, setActivityDates] = useState<string[]>(() => loadJson(ACTIVITY_KEY, []));
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [code, setCode] = useState("");
  const [problemStates, setProblemStates] = useState<Record<string, CachedProblemState>>({});
  const [customCases, setCustomCases] = useState<Record<string, CustomCase[]>>({});
  const [runnerLoading, setRunnerLoading] = useState(false);
  const [runnerResult, setRunnerResult] = useState<RunnerResult | null>(null);
  const [kojoOpen, setKojoOpen] = useState(false);
  const [kojoInput, setKojoInput] = useState("");
  const [kojoResponse, setKojoResponse] = useState<string | null>(null);
  const [kojoLoading, setKojoLoading] = useState(false);
  const [kojoError, setKojoError] = useState<string | null>(null);
  const editorRef = useRef<any>(null);

  const currentProblem =
    view.type === "problem"
      ? CATEGORIES.find((category) => category.id === view.categoryId)?.problems.find((problem) => problem.slug === view.problemSlug) ?? null
      : null;

  const currentProblemState = currentProblem ? problemStates[currentProblem.slug] : undefined;
  const currentProblemData = currentProblemState?.data;
  const currentCustomCases = currentProblem ? customCases[currentProblem.slug] ?? [] : [];
  const kojoShowsCommands = kojoOpen && kojoInput.trimStart().startsWith("/");

  useEffect(() => {
    if (!currentProblem || !currentProblem.isOfficial) return;
    if (problemStates[currentProblem.slug]?.data || problemStates[currentProblem.slug]?.loading) return;

    setProblemStates((prev) => ({ ...prev, [currentProblem.slug]: { loading: true } }));
    fetchLeetCodeProblem(currentProblem.slug)
      .then((data) => {
        setProblemStates((prev) => ({ ...prev, [currentProblem.slug]: { loading: false, data } }));
        const savedCode = loadSavedCode(currentProblem.slug);
        if (!savedCode.trim()) {
          const starter = data.python_snippet?.trimEnd() ?? "";
          setCode(starter);
          saveCode(currentProblem.slug, starter);
        } else {
          setCode(savedCode);
        }
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

  function recordSolvedToday() {
    const nextDates = [...activityDates, todayKey()];
    setActivityDates(nextDates);
    saveActivityDates(nextDates);
  }

  function toggleProgress(problem: Problem) {
    const nextDone = !progress[problem.slug];
    const next = { ...progress, [problem.slug]: nextDone };
    setProgress(next);
    saveProgress(next);
    if (nextDone) recordSolvedToday();
  }

  function openProblem(categoryId: string, problemSlug: string) {
    const savedCode = loadSavedCode(problemSlug);
    const cached = problemStates[problemSlug]?.data;
    if (savedCode.trim()) {
      setCode(savedCode);
    } else if (cached?.python_snippet?.trim()) {
      const starter = cached.python_snippet.trimEnd();
      setCode(starter);
      saveCode(problemSlug, starter);
    } else {
      setCode("");
    }
    setView({ type: "problem", categoryId, problemSlug });
    setKojoOpen(false);
    setRunnerResult(null);
    setKojoResponse(null);
    setKojoError(null);
  }

  function handleCodeChange(value: string) {
    setCode(value);
    if (currentProblem) saveCode(currentProblem.slug, value);
  }

  function handleFormat() {
    editorRef.current?.getAction("editor.action.formatDocument")?.run();
  }

  function handleMonacoMount(editor: any, _monaco: Monaco) {
    editorRef.current = editor;
  }

  function openKojo(problem: Problem) {
    setKojoOpen(true);
    setKojoResponse(null);
    setKojoError(null);
    setKojoInput(`I'm stuck on ${problem.title}. Give me one hint without solving it for me.`);
  }

  function selectKojoCommand(command: SlashCommand) {
    setKojoInput(command.prompt);
  }

  async function handleKojoSend() {
    if (!currentProblem || !kojoInput.trim() || kojoLoading) return;
    setKojoLoading(true);
    setKojoError(null);
    setKojoResponse(null);
    try {
      const result = await fetchLeetCodeHint(
        currentProblem.slug,
        currentProblem.title,
        kojoInput,
        code,
        generationProvider,
        isBetaEnabled,
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

  async function handleRunCode() {
    if (!currentProblemData || !isRunnable(currentProblemData)) return;
    const officialCases = currentProblemData.examples.map((example) => ({
      label: `Official ${example.index}`,
      inputText: example.input_text,
      expectedOutput: example.output_text,
    }));
    const validCustomCases = currentCustomCases.filter((item) => item.inputText.trim() && item.expectedOutput.trim()).map((item, index) => ({
      label: `Custom ${index + 1}`,
      inputText: item.inputText.trim(),
      expectedOutput: item.expectedOutput.trim(),
    }));

    setRunnerLoading(true);
    setRunnerResult(null);
    try {
      const result = await runPythonLeetCode(code, [...officialCases, ...validCustomCases]);
      setRunnerResult(result);
    } finally {
      setRunnerLoading(false);
    }
  }

  if (view.type === "tree") {
    return (
      <div className="page lc-page">
        <header className="lc-hero">
          <div>
            <span className="eyebrow">Beta</span>
            <h1>LeetCode roadmap</h1>
            <p className="muted">Official problems, a better practice surface, streaks, and Kojo as a coach instead of a code dump.</p>
          </div>
          <a className="lc-official-link" href="https://leetcode.com/problemset/" target="_blank" rel="noreferrer">
            <ExternalLink size={16} />
            Open LeetCode
          </a>
        </header>

        <section className="lc-dashboard" aria-label="LeetCode progress dashboard">
          <div className="lc-dashboard-main">
            <span className="lc-stat-label">Total solved</span>
            <strong>{stats.solved}/{stats.total}</strong>
            <div className="lc-master-bar" aria-hidden="true">
              <span style={{ width: `${stats.percent}%` }} />
            </div>
          </div>
          <div className="lc-stat-tile">
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

  const problemLoading = currentProblem.isOfficial && currentProblemState?.loading;
  const problemError = currentProblemState?.error;
  const runnable = isRunnable(currentProblemData);
  const officialExamples = currentProblemData?.examples ?? [];
  return (
    <div className="lc-editor-shell">
      <div className="lc-editor-topbar">
        <button type="button" className="lc-back-btn" onClick={() => setView({ type: "category", categoryId: currentProblem.categoryId })}>
          <ChevronLeft size={16} />
          {currentProblem.categoryLabel}
        </button>
        <div className="lc-editor-title">
          <span>{currentProblem.title}</span>
          <span className={`lc-difficulty lc-difficulty--${difficultyClass(currentProblem.difficulty)}`}>{currentProblem.difficulty}</span>
        </div>
        <div className="lc-editor-actions">
          <a className="lc-toolbar-btn" href={currentProblem.url} target="_blank" rel="noreferrer">
            <ExternalLink size={16} />
            Open
          </a>
          <button type="button" className="lc-toolbar-btn" onClick={handleFormat}>
            <WrapText size={16} />
            Format
          </button>
          <button type="button" className="lc-toolbar-btn" onClick={handleRunCode} disabled={!runnable || runnerLoading}>
            {runnerLoading ? <Loader2 size={16} className="spin" /> : <Play size={16} />}
            Run code
          </button>
          <button type="button" className="lc-toolbar-btn lc-toolbar-btn--kojo" onClick={() => openKojo(currentProblem)}>
            <Sparkles size={16} />
            Ask Kojo
          </button>
          <button type="button" className={progress[currentProblem.slug] ? "lc-toolbar-btn lc-toolbar-btn--done" : "lc-toolbar-btn"} onClick={() => toggleProgress(currentProblem)}>
            {progress[currentProblem.slug] ? <CheckCircle2 size={16} /> : <Circle size={16} />}
            {progress[currentProblem.slug] ? "Done" : "Mark done"}
          </button>
        </div>
      </div>

      <div className="lc-editor-body">
        <aside className="lc-problem-pane">
          <div className="lc-problem-source">
            <span>{currentProblem.isOfficial ? "Official LeetCode statement" : "Reference-only topic"}</span>
            <a href={currentProblem.url} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Source</a>
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

          {!currentProblem.isOfficial ? (
            <div className="lc-source-note">
              <p>This item is kept as a reference drill because it is not an official LeetCode problem title. The editor and Kojo coach still work here, but there is no official statement to render.</p>
            </div>
          ) : null}

          {currentProblemData ? (
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
            <p className="muted small">You can add up to 2 custom cases on top of the official LeetCode examples.</p>

            <div className="lc-test-list">
              {officialExamples.map((example) => (
                <div key={example.index} className="lc-test-card">
                  <div className="lc-test-card-top">
                    <strong>Official {example.index}</strong>
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
                    <button type="button" className="lc-inline-icon-btn" onClick={() => removeCustomCase(testCase.id)} aria-label="Remove custom test case">
                      <X size={14} />
                    </button>
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
          </div>
        </aside>

        <div className="lc-editor-pane">
          <Editor
            height="100%"
            defaultLanguage="python"
            value={code}
            onChange={(value) => handleCodeChange(value ?? "")}
            onMount={handleMonacoMount}
            theme="vs-dark"
            options={{
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
              <textarea
                className="lc-kojo-input"
                rows={5}
                value={kojoInput}
                onChange={(event) => setKojoInput(event.target.value)}
                placeholder="Ask for a hint or type / for commands"
                disabled={kojoLoading}
              />
              {kojoShowsCommands ? (
                <SlashCommandMenu commands={CHAT_COMMANDS} query={kojoInput.trimStart()} onSelect={selectKojoCommand} />
              ) : null}
            </div>

            {kojoResponse ? <div className="lc-kojo-response"><MarkdownContent content={kojoResponse} /></div> : null}
            {kojoError ? <div className="kojo-error"><AlertCircle size={14} /><span>{kojoError}</span></div> : null}

            <div className="lc-kojo-modal-footer">
              {kojoLoading ? (
                <div className="kojo-thinking"><span /><span /><span /></div>
              ) : (
                <button type="button" className="button button--primary lc-kojo-send" onClick={handleKojoSend} disabled={!kojoInput.trim()}>
                  <Send size={15} />
                  {kojoResponse ? "Ask again" : "Ask Kojo"}
                </button>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
