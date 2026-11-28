import {
  SD_WORK_DIR,
  buildHarnessFiles,
  computeOk,
  normalizeSimEvents,
  parseTestResults,
} from "./sdHarness";
import type { SimEvent, TestCaseResult } from "./sdHarness";

export type SerializedValue =
  | { type: 'none' }
  | { type: 'bool'; value: boolean }
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'list'; value: SerializedValue[]; length: number }
  | { type: 'tuple'; value: SerializedValue[]; length: number }
  | { type: 'set'; value: SerializedValue[]; length: number }
  | { type: 'dict'; value: Record<string, SerializedValue>; length: number }
  | { type: 'other'; repr: string };

export type TraceStep = {
  line: number;
  locals: Record<string, SerializedValue>;
  method: string;
};

export type TraceResult = {
  steps: TraceStep[];
  result: string | null;
  error: string | null;
};

type TestCase = {
  label: string;
  inputText: string;
  expectedOutput: string;
};

export type RunnerResult = {
  ok: boolean;
  output: string;
  error?: string;
  /** A check before running (no code yet), not a failure of the user's code. */
  notice?: boolean;
  /** Time spent running the test cases in the browser runner, in milliseconds. */
  runtime_ms?: number;
  cases?: Array<{
    label: string;
    passed: boolean;
    actual: string;
    expected: string;
    /** The case's input, filled in by the editor for display. */
    input?: string;
  }>;
};

declare global {
  interface Window {
    loadPyodide?: (opts: { indexURL: string }) => Promise<{
      runPythonAsync: (code: string) => Promise<unknown>;
    }>;
    __noseyPyodide?: Promise<{
      runPythonAsync: (code: string) => Promise<unknown>;
    }>;
  }
}

const PYODIDE_SCRIPT_URL = "https://cdn.jsdelivr.net/pyodide/v0.27.5/full/pyodide.js";
const PYODIDE_INDEX_URL = "https://cdn.jsdelivr.net/pyodide/v0.27.5/full/";

