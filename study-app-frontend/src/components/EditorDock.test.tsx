import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EditorDock } from "./EditorDock";
import { tabs, type Tab } from "../lib/editorLayout";

vi.mock("../lib/useMobileShell", () => ({ useMobileShell: () => false }));
vi.mock("../lib/api", () => ({ scopeKey: (key: string) => key }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("keeps answer tabs in place and presents the unlock reason instead of their contents", () => {
  vi.stubGlobal("localStorage", {getItem: () => null, setItem: vi.fn()});
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const contents = Object.fromEntries(
    tabs.map((t) => [t, t + " contents"]),
  ) as Record<Tab, string>;
  const reason = "Locked on pass 3. Opens after you submit pass 3.";
  render(
    <EditorDock
      toolbar={() => null}
      contents={contents}
      locks={{ Solutions: reason, Kojo: reason }}
    />,
  );
  for (const tab of ["Solutions", "Kojo"]) {
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(tab) }));
    expect(screen.getByText(reason)).toBeTruthy();
    expect(screen.queryByText(tab + " contents")).toBeNull();
  }
});
