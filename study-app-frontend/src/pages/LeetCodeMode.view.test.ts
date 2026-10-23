import { afterEach, describe, expect, it } from "vitest";

import { loadSavedView, normalizeCodeWorkspace, saveView } from "./LeetCodeMode";

afterEach(() => sessionStorage.clear());

describe("KojoCode view survives a reload", () => {
  it("restores the screen the user was on", () => {
    saveView({ type: "banks" });
    expect(loadSavedView()).toEqual({ type: "banks" });
    saveView({ type: "category", categoryId: "arrays" });
    expect(loadSavedView()).toEqual({ type: "category", categoryId: "arrays" });
  });

  it("restores an open catalog problem", () => {
    saveView({ type: "problem", categoryId: "arrays", problemSlug: "two-sum" });
    expect(loadSavedView()).toEqual({ type: "problem", categoryId: "arrays", problemSlug: "two-sum" });
  });

  it("falls back to the category when the problem no longer exists", () => {
    saveView({ type: "problem", categoryId: "arrays", problemSlug: "custom-deleted" });
    expect(loadSavedView()).toEqual({ type: "category", categoryId: "arrays" });
  });

  it("starts on the tree with nothing saved or a corrupt value", () => {
    expect(loadSavedView()).toEqual({ type: "tree" });
    sessionStorage.setItem("nosey_lc_view", "{not json");
    expect(loadSavedView()).toEqual({ type: "tree" });
    sessionStorage.setItem("nosey_lc_view", JSON.stringify({ type: "admin" }));
    expect(loadSavedView()).toEqual({ type: "tree" });
  });
});

describe("saved code workspaces", () => {
  it("keep the bank run and drill markers through a reload", () => {
    const workspace = normalizeCodeWorkspace({
      tabs: [
        { id: "a", name: "Tab 1", code: "x" },
        { id: "b", name: "Bank", code: "", bankRun: "2026-10-22T10:00:00+00:00" },
        { id: "c", name: "Pass 2", code: "", drillPass: 2 },
      ],
      activeTabId: "b",
    });
    expect(workspace?.tabs[1]).toEqual({ id: "b", name: "Bank", code: "", bankRun: "2026-10-22T10:00:00+00:00" });
    expect(workspace?.tabs[2]).toEqual({ id: "c", name: "Pass 2", code: "", drillPass: 2 });
  });
});
