import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { buildLiveDecorations, liveMarkdownExtensions, setFocused } from "./MarkdownLiveEditor";
import { findInlineMath } from "../lib/markdownLiveSyntax";
import { formatSelection } from "../lib/markdownFormat";

const DOC = [
  "## Chain rule", //            line 1
  "Use it for a ==function inside== now, **bold** and [docs](https://a.test) `code`.", // 2
  "> [!tip] Formula", //         line 3
  "> $f(g(x))$", //              line 4
  "- [x] done item", //          line 5
  "- plain item", //             line 6
  "```py", //                    line 7
  "x = $1", //                   line 8
  "```", //                      line 9
].join("\n");

function stateAt(line: number | null) {
  let state = EditorState.create({ doc: DOC, extensions: liveMarkdownExtensions });
  ensureSyntaxTree(state, state.doc.length, 5000);
  if (line !== null) {
    state = state.update({ selection: EditorSelection.cursor(state.doc.line(line).from + 2) }).state;
  }
  state = state.update({ effects: setFocused.of(line !== null) }).state;
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

// Text covered by hidden/replaced ranges and the classes on marks/lines.
function describeDecos(state: EditorState) {
  const hidden: string[] = [];
  const widgets: string[] = [];
  const classes = new Set<string>();
  buildLiveDecorations(state).between(0, state.doc.length, (from, to, deco) => {
    const spec = deco.spec as { class?: string; widget?: { constructor: { name: string } } };
    if (spec.class) spec.class.split(" ").forEach((c) => classes.add(c));
    else if (spec.widget) widgets.push(`${spec.widget.constructor.name}:${state.doc.sliceString(from, to)}`);
    else if (from !== to) hidden.push(state.doc.sliceString(from, to));
  });
  return { hidden, widgets, classes };
}

describe("live preview decorations", () => {
  it("hides markers on lines the cursor is not on, but keeps styling everywhere", () => {
    const { hidden, widgets, classes } = describeDecos(stateAt(2));
    // Cursor on line 2: its ==, **, link URL and backticks stay visible.
    expect(hidden).not.toContain("==");
    expect(hidden).not.toContain("**");
    // Other lines: heading hashes, quote marks and the callout head are hidden.
    expect(hidden).toEqual(expect.arrayContaining(["## ", "> ", "[!tip] "]));
    expect(widgets).toEqual(expect.arrayContaining(["CheckboxWidget:[x]", "BulletWidget:-", "MathWidget:$f(g(x))$"]));
    for (const cls of ["md-live-h2", "md-live-highlight", "md-live-link", "md-live-inline-code", "md-live-callout--positive", "md-live-code", "md-live-task-done"]) {
      expect(classes.has(cls)).toBe(true);
    }
  });

  it("hides every marker once the editor loses focus", () => {
    const { hidden } = describeDecos(stateAt(null));
    expect(hidden).toEqual(expect.arrayContaining(["==", "**", "`", "](https://a.test)", "## "]));
  });

  it("never renders $ inside a code block as math", () => {
    const { widgets } = describeDecos(stateAt(null));
    expect(widgets.some((w) => w.includes("$1"))).toBe(false);
  });

  it("styling classes are the same with the cursor on or off a line", () => {
    const on = describeDecos(stateAt(2)).classes;
    const off = describeDecos(stateAt(null)).classes;
    expect([...on].sort()).toEqual([...off].sort());
  });
});

describe("findInlineMath", () => {
  it("finds tight or evenly padded math and skips prices", () => {
    expect(findInlineMath("a $x^2$ b $$y$$", 0).map((m) => [m.src, m.display])).toEqual([["x^2", false], ["y", true]]);
    expect(findInlineMath("costs $5 and $2 more", 0)).toEqual([]);
  });
});

describe("formatSelection", () => {
  const apply = (doc: string, from: number, to: number, kind: Parameters<typeof formatSelection>[1]) => {
    const state = EditorState.create({ doc, selection: EditorSelection.range(from, to) });
    const next = state.update(formatSelection(state, kind)).state;
    const sel = next.selection.main;
    return { doc: next.doc.toString(), selected: next.sliceDoc(sel.from, sel.to) };
  };

  it("wraps and unwraps inline formats", () => {
    expect(apply("make this bold", 5, 9, "bold")).toEqual({ doc: "make **this** bold", selected: "this" });
    expect(apply("make **this** bold", 7, 11, "bold")).toEqual({ doc: "make this bold", selected: "this" });
    expect(apply("make **this** bold", 5, 13, "bold")).toEqual({ doc: "make this bold", selected: "this" });
    expect(apply("key idea", 0, 8, "highlight").doc).toBe("==key idea==");
    expect(apply("x^2", 0, 3, "math").doc).toBe("$x^2$");
  });

  it("does not treat bold as italic", () => {
    expect(apply("**this**", 0, 8, "italic").doc).toBe("***this***");
  });

  it("uses block forms for multi-line code and math", () => {
    expect(apply("a = 1\nb = 2", 0, 11, "code").doc).toBe("```\na = 1\nb = 2\n```");
    expect(apply("x = 1\ny = 2", 0, 11, "math").doc).toBe("$$\nx = 1\ny = 2\n$$");
  });

  it("wraps each line on its own for a multi-line inline format, outside list and quote markers", () => {
    expect(apply("> [!tip] Formula\n- [ ] step one\n\n## Title", 0, 41, "highlight").doc).toBe(
      "> ==[!tip] Formula==\n- [ ] ==step one==\n\n## ==Title==",
    );
  });

  it("leaves the cursor between delimiters for an empty selection", () => {
    const state = EditorState.create({ doc: "ab", selection: EditorSelection.cursor(1) });
    const next = state.update(formatSelection(state, "code")).state;
    expect(next.doc.toString()).toBe("a``b");
    expect(next.selection.main.head).toBe(2);
  });
});
