import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import CodingTabs from "./Tab";

afterEach(cleanup);

function renderTabs(closable: boolean) {
  const onSelectTab = vi.fn();
  const onDeleteTab = vi.fn();
  render(
    <CodingTabs
      tabs={[
        { id: "old", name: "Tab 1", locked: true, closable },
        { id: "bank", name: "Bank" },
      ]}
      activeTabId="bank"
      onSelectTab={onSelectTab}
      onAddTab={() => {}}
      onDeleteTab={onDeleteTab}
    />,
  );
  return { onSelectTab, onDeleteTab };
}

describe("CodingTabs locks", () => {
  it("a bank-locked tab can be closed but not opened", () => {
    const { onSelectTab, onDeleteTab } = renderTabs(true);
    fireEvent.click(screen.getByText("Tab 1"));
    expect(onSelectTab).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Delete Tab 1"));
    expect(onDeleteTab).toHaveBeenCalledWith("old");
  });

  it("a drill-locked tab can be neither opened nor closed", () => {
    const { onSelectTab } = renderTabs(false);
    fireEvent.click(screen.getByText("Tab 1"));
    expect(onSelectTab).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Delete Tab 1")).toBeNull();
  });
});
