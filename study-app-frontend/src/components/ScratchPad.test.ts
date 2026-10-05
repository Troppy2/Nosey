import { describe, expect, it } from "vitest";
import { exportScratchPadPng, isScratchPadEmpty, parseScratchPadJson, type ScratchPadData } from "./ScratchPad";

const line = (extra: object = {}) => ({ points: [0, 0, 300, 0], ...extra });

describe("scratch pad stroke format", () => {
  it("loads drawings saved before pen colors existed", () => {
    const data = parseScratchPadJson(JSON.stringify({ version: 1, strokes: [{ points: [1, 2, 3, 4] }] }));
    expect(data.strokes).toHaveLength(1);
    expect(data.strokes[0].c).toBeUndefined();
  });

  it("keeps color, width and highlight flags through a save and load", () => {
    const saved: ScratchPadData = { version: 1, strokes: [line({ c: "#1d4ed8", w: 4 }), line({ c: "#ffe14d", h: 1 })] };
    const loaded = parseScratchPadJson(JSON.stringify(saved));
    expect(loaded.strokes[0]).toMatchObject({ c: "#1d4ed8", w: 4 });
    expect(loaded.strokes[1]).toMatchObject({ h: 1 });
  });

  it("does not count a page of only highlights as work", () => {
    const onlyHighlights: ScratchPadData = { version: 1, strokes: [{ points: [0, 0, 300, 0, 300, 60], h: 1 }] };
    expect(isScratchPadEmpty(onlyHighlights)).toBe(true);
    expect(exportScratchPadPng(onlyHighlights)).toBeNull();
  });

  it("counts a pen stroke even when highlights surround it", () => {
    const mixed: ScratchPadData = {
      version: 1,
      strokes: [{ points: [0, 0, 300, 0], h: 1 }, { points: [0, 0, 300, 80] }],
    };
    expect(isScratchPadEmpty(mixed)).toBe(false);
  });
});
