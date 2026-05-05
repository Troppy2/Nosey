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
    return getattr(annotation, "__name__", str(annotation))

def adapt_value(value, annotation_text):
    lowered = annotation_text.lower()
    if "treenode" in lowered and isinstance(value, list):
        return build_tree(value)
    if "listnode" in lowered and isinstance(value, list):
        return build_list_node(value)
    return value

def serialize_value(value):
    if isinstance(value, ListNode):
        return listnode_to_list(value)
    if isinstance(value, TreeNode):
        return tree_to_list(value)
    return value

def normalize_expected(text):
    text = text.strip()
    try:
        return ast.literal_eval(text)
    except Exception:
        return text

RESULT = {"ok": False, "output": "", "cases": []}

user_code = ${JSON.stringify(code)}
test_cases = json.loads(${JSON.stringify(payload)})

try:
    namespace = {}
    exec(user_code, namespace)
    solution_cls = namespace.get("Solution")
    if solution_cls is None:
        raise ValueError("Automatic test running currently supports LeetCode Python snippets that define class Solution.")

    method_names = [
        name for name, value in solution_cls.__dict__.items()
        if callable(value) and not name.startswith("_")
    ]
    if len(method_names) != 1:
        raise ValueError("Automatic test running currently supports one public Solution method at a time.")

    solution = solution_cls()
    method = getattr(solution, method_names[0])
    signature = inspect.signature(method)
    parameters = list(signature.parameters.values())

    for case in test_cases:
        raw_args = parse_named_args(case["inputText"])
        if len(raw_args) != len(parameters):
            raise ValueError(f"Couldn't match the testcase input to the Python method signature for {case['label']}.")
        args = []
        for (name, value), parameter in zip(raw_args, parameters):
            annotation_text = normalize_annotation(parameter.annotation)
            args.append(adapt_value(value, annotation_text))
        actual = serialize_value(method(*args))
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
