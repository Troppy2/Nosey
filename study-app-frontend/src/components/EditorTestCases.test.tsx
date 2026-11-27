import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EditorTestCases } from "./EditorTestCases";
afterEach(cleanup);
it("switches one case at a time, preserves read-only examples and edits custom cases", () => {
  const change = vi.fn();
  render(<EditorTestCases cases={[{id:"a",label:"Case 1",input:"nums = [1]",expected:"1"},{id:"b",label:"Custom 1",input:"nums = [2]",expected:"2",custom:true}]} canAdd onAdd={vi.fn()} onRemove={vi.fn()} onChange={change} visualizing={null} />);
  expect(screen.getByRole('textbox', {name:'Test case input'}).getAttribute('readonly')).not.toBeNull();
  fireEvent.keyDown(screen.getByRole('tab', {name:'Case 1'}), {key:'ArrowRight'});
  expect((screen.getByRole('textbox', {name:'Test case input'}) as HTMLTextAreaElement).value).toBe('nums = [2]');
  fireEvent.change(screen.getByRole('textbox', {name:'Expected output'}), {target:{value:'3'}});
  expect(change).toHaveBeenCalledWith('b','expectedOutput','3');
  expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
});
