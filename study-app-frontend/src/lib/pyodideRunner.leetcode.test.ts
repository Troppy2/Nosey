import { beforeAll, describe, expect, it } from "vitest";

import { runPythonLeetCode } from "./pyodideRunner";

/**
 * Integration tests of the KojoCode Python runner, one per kind of problem that used
 * to fail correct solutions: in-place answers, "k, nums = [...]" outputs, design
 * classes, any-order answers, floats, cycles, node references and Node graphs.
 * Boots a real Python runtime, so it is opt-in: `npm run test:pyodide`.
 */
const ENABLED = Boolean(
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.SD_PYODIDE_TESTS,
);

const run = (code: string, cases: [string, string][], anyOrder = false) =>
  runPythonLeetCode(
    code,
    cases.map(([inputText, expectedOutput], i) => ({ label: `Official ${i + 1}`, inputText, expectedOutput })),
    { anyOrder },
  );

describe.skipIf(!ENABLED)("runPythonLeetCode with a real Python runtime", () => {
  beforeAll(async () => {
    const packageName = "pyodide";
    const pyodideModule = await import(/* @vite-ignore */ packageName);
    const pyodide = await pyodideModule.loadPyodide();
    (window as unknown as { __noseyPyodide: Promise<unknown> }).__noseyPyodide = Promise.resolve(pyodide);
  });

  it("checks the first argument when the answer is written in place", async () => {
    const result = await run(
      `class Solution:
    def moveZeroes(self, nums: List[int]) -> None:
        w = 0
        for x in nums:
            if x: nums[w] = x; w += 1
        for i in range(w, len(nums)): nums[i] = 0`,
      [["nums = [0,1,0,3,12]", "[1,3,12,0,0]"]],
    );
    expect(result.ok).toBe(true);
  });

  it("checks the count and the first k slots for 'k, nums = [...]' outputs", async () => {
    const code = `class Solution:
    def removeElement(self, nums: List[int], val: int) -> int:
        k = 0
        for x in nums:
            if x != val: nums[k] = x; k += 1
        return k`;
    expect((await run(code, [["nums = [3,2,2,3], val = 3", "2, nums = [2,2,_,_]"]])).ok).toBe(true);
    const wrong = await run(code.replace("return k", "return k + 1"), [["nums = [3,2,2,3], val = 3", "2, nums = [2,2,_,_]"]]);
    expect(wrong.ok).toBe(false);
  });

  it("runs design classes operation by operation", async () => {
    const result = await run(
      `class MinStack:
    def __init__(self):
        self.s = []
    def push(self, val: int) -> None:
        self.s.append((val, min(val, self.s[-1][1]) if self.s else val))
    def pop(self) -> None:
        self.s.pop()
    def top(self) -> int:
        return self.s[-1][0]
    def getMin(self) -> int:
        return self.s[-1][1]`,
      [['["MinStack","push","push","push","getMin","pop","top","getMin"]\n[[],[-2],[0],[-3],[],[],[],[]]', "[null,null,null,null,-3,null,0,-2]"]],
    );
    expect(result.ok).toBe(true);
  });

  it("accepts any order only when the statement allows it", async () => {
    const code = `class Solution:
    def subsets(self, nums: List[int]) -> List[List[int]]:
        out = [[]]
        for x in nums: out += [s + [x] for s in out]
        return out[::-1]`;
    const cases: [string, string][] = [["nums = [1,2]", "[[],[1],[2],[1,2]]"]];
    expect((await run(code, cases, true)).ok).toBe(true);
    expect((await run(code, cases, false)).ok).toBe(false);
  });

  it("compares floats within 1e-5", async () => {
    const result = await run(
      `class Solution:
    def findMaxAverage(self, nums: List[int], k: int) -> float:
        return sum(nums[:k]) / k + 1e-7`,
      [["nums = [5], k = 1", "5.00000"]],
    );
    expect(result.ok).toBe(true);
  });

  it("builds a cycle from pos and finds nodes named by value", async () => {
    const cycle = await run(
      `class Solution:
    def hasCycle(self, head: Optional[ListNode]) -> bool:
        slow = fast = head
        while fast and fast.next:
            slow = slow.next; fast = fast.next.next
            if slow is fast: return True
        return False`,
      [["head = [3,2,0,-4], pos = 1", "true"], ["head = [1], pos = -1", "false"]],
    );
    expect(cycle.ok).toBe(true);
    const lca = await run(
      `class Solution:
    def lowestCommonAncestor(self, root: 'TreeNode', p: 'TreeNode', q: 'TreeNode') -> 'TreeNode':
        while root:
            if p.val < root.val and q.val < root.val: root = root.left
            elif p.val > root.val and q.val > root.val: root = root.right
            else: return root`,
      [["root = [6,2,8,0,4,7,9,null,null,3,5], p = 2, q = 8", "6"]],
    );
    expect(lca.ok).toBe(true);
  });

  it("builds Node graphs for clone-graph", async () => {
    const result = await run(
      `class Solution:
    def cloneGraph(self, node: Optional['Node']) -> Optional['Node']:
        if not node: return None
        m = {}
        def go(n):
            if n in m: return m[n]
            c = Node(n.val); m[n] = c
            c.neighbors = [go(x) for x in n.neighbors]
            return c
        return go(node)`,
      [["adjList = [[2,4],[1,3],[2,4],[1,3]]", "[[2,4],[1,3],[2,4],[1,3]]"]],
    );
    expect(result.ok).toBe(true);
  });

  it("runs the method the tests call, not a helper defined first", async () => {
    const result = await run(
      `class Solution:
    def helper(self, x):
        return x * 2
    def twoSum(self, nums: List[int], target: int) -> List[int]:
        seen = {}
        for i, x in enumerate(nums):
            if target - x in seen: return [seen[target - x], i]
            seen[x] = i`,
      [["nums = [2,7,11,15], target = 9", "[0,1]"]],
    );
    expect(result.ok).toBe(true);
  });
});
