import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EditorDock } from "./EditorDock";
import { tabs, type Tab } from "../lib/editorLayout";

vi.mock("../lib/useMobileShell", () => ({ useMobileShell: () => false }));
vi.mock("../lib/api", () => ({ scopeKey: (key: string) => key }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("keeps the visible tab prefix stable when selecting an overflow tab", () => {
  vi.stubGlobal("localStorage", {getItem: () => null, setItem: vi.fn()});
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const width = this.classList.contains("lc-dock-strip") ? 270 : this.classList.contains("lc-dock-more") ? 70 : 90;
    return {width, height:44, x:0, y:0, top:0, left:0, right:width, bottom:44, toJSON:()=>({})};
  });
  const contents = Object.fromEntries(tabs.map((t) => [t, t + " contents"])) as Record<Tab, string>;
  render(<EditorDock toolbar={() => null} contents={contents} locks={{}} />);
  const before = screen.getAllByRole("tab").map((t) => t.textContent);
  fireEvent.click(screen.getAllByRole("button", {name:/more tabs/})[0]);
  fireEvent.click(screen.getByRole("menuitem", {name:"Notes"}));
  expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(before);
  expect(screen.getByRole("tabpanel", {name:"Notes"})).toBeTruthy();
  expect(screen.getByRole("button", {name:/Notes selected/})).toBeTruthy();
  expect(screen.queryByText("Description contents")).toBeNull();
  expect(document.querySelector('[draggable="true"]')).toBeTruthy();
  expect(screen.queryByRole("button", {name:/Move|Maximize|Collapse|Layout/})).toBeNull();
});

it("reorders tabs inside their pane with Alt and arrow keys", () => {
  vi.stubGlobal("localStorage", {getItem: () => null, setItem: vi.fn()});
  vi.stubGlobal("ResizeObserver", class {observe() {} disconnect() {}});
  const contents = Object.fromEntries(tabs.map((tab) => [tab, tab + " contents"])) as Record<Tab,string>;
  render(<EditorDock toolbar={() => null} contents={contents} locks={{}} />);
  fireEvent.keyDown(screen.getByRole("tab", {name:"Notes"}), {key:"ArrowLeft",altKey:true});
  const left=screen.getByRole("tablist",{name:"Description panel tabs"});
  expect(Array.from(left.querySelectorAll('[role="tab"]')).map((tab) => tab.textContent)).toEqual(["Description","Solutions","Notes","Kojo","Submissions"]);
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