async function loadPyodideInstance() {
  if (window.__noseyPyodide) return window.__noseyPyodide;

  window.__noseyPyodide = new Promise((resolve, reject) => {
    if (window.loadPyodide) {
      window.loadPyodide({ indexURL: PYODIDE_INDEX_URL }).then(resolve).catch(reject);
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>('script[data-pyodide="true"]');
    if (existing) {
      existing.addEventListener("load", () => {
        window.loadPyodide?.({ indexURL: PYODIDE_INDEX_URL }).then(resolve).catch(reject);
      });
      existing.addEventListener("error", () => reject(new Error("Failed to load the Python runner.")));
      return;
    }

    const script = document.createElement("script");
    script.src = PYODIDE_SCRIPT_URL;
    script.async = true;
    script.dataset.pyodide = "true";
    script.onload = () => {
      window.loadPyodide?.({ indexURL: PYODIDE_INDEX_URL }).then(resolve).catch(reject);
    };
    script.onerror = () => reject(new Error("Failed to load the Python runner."));
    document.head.appendChild(script);
  });

  return window.__noseyPyodide;
}

// One interpreter is shared, so overlapping runs (a user Run while hidden tests are
// being prepared) would clobber each other's globals. Calls queue up instead.
let leetCodeQueue: Promise<unknown> = Promise.resolve();

export type RunnerOptions = {
  /** The statement says the answer may come back in any order: compare lists as multisets. */
  anyOrder?: boolean;
};

/** True when a LeetCode statement lets the answer come back in any order. */
export function statementAllowsAnyOrder(statementHtml: string | null | undefined): boolean {
  if (!statementHtml) return false;
  // Tags become spaces ("in <strong>any order</strong>"), so collapse runs of whitespace.
  const text = statementHtml.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").toLowerCase();
  return /\bin any order\b/.test(text);
}

export function runPythonLeetCode(code: string, testCases: TestCase[], options: RunnerOptions = {}): Promise<RunnerResult> {
  const next = leetCodeQueue.then(() => runPythonLeetCodeNow(code, testCases, options));
  leetCodeQueue = next.catch(() => undefined);
  return next;
}

async function runPythonLeetCodeNow(code: string, testCases: TestCase[], options: RunnerOptions): Promise<RunnerResult> {
  const pyodide = await loadPyodideInstance();
  const payload = JSON.stringify(testCases);
  const anyOrder = options.anyOrder ? "True" : "False";
  const runner = `
from typing import *
import ast
import inspect
import json
import sys as _sys
import time as _time
import traceback
from collections import deque

class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

def build_list_node(values):
    dummy = ListNode()
    cur = dummy
    for value in values:
        cur.next = ListNode(value)
        cur = cur.next
    return dummy.next

def build_tree(values):
    if not values:
        return None
    items = list(values)
    if items[0] is None:
        return None
    root = TreeNode(items[0])
    queue = deque([root])
    idx = 1
    while queue and idx < len(items):
        node = queue.popleft()
        if idx < len(items):
            left = items[idx]
            idx += 1
            if left is not None:
                node.left = TreeNode(left)
                queue.append(node.left)
        if idx < len(items):
            right = items[idx]
            idx += 1
            if right is not None:
                node.right = TreeNode(right)
                queue.append(node.right)
    return root

_MAX_NODES = 100000

def listnode_to_list(node):
    out = []
    while node is not None:
        if len(out) >= _MAX_NODES:
            raise ValueError("The returned linked list has a cycle or is too long to compare.")
        out.append(node.val)
        node = node.next
    return out

# Duck-typed so a ListNode/TreeNode class the user pasted in (LeetCode's own
# starter does this) serializes the same as the built-in ones.
def _is_tree_node(value):
    return hasattr(value, "val") and hasattr(value, "left") and hasattr(value, "right")

def _is_list_node(value):
    return hasattr(value, "val") and hasattr(value, "next")

def tree_to_list(root):
    if root is None:
        return []
    out = []
    queue = deque([root])
    while queue:
        node = queue.popleft()
        if node is None:
            out.append(None)
            continue
        out.append(node.val)
        queue.append(node.left)
        queue.append(node.right)
    while out and out[-1] is None:
        out.pop()
    return out

_JSON_NAME_CONSTS = {"null": None, "true": True, "false": False}

class _JsonLiteralNames(ast.NodeTransformer):
    # Test-case inputs follow the LeetCode/JSON convention (null/true/false),
    # which ast.literal_eval rejects because they parse as Name nodes rather
    # than constants. Rewrite those names to their Python constants so tree and
    # graph inputs like [3,9,20,null,null,15,7] evaluate instead of blowing up.
    def visit_Name(self, node):
        if node.id in _JSON_NAME_CONSTS:
            return ast.copy_location(ast.Constant(_JSON_NAME_CONSTS[node.id]), node)
        return node

def literal_eval_json(node):
    node = _JsonLiteralNames().visit(node)
    ast.fix_missing_locations(node)
    return ast.literal_eval(node)

def clean_text(text):
    # Statements carry non-breaking and zero-width spaces that Python cannot parse.
    return text.replace(chr(160), " ").replace(chr(8203), "").replace(chr(65279), "")

def parse_named_args(text):
    call = ast.parse(f"f({clean_text(text)})", mode="eval").body
    return [(kw.arg or "", literal_eval_json(kw.value)) for kw in call.keywords]

def parse_design_input(text):
    # Design problems (MinStack, LRUCache...): one line of method names, one of arguments.
    lines = [line.strip() for line in clean_text(text).strip().split(chr(10)) if line.strip()]
    if len(lines) != 2 or not lines[0].startswith("["):
        return None
    try:
        ops = json.loads(lines[0])
        args = json.loads(lines[1])
    except Exception:
        return None
    if not ops or not all(isinstance(op, str) for op in ops) or len(ops) != len(args):
        return None
    return ops, args

def normalize_annotation(annotation):
    if annotation is inspect._empty:
        return ""
    if isinstance(annotation, str):
        return annotation
    args = getattr(annotation, "__args__", None)
    if args:
        return " ".join(getattr(a, "__name__", str(a)) for a in args)
    return getattr(annotation, "__name__", str(annotation))

def annotation_is_list(annotation):
    # True when the parameter is a "list of" something, e.g.
    # List[Optional[ListNode]] for merge-k-sorted-lists, so we build one node
    # per element instead of wrongly folding the outer list into a single node.
    try:
        if get_origin(annotation) is list:
            return True
    except Exception:
        pass
    if isinstance(annotation, str):  # from __future__ annotations arrive as text
        return annotation.strip().lower().startswith("list[")
    return False

def annotation_mentions(annotation, name):
    # Structural check for whether an annotation references a class of the given
    # name (e.g. "ListNode"), walking typing generics by identity. Text matching
    # on a flattened annotation is unreliable: Optional[ListNode] renders
    # differently across Python versions and can drop the inner class name.
    if isinstance(annotation, type):
        return annotation.__name__ == name
    if isinstance(annotation, str):
        return name.lower() in annotation.lower()
    return any(annotation_mentions(arg, name) for arg in get_args(annotation))

# Without type hints, LeetCode's parameter names are the only clue to a node input.
_LIST_PARAM_NAMES = {"head", "heada", "headb", "l1", "l2", "list1", "list2", "lists"}
_TREE_PARAM_NAMES = {"root", "root1", "root2", "p", "q", "subroot", "original", "cloned"}

def adapt_value(value, annotation, name=""):
    if isinstance(value, list) and annotation is inspect._empty:
        key = name.lower()
        if key in _TREE_PARAM_NAMES:
            return build_tree(value)
        if key in _LIST_PARAM_NAMES:
            return [build_list_node(v) for v in value] if key == "lists" else build_list_node(value)
    if isinstance(value, list):
        is_list = annotation_is_list(annotation)
        if annotation_mentions(annotation, "TreeNode"):
            return [build_tree(v) for v in value] if is_list else build_tree(value)
        if annotation_mentions(annotation, "ListNode"):
            return [build_list_node(v) for v in value] if is_list else build_list_node(value)
    return value

def serialize_value(value):
    if _is_tree_node(value):
        return tree_to_list(value)
    if _is_list_node(value):
        return listnode_to_list(value)
    if isinstance(value, list):
        return [serialize_value(v) for v in value]
    return value

def _parse_literal(text):
    try:
        return True, json.loads(text)
    except Exception:
        pass
    try:
        return True, literal_eval_json(ast.parse(text, mode="eval").body)
    except Exception:
        return False, text

def normalize_expected(text):
    text = clean_text(text).strip()
    ok, value = _parse_literal(text)
    if ok:
        return value
    # Some outputs carry a trailing note ("[3,1]" then "Note: ... also accepted").
    first = text.split(chr(10))[0].strip()
    ok, value = _parse_literal(first)
    return value if ok else text

def parse_count_form(text):
    # "2, nums = [1,2,_]": the returned count, then what the first k slots must hold.
    head, sep, rest = clean_text(text).strip().partition(",")
    if not sep or "=" not in rest:
        return None
    try:
        count = int(head.strip())
    except ValueError:
        return None
    _, _, array = rest.partition("=")
    array = array.strip()
    if not (array.startswith("[") and array.endswith("]")):
        return None
    items = [item.strip() for item in array[1:-1].split(",") if item.strip()]
    return count, [normalize_expected(item) for item in items if item != "_"]

def _canon(value):
    if isinstance(value, list):
        return sorted((_canon(item) for item in value), key=repr)
    return value

def _close(a, b):
    if isinstance(a, bool) or isinstance(b, bool):
        return a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(a - b) <= 1e-5 * max(1.0, abs(b))
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_close(x, y) for x, y in zip(a, b))
    return a == b

def values_match(actual, expected):
    # Floats within 1e-5 (LeetCode's judge); lists in any order when the statement allows it.
    if ANY_ORDER:
        return _close(_canon(actual), _canon(expected))
    return _close(actual, expected)

def find_tree_node(root, value):
    queue = deque([root])
    while queue:
        node = queue.popleft()
        if node is None:
            continue
        if node.val == value:
            return node
        queue.append(node.left)
        queue.append(node.right)
    return None

class GraphNode:
    def __init__(self, val=0, neighbors=None):
        self.val = val
        self.neighbors = neighbors if neighbors is not None else []

class RandomNode:
    def __init__(self, x=0, next=None, random=None):
        self.val = int(x)
        self.next = next
        self.random = random

def build_graph(adj):
    # clone-graph style: node i + 1 lists its neighbors' values.
    if not adj:
        return None
    nodes = [GraphNode(i + 1) for i in range(len(adj))]
    for i, neighbors in enumerate(adj):
        nodes[i].neighbors = [nodes[v - 1] for v in neighbors]
    return nodes[0]

def graph_to_adj(node):
    if node is None:
        return []
    seen = {node.val: node}
    queue = deque([node])
    while queue:
        cur = queue.popleft()
        for nb in cur.neighbors:
            if nb.val not in seen:
                seen[nb.val] = nb
                queue.append(nb)
    return [[nb.val for nb in seen[v].neighbors] for v in sorted(seen)]

def build_random_list(pairs):
    nodes = [RandomNode(val) for val, _ in pairs]
    for i, (_, rnd) in enumerate(pairs):
        if i + 1 < len(nodes):
            nodes[i].next = nodes[i + 1]
        nodes[i].random = nodes[rnd] if rnd is not None else None
    return nodes[0] if nodes else None

def random_list_to_pairs(head):
    nodes = []
    index = {}
    cur = head
    while cur is not None and len(nodes) < _MAX_NODES:
        index[id(cur)] = len(nodes)
        nodes.append(cur)
        cur = cur.next
    return [[n.val, index.get(id(n.random)) if n.random is not None else None] for n in nodes]

def _is_random_pairs(value):
    return isinstance(value, list) and all(isinstance(p, list) and len(p) == 2 for p in value)

_EXEC_TIMEOUT = 5.0

def _make_timeout_tracer(deadline):
    def _t(frame, event, arg):
        if _time.time() > deadline:
            raise TimeoutError("Time limit exceeded (5s). Check for infinite loops.")
        return _t
    return _t

RESULT = {"ok": False, "output": "", "cases": []}

user_code = ${JSON.stringify(code)}
test_cases = json.loads(${JSON.stringify(payload)})
ANY_ORDER = ${anyOrder}

_PRELUDE = """from typing import *
from collections import deque, defaultdict, Counter, OrderedDict
from heapq import *
import math
import bisect
import functools
import itertools
"""

def _case_arg_names(case):
    try:
        return [name for name, _ in parse_named_args(case["inputText"]) if name != "pos"]
    except Exception:
        return None

def select_callable(namespace, new_keys, first_case):
    """Prefer a class Solution method; otherwise fall back to a bare top-level
    function the user pasted. With several methods or functions, pick the one whose
    parameter names (then count) match the first test case, so helpers never run."""
    import types as _types
    wanted = _case_arg_names(first_case) if first_case else None
    solution_cls = namespace.get("Solution")
    if isinstance(solution_cls, type):
        method_names = [
            name for name, value in solution_cls.__dict__.items()
            if callable(value) and not name.startswith("_")
        ]
        if not method_names:
            raise ValueError("class Solution needs at least one public method to run.")
        instance = solution_cls()
        if wanted is not None and len(method_names) > 1:
            for name in method_names:
                if list(inspect.signature(getattr(instance, name)).parameters) == wanted:
                    return getattr(instance, name)
            for name in method_names:
                if len(inspect.signature(getattr(instance, name)).parameters) == len(wanted):
                    return getattr(instance, name)
        return getattr(instance, method_names[0])

    func_candidates = [
        namespace[k] for k in new_keys
        if isinstance(namespace.get(k), _types.FunctionType)
    ]
    if not func_candidates:
        raise ValueError("To run, your code needs a top-level function or a class Solution.")
    if len(func_candidates) == 1 or wanted is None:
        return func_candidates[-1]
    for fn in func_candidates:
        if list(inspect.signature(fn).parameters) == wanted:
            return fn
    for fn in func_candidates:
        if len(inspect.signature(fn).parameters) == len(wanted):
            return fn
    return func_candidates[-1]

def _timed(fn, *args):
    _sys.settrace(_make_timeout_tracer(_time.time() + _EXEC_TIMEOUT))
    try:
        return fn(*args)
    finally:
        _sys.settrace(None)

def _record(case, passed, actual, expected):
    RESULT["cases"].append({
        "label": case["label"],
        "passed": bool(passed),
        "actual": repr(actual),
        "expected": repr(expected),
    })

def run_design_case(namespace, case, design):
    # LeetCode runs the constructor, then each method in order; constructors return null.
    ops, op_args = design
    cls = namespace.get(ops[0])
    if not isinstance(cls, type):
        raise ValueError(f"Couldn't find class {ops[0]} in your code.")
    obj = _timed(cls, *op_args[0])
    actual = [None]
    for op, arg in zip(ops[1:], op_args[1:]):
        actual.append(serialize_value(_timed(getattr(obj, op), *arg)))
    expected = normalize_expected(case["expectedOutput"])
    _record(case, values_match(actual, expected), actual, expected)

def run_codec_case(namespace, case):
    # serialize / deserialize: the tree must survive the round trip.
    raw_args = parse_named_args(case["inputText"])
    root = build_tree(raw_args[0][1]) if raw_args else None
    codec = namespace["Codec"]
    actual = serialize_value(_timed(codec().deserialize, _timed(codec().serialize, root)))
    if actual is None:
        actual = []
    expected = normalize_expected(case["expectedOutput"])
    _record(case, values_match(actual, expected), actual, expected)

try:
    namespace = {}
    exec(_PRELUDE, namespace)
    namespace["ListNode"] = ListNode
    namespace["TreeNode"] = TreeNode
    first_case = test_cases[0] if test_cases else None
    design_first = parse_design_input(first_case["inputText"]) if first_case else None
    # LeetCode's Node class differs per problem: graph neighbors or a random pointer.
    graph_input = False
    random_input = False
    if first_case and not design_first:
        try:
            _names = parse_named_args(first_case["inputText"])
            graph_input = bool(_names) and _names[0][0] == "adjList"
            random_input = bool(_names) and _names[0][0] == "head" and bool(_names[0][1]) and _is_random_pairs(_names[0][1])
        except Exception:
            pass
    if graph_input:
        namespace["Node"] = GraphNode
    elif random_input:
        namespace["Node"] = RandomNode
    _before_keys = set(namespace.keys())
    exec(user_code, namespace)
    _new_keys = [k for k in namespace.keys() if k not in _before_keys]
    # If the user pasted their own node classes, build inputs with those.
    ListNode = namespace.get("ListNode", ListNode)
    TreeNode = namespace.get("TreeNode", TreeNode)

    _run_started = _time.perf_counter()
    _codec = namespace.get("Codec")
    is_codec = isinstance(_codec, type) and hasattr(_codec, "serialize") and not isinstance(namespace.get("Solution"), type)
    if design_first or is_codec:
        for case in test_cases:
            design = parse_design_input(case["inputText"])
            if design:
                run_design_case(namespace, case, design)
            elif is_codec:
                run_codec_case(namespace, case)
            else:
                raise ValueError(f"Write {case['label']} like the examples: method names on one line, their arguments on the next.")
    else:
        method = select_callable(namespace, _new_keys, first_case)
        signature = inspect.signature(method)
        parameters = list(signature.parameters.values())
        # An empty list or tree is None in code and [] (or null) in the expected
        # output; for node-returning methods all three mean the same answer.
        _ret = signature.return_annotation
        returns_nodes = annotation_mentions(_ret, "ListNode") or annotation_mentions(_ret, "TreeNode")
        returns_nothing = _ret is None or _ret is inspect._empty or str(_ret) == "None"

        for case in test_cases:
            try:
                raw_args = parse_named_args(case["inputText"])
            except Exception:
                raise ValueError(f"Couldn't read the input for {case['label']}. Write it like the examples, for example nums = [1, 2], target = 3.")
            # Linked list cycle problems pass the cycle's start as pos; it is not a parameter.
            pos = None
            if len(raw_args) == len(parameters) + 1 and any(name == "pos" for name, _ in raw_args):
                pos = next(value for name, value in raw_args if name == "pos")
                raw_args = [(name, value) for name, value in raw_args if name != "pos"]
            if len(raw_args) != len(parameters):
                raise ValueError(f"Couldn't match the testcase input to the Python method signature for {case['label']}.")
            args = []
            for (name, value), parameter in zip(raw_args, parameters):
                if graph_input and name == "adjList":
                    args.append(build_graph(value))
                elif random_input and name == "head" and _is_random_pairs(value):
                    args.append(build_random_list(value))
                else:
                    args.append(adapt_value(value, parameter.annotation, parameter.name))
            if isinstance(pos, int) and not isinstance(pos, bool) and pos >= 0 and args and _is_list_node(args[0]):
                nodes = []
                cur = args[0]
                while cur is not None:
                    nodes.append(cur)
                    cur = cur.next
                if pos < len(nodes):
                    nodes[-1].next = nodes[pos]
            # Tree problems that name nodes by value (lowest common ancestor: p = 2, q = 8).
            tree_root = next((a for a in args if _is_tree_node(a)), None)
            if tree_root is not None:
                for i, parameter in enumerate(parameters):
                    if isinstance(args[i], int) and not isinstance(args[i], bool) and (
                        annotation_mentions(parameter.annotation, "TreeNode") or parameter.name in ("p", "q")
                    ):
                        found = find_tree_node(tree_root, args[i])
                        if found is not None:
                            args[i] = found
            returned = _timed(method, *args)
            count_form = parse_count_form(case["expectedOutput"])
            if count_form is not None:
                # remove-element style: the count, and the first k slots of the array.
                count, want = count_form
                got = serialize_value(args[0])[:count] if args and isinstance(returned, int) else None
                passed = returned == count and got is not None and values_match(got, want)
                _record(case, passed, f"{returned}, {got}", f"{count}, {want}")
                continue
            expected = normalize_expected(case["expectedOutput"])
            if graph_input:
                actual = graph_to_adj(returned)
            elif random_input:
                actual = random_list_to_pairs(returned)
            elif _is_tree_node(returned) and isinstance(expected, int) and not isinstance(expected, bool):
                actual = returned.val
            elif returned is None and returns_nothing and args and expected is not None and expected != []:
                # In-place problems return nothing; LeetCode checks the first argument.
                actual = serialize_value(args[0])
            else:
                actual = serialize_value(returned)
            if returns_nodes or (_ret is inspect._empty and expected == []):
                if actual is None:
                    actual = []
                if expected is None:
                    expected = []
            _record(case, values_match(actual, expected), actual, expected)

    RESULT["runtime_ms"] = round((_time.perf_counter() - _run_started) * 1000, 1)
    RESULT["ok"] = bool(RESULT["cases"]) and all(case["passed"] for case in RESULT["cases"])
    RESULT["output"] = "All tests passed." if RESULT["ok"] else "Some tests failed."
except Exception:
    RESULT["ok"] = False
    RESULT["output"] = "Execution failed."
    RESULT["error"] = traceback.format_exc()

json.dumps(RESULT)
`;

  try {
    const result = await pyodide.runPythonAsync(runner);
    return JSON.parse(String(result)) as RunnerResult;
  } catch (error) {
    return {
      ok: false,
      output: "Execution failed.",
      error: error instanceof Error ? error.message : "Unknown Python runner error.",
    };
  }
}

export async function traceLeetCodeExecution(
  code: string,
  inputText: string,
): Promise<TraceResult> {
  const pyodide = await loadPyodideInstance();

  const tracer = `
import sys as _sys
import json as _json
import inspect as _inspect
import ast as _ast
import time as _time
import traceback as _tb
from typing import *
from collections import deque, defaultdict, Counter, OrderedDict
from heapq import *
import math, bisect, functools, itertools

class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

def _bln(vals):
    d = ListNode(); c = d
    for v in vals:
        c.next = ListNode(v); c = c.next
    return d.next

def _bt(vals):
    if not vals: return None
    items = list(vals)
    if items[0] is None: return None
    root = TreeNode(items[0]); q = deque([root]); idx = 1
    while q and idx < len(items):
        n = q.popleft()
        if idx < len(items):
            l = items[idx]; idx += 1
            if l is not None: n.left = TreeNode(l); q.append(n.left)
        if idx < len(items):
            r = items[idx]; idx += 1
            if r is not None: n.right = TreeNode(r); q.append(n.right)
    return root

def _norm_ann(ann):
    if ann is _inspect._empty: return ""
    if isinstance(ann, str): return ann
    _args = getattr(ann, "__args__", None)
    if _args: return " ".join(getattr(_a, "__name__", str(_a)) for _a in _args)
    return getattr(ann, "__name__", str(ann))

def _ann_is_list(ann):
    try:
        if get_origin(ann) is list: return True
    except Exception:
        pass
    if isinstance(ann, str): return ann.strip().lower().startswith("list[")
    return False

def _ann_has(ann, name):
    if isinstance(ann, type): return ann.__name__ == name
    if isinstance(ann, str): return name.lower() in ann.lower()
    return any(_ann_has(a, name) for a in get_args(ann))

def _adapt(val, ann):
    if isinstance(val, list):
        if _ann_has(ann, "TreeNode"):
            return [_bt(v) for v in val] if _ann_is_list(ann) else _bt(val)
        if _ann_has(ann, "ListNode"):
            return [_bln(v) for v in val] if _ann_is_list(ann) else _bln(val)
    return val

_JSON_NAME_CONSTS = {"null": None, "true": True, "false": False}

class _JsonLiteralNames(_ast.NodeTransformer):
    # LeetCode/JSON style null/true/false parse as Name nodes, which
    # literal_eval rejects; rewrite them to Python constants first so tree and
    # graph inputs like [3,9,20,null,null,15,7] evaluate.
    def visit_Name(self, node):
        if node.id in _JSON_NAME_CONSTS:
            return _ast.copy_location(_ast.Constant(_JSON_NAME_CONSTS[node.id]), node)
        return node

def _literal_eval_json(node):
    node = _JsonLiteralNames().visit(node)
    _ast.fix_missing_locations(node)
    return _ast.literal_eval(node)

def _parse_args(text):
    call = _ast.parse("f(" + text + ")", mode="eval").body
    return [(kw.arg or "", _literal_eval_json(kw.value)) for kw in call.keywords]

_MAX_STEPS = 500
_TRACE_TIMEOUT = 5.0
_STEPS = []
_TRACE_START = _time.time()

def _sz(v, d=0):
    if d > 3: return {"type": "other", "repr": "..."}
    if v is None: return {"type": "none"}
    if isinstance(v, bool): return {"type": "bool", "value": v}
    if isinstance(v, int): return {"type": "number", "value": v}
    if isinstance(v, float): return {"type": "number", "value": v}
    if isinstance(v, str): return {"type": "string", "value": v[:200]}
    if isinstance(v, (list, tuple)):
        t = "list" if isinstance(v, list) else "tuple"
        return {"type": t, "value": [_sz(i, d+1) for i in v[:30]], "length": len(v)}
    if isinstance(v, dict):
        return {"type": "dict", "value": {str(k): _sz(vv, d+1) for k, vv in list(v.items())[:15]}, "length": len(v)}
    if isinstance(v, (set, frozenset)):
        return {"type": "set", "value": [_sz(i, d+1) for i in list(v)[:20]], "length": len(v)}
    try: return {"type": "other", "repr": repr(v)[:150]}
    except: return {"type": "other", "repr": "<?>"}

def _tracer(frame, event, arg):
    if len(_STEPS) >= _MAX_STEPS:
        _sys.settrace(None)
        raise RuntimeError(f"Step limit of {_MAX_STEPS} reached. Check for infinite loops.")
    if _time.time() - _TRACE_START > _TRACE_TIMEOUT:
        _sys.settrace(None)
        raise TimeoutError("Time limit exceeded (5s). Check for infinite loops.")
    if event == "call":
        return _tracer if frame.f_code.co_filename == "<user_solution>" else None
    if event == "line" and frame.f_code.co_filename == "<user_solution>":
        locs = {k: _sz(v) for k, v in frame.f_locals.items() if k != "self" and not k.startswith("_")}
        _STEPS.append({"line": frame.f_lineno, "locals": locs, "method": frame.f_code.co_name})
    return _tracer

_ns = {"ListNode": ListNode, "TreeNode": TreeNode}
exec(compile(
    "from typing import *\\nfrom collections import deque, defaultdict, Counter, OrderedDict\\nfrom heapq import *\\nimport math, bisect, functools, itertools",
    "<prelude>", "exec"
), _ns)

_user_code = ${JSON.stringify(code)}
_input_text = ${JSON.stringify(inputText)}
_TRACE_RESULT = {"steps": [], "result": None, "error": None}

try:
    import types as _types
    _before = set(_ns.keys())
    exec(compile(_user_code, "<user_solution>", "exec"), _ns)
    _new = [k for k in _ns.keys() if k not in _before]
    _cls = _ns.get("Solution")
    if isinstance(_cls, type):
        _mn = [n for n, v in _cls.__dict__.items() if callable(v) and not n.startswith("_")][0]
        _meth = getattr(_cls(), _mn)
    else:
        _funcs = [_ns[k] for k in _new if isinstance(_ns.get(k), _types.FunctionType)]
        if not _funcs:
            raise ValueError("Need a top-level function or class Solution to visualize.")
        _meth = _funcs[-1]
    _sig = _inspect.signature(_meth)
    _params = list(_sig.parameters.values())
    _raw = _parse_args(_input_text)
    _args = [_adapt(v, p.annotation) for (_, v), p in zip(_raw, _params)]
    _sys.settrace(_tracer)
    try:
        _res = _meth(*_args)
        _sys.settrace(None)
        _TRACE_RESULT = {"steps": _STEPS, "result": repr(_res), "error": None}
    except Exception as _e:
        _sys.settrace(None)
        _TRACE_RESULT = {"steps": _STEPS, "result": None, "error": _tb.format_exc()}
except Exception as _e:
    _TRACE_RESULT = {"steps": [], "result": None, "error": _tb.format_exc()}

_json.dumps(_TRACE_RESULT)
`;

  try {
    const result = await pyodide.runPythonAsync(tracer);
    return JSON.parse(String(result)) as TraceResult;
  } catch (error) {
    return {
      steps: [],
      result: null,
      error: error instanceof Error ? error.message : "Tracer failed.",
    };
  }
}

// ── System Design mode: multi-file exercise runner ────────────────────────────

export type { SimEvent, TestCaseResult } from "./sdHarness";

export type MultiFileTestResult = {
  ok: boolean;
  cases: TestCaseResult[];
  stdout: string;
  /** Events the learner's code emitted through the sim module. [] if unused. */
  events: SimEvent[];
  /** A harness-level failure (syntax error, import error), not a failing assertion. */
  error?: string;
};

type SdExecutor = (driver: string) => Promise<string>;

// Covers a first-run Pyodide download plus the driver's own 10s in-Python limit.
// Past this the worker is terminated, which also stops a loop the tracer missed.
const SD_WORKER_TIMEOUT_MS = 90_000;

let sdWorker: Worker | null = null;
let sdRunId = 0;

function runInSdWorker(driver: string): Promise<string> {
  if (!sdWorker) {
    sdWorker = new Worker(new URL("./sdPython.worker.ts", import.meta.url), { type: "module" });
  }
  const worker = sdWorker;
  const id = ++sdRunId;
  return new Promise((resolve, reject) => {
    const reset = () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      clearTimeout(timer);
    };
    const kill = (message: string) => {
      reset();
      worker.terminate();
      if (sdWorker === worker) sdWorker = null;
      reject(new Error(message));
    };
    const onMessage = (event: MessageEvent<{ id: number; output?: string; error?: string }>) => {
      if (event.data?.id !== id) return;
      reset();
      if (typeof event.data.output === "string") resolve(event.data.output);
      else reject(new Error(event.data.error || "The Python runner failed."));
    };
    const onError = () => kill("The Python runner failed to start.");
    const timer = setTimeout(
      () => kill("Time limit exceeded. Check for an infinite loop, then run again."),
      SD_WORKER_TIMEOUT_MS,
    );
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage({ id, driver });
  });
}

