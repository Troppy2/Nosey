import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { EditorRunResult } from "./EditorRunResult";
afterEach(cleanup);
it("opens the first failed case and lets the keyboard inspect other results", () => {
  render(<EditorRunResult result={{ok:false,output:"Some tests failed.",cases:[{label:"Official 1",passed:true,actual:"1",expected:"1"},{label:"Official 2",passed:false,actual:"0",expected:"2"}]}} />);
  const failed=screen.getByRole("tab",{name:/Case 2\s*: failed/});
  expect(failed.getAttribute("aria-selected")).toBe("true");
  expect(screen.getByText("0")).toBeTruthy();
  fireEvent.keyDown(failed,{key:"ArrowLeft"});
  expect(screen.getByRole("tab",{name:/Case 1\s*: passed/}).getAttribute("aria-selected")).toBe("true");
  expect(screen.queryByText("0")).toBeNull();
});
it("shows the failing input and names a submit verdict", () => {
  render(<EditorRunResult kind="submit" result={{ok:false,output:"Some tests failed.",cases:[{label:"Official 1",passed:false,actual:"[]",expected:"[0,1]",input:"nums = [2,7]\ntarget = 9"}]}} />);
  expect(screen.getByText("Wrong answer")).toBeTruthy();
  expect(screen.getByText("Input")).toBeTruthy();
  expect(screen.getByText(/target = 9/)).toBeTruthy();
});
it("keeps a run as a preview and a pre-run check out of the error style", () => {
  const { container } = render(<EditorRunResult result={{ok:false,notice:true,output:"Write some code first",error:"Add your solution."}} />);
  expect(screen.getByText("Write some code first")).toBeTruthy();
  expect(container.querySelector(".lc-runner-result--notice")).toBeTruthy();
  cleanup();
  render(<EditorRunResult result={{ok:true,output:"All tests passed.",cases:[{label:"Official 1",passed:true,actual:"1",expected:"1"}]}} />);
  expect(screen.getByText("All cases passed")).toBeTruthy();
});
