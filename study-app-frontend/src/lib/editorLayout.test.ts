import { describe, expect, it } from "vitest";
import {
  initialLayout,
  panels,
  readLayout,
  reduceLayout,
  tabs,
  type Edge,
} from "./editorLayout";

describe("editor layout", () => {
  it("reorders within a panel and preserves the code tab when a panel disappears", () => {
    const reordered = reduceLayout(initialLayout(), {
      type: "move",
      tab: "Notes",
      to: "left",
      edge: "center",
      before: "Description",
    });
    expect(panels(reordered.root)[0].tabs[0]).toBe("Notes");
    const merged = reduceLayout(reordered, {
      type: "move",
      tab: "Code",
      to: "left",
      edge: "center",
    });
    expect(panels(merged.root)).toHaveLength(2);
    expect(
      panels(merged.root)
        .flatMap((p) => p.tabs)
        .sort(),
    ).toEqual([...tabs].sort());
  });
  it.each(["left", "right", "top", "bottom"] as Edge[])(
    "splits on the %s edge",
    (edge) => {
      const split = reduceLayout(initialLayout(), {
        type: "move",
        tab: "Notes",
        to: "code",
        edge,
      });
      expect(panels(split.root)).toHaveLength(4);
      expect(readLayout(JSON.stringify(split))).toEqual(split);
    },
  );
  it("restores maximized panels and expands a collapsed panel on tab selection", () => {
    const max = reduceLayout(initialLayout(), { type: "max", id: "bottom" });
    expect(max.max).toBe("bottom");
    expect(reduceLayout(max, { type: "max", id: "bottom" }).max).toBeNull();
    const collapsed = reduceLayout(max, { type: "collapse", id: "bottom" });
    expect(panels(collapsed.root)[2].collapsed).toBe(true);
    const selected = reduceLayout(collapsed, {
      type: "select",
      tab: "Complexity",
    });
    expect(panels(selected.root)[2]).toMatchObject({
      active: "Complexity",
      collapsed: false,
    });
    expect(reduceLayout(selected, { type: "reset" })).toEqual(initialLayout());
  });
  it("rejects corrupt and incomplete preferences", () => {
    expect(readLayout("{")).toEqual(initialLayout());
    const layout = initialLayout();
    panels(layout.root)[0].tabs.pop();
    expect(readLayout(JSON.stringify(layout))).toEqual(initialLayout());
  });

  it("never leaves both panels of a column folded", () => {
    const codeFolded = reduceLayout(initialLayout(), { type: "collapse", id: "code" });
    const both = reduceLayout(codeFolded, { type: "collapse", id: "bottom" });
    const [, code, bottom] = panels(both.root);
    expect(bottom.collapsed).toBe(true);
    expect(code.collapsed).toBe(false);
    // Unfolding does not touch the neighbor.
    const unfolded = reduceLayout(both, { type: "collapse", id: "bottom" });
    expect(panels(unfolded.root).map((p) => p.collapsed)).toEqual([false, false, false]);
  });
});
