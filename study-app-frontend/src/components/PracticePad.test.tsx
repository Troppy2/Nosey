import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScratchPadData } from "./ScratchPad";

const api = vi.hoisted(() => ({
  saveModulePractice: vi.fn(() => Promise.resolve({ status: "open", strokes: null })),
  scopeKey: (key: string) => key,
  // useSettings (markdown answers) reads the stored user for beta access.
  getStoredUser: () => null,
}));
vi.mock("../lib/api", () => api);

// Stand-in canvas: records every `data` prop it receives and exposes the
// onChange it was given, like the real ScratchPadModal's canvas would use.
type Typing = { mode: string; onChange: (v: string) => void } | undefined;
const modal = vi.hoisted(() => ({
  received: [] as ScratchPadData[],
  onChange: null as null | ((d: ScratchPadData) => void),
  typing: undefined as Typing,
}));
vi.mock("./ScratchPad", async (importOriginal) => {
  const real = await importOriginal<typeof import("./ScratchPad")>();
  return {
    ...real,
    exportScratchPadPng: () => null,
    ScratchPadModal: (props: { data: ScratchPadData; onChange: (d: ScratchPadData) => void; typing?: Typing }) => {
      modal.received.push(props.data);
      modal.onChange = props.onChange;
      modal.typing = props.typing;
      return <div data-testid="pad" />;
    },
  };
});

import { PracticePad } from "./PracticePad";

afterEach(() => {
  cleanup();
  modal.received = [];
  modal.onChange = null;
  modal.typing = undefined;
  api.saveModulePractice.mockClear();
});

describe("PracticePad", () => {
  it("hands the canvas back the exact strokes array it emitted", () => {
    const onState = vi.fn();
    render(
      <PracticePad
        moduleId={1}
        index={0}
        problemText="Solve it"
        state={{ status: "open", strokes: null }}
        onState={onState}
        paperStyle="blank"
        onPaperStyleChange={() => {}}
        walkthrough={<p>Steps</p>}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /solve on scratch pad/i }));

    const emitted: ScratchPadData = { version: 1, strokes: [{ points: [0, 0, 50, 50] }] };
    act(() => modal.onChange?.(emitted));

    // The canvas spots its own echo by identity; a re-parsed copy would make
    // it reset to that copy and drop strokes drawn in the meantime.
    const latest = modal.received[modal.received.length - 1];
    expect(latest.strokes).toBe(emitted.strokes);
    // Ink is not pushed up to the lesson page per stroke.
    expect(onState).not.toHaveBeenCalled();
  });

  it("text pads hand the modal a typed answer and count it as work", async () => {
    const onState = vi.fn();
    render(
      <PracticePad
        moduleId={1}
        index={0}
        problemText="Explain it"
        state={{ status: "open", strokes: null, typed: null }}
        onState={onState}
        paperStyle="blank"
        onPaperStyleChange={() => {}}
        walkthrough={<p>Steps</p>}
        mode="text"
      />,
    );
    const done = screen.getByRole("button", { name: /i'm done/i });
    expect(done).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: /solve on scratch pad/i }));
    expect(modal.typing?.mode).toBe("text");

    act(() => modal.typing?.onChange("Because each step halves the range."));
    expect(screen.getByRole("button", { name: /i'm done/i })).toHaveProperty("disabled", false);

    api.saveModulePractice.mockResolvedValueOnce({ status: "done", strokes: null, typed: "Because each step halves the range." } as never);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /i'm done/i }));
    });
    expect(api.saveModulePractice).toHaveBeenLastCalledWith(1, 0, { typed: "Because each step halves the range.", status: "done" });
    expect(onState).toHaveBeenCalledWith(expect.objectContaining({ status: "done" }));
  });

  it("draw pads open without a typed tab", () => {
    render(
      <PracticePad
        moduleId={1}
        index={0}
        problemText="Solve it"
        state={{ status: "open", strokes: null }}
        onState={() => {}}
        paperStyle="blank"
        onPaperStyleChange={() => {}}
        walkthrough={<p>Steps</p>}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /solve on scratch pad/i }));
    expect(modal.typing).toBeUndefined();
  });
});
