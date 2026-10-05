import { describe, expect, it } from "vitest";
import { isReadFromDrawing } from "./drawnAnswer";

const transcript = "I ran out of room\n\nQ3]\n\na]\n\n$x > 0$ and $y > 0$\n\nSo $(0, 1)$";

describe("isReadFromDrawing", () => {
  it("treats the whole transcript as read from the drawing", () => {
    expect(isReadFromDrawing(transcript, transcript)).toBe(true);
  });

  it("treats the trimmed working as read from the drawing", () => {
    expect(isReadFromDrawing("$x > 0$ and $y > 0$\n\nSo $(0, 1)$", transcript)).toBe(true);
  });

  it("treats a typed answer as typed", () => {
    expect(isReadFromDrawing("c = 3", transcript)).toBe(false);
    expect(isReadFromDrawing("c = 3", null)).toBe(false);
    expect(isReadFromDrawing("", transcript)).toBe(false);
  });
});