let sdExecutor: SdExecutor = runInSdWorker;

/** Tests only: jsdom has no Worker, so integration tests run the driver on a Pyodide they load. */
export function __setSdExecutorForTests(executor: SdExecutor | null): void {
  sdExecutor = executor ?? runInSdWorker;
}

/**
 * Run a System Design exercise: the learner's files plus a hidden test module,
 * all inside the browser. Nothing here executes on the backend.
 *
 * SECURITY: the hidden test module can be untrusted (custom topics are written
 * through the MCP connector), so it runs in sdPython.worker.ts, never on the
 * page's own Pyodide where `import js` reaches localStorage and the auth token.
 *
 * Thin on purpose. Every decision (what to write, in what order, how to read the
 * results back) lives in sdHarness.ts where it is unit tested without Pyodide.
 */
export async function runPythonMultiFile(args: {
  files: Record<string, string>;
  testModule: string;
  mockPackages?: Record<string, string>;
  entryTest?: string;
}): Promise<MultiFileTestResult> {
  let harnessFiles;
  try {
    harnessFiles = buildHarnessFiles(args);
  } catch (error) {
    return {
      ok: false,
      cases: [],
      stdout: "",
      events: [],
      error: error instanceof Error ? error.message : "Could not prepare the exercise files.",
    };
  }

  const entryTest = args.entryTest || "run_tests";

  const driver = `
import contextlib
import importlib
import io
import json
import os
import shutil
import sys
import time
import traceback

WORK_DIR = ${JSON.stringify(SD_WORK_DIR)}
ENTRY = ${JSON.stringify(entryTest)}
FILES = json.loads(${JSON.stringify(JSON.stringify(harnessFiles))})

# The worker's Pyodide instance is shared across runs, so the
# workspace is rebuilt from scratch every time. Without the sys.modules purge a
# second run would silently reuse the first run's module objects and the learner
# would see stale results from code they had already changed.
if os.path.isdir(WORK_DIR):
    shutil.rmtree(WORK_DIR, ignore_errors=True)
os.makedirs(WORK_DIR, exist_ok=True)

for _name in list(sys.modules):
    _origin = getattr(sys.modules[_name], "__file__", None) or ""
    if _origin.startswith(WORK_DIR + os.sep) or _origin.startswith(WORK_DIR + "/"):
        del sys.modules[_name]

for _entry in FILES:
    with open(_entry["path"], "w", encoding="utf-8") as _handle:
        _handle.write(_entry["contents"])

if WORK_DIR in sys.path:
    sys.path.remove(WORK_DIR)
sys.path.insert(0, WORK_DIR)
importlib.invalidate_caches()

_TIME_LIMIT = 10.0

def _timeout_tracer(deadline):
    def _trace(frame, event, arg):
        if time.time() > deadline:
            raise TimeoutError("Time limit exceeded (10s). Check for an infinite loop.")
        return _trace
    return _trace

def _jsonable(value):
    if isinstance(value, (list, tuple)):
        return [list(item) if isinstance(item, tuple) else item for item in value]
    return value

RESULT = {"cases": None, "stdout": "", "events": [], "error": None}
_buffer = io.StringIO()

try:
    with contextlib.redirect_stdout(_buffer), contextlib.redirect_stderr(_buffer):
        import sim
        sim.reset()
        _tests = importlib.import_module("_sd_tests")
        _entry_fn = getattr(_tests, ENTRY, None)
        if not callable(_entry_fn):
            raise AttributeError("The exercise tests are missing a " + ENTRY + "() function.")
        sys.settrace(_timeout_tracer(time.time() + _TIME_LIMIT))
        try:
            RESULT["cases"] = _jsonable(_entry_fn())
        finally:
            sys.settrace(None)
        RESULT["events"] = sim.events()
except BaseException:
    sys.settrace(None)
    RESULT["error"] = traceback.format_exc()
    try:
        RESULT["events"] = sys.modules["sim"].events() if "sim" in sys.modules else []
    except Exception:
        RESULT["events"] = []

RESULT["stdout"] = _buffer.getvalue()
json.dumps(RESULT, default=repr)
`;

  let raw: { cases?: unknown; stdout?: unknown; events?: unknown; error?: unknown };
  try {
    raw = JSON.parse(await sdExecutor(driver));
  } catch (error) {
    return {
      ok: false,
      cases: [],
      stdout: "",
      events: [],
      error: error instanceof Error ? error.message : "The Python runner failed to start.",
    };
  }

  const events = normalizeSimEvents(raw.events);
  const stdout = typeof raw.stdout === "string" ? raw.stdout : "";

  if (raw.error) {
    return { ok: false, cases: [], stdout, events, error: String(raw.error) };
  }

  const parsed = parseTestResults(raw.cases);
  return {
    ok: computeOk(parsed),
    cases: parsed.cases,
    stdout,
    events,
    ...(parsed.error ? { error: parsed.error } : {}),
  };
}
