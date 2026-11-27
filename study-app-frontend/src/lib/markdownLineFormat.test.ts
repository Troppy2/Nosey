import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import { expect, it } from "vitest";
import { insertLink, toggleLines } from "./markdownFormat";

const apply = (doc: string, from: number, to: number, run: (s: EditorState) => TransactionSpec) => {
  const state = EditorState.create({ doc, selection: EditorSelection.range(from, to) });
  return state.update(run(state)).state;
};

it("adds and removes a line prefix on every selected line", () => {
  const on = apply("a\nb", 0, 3, (s) => toggleLines(s, "numbered"));
  expect(on.doc.toString()).toBe("1. a\n2. b");
  expect(apply(on.doc.toString(), 0, on.doc.length, (s) => toggleLines(s, "numbered")).doc.toString()).toBe("a\nb");
});

it("puts the cursor after a new prefix on an empty line", () => {
  const state = apply("", 0, 0, (s) => toggleLines(s, "bullet"));
  expect(state.doc.toString()).toBe("- ");
  expect(state.selection.main.head).toBe(2);
});

it("wraps a selection as a link and selects the url", () => {
  const state = apply("docs", 0, 4, insertLink);
  expect(state.doc.toString()).toBe("[docs](url)");
  expect(state.sliceDoc(state.selection.main.from, state.selection.main.to)).toBe("url");
});
