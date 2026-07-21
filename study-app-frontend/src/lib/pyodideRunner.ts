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
  cases?: Array<{
    label: string;
    passed: boolean;
    actual: string;
    expected: string;
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

export async function runPythonLeetCode(code: string, testCases: TestCase[]): Promise<RunnerResult> {
  const pyodide = await loadPyodideInstance();
  const payload = JSON.stringify(testCases);
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

def listnode_to_list(node):
    out = []
    while node is not None:
        out.append(node.val)
        node = node.next
    return out

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

def parse_named_args(text):
    call = ast.parse(f"f({text})", mode="eval").body
    return [(kw.arg or "", ast.literal_eval(kw.value)) for kw in call.keywords]

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

def adapt_value(value, annotation):
    if isinstance(value, list):
        is_list = annotation_is_list(annotation)
        if annotation_mentions(annotation, "TreeNode"):
            return [build_tree(v) for v in value] if is_list else build_tree(value)
        if annotation_mentions(annotation, "ListNode"):
            return [build_list_node(v) for v in value] if is_list else build_list_node(value)
    return value

def serialize_value(value):
    if isinstance(value, ListNode):
        return listnode_to_list(value)
    if isinstance(value, TreeNode):
        return tree_to_list(value)
    if isinstance(value, list):
        return [serialize_value(v) for v in value]
    return value

def normalize_expected(text):
    text = text.strip()
    try:
        return json.loads(text)
    except Exception:
        pass
    try:
        return ast.literal_eval(text)
    except Exception:
        return text

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

_PRELUDE = """from typing import *
from collections import deque, defaultdict, Counter, OrderedDict
from heapq import *
import math
import bisect
import functools
import itertools
"""

def select_callable(namespace, new_keys, first_case):
    """Prefer a class Solution method; otherwise fall back to a bare top-level
    function the user pasted. When several functions exist, pick the one whose
    parameter count matches the first test case so 'just paste a function' works."""
    import types as _types
    solution_cls = namespace.get("Solution")
    if isinstance(solution_cls, type):
        method_names = [
            name for name, value in solution_cls.__dict__.items()
            if callable(value) and not name.startswith("_")
        ]
        if not method_names:
            raise ValueError("class Solution needs at least one public method to run.")
        return getattr(solution_cls(), method_names[0])

    func_candidates = [
        namespace[k] for k in new_keys
        if isinstance(namespace.get(k), _types.FunctionType)
    ]
    if not func_candidates:
        raise ValueError("To run, your code needs a top-level function or a class Solution.")
    if len(func_candidates) == 1 or first_case is None:
        return func_candidates[-1]
    try:
        wanted = len(parse_named_args(first_case["inputText"]))
        for fn in func_candidates:
            if len(inspect.signature(fn).parameters) == wanted:
                return fn
    except Exception:
        pass
    return func_candidates[-1]

try:
    namespace = {}
    exec(_PRELUDE, namespace)
    namespace["ListNode"] = ListNode
    namespace["TreeNode"] = TreeNode
    _before_keys = set(namespace.keys())
    exec(user_code, namespace)
    _new_keys = [k for k in namespace.keys() if k not in _before_keys]

    method = select_callable(namespace, _new_keys, test_cases[0] if test_cases else None)
    signature = inspect.signature(method)
    parameters = list(signature.parameters.values())

    for case in test_cases:
        raw_args = parse_named_args(case["inputText"])
        if len(raw_args) != len(parameters):
            raise ValueError(f"Couldn't match the testcase input to the Python method signature for {case['label']}.")
        args = []
        for (name, value), parameter in zip(raw_args, parameters):
            args.append(adapt_value(value, parameter.annotation))
        _sys.settrace(_make_timeout_tracer(_time.time() + _EXEC_TIMEOUT))
        try:
            actual = serialize_value(method(*args))
        finally:
            _sys.settrace(None)
        expected = normalize_expected(case["expectedOutput"])
        RESULT["cases"].append({
            "label": case["label"],
            "passed": actual == expected,
            "actual": repr(actual),
            "expected": repr(expected),
        })

    RESULT["ok"] = all(case["passed"] for case in RESULT["cases"])
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

def _parse_args(text):
    call = _ast.parse("f(" + text + ")", mode="eval").body
    return [(kw.arg or "", _ast.literal_eval(kw.value)) for kw in call.keywords]

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
